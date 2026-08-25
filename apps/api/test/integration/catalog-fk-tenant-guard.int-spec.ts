import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { collectFkPairs, pairKey, type FkPair } from "../foundation/fk-tenant-census";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

/**
 * S10-SEC-FKCATALOG-1 (KI-055) — CA NGHIỆM THU HÀNH VI cho guard lớp G (mig `0547`).
 *
 * LỖ ĐANG VÁ. 11 cặp FK một-cột trỏ tới **bảng catalog TOÀN CỤC** (`parent.company_id` NULLABLE)
 * KHÔNG vá được bằng composite FK của `0535`: composite FK đòi khớp đúng `company_id` nên sẽ chặn
 * luôn tham chiếu HỢP LỆ tới hàng toàn cục (đã đo: gán role hệ thống nổ
 * `Key (company_id, role_id)=(A, <role hệ thống>) is not present in table "roles"`). Kiểm tra FK của
 * Postgres bỏ qua RLS ⇒ trong ngữ cảnh tenant A vẫn trỏ được tới hàng cha THUỘC TENANT B.
 * Vá bằng trigger `enforce_company_id_catalog_fk` (`0547`): cha phải CÙNG TENANT **HOẶC** toàn cục.
 *
 * BỐN TỔ HỢP (plan §3) — file này phủ cả bốn:
 *   #1 (con tenant, cha tenant KHÁC)  → DENY 23503 `catalog_fk_tenant_mismatch`
 *   #2 (con tenant, cha CÙNG tenant)  → ALLOW
 *   #3 (con bất kỳ, cha TOÀN CỤC)     → ALLOW  ← chốt chống lặp lại thất bại của composite FK
 *   #4 (con TOÀN CỤC, cha tenant)     → DENY   (chỉ 2 cặp có `child.company_id` nullable)
 *
 * NGUỒN SINH CA = `collectFkPairs(direct)` (đọc `pg_constraint`) — **KHÔNG** phải
 * `collectCatalogFkGuards` (đọc `pg_trigger`). Lý do sống-còn: trước khi áp `0547`, `pg_trigger` trả
 * 0 hàng ⇒ vòng lặp sinh 0 ca ⇒ bước RED "đỏ vì rỗng" chứ không phải "đỏ vì INSERT lọt", và bước
 * GREEN sau đó xanh mà chưa từng chạy một ca DENY nào. `pg_constraint` trả đủ 11 cặp ở CẢ HAI phía
 * migration.
 *
 * THỨ TỰ RED (plan §7.5): chạy file này trên lane CHƯA áp `0547` ⇒ mọi ca DENY phải ĐỎ **vì lệnh
 * INSERT THÀNH CÔNG**, mọi ca ALLOW phải XANH. Sau khi áp `0547`: tất cả XANH. ALLOW đỏ SAU migration
 * = bản vá đang lặp lại thất bại của composite FK ⇒ DỪNG.
 *
 * FIXTURE — bất biến đặt đúng chỗ (plan §7.5):
 *   (a) hàng CHA (kể cả của tenant B) dựng bằng `direct` pool. KHÔNG làm ca xanh giả: phép thử nằm ở
 *       lệnh ghi hàng CON, không ở bước dựng cha; guard nằm trên bảng CON.
 *   (b) lệnh ghi hàng CON chạy dưới `mediaos_app` + `app.current_company_id` (RLS còn bật) — đã đo
 *       cả 8 bảng con đều có GRANT INSERT/UPDATE cho `mediaos_app`.
 *   (c) NGOẠI LỆ tổ hợp #4: con `company_id IS NULL` bị chính RLS `WITH CHECK (company_id = GUC)`
 *       chặn trước khi tới trigger ⇒ ca đó chạy bằng `direct` (superuser). Đó KHÔNG phải né tránh:
 *       actor thật của tổ hợp #4 là **migration/seed chạy bằng superuser** (plan §1.2 "đường bị bỏ
 *       sót #1"), tức đúng vai đang được mô phỏng. Trigger bắn với mọi role (trừ
 *       `session_replication_role='replica'`, thứ §6 của plan CẤM dùng ở đây).
 *
 * KHÔNG dùng `super-admin` ở bất kỳ ca nào (test bằng SA là tautology) và KHÔNG hard-code id hàng
 * toàn cục — luôn tra `WHERE company_id IS NULL LIMIT 1`, thiếu thì tự dựng.
 */

