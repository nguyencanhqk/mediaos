/**
 * S2-AUTH-BE-5 (L2-BE-API) — UNIT (no-DB) cho AuthLogsViewerService mapping + DTO query validation.
 * Chạy trong unit-run mặc định (KHÔNG cần Postgres) → phủ coverage vùng nhạy cảm + chứng minh BẤT BIẾN #3
 * ở tầng map: metadata/payload KHÔNG BAO GIỜ xuất hiện trong DTO (repo không select → service không map).
 */
import { describe, expect, it } from "vitest";
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

function makeService(loginRows: LoginLogRow[], secRows: SecurityEventRow[]): AuthLogsViewerService {
  const loginRepo = {
    findManyTx: async () => loginRows,
    countTx: async () => loginRows.length,
  };
  const secRepo = {
    findManyTx: async () => secRows,
    countTx: async () => secRows.length,
  };
  return new AuthLogsViewerService(stubDb() as never, loginRepo as never, secRepo as never);
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
      userEmail: "u1@a.test",
      userFullName: "User One",
    };
    const svc = makeService([row], []);
    const { data, total } = await svc.listLoginLogs(COMPANY, baseLoginQuery);
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
        userEmail: null, // user bị soft-delete → leftJoin trả null
        userFullName: null,
      },
    ];
    const svc = makeService(rows, []);
    const { data } = await svc.listLoginLogs(COMPANY, baseLoginQuery);
    expect(data[0].user).toBeNull();
    expect(data[1].user).toBeNull();
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
      userEmail: "u1@a.test",
      userFullName: "User One",
      actorUserId: U2,
      actorEmail: "u2@a.test",
      actorFullName: "Admin Two",
    };
    const svc = makeService([], [row]);
    const { data } = await svc.listSecurityEvents(COMPANY, baseSecQuery);
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
      userEmail: "u1@a.test",
      userFullName: null,
      actorUserId: null,
      actorEmail: null,
      actorFullName: null,
    };
    const svc = makeService([], [row]);
    const { data } = await svc.listSecurityEvents(COMPANY, baseSecQuery);
    expect(data[0].actor).toBeNull();
    expect(data[0].user).toMatchObject({ id: U1, display_name: null });
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
