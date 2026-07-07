/**
 * S2-AUTH-USEROPS-1 — bulk-actions (pure helpers): lọc target hợp lệ + chạy tuần tự partial-failure.
 */
import { describe, expect, it, vi } from "vitest";
import type { AuthUserDto } from "@mediaos/contracts";
import { eligibleTargets, runBulkSequential } from "./bulk-actions";

function user(over: Partial<AuthUserDto> = {}): AuthUserDto {
  return {
    id: "u-1",
    email: "a@demo.local",
    fullName: "A",
    status: "active",
    lockedAt: null,
    lockedReason: null,
    lastLoginAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    ...over,
  };
}

const SELF_ID = "self-1";

describe("eligibleTargets", () => {
  it("loại self-row khỏi lock/unlock/delete (server cũng chặn — đây là UX)", () => {
    const users = [user({ id: SELF_ID }), user({ id: "u-2", email: "b@demo.local" })];
    for (const action of ["lock", "delete"] as const) {
      const { targets, skipped } = eligibleTargets(users, action, SELF_ID);
      expect(targets.map((u) => u.id)).toEqual(["u-2"]);
      expect(skipped).toBe(1);
    }
  });

  it("lock: chỉ user CHƯA khóa; unlock: chỉ user ĐANG khóa", () => {
    const users = [
      user({ id: "u-2", email: "b@demo.local", status: "locked" }),
      user({ id: "u-3", email: "c@demo.local", status: "active" }),
    ];
    expect(eligibleTargets(users, "lock", SELF_ID).targets.map((u) => u.id)).toEqual(["u-3"]);
    expect(eligibleTargets(users, "unlock", SELF_ID).targets.map((u) => u.id)).toEqual(["u-2"]);
  });

  it("restore: không loại self (user đã xóa không thể là actor)", () => {
    const users = [user({ id: SELF_ID })];
    expect(eligibleTargets(users, "restore", SELF_ID).targets).toHaveLength(1);
  });
});

describe("runBulkSequential", () => {
  it("chạy TUẦN TỰ, item lỗi KHÔNG chặn item sau, gom ok/failed + progress từng bước", async () => {
    const users = [
      user({ id: "u-1", email: "a@demo.local" }),
      user({ id: "u-2", email: "b@demo.local" }),
      user({ id: "u-3", email: "c@demo.local" }),
    ];
    const calls: string[] = [];
    const progress: Array<[number, number]> = [];
    const run = vi.fn(async (u: AuthUserDto) => {
      calls.push(u.id);
      if (u.id === "u-2") throw new Error("Tài khoản đã bị khoá.");
    });

    const result = await runBulkSequential(users, run, (done, total) =>
      progress.push([done, total]),
    );

    expect(calls).toEqual(["u-1", "u-2", "u-3"]); // tuần tự, không dừng giữa chừng
    expect(result.ok).toBe(2);
    expect(result.failed).toEqual([{ email: "b@demo.local", message: "Tài khoản đã bị khoá." }]);
    expect(progress).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  it("lỗi không phải Error → message an toàn mặc định", async () => {
    const result = await runBulkSequential([user()], async () => {
      throw new TypeError(""); // Error nhưng message rỗng → fallback message an toàn
    });
    expect(result.failed[0].message).toBe("Lỗi không xác định");
  });
});
