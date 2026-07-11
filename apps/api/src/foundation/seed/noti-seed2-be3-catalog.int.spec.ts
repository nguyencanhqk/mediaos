/**
 * S4-NOTI-SEED-2 (lane notiSeed2Mig) — VÁ catalog NOTI cho TASK BE-3 (migration 0490). RED-before-GREEN.
 *
 * Colocated `src/foundation/seed/*.int.spec.ts` → khớp vitest include `src/**\/*.spec.ts`. Gate CỨNG
 * `hasDb && LANE_DB` (memory integration-test-lane-db-gate): .env trỏ DB dev chung → hasDb=true nên assert
 * chạm DB chung = ĐỎ-GIẢ; CHỈ chạy trên DB cô lập lane (bash scripts/lane-db-setup.sh notiseed2 →
 * export LANE_DB=mediaos_notiseed2), áp full migration band tới 0490.
 *
 * Phủ (Nghiệm thu Đội 3):
 *   A. 5 mã canonical BE-3 GLOBAL is_enabled=true (ASSIGNED/ASSIGNEE_CHANGED/STATUS_CHANGED/PRIORITY_CHANGED/
 *      DUE_DATE_CHANGED). TASK_DEADLINE_CHANGED VẮNG HẲN (0 row — rename in-place, fresh-migrate).
 *   B. NotificationTemplateRepository.findActiveTemplate resolve được template IN_APP/vi-VN cho từng eventId.
 *   C. Contract — variables_schema 3 template MỚI == đúng bộ key camelCase BE-3 (task-actions.service.ts);
 *      locale='vi-VN', status='Active', is_default=true, body NOT NULL; placeholder {key} ⊆ variables_schema.
 *      + 2 template 0481 (TASK_ASSIGNED/TASK_STATUS_CHANGED) đã snake→camelCase (STATUS dùng toStatus).
 *   D. Idempotency — re-exec 0490 → COUNT event/template GLOBAL KHÔNG đổi, KHÔNG exception.
 *   E. Append-safe — TASK_DEADLINE_CHANGED KHÔNG DELETE (0 row HOẶC disabled) + RLS FORCE nguyên vẹn.
 *   F. Engine E2E — intake TASK_PRIORITY_CHANGED (recipient ACTIVE ≠ actor) → createdCount≥1, template thật
 *      (fallback=false: delivery_log metadata NULL + title = title_template render).
 */

import "reflect-metadata";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module";
import { DatabaseService } from "../../db/db.service";
import { NotificationEngineService } from "../../notifications/notification-engine.service";
import { NotificationTemplateRepository } from "../../notifications/notification-template.repository";
import { directPool, hasDb } from "../../../test/helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedUser,
  type SeededTenant,
} from "../../../test/helpers/seed";
import { notiTemplateCode } from "./notification-event-catalog.const";

const runDb = hasDb && Boolean(process.env.LANE_DB);

/** 5 mã canonical BE-3 (Producer §9.4 — task-actions.service.ts) — tất cả PHẢI enabled sau 0490. */
const CANONICAL_BE3_EVENTS = [
  "TASK_ASSIGNED",
  "TASK_ASSIGNEE_CHANGED",
  "TASK_STATUS_CHANGED",
  "TASK_PRIORITY_CHANGED",
  "TASK_DUE_DATE_CHANGED",
] as const;

/** variables_schema camelCase kỳ vọng — HARD-CODE từ task-actions.service.ts (KHÔNG suy từ file migration). */
const EXPECTED_VARIABLES: Record<string, string[]> = {
  TASK_PRIORITY_CHANGED: [
    "taskId",
    "taskTitle",
    "taskCode",
    "projectId",
    "actorUserId",
    "actorEmployeeId",
    "oldPriority",
    "newPriority",
    "assigneeUserId",
  ],
  TASK_DUE_DATE_CHANGED: [
    "taskId",
    "taskTitle",
    "taskCode",
    "projectId",
    "actorUserId",
    "actorEmployeeId",
    "oldDueAt",
    "newDueAt",
    "assigneeUserId",
  ],
  TASK_ASSIGNEE_CHANGED: [
    "taskId",
    "taskTitle",
    "taskCode",
    "projectId",
    "actorUserId",
    "actorEmployeeId",
    "oldAssigneeEmployeeId",
    "assigneeEmployeeId",
    "assigneeUserId",
  ],
};

