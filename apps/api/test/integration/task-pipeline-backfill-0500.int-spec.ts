/**
 * S5-TASK-PIPELINE-1 (lane migration) — regression QUAN TRỌNG NHẤT của WO: migration 0500 đồng bộ
 * cột pipeline & tasks.state_id (DECISIONS-03 D-20, DB-06 §4.9/§7.4). Postgres THẬT, DB CÔ LẬP.
 *
 * Cách chạy: fixture dựng dữ liệu "hình dạng production" (project 0420-era 5 cột tiếng Anh · project
 * 0-state · project cột tự tạo thiếu nhóm) rồi RE-RUN toàn bộ SQL 0500 TRONG 1 TRANSACTION trên
 * connection riêng + ROLLBACK cuối test — hermetic, không đụng dữ liệu spec khác chạy song song
 * (0500 idempotent by-design nên re-run là hành vi hợp lệ).
 *
 * Phủ (testTasks plan rev 8):
 *   (i)   task Done + state_id NULL (tạo sau 0420) → nhảy sang cột nhóm completed.
 *         Fixture TUYỆT ĐỐI KHÔNG tự set state_id cho nhóm này (bẫy M2 — lệch pha là THẬT).
 *   (ii)  task task_status NULL nhưng state_id ĐÃ trỏ nhóm completed (trước 0478) → GIỮ NGUYÊN
 *         (không bị đẩy về Todo).
 *   (iii) task state_id trỏ đúng cột theo task_status → GIỮ NGUYÊN.
 *   (iv)  HEAL: task In Progress nhưng state_id trỏ cột completed (cửa sổ pre-0499 của reverse-sync
 *         lane fsm) → re-map về cột nhóm started.
 *   (v)   task In Review → cột nhóm review 'Chờ duyệt' do (a3) thêm (KHÔNG phải started).
 *   (a2)  đổi tên đúng cặp (tên cũ, group); cột tự đặt tên 'Todo' nhưng group started KHÔNG bị đổi.
 *   (a3)  dồn sort tường minh: review=3, completed=4, cancelled=5 cho bộ mặc định.
 *   (a)   project 0-state có đủ bộ (5 seed + 1 review = 6); project có state không nhân đôi.
 *   Bậc thang: thiếu nhóm cancelled → rơi về is_default. Idempotent: chạy lần 2 = snapshot y hệt.
 *   0499: CHECK nhận 'review', chặn group lạ (23514).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Pool, PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, type SeededTenant } from "../helpers/seed";

const hasLaneDb = hasDb && !!process.env.LANE_DB;

const MIGRATION_0500_SQL = join(
  __dirname,
  "..",
  "..",
  "migrations",
  "0500_s5_pipeline1_backfill_states_and_state_id.sql",
);

describe.skipIf(!hasLaneDb)(
  "S5-TASK-PIPELINE-1 — migration 0500 backfill (DB cô lập LANE_DB)",
  () => {
    let direct: Pool;
    let A: SeededTenant;
    const companyIds: string[] = [];

    // P_reg — project 0420-era: 5 cột tiếng Anh sort 0-4.
    let pReg = "";
    const regCol: Record<string, string> = {}; // name → id
    let tSyncNull = ""; // (i)  Done, state NULL
    let tLegacy = ""; // (ii) status NULL, state=Done-col
    let tTodo = ""; // (iii) Todo, state=Todo-col
    let tHeal = ""; // (iv) In Progress, state=Done-col (lệch nhóm)
    let tReview = ""; // (v)  In Review, state NULL
    // P_custom — cột tự tạo, THIẾU nhóm cancelled/completed/review; có cột tên 'Todo' group started.
    let pCustom = "";
    let cIdea = ""; // Ý Tưởng (unstarted, default)
    let cQuay = ""; // Quay (started)
    let cFakeTodo = ""; // 'Todo' nhưng group started — a2 KHÔNG được đổi tên
    let tCancel = ""; // Cancelled, state NULL → is_default (thiếu nhóm cancelled)
    let tCross = ""; // In Progress, state trỏ cột started CỦA PROJECT KHÁC → heal về project mình
    // P_zero — 0 state.
    let pZero = "";
    let tZero = ""; // Done, state NULL

    async function seedProject(name: string): Promise<string> {
      const r = await direct.query(
        `INSERT INTO projects (company_id, name, status, project_status)
       VALUES ($1,$2,'active','Active') RETURNING id`,
        [A.companyId, name],
      );
      return r.rows[0].id as string;
    }

    async function seedState(
      projectId: string,
      name: string,
      group: string,
      sortOrder: number,
      isDefault = false,
    ): Promise<string> {
      const r = await direct.query(
        `INSERT INTO project_states (company_id, project_id, name, state_group, is_default, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [A.companyId, projectId, name, group, isDefault, sortOrder],
      );
      return r.rows[0].id as string;
    }

    async function seedTask(
      projectId: string | null,
      taskStatus: string | null,
      stateId: string | null,
    ): Promise<string> {
      const r = await direct.query(
        `INSERT INTO tasks (company_id, task_type, title, task_status, project_id, state_id)
       VALUES ($1,'office','T',$2,$3,$4) RETURNING id`,
        [A.companyId, taskStatus, projectId, stateId],
      );
      return r.rows[0].id as string;
    }

    beforeAll(async () => {
      direct = directPool();
      A = await seedCompany(direct, "p1mig");
      companyIds.push(A.companyId);

      pReg = await seedProject("P-reg-0420");
      for (const [name, grp, sort, def] of [
        ["Backlog", "backlog", 0, false],
        ["Todo", "unstarted", 1, true],
        ["In Progress", "started", 2, false],
        ["Done", "completed", 3, false],
        ["Cancelled", "cancelled", 4, false],
      ] as const) {
        regCol[name] = await seedState(pReg, name, grp, sort, def);
      }
      tSyncNull = await seedTask(pReg, "Done", null); // (i) KHÔNG tự set state_id
      tLegacy = await seedTask(pReg, null, regCol["Done"]);
      tTodo = await seedTask(pReg, "Todo", regCol["Todo"]);
      tHeal = await seedTask(pReg, "In Progress", regCol["Done"]);
      tReview = await seedTask(pReg, "In Review", null);

      pCustom = await seedProject("P-custom");
      cIdea = await seedState(pCustom, "Ý Tưởng", "unstarted", 1, true);
      cQuay = await seedState(pCustom, "Quay", "started", 2);
      cFakeTodo = await seedState(pCustom, "Todo", "started", 5);
      tCancel = await seedTask(pCustom, "Cancelled", null);
      // Dữ liệu hỏng: đúng nhóm started nhưng cột của P_reg — heal phải kéo về cột started P_custom.
      tCross = await seedTask(pCustom, "In Progress", regCol["In Progress"]);

      pZero = await seedProject("P-zero");
      tZero = await seedTask(pZero, "Done", null);
    }, 60000);

    afterAll(async () => {
      await cleanupTenants(direct, companyIds);
      await direct.end();
    });

    /** Chạy toàn bộ statement của 0500 trên client (trong tx đã BEGIN). */
    async function run0500(client: PoolClient): Promise<void> {
      const sql = readFileSync(MIGRATION_0500_SQL, "utf8");
      for (const stmt of sql.split("--> statement-breakpoint")) {
        const trimmed = stmt.trim();
        if (trimmed.length === 0) continue;
        await client.query(trimmed);
      }
    }

    const stateOf = async (c: PoolClient, taskId: string) =>
      (await c.query("SELECT state_id FROM tasks WHERE id=$1", [taskId])).rows[0].state_id as
        | string
        | null;

    const stateRow = async (c: PoolClient, id: string) =>
      (
        await c.query(
          "SELECT name, state_group, sort_order, is_default FROM project_states WHERE id=$1",
          [id],
        )
      ).rows[0] as { name: string; state_group: string; sort_order: number; is_default: boolean };

    it("0500 end-to-end: map (i) · giữ (ii)/(iii) · heal (iv) · review (v) · rename a2 · dồn sort a3 · seed a · idempotent", async () => {
      const client = await direct.connect();
      try {
        await client.query("BEGIN");
        await run0500(client);

        // ── (a2) rename đúng cặp (tên cũ, group); Backlog giữ; 'Todo'-group-started KHÔNG đổi ──
        expect((await stateRow(client, regCol["Todo"])).name).toBe("Cần làm");
        expect((await stateRow(client, regCol["In Progress"])).name).toBe("Đang làm");
        expect((await stateRow(client, regCol["Done"])).name).toBe("Hoàn thành");
        expect((await stateRow(client, regCol["Cancelled"])).name).toBe("Đã huỷ");
        expect((await stateRow(client, regCol["Backlog"])).name).toBe("Backlog");
        expect((await stateRow(client, cFakeTodo)).name).toBe("Todo"); // pair-mismatch → giữ nguyên

        // ── (a3) P_reg có 'Chờ duyệt' (review) chèn sort 3; Hoàn thành dồn 4; Đã huỷ dồn 5 ──
        const rev = await client.query(
          `SELECT id, sort_order FROM project_states
          WHERE project_id=$1 AND deleted_at IS NULL AND state_group='review'`,
          [pReg],
        );
        expect(rev.rows.length).toBe(1);
        expect(rev.rows[0].sort_order).toBe(3);
        expect((await stateRow(client, regCol["Done"])).sort_order).toBe(4);
        expect((await stateRow(client, regCol["Cancelled"])).sort_order).toBe(5);
        // group/is_default/id không bị a2 đụng (thuần hiển thị)
        expect((await stateRow(client, regCol["Todo"])).state_group).toBe("unstarted");
        expect((await stateRow(client, regCol["Todo"])).is_default).toBe(true);

        // ── (b) 5 nhóm fixture ──
        expect(await stateOf(client, tSyncNull), "(i) Done NULL → cột completed").toBe(
          regCol["Done"],
        );
        expect(await stateOf(client, tLegacy), "(ii) status NULL GIỮ cột completed — bẫy M2").toBe(
          regCol["Done"],
        );
        expect(await stateOf(client, tTodo), "(iii) đúng cột theo status → giữ").toBe(
          regCol["Todo"],
        );
        expect(await stateOf(client, tHeal), "(iv) heal lệch nhóm → cột started").toBe(
          regCol["In Progress"],
        );
        expect(
          await stateOf(client, tReview),
          "(v) In Review → cột review, KHÔNG phải started",
        ).toBe(rev.rows[0].id);

        // ── P_custom: thiếu nhóm cancelled → is_default; a3 thêm review ở MAX+1 ──
        expect(await stateOf(client, tCancel)).toBe(cIdea);
        // Heal cross-project (finding database-reviewer): đúng nhóm nhưng SAI project → cột started
        // đầu của project mình (không được coi là "đúng nhóm" mà bỏ qua).
        expect(await stateOf(client, tCross)).toBe(cQuay);
        const customRev = await client.query(
          `SELECT sort_order FROM project_states
          WHERE project_id=$1 AND deleted_at IS NULL AND state_group='review'`,
          [pCustom],
        );
        expect(customRev.rows.length).toBe(1);
        expect(customRev.rows[0].sort_order).toBe(6); // MAX(5)+1 — không có nhóm completed/cancelled

        // ── (a) P_zero: 6 cột (5 seed + review), task map; đếm nhóm completed KHÔNG GIẢM ──
        const zeroStates = await client.query(
          `SELECT name, state_group FROM project_states
          WHERE project_id=$1 AND deleted_at IS NULL ORDER BY sort_order`,
          [pZero],
        );
        expect(zeroStates.rows.length).toBe(6);
        expect(zeroStates.rows.map((r: { state_group: string }) => r.state_group)).toEqual([
          "backlog",
          "unstarted",
          "started",
          "review",
          "completed",
          "cancelled",
        ]);
        // (a) chạy TRƯỚC (a2) ⇒ project 0-state cũng ra bộ tên tiếng Việt
        expect(zeroStates.rows.map((r: { name: string }) => r.name)).toEqual([
          "Backlog",
          "Cần làm",
          "Đang làm",
          "Chờ duyệt",
          "Hoàn thành",
          "Đã huỷ",
        ]);
        const tZeroState = await stateOf(client, tZero);
        expect(tZeroState).not.toBeNull();
        expect((await stateRow(client, tZeroState as string)).state_group).toBe("completed");

        // P_reg KHÔNG bị nhân đôi cột (5 gốc + 1 review = 6)
        const regCount = await client.query(
          `SELECT COUNT(*)::int n FROM project_states WHERE project_id=$1 AND deleted_at IS NULL`,
          [pReg],
        );
        expect(regCount.rows[0].n).toBe(6);

        // 0 task công ty A còn state_id NULL (acceptance — đếm trên DB THẬT)
        const nullLeft = await client.query(
          `SELECT COUNT(*)::int n FROM tasks
          WHERE company_id=$1 AND project_id IS NOT NULL AND deleted_at IS NULL
            AND task_status IS NOT NULL AND state_id IS NULL`,
          [A.companyId],
        );
        expect(nullLeft.rows[0].n).toBe(0);

        // ── Idempotent: chạy TOÀN BỘ 0500 lần 2 trong cùng tx → snapshot y hệt ──
        const snapshot = async () =>
          JSON.stringify(
            (
              await client.query(
                `SELECT ps.project_id, ps.name, ps.state_group, ps.sort_order, ps.is_default
                 FROM project_states ps WHERE ps.company_id=$1 AND ps.deleted_at IS NULL
                ORDER BY ps.project_id, ps.sort_order, ps.name`,
                [A.companyId],
              )
            ).rows,
          ) +
          JSON.stringify(
            (
              await client.query(`SELECT id, state_id FROM tasks WHERE company_id=$1 ORDER BY id`, [
                A.companyId,
              ])
            ).rows,
          );
        const before = await snapshot();
        await run0500(client);
        expect(await snapshot(), "re-run 0500 phải là no-op").toBe(before);
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
    }, 60000);

    it("0499 CHECK: nhận state_group='review'; chặn group lạ (23514)", async () => {
      const client = await direct.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `INSERT INTO project_states (company_id, project_id, name, state_group, sort_order)
         VALUES ($1,$2,'Duyệt thử','review',9)`,
          [A.companyId, pReg],
        );
        let code: string | null = null;
        try {
          await client.query(
            `INSERT INTO project_states (company_id, project_id, name, state_group, sort_order)
           VALUES ($1,$2,'Nhóm lạ','bogus',10)`,
            [A.companyId, pReg],
          );
        } catch (err: unknown) {
          code = (err as { code?: string }).code ?? null;
        }
        expect(code, "group ngoài CHECK phải bị 23514").toBe("23514");
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
    });
  },
);
