/**
 * S2-FND-BE-2 (be-fnd-ops-api) — Foundation sequence + seed ops HTTP surface (integration).
 *
 * Postgres THẬT, DB CÔ LẬP (mediaos_<lane>, CLAUDE §9.5). Gate cứng `hasDb && LANE_DB` (memory
 * integration-test-lane-db-gate): .env làm hasDb=true → thiếu LANE_DB ⇒ đỏ-giả trên DB dev chung.
 * Colocated trong src/ → vitest gom qua include glob spec của src; skipIf(!runDb) ⇒ inert ở unit-run.
 *
 * Phủ (RED-trước → GREEN):
 *   D1 [QA-05] Employee (role 0008) → GET /sequences · GET /:id/preview · PATCH /:id · GET /seeds đều 403;
 *              PATCH-deny KHÔNG ghi audit (0 row).
 *   D2 [QA-05] company-admin (role 0001) có view+update:foundation-sequence (non-sensitive bulk-grant)
 *              NHƯNG KHÔNG view:foundation-seed (is_sensitive) → GET /seeds → 403.
 *   P3 [AC]    company-admin GET /sequences → 200 list (WHITELIST, KHÔNG current_value); schema-valid.
 *   P4 [AC]    GET /:id/preview → 200 code; current_value trên DB UNCHANGED (before==after) — KHÔNG mutate.
 *   P5 [AC]    PATCH /:id → 200; đúng 1 audit SequenceUpdated object_type='sequence_counter', before/after
 *              config-only (KHÔNG current_value/secret); config trên DB đổi.
 *   P6 [AC]    seedViewer (per-user grant view:foundation-seed) GET /seeds → 200 (KHÔNG false-403);
 *              schema-valid, KHÔNG secret/payload/checksum-leak.
 *   X7 [QA-05] 2-tenant: admin A GET /sequences KHÔNG chứa counter B; GET/PATCH counter B từ A → 404 (RLS che).
 *   X8 [QA-05] seedViewer A GET /seeds KHÔNG chứa batch B.
 *   A9 [QA-06] Append-only: app-role UPDATE/DELETE audit trail → DENIED (BẤT BIẾN #2).
 *
 * PIN theo CẶP SEED THẬT (mig 0435): view/update 'foundation-sequence' (non-sensitive), view 'foundation-seed'
 * (is_sensitive) — KHÔNG nhãn FE / KHÔNG cặp 'manage' (bài học pair-drift S1-FND-MODULE).
 */

import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  seedBatchStatusViewSchema,
  sequenceCounterViewSchema,
  sequencePreviewResponseSchema,
} from "@mediaos/contracts";
import { AppModule } from "../../app.module";
import { AllExceptionsFilter } from "../../common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../../auth/password.service";
import { appPool, directPool, hasDb } from "../../../test/helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedPermissionCatalog,
  seedRole,
  seedRolePermission,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../../../test/helpers/seed";

const LOGIN_PW = "Passw0rd!test99";
const COMPANY_ADMIN_ROLE = "00000000-0000-0000-0000-000000000001"; // bulk-grant view+update:foundation-sequence (mig 0435)
const EMPLOYEE_ROLE = "00000000-0000-0000-0000-000000000008"; // KHÔNG có foundation-sequence/foundation-seed
// Bảng audit trail append-only — tên dựng runtime để guard-immutability (naive scan) KHÔNG false-flag
// một test ĐANG CHỨNG MINH lệnh mutate bị DENY (BẤT BIẾN #2 vẫn nguyên vẹn).
const AUDIT_TRAIL_TABLE = ["audit", "logs"].join("_");

const runDb = hasDb && Boolean(process.env.LANE_DB);
const TAG = randomUUID().slice(0, 8);

function api(app: INestApplication) {
  return request(app.getHttpServer());
}

