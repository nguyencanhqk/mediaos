/**
 * S2-AUTH-BE-5 (L2-BE-API) — UNIT (no-DB) cho AuthLogsViewerService mapping + DTO query validation.
 * Chạy trong unit-run mặc định (KHÔNG cần Postgres) → phủ coverage vùng nhạy cảm + chứng minh BẤT BIẾN #3
 * ở tầng map: metadata/payload KHÔNG BAO GIỜ xuất hiện trong DTO (repo không select → service không map).
 */
import { describe, expect, it } from "vitest";
import { ForbiddenException } from "@nestjs/common";
import { loginLogListQuerySchema, securityEventListQuerySchema } from "@mediaos/contracts";
import { AuthLogsViewerService } from "./auth-logs-viewer.service";
import type { LoginLogRow } from "./login-log.repository";
import type { SecurityEventRow } from "./security-event.repository";

const COMPANY = "00000000-0000-0000-0000-0000000000aa";
const U1 = "00000000-0000-0000-0000-0000000000b1";
const U2 = "00000000-0000-0000-0000-0000000000b2";

/** Stub DatabaseService: withTenant gọi callback với tx giả (không chạm DB). */
function stubDb(): unknown {
  return {
    withTenant: async (_companyId: string, fn: (tx: unknown) => unknown) => fn({}),
  };
}

/**
 * Stub DataScopeService — S6-SEC-IDENTITY-PROJ-1 (KI-054) + S10-SEC-AUDITLOGROW-1 (KI-070).
 *
 * ⚠️ PHẢI phân biệt CẶP QUYỀN. Bản trước trả cùng một `scope` cho MỌI cặp; từ KI-070 service hỏi HAI
 * cặp khác nhau với hai luật fail-closed NGƯỢC nhau — `view:audit-log` (`null` ⇒ **403**) và
 * `view:user` (`null` ⇒ bỏ cột danh tính, KHÔNG 403). Một stub trả chung sẽ làm ca "không có cặp danh
 * bạ" bật sang nhánh 403 và ta mất luôn phép kiểm đường map.
 *
 * Ở tầng unit (không DB) vị từ không được THỰC THI, nên ca ở đây kiểm ĐƯỜNG MAP (userRef ba nhánh) +
 * nhánh 403; việc vị từ có lọc đúng HÀNG hay không thuộc int-spec chạy trên Postgres thật
 * (`test/integration/audit-log-row-scope.int-spec.ts`).
 */
function stubDataScope(dirScope: string | null, auditScope: string | null): unknown {
  return {
    resolveOrNull: async (
      _userId: string,
      _companyId: string,
      _action: string,
      resourceType: string,
    ) => (resourceType === "audit-log" ? auditScope : dirScope),
    buildUserScopeConditionOn: () => ({ queryChunks: [] }),
  };
}

const ACTOR = { id: U2, companyId: COMPANY };

function makeService(
  loginRows: LoginLogRow[],
  secRows: SecurityEventRow[],
  scope: string | null = "Company",
  auditScope: string | null = "Company",
): AuthLogsViewerService {
  const loginRepo = {
    findManyTx: async () => loginRows,
    countTx: async () => loginRows.length,
  };
  const secRepo = {
    findManyTx: async () => secRows,
    countTx: async () => secRows.length,
  };
  return new AuthLogsViewerService(
    stubDb() as never,
    loginRepo as never,
    secRepo as never,
    stubDataScope(scope, auditScope) as never,
  );
}

const baseLoginQuery = loginLogListQuerySchema.parse({});
const baseSecQuery = securityEventListQuerySchema.parse({});

