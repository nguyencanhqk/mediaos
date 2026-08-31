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
 * S12-RECRUIT-DB-1 (mig 0559 · 0560 · 0561) — CHỐT HỒI QUY cho nền dữ liệu RECRUIT
 * (DB-14 §6/§9 · SPEC-12 §11/§17/§18 · permission-matrix §9f).
 *
 * VÌ SAO FILE NÀY TỒN TẠI. Migration tự verify bằng khối DO/RAISE EXCEPTION, nhưng verify đó chỉ chạy ĐÚNG
 * MỘT LẦN lúc migrate. Sau khi merge, một WO sau `GRANT UPDATE ON candidate_stage_events` (giết sổ
 * append-only), `GRANT DELETE ON candidates`, `GRANT UPDATE ON offers` cấp bảng (mở luôn `candidate_id`),
 * đổi `uq_candidates_company_employee` thành partial theo `deleted_at`, hay grant `move-stage:candidate`
 * cho `employee` — KHÔNG có gì đỏ: `tenant-isolation`/`rls-registry` không phủ column-GRANT,
 * `xtenant-fk-ratchet` chỉ phủ HÌNH DẠNG FK.
 * (mirror `s11-asset-db1-invariants.int-spec.ts`; memory `reviewers-pass-real-bugs` + `tests-can-pin-a-hole-open`.)
 *
 * NƠI CHẠY: gate `hasDb`, KHÔNG gate `LANE_DB` — chạy THẬT trên CI (DATABASE_URL + DIRECT_URL ở cấp job).
 *
 * QUY TẮC: mọi ca ÂM assert `err.code` + `err.constraint` ĐÍCH DANH và có ĐỐI CHỨNG DƯƠNG trên CÙNG
 * constraint (ca âm neo theo tên vẫn xanh nếu index viết nhầm thành non-partial cùng tên — vế dương
 * "đóng offer cũ rồi mở offer mới" mới chứng minh predicate). Mọi mutation chạy trong tx ROLLBACK.
 */
