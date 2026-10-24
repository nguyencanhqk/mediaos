/**
 * S20-SEC-TASKPATCHGATE-1 — đường sửa chung `PATCH /tasks/:taskId` và route chuyên trách
 * (`/assign` · `/change-priority` · `/change-deadline`) cho CÙNG một thay đổi phải ra CÙNG một quyết định
 * quyền, ở CÙNG phạm vi. Plan: `docs/plans/S20-SEC-TASKPATCHGATE-1.md` §4 (R1–R9 · A1–A5 · X1).
 * App THẬT (AppModule) qua `applyMainPipeline`, engine quyền THẬT, Postgres THẬT (lane cô lập).
 *
 * Trường ↔ cặp: hạn `dueAt` ↔ `update-deadline:task` · ưu tiên `priority` ↔ `update-priority:task` ·
 * người phụ trách `assigneeEmployeeId` ↔ `assign:task`.
 *   I-1  PATCH làm giá trị trường F ĐỔI ⇒ cần cặp P(F); thiếu ⇒ 403 cho CẢ request (không cột nào đổi,
 *        không dòng activity/audit nào).
 *   I-2  phần đổi F buộc theo phạm vi của chính P(F) (việc ngoài phạm vi ⇒ 404; người phụ trách mới ngoài
 *        phạm vi `assign` ⇒ 403 ASSIGNEE_OUT_OF_SCOPE) — không mượn phạm vi của `update:task`.
 *   I-3  F có trong body nhưng bằng giá trị đang lưu ⇒ không đòi P(F). `null` (xoá) là ĐỔI.
 *
 * Người gọi dựng bằng `grant()` theo cặp — tên ca mô tả bất biến, không mô tả vai trò:
 *   G0 `update:task@Company` · G1 G0 + ba cặp @Company · G2 G0 + ba cặp @Own (không là thành viên dự án
 *   nào) · G3 G0 + chỉ `update-priority@Company` · GB công ty B, đủ cặp @Company.
 *
 * ⚠️ Chống xanh rỗng: mọi việc seed có CẢ BA trường khác null (`freshTask` assert bằng direct pool), giá
 *    trị đích khác giá trị đầu; ca R assert thông điệp ĐÚNG NGUỒN (cổng trường), không chỉ mã HTTP — 403 của
 *    guard route mang `Permission denied: …`, khác hẳn.
 * Cổng `hasDb && LANE_DB` (CLAUDE.md §9.5). Không `Promise.all` quanh supertest.
 */

import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { PasswordService } from "../../src/auth/password.service";
import { applyMainPipeline } from "../helpers/bootstrap-app";
import { loginPasswordFixture } from "../helpers/fixture-secrets";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";
import { grant, seedEmployee, type Pair } from "../helpers/task-file-seed";

process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret-".padEnd(40, "0");

const runDb = hasDb && Boolean(process.env.LANE_DB);
const LOGIN_PW = loginPasswordFixture("s20pfg");

type Caller = "G0" | "G1" | "G2" | "G3" | "GB";

const DUE0 = "2026-11-20T03:00:00.000Z";
/** Cùng thời điểm với DUE0, khác offset (I-3: so theo epoch ms, không theo chuỗi). */
const DUE0_OTHER_OFFSET = "2026-11-20T10:00:00+07:00";
const DUE1 = "2026-12-05T09:30:00.000Z";
const PRIO0 = "Medium";
const PRIO1 = "Urgent";

/** Thông điệp đúng nguồn của từng loại từ chối (phong bì chuẩn `error.message`). */
const FIELD_GATE_403 = /out of permission scope/;
const ASSIGNEE_OUT_OF_SCOPE = /TASK-ERR-TASK-ASSIGNEE-OUT-OF-SCOPE/;
const TASK_NOT_FOUND = /TASK-ERR-TASK-NOT-FOUND/;