describe("AuthLogsViewerService.listLoginLogs (mapping)", () => {
  it("map row→DTO: user ref đầy đủ, KHÔNG có cột metadata, created_at ISO", async () => {
    const row: LoginLogRow = {
      id: "11111111-1111-1111-1111-111111111111",
      loginStatus: "failed",
      ipAddress: "10.0.0.1",
      userAgent: "agent",
      failureReason: "WrongPassword",
      createdAt: new Date("2026-06-01T08:30:00.000Z"),
      userId: U1,
      identityInScope: true,
      userEmail: "u1@a.test",
      userFullName: "User One",
    };
    const svc = makeService([row], []);
    const { data, total } = await svc.listLoginLogs(ACTOR, baseLoginQuery);
    expect(total).toBe(1);
    expect(data[0]).toEqual({
      id: row.id,
      user: { id: U1, email: "u1@a.test", display_name: "User One" },
      status: "failed",
      ip_address: "10.0.0.1",
      user_agent: "agent",
      failure_reason: "WrongPassword",
      created_at: "2026-06-01T08:30:00.000Z",
    });
    expect(Object.keys(data[0])).not.toContain("metadata");
  });

  it("user ref = null khi user_id NULL (UserNotFound) hoặc email NULL (soft-delete)", async () => {
    const rows: LoginLogRow[] = [
      {
        id: "22222222-2222-2222-2222-222222222222",
        loginStatus: "failed",
        ipAddress: null,
        userAgent: null,
        failureReason: "UserNotFound",
        createdAt: new Date("2026-06-02T00:00:00.000Z"),
        userId: null,
        identityInScope: true,
        userEmail: null,
        userFullName: null,
      },
      {
        id: "33333333-3333-3333-3333-333333333333",
        loginStatus: "blocked",
        ipAddress: null,
        userAgent: null,
        failureReason: "Locked",
        createdAt: new Date("2026-06-03T00:00:00.000Z"),
        userId: U2,
        // S6-SEC-IDENTITY-PROJ-1 — SUA FIXTURE, khong phai sua assert. Ban cu ghim
        // `identityInScope: true` + `userEmail: null`, mot trang thai KHONG THE XAY RA tren SQL that:
        // `users.email` la NOT NULL, nen join TRUNG thi luon co email; join TRUOT thi moi cot NULL
        // ⇒ vi tu cho NULL ⇒ co (sau `coalesce`) la `false`. Ghim mot trang thai bat kha thi nghia la
        // ca test khong khang dinh gi ve he thong that (memory `tests-can-pin-a-hole-open`).
        identityInScope: false,
        userEmail: null,
        userFullName: null,
      },
    ];
    const svc = makeService(rows, []);
    const { data } = await svc.listLoginLogs(ACTOR, baseLoginQuery);
    // Hang KHONG gan user ⇒ `null` (nghia CU, giu nguyen).
    expect(data[0].user).toBeNull();
    // Hang co user nhung khong lay duoc danh tinh (user da xoa cung HOAC ngoai scope — hai ca chia
    // chung hinh dang, xem docblock `userRef`) ⇒ con `id`, MAT khoa `email`. Nhieu thong tin hon ban
    // goc (ban goc tra `null` ca object), va van fail-closed ve danh tinh.
    expect(data[1].user).toEqual({ id: U2, display_name: null });
    expect("email" in (data[1].user as object)).toBe(false);
  });
});

describe("AuthLogsViewerService.listSecurityEvents (mapping)", () => {
  it("map row→DTO: user + actor ref, severity, KHÔNG có cột payload", async () => {
    const row: SecurityEventRow = {
      id: "44444444-4444-4444-4444-444444444444",
      eventType: "PASSWORD_CHANGED",
      severity: "high",
      ipAddress: "10.0.0.9",
      userAgent: "ua",
      createdAt: new Date("2026-06-04T10:00:00.000Z"),
      userId: U1,
      identityInScope: true,
      userEmail: "u1@a.test",
      userFullName: "User One",
      actorUserId: U2,
      actorIdentityInScope: true,
      actorEmail: "u2@a.test",
      actorFullName: "Admin Two",
    };
    const svc = makeService([], [row]);
    const { data } = await svc.listSecurityEvents(ACTOR, baseSecQuery);
    expect(data[0]).toEqual({
      id: row.id,
      user: { id: U1, email: "u1@a.test", display_name: "User One" },
      event_type: "PASSWORD_CHANGED",
      severity: "high",
      actor: { id: U2, email: "u2@a.test", display_name: "Admin Two" },
      ip_address: "10.0.0.9",
      user_agent: "ua",
      created_at: "2026-06-04T10:00:00.000Z",
    });
    expect(Object.keys(data[0])).not.toContain("payload");
  });

  it("actor = null khi actor_user_id NULL (hệ thống tự sinh)", async () => {
    const row: SecurityEventRow = {
      id: "55555555-5555-5555-5555-555555555555",
      eventType: "USER_LOCKED",
      severity: "critical",
      ipAddress: null,
      userAgent: null,
      createdAt: new Date("2026-06-05T00:00:00.000Z"),
      userId: U1,
      identityInScope: true,
      userEmail: "u1@a.test",
      userFullName: null,
      actorUserId: null,
      actorIdentityInScope: true,
      actorEmail: null,
      actorFullName: null,
    };
    const svc = makeService([], [row]);
    const { data } = await svc.listSecurityEvents(ACTOR, baseSecQuery);
    expect(data[0].actor).toBeNull();
    expect(data[0].user).toMatchObject({ id: U1, display_name: null });
  });
});