describe.skipIf(!hasDb)("S12-RECRUIT-DB-1 · bất biến nền dữ liệu RECRUIT (mig 0559–0561)", () => {
  const direct = directPool();
  const app = appPool(2);
  const worker = workerPool(1);

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
  const RECRUIT_RESOURCES = ["recruit", "job-opening", "candidate", "interview", "offer"] as const;

  let A: SeededTenant;
  let B: SeededTenant;
  let userA: string;
  let userB: string;
  let empA: string;
  let empB: string;
  let orgA: string;
  let orgB: string;
  let jobA: string;
  let jobB: string;
  let candA: string;
  let candB: string;
  let noteA: string;
  let stageEventA: string;
  let interviewA: string;
  let interviewB: string;
  let participantA: string;
  let feedbackA: string;
  let offerA: string; // Draft (đang sống)

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
      // release(true) huỷ connection nếu ROLLBACK hỏng — trả connection bẩn về pool là xanh-giả hàng loạt.
      c.release(restored ? undefined : true);
    }
  }

  const asApp = <T>(companyId: string | null, fn: (c: PoolClient) => Promise<T>) =>
    withRole(app, companyId, fn);

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
  const attempt = (companyId: string | null, sql: string, params: unknown[] = []) =>
    attemptSeq(companyId, [[sql, params]]);

  /** Đóng offer đang sống ĐÚNG CÁCH: status + responded_at trong CÙNG một câu UPDATE (chk_offers_responded_pair). */
  const CLOSE_OFFER_OK = "UPDATE offers SET status='Withdrawn', responded_at=now() WHERE id=$1";

  beforeAll(async () => {
    A = await seedCompany(direct, "recruitA");
    B = await seedCompany(direct, "recruitB");
    userA = await seedUser(direct, A.companyId, `recruit-a-${A.slug}@x.test`);
    userB = await seedUser(direct, B.companyId, `recruit-b-${B.slug}@x.test`);

    const mkEmp = async (companyId: string, userId: string) =>
      (
        await direct.query(
          `INSERT INTO employee_profiles (company_id, user_id) VALUES ($1, $2) RETURNING id`,
          [companyId, userId],
        )
      ).rows[0].id as string;
    empA = await mkEmp(A.companyId, userA);
    empB = await mkEmp(B.companyId, userB);

    const mkOrg = async (companyId: string) =>
      (
        await direct.query(
          `INSERT INTO org_units (company_id, name) VALUES ($1, $2) RETURNING id`,
          [companyId, `recruit-org-${randomUUID().slice(0, 8)}`],
        )
      ).rows[0].id as string;
    orgA = await mkOrg(A.companyId);
    orgB = await mkOrg(B.companyId);

    const mkJob = async (companyId: string, orgUnitId: string, createdBy: string) =>
      (
        await direct.query(
          `INSERT INTO job_openings (company_id, title, org_unit_id, headcount, status, created_by)
           VALUES ($1, $2, $3, 2, 'Open', $4) RETURNING id`,
          [companyId, `Biên tập viên ${randomUUID().slice(0, 4)}`, orgUnitId, createdBy],
        )
      ).rows[0].id as string;
    jobA = await mkJob(A.companyId, orgA, userA);
    jobB = await mkJob(B.companyId, orgB, userB);

    const mkCand = async (companyId: string, jobId: string, stage: string) =>
      (
        await direct.query(
          `INSERT INTO candidates (company_id, job_opening_id, full_name, email, phone, stage)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [
            companyId,
            jobId,
            `Ứng viên ${randomUUID().slice(0, 4)}`,
            `cand-${randomUUID().slice(0, 8)}@x.test`,
            "+84 (90) 123-4567",
            stage,
          ],
        )
      ).rows[0].id as string;
    candA = await mkCand(A.companyId, jobA, "Offer");
    candB = await mkCand(B.companyId, jobB, "New");

    stageEventA = (
      await direct.query(
        `INSERT INTO candidate_stage_events
           (company_id, candidate_id, from_stage, to_stage, action, reason, acted_by)
         VALUES ($1, $2, 'New', 'Screening', 'move', 'Hồ sơ đạt yêu cầu', $3) RETURNING id`,
        [A.companyId, candA, userA],
      )
    ).rows[0].id as string;

    noteA = (
      await direct.query(
        `INSERT INTO candidate_notes (company_id, candidate_id, body, created_by)
         VALUES ($1, $2, 'Ghi chú nội bộ', $3) RETURNING id`,
        [A.companyId, candA, userA],
      )
    ).rows[0].id as string;

    const mkInterview = async (companyId: string, candidateId: string, createdBy: string) =>
      (
        await direct.query(
          `INSERT INTO interviews (company_id, candidate_id, round, starts_at, ends_at, status, created_by)
           VALUES ($1, $2, 1, now() + interval '1 day', now() + interval '1 day 1 hour', 'Scheduled', $3)
           RETURNING id`,
          [companyId, candidateId, createdBy],
        )
      ).rows[0].id as string;
    interviewA = await mkInterview(A.companyId, candA, userA);
    interviewB = await mkInterview(B.companyId, candB, userB);

    participantA = (
      await direct.query(
        `INSERT INTO interview_participants (company_id, interview_id, employee_id)
         VALUES ($1, $2, $3) RETURNING id`,
        [A.companyId, interviewA, empA],
      )
    ).rows[0].id as string;

    feedbackA = (
      await direct.query(
        `INSERT INTO interview_feedbacks
           (company_id, interview_id, interviewer_employee_id, rating, comment, recommendation)
         VALUES ($1, $2, $3, 4, 'Nền tảng tốt', 'Hire') RETURNING id`,
        [A.companyId, interviewA, empA],
      )
    ).rows[0].id as string;

    offerA = (
      await direct.query(
        `INSERT INTO offers (company_id, candidate_id, title, start_date, salary, status, created_by)
         VALUES ($1, $2, 'Biên tập viên', CURRENT_DATE + 30, 25000000.00, 'Draft', $3) RETURNING id`,
        [A.companyId, candA, userA],
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
  // A. BẤT BIẾN #2 — append-only / chỉ-INSERT / UPDATE cấp cột, ép ở TẦNG DB bằng GRANT
  // ─────────────────────────────────────────────────────────────────────────────
  describe("A. GRANT: sổ append-only 0 UPDATE/DELETE · 0 DELETE toàn bộ 8 bảng · UPDATE cấp cột · worker chỉ SELECT", () => {
    it("A1 candidate_stage_events: app role KHÔNG UPDATE, KHÔNG DELETE — 42501 (đối chứng: INSERT + SELECT OK)", async () => {
      const upd = await attempt(
        A.companyId,
        "UPDATE candidate_stage_events SET reason='sửa lịch sử' WHERE id=$1",
        [stageEventA],
      );
      expect(upd.code, `UPDATE sổ append-only phải bị chặn: ${upd.message}`).toBe("42501");

      const del = await attempt(A.companyId, "DELETE FROM candidate_stage_events WHERE id=$1", [
        stageEventA,
      ]);
      expect(del.code, `DELETE sổ append-only phải bị chặn: ${del.message}`).toBe("42501");

      // ĐỐI CHỨNG DƯƠNG trên CÙNG bảng: đường ghi hợp lệ (INSERT) vẫn mở, nếu không thì ca âm ở trên
      // chỉ đang chứng minh "app role không đọc/ghi được gì" chứ không chứng minh append-only.
      const ins = await attempt(
        A.companyId,
        `INSERT INTO candidate_stage_events (company_id, candidate_id, from_stage, to_stage, action, reason)
         VALUES ($1, $2, 'Screening', 'Interview', 'move', 'Qua vòng sàng lọc')`,
        [A.companyId, candA],
      );
      expect(ins.code, `INSERT vào sổ phải OK: ${ins.message}`).toBeNull();

      const sel = await asApp(A.companyId, (c) =>
        c.query("SELECT count(*)::int AS n FROM candidate_stage_events WHERE candidate_id=$1", [
          candA,
        ]),
      );
      expect(sel.rows[0].n).toBeGreaterThanOrEqual(1);
    });

    it("A2 interview_participants: KHÔNG UPDATE/DELETE — 42501 (đối chứng: INSERT người khác OK)", async () => {
      const upd = await attempt(
        A.companyId,
        "UPDATE interview_participants SET employee_id=$1 WHERE id=$2",
        [empA, participantA],
      );
      expect(upd.code).toBe("42501");
      const del = await attempt(A.companyId, "DELETE FROM interview_participants WHERE id=$1", [
        participantA,
      ]);
      expect(del.code).toBe("42501");

      // Đổi người = huỷ lượt + tạo lượt mới (SPEC-12 §3.6) ⇒ đường hợp lệ duy nhất là INSERT.
      const emp2 = (
        await direct.query(
          `INSERT INTO employee_profiles (company_id, user_id) VALUES ($1, $2) RETURNING id`,
          [
            A.companyId,
            await seedUser(direct, A.companyId, `recruit-p2-${randomUUID().slice(0, 8)}@x.test`),
          ],
        )
      ).rows[0].id as string;
      const ins = await attempt(
        A.companyId,
        `INSERT INTO interview_participants (company_id, interview_id, employee_id) VALUES ($1, $2, $3)`,
        [A.companyId, interviewA, emp2],
      );
      expect(ins.code, `INSERT participant phải OK: ${ins.message}`).toBeNull();
    });

    it("A3 UPDATE cấp cột: offers/interview_feedbacks — cột ngoài allowlist 42501, cột trong allowlist OK", async () => {
      // `candidate_id` KHÔNG nằm trong allowlist: đổi chủ offer là đường vòng qua mọi luật FSM/scope.
      const badOffer = await attempt(A.companyId, "UPDATE offers SET candidate_id=$1 WHERE id=$2", [
        candA,
        offerA,
      ]);
      expect(badOffer.code, `UPDATE offers.candidate_id phải bị chặn: ${badOffer.message}`).toBe(
        "42501",
      );
      const badFb = await attempt(
        A.companyId,
        "UPDATE interview_feedbacks SET interviewer_employee_id=$1 WHERE id=$2",
        [empA, feedbackA],
      );
      expect(badFb.code, `UPDATE feedback.interviewer phải bị chặn: ${badFb.message}`).toBe(
        "42501",
      );
      // created_at cũng ngoài allowlist (không được viết lại dấu thời gian sổ).
      const badFbTime = await attempt(
        A.companyId,
        "UPDATE interview_feedbacks SET created_at=now() WHERE id=$1",
        [feedbackA],
      );
      expect(badFbTime.code).toBe("42501");

      // ĐỐI CHỨNG DƯƠNG: cột TRONG allowlist ghi được ⇒ ca âm không phải "app role không UPDATE được gì".
      const okOffer = await attempt(A.companyId, CLOSE_OFFER_OK, [offerA]);
      expect(okOffer.code, `UPDATE offers (allowlist) phải OK: ${okOffer.message}`).toBeNull();
      const okFb = await attempt(
        A.companyId,
        "UPDATE interview_feedbacks SET rating=5, recommendation='Hire', updated_at=now() WHERE id=$1",
        [feedbackA],
      );
      expect(okFb.code, `UPDATE feedback (allowlist) phải OK: ${okFb.message}`).toBeNull();
    });

    it("A4 KHÔNG bảng RECRUIT nào cho app role DELETE — 42501 cả 8 (soft delete = UPDATE deleted_at)", async () => {
      for (const table of RECRUIT_TABLES) {
        const out = await attempt(A.companyId, `DELETE FROM ${table} WHERE company_id=$1`, [
          A.companyId,
        ]);
        expect(out.code, `${table}: DELETE phải bị chặn (${out.message})`).toBe("42501");
      }
      // Đối chứng: soft delete của bảng CÓ đường ghi (candidate_notes — RECRUIT-API-017) chạy được.
      const soft = await attempt(
        A.companyId,
        "UPDATE candidate_notes SET deleted_at=now(), deleted_by=$1 WHERE id=$2",
        [userA, noteA],
      );
      expect(soft.code, `soft delete note phải OK: ${soft.message}`).toBeNull();
    });

    it("A5 mediaos_worker: SELECT OK, INSERT/UPDATE/DELETE 42501 trên cả 8 bảng", async () => {
      for (const table of RECRUIT_TABLES) {
        const sel = await attemptSeq(A.companyId, [[`SELECT count(*) FROM ${table}`]], worker);
        expect(sel.code, `${table}: worker phải SELECT được (${sel.message})`).toBeNull();
        const del = await attemptSeq(
          A.companyId,
          [[`DELETE FROM ${table} WHERE company_id=$1`, [A.companyId]]],
          worker,
        );
        expect(del.code, `${table}: worker KHÔNG được DELETE`).toBe("42501");
      }
      const upd = await attemptSeq(
        A.companyId,
        [["UPDATE candidates SET stage='Hired' WHERE id=$1", [candA]]],
        worker,
      );
      expect(upd.code).toBe("42501");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // B. Composite tenant FK — 23503 đích danh (kiểm tra FK của Postgres KHÔNG áp RLS — KI-046)
  // ─────────────────────────────────────────────────────────────────────────────
  describe("B. composite tenant FK chặn tham chiếu chéo tenant — 23503 đích danh", () => {
    it("B1 candidates.job_opening_id của tenant B → 23503 candidates_job_opening_tenant_fk (cùng tenant OK)", async () => {
      const bad = await attempt(
        A.companyId,
        `INSERT INTO candidates (company_id, job_opening_id, full_name) VALUES ($1, $2, 'x')`,
        [A.companyId, jobB],
      );
      expect(bad.code).toBe("23503");
      expect(bad.constraint).toBe("candidates_job_opening_tenant_fk");

      const ok = await attempt(
        A.companyId,
        `INSERT INTO candidates (company_id, job_opening_id, full_name) VALUES ($1, $2, 'x')`,
        [A.companyId, jobA],
      );
      expect(ok.code, `cùng tenant phải OK: ${ok.message}`).toBeNull();
    });

    it("B2 interview_participants.employee_id của tenant B → 23503 interview_participants_employee_tenant_fk", async () => {
      const bad = await attempt(
        A.companyId,
        `INSERT INTO interview_participants (company_id, interview_id, employee_id) VALUES ($1, $2, $3)`,
        [A.companyId, interviewA, empB],
      );
      expect(bad.code).toBe("23503");
      expect(bad.constraint).toBe("interview_participants_employee_tenant_fk");
    });

    it("B3 candidate_stage_events.acted_by = user tenant B → 23503 (sổ chỉ-INSERT, FK NO ACTION)", async () => {
      const bad = await attempt(
        A.companyId,
        `INSERT INTO candidate_stage_events (company_id, candidate_id, from_stage, to_stage, action, reason, acted_by)
         VALUES ($1, $2, 'New', 'Screening', 'move', 'x', $3)`,
        [A.companyId, candA, userB],
      );
      expect(bad.code).toBe("23503");
      expect(bad.constraint).toBe("candidate_stage_events_acted_by_tenant_fk");
    });

    it("B4 offers.candidate_id + interview_feedbacks.interview_id chéo tenant → 23503 đúng tên FK", async () => {
      const badOffer = await attempt(
        A.companyId,
        `INSERT INTO offers (company_id, candidate_id, start_date, salary) VALUES ($1, $2, CURRENT_DATE + 10, 1)`,
        [A.companyId, candB],
      );
      expect(badOffer.code).toBe("23503");
      expect(badOffer.constraint).toBe("offers_candidate_tenant_fk");

      const badFb = await attempt(
        A.companyId,
        `INSERT INTO interview_feedbacks (company_id, interview_id, interviewer_employee_id, rating, recommendation)
         VALUES ($1, $2, $3, 3, 'Consider')`,
        [A.companyId, interviewB, empA],
      );
      expect(badFb.code).toBe("23503");
      expect(badFb.constraint).toBe("interview_feedbacks_interview_tenant_fk");
    });

    it("B5 employee_id của candidates trỏ nhân viên tenant B → 23503 candidates_employee_tenant_fk", async () => {
      const bad = await attempt(A.companyId, "UPDATE candidates SET employee_id=$1 WHERE id=$2", [
        empB,
        candA,
      ]);
      expect(bad.code).toBe("23503");
      expect(bad.constraint).toBe("candidates_employee_tenant_fk");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // C. UNIQUE / partial unique — 23505 đích danh + vế DƯƠNG chứng minh predicate
  // ─────────────────────────────────────────────────────────────────────────────
  describe("C. unique — 23505 đích danh + vế DƯƠNG chứng minh predicate", () => {
    it("C1 hai offer sống/ứng viên → 23505 uq_offers_candidate_open; đóng offer cũ rồi mở mới → OK", async () => {
      const dup = await attempt(
        A.companyId,
        `INSERT INTO offers (company_id, candidate_id, start_date, salary, status)
         VALUES ($1, $2, CURRENT_DATE + 30, 1000000, 'Sent')`,
        [A.companyId, candA],
      );
      expect(dup.code).toBe("23505");
      expect(dup.constraint).toBe("uq_offers_candidate_open");

      // VẾ DƯƠNG: predicate `status IN ('Draft','Sent')` phải THẬT — nếu index bị viết non-partial cùng tên,
      // chuỗi này cũng đỏ và ca C1 sẽ bắt được.
      const reopen = await attemptSeq(A.companyId, [
        [CLOSE_OFFER_OK, [offerA]],
        [
          `INSERT INTO offers (company_id, candidate_id, start_date, salary, status)
           VALUES ($1, $2, CURRENT_DATE + 45, 1000000, 'Draft')`,
          [A.companyId, candA],
        ],
      ]);
      expect(reopen.code, `đóng rồi mở offer mới phải OK: ${reopen.message}`).toBeNull();
    });

    it("C2 uq_candidates_company_employee CHẶN cả khi hồ sơ trước ĐÃ XOÁ MỀM (KHÔNG partial theo deleted_at)", async () => {
      const emp2 = (
        await direct.query(
          `INSERT INTO employee_profiles (company_id, user_id) VALUES ($1, $2) RETURNING id`,
          [
            A.companyId,
            await seedUser(direct, A.companyId, `recruit-c2-${randomUUID().slice(0, 8)}@x.test`),
          ],
        )
      ).rows[0].id as string;

      // Link lần 1 → xoá MỀM hồ sơ → link lần 2 cho hồ sơ khác: PHẢI vẫn 23505 (REC-DEC-005).
      const out = await attemptSeq(A.companyId, [
        ["UPDATE candidates SET employee_id=$1 WHERE id=$2", [emp2, candA]],
        ["UPDATE candidates SET deleted_at=now() WHERE id=$1", [candA]],
        [
          `INSERT INTO candidates (company_id, job_opening_id, full_name, employee_id)
           VALUES ($1, $2, 'trùng nhân viên', $3)`,
          [A.companyId, jobA, emp2],
        ],
      ]);
      expect(out.code, "hồ sơ đã xoá mềm VẪN giữ chỗ link nhân viên").toBe("23505");
      expect(out.constraint).toBe("uq_candidates_company_employee");

      // VẾ DƯƠNG: employee_id NULL không bị unique chạm (partial `WHERE employee_id IS NOT NULL`).
      const twoNulls = await attemptSeq(A.companyId, [
        [
          `INSERT INTO candidates (company_id, job_opening_id, full_name) VALUES ($1, $2, 'null-1')`,
          [A.companyId, jobA],
        ],
        [
          `INSERT INTO candidates (company_id, job_opening_id, full_name) VALUES ($1, $2, 'null-2')`,
          [A.companyId, jobA],
        ],
      ]);
      expect(twoNulls.code, `hai hồ sơ employee_id NULL phải OK: ${twoNulls.message}`).toBeNull();
    });

    it("C3 feedback lần 2 của CÙNG interviewer trên CÙNG lượt → 23505 uq_interview_feedbacks (interviewer khác OK)", async () => {
      const dup = await attempt(
        A.companyId,
        `INSERT INTO interview_feedbacks (company_id, interview_id, interviewer_employee_id, rating, recommendation)
         VALUES ($1, $2, $3, 2, 'No Hire')`,
        [A.companyId, interviewA, empA],
      );
      expect(dup.code).toBe("23505");
      expect(dup.constraint).toBe("uq_interview_feedbacks");

      const emp2 = (
        await direct.query(
          `INSERT INTO employee_profiles (company_id, user_id) VALUES ($1, $2) RETURNING id`,
          [
            A.companyId,
            await seedUser(direct, A.companyId, `recruit-c3-${randomUUID().slice(0, 8)}@x.test`),
          ],
        )
      ).rows[0].id as string;
      const ok = await attempt(
        A.companyId,
        `INSERT INTO interview_feedbacks (company_id, interview_id, interviewer_employee_id, rating, recommendation)
         VALUES ($1, $2, $3, 3, 'Consider')`,
        [A.companyId, interviewA, emp2],
      );
      expect(ok.code, `interviewer khác phải OK: ${ok.message}`).toBeNull();
    });

    it("C4 participant trùng (lượt, nhân viên) → 23505 uq_interview_participants", async () => {
      const dup = await attempt(
        A.companyId,
        `INSERT INTO interview_participants (company_id, interview_id, employee_id) VALUES ($1, $2, $3)`,
        [A.companyId, interviewA, empA],
      );
      expect(dup.code).toBe("23505");
      expect(dup.constraint).toBe("uq_interview_participants");
    });

    it("C5 email/phone ứng viên CỐ Ý KHÔNG unique — trùng là cảnh báo mềm, KHÔNG lỗi (DB-14 §4.8)", async () => {
      const row = await direct.query("SELECT email, phone FROM candidates WHERE id=$1", [candA]);
      const out = await attempt(
        A.companyId,
        `INSERT INTO candidates (company_id, job_opening_id, full_name, email, phone)
         VALUES ($1, $2, 'nộp lại sau 6 tháng', $3, $4)`,
        [A.companyId, jobA, row.rows[0].email, row.rows[0].phone],
      );
      expect(out.code, `trùng email/phone KHÔNG được là lỗi DB: ${out.message}`).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // D. CHECK — 23514 đích danh
  // ─────────────────────────────────────────────────────────────────────────────
  describe("D. CHECK — 23514 đích danh", () => {
    it("D1 chk_offers_responded_pair HAI CHIỀU: terminal thiếu responded_at · Draft có responded_at", async () => {
      const noTs = await attempt(A.companyId, "UPDATE offers SET status='Accepted' WHERE id=$1", [
        offerA,
      ]);
      expect(noTs.code).toBe("23514");
      expect(noTs.constraint).toBe("chk_offers_responded_pair");

      const draftWithTs = await attempt(
        A.companyId,
        `INSERT INTO offers (company_id, candidate_id, start_date, salary, status, responded_at)
         VALUES ($1, $2, CURRENT_DATE + 5, 1, 'Draft', now())`,
        [A.companyId, candA],
      );
      expect(draftWithTs.code).toBe("23514");
      expect(draftWithTs.constraint).toBe("chk_offers_responded_pair");

      // VẾ DƯƠNG: MỘT câu UPDATE đặt cả hai ⇒ OK (hệ quả hợp đồng cho WO BE).
      const ok = await attempt(
        A.companyId,
        "UPDATE offers SET status='Accepted', responded_at=now() WHERE id=$1",
        [offerA],
      );
      expect(ok.code, `status + responded_at cùng câu phải OK: ${ok.message}`).toBeNull();
    });

    it("D2 chk_cse_moved: from_stage = to_stage bị chặn (move tới chính stage hiện tại)", async () => {
      const same = await attempt(
        A.companyId,
        `INSERT INTO candidate_stage_events (company_id, candidate_id, from_stage, to_stage, action, reason)
         VALUES ($1, $2, 'Offer', 'Offer', 'move', 'x')`,
        [A.companyId, candA],
      );
      expect(same.code).toBe("23514");
      expect(same.constraint).toBe("chk_cse_moved");
    });

    it("D3 chk_feedback_rating: biên 1 và 5 OK; 0 và 6 → 23514", async () => {
      for (const [rating, expected] of [
        [0, "23514"],
        [6, "23514"],
      ] as const) {
        const emp = (
          await direct.query(
            `INSERT INTO employee_profiles (company_id, user_id) VALUES ($1, $2) RETURNING id`,
            [
              A.companyId,
              await seedUser(direct, A.companyId, `recruit-r-${randomUUID().slice(0, 8)}@x.test`),
            ],
          )
        ).rows[0].id as string;
        const out = await attempt(
          A.companyId,
          `INSERT INTO interview_feedbacks (company_id, interview_id, interviewer_employee_id, rating, recommendation)
           VALUES ($1, $2, $3, $4, 'Consider')`,
          [A.companyId, interviewA, emp, rating],
        );
        expect(out.code, `rating=${rating}`).toBe(expected);
        expect(out.constraint).toBe("chk_feedback_rating");
      }
      for (const rating of [1, 5]) {
        const emp = (
          await direct.query(
            `INSERT INTO employee_profiles (company_id, user_id) VALUES ($1, $2) RETURNING id`,
            [
              A.companyId,
              await seedUser(direct, A.companyId, `recruit-ok-${randomUUID().slice(0, 8)}@x.test`),
            ],
          )
        ).rows[0].id as string;
        const out = await attempt(
          A.companyId,
          `INSERT INTO interview_feedbacks (company_id, interview_id, interviewer_employee_id, rating, recommendation)
           VALUES ($1, $2, $3, $4, 'Consider')`,
          [A.companyId, interviewA, emp, rating],
        );
        expect(out.code, `rating=${rating} phải OK: ${out.message}`).toBeNull();
      }
    });

    it("D4 chk_interviews_range: ends_at ≤ starts_at → 23514 (bằng nhau cũng đỏ)", async () => {
      const out = await attempt(
        A.companyId,
        `INSERT INTO interviews (company_id, candidate_id, starts_at, ends_at)
         VALUES ($1, $2, now() + interval '1 day', now() + interval '1 day')`,
        [A.companyId, candA],
      );
      expect(out.code).toBe("23514");
      expect(out.constraint).toBe("chk_interviews_range");
    });

    it("D5 giá trị enum ngoài tập → 23514 đúng tên CHECK (stage · job status · interview status · reco · action)", async () => {
      const cases: Array<[string, string, unknown[], string]> = [
        [
          "candidates.stage",
          `INSERT INTO candidates (company_id, job_opening_id, full_name, stage) VALUES ($1, $2, 'x', 'Onboarding')`,
          [A.companyId, jobA],
          "chk_candidates_stage",
        ],
        [
          "job_openings.status",
          `INSERT INTO job_openings (company_id, title, org_unit_id, status) VALUES ($1, 'x', $2, 'Archived')`,
          [A.companyId, orgA],
          "chk_job_openings_status",
        ],
        [
          "interviews.status",
          `INSERT INTO interviews (company_id, candidate_id, starts_at, ends_at, status)
           VALUES ($1, $2, now(), now() + interval '1 hour', 'Deleted')`,
          [A.companyId, candA],
          "chk_interviews_status",
        ],
        [
          "candidate_stage_events.action",
          `INSERT INTO candidate_stage_events (company_id, candidate_id, from_stage, to_stage, action, reason)
           VALUES ($1, $2, 'New', 'Offer', 'import', 'x')`,
          [A.companyId, candA],
          "chk_cse_action",
        ],
        [
          "job_openings.headcount",
          `INSERT INTO job_openings (company_id, title, org_unit_id, headcount) VALUES ($1, 'x', $2, 0)`,
          [A.companyId, orgA],
          "chk_job_openings_headcount",
        ],
        [
          "offers.salary",
          `INSERT INTO offers (company_id, candidate_id, start_date, salary) VALUES ($1, $2, CURRENT_DATE, -1)`,
          [A.companyId, candA],
          "chk_offers_salary",
        ],
      ];
      for (const [label, sql, params, constraint] of cases) {
        const out = await attempt(A.companyId, sql, params);
        expect(out.code, `${label}: ${out.message}`).toBe("23514");
        expect(out.constraint, label).toBe(constraint);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // E. RLS (bất biến #1)
  // ─────────────────────────────────────────────────────────────────────────────
  describe("E. RLS", () => {
    it("E1 không GUC ⇒ 0 hàng trên cả 8 bảng; GUC A không thấy hàng của B", async () => {
      for (const table of RECRUIT_TABLES) {
        const noCtx = await asApp(null, (c) => c.query(`SELECT count(*)::int AS n FROM ${table}`));
        expect(noCtx.rows[0].n, `${table}: ngoài ngữ cảnh tenant phải 0 hàng`).toBe(0);
      }
      const aSeesB = await asApp(A.companyId, (c) =>
        c.query("SELECT count(*)::int AS n FROM candidates WHERE id = ANY($1::uuid[])", [[candB]]),
      );
      expect(aSeesB.rows[0].n, "tenant A KHÔNG được thấy ứng viên của B").toBe(0);
      const aSeesA = await asApp(A.companyId, (c) =>
        c.query("SELECT count(*)::int AS n FROM candidates WHERE id=$1", [candA]),
      );
      expect(aSeesA.rows[0].n).toBe(1);
    });

    it("E2 WITH CHECK chặn ghi hàng mang company_id của tenant khác", async () => {
      const out = await attempt(
        A.companyId,
        `INSERT INTO job_openings (company_id, title, org_unit_id) VALUES ($1, 'x', $2)`,
        [B.companyId, orgB],
      );
      expect(out.code, `WITH CHECK phải chặn: ${out.message}`).toBe("42501");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // F. seed 0560 — ma trận §9f, role recruiter, audit CHECK
  // ─────────────────────────────────────────────────────────────────────────────
  describe("F. seed 0560 — ma trận §9f, role recruiter, audit CHECK", () => {
    it("F1 đúng 42 grant §9f (census 4 hình dạng wildcard); employee 0; recruiter is_system + KHÔNG canonical", async () => {
      const total = await direct.query(
        `SELECT count(*)::int AS n
           FROM role_permissions rp
           JOIN roles r ON r.id = rp.role_id
           JOIN permissions p ON p.id = rp.permission_id
          WHERE r.name = ANY($1::text[]) AND r.company_id IS NULL AND r.deleted_at IS NULL
            AND rp.effect = 'ALLOW' AND p.resource_type = ANY($2::text[])`,
        [["employee", "manager", "hr", "company-admin", "recruiter"], [...RECRUIT_RESOURCES]],
      );
      expect(total.rows[0].n, "ma trận §9f = 42 hàng").toBe(42);

      const perRole = await direct.query(
        `SELECT r.name, count(*)::int AS n
           FROM role_permissions rp
           JOIN roles r ON r.id = rp.role_id
           JOIN permissions p ON p.id = rp.permission_id
          WHERE r.company_id IS NULL AND r.deleted_at IS NULL AND rp.effect = 'ALLOW'
            AND p.resource_type = ANY($1::text[])
          GROUP BY r.name ORDER BY r.name`,
        [[...RECRUIT_RESOURCES]],
      );
      expect(Object.fromEntries(perRole.rows.map((r) => [r.name, r.n]))).toEqual({
        manager: 3,
        hr: 7,
        "company-admin": 16,
        recruiter: 16,
      });

      // employee KHÔNG có bất kỳ grant RECRUIT nào (vắng mặt trong GROUP BY ở trên là đã đủ, nhưng nói
      // tường minh vì đây là hàng rào "nhân viên không thấy module tuyển dụng").
      const employee = await direct.query(
        `SELECT count(*)::int AS n
           FROM role_permissions rp
           JOIN roles r ON r.id = rp.role_id
           JOIN permissions p ON p.id = rp.permission_id
          WHERE r.name = 'employee' AND r.company_id IS NULL AND r.deleted_at IS NULL
            AND p.resource_type = ANY($1::text[])`,
        [[...RECRUIT_RESOURCES]],
      );
      expect(employee.rows[0].n).toBe(0);

      // CENSUS 4 HÌNH DẠNG WILDCARD: engine resolve `action IN (act,'*') AND resource IN (res,'*')`.
      // Đếm exact-shape ở trên MÙ trước hàng '*:*' — nếu ai đó seed wildcard cho role hệ thống, mọi số
      // trên vẫn xanh mà quyền thật thì rộng hơn hẳn (permission-grant-census-must-cover-four-wildcard-shapes).
      const wildcard = await direct.query(
        `SELECT count(*)::int AS n
           FROM role_permissions rp
           JOIN roles r ON r.id = rp.role_id
           JOIN permissions p ON p.id = rp.permission_id
          WHERE r.name = ANY($1::text[]) AND r.company_id IS NULL AND r.deleted_at IS NULL
            AND rp.effect = 'ALLOW' AND (p.action = '*' OR p.resource_type = '*')`,
        [["employee", "manager", "hr", "company-admin", "recruiter"]],
      );
      expect(wildcard.rows[0].n, "0 grant wildcard ⇒ census exact-shape mới đáng tin").toBe(0);

      // 7 cặp candidate sensitive, 9 cặp còn lại không.
      const sensitive = await direct.query(
        `SELECT resource_type, count(*) FILTER (WHERE is_sensitive)::int AS s, count(*)::int AS n
           FROM permissions WHERE resource_type = ANY($1::text[]) GROUP BY resource_type ORDER BY resource_type`,
        [[...RECRUIT_RESOURCES]],
      );
      const byRes = Object.fromEntries(sensitive.rows.map((r) => [r.resource_type, r]));
      expect(byRes["candidate"]).toMatchObject({ s: 7, n: 7 });
      for (const res of ["recruit", "job-opening", "interview", "offer"]) {
        expect(byRes[res].s, `${res} không được sensitive`).toBe(0);
      }

      // scope đích danh của các hàng dễ trôi nhất.
      const scopes = await direct.query(
        `SELECT r.name, p.action, p.resource_type, rp.data_scope
           FROM role_permissions rp
           JOIN roles r ON r.id = rp.role_id
           JOIN permissions p ON p.id = rp.permission_id
          WHERE r.company_id IS NULL AND r.deleted_at IS NULL AND rp.effect = 'ALLOW'
            AND p.resource_type = ANY($1::text[])
            AND (p.action IN ('access', 'feedback', 'convert', 'export', 'move-stage'))
          ORDER BY r.name, p.action`,
        [[...RECRUIT_RESOURCES]],
      );
      const key = (r: { name: string; action: string; resource_type: string }) =>
        `${r.name}|${r.action}:${r.resource_type}`;
      const scopeMap = Object.fromEntries(scopes.rows.map((r) => [key(r), r.data_scope]));
      // feedback @Own cho MỌI role (kể cả admin/recruiter) — SPEC-12 §11.
      expect(scopeMap["manager|feedback:interview"]).toBe("Own");
      expect(scopeMap["hr|feedback:interview"]).toBe("Own");
      expect(scopeMap["company-admin|feedback:interview"]).toBe("Own");
      expect(scopeMap["recruiter|feedback:interview"]).toBe("Own");
      // access @Own cho cả 4 role có mặt.
      expect(scopeMap["manager|access:recruit"]).toBe("Own");
      expect(scopeMap["recruiter|access:recruit"]).toBe("Own");
      // hr có convert @Company nhưng KHÔNG có export/move-stage.
      expect(scopeMap["hr|convert:candidate"]).toBe("Company");
      expect(scopeMap["hr|export:candidate"]).toBeUndefined();
      expect(scopeMap["hr|move-stage:candidate"]).toBeUndefined();
      expect(scopeMap["recruiter|export:candidate"]).toBe("Company");
      expect(scopeMap["recruiter|move-stage:candidate"]).toBe("Company");

      // role recruiter: hệ thống, 2FA không bắt buộc, id cố định — và KHÔNG canonical.
      const role = await direct.query(
        `SELECT id, is_system, requires_two_factor FROM roles
          WHERE name='recruiter' AND company_id IS NULL AND deleted_at IS NULL`,
      );
      expect(role.rowCount).toBe(1);
      expect(role.rows[0]).toMatchObject({
        id: "00000000-0000-0000-0000-000000000014",
        is_system: true,
        requires_two_factor: false,
      });
      expect(DASH_CANONICAL_ROLES as readonly string[]).not.toContain("recruiter");
      expect(NOTI_CANONICAL_ROLES as readonly string[]).not.toContain("recruiter");
    });

    it("F2 CHECK audit_logs.object_type chứa 4 giá trị RECRUIT VÀ canary cũ ('employee'/'user'/'asset') còn (NO-LOSS)", async () => {
      const def = (
        await direct.query(
          `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
            WHERE conrelid='audit_logs'::regclass AND contype='c' AND conname LIKE '%object_type%'`,
        )
      ).rows[0].def as string;
      for (const v of ["job_opening", "candidate", "interview", "offer"]) {
        expect(def, `CHECK phải chứa '${v}'`).toMatch(new RegExp(`[,{']${v}[',}]`));
      }
      // NO-LOSS: union chỉ-tăng — giá trị của module TRƯỚC không được biến mất.
      for (const v of ["employee", "user", "asset", "meeting_room"]) {
        expect(def, `NO-LOSS: '${v}' phải còn`).toMatch(new RegExp(`[,{']${v}[',}]`));
      }
      // Bản đồ ĐÓNG (SPEC-12 §12): KHÔNG có object_type riêng cho ghi chú / feedback.
      for (const v of ["candidate_note", "interview_feedback"]) {
        expect(def, `bản đồ đóng: KHÔNG được có '${v}'`).not.toMatch(new RegExp(`[,{']${v}[',}]`));
      }
    });

    it("F3 modules.RECRUIT vẫn tồn tại; 0560 KHÔNG bật cờ (S12-RECRUIT-FE-1 mới bật)", async () => {
      const row = await direct.query(
        `SELECT is_active FROM modules WHERE module_code='RECRUIT' AND deleted_at IS NULL`,
      );
      expect(row.rowCount, "hàng RECRUIT pre-seed từ 0435 phải còn").toBe(1);
      expect(row.rows[0].is_active, "WO DB KHÔNG bật module").toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // G. seed 0561 — NOTI
  // ─────────────────────────────────────────────────────────────────────────────
  describe("G. seed 0561 — NOTI", () => {
    it("G1 notifications nhận module_code='RECRUIT'/notification_type='Recruit'; giá trị lạ → 23514 đích danh", async () => {
      const ok = await attempt(
        A.companyId,
        `INSERT INTO notifications (company_id, user_id, module_code, notification_type, title, body)
         VALUES ($1, $2, 'RECRUIT', 'Recruit', 'Ứng viên trúng tuyển', 'x')`,
        [A.companyId, userA],
      );
      expect(ok.code, `vế notifications phải được nới CHECK: ${ok.message}`).toBeNull();

      const badModule = await attempt(
        A.companyId,
        `INSERT INTO notifications (company_id, user_id, module_code, notification_type, title, body)
         VALUES ($1, $2, 'RECRUITING', 'Recruit', 'x', 'x')`,
        [A.companyId, userA],
      );
      expect(badModule.code).toBe("23514");
      expect(badModule.constraint).toBe("chk_notifications_module_code");

      const badType = await attempt(
        A.companyId,
        `INSERT INTO notifications (company_id, user_id, module_code, notification_type, title, body)
         VALUES ($1, $2, 'RECRUIT', 'Recruitment', 'x', 'x')`,
        [A.companyId, userA],
      );
      expect(badType.code).toBe("23514");
      expect(badType.constraint).toBe("chk_notifications_notification_type");
    });

    it("G2 4 event global DedupeKey/enabled + 4 template có target_url + variables_schema, KHÔNG PII", async () => {
      const events = await direct.query(
        `SELECT event_code, default_priority, dedupe_strategy, dedupe_window_seconds, is_enabled, is_system_event
           FROM notification_events
          WHERE company_id IS NULL AND deleted_at IS NULL AND module_code='RECRUIT'
          ORDER BY event_code`,
      );
      expect(events.rowCount).toBe(4);
      for (const row of events.rows) {
        // 'None' làm computeKey trả NULL ⇒ tầng dedupe BIẾN MẤT (0479/0507/0538:707).
        expect(row.dedupe_strategy, row.event_code).toBe("DedupeKey");
        expect(row.dedupe_window_seconds, row.event_code).toBeNull();
        expect(row.is_enabled).toBe(true);
        // RECRUIT v1 KHÔNG có system job — mọi event đều event-driven (có actor để trừ).
        expect(row.is_system_event, row.event_code).toBe(false);
      }
      expect(
        Object.fromEntries(events.rows.map((r) => [r.event_code, r.default_priority])),
      ).toEqual({
        RECRUIT_CANDIDATE_HIRED: "Normal",
        RECRUIT_INTERVIEW_SCHEDULED: "High",
        RECRUIT_JOB_ASSIGNED: "Normal",
        RECRUIT_STAGE_CHANGED: "Normal",
      });

      const tmpl = await direct.query(
        `SELECT t.template_code, t.target_url_template, t.variables_schema,
                t.title_template, t.body_template, t.short_body_template
           FROM notification_templates t JOIN notification_events e ON e.id = t.event_id
          WHERE t.company_id IS NULL AND t.deleted_at IS NULL AND e.company_id IS NULL
            AND e.module_code='RECRUIT'`,
      );
      expect(tmpl.rowCount).toBe(4);
      for (const row of tmpl.rows) {
        expect(row.target_url_template, row.template_code).toBeTruthy();
        expect(row.variables_schema, row.template_code).toBeTruthy();
        // BẤT BIẾN #3 / SPEC-12 §18 — payload NOTI KHÔNG email/phone/lương; full_name là projection DUY NHẤT.
        const blob = [
          row.title_template,
          row.body_template,
          row.short_body_template ?? "",
          JSON.stringify(row.variables_schema),
        ].join(" ");
        expect(blob, `${row.template_code} rò PII/lương`).not.toMatch(
          /email|phone|salary|luong|lương|sdt/i,
        );
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // H. idempotency 0560 + 0561 (chạy lại NGUYÊN file qua owner)
  // ─────────────────────────────────────────────────────────────────────────────
  describe("H. idempotency 0560 + 0561 (chạy lại NGUYÊN file qua owner)", () => {
    it("H1 chạy lại toàn bộ 0560 + 0561 ⇒ 0 exception, count roles/permissions/role_permissions/events/templates KHÔNG đổi", async () => {
      const COUNTS = `
        -- CHỈ đếm hàng DO WO NÀY sở hữu — đếm cả catalog dễ đỏ-giả khi spec khác seed global song song.
        SELECT
          (SELECT count(*) FROM roles WHERE name = 'recruiter' AND company_id IS NULL AND deleted_at IS NULL) AS roles,
          (SELECT count(*) FROM permissions
            WHERE resource_type IN ('recruit','job-opening','candidate','interview','offer'))                 AS perms,
          (SELECT count(*) FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
            WHERE p.resource_type IN ('recruit','job-opening','candidate','interview','offer'))               AS grants,
          (SELECT count(*) FROM notification_events
            WHERE company_id IS NULL AND deleted_at IS NULL AND module_code = 'RECRUIT')                      AS events,
          (SELECT count(*) FROM notification_templates t JOIN notification_events e ON e.id = t.event_id
            WHERE t.company_id IS NULL AND t.deleted_at IS NULL AND e.company_id IS NULL
              AND e.module_code = 'RECRUIT')                                                                  AS templates,
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

  // ─────────────────────────────────────────────────────────────────────────────
  // I. Index check-duplicate ĐI QUA index biểu-thức (DoD DB-14 §6.2 — không assert chay)
  // ─────────────────────────────────────────────────────────────────────────────
  describe("I. index biểu-thức của check-duplicate", () => {
    it("I1 EXPLAIN hai truy vấn duplicate dùng idx_candidates_company_email_expr / _phone_norm", async () => {
      // Bảng test nhỏ ⇒ planner chọn seq-scan dù index đúng. `enable_seqscan=off` buộc nó cho biết CÓ
      // dùng được index cho ĐÚNG biểu thức này không — đó là mệnh đề cần chứng minh
      // (pg-planner-index-assert-trap: assert chay "index tồn tại" không nói gì về việc query khớp nó).
      const plans = await withRole(direct, null, async (c) => {
        await c.query("ANALYZE candidates");
        await c.query("SET LOCAL enable_seqscan = off");
        const email = await c.query(
          `EXPLAIN (FORMAT JSON)
           SELECT id FROM candidates WHERE company_id = $1 AND lower(email) = lower($2)`,
          [A.companyId, "AI-DO@X.TEST"],
        );
        const phone = await c.query(
          `EXPLAIN (FORMAT JSON)
           SELECT id FROM candidates
            WHERE company_id = $1 AND regexp_replace(phone, '[^0-9+]', '', 'g') = $2`,
          [A.companyId, "+84901234567"],
        );
        return { email: JSON.stringify(email.rows), phone: JSON.stringify(phone.rows) };
      });
      expect(plans.email).toContain("idx_candidates_company_email_expr");
      expect(plans.phone).toContain("idx_candidates_company_phone_norm");
    });
  });
});
