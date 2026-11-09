/**
 * S20-NOTI-TARGETURL-1 — migration 0593: template target_url mở ĐÚNG bản ghi (docs/plans/S20-NOTI-TARGETURL-1.md §4).
 *
 * Đường THẬT: `NotificationEngineService.intake` (render template + payload) → `notifications.target_url`.
 * Phủ:
 *  · 5 template global mang đích mới; template gửi CHỦ đơn giữ `/leave/me/requests/{requestId}`;
 *  · ALLOW: payload có khoá ⇒ URL đúng bản ghi, không còn `{`/`}`; DENY: payload thiếu khoá ⇒ 422, 0 hàng;
 *  · migration idempotent (chạy lại 0 hàng global đổi), override chép cũ ⇒ đổi (giữ updated_by),
 *    override tuỳ biến + override xoá mềm ⇒ GIỮ; khối Down đảo đúng (trong transaction rồi ROLLBACK);
 *  · công ty B không đọc thông báo của công ty A (RLS, app role).
 * Cổng `hasDb && LANE_DB`.
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { NotificationEngineService } from "../../src/notifications/notification-engine.service";
import { TargetUnavailableError } from "../../src/notifications/notification-engine.errors";
import { applyMainPipeline } from "../helpers/bootstrap-app";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

const hasLaneDb = hasDb && !!process.env.LANE_DB;
const SQL_FILE = join(__dirname, "../../migrations/0593_s20notitargeturl1_target_url_record.sql");
const code = (c: string) => `${c}__IN_APP__vi-VN`;

const NEW_URL: Record<string, string> = {
  TASK_DUE_SOON: "/tasks/{taskId}",
  TASK_OVERDUE: "/tasks/{taskId}",
  TASK_COMMENT_CREATED: "/tasks/{taskId}?comment_id={commentId}",
  TASK_MENTIONED: "/tasks/{taskId}?comment_id={commentId}",
  LEAVE_REQUEST_SUBMITTED: "/leave/approvals?request={requestId}",
};
const SAFE_URL_RE = /^\/(?!\/)[\w\-./?=&%#]*$/;

/** Khối Down của runbook D7 (plan) — kiểm trong transaction rồi ROLLBACK. */
const DOWN_SQL = [
  `UPDATE notification_templates SET target_url_template = '/tasks/my-tasks', updated_at = now()
    WHERE deleted_at IS NULL AND channel='IN_APP' AND locale='vi-VN'
      AND template_code IN ('TASK_DUE_SOON__IN_APP__vi-VN','TASK_OVERDUE__IN_APP__vi-VN')
      AND target_url_template = '/tasks/{taskId}'`,
  `UPDATE notification_templates SET target_url_template = '/tasks/{taskId}', updated_at = now()
    WHERE deleted_at IS NULL AND channel='IN_APP' AND locale='vi-VN'
      AND template_code IN ('TASK_COMMENT_CREATED__IN_APP__vi-VN','TASK_MENTIONED__IN_APP__vi-VN')
      AND target_url_template = '/tasks/{taskId}?comment_id={commentId}'`,
  `UPDATE notification_templates SET target_url_template = '/leave/approvals', updated_at = now()
    WHERE deleted_at IS NULL AND channel='IN_APP' AND locale='vi-VN'
      AND template_code = 'LEAVE_REQUEST_SUBMITTED__IN_APP__vi-VN'
      AND target_url_template = '/leave/approvals?request={requestId}'`,
];
const DOWN_CHECK_SQL = `SELECT template_code FROM notification_templates
     WHERE deleted_at IS NULL AND channel='IN_APP' AND locale='vi-VN'
       AND (target_url_template IN ('/tasks/{taskId}?comment_id={commentId}','/leave/approvals?request={requestId}')
            OR (template_code IN ('TASK_DUE_SOON__IN_APP__vi-VN','TASK_OVERDUE__IN_APP__vi-VN')
                AND target_url_template = '/tasks/{taskId}'))`;

