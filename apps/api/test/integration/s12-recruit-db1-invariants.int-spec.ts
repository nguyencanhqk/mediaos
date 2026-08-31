import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DASH_CANONICAL_ROLES } from "../../src/dashboard/dashboard-widget-catalog.const";
import { NOTI_CANONICAL_ROLES } from "../../src/foundation/seed/notification-event-catalog.const";
import { appPool, directPool, hasDb, workerPool } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

/**
 * S12-RECRUIT-DB-1 (mig 0559 · 0560 · 0561) — CHỐT HỒI QUY cho nền dữ liệu RECRUIT (DB-14 §6/§9 ·
 * SPEC-12 §11/§17/§18 · permission-matrix §9f).
 *
 * VÌ SAO FILE NÀY TỒN TẠI. Migration tự verify bằng khối DO/RAISE EXCEPTION, nhưng verify đó chỉ chạy ĐÚNG
 * MỘT LẦN lúc migrate. Sau khi merge, một WO sau `GRANT UPDATE ON candidate_stage_events`, `GRANT DELETE ON
 * candidates`, bỏ predicate `Draft/Sent` khỏi uq_offers_candidate_open, hay grant `convert:candidate` cho
 * employee — KHÔNG có gì đỏ: tenant-isolation/rls-registry không phủ column-GRANT/partial-unique,
 * xtenant-fk-ratchet chỉ phủ HÌNH DẠNG FK. (mirror `s11-room-db1-invariants.int-spec.ts`;
 * memory `reviewers-pass-real-bugs` + `tests-can-pin-a-hole-open`.)
 *
 * NƠI CHẠY: gate `hasDb`, KHÔNG gate `LANE_DB` — chạy THẬT trên CI (DATABASE_URL + DIRECT_URL ở cấp job).
 *
 * QUY TẮC: mọi ca ÂM assert `err.code` + `err.constraint` ĐÍCH DANH, vi phạm ĐÚNG MỘT constraint mỗi ca
 * (`pg-reports-arbitrary-check-when-multiple-violated`), và có ĐỐI CHỨNG DƯƠNG trên CÙNG constraint
 * (`deny-cases-vacuous-without-allow-case`). Mọi mutation chạy trong tx ROLLBACK.
 */