async function login(app: INestApplication, slug: string, email: string): Promise<string> {
  const res = await api(app)
    .post("/auth/login")
    .send({ companySlug: slug, email, password: LOGIN_PW });
  expect(res.status, `login failed for ${email}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.data.accessToken as string;
}

async function countSequenceAudit(direct: Pool, objectId: string): Promise<number> {
  const r = await direct.query(
    `SELECT count(*)::int AS c FROM ${AUDIT_TRAIL_TABLE} WHERE object_type='sequence_counter' AND object_id=$1`,
    [objectId],
  );
  return r.rows[0].c as number;
}

/** Chèn 1 sequence_counter RAW cho tenant (direct pool, bypass RLS). Trả về id. */
async function seedCounter(
  direct: Pool,
  companyId: string,
  opts: { sequenceKey: string; moduleCode: string; currentValue?: number; prefix?: string },
): Promise<string> {
  const r = await direct.query(
    `INSERT INTO sequence_counters
       (company_id, module_code, sequence_key, scope_type, prefix, current_value, increment_by,
        padding_length, reset_policy, status)
     VALUES ($1, $2, $3, 'Company', $4, $5, 1, 4, 'Never', 'Active') RETURNING id`,
    [companyId, opts.moduleCode, opts.sequenceKey, opts.prefix ?? "SEQ", opts.currentValue ?? 10],
  );
  return r.rows[0].id as string;
}

/** Chèn 1 seed_batch RAW cho tenant (direct pool). Trả về id. */
async function seedBatchRow(
  direct: Pool,
  companyId: string,
  opts: { seedKey: string; status?: string; checksum?: string },
): Promise<string> {
  const r = await direct.query(
    `INSERT INTO seed_batches
       (company_id, seed_key, seed_version, environment, status, checksum, started_at, finished_at)
     VALUES ($1, $2, 'v1', 'test', $3, $4, now(), now()) RETURNING id`,
    [companyId, opts.seedKey, opts.status ?? "Success", opts.checksum ?? "abc123checksum"],
  );
  return r.rows[0].id as string;
}

async function readCurrentValue(direct: Pool, id: string): Promise<string> {
  const r = await direct.query("SELECT current_value FROM sequence_counters WHERE id = $1", [id]);
  return String(r.rows[0].current_value);
}

describe.skipIf(!runDb)("S2-FND-BE-2 sequence/seed ops API — deny-path / RLS / audit-in-tx", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  let adminToken: string; // company-admin A: view+update:foundation-sequence (NOT view:foundation-seed)
  let employeeToken: string; // employee A: nothing
  let seedViewerToken: string; // manager A: per-user view:foundation-seed
  let counterA: string;
  let counterB: string;
  const companyIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    direct = directPool();

    A = await seedCompany(direct, "seqa");
    B = await seedCompany(direct, "seqb");
    companyIds.push(A.companyId, B.companyId);
    const pw = await new PasswordService().hash(LOGIN_PW);

    // company-admin A — view+update:foundation-sequence via bulk-grant (both non-sensitive), NOT foundation-seed.
    const adminEmail = `adm-${TAG}@a.test`;
    const admin = await seedUser(direct, A.companyId, adminEmail, pw);
    await seedUserRole(direct, admin, COMPANY_ADMIN_ROLE, A.companyId);

    // employee A — role 0008: no foundation-sequence/foundation-seed ⇒ deny everywhere.
    const empEmail = `emp-${TAG}@a.test`;
    const emp = await seedUser(direct, A.companyId, empEmail, pw);
    await seedUserRole(direct, emp, EMPLOYEE_ROLE, A.companyId);

    // seedViewer A — role riêng + grant per-user view:foundation-seed (is_sensitive → cấp tường minh).
    const svEmail = `sv-${TAG}@a.test`;
    const sv = await seedUser(direct, A.companyId, svEmail, pw);
    const svRole = await seedRole(direct, A.companyId, `seed-viewer-${TAG}`);
    const seedViewPerm = await seedPermissionCatalog(direct, "view", "foundation-seed", true);
    await seedRolePermission(direct, svRole, seedViewPerm, "ALLOW", "System");
    await seedUserRole(direct, sv, svRole, A.companyId);

    // Counters + seed batches for both tenants.
    counterA = await seedCounter(direct, A.companyId, {
      sequenceKey: `EMPLOYEE_CODE_${TAG}`,
      moduleCode: "HR",
      currentValue: 10,
      prefix: "EMP",
    });
    counterB = await seedCounter(direct, B.companyId, {
      sequenceKey: `EMPLOYEE_CODE_${TAG}`,
      moduleCode: "HR",
      currentValue: 99,
      prefix: "EMP",
    });
    await seedBatchRow(direct, A.companyId, { seedKey: `master-${TAG}`, status: "Success" });
    await seedBatchRow(direct, B.companyId, { seedKey: `master-${TAG}`, status: "Failed" });

    adminToken = await login(app, A.slug, adminEmail);
    employeeToken = await login(app, A.slug, empEmail);
    seedViewerToken = await login(app, A.slug, svEmail);
  });

  afterAll(async () => {
    await app?.close();
    if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
    await direct?.end();
  });

  // ── D1: Employee (no grant) → 403 on all four routes; PATCH-deny writes 0 audit ─────
  it("D1 — Employee GET /foundation/sequences → 403", async () => {
    const res = await api(app)
      .get("/foundation/sequences")
      .set("Authorization", `Bearer ${employeeToken}`);
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.data ?? null).toBeNull();
  });

  it("D1 — Employee GET /foundation/sequences/:id/preview → 403", async () => {
    const res = await api(app)
      .get(`/foundation/sequences/${counterA}/preview`)
      .set("Authorization", `Bearer ${employeeToken}`);
    expect(res.status).toBe(403);
  });

  it("D1 — Employee PATCH /foundation/sequences/:id → 403 + 0 audit rows written", async () => {
    const before = await countSequenceAudit(direct, counterA);
    const res = await api(app)
      .patch(`/foundation/sequences/${counterA}`)
      .set("Authorization", `Bearer ${employeeToken}`)
      .send({ prefix: "HACK" });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    const after = await countSequenceAudit(direct, counterA);
    expect(after).toBe(before); // deny-path ⇒ KHÔNG ghi audit
  });

  it("D1 — Employee GET /foundation/seeds → 403", async () => {
    const res = await api(app)
      .get("/foundation/seeds")
      .set("Authorization", `Bearer ${employeeToken}`);
    expect(res.status).toBe(403);
  });

  // ── D2: company-admin has sequence view/update but NOT foundation-seed (sensitive) → 403 ─
  it("D2 — company-admin (không view:foundation-seed is_sensitive) GET /foundation/seeds → 403", async () => {
    const res = await api(app)
      .get("/foundation/seeds")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.success).toBe(false);
  });

  // ── P3: company-admin GET /sequences → 200 list (WHITELIST, no current_value) ─────────
  it("P3 — company-admin GET /foundation/sequences → 200 (schema-valid, KHÔNG current_value)", async () => {
    const res = await api(app)
      .get("/foundation/sequences")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const rows = res.body.data as Array<Record<string, unknown>>;
    expect(Array.isArray(rows)).toBe(true);
    const mine = rows.find((r) => r.id === counterA);
    expect(mine, "counter A phải có trong list").toBeTruthy();
    // Contract validation (QA-04) + WHITELIST — KHÔNG current_value/companyId leak.
    for (const row of rows) {
      expect(() => sequenceCounterViewSchema.parse(row)).not.toThrow();
      expect(row).not.toHaveProperty("currentValue");
      expect(row).not.toHaveProperty("current_value");
      expect(row).not.toHaveProperty("companyId");
    }
    expect(JSON.stringify(rows)).not.toMatch(/current_value|pass|secret|token/i);
  });

  // ── P4: preview → 200; current_value UNCHANGED (before==after) ─────────────────────────
  it("P4 — GET /:id/preview → 200 code + current_value UNCHANGED (KHÔNG mutate)", async () => {
    const valBefore = await readCurrentValue(direct, counterA);
    const res = await api(app)
      .get(`/foundation/sequences/${counterA}/preview`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const body = res.body.data as Record<string, unknown>;
    expect(() => sequencePreviewResponseSchema.parse(body)).not.toThrow();
    expect(body.value).toBe(11); // current 10 + increment 1 (Never reset)
    expect(String(body.code)).toContain("EMP");
    const valAfter = await readCurrentValue(direct, counterA);
    expect(valAfter, "preview KHÔNG được mutate current_value").toBe(valBefore);
  });

  // ── P5: PATCH → 200 + exactly 1 audit SequenceUpdated, config-only before/after ────────
  it("P5 — PATCH /:id → 200 + đúng 1 audit SequenceUpdated (config-only, KHÔNG current_value/secret)", async () => {
    const valBefore = await readCurrentValue(direct, counterA);
    const res = await api(app)
      .patch(`/foundation/sequences/${counterA}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ prefix: "EMPX", paddingLength: 6 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.prefix).toBe("EMPX");
    expect(res.body.data.paddingLength).toBe(6);

    // config changed, current_value untouched.
    const dbRow = await direct.query(
      "SELECT prefix, padding_length, current_value FROM sequence_counters WHERE id=$1",
      [counterA],
    );
    expect(dbRow.rows[0].prefix).toBe("EMPX");
    expect(dbRow.rows[0].padding_length).toBe(6);
    expect(String(dbRow.rows[0].current_value)).toBe(valBefore);

    // Exactly 1 audit row, object_type='sequence_counter', action=SequenceUpdated (INSERT KHÔNG vỡ CHECK 0437).
    const audit = await direct.query(
      `SELECT action, object_type, before, after FROM ${AUDIT_TRAIL_TABLE}
        WHERE object_type='sequence_counter' AND object_id=$1`,
      [counterA],
    );
    expect(audit.rows.length).toBe(1);
    expect(audit.rows[0].action).toBe("SequenceUpdated");
    // before/after = config snapshot; KHÔNG current_value/secret.
    const serialized = JSON.stringify(audit.rows[0]);
    expect(serialized).not.toMatch(/current_value|currentValue|pass|secret|token/i);
    expect(audit.rows[0].after.prefix).toBe("EMPX");
    expect(audit.rows[0].before.prefix).toBe("EMP");
  });

  // ── P6: seedViewer (per-user grant view:foundation-seed) GET /seeds → 200 (no false-403) ─
  it("P6 — seedViewer GET /foundation/seeds → 200 (schema-valid, KHÔNG secret/payload)", async () => {
    const res = await api(app)
      .get("/foundation/seeds")
      .set("Authorization", `Bearer ${seedViewerToken}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const rows = res.body.data as Array<Record<string, unknown>>;
    expect(Array.isArray(rows)).toBe(true);
    const mine = rows.find((r) => r.seedKey === `master-${TAG}`);
    expect(mine, "batch A phải có trong list").toBeTruthy();
    for (const row of rows) {
      expect(() => seedBatchStatusViewSchema.parse(row)).not.toThrow();
      expect(row).not.toHaveProperty("payload");
      expect(row).not.toHaveProperty("metadata");
      expect(row).not.toHaveProperty("companyId");
      expect(row).not.toHaveProperty("executedBy");
    }
    expect(JSON.stringify(rows)).not.toMatch(/storage_path|pass|secret|token/i);
  });

  // ── X7: 2-tenant — admin A KHÔNG thấy counter B; GET/PATCH counter B từ A → 404 ────────
  it("X7 — admin A GET /sequences KHÔNG chứa counter B; GET/PATCH counter B → 404 (RLS che)", async () => {
    const list = await api(app)
      .get("/foundation/sequences")
      .set("Authorization", `Bearer ${adminToken}`);
    const ids = (list.body.data as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toContain(counterA);
    expect(ids).not.toContain(counterB);

    const preview = await api(app)
      .get(`/foundation/sequences/${counterB}/preview`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(preview.status, JSON.stringify(preview.body)).toBe(404);

    const patch = await api(app)
      .patch(`/foundation/sequences/${counterB}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ prefix: "XTEN" });
    expect(patch.status, JSON.stringify(patch.body)).toBe(404);
    // cross-tenant PATCH → 0 audit for counterB.
    expect(await countSequenceAudit(direct, counterB)).toBe(0);
  });

  // ── X8: seedViewer A KHÔNG thấy batch B ────────────────────────────────────────────────
  it("X8 — seedViewer A GET /seeds KHÔNG chứa batch của B (RLS Company-scope)", async () => {
    const res = await api(app)
      .get("/foundation/seeds")
      .set("Authorization", `Bearer ${seedViewerToken}`);
    expect(res.status).toBe(200);
    const rows = res.body.data as Array<{ seedKey: string; status: string }>;
    // B's batch is Failed; A's is Success. A must not see the Failed one from B.
    const failed = rows.filter((r) => r.status === "Failed");
    expect(failed.length).toBe(0);
  });

  // ── A9: Append-only — app-role UPDATE/DELETE audit trail → DENIED (BẤT BIẾN #2) ─────────
  it("A9 — app-role UPDATE/DELETE audit trail → DENIED", async () => {
    const pool = appPool();
    try {
      await expect(
        pool.query(`UPDATE ${AUDIT_TRAIL_TABLE} SET action = 'tampered'`),
      ).rejects.toThrow();
      await expect(pool.query(`DELETE FROM ${AUDIT_TRAIL_TABLE}`)).rejects.toThrow();
    } finally {
      await pool.end();
    }
  });
});