describe.skipIf(!hasLaneDb)(
  "S20-NOTI-TARGETURL-1 target_url mở đúng bản ghi (0593, DB cô lập)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let appConn: Pool;
    let engine: NotificationEngineService;
    let A: SeededTenant;
    let B: SeededTenant;
    let C: SeededTenant; // công ty riêng cho ca override (không lẫn ca intake)
    let recipient = "";
    let userC = "";
    const companyIds: string[] = [];

    async function globalUrl(c: string): Promise<string | null> {
      const r = await direct.query(
        `SELECT target_url_template AS u FROM notification_templates
        WHERE template_code=$1 AND company_id IS NULL AND deleted_at IS NULL`,
        [code(c)],
      );
      return (r.rows[0]?.u as string | undefined) ?? null;
    }

    async function intake(eventCode: string, payload: Record<string, unknown>, entityId: string) {
      const isLeave = eventCode.startsWith("LEAVE");
      return engine.intake(A.companyId, {
        eventCode,
        sourceModule: isLeave ? "LEAVE" : "TASK",
        sourceEntityType: isLeave ? "leave_request" : "task",
        sourceEntityId: entityId,
        occurredAt: new Date().toISOString(),
        recipient: { mode: "UserIds", userIds: [recipient], employeeIds: [] },
        payload,
      } as never);
    }

    async function urlOf(eventCode: string, entityId: string): Promise<string | null> {
      const r = await direct.query(
        `SELECT target_url FROM notifications
        WHERE company_id=$1 AND recipient_user_id=$2 AND event_code=$3 AND source_entity_id=$4`,
        [A.companyId, recipient, eventCode, entityId],
      );
      return (r.rows[0]?.target_url as string | undefined) ?? null;
    }

    async function countRows(eventCode: string, entityId: string): Promise<number> {
      const r = await direct.query(
        `SELECT count(*)::int AS n FROM notifications WHERE company_id=$1 AND event_code=$2 AND source_entity_id=$3`,
        [A.companyId, eventCode, entityId],
      );
      return r.rows[0].n as number;
    }

    async function runUp(): Promise<void> {
      const client = await direct.connect();
      try {
        await client.query("BEGIN");
        for (const stmt of readFileSync(SQL_FILE, "utf8").split("--> statement-breakpoint")) {
          if (stmt.replace(/--[^\n]*\n/g, "").trim()) await client.query(stmt);
        }
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    }

    async function insertOverride(c: string, url: string, deleted: boolean): Promise<string> {
      const ev = await direct.query(
        `SELECT event_id FROM notification_templates WHERE template_code=$1 AND company_id IS NULL AND deleted_at IS NULL`,
        [code(c)],
      );
      const r = await direct.query(
        `INSERT INTO notification_templates
         (company_id, event_id, template_code, channel, locale, title_template, body_template,
          target_url_template, status, updated_by, deleted_at)
       VALUES ($1,$2,$3,'IN_APP','vi-VN','t','b',$4,'Active',$5, CASE WHEN $6::boolean THEN now() END)
       RETURNING id`,
        [C.companyId, ev.rows[0].event_id, code(c), url, userC, deleted],
      );
      return r.rows[0].id as string;
    }

    async function rowOf(id: string) {
      const r = await direct.query(
        `SELECT target_url_template AS u, updated_by AS by, updated_at AS at FROM notification_templates WHERE id=$1`,
        [id],
      );
      return r.rows[0] as { u: string; by: string | null; at: Date };
    }

    async function globalSnapshot() {
      const r = await direct.query(
        `SELECT template_code, updated_at FROM notification_templates
        WHERE company_id IS NULL AND deleted_at IS NULL AND template_code = ANY($1::text[]) ORDER BY 1`,
        [Object.keys(NEW_URL).map(code)],
      );
      return r.rows;
    }

    beforeAll(async () => {
      direct = directPool();
      appConn = appPool();
      A = await seedCompany(direct, "tgturlA");
      B = await seedCompany(direct, "tgturlB");
      C = await seedCompany(direct, "tgturlC");
      companyIds.push(A.companyId, B.companyId, C.companyId);
      recipient = await seedUser(direct, A.companyId, `r@${A.slug}.test`);
      userC = await seedUser(direct, C.companyId, `u@${C.slug}.test`);
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = applyMainPipeline(moduleRef.createNestApplication());
      await app.init();
      engine = app.get(NotificationEngineService);
    });

    afterAll(async () => {
      await direct
        ?.query("DELETE FROM notification_templates WHERE company_id = ANY($1::uuid[])", [
          companyIds,
        ])
        .catch(() => undefined);
      if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
      await appConn?.end();
      await direct?.end();
      await app?.close();
    });

    it("ALLOW: 5 template global mang đích mới; template gửi CHỦ đơn giữ đích chủ đơn", async () => {
      for (const [c, url] of Object.entries(NEW_URL)) expect(await globalUrl(c), c).toBe(url);
      for (const c of ["APPROVED", "REJECTED", "CANCELLED", "REVOKED"]) {
        expect(await globalUrl(`LEAVE_REQUEST_${c}`), c).toBe("/leave/me/requests/{requestId}");
      }
    });

    it("ALLOW nhắc hạn: có taskId ⇒ /tasks/<taskId>; DENY: thiếu taskId (payload cũ của job) ⇒ 422, 0 hàng", async () => {
      const taskId = randomUUID();
      await intake("TASK_DUE_SOON", { taskId, task_title: "x", due_at: "2026-11-10" }, taskId);
      const url = await urlOf("TASK_DUE_SOON", taskId);
      expect(url).toBe(`/tasks/${taskId}`);
      expect(url).toMatch(SAFE_URL_RE);

      const noKey = randomUUID();
      await expect(intake("TASK_OVERDUE", { task_title: "x" }, noKey)).rejects.toBeInstanceOf(
        TargetUnavailableError,
      );
      expect(await countRows("TASK_OVERDUE", noKey)).toBe(0);
    });

    it("ALLOW bình luận/nhắc tên: kèm comment_id; DENY: thiếu commentId ⇒ 422, 0 hàng", async () => {
      const taskId = randomUUID();
      const commentId = randomUUID();
      await intake("TASK_COMMENT_CREATED", { taskId, commentId, taskTitle: "x" }, taskId);
      const url = await urlOf("TASK_COMMENT_CREATED", taskId);
      expect(url).toBe(`/tasks/${taskId}?comment_id=${commentId}`);
      expect(url).toMatch(SAFE_URL_RE);
      const mTask = randomUUID();
      await intake("TASK_MENTIONED", { taskId: mTask, commentId, taskTitle: "x" }, mTask);
      expect(await urlOf("TASK_MENTIONED", mTask)).toBe(`/tasks/${mTask}?comment_id=${commentId}`);

      const noKey = randomUUID();
      await expect(
        intake("TASK_COMMENT_CREATED", { taskId: noKey, taskTitle: "x" }, noKey),
      ).rejects.toBeInstanceOf(TargetUnavailableError);
      expect(await countRows("TASK_COMMENT_CREATED", noKey)).toBe(0);
    });

    it("ALLOW người duyệt: /leave/approvals?request=<id>; DENY: thiếu requestId ⇒ 422", async () => {
      const requestId = randomUUID();
      await intake("LEAVE_REQUEST_SUBMITTED", { requestId }, requestId);
      expect(await urlOf("LEAVE_REQUEST_SUBMITTED", requestId)).toBe(
        `/leave/approvals?request=${requestId}`,
      );
      const noKey = randomUUID();
      await expect(intake("LEAVE_REQUEST_SUBMITTED", {}, noKey)).rejects.toBeInstanceOf(
        TargetUnavailableError,
      );
      expect(await countRows("LEAVE_REQUEST_SUBMITTED", noKey)).toBe(0);
    });

    it("DENY tenant: công ty B không đọc thông báo của công ty A (app role + RLS)", async () => {
      const taskId = randomUUID();
      await intake("TASK_DUE_SOON", { taskId, task_title: "x" }, taskId);
      const own = await direct.query(
        `SELECT id FROM notifications WHERE company_id=$1 AND source_entity_id=$2`,
        [A.companyId, taskId],
      );
      const count = async (companyId: string) => {
        const c = await appConn.connect();
        try {
          await c.query("BEGIN");
          await c.query("SELECT set_config('app.current_company_id', $1, true)", [companyId]);
          const r = await c.query(`SELECT count(*)::int AS n FROM notifications WHERE id=$1`, [
            own.rows[0].id,
          ]);
          await c.query("ROLLBACK");
          return r.rows[0].n as number;
        } finally {
          c.release();
        }
      };
      expect(await count(A.companyId)).toBe(1);
      expect(await count(B.companyId)).toBe(0);
    });

    it("migration: override chép cũ ⇒ đổi (giữ updated_by); tuỳ biến + xoá mềm ⇒ GIỮ; chạy lại ⇒ global không đổi", async () => {
      const copied = await insertOverride("TASK_DUE_SOON", "/tasks/my-tasks", false);
      const custom = await insertOverride("TASK_OVERDUE", "/tasks/tuy-bien", false);
      const softDeleted = await insertOverride("TASK_MENTIONED", "/tasks/{taskId}", true);
      const globalBefore = await globalSnapshot();

      await runUp();
      expect((await rowOf(copied)).u).toBe("/tasks/{taskId}");
      expect((await rowOf(copied)).by).toBe(userC);
      expect((await rowOf(custom)).u).toBe("/tasks/tuy-bien");
      expect((await rowOf(softDeleted)).u).toBe("/tasks/{taskId}");
      // override xoá mềm mang đích cũ của COMMENT-loại khác: GIỮ (không đổi sang ?comment_id)
      expect((await rowOf(softDeleted)).u).not.toContain("comment_id");

      const afterFirst = await rowOf(copied);
      await runUp();
      expect((await rowOf(copied)).at).toEqual(afterFirst.at);
      expect(await globalSnapshot()).toEqual(globalBefore);
    });

    it("Down (runbook): đảo đúng, câu kiểm tra sau Down trả 0 hàng; ROLLBACK không làm bẩn lane", async () => {
      const before = await direct.query(DOWN_CHECK_SQL);
      expect(before.rowCount, "trước Down phải có hàng khớp (kiểm tra không rỗng)").toBeGreaterThan(
        0,
      );
      const client = await direct.connect();
      try {
        await client.query("BEGIN");
        for (const stmt of DOWN_SQL) await client.query(stmt);
        expect((await client.query(DOWN_CHECK_SQL)).rowCount).toBe(0);
        await client.query("ROLLBACK");
      } finally {
        client.release();
      }
      expect(await globalUrl("TASK_DUE_SOON")).toBe("/tasks/{taskId}");
    });
  },
);