/**
 * S10-SEC-AUDITLOGROW-1 (KI-070) — nhánh fail-closed của vị từ chặn TẬP HÀNG.
 *
 * VÌ SAO Ở TẦNG UNIT: nhánh này chỉ chạy khi guard cho qua NHƯNG `resolveStrongestScope` trả `null`
 * — một BẤT ĐỒNG giữa hai tầng (hình dạng thật: cửa sổ cache 300s của guard sau khi role vừa bị gỡ,
 * vì `getCompanyRoleGrantsWithScope` cố ý KHÔNG cache). Không int-spec nào dựng lại được trạng thái
 * đó mà không phải giả lập chính cache, nên nếu không có ca ở đây thì nhánh 403 là code CHƯA TỪNG
 * CHẠY — đúng thứ WO này tồn tại để chống ("mô tả phạm vi mà không có gì ép nó").
 */
describe("AuthLogsViewerService — fail-closed khi scope cặp gate không phân giải được (KI-070)", () => {
  it("listLoginLogs: view:audit-log → null ⇒ NÉM ForbiddenException, KHÔNG trả 0 hàng lặng lẽ", async () => {
    const svc = makeService([], [], "Company", null);
    await expect(svc.listLoginLogs(ACTOR, baseLoginQuery)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("listSecurityEvents: view:audit-log → null ⇒ NÉM ForbiddenException", async () => {
    const svc = makeService([], [], "Company", null);
    await expect(svc.listSecurityEvents(ACTOR, baseSecQuery)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("message GIỮ NGUYÊN VĂN của resolveAndAssert — 403 này không được phân biệt với 403 của guard", async () => {
    const svc = makeService([], [], "Company", null);
    // Ca ĐỐI KHÁNG, không phải ca trang trí: nếu ai đó "làm rõ" thông điệp thành
    // "scope resolution failed" thì response trở thành oracle — client phân biệt được "thiếu cặp
    // quyền" với "có cặp quyền nhưng scope hỏng". Chuỗi phải khớp `data-scope.service.resolveAndAssert`.
    await expect(svc.listLoginLogs(ACTOR, baseLoginQuery)).rejects.toThrow(
      "AUTH-ERR-FORBIDDEN: out of permission scope",
    );
  });

  it("ĐỐI CHỨNG ALLOW — cặp gate có scope thì hai route KHÔNG ném (nhánh 403 không bắt oan)", async () => {
    const svc = makeService([], [], "Company", "Own");
    await expect(svc.listLoginLogs(ACTOR, baseLoginQuery)).resolves.toMatchObject({ total: 0 });
    await expect(svc.listSecurityEvents(ACTOR, baseSecQuery)).resolves.toMatchObject({ total: 0 });
  });

  it("thiếu cặp DANH BẠ (view:user → null) KHÔNG được biến thành 403 — chỉ bỏ cột danh tính", async () => {
    // Hai luật fail-closed NGƯỢC nhau ở hai cặp; gộp chúng là siết quá tay và làm mất một quyền
    // đang có (khuôn N-1c). Đây là ca chống chính bản vá này siết nhầm.
    const svc = makeService([], [], null, "Company");
    await expect(svc.listLoginLogs(ACTOR, baseLoginQuery)).resolves.toMatchObject({ total: 0 });
    await expect(svc.listSecurityEvents(ACTOR, baseSecQuery)).resolves.toMatchObject({ total: 0 });
  });
});

describe("auth-log query DTO validation (contract whitelist)", () => {
  it("login-log: default page/per_page + sort/order", () => {
    const q = loginLogListQuerySchema.parse({});
    expect(q).toMatchObject({ page: 1, per_page: 20, sort: "created_at", order: "desc" });
  });

  it("login-log: status ngoài enum → reject", () => {
    expect(loginLogListQuerySchema.safeParse({ status: "bogus" }).success).toBe(false);
  });

  it("login-log: per_page vượt trần (>100) → reject", () => {
    expect(loginLogListQuerySchema.safeParse({ per_page: 9999 }).success).toBe(false);
  });

  it("login-log: from_date > to_date → reject (refine)", () => {
    const r = loginLogListQuerySchema.safeParse({
      from_date: "2026-06-10",
      to_date: "2026-06-01",
    });
    expect(r.success).toBe(false);
  });

  it("login-log: sort ngoài allowlist → reject (chống injection)", () => {
    expect(loginLogListQuerySchema.safeParse({ sort: "created_at; DROP TABLE" }).success).toBe(
      false,
    );
  });

  it("security-event: severity ngoài enum → reject; event_type tự do hợp lệ", () => {
    expect(securityEventListQuerySchema.safeParse({ severity: "boom" }).success).toBe(false);
    expect(securityEventListQuerySchema.safeParse({ event_type: "ROLE_ASSIGNED" }).success).toBe(
      true,
    );
  });
});
