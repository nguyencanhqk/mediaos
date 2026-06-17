import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { ForbiddenException } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../../src/db/db.service";
import { AuditService } from "../../src/events/audit.service";
import { OutboxService } from "../../src/events/outbox.service";
import { PermissionService } from "../../src/permission/permission.service";
import { PermissionRepository } from "../../src/permission/permission.repository";
import { KpiService } from "../../src/kpi/kpi.service";
import { KpiRepository } from "../../src/kpi/kpi.repository";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedPermissionCatalog,
  seedRole,
  seedRolePermission,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

/**
 * KPI-DATA-WIRING — GET /kpi/results (lịch sử KPI). Crown-jewel: kpi_results APPEND-ONLY (bất biến #2),
 * permission read:kpi, RLS tenant isolation (bất biến #1). Postgres THẬT (CI; local: lane DB mediaos_kpiwire).
 *
 * Chốt fail-closed kiểm ở đây:
 *  (a) DENY    — caller KHÔNG có read:kpi → ForbiddenException (KHÔNG trả dữ liệu).
 *  (b) SHAPE   — trả KpiResultDto (components LỒNG NHAU + số + ISO), KHÔNG phải row thô (string numeric).
 *  (c) TENANT  — listResults(A) KHÔNG bao giờ thấy kết quả tenant B (RLS qua withTenant).
 *  (d) SCOPE   — employee thường CHỈ thấy KPI của-mình/team mình; KHÔNG lộ KPI người khác dù gửi
 *                subjectUserId người khác (server BỎ QUA filter chủ thể với scope hẹp).
 *  (e) BROAD   — confirm:kpi HOẶC manage:kpi-definition → xem mọi chủ thể.
 *  (f) FILTER  — definitionId / confirmedOnly / period / limit + order created_at DESC.
 *  (g) COMPUTE/CONFIRM SHAPE — sau retrofit, compute & confirm cũng trả KpiResultDto đúng hợp đồng.
 */