const rid = (): string => randomUUID().slice(0, 8);

/**
 * Kết quả một lệnh ghi. Đây KHÔNG phải `try/catch` nuốt lỗi (thứ plan §7.4 cấm): lệnh ghi THÀNH CÔNG
 * ở ca DENY được ghi lại thành một mục thất bại và assert cuối `toEqual([])` ĐỎ vì nó. Cần kiểu này
 * vì 11 cặp chạy trong MỘT `it` (danh sách cặp chỉ có sau khi query catalog, tức sau lúc Vitest thu
 * thập test) — mỗi cặp vẫn phải nói được nó hỏng kiểu gì.
 */
type WriteResult =
  | { ok: true; rowCount: number }
  | { ok: false; code: string | undefined; message: string };

interface ChildCtx {
  direct: Pool;
  /** `company_id` của hàng CON. `null` = hàng toàn cục (tổ hợp #4). */
  companyId: string | null;
  /** id hàng CHA mà cột FK sẽ trỏ tới. */
  fkValue: string;
}
type ChildBuilder = (ctx: ChildCtx) => Promise<{ text: string; values: unknown[] }>;

describe.skipIf(!hasDb)("S10-SEC-FKCATALOG-1 · guard FK catalog toàn cục (lớp G)", () => {
  const direct = directPool();
  const app = appPool(2);
  let A: SeededTenant;
  let B: SeededTenant;
  /** Hàng toàn cục do chính file này dựng (phải dọn tay — `cleanupTenants` chỉ dọn theo company). */
  const globalRowsToClean: { table: string; id: string }[] = [];
  let pairs: FkPair[] = [];

  // ── Hàng CHA: 6 bảng catalog toàn cục ────────────────────────────────────────
  // `companyId = null` ⇒ dựng hàng TOÀN CỤC. Mọi tên/mã random để không đụng unique index
  // (`roles_system_name_active_uq`, `uq_seed_batches_key_version_company`, …).
  const PARENT_SEEDERS: Record<string, (d: Pool, companyId: string | null) => Promise<string>> = {
    roles: async (d, c) => {
      const r = await d.query(
        `INSERT INTO roles (company_id, name, is_system) VALUES ($1, $2, false) RETURNING id`,
        [c, `fkg-role-${rid()}`],
      );
      return r.rows[0].id as string;
    },
    dashboard_widgets: async (d, c) => {
      const r = await d.query(
        `INSERT INTO dashboard_widgets
           (company_id, widget_code, module_code, name, widget_type, required_permission_code,
            default_data_scope, data_source_key, component_key, is_cacheable, status, is_system_widget)
         VALUES ($1, $2, 'TASK', 'FKG Widget', 'List', 'DASH.WIDGET.VIEW_MY_TASKS',
                 'Own', 'my-tasks', 'MyTasksWidget', true, 'Active', false) RETURNING id`,
        [c, `FKG_WGT_${rid()}`],
      );
      return r.rows[0].id as string;
    },
    notification_events: async (d, c) => {
      const r = await d.query(
        `INSERT INTO notification_events
           (company_id, module_code, event_code, event_name, notification_type,
            default_priority, default_channels, dedupe_strategy, is_enabled, is_system_event)
         VALUES ($1, 'TASK', $2, 'FKG Event', 'Task', 'Normal',
                 '["IN_APP"]'::jsonb, 'None', true, false) RETURNING id`,
        [c, `FKG_EVT_${rid()}`],
      );
      return r.rows[0].id as string;
    },
    notification_templates: async (d, c) => {
      // Sự kiện của template dựng CÙNG `company_id` với template ⇒ luôn thoả guard (tổ hợp #2 hoặc
      // #3-với-cả-hai-NULL). Nếu dựng lệch, chính hàng CHA này sẽ bị guard chặn và ta đo nhầm vật.
      const eventId = await PARENT_SEEDERS.notification_events(d, c);
      const r = await d.query(
        `INSERT INTO notification_templates
           (company_id, event_id, template_code, channel, locale, title_template,
            body_template, version, status, is_default)
         VALUES ($1, $2, $3, 'IN_APP', 'vi-VN', 'FKG {{x}}', 'FKG body', 1, 'Active', false)
         RETURNING id`,
        [c, eventId, `FKG_TPL_${rid()}`],
      );
      return r.rows[0].id as string;
    },
    public_holidays: async (d, c) => {
      const r = await d.query(
        `INSERT INTO public_holidays
           (company_id, holiday_code, name, holiday_date, holiday_type, status)
         VALUES ($1, $2, 'FKG Holiday', '2099-01-01', 'CompanyHoliday', 'Active') RETURNING id`,
        [c, `fkg-hol-${rid()}`],
      );
      return r.rows[0].id as string;
    },
    seed_batches: async (d, c) => {
      const r = await d.query(
        `INSERT INTO seed_batches (company_id, seed_key, seed_version, status)
         VALUES ($1, $2, '1.0.0', 'Pending') RETURNING id`,
        [c, `fkg-sb-${rid()}`],
      );
      return r.rows[0].id as string;
    },
  };

  /** Hàng cha TOÀN CỤC: ưu tiên hàng có sẵn (`roles` hệ thống, widget/event/template seed); thiếu thì dựng. */
  const globalCache = new Map<string, string>();
  async function globalParent(table: string): Promise<string> {
    const cached = globalCache.get(table);
    if (cached) return cached;
    const existing = await direct.query<{ id: string }>(
      `SELECT id FROM ${table} WHERE company_id IS NULL LIMIT 1`,
    );
    let id = existing.rows[0]?.id;
    if (!id) {
      id = await PARENT_SEEDERS[table](direct, null);
      globalRowsToClean.push({ table, id });
    }
    globalCache.set(table, id);
    return id;
  }

  // ── Hàng CON: 1 builder cho mỗi cặp trong 11 ─────────────────────────────────
  // Mọi phụ thuộc NOT NULL khác (user, employee, leave_request…) dựng bằng `direct` TRONG ĐÚNG tenant
  // của hàng con; cột nào bản thân nó cũng thuộc lớp G thì trỏ tới hàng TOÀN CỤC — nếu không, ca sẽ
  // đỏ vì một cặp KHÁC và ta đo nhầm vật.
  const CHILD_INSERTS: Record<string, ChildBuilder> = {
    "user_roles.role_id -> roles": async ({ direct: d, companyId, fkValue }) => {
      const u = await seedUser(d, companyId as string, `fkg-ur-${rid()}@x.test`);
      return {
        text: `INSERT INTO user_roles (user_id, role_id, company_id) VALUES ($1, $2, $3)`,
        values: [u, fkValue, companyId],
      };
    },
    "positions.default_role_id -> roles": async ({ companyId, fkValue }) => ({
      text: `INSERT INTO positions (company_id, name, default_role_id) VALUES ($1, $2, $3)`,
      values: [companyId, `fkg-pos-${rid()}`, fkValue],
    }),
    "dashboard_widget_cache.role_id -> roles": async ({ companyId, fkValue }) => ({
      text: `INSERT INTO dashboard_widget_cache
               (company_id, widget_id, role_id, dashboard_type, cache_scope, cache_key,
                data, status, generated_at, expires_at)
             VALUES ($1, $2, $3, 'System', 'Company', $4, '{}'::jsonb, 'Fresh',
                     now(), now() + interval '5 minutes')`,
      values: [companyId, await globalParent("dashboard_widgets"), fkValue, `fkg-cache-${rid()}`],
    }),
    "dashboard_widget_configs.role_id -> roles": async ({ companyId, fkValue }) => ({
      // CHECK hợp thành: `config_scope='Role'` ⟺ `role_id IS NOT NULL AND user_id IS NULL`.
      text: `INSERT INTO dashboard_widget_configs
               (company_id, widget_id, role_id, dashboard_type, config_scope, is_enabled, sort_order)
             VALUES ($1, $2, $3, 'Employee', 'Role', true, 0)`,
      values: [companyId, await globalParent("dashboard_widgets"), fkValue],
    }),
    "dashboard_widget_cache.widget_id -> dashboard_widgets": async ({ companyId, fkValue }) => ({
      text: `INSERT INTO dashboard_widget_cache
               (company_id, widget_id, dashboard_type, cache_scope, cache_key,
                data, status, generated_at, expires_at)
             VALUES ($1, $2, 'System', 'Company', $3, '{}'::jsonb, 'Fresh',
                     now(), now() + interval '5 minutes')`,
      values: [companyId, fkValue, `fkg-cache-${rid()}`],
    }),
    "dashboard_widget_configs.widget_id -> dashboard_widgets": async ({ companyId, fkValue }) => ({
      text: `INSERT INTO dashboard_widget_configs
               (company_id, widget_id, dashboard_type, config_scope, is_enabled, sort_order)
             VALUES ($1, $2, 'Employee', 'Company', true, 0)`,
      values: [companyId, fkValue],
    }),
    "notification_templates.event_id -> notification_events": async ({ companyId, fkValue }) => ({
      text: `INSERT INTO notification_templates
               (company_id, event_id, template_code, channel, locale, title_template,
                body_template, version, status, is_default)
             VALUES ($1, $2, $3, 'IN_APP', 'vi-VN', 'FKG {{x}}', 'FKG body', 1, 'Active', false)`,
      values: [companyId, fkValue, `FKG_TPL_${rid()}`],
    }),
    "notifications.event_id -> notification_events": async ({ direct: d, companyId, fkValue }) => {
      const u = await seedUser(d, companyId as string, `fkg-noti-${rid()}@x.test`);
      return {
        text: `INSERT INTO notifications (company_id, user_id, type, body, event_id)
               VALUES ($1, $2, 'general', 'fkg-noti', $3)`,
        values: [companyId, u, fkValue],
      };
    },
    "notifications.template_id -> notification_templates": async ({
      direct: d,
      companyId,
      fkValue,
    }) => {
      const u = await seedUser(d, companyId as string, `fkg-notit-${rid()}@x.test`);
      return {
        text: `INSERT INTO notifications (company_id, user_id, type, body, template_id)
               VALUES ($1, $2, 'general', 'fkg-noti-tpl', $3)`,
        values: [companyId, u, fkValue],
      };
    },
    "leave_request_days.public_holiday_id -> public_holidays": async ({
      direct: d,
      companyId,
      fkValue,
    }) => {
      const u = await seedUser(d, companyId as string, `fkg-lrd-${rid()}@x.test`);
      const emp = await d.query(
        `INSERT INTO employee_profiles (company_id, user_id) VALUES ($1, $2) RETURNING id`,
        [companyId, u],
      );
      const lt = await d.query(
        `INSERT INTO leave_types (company_id, name, code) VALUES ($1, 'fkg-lt', $2) RETURNING id`,
        [companyId, `fkg-lt-${rid()}`],
      );
      const lr = await d.query(
        `INSERT INTO leave_requests
           (company_id, user_id, leave_type_id, start_date, end_date, total_days, status)
         VALUES ($1, $2, $3, '2026-06-03', '2026-06-03', 1, 'Pending') RETURNING id`,
        [companyId, u, lt.rows[0].id],
      );
      return {
        text: `INSERT INTO leave_request_days
                 (company_id, leave_request_id, employee_id, leave_type_id, work_date, day_type,
                  public_holiday_id)
               VALUES ($1, $2, $3, $4, '2026-06-03', 'Full Day', $5)`,
        values: [companyId, lr.rows[0].id, emp.rows[0].id, lt.rows[0].id, fkValue],
      };
    },
    "seed_items.seed_batch_id -> seed_batches": async ({ companyId, fkValue }) => ({
      text: `INSERT INTO seed_items
               (seed_batch_id, company_id, target_table, target_key, operation, status)
             VALUES ($1, $2, 'companies', $3, 'Upsert', 'Pending')`,
      values: [fkValue, companyId, `fkg-si-${rid()}`],
    }),
  };

  /** Ghi dưới `mediaos_app` + GUC tenant, luôn ROLLBACK (guard là BEFORE trigger ⇒ đã bắn xong). */
  async function writeAsApp(
    companyId: string,
    sql: string,
    values: unknown[],
  ): Promise<WriteResult> {
    const c = await app.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.current_company_id', $1, true)", [companyId]);
      const r = await c.query(sql, values);
      await c.query("ROLLBACK");
      return { ok: true, rowCount: r.rowCount ?? 0 };
    } catch (e) {
      try {
        await c.query("ROLLBACK");
      } catch {
        /* connection đã hỏng — `release()` ở finally vẫn chạy */
      }
      const err = e as { code?: string; message?: string };
      return { ok: false, code: err.code, message: err.message ?? String(e) };
    } finally {
      c.release();
    }
  }

  /** Ghi dưới superuser (chỉ dùng cho tổ hợp #4 — xem (c) ở đầu file). Trigger vẫn bắn. */
  async function writeAsSuper(sql: string, values: unknown[]): Promise<WriteResult> {
    const c = await direct.connect();
    try {
      await c.query("BEGIN");
      const r = await c.query(sql, values);
      await c.query("ROLLBACK");
      return { ok: true, rowCount: r.rowCount ?? 0 };
    } catch (e) {
      try {
        await c.query("ROLLBACK");
      } catch {
        /* ignore */
      }
      const err = e as { code?: string; message?: string };
      return { ok: false, code: err.code, message: err.message ?? String(e) };
    } finally {
      c.release();
    }
  }

  function isGuardRejection(r: WriteResult): boolean {
    return !r.ok && r.code === "23503" && r.message.includes("catalog_fk_tenant_mismatch");
  }

  beforeAll(async () => {
    A = await seedCompany(direct, "fkgA");
    B = await seedCompany(direct, "fkgB");
    pairs = (await collectFkPairs(direct)).filter((p) => !p.targetTenantOnly);
  });

  afterAll(async () => {
    for (const g of globalRowsToClean) {
      await direct.query(`DELETE FROM ${g.table} WHERE id = $1`, [g.id]);
    }
    await cleanupTenants(direct, [A.companyId, B.companyId]);
    await direct.end();
    await app.end();
  });

  it("PIN: đủ 11 cặp lớp G và mỗi cặp có builder — chống ca co về RỖNG", () => {
    const missing = pairs.map(pairKey).filter((k) => !CHILD_INSERTS[k]);
    expect(
      missing,
      `Cặp lớp G KHÔNG có builder hàng con ⇒ nó sẽ bị BỎ QUA im lặng ở mọi ca dưới đây. ` +
        `Thêm builder vào CHILD_INSERTS, đừng lọc nó ra.`,
    ).toEqual([]);
    expect(
      pairs.length,
      `Chỉ thấy ${pairs.length} cặp lớp G (đo 2026-08-25: 11). Bộ lọc sai ⇒ mọi assert dưới xanh rỗng.`,
    ).toBeGreaterThanOrEqual(11);
  });

  it("#1 DENY — con của tenant A KHÔNG trỏ được tới hàng cha thuộc tenant B", async () => {
    const bad: string[] = [];
    for (const p of pairs) {
      const parentB = await PARENT_SEEDERS[p.tgtTable](direct, B.companyId);
      const ins = await CHILD_INSERTS[pairKey(p)]({
        direct,
        companyId: A.companyId,
        fkValue: parentB,
      });
      const res = await writeAsApp(A.companyId, ins.text, ins.values);
      if (!isGuardRejection(res)) {
        bad.push(
          res.ok
            ? `${pairKey(p)} — GHI THÀNH CÔNG (lỗ KI-055 còn mở: con company_id=A trỏ tới ${p.tgtTable} của B)`
            : `${pairKey(p)} — bị từ chối SAI KIỂU: ${res.code} ${res.message}`,
        );
      }
    }
    expect(
      bad,
      `Guard \`enforce_company_id_catalog_fk\` (mig 0547) phải chặn mọi tham chiếu tới hàng cha ` +
        `THUỘC TENANT KHÁC bằng 23503 \`catalog_fk_tenant_mismatch\`.`,
    ).toEqual([]);
  });

  it("#3 ALLOW — con tenant A VẪN trỏ được tới cha TOÀN CỤC (chốt chống lặp lại thất bại composite FK)", async () => {
    const bad: string[] = [];
    for (const p of pairs) {
      const parentGlobal = await globalParent(p.tgtTable);
      const ins = await CHILD_INSERTS[pairKey(p)]({
        direct,
        companyId: A.companyId,
        fkValue: parentGlobal,
      });
      const res = await writeAsApp(A.companyId, ins.text, ins.values);
      if (!res.ok) bad.push(`${pairKey(p)} — ${res.code} ${res.message}`);
    }
    expect(
      bad,
      `Tham chiếu tới hàng catalog TOÀN CỤC (company_id IS NULL) là hợp lệ theo thiết kế — chặn nó ` +
        `là lặp lại đúng thất bại đã đo của composite FK (không gán được role hệ thống). DỪNG và sửa guard.`,
    ).toEqual([]);
  });

  it("#2 ALLOW — con của tenant A trỏ tới hàng cha CÙNG tenant A", async () => {
    const bad: string[] = [];
    for (const p of pairs) {
      const parentA = await PARENT_SEEDERS[p.tgtTable](direct, A.companyId);
      const ins = await CHILD_INSERTS[pairKey(p)]({
        direct,
        companyId: A.companyId,
        fkValue: parentA,
      });
      const res = await writeAsApp(A.companyId, ins.text, ins.values);
      if (!res.ok) bad.push(`${pairKey(p)} — ${res.code} ${res.message}`);
    }
    expect(bad, `Cha cùng tenant là luồng nghiệp vụ bình thường — guard KHÔNG được chặn.`).toEqual(
      [],
    );
  });

  it("#4 DENY — hàng con TOÀN CỤC không trỏ được tới cha CÓ CHỦ (2 cặp con nullable)", async () => {
    // Rò theo chiều NGƯỢC và phạm vi là TẤT CẢ tenant: một hàng catalog dùng chung mà trỏ vào dữ liệu
    // riêng của một tenant thì kéo dữ liệu đó ra cho mọi tenant khác cùng đọc.
    const nullableChild = pairs.filter((p) => !p.sourceTenantOnly);
    expect(
      nullableChild.map(pairKey).sort(),
      `Đúng 2 cặp có \`child.company_id\` NULLABLE (đo 2026-08-25). Lệch = phân lớp đã đổi.`,
    ).toEqual([
      "notification_templates.event_id -> notification_events",
      "seed_items.seed_batch_id -> seed_batches",
    ]);
    const bad: string[] = [];
    for (const p of nullableChild) {
      const parentB = await PARENT_SEEDERS[p.tgtTable](direct, B.companyId);
      const ins = await CHILD_INSERTS[pairKey(p)]({ direct, companyId: null, fkValue: parentB });
      const res = await writeAsSuper(ins.text, ins.values);
      if (!isGuardRejection(res)) {
        bad.push(
          res.ok ? `${pairKey(p)} — GHI THÀNH CÔNG` : `${pairKey(p)} — ${res.code} ${res.message}`,
        );
      }
    }
    expect(bad).toEqual([]);
  });

  // ── 2 ca CỨNG cho cặp crown-jewel, NGOÀI vòng lặp data-driven ─────────────────
  // Một bộ lọc data-driven tính sai sẽ xanh với 0 ca chạy thật. Hai ca dưới đây không phụ thuộc bộ
  // lọc nào.

  it("CỨNG(1) user_roles: gán role của tenant B cho user tenant A ⇒ 23503 catalog_fk_tenant_mismatch", async () => {
    const roleB = await PARENT_SEEDERS.roles(direct, B.companyId);
    const userA = await seedUser(direct, A.companyId, `fkg-hard1-${rid()}@a.test`);
    const res = await writeAsApp(
      A.companyId,
      `INSERT INTO user_roles (user_id, role_id, company_id) VALUES ($1, $2, $3)`,
      [userA, roleB, A.companyId],
    );
    expect(res).toMatchObject({ ok: false, code: "23503" });
    expect(isGuardRejection(res), `thông điệp phải là catalog_fk_tenant_mismatch`).toBe(true);
  });

  it("CỨNG(2) user_roles: gán role HỆ THỐNG (toàn cục) cho user tenant A ⇒ THÀNH CÔNG", async () => {
    const roleGlobal = await globalParent("roles");
    const userA = await seedUser(direct, A.companyId, `fkg-hard2-${rid()}@a.test`);
    const res = await writeAsApp(
      A.companyId,
      `INSERT INTO user_roles (user_id, role_id, company_id) VALUES ($1, $2, $3)`,
      [userA, roleGlobal, A.companyId],
    );
    expect(res).toEqual({ ok: true, rowCount: 1 });
  });

  /**
   * CỨNG(3)/(4) — ĐƯỜNG **UPDATE**. Trigger là `BEFORE INSERT OR UPDATE`; 8 ca ở trên chỉ phát INSERT,
   * nên nửa mặt phẳng UPDATE trước đây KHÔNG có phép đo nào.
   *
   * Đây không phải ca cho đủ bộ: UPDATE là đường đổi/gỡ role **được thiết kế** của codebase này —
   * `0471` `REVOKE DELETE ON user_roles FROM mediaos_app` + GRANT UPDATE, ghi rõ "gỡ role đi qua UPDATE
   * (soft-delete)". Kịch bản re-point: hàng `user_roles` hợp lệ của tenant A đổi `role_id` sang role
   * của tenant B. RLS cho qua (`company_id` KHÔNG đổi, vẫn = A) ⇒ guard `0547` là thứ DUY NHẤT chặn.
   *
   * Ca ALLOW (4) là bắt buộc, không phải trang trí: thiếu nó thì (3) xanh cả khi trigger chặn MỌI
   * UPDATE. Và cả hai đều assert `rowCount: 1` — một UPDATE khớp 0 hàng cũng trả "thành công", tức
   * (4) sẽ xanh-RỖNG nếu mệnh đề WHERE trượt hoặc RLS che mất hàng.
   */
  async function seedCommittedUserRole(): Promise<{ rowId: string; userId: string }> {
    const roleGlobal = await globalParent("roles");
    const userId = await seedUser(direct, A.companyId, `fkg-upd-${rid()}@a.test`);
    const r = await direct.query<{ id: string }>(
      `INSERT INTO user_roles (user_id, role_id, company_id) VALUES ($1, $2, $3) RETURNING id`,
      [userId, roleGlobal, A.companyId],
    );
    return { rowId: r.rows[0].id, userId };
  }

  it("CỨNG(3) user_roles UPDATE: re-point role_id sang role của tenant B ⇒ 23503 catalog_fk_tenant_mismatch", async () => {
    const { rowId } = await seedCommittedUserRole();
    const roleB = await PARENT_SEEDERS.roles(direct, B.companyId);
    const res = await writeAsApp(A.companyId, `UPDATE user_roles SET role_id = $1 WHERE id = $2`, [
      roleB,
      rowId,
    ]);
    expect(res).toMatchObject({ ok: false, code: "23503" });
    expect(
      isGuardRejection(res),
      `UPDATE là đường đổi role CHÍNH (0471 REVOKE DELETE ⇒ ép qua UPDATE). Guard phải chặn ` +
        `re-point sang tenant khác y như INSERT. Nhận: ${JSON.stringify(res)}`,
    ).toBe(true);
  });

  it("CỨNG(4) user_roles UPDATE: re-point sang role TOÀN CỤC khác ⇒ THÀNH CÔNG (1 hàng)", async () => {
    const { rowId } = await seedCommittedUserRole();
    // Role toàn cục THỨ HAI (khác cái đã gán ở seed) — re-point tới chính nó thì UPDATE không đổi gì
    // và ca này không chứng minh được guard cho qua đường UPDATE.
    const otherGlobalRole = await PARENT_SEEDERS.roles(direct, null);
    globalRowsToClean.push({ table: "roles", id: otherGlobalRole });
    const res = await writeAsApp(A.companyId, `UPDATE user_roles SET role_id = $1 WHERE id = $2`, [
      otherGlobalRole,
      rowId,
    ]);
    expect(
      res,
      `Guard chặn UPDATE hợp lệ = lặp lại thất bại của composite FK, chỉ khác đường vào.`,
    ).toEqual({ ok: true, rowCount: 1 });
  });

  /**
   * CASCADE — tác hại ĐÃ ĐO của KI-055, nay phải BẤT KHẢ ĐẠT.
   *
   * Guard là `BEFORE INSERT OR UPDATE` trên bảng CON ⇒ nó KHÔNG chạm chiều DELETE của bảng cha:
   * `ON DELETE CASCADE` giữ nguyên ngữ nghĩa 100%. Ca này chứng minh chuỗi "B xoá role của B kéo bay
   * hàng user_roles của A" đứt ở MẮT ĐẦU TIÊN — tiền đề (hàng lệch) không tạo được nữa — chứ KHÔNG
   * chứng minh guard chặn được DELETE-cascade (nó không làm việc đó và không cần làm).
   */
  it("cascade-unreachable — B xoá role của B KHÔNG làm bay hàng user_roles của A", async () => {
    // (0) BASELINE PHẢI > 0: gán cho user A một role TOÀN CỤC (đúng ca ALLOW tổ hợp #3) và COMMIT.
    //     Thiếu bước này, assert cuối là `0 === 0` — xanh kể cả khi guard không tồn tại.
    const roleGlobal = await globalParent("roles");
    const userA = await seedUser(direct, A.companyId, `fkg-casc-${rid()}@a.test`);
    await direct.query(
      `INSERT INTO user_roles (user_id, role_id, company_id) VALUES ($1, $2, $3)`,
      [userA, roleGlobal, A.companyId],
    );
    const countA = async (): Promise<number> => {
      const r = await direct.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM user_roles WHERE company_id = $1`,
        [A.companyId],
      );
      return Number(r.rows[0].n);
    };
    const baseline = await countA();
    expect(
      baseline,
      "baseline phải > 0, nếu không assert cuối là 0 === 0 (xanh rỗng)",
    ).toBeGreaterThan(0);

    // (1) B dựng role của mình — thao tác BÌNH THƯỜNG, không bị guard chặn.
    const roleB = await PARENT_SEEDERS.roles(direct, B.companyId);

    // (2) Ngữ cảnh A cố gán role của B. Hai tuyến phòng thủ, nói tách bạch:
    //     (2a) đường app THẬT đã chặn từ tầng service — `PermissionAdminRepository.findAssignableRole`
    //          đọc `roles` DƯỚI RLS của A nên role của B VÔ HÌNH ⇒ NotFound. Tuyến này có TRƯỚC 0547
    //          và KHÔNG phải thứ WO này vá (đó là "kỷ luật tầng service" mà BẤT BIẾN #1 nói không được
    //          dựa vào). Vì vậy ca dưới đây KHÔNG đi đường đó — nó sẽ xanh cả khi guard không tồn tại.
    //     (2b) tuyến DB — mô phỏng repository/worker/script QUÊN kiểm tra ấy: INSERT thẳng dưới
    //          `mediaos_app` + GUC A. Đây LÀ chỗ BẤT BIẾN #1 đòi ép ở tầng DB, và là ca duy nhất
    //          chứng minh `0547` làm việc.
    const viaDb = await writeAsApp(
      A.companyId,
      `INSERT INTO user_roles (user_id, role_id, company_id) VALUES ($1, $2, $3)`,
      [userA, roleB, A.companyId],
    );
    expect(isGuardRejection(viaDb), `phải bị guard chặn, nhận: ${JSON.stringify(viaDb)}`).toBe(
      true,
    );

    // (3) Bằng chứng "không có gì để CASCADE".
    const linked = await direct.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM user_roles WHERE company_id = $1 AND role_id = $2`,
      [A.companyId, roleB],
    );
    expect(Number(linked.rows[0].n)).toBe(0);

    // (4) B xoá role của chính B — thao tác hợp lệ trong tenant B.
    await direct.query(`DELETE FROM roles WHERE id = $1`, [roleB]);

    // (5) Hàng user_roles của A KHÔNG đổi.
    expect(
      await countA(),
      `CASCADE xuyên tenant vẫn xảy ra ⇒ tiền đề (hàng lệch) đã lọt vào DB ở bước (2).`,
    ).toBe(baseline);
  });
});
