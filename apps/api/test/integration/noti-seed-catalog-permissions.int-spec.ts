/**
 * S4-NOTI-SEED-1 (lane notiSeedRegistryVerify) — NOTI event-catalog + template-contract + 7 cặp quyền +
 *   grant/deny (migration 0481_s4_notiseed1_event_template_perms). RED-before-GREEN.
 *
 * Colocated glob `test/**\/*.int-spec.ts` (đã xác minh vitest.config include). Gate CỨNG
 * `hasDb && LANE_DB` (memory integration-test-lane-db-gate): .env trỏ DB dev chung → hasDb=true nên assert
 * chạm DB chung = ĐỎ-GIẢ; CHỈ chạy trên DB cô lập lane (LANE_DB=mediaos_notiseed).
 *
 * RED: trên DB migrate đến 0480 → thiếu event/template/cặp config/grant ⇒ ĐỎ. Sau 0481 → GREEN.
 *
 * Phủ (mốc = notification-event-catalog.const.ts, KHÔNG hard-code chuỗi rời rạc):
 *   A. Catalog match — SELECT event_code (company_id IS NULL) == registry (thiếu ĐỎ · thừa ĐỎ);
 *      is_enabled đúng từng mã (MVP=true, dư=false).
 *   B. Template coverage — mỗi event enabled có ĐÚNG 1 template IN_APP/vi-VN/Active/is_default, body non-null;
 *      event disabled KHÔNG có template.
 *   C. Permission catalog — 6 cặp config is_sensitive=true; KHÔNG cặp 'channel'/'notification-channel'.
 *   D. POSITIVE grant — company-admin 6 cặp config @Company; read:notification @Own cho 4 role.
 *   E. DENY-path — HR/employee/manager 0 grant các cặp config (least privilege).
 *   F. Idempotent bộ-ba — re-apply INSERT ON CONFLICT 3× KHÔNG drift scope/count.
 */

import { afterAll, describe, expect, it } from "vitest";
import { directPool, hasDb } from "../helpers/integration-db";
import {
  NOTI_CANONICAL_ROLES,
  NOTI_CONFIG_PAIRS,
  NOTI_CONFIG_PAIR_COUNT,
  NOTI_CONFIG_RESOURCE_TYPES,
  NOTI_ENABLED_EVENTS,
  NOTI_ENABLED_EVENT_COUNT,
  NOTI_OWN_ACTIONS,
  NOTI_EVENT_CATALOG,
  NOTI_EVENT_COUNT,
  NOTI_PERMISSION_PAIRS,
  NOTI_READ_PAIR,
  notiTemplateCode,
} from "../../src/foundation/seed/notification-event-catalog.const";

const runIsolatedDb = hasDb && !!process.env.LANE_DB;

/** scope đã grant cho (role canonical, action, resource); null nếu KHÔNG có hàng ALLOW. */
async function grantScope(
  direct: ReturnType<typeof directPool>,
  role: string,
  action: string,
  resource: string,
): Promise<string | null> {
  const res = await direct.query<{ data_scope: string }>(
    `SELECT rp.data_scope
       FROM role_permissions rp
       JOIN roles r ON r.id = rp.role_id
       JOIN permissions p ON p.id = rp.permission_id
      WHERE r.name=$1 AND r.company_id IS NULL AND r.deleted_at IS NULL
        AND p.action=$2 AND p.resource_type=$3 AND rp.effect='ALLOW'`,
    [role, action, resource],
  );
  return res.rows.length > 0 ? res.rows[0].data_scope : null;
}