const THREE_PAIRS: Pair[] = [
  ["assign", "task"],
  ["update-priority", "task"],
  ["update-deadline", "task"],
];

interface Snapshot {
  row: Record<string, unknown>;
  activity: number;
  audit: number;
}

describe.skipIf(!runDb)(
  "S20-SEC-TASKPATCHGATE-1 — cùng thay đổi, cùng quyết định quyền trên đường sửa chung",
  () => {
    const direct: Pool = directPool();
    let nest: INestApplication;
    let A: SeededTenant;
    let B: SeededTenant;
    const token: Partial<Record<Caller, string>> = {};
    const uid: Record<string, string> = {};
    const emp: Record<string, string> = {};

    const http = () => request(nest.getHttpServer());
    const patchAs = (who: Caller, taskId: string, body: Record<string, unknown>) =>
      http().patch(`/tasks/${taskId}`).set("Authorization", `Bearer ${token[who]}`).send(body);
    const postAs = (who: Caller, path: string, body: Record<string, unknown>) =>
      http().post(path).set("Authorization", `Bearer ${token[who]}`).send(body);

    /** Việc mới, CẢ BA trường khác null: hạn DUE0 · ưu tiên PRIO0 · người phụ trách `holder`. */
    async function freshTask(holder: "W" | "G2", companyId = A.companyId): Promise<string> {
      const r = await direct.query(
        `INSERT INTO tasks (company_id, task_type, title, task_status, task_priority, due_at,
                            main_assignee_employee_id, assignee_user_id)
         VALUES ($1, 'office', 'pfg-task', 'Todo', $2, $3, $4, $5) RETURNING id`,
        [companyId, PRIO0, DUE0, emp[holder], uid[holder]],
      );
      const id = r.rows[0].id as string;
      const pre = await direct.query(
        `SELECT task_priority, due_at, main_assignee_employee_id FROM tasks WHERE id = $1`,
        [id],
      );
      expect(pre.rows[0].task_priority, "tiền điều kiện: ưu tiên khác null").toBe(PRIO0);
      expect(pre.rows[0].due_at, "tiền điều kiện: hạn khác null").not.toBeNull();
      expect(pre.rows[0].main_assignee_employee_id, "tiền điều kiện: có người phụ trách").toBe(
        emp[holder],
      );
      return id;
    }

    async function snapshot(taskId: string): Promise<Snapshot> {
      const row = await direct.query(
        `SELECT title, task_priority, due_at, main_assignee_employee_id, assignee_user_id, updated_at
           FROM tasks WHERE id = $1`,
        [taskId],
      );
      const act = await direct.query(
        `SELECT count(*)::int AS n FROM task_activity_logs WHERE task_id = $1`,
        [taskId],
      );
      const aud = await direct.query(
        `SELECT count(*)::int AS n FROM audit_logs WHERE object_type = 'task' AND object_id = $1`,
        [taskId],
      );
      return { row: row.rows[0], activity: act.rows[0].n, audit: aud.rows[0].n };
    }

    async function columns(taskId: string) {
      const r = await direct.query(
        `SELECT title, task_priority, due_at, main_assignee_employee_id, assignee_user_id
           FROM tasks WHERE id = $1`,
        [taskId],
      );
      const row = r.rows[0] as {
        title: string;
        task_priority: string | null;
        due_at: Date | null;
        main_assignee_employee_id: string | null;
        assignee_user_id: string | null;
      };
      return { ...row, dueMs: row.due_at ? new Date(row.due_at).getTime() : null };
    }

    /** Assert chung mọi ca R (plan §4): mã · thông điệp đúng nguồn · hàng không đổi · 0 activity/audit. */
    async function expectRefused(
      res: request.Response,
      taskId: string,
      before: Snapshot,
      want: { status: number; message: RegExp },
    ) {
      const body = JSON.stringify(res.body).slice(0, 400);
      expect(res.status, `status (body: ${body})`).toBe(want.status);
      const message = String(res.body?.error?.message ?? res.body?.message ?? "");
      expect(message, "thông điệp đúng nguồn").toMatch(want.message);
      expect(message, "không phải 403 của guard route").not.toMatch(/Permission denied/);
      const after = await snapshot(taskId);
      expect(after.row, "hàng việc không đổi (cả request bị từ chối)").toEqual(before.row);
      expect(after.activity, "0 dòng task_activity_logs mới").toBe(before.activity);
      expect(after.audit, "0 dòng audit_logs mới").toBe(before.audit);
    }

    beforeAll(async () => {
      const hash = await new PasswordService().hash(LOGIN_PW);
      A = await seedCompany(direct, "pfgA");
      B = await seedCompany(direct, "pfgB");
      const user = async (k: string, tenant: SeededTenant) => {
        uid[k] = await seedUser(
          direct,
          tenant.companyId,
          `${k.toLowerCase()}@${tenant.slug}.test`,
          hash,
        );
      };
      for (const k of ["G0", "G1", "G2", "G3", "W", "V"]) await user(k, A);
      await user("GB", B);

      const update: Pair[] = [["update", "task"]];
      await grant(direct, A.companyId, uid.G0, update, "Company");
      await grant(direct, A.companyId, uid.G1, [...update, ...THREE_PAIRS], "Company");
      await grant(direct, A.companyId, uid.G2, update, "Company");
      await grant(direct, A.companyId, uid.G2, THREE_PAIRS, "Own");
      await grant(direct, A.companyId, uid.G3, [...update, ["update-priority", "task"]], "Company");
      await grant(direct, B.companyId, uid.GB, [...update, ...THREE_PAIRS], "Company");

      emp.W = await seedEmployee(direct, A.companyId, uid.W);
      emp.V = await seedEmployee(direct, A.companyId, uid.V);
      emp.G2 = await seedEmployee(direct, A.companyId, uid.G2);

      const pm = await direct.query(
        `SELECT count(*)::int AS n FROM project_members WHERE company_id = $1 AND user_id = $2`,
        [A.companyId, uid.G2],
      );
      expect(pm.rows[0].n, "tiền điều kiện: G2 không là thành viên dự án nào").toBe(0);

      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      nest = applyMainPipeline(moduleRef.createNestApplication());
      await nest.init();
      await nest.listen(0);

      const logins: Array<[Caller, SeededTenant]> = [
        ["G0", A],
        ["G1", A],
        ["G2", A],
        ["G3", A],
        ["GB", B],
      ];
      for (const [k, tenant] of logins) {
        const res = await http()
          .post("/auth/login")
          .send({
            companySlug: tenant.slug,
            email: `${k.toLowerCase()}@${tenant.slug}.test`,
            password: LOGIN_PW,
          });
        expect(res.status, `login ${k}: ${JSON.stringify(res.body)}`).toBe(200);
        token[k] = res.body.data.accessToken as string;
      }
    });

    afterAll(async () => {
      // Đóng app TRƯỚC cleanup: outbox worker còn sống có thể ghi audit_logs giữa các câu DELETE.
      if (nest) await nest.close();
      if (A && B) {
        const ids = [A.companyId, B.companyId];
        for (const tbl of ["task_activity_logs", "task_assignees", "tasks"]) {
          await direct
            .query(`DELETE FROM ${tbl} WHERE company_id = ANY($1::uuid[])`, [ids])
            .catch(() => undefined);
        }
        await cleanupTenants(direct, ids);
      }
      await direct.end();
    });

    // ══ ALLOW đứng cạnh — đường sửa chung vẫn phục vụ người có đúng cặp / trường không đổi ══════════

    it("A5 · chỉ sửa tiêu đề với update:task ⇒ 200 (người gọi qua được cổng route)", async () => {
      const id = await freshTask("W");
      const res = await patchAs("G0", id, { title: "pfg-A5" });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect((await columns(id)).title).toBe("pfg-A5");
    });

    it("A1 · body đủ trường của form, chỉ tiêu đề đổi (hạn cùng thời điểm khác offset) ⇒ 200, ba cột giữ nguyên", async () => {
      const id = await freshTask("W");
      const before = await columns(id);
      const res = await patchAs("G0", id, {
        title: "pfg-A1",
        description: null,
        assigneeEmployeeId: emp.W,
        departmentId: null,
        priority: PRIO0,
        startAt: null,
        dueAt: DUE0_OTHER_OFFSET,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const after = await columns(id);
      expect(after.title).toBe("pfg-A1");
      expect(after.task_priority).toBe(before.task_priority);
      expect(after.dueMs).toBe(before.dueMs);
      expect(after.main_assignee_employee_id).toBe(before.main_assignee_employee_id);
      expect(after.assignee_user_id).toBe(before.assignee_user_id);
    });

    it("A2 · có đủ cặp: đổi ba trường qua đường sửa chung = qua ba route chuyên trách", async () => {
      const t1 = await freshTask("W");
      const t2 = await freshTask("W");
      const initial = await columns(t1);

      const viaPatch = await patchAs("G1", t1, {
        dueAt: DUE1,
        priority: PRIO1,
        assigneeEmployeeId: emp.V,
      });
      expect(viaPatch.status, JSON.stringify(viaPatch.body)).toBe(200);

      const dl = await postAs("G1", `/tasks/${t2}/change-deadline`, { dueAt: DUE1 });
      expect(dl.status, JSON.stringify(dl.body)).toBe(200);
      const pr = await postAs("G1", `/tasks/${t2}/change-priority`, { priority: PRIO1 });
      expect(pr.status, JSON.stringify(pr.body)).toBe(200);
      const as = await postAs("G1", `/tasks/${t2}/assign`, { assigneeEmployeeId: emp.V });
      expect(as.status, JSON.stringify(as.body)).toBe(200);

      const c1 = await columns(t1);
      const c2 = await columns(t2);
      expect(c1.dueMs).toBe(c2.dueMs);
      expect(c1.task_priority).toBe(c2.task_priority);
      expect(c1.main_assignee_employee_id).toBe(c2.main_assignee_employee_id);
      expect(c1.assignee_user_id).toBe(c2.assignee_user_id);
      expect(c1.dueMs).not.toBe(initial.dueMs);
      expect(c1.task_priority).not.toBe(initial.task_priority);
      expect(c1.main_assignee_employee_id).not.toBe(initial.main_assignee_employee_id);
    });

    it("A3 · cặp ở phạm vi Own: đổi hạn việc trong phạm vi của chính cặp ⇒ 200", async () => {
      const id = await freshTask("G2");
      const res = await patchAs("G2", id, { dueAt: DUE1 });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect((await columns(id)).dueMs).toBe(Date.parse(DUE1));
    });

    it("A4 · có update-priority (không có update-deadline): đổi ưu tiên ⇒ 200", async () => {
      const id = await freshTask("W");
      const res = await patchAs("G3", id, { priority: PRIO1 });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect((await columns(id)).task_priority).toBe(PRIO1);
    });

    it("X1 · tenant khác, đủ cặp: sửa hạn việc của công ty A ⇒ 404, việc không đổi", async () => {
      const id = await freshTask("W");
      const before = await snapshot(id);
      const res = await patchAs("GB", id, { dueAt: DUE1 });
      expect(res.status, JSON.stringify(res.body)).toBe(404);
      expect((await snapshot(id)).row).toEqual(before.row);
    });

    // ══ I-1 — trường đổi đòi cặp chuyên trách; thiếu ⇒ 403 cho cả request ═══════════════════════════

    it("R1 · I-1: đổi hạn mà thiếu update-deadline ⇒ 403, không ghi gì", async () => {
      const id = await freshTask("W");
      const before = await snapshot(id);
      const res = await patchAs("G0", id, { dueAt: DUE1 });
      await expectRefused(res, id, before, { status: 403, message: FIELD_GATE_403 });
    });

    it("R2 · I-1: đổi ưu tiên mà thiếu update-priority ⇒ 403, không ghi gì", async () => {
      const id = await freshTask("W");
      const before = await snapshot(id);
      const res = await patchAs("G0", id, { priority: PRIO1 });
      await expectRefused(res, id, before, { status: 403, message: FIELD_GATE_403 });
    });

    it("R3 · I-1: đổi người phụ trách mà thiếu assign ⇒ 403, không ghi gì", async () => {
      const id = await freshTask("W");
      const before = await snapshot(id);
      const res = await patchAs("G0", id, { assigneeEmployeeId: emp.V });
      await expectRefused(res, id, before, { status: 403, message: FIELD_GATE_403 });
    });

    it("R4 · I-1/I-3: gỡ người phụ trách (null) là đổi ⇒ thiếu assign thì 403", async () => {
      const id = await freshTask("W");
      const before = await snapshot(id);
      const res = await patchAs("G0", id, { assigneeEmployeeId: null });
      await expectRefused(res, id, before, { status: 403, message: FIELD_GATE_403 });
    });

    it("R5 · I-1/I-3: xoá hạn (null) là đổi ⇒ thiếu update-deadline thì 403", async () => {
      const id = await freshTask("W");
      const before = await snapshot(id);
      const res = await patchAs("G0", id, { dueAt: null });
      await expectRefused(res, id, before, { status: 403, message: FIELD_GATE_403 });
    });

    it("R6 · I-1: một trường thiếu cặp ⇒ từ chối CẢ request, trường hợp lệ đi kèm cũng không đổi", async () => {
      const id = await freshTask("W");
      const before = await snapshot(id);
      const res = await patchAs("G0", id, { title: "pfg-R6", dueAt: DUE1 });
      await expectRefused(res, id, before, { status: 403, message: FIELD_GATE_403 });
      expect((await columns(id)).title).toBe("pfg-task");
    });

    it("R9 · I-1 đúng cặp: có update-priority không thay được update-deadline ⇒ đổi hạn 403", async () => {
      const id = await freshTask("W");
      const before = await snapshot(id);
      const res = await patchAs("G3", id, { dueAt: DUE1 });
      await expectRefused(res, id, before, { status: 403, message: FIELD_GATE_403 });
    });

    // ══ I-2 — phần đổi buộc theo phạm vi của chính cặp chuyên trách ════════════════════════════════

    it("R7 · I-2: cặp update-deadline phạm vi Own, việc ngoài phạm vi đó ⇒ 404, không ghi gì", async () => {
      const id = await freshTask("W");
      const before = await snapshot(id);
      const res = await patchAs("G2", id, { dueAt: DUE1 });
      await expectRefused(res, id, before, { status: 404, message: TASK_NOT_FOUND });
    });

    it("R8 · I-2/I-4: người phụ trách mới ngoài phạm vi assign ⇒ 403 ASSIGNEE_OUT_OF_SCOPE ở CẢ HAI đường", async () => {
      // Đối chứng trước, trên việc riêng: route chuyên trách đã từ chối đúng người này ở phạm vi assign.
      const control = await freshTask("G2");
      const controlBefore = await snapshot(control);
      const viaRoute = await postAs("G2", `/tasks/${control}/assign`, {
        assigneeEmployeeId: emp.V,
      });
      await expectRefused(viaRoute, control, controlBefore, {
        status: 403,
        message: ASSIGNEE_OUT_OF_SCOPE,
      });

      const id = await freshTask("G2");
      const before = await snapshot(id);
      const viaPatch = await patchAs("G2", id, { assigneeEmployeeId: emp.V });
      await expectRefused(viaPatch, id, before, { status: 403, message: ASSIGNEE_OUT_OF_SCOPE });
    });
  },
);