const PLACEHOLDER_RE = /\{(\w+)\}/g;
function placeholders(...texts: (string | null)[]): string[] {
  const out = new Set<string>();
  for (const t of texts) {
    if (!t) continue;
    for (const m of t.matchAll(PLACEHOLDER_RE)) out.add(m[1]);
  }
  return [...out];
}

// vitest cwd = apps/api (vitest.config root: "."). Resolve migration file from there — KHÔNG import.meta
// (tsc typecheck của api dùng module=CommonJS, import.meta = TS1343).
const MIGRATION_0490 = resolve(
  process.cwd(),
  "migrations/0490_s4_notiseed2_task_be3_event_catalog.sql",
);

describe.skipIf(!runDb)(
  "S4-NOTI-SEED-2 NOTI catalog BE-3 patch (mig 0490, DB cô lập LANE_DB)",
  () => {
    const direct = directPool();
    let nest: INestApplication;
    let db: DatabaseService;
    let templateRepo: NotificationTemplateRepository;
    let engine: NotificationEngineService;

    let company: SeededTenant;
    let actor = "";
    let recipient = "";
    const companyIds: string[] = [];
    const eventIdByCode: Record<string, string> = {};

    async function eventCount(): Promise<number> {
      const r = await direct.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM notification_events WHERE company_id IS NULL AND deleted_at IS NULL`,
      );
      return r.rows[0].n;
    }
    async function templateCount(): Promise<number> {
      const r = await direct.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM notification_templates WHERE company_id IS NULL AND deleted_at IS NULL`,
      );
      return r.rows[0].n;
    }

    beforeAll(async () => {
      const ev = await direct.query<{ id: string; event_code: string }>(
        `SELECT id, event_code FROM notification_events
        WHERE company_id IS NULL AND deleted_at IS NULL AND event_code = ANY($1)`,
        [[...CANONICAL_BE3_EVENTS]],
      );
      for (const row of ev.rows) eventIdByCode[row.event_code] = row.id;

      company = await seedCompany(direct, "notiseed2");
      companyIds.push(company.companyId);
      actor = await seedUser(direct, company.companyId, `actor@${company.slug}.test`);
      recipient = await seedUser(direct, company.companyId, `rcpt@${company.slug}.test`);

      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      nest = moduleRef.createNestApplication();
      await nest.init();
      db = nest.get(DatabaseService, { strict: false });
      templateRepo = nest.get(NotificationTemplateRepository, { strict: false });
      engine = nest.get(NotificationEngineService, { strict: false });
    });

    afterAll(async () => {
      await direct
        .query(`DELETE FROM notification_delivery_logs WHERE company_id = ANY($1::uuid[])`, [
          companyIds,
        ])
        .catch(() => undefined);
      await cleanupTenants(direct, companyIds).catch(() => undefined);
      await direct.end();
      if (nest) await nest.close();
    });

    // ── A. 5 mã canonical enabled + TASK_DEADLINE_CHANGED vắng ────────────────────────
    describe("A. Catalog event GLOBAL sau 0490", () => {
      for (const code of CANONICAL_BE3_EVENTS) {
        it(`${code}: GLOBAL is_enabled=true`, async () => {
          const r = await direct.query<{
            is_enabled: boolean;
            module_code: string;
            notification_type: string;
          }>(
            `SELECT is_enabled, module_code, notification_type FROM notification_events
            WHERE company_id IS NULL AND deleted_at IS NULL AND event_code=$1`,
            [code],
          );
          expect(r.rows.length, `${code} phải tồn tại GLOBAL`).toBe(1);
          expect(r.rows[0].is_enabled).toBe(true);
          expect(r.rows[0].module_code).toBe("TASK");
          expect(r.rows[0].notification_type).toBe("Task");
        });
      }

      it("TASK_DEADLINE_CHANGED VẮNG HẲN (0 row — rename in-place, KHÔNG DELETE + KHÔNG orphan)", async () => {
        const r = await direct.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM notification_events
          WHERE company_id IS NULL AND deleted_at IS NULL AND event_code='TASK_DEADLINE_CHANGED'`,
        );
        expect(r.rows[0].n).toBe(0);
      });

      it("mã TASK khác GIỮ NGUYÊN is_enabled (TASK_UPDATED vẫn false)", async () => {
        const r = await direct.query<{ is_enabled: boolean }>(
          `SELECT is_enabled FROM notification_events
          WHERE company_id IS NULL AND deleted_at IS NULL AND event_code='TASK_UPDATED'`,
        );
        expect(r.rows.length).toBe(1);
        expect(r.rows[0].is_enabled).toBe(false);
      });
    });

    // ── B. Resolver template tìm được từng mã ─────────────────────────────────────────
    describe("B. NotificationTemplateRepository.findActiveTemplate resolve (IN_APP/vi-VN)", () => {
      for (const code of CANONICAL_BE3_EVENTS) {
        it(`${code}: findActiveTemplate != undefined`, async () => {
          const eventId = eventIdByCode[code];
          expect(eventId, `eventId ${code} phải resolve ở beforeAll`).toBeTruthy();
          const tpl = await db.withTenant(company.companyId, (tx) =>
            templateRepo.findActiveTemplate(tx, company.companyId, eventId, "IN_APP", "vi-VN"),
          );
          expect(tpl, `${code} phải có template active`).toBeDefined();
          expect(tpl!.templateCode).toBe(notiTemplateCode(code));
          expect(tpl!.status).toBe("Active");
          expect(tpl!.locale).toBe("vi-VN");
        });
      }
    });

    // ── C. Contract variables_schema + placeholder ⊆ schema ───────────────────────────
    describe("C. Contract template BE-3", () => {
      for (const code of Object.keys(EXPECTED_VARIABLES)) {
        it(`${code}: variables_schema == bộ key camelCase BE-3 + placeholder ⊆ schema`, async () => {
          const r = await direct.query<{
            body_template: string;
            short_body_template: string | null;
            title_template: string;
            variables_schema: Record<string, unknown> | null;
            status: string;
            is_default: boolean;
            locale: string;
          }>(
            `SELECT body_template, short_body_template, title_template, variables_schema, status, is_default, locale
             FROM notification_templates
            WHERE company_id IS NULL AND deleted_at IS NULL AND template_code=$1`,
            [notiTemplateCode(code)],
          );
          expect(r.rows.length, `${code} phải có template`).toBe(1);
          const row = r.rows[0];
          expect(row.locale).toBe("vi-VN");
          expect(row.status).toBe("Active");
          expect(row.is_default).toBe(true);
          expect(row.body_template && row.body_template.length).toBeGreaterThan(0);

          const schemaKeys = Object.keys(row.variables_schema ?? {}).sort();
          expect(schemaKeys).toEqual([...EXPECTED_VARIABLES[code]].sort());

          const used = placeholders(row.body_template, row.short_body_template, row.title_template);
          for (const key of used) {
            expect(
              schemaKeys,
              `placeholder {${key}} phải ⊆ variables_schema của ${code}`,
            ).toContain(key);
          }
        });
      }

      it("0481 patch: TASK_ASSIGNED camelCase {taskCode}/{taskTitle}, KHÔNG còn snake_case", async () => {
        const r = await direct.query<{
          body_template: string;
          variables_schema: Record<string, unknown>;
        }>(
          `SELECT body_template, variables_schema FROM notification_templates
          WHERE company_id IS NULL AND deleted_at IS NULL AND template_code='TASK_ASSIGNED__IN_APP__vi-VN'`,
        );
        expect(r.rows.length).toBe(1);
        expect(r.rows[0].body_template).not.toContain("{task_code}");
        expect(r.rows[0].body_template).not.toContain("{task_title}");
        expect(Object.keys(r.rows[0].variables_schema).sort()).toEqual(["taskCode", "taskTitle"]);
        for (const key of placeholders(r.rows[0].body_template)) {
          expect(Object.keys(r.rows[0].variables_schema)).toContain(key);
        }
      });

      it("0481 patch: TASK_STATUS_CHANGED dùng {toStatus} (KHÔNG {new_status}/{newStatus})", async () => {
        const r = await direct.query<{
          body_template: string;
          variables_schema: Record<string, unknown>;
        }>(
          `SELECT body_template, variables_schema FROM notification_templates
          WHERE company_id IS NULL AND deleted_at IS NULL AND template_code='TASK_STATUS_CHANGED__IN_APP__vi-VN'`,
        );
        expect(r.rows.length).toBe(1);
        expect(r.rows[0].body_template).toContain("{toStatus}");
        expect(r.rows[0].body_template).not.toContain("{new_status}");
        expect(r.rows[0].body_template).not.toContain("{newStatus}");
        expect(Object.keys(r.rows[0].variables_schema).sort()).toEqual(["taskCode", "toStatus"]);
      });
    });

    // ── D. Idempotency (re-exec 0490 file qua owner) ──────────────────────────────────
    it("D. re-exec 0490 (owner) 2× → COUNT event/template GLOBAL KHÔNG đổi, KHÔNG exception", async () => {
      const sql = readFileSync(MIGRATION_0490, "utf8");
      const beforeE = await eventCount();
      const beforeT = await templateCount();
      await direct.query(sql);
      await direct.query(sql);
      expect(await eventCount()).toBe(beforeE);
      expect(await templateCount()).toBe(beforeT);
    });

    // ── E. Append-safe + RLS FORCE nguyên vẹn ─────────────────────────────────────────
    it("E. TASK_DEADLINE_CHANGED KHÔNG hard-delete (0 row hoặc disabled) + RLS FORCE bật", async () => {
      const dead = await direct.query<{ is_enabled: boolean }>(
        `SELECT is_enabled FROM notification_events
        WHERE company_id IS NULL AND event_code='TASK_DEADLINE_CHANGED'`,
      );
      // Rename in-place ⇒ 0 row; hoặc (nhánh có canonical/tham chiếu) còn tồn tại nhưng disabled — KHÔNG enabled.
      for (const row of dead.rows) expect(row.is_enabled).toBe(false);

      for (const table of ["notification_events", "notification_templates"]) {
        const rls = await direct.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
          `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname=$1`,
          [table],
        );
        expect(rls.rows[0].relrowsecurity, `${table} RLS phải bật`).toBe(true);
        expect(rls.rows[0].relforcerowsecurity, `${table} FORCE phải bật`).toBe(true);
      }
    });

    // ── F. Engine E2E — TASK_PRIORITY_CHANGED dùng template thật (fallback=false) ──────
    it("F. intake TASK_PRIORITY_CHANGED (recipient ACTIVE ≠ actor) → createdCount≥1, fallback=false", async () => {
      const payload = {
        taskId: recipient, // UUID hợp lệ bất kỳ (chỉ là biến render, không FK)
        taskTitle: "Thiết kế banner",
        taskCode: "TASK-1001",
        projectId: company.companyId,
        actorUserId: actor,
        actorEmployeeId: actor,
        oldPriority: "Normal",
        newPriority: "High",
        assigneeUserId: recipient,
      };
      const summary = await engine.intake(company.companyId, {
        eventCode: "TASK_PRIORITY_CHANGED",
        sourceModule: "TASK",
        actorUserId: actor,
        recipient: { mode: "UserIds", userIds: [recipient], employeeIds: [] },
        payload,
      });
      expect(summary.createdCount, "recipient active ≠ actor phải nhận 1").toBeGreaterThanOrEqual(
        1,
      );

      const n = await direct.query<{ title: string; body: string }>(
        `SELECT title, body FROM notifications
        WHERE company_id=$1 AND recipient_user_id=$2 AND event_code='TASK_PRIORITY_CHANGED' AND deleted_at IS NULL`,
        [company.companyId, recipient],
      );
      expect(n.rows.length).toBe(1);
      // Template THẬT (KHÔNG fallback event_name): title = title_template, body render {taskCode}/{newPriority}.
      expect(n.rows[0].title).toBe("Độ ưu tiên công việc đã thay đổi");
      expect(n.rows[0].body).toContain("TASK-1001");
      expect(n.rows[0].body).toContain("High");

      // fallback=false ⇒ delivery_log metadata NULL (path fallback set reason='template_fallback').
      const dl = await direct.query<{ metadata: Record<string, unknown> | null }>(
        `SELECT dl.metadata FROM notification_delivery_logs dl
         JOIN notifications n ON n.id = dl.notification_id
        WHERE dl.company_id=$1 AND dl.recipient_user_id=$2 AND n.event_code='TASK_PRIORITY_CHANGED'`,
        [company.companyId, recipient],
      );
      expect(dl.rows.length).toBe(1);
      expect(dl.rows[0].metadata).toBeNull();
    });
  },
);