describe.skipIf(!hasDb)("S12-RECRUIT-DB-1 · bất biến nền dữ liệu RECRUIT (mig 0559–0561)", () => {
  const direct = directPool();
  const app = appPool(3);
  const worker = workerPool(1);

  let A: SeededTenant;
  let B: SeededTenant;
  let uA: string; // recruiter/actor A
  let uA2: string;
  let empA: string; // employee_profile(uA) — đã LINK vào candA (chốt uq D1)
  let empA2: string; // employee_profile(uA2) — participant/feedback positive
  let orgUnitA: string;
  let jobA: string; // Open
  let candA: string; // stage Offer, employee_id = empA (link sẵn)
  let candA2: string; // stage Interview, chưa link — nền interview/offer
  let ivA: string; // Scheduled, candA2, participant empA2 + feedback(empA2)
  let oA1: string; // Draft, candA2
  let uB: string;
  let empB: string;
  let orgUnitB: string;
  let jobB: string;
  let candB: string;

  type Outcome = { code: string | null; constraint?: string; message?: string };

  async function withRole<T>(
    pool: Pool,
    companyId: string | null,
    fn: (c: PoolClient) => Promise<T>,
  ): Promise<T> {
    const c = await pool.connect();
    let restored = true;
    try {
      await c.query("BEGIN");
      if (companyId) {
        await c.query("SELECT set_config('app.current_company_id', $1, true)", [companyId]);
      }
      return await fn(c);
    } finally {
      try {
        await c.query("ROLLBACK");
      } catch {
        restored = false;
      }
      c.release(restored ? undefined : true);
    }
  }

  /** Chạy MỘT chuỗi câu lệnh dưới role trong tx (rollback); trả mã lỗi PG của câu ĐẦU TIÊN hỏng. */
  async function attemptSeq(
    companyId: string | null,
    steps: Array<[string, unknown[]?]>,
    pool: Pool = app,
  ): Promise<Outcome> {
    return withRole(pool, companyId, async (c) => {
      try {
        for (const [sql, params] of steps) await c.query(sql, params ?? []);
        return { code: null };
      } catch (e) {
        const err = e as { code?: string; constraint?: string; message?: string };
        return { code: err.code ?? "UNKNOWN", constraint: err.constraint, message: err.message };
      }
    });
  }
  const attempt = (
    companyId: string | null,
    sql: string,
    params: unknown[] = [],
    pool: Pool = app,
  ) => attemptSeq(companyId, [[sql, params]], pool);

  const RECRUIT_TABLES = [
    "job_openings",
    "candidates",
    "candidate_stage_events",
    "candidate_notes",
    "interviews",
    "interview_participants",
    "interview_feedbacks",
    "offers",
  ] as const;

  beforeAll(async () => {
    A = await seedCompany(direct, "recA");
    B = await seedCompany(direct, "recB");
    uA = await seedUser(direct, A.companyId, `rec-u1-${A.slug}@x.test`);
    uA2 = await seedUser(direct, A.companyId, `rec-u2-${A.slug}@x.test`);
    uB = await seedUser(direct, B.companyId, `rec-u1-${B.slug}@x.test`);

    const mkEmp = async (companyId: string, userId: string) =>
      (
        await direct.query(
          `INSERT INTO employee_profiles (company_id, user_id) VALUES ($1, $2) RETURNING id`,
          [companyId, userId],
        )
      ).rows[0].id as string;
    empA = await mkEmp(A.companyId, uA);
    empA2 = await mkEmp(A.companyId, uA2);
    empB = await mkEmp(B.companyId, uB);

    const mkOrg = async (companyId: string, name: string) =>
      (
        await direct.query(
          `INSERT INTO org_units (company_id, name, type) VALUES ($1, $2, 'department') RETURNING id`,
          [companyId, name],
        )
      ).rows[0].id as string;
    orgUnitA = await mkOrg(A.companyId, `rec-org-${A.slug}`);
    orgUnitB = await mkOrg(B.companyId, `rec-org-${B.slug}`);

    const mkJob = async (companyId: string, orgUnitId: string, recruiter: string) =>
      (
        await direct.query(
          `INSERT INTO job_openings (company_id, title, org_unit_id, recruiter_user_id, status, created_by)
           VALUES ($1, 'Backend Engineer', $2, $3, 'Open', $3) RETURNING id`,
          [companyId, orgUnitId, recruiter],
        )
      ).rows[0].id as string;
    jobA = await mkJob(A.companyId, orgUnitA, uA);
    jobB = await mkJob(B.companyId, orgUnitB, uB);

    const mkCand = async (companyId: string, jobId: string, stage: string, employeeId?: string) =>
      (
        await direct.query(
          `INSERT INTO candidates (company_id, job_opening_id, full_name, email, phone, stage, employee_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [
            companyId,
            jobId,
            `Ứng viên ${randomUUID().slice(0, 6)}`,
            `cand-${randomUUID().slice(0, 8)}@x.test`,
            "0901 234 567",
            stage,
            employeeId ?? null,
          ],
        )
      ).rows[0].id as string;
    candA = await mkCand(A.companyId, jobA, "Offer", empA);
    candA2 = await mkCand(A.companyId, jobA, "Interview");
    candB = await mkCand(B.companyId, jobB, "New");

    ivA = (
      await direct.query(
        `INSERT INTO interviews (company_id, candidate_id, round, starts_at, ends_at, status, created_by)
         VALUES ($1, $2, 1, now() + interval '1 day', now() + interval '1 day 1 hour', 'Scheduled', $3) RETURNING id`,
        [A.companyId, candA2, uA],
      )
    ).rows[0].id as string;
    await direct.query(
      `INSERT INTO interview_participants (company_id, interview_id, employee_id) VALUES ($1, $2, $3)`,
      [A.companyId, ivA, empA2],
    );
    await direct.query(
      `INSERT INTO interview_feedbacks (company_id, interview_id, interviewer_employee_id, rating, recommendation)
       VALUES ($1, $2, $3, 4, 'Hire')`,
      [A.companyId, ivA, empA2],
    );
    oA1 = (
      await direct.query(
        `INSERT INTO offers (company_id, candidate_id, start_date, salary, status, created_by)
         VALUES ($1, $2, '2026-10-01', 25000000, 'Draft', $3) RETURNING id`,
        [A.companyId, candA2, uA],
      )
    ).rows[0].id as string;
  }, 60_000);

  afterAll(async () => {
    await cleanupTenants(direct, [A?.companyId, B?.companyId].filter(Boolean) as string[]);
    await direct.end();
    await app.end();
    await worker.end();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // A. BẤT BIẾN #2 — ACL ép ở TẦNG DB (aclexplode đúng-bằng + thử thật từ app pool)
  // ─────────────────────────────────────────────────────────────────────────────
  describe("A. GRANT: cse append-only tuyệt đối · participants chỉ INSERT · feedbacks/offers UPDATE cấp cột · 0 DELETE · worker chỉ SELECT", () => {
    it("A1 ma trận ACL 8 bảng × {SELECT,INSERT,UPDATE,DELETE} qua aclexplode == kỳ vọng DB-14 §6 (bảng LẪN cột)", async () => {
      const expectedTable: Record<string, string[]> = {
        job_openings: ["INSERT", "SELECT", "UPDATE"],
        candidates: ["INSERT", "SELECT", "UPDATE"],
        candidate_stage_events: ["INSERT", "SELECT"],
        candidate_notes: ["INSERT", "SELECT", "UPDATE"],
        interviews: ["INSERT", "SELECT", "UPDATE"],
        interview_participants: ["INSERT", "SELECT"],
        interview_feedbacks: ["INSERT", "SELECT"],
        offers: ["INSERT", "SELECT"],
      };
      const expectedCols: Record<string, string[]> = {
        interview_feedbacks: ["comment", "rating", "recommendation", "updated_at"],
        offers: [
          "note",
          "responded_at",
          "salary",
          "start_date",
          "status",
          "title",
          "updated_at",
          "updated_by",
        ],
      };
      for (const t of RECRUIT_TABLES) {
        const table = await direct.query<{ privilege_type: string }>(
          `SELECT x.privilege_type FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) x
            WHERE c.oid = $1::regclass AND x.grantee = 'mediaos_app'::regrole ORDER BY 1`,
          [t],
        );
        expect(
          table.rows.map((r) => r.privilege_type),
          `table-ACL app trên ${t}`,
        ).toEqual(expectedTable[t]);

        const cols = await direct.query<{ attname: string; privilege_type: string }>(
          `SELECT a.attname, x.privilege_type
             FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) x
            WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped
              AND x.grantee = 'mediaos_app'::regrole ORDER BY 1`,
          [t],
        );
        expect(
          cols.rows.every((r) => r.privilege_type === "UPDATE"),
          `${t}: app không được có column-ACL ngoài UPDATE`,
        ).toBe(true);
        expect(
          cols.rows.map((r) => r.attname),
          `column-UPDATE app trên ${t}`,
        ).toEqual(expectedCols[t] ?? []);

        const wk = await direct.query<{ privilege_type: string }>(
          `SELECT x.privilege_type FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) x
            WHERE c.oid = $1::regclass AND x.grantee = 'mediaos_worker'::regrole ORDER BY 1`,
          [t],
        );
        expect(
          wk.rows.map((r) => r.privilege_type),
          `worker trên ${t}`,
        ).toEqual(["SELECT"]);
      }
    });

    it("A2 ALLOW (chống ca rỗng): app role dưới GUC INSERT + SELECT được cả candidate_stage_events LẪN interview_participants", async () => {
      // deny-cases-vacuous-without-allow-case: bảng không có grant nào cũng qua ca deny — vế ALLOW này
      // chứng minh đường ghi hợp lệ THẬT SỰ mở trước khi các ca deny bên dưới có nghĩa.
      const okCse = await attemptSeq(A.companyId, [
        [
          `INSERT INTO candidate_stage_events (company_id, candidate_id, from_stage, to_stage, action, reason, acted_by)
           VALUES ($1, $2, 'Interview', 'Offer', 'move', 'đủ điều kiện offer', $3)`,
          [A.companyId, candA2, uA],
        ],
        [`SELECT count(*) FROM candidate_stage_events WHERE candidate_id = $1`, [candA2]],
      ]);
      expect(okCse.code, "app INSERT+SELECT candidate_stage_events phải OK").toBeNull();

      const okPart = await attemptSeq(A.companyId, [
        [
          `INSERT INTO interview_participants (company_id, interview_id, employee_id) VALUES ($1, $2, $3)`,
          [A.companyId, ivA, empA],
        ],
        [`SELECT count(*) FROM interview_participants WHERE interview_id = $1`, [ivA]],
      ]);
      expect(okPart.code, "app INSERT+SELECT interview_participants phải OK").toBeNull();
    });

    it("A3 app role KHÔNG DELETE được bảng nào trong 8 — 42501 từng bảng", async () => {
      for (const t of RECRUIT_TABLES) {
        const r = await attempt(A.companyId, `DELETE FROM ${t} WHERE company_id = $1`, [
          A.companyId,
        ]);
        expect(r.code, `DELETE ${t} phải bị chặn`).toBe("42501");
      }
    });

    it("A4 app role KHÔNG UPDATE được cse/participants (mọi cột) và cột ngoài allowlist của feedbacks/offers — 42501; đối chứng cột allowlist OK", async () => {
      const denyCse = await attempt(
        A.companyId,
        `UPDATE candidate_stage_events SET reason = 'sửa sổ' WHERE candidate_id = $1`,
        [candA2],
      );
      expect(denyCse.code, "UPDATE candidate_stage_events phải bị chặn (append-only)").toBe(
        "42501",
      );

      const denyPart = await attempt(
        A.companyId,
        `UPDATE interview_participants SET employee_id = $2 WHERE interview_id = $1`,
        [ivA, empA],
      );
      expect(denyPart.code, "UPDATE interview_participants phải bị chặn (chỉ-INSERT)").toBe(
        "42501",
      );

      // feedbacks: interview_id ngoài allowlist
      const denyFb = await attempt(
        A.companyId,
        `UPDATE interview_feedbacks SET interview_id = $2 WHERE interview_id = $1`,
        [ivA, ivA],
      );
      expect(denyFb.code, "UPDATE interview_feedbacks.interview_id ngoài allowlist").toBe("42501");
      // offers: created_by/candidate_id ngoài allowlist
      const denyOf = await attempt(A.companyId, `UPDATE offers SET created_by = $2 WHERE id = $1`, [
        oA1,
        uA2,
      ]);
      expect(denyOf.code, "UPDATE offers.created_by ngoài allowlist").toBe("42501");

      // Đối chứng DƯƠNG cùng bảng: cột TRONG allowlist ghi được
      const okFb = await attempt(
        A.companyId,
        `UPDATE interview_feedbacks SET rating = 5, updated_at = now() WHERE interview_id = $1 AND interviewer_employee_id = $2`,
        [ivA, empA2],
      );
      expect(okFb.code, "UPDATE cột allowlist feedbacks phải OK").toBeNull();
      const okOf = await attempt(
        A.companyId,
        `UPDATE offers SET note = 'thương lượng', updated_at = now(), updated_by = $2 WHERE id = $1`,
        [oA1, uA],
      );
      expect(okOf.code, "UPDATE cột allowlist offers phải OK").toBeNull();
    });

    it("A5 mediaos_worker: INSERT/UPDATE/DELETE → 42501; SELECT OK", async () => {
      const ins = await attempt(
        A.companyId,
        `INSERT INTO candidate_notes (company_id, candidate_id, body) VALUES ($1, $2, 'w')`,
        [A.companyId, candA],
        worker,
      );
      expect(ins.code).toBe("42501");
      const upd = await attempt(
        A.companyId,
        `UPDATE candidates SET note = 'w' WHERE id = $1`,
        [candA],
        worker,
      );
      expect(upd.code).toBe("42501");
      const del = await attempt(A.companyId, `DELETE FROM offers WHERE id = $1`, [oA1], worker);
      expect(del.code).toBe("42501");
      const sel = await attempt(
        A.companyId,
        `SELECT count(*) FROM candidates WHERE company_id = $1`,
        [A.companyId],
        worker,
      );
      expect(sel.code, "worker SELECT phải OK").toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // B. Composite tenant FK — đích danh tên constraint, đối chứng cùng tenant OK
  // ─────────────────────────────────────────────────────────────────────────────
  describe("B. composite tenant FK chặn tham chiếu chéo tenant (23503 đích danh)", () => {
    it("B1 candidates: job_opening của B → candidates_job_opening_tenant_fk; employee của B → candidates_employee_tenant_fk", async () => {
      const crossJob = await attempt(
        A.companyId,
        `INSERT INTO candidates (company_id, job_opening_id, full_name) VALUES ($1, $2, 'x')`,
        [A.companyId, jobB],
      );
      expect(crossJob.code).toBe("23503");
      expect(crossJob.constraint).toBe("candidates_job_opening_tenant_fk");

      const crossEmp = await attempt(
        A.companyId,
        `UPDATE candidates SET employee_id = $2 WHERE id = $1`,
        [candA2, empB],
      );
      expect(crossEmp.code).toBe("23503");
      expect(crossEmp.constraint).toBe("candidates_employee_tenant_fk");

      const ok = await attempt(
        A.companyId,
        `INSERT INTO candidates (company_id, job_opening_id, full_name) VALUES ($1, $2, 'đối chứng')`,
        [A.companyId, jobA],
      );
      expect(ok.code, "cùng tenant phải OK").toBeNull();
    });

    it("B2 job_openings: org_unit của B → job_openings_org_unit_tenant_fk; recruiter của B → job_openings_recruiter_tenant_fk", async () => {
      const crossOrg = await attempt(
        A.companyId,
        `INSERT INTO job_openings (company_id, title, org_unit_id) VALUES ($1, 'x', $2)`,
        [A.companyId, orgUnitB],
      );
      expect(crossOrg.code).toBe("23503");
      expect(crossOrg.constraint).toBe("job_openings_org_unit_tenant_fk");

      const crossRec = await attempt(
        A.companyId,
        `INSERT INTO job_openings (company_id, title, org_unit_id, recruiter_user_id) VALUES ($1, 'x', $2, $3)`,
        [A.companyId, orgUnitA, uB],
      );
      expect(crossRec.code).toBe("23503");
      expect(crossRec.constraint).toBe("job_openings_recruiter_tenant_fk");
    });

    it("B3 sổ/chi tiết: candidate B trong cse · employee B trong participants · candidate B trong offers → 23503 đích danh", async () => {
      const cse = await attempt(
        A.companyId,
        `INSERT INTO candidate_stage_events (company_id, candidate_id, from_stage, to_stage, action, reason)
         VALUES ($1, $2, 'New', 'Screening', 'move', 'x')`,
        [A.companyId, candB],
      );
      expect(cse.code).toBe("23503");
      expect(cse.constraint).toBe("cse_candidate_tenant_fk");

      const part = await attempt(
        A.companyId,
        `INSERT INTO interview_participants (company_id, interview_id, employee_id) VALUES ($1, $2, $3)`,
        [A.companyId, ivA, empB],
      );
      expect(part.code).toBe("23503");
      expect(part.constraint).toBe("interview_participants_employee_tenant_fk");

      const offer = await attempt(
        A.companyId,
        `INSERT INTO offers (company_id, candidate_id, start_date, salary) VALUES ($1, $2, '2026-10-01', 1)`,
        [A.companyId, candB],
      );
      expect(offer.code).toBe("23503");
      expect(offer.constraint).toBe("offers_candidate_tenant_fk");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // C. RLS FORCE — không GUC ⇒ 0 hàng
  // ─────────────────────────────────────────────────────────────────────────────
  it("C1 không GUC ⇒ app role thấy 0 hàng trên CẢ 8 bảng (FORCE RLS)", async () => {
    for (const t of RECRUIT_TABLES) {
      const n = await withRole(app, null, async (c) => {
        const r = await c.query<{ n: string }>(`SELECT count(*)::int AS n FROM ${t}`);
        return Number(r.rows[0].n);
      });
      expect(n, `${t} phải 0 hàng khi không có ngữ cảnh tenant`).toBe(0);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // D. CHỐT CUỐI unique/CHECK — A/B từng cặp, vi phạm ĐÚNG MỘT constraint mỗi ca
  // ─────────────────────────────────────────────────────────────────────────────
  describe("D. unique/CHECK đích danh + đối chứng dương", () => {
    it("D1 uq_candidates_company_employee: link employee đã dùng → 23505; KỂ CẢ khi hồ sơ gốc đã xoá mềm (không partial)", async () => {
      const dup = await attempt(
        A.companyId,
        `UPDATE candidates SET employee_id = $2 WHERE id = $1`,
        [candA2, empA],
      );
      expect(dup.code).toBe("23505");
      expect(dup.constraint).toBe("uq_candidates_company_employee");

      // KHÔNG partial theo deleted_at (REC-DEC-005): xoá mềm hồ sơ gốc xong link lại VẪN 23505.
      const dupAfterSoftDelete = await attemptSeq(A.companyId, [
        [`UPDATE candidates SET deleted_at = now(), deleted_by = $2 WHERE id = $1`, [candA, uA]],
        [`UPDATE candidates SET employee_id = $2 WHERE id = $1`, [candA2, empA]],
      ]);
      expect(dupAfterSoftDelete.code).toBe("23505");
      expect(dupAfterSoftDelete.constraint).toBe("uq_candidates_company_employee");

      // Đối chứng dương: employee khác link được.
      const ok = await attempt(
        A.companyId,
        `UPDATE candidates SET employee_id = $2 WHERE id = $1`,
        [candA2, empA2],
      );
      expect(ok.code).toBeNull();
    });

    it("D2 uq_offers_candidate_open: offer sống thứ 2 cùng ứng viên → 23505; sau khi offer 1 vào terminal thì Draft mới OK", async () => {
      const dup = await attempt(
        A.companyId,
        `INSERT INTO offers (company_id, candidate_id, start_date, salary) VALUES ($1, $2, '2026-11-01', 1)`,
        [A.companyId, candA2],
      );
      expect(dup.code).toBe("23505");
      expect(dup.constraint).toBe("uq_offers_candidate_open");

      // Đối chứng dương CHỨNG MINH predicate Draft/Sent (không chỉ tên): terminal hoá offer 1 (một câu
      // UPDATE đủ status + responded_at — chk_offers_responded_pair) rồi Draft mới chèn được.
      const okAfterTerminal = await attemptSeq(A.companyId, [
        [
          `UPDATE offers SET status = 'Declined', responded_at = now(), updated_at = now() WHERE id = $1`,
          [oA1],
        ],
        [
          `INSERT INTO offers (company_id, candidate_id, start_date, salary) VALUES ($1, $2, '2026-11-01', 1)`,
          [A.companyId, candA2],
        ],
      ]);
      expect(okAfterTerminal.code, "offer terminal không còn chặn offer mới").toBeNull();
    });

    it("D3 uq_interview_feedbacks: feedback thứ 2 cùng (lượt, interviewer) → 23505; interviewer khác OK", async () => {
      const dup = await attempt(
        A.companyId,
        `INSERT INTO interview_feedbacks (company_id, interview_id, interviewer_employee_id, rating, recommendation)
         VALUES ($1, $2, $3, 3, 'Consider')`,
        [A.companyId, ivA, empA2],
      );
      expect(dup.code).toBe("23505");
      expect(dup.constraint).toBe("uq_interview_feedbacks");

      const ok = await attempt(
        A.companyId,
        `INSERT INTO interview_feedbacks (company_id, interview_id, interviewer_employee_id, rating, recommendation)
         VALUES ($1, $2, $3, 3, 'Consider')`,
        [A.companyId, ivA, empA],
      );
      expect(ok.code, "interviewer khác phải chèn được").toBeNull();
    });

    it("D4 chk_offers_responded_pair: terminal thiếu responded_at / Draft có responded_at / UPDATE tách 2 câu → 23514", async () => {
      // Mỗi ca vi phạm ĐÚNG MỘT CHECK: status hợp lệ, salary hợp lệ.
      const terminalNoTs = await attempt(
        A.companyId,
        `INSERT INTO offers (company_id, candidate_id, start_date, salary, status)
         VALUES ($1, $2, '2026-10-01', 1, 'Accepted')`,
        [A.companyId, candA],
      );
      expect(terminalNoTs.code).toBe("23514");
      expect(terminalNoTs.constraint).toBe("chk_offers_responded_pair");

      const draftWithTs = await attempt(
        A.companyId,
        `INSERT INTO offers (company_id, candidate_id, start_date, salary, status, responded_at)
         VALUES ($1, $2, '2026-10-01', 1, 'Draft', now())`,
        [A.companyId, candA],
      );
      expect(draftWithTs.code).toBe("23514");
      expect(draftWithTs.constraint).toBe("chk_offers_responded_pair");

      // "vào terminal" tách 2 câu — câu 1 (chỉ status) phải nổ ngay.
      const twoStep = await attempt(
        A.companyId,
        `UPDATE offers SET status = 'Accepted' WHERE id = $1`,
        [oA1],
      );
      expect(twoStep.code).toBe("23514");
      expect(twoStep.constraint).toBe("chk_offers_responded_pair");
    });

    it("D5 candidate_stage_events: from=to → chk_cse_moved · action lạ → chk_cse_action · stage lạ → chk_cse_from (mỗi ca một CHECK)", async () => {
      const INS = `INSERT INTO candidate_stage_events (company_id, candidate_id, from_stage, to_stage, action, reason)
                   VALUES ($1, $2, $3, $4, $5, 'x')`;
      const same = await attempt(A.companyId, INS, [A.companyId, candA2, "New", "New", "move"]);
      expect(same.code).toBe("23514");
      expect(same.constraint).toBe("chk_cse_moved");

      const badAction = await attempt(A.companyId, INS, [
        A.companyId,
        candA2,
        "New",
        "Screening",
        "teleport",
      ]);
      expect(badAction.code).toBe("23514");
      expect(badAction.constraint).toBe("chk_cse_action");

      const badFrom = await attempt(A.companyId, INS, [
        A.companyId,
        candA2,
        "Limbo",
        "Screening",
        "move",
      ]);
      expect(badFrom.code).toBe("23514");
      expect(badFrom.constraint).toBe("chk_cse_from");

      // reason NOT NULL (SPEC-12 §13.1)
      const noReason = await attempt(
        A.companyId,
        `INSERT INTO candidate_stage_events (company_id, candidate_id, from_stage, to_stage, action)
         VALUES ($1, $2, 'New', 'Screening', 'move')`,
        [A.companyId, candA2],
      );
      expect(noReason.code).toBe("23502");
    });

    it("D6 CHECK còn lại: interviews range/round · job_openings headcount/status · candidates stage — đích danh", async () => {
      const badRange = await attempt(
        A.companyId,
        `INSERT INTO interviews (company_id, candidate_id, starts_at, ends_at)
         VALUES ($1, $2, now() + interval '2 hour', now() + interval '1 hour')`,
        [A.companyId, candA2],
      );
      expect(badRange.code).toBe("23514");
      expect(badRange.constraint).toBe("chk_interviews_range");

      const badRound = await attempt(
        A.companyId,
        `INSERT INTO interviews (company_id, candidate_id, round, starts_at, ends_at)
         VALUES ($1, $2, 0, now(), now() + interval '1 hour')`,
        [A.companyId, candA2],
      );
      expect(badRound.code).toBe("23514");
      expect(badRound.constraint).toBe("chk_interviews_round");

      const badHead = await attempt(
        A.companyId,
        `INSERT INTO job_openings (company_id, title, org_unit_id, headcount) VALUES ($1, 'x', $2, 0)`,
        [A.companyId, orgUnitA],
      );
      expect(badHead.code).toBe("23514");
      expect(badHead.constraint).toBe("chk_job_openings_headcount");

      const badStatus = await attempt(
        A.companyId,
        `INSERT INTO job_openings (company_id, title, org_unit_id, status) VALUES ($1, 'x', $2, 'Archived')`,
        [A.companyId, orgUnitA],
      );
      expect(badStatus.code).toBe("23514");
      expect(badStatus.constraint).toBe("chk_job_openings_status");

      const badStage = await attempt(
        A.companyId,
        `UPDATE candidates SET stage = 'Ghosted' WHERE id = $1`,
        [candA2],
      );
      expect(badStage.code).toBe("23514");
      expect(badStage.constraint).toBe("chk_candidates_stage");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // E. Seed quyền §9f — set-equality 42 bộ + census 4 hình dạng wildcard + role recruiter
  // ─────────────────────────────────────────────────────────────────────────────
  describe("E. seed quyền / role / canonical", () => {
    /** Ma trận §9f — literal chép từ 0560, cố ý KHÔNG import (tautology). */
    const EXPECTED_42: Array<[string, string, string, string]> = [
      ["manager", "access", "recruit", "Own"],
      ["manager", "view", "interview", "Own"],
      ["manager", "feedback", "interview", "Own"],
      ["hr", "access", "recruit", "Own"],
      ["hr", "view", "job-opening", "Company"],
      ["hr", "view", "candidate", "Company"],
      ["hr", "view", "interview", "Company"],
      ["hr", "view", "offer", "Company"],
      ["hr", "convert", "candidate", "Company"],
      ["hr", "feedback", "interview", "Own"],
      ...(["company-admin", "recruiter"] as const).flatMap(
        (role): Array<[string, string, string, string]> => [
          [role, "access", "recruit", "Own"],
          [role, "view", "job-opening", "Company"],
          [role, "create", "job-opening", "Company"],
          [role, "update", "job-opening", "Company"],
          [role, "view", "candidate", "Company"],
          [role, "create", "candidate", "Company"],
          [role, "update", "candidate", "Company"],
          [role, "move-stage", "candidate", "Company"],
          [role, "comment", "candidate", "Company"],
          [role, "export", "candidate", "Company"],
          [role, "convert", "candidate", "Company"],
          [role, "view", "interview", "Company"],
          [role, "manage", "interview", "Company"],
          [role, "feedback", "interview", "Own"],
          [role, "view", "offer", "Company"],
          [role, "manage", "offer", "Company"],
        ],
      ),
    ];

    it("E1 set-equality 42 bộ (role, action, resource, scope, effect=ALLOW) trên MỌI role hệ thống — sai MỘT hàng là đỏ", async () => {
      // ⚠️ CỐ Ý KHÔNG neo r.name IN (5 role) — security review MED-2 (lớp
      // `uniqueness-gate-covered-one-of-fifteen-families`): hệ thống còn ≥12 role company_id IS NULL khác
      // (hr-manager, asset-manager, office-admin…); neo 5 role thì WO sau grant `export:candidate` cho
      // hr-manager KHÔNG gì đỏ — trong khi NOTI-019 cố ý loại hr-manager vì giả định role đó 0 grant RECRUIT.
      // Grant RECRUIT cho role hệ thống MỚI ⇒ phải cập nhật danh sách 42 bộ ở đây (ratchet có chủ đích).
      const rows = await direct.query<{
        role: string;
        action: string;
        resource_type: string;
        data_scope: string;
        effect: string;
      }>(
        `SELECT r.name AS role, p.action, p.resource_type, rp.data_scope, rp.effect
           FROM role_permissions rp
           JOIN roles r       ON r.id = rp.role_id
           JOIN permissions p ON p.id = rp.permission_id
          WHERE r.company_id IS NULL AND r.deleted_at IS NULL
            AND p.resource_type IN ('recruit', 'job-opening', 'candidate', 'interview', 'offer')
          ORDER BY 1, 2, 3`,
      );
      expect(rows.rows.every((r) => r.effect === "ALLOW")).toBe(true);
      const actual = rows.rows
        .map((r) => `${r.role}|${r.action}|${r.resource_type}|${r.data_scope}`)
        .sort();
      const expected = EXPECTED_42.map((g) => g.join("|")).sort();
      expect(actual).toEqual(expected);
    });

    it("E2 census 4 hình dạng wildcard: không role hệ thống nào chạm cặp RECRUIT qua ('act','*')/('*','res')/('*','*')", async () => {
      // permission-grant-census-must-cover-four-wildcard-shapes: matches() là HAI vế độc lập — câu đo
      // exact-only mù với wildcard. Ở đây assert KHÔNG hình dạng wildcard nào tồn tại cho role hệ thống
      // (super-admin nhận catalog per-pair ở runtime bootstrap, company-scoped — không nằm trong tập này).
      const wild = await direct.query<{ role: string; action: string; resource_type: string }>(
        `SELECT r.name AS role, p.action, p.resource_type
           FROM role_permissions rp
           JOIN roles r       ON r.id = rp.role_id
           JOIN permissions p ON p.id = rp.permission_id
          WHERE r.company_id IS NULL AND r.deleted_at IS NULL
            AND (p.action = '*' OR p.resource_type = '*')`,
      );
      expect(
        wild.rows,
        "grant wildcard cho role hệ thống = đường ngầm vào cặp sensitive RECRUIT",
      ).toEqual([]);
    });

    it("E3 role recruiter đúng thuộc tính; KHÔNG canonical (DASH/NOTI pins); id …0014", async () => {
      const role = await direct.query(
        `SELECT id, is_system, requires_two_factor FROM roles
          WHERE name = 'recruiter' AND company_id IS NULL AND deleted_at IS NULL`,
      );
      expect(role.rows).toHaveLength(1);
      expect(role.rows[0].id).toBe("00000000-0000-0000-0000-000000000014");
      expect(role.rows[0].is_system).toBe(true);
      expect(role.rows[0].requires_two_factor).toBe(false);

      expect([...DASH_CANONICAL_ROLES]).not.toContain("recruiter");
      expect([...NOTI_CANONICAL_ROLES]).not.toContain("recruiter");
    });

    it("E4 (M8) catalog giữ ĐỦ 7 cặp sensitive exact — đường duy nhất để SuperAdminBootstrap (grant per-pair cả catalog) giải cổng sensitive", async () => {
      // Cổng sensitive của engine đòi grant KHỚP cặp exact (wildcard *:* không thoả — tiền lệ
      // leave-audit.service). Bootstrap enumerate catalog per-pair ⇒ 7 cặp phải NẰM TRONG catalog.
      const rows = await direct.query<{ action: string }>(
        `SELECT action FROM permissions WHERE resource_type = 'candidate' AND is_sensitive = true ORDER BY action`,
      );
      expect(rows.rows.map((r) => r.action)).toEqual([
        "comment",
        "convert",
        "create",
        "export",
        "move-stage",
        "update",
        "view",
      ]);
      // 9 cặp còn lại không-nhạy-cảm
      const nonSensitive = await direct.query<{ n: string }>(
        `SELECT count(*)::int AS n FROM permissions
          WHERE is_sensitive = false
            AND (action, resource_type) IN (
              ('access','recruit'),
              ('view','job-opening'), ('create','job-opening'), ('update','job-opening'),
              ('view','interview'), ('manage','interview'), ('feedback','interview'),
              ('view','offer'), ('manage','offer'))`,
      );
      expect(Number(nonSensitive.rows[0].n)).toBe(9);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // F. Audit CHECK — 4 object_type mới sống dưới app role, NO-LOSS canary
  // ─────────────────────────────────────────────────────────────────────────────
  it("F1 audit_logs nhận 4 object_type RECRUIT dưới app role; giá trị ngoài bản đồ ĐÓNG → 23514", async () => {
    for (const ot of ["job_opening", "candidate", "interview", "offer"]) {
      const ok = await attempt(
        A.companyId,
        `INSERT INTO audit_logs (company_id, action, object_type) VALUES ($1, 'recruit.test', $2)`,
        [A.companyId, ot],
      );
      expect(ok.code, `audit object_type='${ot}' phải ghi được`).toBeNull();
    }
    // Bản đồ ĐÓNG (SPEC-12 §12): candidate_note/interview_feedback KHÔNG có type riêng — ghi là 23514.
    for (const bad of ["candidate_note", "interview_feedback"]) {
      const r = await attempt(
        A.companyId,
        `INSERT INTO audit_logs (company_id, action, object_type) VALUES ($1, 'recruit.test', $2)`,
        [A.companyId, bad],
      );
      expect(r.code, `object_type='${bad}' phải ngoài bản đồ`).toBe("23514");
    }
    // Canary NO-LOSS: giá trị cũ vẫn ghi được (union không đánh rơi).
    const canary = await attempt(
      A.companyId,
      `INSERT INTO audit_logs (company_id, action, object_type) VALUES ($1, 'recruit.test', 'employee')`,
      [A.companyId],
    );
    expect(canary.code).toBeNull();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // G. NOTI 0561 — CHECK cả hai bảng + catalog 4 event/template
  // ─────────────────────────────────────────────────────────────────────────────
  describe("G. NOTI: CHECK RECRUIT/Recruit trên notifications + 4 event DedupeKey + 4 template", () => {
    it("G1 notifications nhận module_code='RECRUIT'/notification_type='Recruit' dưới app role; giá trị lạ → 23514 đích danh", async () => {
      const INS = `INSERT INTO notifications (company_id, user_id, body, module_code, notification_type) VALUES ($1, $2, 'x', $3, $4)`;
      const ok = await attempt(A.companyId, INS, [A.companyId, uA, "RECRUIT", "Recruit"]);
      expect(ok.code, "vế notifications phải đã nới (lỗi 0507 quên vế này)").toBeNull();
      const badModule = await attempt(A.companyId, INS, [A.companyId, uA, "XXX", "Recruit"]);
      expect(badModule.code).toBe("23514");
      expect(badModule.constraint).toBe("chk_notifications_module_code");
      const badType = await attempt(A.companyId, INS, [A.companyId, uA, "RECRUIT", "Xxx"]);
      expect(badType.code).toBe("23514");
      expect(badType.constraint).toBe("chk_notifications_notification_type");
    });

    it("G2 4 event global DedupeKey/enabled/Recruit, is_system_event=false CẢ 4, priority Normal/High/Normal/Normal + 4 template không PII", async () => {
      const ev = (
        await direct.query<{
          event_code: string;
          dedupe_strategy: string;
          default_priority: string;
          is_system_event: boolean;
        }>(
          `SELECT event_code, dedupe_strategy, default_priority, is_system_event FROM notification_events
            WHERE company_id IS NULL AND deleted_at IS NULL AND module_code='RECRUIT' AND notification_type='Recruit'
              AND is_enabled = true ORDER BY event_code`,
        )
      ).rows;
      expect(
        ev.map((r) => [r.event_code, r.default_priority, r.is_system_event, r.dedupe_strategy]),
      ).toEqual([
        ["RECRUIT_CANDIDATE_HIRED", "Normal", false, "DedupeKey"],
        ["RECRUIT_INTERVIEW_SCHEDULED", "High", false, "DedupeKey"],
        ["RECRUIT_JOB_ASSIGNED", "Normal", false, "DedupeKey"],
        ["RECRUIT_STAGE_CHANGED", "Normal", false, "DedupeKey"],
      ]);
      const tpl = (
        await direct.query<{
          template_code: string;
          title_template: string;
          body_template: string;
          short_body_template: string | null;
          target_url_template: string;
          variables_schema: unknown;
        }>(
          `SELECT t.template_code, t.title_template, t.body_template, t.short_body_template,
                  t.target_url_template, t.variables_schema
             FROM notification_templates t JOIN notification_events e ON e.id = t.event_id
            WHERE t.company_id IS NULL AND t.deleted_at IS NULL AND e.company_id IS NULL AND e.module_code='RECRUIT'
              AND t.channel='IN_APP' AND t.locale='vi-VN' AND t.status='Active' AND t.is_default ORDER BY 1`,
        )
      ).rows;
      expect(tpl.map((t) => t.template_code)).toEqual([
        "RECRUIT_CANDIDATE_HIRED__IN_APP__vi-VN",
        "RECRUIT_INTERVIEW_SCHEDULED__IN_APP__vi-VN",
        "RECRUIT_JOB_ASSIGNED__IN_APP__vi-VN",
        "RECRUIT_STAGE_CHANGED__IN_APP__vi-VN",
      ]);
      for (const t of tpl) {
        expect(t.target_url_template).toMatch(/^\/recruit\//);
        expect(t.variables_schema).toBeTruthy();
        // BẤT BIẾN #3: template không nhúng biến email/phone/salary — quét ĐỦ 4 cột text + schema
        // (security review MED-1: bỏ short_body/target_url là lỗ cho template tương lai).
        const all = `${t.title_template} ${t.body_template} ${t.short_body_template ?? ""} ${
          t.target_url_template
        } ${JSON.stringify(t.variables_schema)}`;
        expect(all).not.toMatch(/email|phone|salary/i);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // H. EXPLAIN — 2 index check-duplicate thật sự dùng được (DB-14 §6.2 DoD)
  // ─────────────────────────────────────────────────────────────────────────────
  describe("H. EXPLAIN index check-duplicate (gieo ≥200 hàng + ANALYZE — pg-planner-index-assert-trap)", () => {
    it("H1 lower(email) + regexp_replace(phone) đi qua đúng index; biểu thức LỆCH thì không", async () => {
      // Gieo 220 ứng viên có email/phone (owner) rồi ANALYZE — bảng rỗng thì planner luôn seq-scan.
      const values: string[] = [];
      const params: unknown[] = [A.companyId, jobA];
      for (let i = 0; i < 220; i++) {
        const base = params.length;
        values.push(`($1, $2, $${base + 1}, $${base + 2}, $${base + 3})`);
        params.push(`UV ${i}`, `bulk-${i}-${randomUUID().slice(0, 6)}@x.test`, `090${1000000 + i}`);
      }
      await direct.query(
        `INSERT INTO candidates (company_id, job_opening_id, full_name, email, phone) VALUES ${values.join(",")}`,
        params,
      );
      await direct.query(`ANALYZE candidates`);

      // ⚠️ HAI TẦNG ĐO — phát hiện lúc thi công (31/08/2026, ghi vào DB-14 §6.2):
      // `lower`/`regexp_replace` KHÔNG leakproof (pg_proc.proleakproof = f) ⇒ dưới FORCE RLS, planner
      // KHÔNG được đẩy qual chứa chúng vào Index Cond trước hàng rào policy — biểu thức nằm ở Filter,
      // index vẫn là ACCESS PATH theo tiền tố company_id (bitmap ~số hàng tenant, chấp nhận được ở quy mô
      // ứng viên/tenant). Vậy:
      //   (1) PARITY biểu thức (khác một ký tự là mất) đo ở OWNER — không RLS, Index Cond phải chứa expr;
      //   (2) ACCESS PATH dưới app role — đúng index này được dùng (không seq-scan cross-tenant).
      const ownerPlanOf = async (sql: string) => {
        const c = await direct.connect();
        try {
          await c.query("BEGIN");
          await c.query(`SET LOCAL enable_seqscan = off`);
          const r = await c.query<{ "QUERY PLAN": string }>(`EXPLAIN ${sql}`);
          return r.rows.map((row) => row["QUERY PLAN"]).join("\n");
        } finally {
          await c.query("ROLLBACK").catch(() => undefined);
          c.release();
        }
      };
      const appPlanOf = async (sql: string, args: unknown[]) =>
        withRole(app, A.companyId, async (c) => {
          await c.query(`SET LOCAL enable_seqscan = off`);
          const r = await c.query<{ "QUERY PLAN": string }>(`EXPLAIN ${sql}`, args);
          return r.rows.map((row) => row["QUERY PLAN"]).join("\n");
        });

      // (1) parity biểu thức — owner
      const emailOwner = await ownerPlanOf(
        `SELECT id FROM candidates WHERE company_id = '${A.companyId}' AND lower(email) = lower('bulk-1@x.test')`,
      );
      expect(emailOwner).toContain("idx_candidates_company_email_expr");
      expect(emailOwner, "biểu thức lower(email) phải vào Index Cond (owner)").toMatch(
        /Index Cond:.*lower\(\(email\)::text\)/,
      );
      const phoneOwner = await ownerPlanOf(
        `SELECT id FROM candidates WHERE company_id = '${A.companyId}' AND regexp_replace(phone, '[^0-9+]', '', 'g') = '0901000001'`,
      );
      expect(phoneOwner).toContain("idx_candidates_company_phone_norm");
      expect(phoneOwner, "biểu thức regexp_replace phải vào Index Cond (owner)").toMatch(
        /Index Cond:.*regexp_replace/,
      );
      // Negative control (owner): biểu thức LỆCH (không lower) không vào được Index Cond của expr-index.
      const mismatchOwner = await ownerPlanOf(
        `SELECT id FROM candidates WHERE company_id = '${A.companyId}' AND email = 'bulk-1@x.test'`,
      );
      expect(mismatchOwner).not.toMatch(/Index Cond:.*lower\(\(email\)::text\)/);

      // (2) access path dưới app role — đi INDEX theo tiền tố company_id, KHÔNG seq-scan.
      // KHÔNG pin TÊN index ở tầng này (sửa 31/08/2026, S12-RECRUIT-QA-1): vì expr không leakproof
      // nằm ở Filter (xem ghi chú trên), MỌI index tiền tố company_id là access path tương đương —
      // planner cost-pick giữa email_expr/phone_norm/company_id_id_uq đổi theo stats thực tế (sau
      // churn dữ liệu của bộ QA-1 nó chọn candidates_company_id_id_uq ⇒ assert theo TÊN đỏ giả —
      // pg-planner-index-assert-trap đúng nghĩa đen). Vế "biểu thức đúng từng ký tự vào Index Cond"
      // đã đo tất định ở (1) owner; vế app role chỉ đảm bảo được: có Index Cond company_id (chặn
      // seq-scan cross-tenant), không hơn.
      const emailApp = await appPlanOf(
        `SELECT id FROM candidates WHERE company_id = $1 AND lower(email) = lower($2)`,
        [A.companyId, "bulk-1@x.test"],
      );
      expect(emailApp, "app role: check-duplicate email không được seq-scan").not.toContain(
        "Seq Scan on candidates",
      );
      expect(
        emailApp,
        "app role: check-duplicate email phải vào index qua tiền tố company_id",
      ).toMatch(/Index Cond: \(company_id = /);
      const phoneApp = await appPlanOf(
        `SELECT id FROM candidates
          WHERE company_id = $1 AND regexp_replace(phone, '[^0-9+]', '', 'g') = $2`,
        [A.companyId, "0901000001"],
      );
      expect(phoneApp, "app role: check-duplicate phone không được seq-scan").not.toContain(
        "Seq Scan on candidates",
      );
      expect(
        phoneApp,
        "app role: check-duplicate phone phải vào index qua tiền tố company_id",
      ).toMatch(/Index Cond: \(company_id = /);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // I. idempotency — chạy lại NGUYÊN 0560 + 0561 qua owner (0559 là DDL có tiền kiểm, cố ý KHÔNG chạy lại)
  // ─────────────────────────────────────────────────────────────────────────────
  describe("I. idempotency 0560 + 0561 (chạy lại nguyên file qua owner)", () => {
    it("I1 chạy lại toàn bộ 0560 + 0561 ⇒ 0 exception, count roles/permissions/grants/events/templates/audit_def KHÔNG đổi", async () => {
      const COUNTS = `
        SELECT
          (SELECT count(*) FROM roles WHERE name = 'recruiter' AND company_id IS NULL AND deleted_at IS NULL) AS roles,
          (SELECT count(*) FROM permissions
            WHERE resource_type IN ('recruit','job-opening','candidate','interview','offer'))                  AS perms,
          (SELECT count(*) FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
             JOIN roles r ON r.id = rp.role_id
            WHERE p.resource_type IN ('recruit','job-opening','candidate','interview','offer')
              AND r.company_id IS NULL)                                                                       AS grants,
          (SELECT count(*) FROM notification_events
            WHERE company_id IS NULL AND deleted_at IS NULL AND module_code = 'RECRUIT')                      AS events,
          (SELECT count(*) FROM notification_templates t JOIN notification_events e ON e.id = t.event_id
            WHERE t.company_id IS NULL AND t.deleted_at IS NULL AND e.company_id IS NULL AND e.module_code = 'RECRUIT') AS templates,
          (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'audit_logs_object_type_chk')   AS audit_def`;
      const before = (await direct.query(COUNTS)).rows[0];
      for (const file of [
        "0560_s12recruitdb1_seed_role_perms_audit.sql",
        "0561_s12recruitdb1_noti_recruit.sql",
      ]) {
        const sql = readFileSync(path.join(__dirname, "..", "..", "migrations", file), "utf8");
        for (const stmt of sql.split("--> statement-breakpoint")) {
          if (
            stmt
              .trim()
              .replace(/^--.*$/gm, "")
              .trim().length === 0
          )
            continue;
          await direct.query(stmt);
        }
      }
      const after = (await direct.query(COUNTS)).rows[0];
      expect(after).toEqual(before);
    });
  });
});