describe.skipIf(!hasDb)("KPI GET /kpi/results (deny + shape + tenant + scope + filter)", () => {
  const direct = directPool();
  const app = appPool(2);
  let A: SeededTenant;
  let B: SeededTenant;

  // Company A actors
  let noPermA: string; // không có read:kpi → deny
  let employeeA: string; // read:kpi → scope của-mình
  let otherA: string; // chủ thể khác (employeeA KHÔNG được thấy)
  let confirmerA: string; // confirm:kpi (+read:kpi) → broad
  let managerA: string; // manage:kpi-definition (+read:kpi) → broad
  let teamA: string;

  // Company A definitions
  let d1: string;
  let d2: string;

  // Seeded results (company A)
  let rEmpApr: string;
  let rEmpMay: string;
  let rEmpConfirmed: string;
  let rOther: string;
  let rTeam: string;
  let rB: string; // company B

  let svc: KpiService;

  const validWeights = {
    tasksDone: 20,
    onTimeRate: 20,
    evaluationScore: 20,
    defectScore: 20,
    firstPassApprovalRate: 20,
  };

  async function seedDefinition(t: SeededTenant): Promise<string> {
    const r = await direct.query(
      `INSERT INTO kpi_definitions (company_id, name, weights)
       VALUES ($1, $2, $3::jsonb) RETURNING id`,
      [t.companyId, `kpi-def-${randomUUID().slice(0, 8)}`, JSON.stringify(validWeights)],
    );
    return r.rows[0].id as string;
  }

  async function seedTeam(companyId: string): Promise<string> {
    const r = await direct.query(
      `INSERT INTO teams (company_id, name) VALUES ($1, $2) RETURNING id`,
      [companyId, `team-${randomUUID().slice(0, 8)}`],
    );
    return r.rows[0].id as string;
  }

  async function addTeamMember(companyId: string, teamId: string, userId: string): Promise<void> {
    await direct.query(
      `INSERT INTO team_members (company_id, team_id, user_id) VALUES ($1, $2, $3)`,
      [companyId, teamId, userId],
    );
  }

  interface SeedResultOpts {
    companyId: string;
    definitionId: string;
    subjectUserId?: string | null;
    subjectTeamId?: string | null;
    periodStart: string;
    periodEnd: string;
    totalScore: number;
    computedBy: string;
    confirmedBy?: string | null;
    confirmedAt?: string | null;
    createdAt: string;
  }

  async function seedResult(o: SeedResultOpts): Promise<string> {
    const r = await direct.query(
      `INSERT INTO kpi_results
         (company_id, definition_id, subject_user_id, subject_team_id, period_start, period_end,
          tasks_done, on_time_rate, evaluation_score, defect_score, first_pass_approval_rate,
          total_score, confirmed_by, confirmed_at, computed_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6, 100,100,80,100,75, $7,$8,$9,$10,$11) RETURNING id`,
      [
        o.companyId,
        o.definitionId,
        o.subjectUserId ?? null,
        o.subjectTeamId ?? null,
        o.periodStart,
        o.periodEnd,
        o.totalScore,
        o.confirmedBy ?? null,
        o.confirmedAt ?? null,
        o.computedBy,
        o.createdAt,
      ],
    );
    return r.rows[0].id as string;
  }

  beforeAll(async () => {
    A = await seedCompany(direct, "kpiwA");
    B = await seedCompany(direct, "kpiwB");

    const readPerm = await seedPermissionCatalog(direct, "read", "kpi", false);
    const confirmPerm = await seedPermissionCatalog(direct, "confirm", "kpi", false);
    const managePerm = await seedPermissionCatalog(direct, "manage", "kpi-definition", false);

    // noPermA: user A KHÔNG có read:kpi.
    noPermA = await seedUser(direct, A.companyId, `kpiw-noperm-${randomUUID().slice(0, 8)}@a.test`);

    // employeeA: role read:kpi only.
    const empRole = await seedRole(direct, A.companyId, `kpiw-emp-${randomUUID().slice(0, 8)}`);
    await seedRolePermission(direct, empRole, readPerm, "ALLOW");
    employeeA = await seedUser(direct, A.companyId, `kpiw-emp-${randomUUID().slice(0, 8)}@a.test`);
    await seedUserRole(direct, employeeA, empRole, A.companyId);

    // confirmerA: role confirm:kpi + read:kpi → broad.
    const confRole = await seedRole(direct, A.companyId, `kpiw-conf-${randomUUID().slice(0, 8)}`);
    await seedRolePermission(direct, confRole, confirmPerm, "ALLOW");
    await seedRolePermission(direct, confRole, readPerm, "ALLOW");
    confirmerA = await seedUser(direct, A.companyId, `kpiw-conf-${randomUUID().slice(0, 8)}@a.test`);
    await seedUserRole(direct, confirmerA, confRole, A.companyId);

    // managerA: role manage:kpi-definition + read:kpi → broad (path manage).
    const mgrRole = await seedRole(direct, A.companyId, `kpiw-mgr-${randomUUID().slice(0, 8)}`);
    await seedRolePermission(direct, mgrRole, managePerm, "ALLOW");
    await seedRolePermission(direct, mgrRole, readPerm, "ALLOW");
    managerA = await seedUser(direct, A.companyId, `kpiw-mgr-${randomUUID().slice(0, 8)}@a.test`);
    await seedUserRole(direct, managerA, mgrRole, A.companyId);

    // otherA: chủ thể khác (không cần quyền).
    otherA = await seedUser(direct, A.companyId, `kpiw-other-${randomUUID().slice(0, 8)}@a.test`);

    teamA = await seedTeam(A.companyId);
    await addTeamMember(A.companyId, teamA, employeeA);

    d1 = await seedDefinition(A);
    d2 = await seedDefinition(A);

    // created_at tăng dần → DESC: rTeam > rEmpConfirmed > rEmpMay > rOther > rEmpApr
    rEmpApr = await seedResult({
      companyId: A.companyId,
      definitionId: d1,
      subjectUserId: employeeA,
      periodStart: "2026-04-01T00:00:00.000Z",
      periodEnd: "2026-05-01T00:00:00.000Z",
      totalScore: 70,
      computedBy: managerA,
      createdAt: "2026-06-10T00:00:00.000Z",
    });
    rOther = await seedResult({
      companyId: A.companyId,
      definitionId: d1,
      subjectUserId: otherA,
      periodStart: "2026-05-01T00:00:00.000Z",
      periodEnd: "2026-06-01T00:00:00.000Z",
      totalScore: 60,
      computedBy: managerA,
      createdAt: "2026-06-11T00:00:00.000Z",
    });
    rEmpMay = await seedResult({
      companyId: A.companyId,
      definitionId: d1,
      subjectUserId: employeeA,
      periodStart: "2026-05-01T00:00:00.000Z",
      periodEnd: "2026-06-01T00:00:00.000Z",
      totalScore: 80,
      computedBy: managerA,
      createdAt: "2026-06-12T00:00:00.000Z",
    });
    rEmpConfirmed = await seedResult({
      companyId: A.companyId,
      definitionId: d1,
      subjectUserId: employeeA,
      periodStart: "2026-06-01T00:00:00.000Z",
      periodEnd: "2026-07-01T00:00:00.000Z",
      totalScore: 90,
      computedBy: managerA,
      confirmedBy: managerA,
      confirmedAt: "2026-06-13T01:00:00.000Z",
      createdAt: "2026-06-13T00:00:00.000Z",
    });
    rTeam = await seedResult({
      companyId: A.companyId,
      definitionId: d2,
      subjectTeamId: teamA,
      periodStart: "2026-05-01T00:00:00.000Z",
      periodEnd: "2026-06-01T00:00:00.000Z",
      totalScore: 75,
      computedBy: managerA,
      createdAt: "2026-06-14T00:00:00.000Z",
    });

    // Company B — tenant isolation fixture.
    const dB = await seedDefinition(B);
    const userB = await seedUser(direct, B.companyId, `kpiw-b-${randomUUID().slice(0, 8)}@b.test`);
    rB = await seedResult({
      companyId: B.companyId,
      definitionId: dB,
      subjectUserId: userB,
      periodStart: "2026-05-01T00:00:00.000Z",
      periodEnd: "2026-06-01T00:00:00.000Z",
      totalScore: 88,
      computedBy: userB,
      createdAt: "2026-06-12T00:00:00.000Z",
    });

    const db = new DatabaseService();
    svc = new KpiService(
      db,
      new KpiRepository(db),
      new PermissionService(new PermissionRepository(db)),
      new AuditService(),
      new OutboxService(),
    );
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId, B.companyId]);
    await direct.end();
    await app.end();
  });

  // ── (a) DENY — không read:kpi → Forbidden ────────────────────────────────────
  describe("(a) permission deny (fail-closed)", () => {
    it("caller KHÔNG có read:kpi → ForbiddenException (không trả dữ liệu)", async () => {
      await expect(
        svc.listResults(A.companyId, noPermA, { limit: 50 }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  // ── (b) SHAPE — KpiResultDto đúng hợp đồng ───────────────────────────────────
  describe("(b) DTO shape (components lồng nhau + số + ISO)", () => {
    it("trả KpiResultDto: components nested, totalScore số, period/created ISO string", async () => {
      const rows = await svc.listResults(A.companyId, confirmerA, { limit: 50 });
      const row = rows.find((r) => r.id === rEmpMay);
      expect(row).toBeDefined();
      if (!row) return;
      expect(typeof row.totalScore).toBe("number");
      expect(row.totalScore).toBe(80);
      expect(typeof row.components.tasksDone).toBe("number");
      expect(row.components.tasksDone).toBe(100);
      expect(typeof row.periodStart).toBe("string");
      expect(Number.isNaN(Date.parse(row.periodStart))).toBe(false);
      expect(typeof row.createdAt).toBe("string");
      // KHÔNG rò field thô (numeric-string phẳng) — chứng minh đã map qua DTO.
      expect((row as unknown as Record<string, unknown>).tasks_done).toBeUndefined();
      expect((row as unknown as Record<string, unknown>).tasksDone).toBeUndefined();
    });
  });

  // ── (c) TENANT isolation ─────────────────────────────────────────────────────
  describe("(c) tenant isolation (RLS qua withTenant)", () => {
    it("listResults(A) KHÔNG chứa kết quả tenant B", async () => {
      const rows = await svc.listResults(A.companyId, confirmerA, { limit: 200 });
      const ids = new Set(rows.map((r) => r.id));
      expect(ids.has(rB)).toBe(false);
      expect(rows.every((r) => r.companyId === A.companyId)).toBe(true);
    });
  });

  // ── (d) SCOPE — employee thường chỉ của-mình/team mình ───────────────────────
  describe("(d) scope hẹp (employee thường)", () => {
    it("employee read:kpi: thấy KPI của-mình + team mình, KHÔNG thấy người khác", async () => {
      const rows = await svc.listResults(A.companyId, employeeA, { limit: 200 });
      const ids = new Set(rows.map((r) => r.id));
      expect(ids.has(rEmpMay)).toBe(true);
      expect(ids.has(rEmpApr)).toBe(true);
      expect(ids.has(rTeam)).toBe(true); // team mình thuộc về
      expect(ids.has(rOther)).toBe(false); // KPI người khác — KHÔNG lộ
      expect(
        rows.every((r) => r.subjectUserId === employeeA || r.subjectTeamId === teamA),
      ).toBe(true);
    });

    it("employee gửi subjectUserId người khác → server BỎ QUA (vẫn không lộ)", async () => {
      const rows = await svc.listResults(A.companyId, employeeA, {
        limit: 200,
        subjectUserId: otherA,
      });
      const ids = new Set(rows.map((r) => r.id));
      expect(ids.has(rOther)).toBe(false);
      expect(rows.some((r) => r.id === rEmpMay)).toBe(true);
    });

    it("employee đã RỜI team (membership soft-deleted) → KHÔNG còn thấy KPI team đó", async () => {
      const goneTeam = await seedTeam(A.companyId);
      // Membership đã soft-delete (deleted_at set) — user không còn thuộc team.
      await direct.query(
        `INSERT INTO team_members (company_id, team_id, user_id, deleted_at)
         VALUES ($1, $2, $3, now())`,
        [A.companyId, goneTeam, employeeA],
      );
      // created_at CŨ (trước mọi result khác) → không xáo trộn test order/limit chạy sau.
      const rGone = await seedResult({
        companyId: A.companyId,
        definitionId: d2,
        subjectTeamId: goneTeam,
        periodStart: "2026-05-01T00:00:00.000Z",
        periodEnd: "2026-06-01T00:00:00.000Z",
        totalScore: 50,
        computedBy: managerA,
        createdAt: "2026-06-09T00:00:00.000Z",
      });
      const rows = await svc.listResults(A.companyId, employeeA, { limit: 200 });
      const ids = new Set(rows.map((r) => r.id));
      expect(ids.has(rGone)).toBe(false); // team đã rời → không lộ
      expect(ids.has(rTeam)).toBe(true); // team hiện tại vẫn thấy
    });
  });

  // ── (e) BROAD — confirm:kpi / manage:kpi-definition xem mọi chủ thể ──────────
  describe("(e) scope rộng (HR/quản lý)", () => {
    it("confirm:kpi → thấy KPI của chủ thể khác (rOther)", async () => {
      const rows = await svc.listResults(A.companyId, confirmerA, { limit: 200 });
      expect(rows.some((r) => r.id === rOther)).toBe(true);
    });

    it("manage:kpi-definition → cũng broad (thấy rOther)", async () => {
      const rows = await svc.listResults(A.companyId, managerA, { limit: 200 });
      expect(rows.some((r) => r.id === rOther)).toBe(true);
    });

    it("broad có thể lọc theo subjectUserId cụ thể", async () => {
      const rows = await svc.listResults(A.companyId, confirmerA, {
        limit: 200,
        subjectUserId: otherA,
      });
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.subjectUserId === otherA)).toBe(true);
    });
  });

  // ── (f) FILTERS + order ──────────────────────────────────────────────────────
  describe("(f) filters + order created_at DESC", () => {
    it("definitionId lọc đúng (d2 = chỉ rTeam)", async () => {
      const rows = await svc.listResults(A.companyId, confirmerA, { limit: 200, definitionId: d2 });
      expect(rows.every((r) => r.definitionId === d2)).toBe(true);
      expect(rows.some((r) => r.id === rTeam)).toBe(true);
    });

    it("confirmedOnly → chỉ bản đã xác nhận (rEmpConfirmed)", async () => {
      const rows = await svc.listResults(A.companyId, confirmerA, { limit: 200, confirmedOnly: true });
      expect(rows.every((r) => r.confirmedAt !== null)).toBe(true);
      expect(rows.some((r) => r.id === rEmpConfirmed)).toBe(true);
      expect(rows.some((r) => r.id === rEmpMay)).toBe(false);
    });

    it("periodFrom loại kỳ trước (rEmpApr bị loại khi from = 2026-05-01)", async () => {
      const rows = await svc.listResults(A.companyId, confirmerA, {
        limit: 200,
        periodFrom: "2026-05-01T00:00:00.000Z",
      });
      const ids = new Set(rows.map((r) => r.id));
      expect(ids.has(rEmpApr)).toBe(false);
      expect(ids.has(rEmpMay)).toBe(true);
    });

    it("limit + ORDER BY created_at DESC", async () => {
      const rows = await svc.listResults(A.companyId, confirmerA, { limit: 2 });
      expect(rows.length).toBe(2);
      expect(rows[0].id).toBe(rTeam); // created_at mới nhất
      expect(new Date(rows[0].createdAt).getTime()).toBeGreaterThanOrEqual(
        new Date(rows[1].createdAt).getTime(),
      );
    });
  });

  // ── (g) COMPUTE/CONFIRM SHAPE (retrofit) ─────────────────────────────────────
  describe("(g) compute & confirm cũng trả KpiResultDto (retrofit hợp đồng)", () => {
    it("computeKpi trả components nested + totalScore số + ISO string", async () => {
      const result = await svc.computeKpi(A.companyId, confirmerA, {
        definitionId: d1,
        subjectUserId: employeeA,
        periodStart: "2026-05-01T00:00:00.000Z",
        periodEnd: "2026-06-01T00:00:00.000Z",
      });
      expect(typeof result.totalScore).toBe("number");
      expect(typeof result.components.firstPassApprovalRate).toBe("number");
      expect(typeof result.periodStart).toBe("string");
      expect(typeof result.createdAt).toBe("string");
      expect(result.confirmedAt).toBeNull();

      const confirmed = await svc.confirmResult(A.companyId, confirmerA, {
        kpiResultId: result.id,
      });
      expect(confirmed.id).not.toBe(result.id);
      expect(typeof confirmed.totalScore).toBe("number");
      expect(typeof confirmed.confirmedAt).toBe("string");
      expect(confirmed.confirmedBy).toBe(confirmerA);
    });
  });
});
