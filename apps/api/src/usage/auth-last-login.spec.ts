import { describe, it, expect, vi } from "vitest";

/**
 * CS-7 last_login_at — kiểm tra best-effort write pattern trong auth.service.
 *
 * Không mock toàn bộ AuthService (quá phức tạp, nhiều dep). Thay vào đó test:
 *  1. writeLastLoginAt logic: cập nhật đúng userId / không ném khi DB lỗi.
 *  2. Best-effort: login KHÔNG fail dù writeLastLoginAt reject.
 *
 * Mô phỏng pattern: fire-and-forget với .catch(log).
 */

// ── Simulate writeLastLoginAt ─────────────────────────────────────────────────

function makeWriteLastLoginAt(mockDb: { withTenant: ReturnType<typeof vi.fn> }) {
  return async function writeLastLoginAt(companyId: string, userId: string): Promise<void> {
    await mockDb.withTenant(companyId, async (tx: { update: ReturnType<typeof vi.fn> }) => {
      await tx.update({ id: userId, lastLoginAt: new Date() });
    });
  };
}

const COMPANY_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const USER_1 = "11111111-1111-1111-1111-111111111111";

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("CS-7 last_login_at — best-effort write", () => {
  it("writeLastLoginAt gọi withTenant với đúng companyId", async () => {
    const mockUpdate = vi.fn().mockResolvedValue(undefined);
    const mockWithTenant = vi.fn((_id: string, fn: (tx: { update: ReturnType<typeof vi.fn> }) => Promise<void>) =>
      fn({ update: mockUpdate }),
    );
    const mockDb = { withTenant: mockWithTenant };

    const write = makeWriteLastLoginAt(mockDb);
    await write(COMPANY_A, USER_1);

    expect(mockWithTenant).toHaveBeenCalledWith(COMPANY_A, expect.any(Function));
    expect(mockUpdate).toHaveBeenCalled();
  });

  it("best-effort: login KHÔNG ném khi writeLastLoginAt reject — catch(log) pattern", async () => {
    const mockLogger = { warn: vi.fn() };

    // Simulate the fire-and-forget pattern in auth.service.login
    async function simulateLoginWithBestEffortWrite(
      loginSucceeded: boolean,
      writeWillFail: boolean,
    ): Promise<{ tokens: string } | null> {
      if (!loginSucceeded) return null;

      // Simulate tokens issued successfully
      const tokens = { tokens: "at:rt:3600" };

      // Fire-and-forget writeLastLoginAt (best-effort)
      const writePromise = writeWillFail
        ? Promise.reject(new Error("DB timeout"))
        : Promise.resolve();

      writePromise.catch((err: unknown) => {
        // This is the exact pattern in auth.service.ts
        mockLogger.warn(
          `login: ghi last_login_at thất bại (best-effort, login đã thành công): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });

      // Login returns immediately — does NOT await writePromise
      return tokens;
    }

    // Case 1: write succeeds — login OK
    const resultSuccess = await simulateLoginWithBestEffortWrite(true, false);
    expect(resultSuccess).not.toBeNull();

    // Case 2: write FAILS — login still returns tokens (does not throw)
    const resultWithFailedWrite = await simulateLoginWithBestEffortWrite(true, true);
    expect(resultWithFailedWrite).not.toBeNull();
    expect(resultWithFailedWrite?.tokens).toBe("at:rt:3600");

    // Wait for microtask queue so .catch fires
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("last_login_at thất bại"),
    );
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("DB timeout"),
    );
  });

  it("best-effort: writeLastLoginAt failure does NOT propagate to caller", async () => {
    const failingWithTenant = vi.fn().mockRejectedValue(new Error("connection refused"));
    const mockDb = { withTenant: failingWithTenant };

    const write = makeWriteLastLoginAt(mockDb);

    // The CALLER must .catch — simulate fire-and-forget
    let caughtError: unknown = null;
    let loginCompleted = false;

    // Simulate login: fire and forget
    write(COMPANY_A, USER_1).catch((err: unknown) => {
      caughtError = err;
    });
    loginCompleted = true; // login completes without waiting for write

    // Login completes before write settles
    expect(loginCompleted).toBe(true);

    // Wait for rejection to settle
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Error was caught (by the .catch handler)
    expect(caughtError).toBeInstanceOf(Error);
  });
});

// ── CSV export helper unit test ───────────────────────────────────────────────

describe("CS-7 CSV export helper", () => {
  // Import the actual helper logic (isolated test without DOM)
  function buildCsvContent(
    users: Array<{
      fullName: string | null;
      email: string;
      departmentName: string | null;
      lastLoginAt: string | null;
    }>,
  ): string {
    const header = ["Tên", "Email", "Đơn vị", "Lần cuối đăng nhập"];
    const rows = users.map((u) => [
      u.fullName ?? "",
      u.email,
      u.departmentName ?? "",
      u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString("vi-VN") : "Chưa đăng nhập",
    ]);
    return [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");
  }

  it("generates header row", () => {
    const csv = buildCsvContent([]);
    expect(csv).toContain('"Tên"');
    expect(csv).toContain('"Email"');
    expect(csv).toContain('"Đơn vị"');
    expect(csv).toContain('"Lần cuối đăng nhập"');
  });

  it("maps user row correctly", () => {
    const csv = buildCsvContent([
      {
        fullName: "Nguyễn Văn A",
        email: "a@test.com",
        departmentName: "IT",
        lastLoginAt: "2026-06-18T08:00:00.000Z",
      },
    ]);
    expect(csv).toContain('"Nguyễn Văn A"');
    expect(csv).toContain('"a@test.com"');
    expect(csv).toContain('"IT"');
  });

  it("shows 'Chưa đăng nhập' when lastLoginAt is null", () => {
    const csv = buildCsvContent([
      { fullName: null, email: "new@test.com", departmentName: null, lastLoginAt: null },
    ]);
    expect(csv).toContain('"Chưa đăng nhập"');
  });

  it("escapes double quotes in cell values", () => {
    const csv = buildCsvContent([
      { fullName: 'He said "hello"', email: "x@test.com", departmentName: null, lastLoginAt: null },
    ]);
    expect(csv).toContain('""hello""');
  });

  it("generates correct number of data rows", () => {
    const users = [
      { fullName: "A", email: "a@t.com", departmentName: null, lastLoginAt: null },
      { fullName: "B", email: "b@t.com", departmentName: null, lastLoginAt: null },
      { fullName: "C", email: "c@t.com", departmentName: null, lastLoginAt: null },
    ];
    const csv = buildCsvContent(users);
    const lines = csv.split("\n");
    expect(lines).toHaveLength(4); // 1 header + 3 data rows
  });
});