/** COUNT grant của role trên tập resource_type config (least-privilege check). */
async function configGrantCount(
  direct: ReturnType<typeof directPool>,
  role: string,
): Promise<number> {
  const res = await direct.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n
       FROM role_permissions rp
       JOIN roles r ON r.id = rp.role_id
       JOIN permissions p ON p.id = rp.permission_id
      WHERE r.name=$1 AND r.company_id IS NULL AND r.deleted_at IS NULL
        AND rp.effect='ALLOW'
        AND p.resource_type = ANY($2)`,
    [role, NOTI_CONFIG_RESOURCE_TYPES],
  );
  return res.rows[0].n;
}

describe.skipIf(!runIsolatedDb)(
  "S4-NOTI-SEED-1 NOTI catalog + templates + permissions (mig 0481, DB cô lập LANE_DB)",
  () => {
    const direct = directPool();

    afterAll(async () => {
      await direct.end();
    });

    // ── A. Catalog event GLOBAL == registry (thiếu ĐỎ · thừa ĐỎ) ────────────────────
    describe("A. notification_events GLOBAL khớp registry (UNION SPEC-08 §15 + DB-07 §14.1)", () => {
      it("pin: registry có đúng 55 mã (41 enabled + 14 disabled) — sau mig 0507 (S5-GOAL-DB-1)", () => {
        expect(NOTI_EVENT_COUNT).toBe(55);
        expect(NOTI_ENABLED_EVENT_COUNT).toBe(41);
      });

      it("tập event_code (company_id IS NULL) == registry — KHÔNG mã lạ, KHÔNG thiếu", async () => {
        const res = await direct.query<{ event_code: string }>(
          `SELECT event_code FROM notification_events
            WHERE company_id IS NULL AND deleted_at IS NULL`,
        );
        const dbSet = new Set(res.rows.map((r) => r.event_code));
        const regSet = new Set(NOTI_EVENT_CATALOG.map((e) => e.eventCode));

        const missingInDb = [...regSet].filter((c) => !dbSet.has(c)); // registry có, DB thiếu
        const extraInDb = [...dbSet].filter((c) => !regSet.has(c)); // DB có, registry thiếu (mã lạ)

        expect(
          missingInDb,
          `event THIẾU trong DB (chưa seed 0481): ${missingInDb.join(", ")}`,
        ).toEqual([]);
        expect(extraInDb, `event LẠ trong DB (ngoài registry): ${extraInDb.join(", ")}`).toEqual(
          [],
        );
        expect(dbSet.size).toBe(NOTI_EVENT_COUNT);
      });

      for (const e of NOTI_EVENT_CATALOG) {
        it(`${e.eventCode}: is_enabled=${e.isEnabled}, module=${e.module}, type=${e.type}, priority=${e.priority}`, async () => {
          const res = await direct.query<{
            is_enabled: boolean;
            module_code: string;
            notification_type: string;
            default_priority: string;
            is_system_event: boolean;
          }>(
            `SELECT is_enabled, module_code, notification_type, default_priority, is_system_event
               FROM notification_events
              WHERE event_code=$1 AND company_id IS NULL AND deleted_at IS NULL`,
            [e.eventCode],
          );
          expect(res.rows.length, `event ${e.eventCode} phải tồn tại GLOBAL sau 0481`).toBe(1);
          const row = res.rows[0];
          expect(row.is_enabled).toBe(e.isEnabled);
          expect(row.module_code).toBe(e.module);
          expect(row.notification_type).toBe(e.type);
          expect(row.default_priority).toBe(e.priority);
          expect(row.is_system_event).toBe(e.isSystemEvent);
        });
      }
    });

    // ── B. Template coverage — mỗi event enabled có ĐÚNG 1 template IN_APP/vi-VN/Active ──
    describe("B. notification_templates: đúng 1 IN_APP/vi-VN/Active/default cho mỗi event enabled", () => {
      for (const e of NOTI_ENABLED_EVENTS) {
        it(`${e.eventCode}: 1 template ${notiTemplateCode(e.eventCode)} — body non-null`, async () => {
          const res = await direct.query<{
            template_code: string;
            channel: string;
            locale: string;
            status: string;
            is_default: boolean;
            body_len: number;
          }>(
            `SELECT t.template_code, t.channel, t.locale, t.status, t.is_default,
                    COALESCE(length(t.body_template), 0) AS body_len
               FROM notification_templates t
               JOIN notification_events ev ON ev.id = t.event_id
              WHERE ev.event_code=$1 AND ev.company_id IS NULL
                AND t.company_id IS NULL AND t.deleted_at IS NULL
                AND t.channel='IN_APP' AND t.locale='vi-VN'`,
            [e.eventCode],
          );
          expect(
            res.rows.length,
            `event enabled ${e.eventCode} phải có ĐÚNG 1 template IN_APP/vi-VN`,
          ).toBe(1);
          const row = res.rows[0];
          expect(row.template_code).toBe(notiTemplateCode(e.eventCode));
          expect(row.status).toBe("Active");
          expect(row.is_default).toBe(true);
          expect(row.locale).toBe("vi-VN");
          expect(row.body_len, "body_template phải NOT NULL và length>0").toBeGreaterThan(0);
        });
      }

      it("event DISABLED KHÔNG có template IN_APP/vi-VN (least-content)", async () => {
        const disabled = NOTI_EVENT_CATALOG.filter((e) => !e.isEnabled).map((e) => e.eventCode);
        const res = await direct.query<{ event_code: string }>(
          `SELECT DISTINCT ev.event_code
             FROM notification_templates t
             JOIN notification_events ev ON ev.id = t.event_id
            WHERE ev.company_id IS NULL AND t.company_id IS NULL AND t.deleted_at IS NULL
              AND ev.event_code = ANY($1)`,
          [disabled],
        );
        expect(
          res.rows.map((r) => r.event_code),
          "event disabled KHÔNG được có template",
        ).toEqual([]);
      });

      it("tổng template GLOBAL IN_APP/vi-VN Active == số event enabled (41 sau 0507)", async () => {
        const res = await direct.query<{ n: number }>(
          `SELECT COUNT(*)::int AS n
             FROM notification_templates
            WHERE company_id IS NULL AND deleted_at IS NULL
              AND channel='IN_APP' AND locale='vi-VN' AND status='Active' AND is_default=true`,
        );
        expect(res.rows[0].n).toBe(NOTI_ENABLED_EVENT_COUNT);
      });
    });

    // ── C. Permission catalog — 6 cặp config is_sensitive=true; KHÔNG 'channel' ──────
    describe("C. Catalog quyền: 6 cặp config sensitive + KHÔNG phantom 'channel'", () => {
      it(`pin: registry có ${NOTI_CONFIG_PAIR_COUNT} cặp config sensitive`, () => {
        expect(NOTI_CONFIG_PAIR_COUNT).toBe(6);
      });

      for (const p of NOTI_CONFIG_PAIRS) {
        it(`(${p.action}:${p.resourceType}) tồn tại, is_sensitive=true`, async () => {
          const res = await direct.query<{ is_sensitive: boolean }>(
            `SELECT is_sensitive FROM permissions WHERE action=$1 AND resource_type=$2`,
            [p.action, p.resourceType],
          );
          expect(res.rows.length, `cặp (${p.action}:${p.resourceType}) phải có sau 0481`).toBe(1);
          expect(res.rows[0].is_sensitive).toBe(true);
        });
      }

      it("read:notification GIỮ NGUYÊN non-sensitive (0005 — KHÔNG bị đụng)", async () => {
        const res = await direct.query<{ is_sensitive: boolean }>(
          `SELECT is_sensitive FROM permissions WHERE action='read' AND resource_type='notification'`,
        );
        expect(res.rows.length).toBe(1);
        expect(res.rows[0].is_sensitive).toBe(false);
      });

      it("KHÔNG tồn tại cặp NOTI phantom 'notification-channel' (DB-02 §9.7 = 0 kết quả)", async () => {
        // Phantom NOTI = 'notification-channel' (thông báo KHÔNG có resource 'channel' riêng — kênh gửi
        // là thuộc tính của template/delivery-log). LƯU Ý: 'channel' generic (create/read/update/delete/
        // manage) là quyền MEDIA-era (platform channel — OUT-OF-SCOPE, parked) ĐÃ có trước 0481; KHÔNG
        // phải NOTI ⇒ chỉ khẳng định 0481 KHÔNG đẻ ra 'notification-channel'.
        const res = await direct.query<{ n: number }>(
          `SELECT COUNT(*)::int AS n FROM permissions WHERE resource_type = 'notification-channel'`,
        );
        expect(res.rows[0].n, "cặp NOTI phantom 'notification-channel' — phải 0").toBe(0);
      });

      it("registry NOTI config KHÔNG dùng resource_type 'channel' (không mượn media-channel)", () => {
        expect(NOTI_CONFIG_RESOURCE_TYPES).not.toContain("channel");
        expect(NOTI_CONFIG_RESOURCE_TYPES).not.toContain("notification-channel");
      });
    });

    // ── D. POSITIVE grant — deny-path một mình KHÔNG bắt được grant-0-row ────────────
    describe("D. POSITIVE grant (role_permissions JOIN roles/permissions)", () => {
      for (const p of NOTI_CONFIG_PAIRS) {
        it(`company-admin (${p.action}:${p.resourceType}) = Company`, async () => {
          expect(await grantScope(direct, "company-admin", p.action, p.resourceType)).toBe(
            "Company",
          );
        });
      }

      // OWN-SCOPE: mọi role canonical phải có ĐỦ 4 hành động @Own. Trước bản vá 2026-07-09 chỉ 'read'
      // được grant ⇒ mark-read/mark-all-read/hide của S4-NOTI-BE-1 sẽ 403 cho MỌI role (silent-403).
      // Test này khoá cả 4 tuple — regress một cái là đỏ ngay, không chờ tới lúc BE chạy mới phát hiện.
      for (const role of NOTI_CANONICAL_ROLES) {
        for (const action of NOTI_OWN_ACTIONS) {
          it(`${role} ${action}:notification = Own`, async () => {
            expect(
              await grantScope(direct, role, action, NOTI_READ_PAIR.resourceType),
              `${role} thiếu ${action}:notification @Own ⇒ endpoint own-scope NOTI-BE-1 sẽ 403`,
            ).toBe("Own");
          });
        }
      }

      it("company-admin có ĐỦ 6/6 cặp config @Company", async () => {
        expect(await configGrantCount(direct, "company-admin")).toBe(NOTI_CONFIG_PAIR_COUNT);
      });
    });

    // ── E. DENY-path (least-privilege) — HR/employee/manager 0 cặp config ────────────
    describe("E. DENY-path config grants (least privilege)", () => {
      for (const role of ["hr", "employee", "manager"] as const) {
        it(`${role} có 0/6 grant cặp config NOTI`, async () => {
          expect(await configGrantCount(direct, role), `${role} không được có grant config`).toBe(
            0,
          );
        });

        for (const p of NOTI_CONFIG_PAIRS) {
          it(`${role} KHÔNG grant (${p.action}:${p.resourceType})`, async () => {
            expect(await grantScope(direct, role, p.action, p.resourceType)).toBeNull();
          });
        }
      }
    });

    // ── F. Idempotent bộ-ba (ON CONFLICT DO NOTHING KHÔNG drift scope) ───────────────
    it("F. Idempotent (triple): re-apply INSERT ON CONFLICT scope SAI KHÔNG đổi grant NOTI", async () => {
      const snapshot = async () =>
        (
          await direct.query<{ k: string }>(
            `SELECT r.name || '|' || p.action || ':' || p.resource_type || '|' || rp.data_scope AS k
               FROM role_permissions rp
               JOIN roles r ON r.id = rp.role_id
               JOIN permissions p ON p.id = rp.permission_id
              WHERE r.name = ANY($1) AND r.company_id IS NULL AND rp.effect='ALLOW'
                AND ( p.resource_type = ANY($2)
                   OR (p.action='read' AND p.resource_type='notification') )
              ORDER BY k`,
            [[...NOTI_CANONICAL_ROLES], NOTI_CONFIG_RESOURCE_TYPES],
          )
        ).rows
          .map((x) => x.k)
          .join("\n");

      const before = await snapshot();

      // Re-apply 3× mô phỏng migrator chạy lại: INSERT ON CONFLICT(role_id,permission_id,effect) DO NOTHING
      // với scope CỐ Ý SAI ('System') — KHÔNG được ghi đè scope đã seed (bộ-ba bất biến).
      for (let i = 0; i < 3; i++) {
        // config pair (company-admin) scope sai
        await direct.query(
          `INSERT INTO role_permissions (role_id, permission_id, effect, data_scope)
           SELECT r.id, p.id, 'ALLOW', 'System'
             FROM roles r CROSS JOIN permissions p
            WHERE r.name='company-admin' AND r.company_id IS NULL
              AND p.action='view' AND p.resource_type='notification-config'
           ON CONFLICT (role_id, permission_id, effect) DO NOTHING`,
        );
        // read:notification (employee) scope sai
        await direct.query(
          `INSERT INTO role_permissions (role_id, permission_id, effect, data_scope)
           SELECT r.id, p.id, 'ALLOW', 'Company'
             FROM roles r CROSS JOIN permissions p
            WHERE r.name='employee' AND r.company_id IS NULL
              AND p.action='read' AND p.resource_type='notification'
           ON CONFLICT (role_id, permission_id, effect) DO NOTHING`,
        );
      }

      const after = await snapshot();
      expect(after, "re-apply ON CONFLICT KHÔNG drift scope").toBe(before);
      expect(after).toContain("company-admin|view:notification-config|Company");
      expect(after).toContain("employee|read:notification|Own");
    });
  },
);
