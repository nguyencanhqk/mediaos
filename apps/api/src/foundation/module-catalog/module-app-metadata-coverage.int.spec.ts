/**
 * S14-FND-MODULEMETA-1 / L1-RATCHET-RED — cổng DB-backed cho `MODULE_APP_METADATA`.
 *
 * ⚠️ TIỀN ĐỀ (đọc trước khi tin kết quả): spec này chạy trên DB Ở-HEAD (lane DB đã áp TOÀN BỘ migration,
 * kể cả 0564–0568 của wave S13-PAYROLL). PROD hiện CHƯA áp 0564–0568 ⇒ tập `permissions` trên PROD HẸP
 * HƠN tập ở đây. Spec này KHÔNG chứng minh gì về PROD; nó chỉ chứng minh hằng BE khớp CATALOG Ở HEAD.
 * Việc PROD chưa áp band này là nợ vận hành đã ghi ở hồ sơ wave S14-CONSOLIDATE.
 *
 * KHÁC ratchet unit-spec (test/foundation/module-app-metadata-ratchet.unit-spec.ts — parse migration TĨNH):
 * spec này hỏi DB THẬT, nên bắt được cả thứ migration không nói: hàng `modules` bị wave sau BẬT
 * (`is_active=true`) mà quên metadata, hoặc cặp engine bị bịa/gõ sai không có trong catalog `permissions`.
 *
 * ⛔ CHỈ SELECT — tuyệt đối KHÔNG INSERT/UPDATE vào `permissions` / `modules`. Hai bảng này là catalog TOÀN
 * CỤC (không có company_id) ⇒ `cleanupTenants` KHÔNG dọn được; fixture ghi vào đó sẽ đóng dấu vĩnh viễn lên
 * lane DB và làm spec khác xanh-giả (memory: test-fixture-stamps-global-permission-catalog; đai 2 =
 * test/global-catalog-fence.ts sẽ đỏ nếu ai đó ghi).
 *
 * Phủ:
 *   C1  mọi `modules` is_active=true AND deleted_at IS NULL PHẢI có MODULE_APP_METADATA. Miễn trừ KHÔNG
 *       được chấp nhận cho module ACTIVE (khác unit ratchet: ở đó EXEMPT hợp lệ cho module inactive).
 *       Đỏ khi wave sau bật module mà quên metadata — bàn giao S16-SOCIAL-FE-1.
 *   C2  mỗi cặp trong mọi `requiredAny` PHẢI tồn tại 1 hàng `permissions(action, resource_type)`.
 *       Cặp bịa ⇒ card không bao giờ hiện cho ai (fail-soft im lặng ở getMyApps) ⇒ phải ĐỎ ở đây.
 *   C3  cặp nào `permissions.is_sensitive = true` mà KHÔNG có trong SENSITIVE_CAPABILITY_ALLOWLIST ⇒ ĐỎ:
 *       getCapabilities() lọc bỏ MỌI grant sensitive nên card sẽ bị ẨN-NGẦM cho MỌI role (đúng lỗi ATT
 *       trước Option B). Hôm nay 5 cặp mới đều is_sensitive=false ⇒ đây là ca ĐỀ PHÒNG, không phải mô tả.
 */

import "reflect-metadata";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasDb, directPool } from "../../../test/helpers/integration-db";
import { __SENSITIVE_CAPABILITY_ALLOWLIST_FOR_TEST } from "../../permission/permission.service";
import { MODULE_APP_METADATA } from "./module-app-metadata";

/** Gate cứng: Postgres THẬT VÀ DB cô lập lane (CLAUDE.md §9.5, memory integration-test-lane-db-gate). */
const runDb = hasDb && Boolean(process.env.LANE_DB);

const capKey = (action: string, resourceType: string) => `${action}:${resourceType}`;

describe.skipIf(!runDb)(
  "S14-FND-MODULEMETA-1 — MODULE_APP_METADATA ↔ catalog DB (chỉ SELECT)",
  () => {
    let direct: Pool;
    let activeModuleCodes: string[] = [];
    /** key "action:resourceType" → is_sensitive, đọc từ catalog `permissions` toàn cục. */
    let permissionCatalog = new Map<string, boolean>();

    beforeAll(async () => {
      direct = directPool();
      const mods = await direct.query<{ module_code: string }>(
        "SELECT module_code FROM modules WHERE is_active = true AND deleted_at IS NULL ORDER BY module_code",
      );
      activeModuleCodes = mods.rows.map((r) => r.module_code);
      const perms = await direct.query<{
        action: string;
        resource_type: string;
        is_sensitive: boolean;
      }>("SELECT action, resource_type, is_sensitive FROM permissions");
      permissionCatalog = new Map(
        perms.rows.map((r) => [capKey(r.action, r.resource_type), r.is_sensitive]),
      );
    });

    afterAll(async () => {
      await direct?.end();
    });

    it("tiền đề: DB có hàng `modules` active và catalog `permissions` không rỗng", () => {
      expect(activeModuleCodes.length).toBeGreaterThan(0);
      expect(permissionCatalog.size).toBeGreaterThan(0);
    });

    it("C1 — mọi module is_active=true (deleted_at IS NULL) đều có MODULE_APP_METADATA (KHÔNG miễn trừ)", () => {
      const missing = activeModuleCodes.filter((code) => !MODULE_APP_METADATA[code]).sort();
      expect(missing).toEqual([]);
    });

    it("C2 — mọi cặp engine trong requiredAny tồn tại trong catalog `permissions`", () => {
      const unknown: string[] = [];
      for (const [code, meta] of Object.entries(MODULE_APP_METADATA)) {
        for (const p of meta.requiredAny) {
          const key = capKey(p.action, p.resourceType);
          if (!permissionCatalog.has(key)) unknown.push(`${code} → ${key}`);
        }
      }
      expect(unknown.sort()).toEqual([]);
    });

    it("C3 — cặp is_sensitive=true PHẢI nằm trong SENSITIVE_CAPABILITY_ALLOWLIST (chống ẩn-ngầm)", () => {
      const unlisted: string[] = [];
      for (const [code, meta] of Object.entries(MODULE_APP_METADATA)) {
        for (const p of meta.requiredAny) {
          const key = capKey(p.action, p.resourceType);
          if (permissionCatalog.get(key) !== true) continue; // non-sensitive ⇒ getCapabilities đã surface
          if (!__SENSITIVE_CAPABILITY_ALLOWLIST_FOR_TEST.has(key))
            unlisted.push(`${code} → ${key}`);
        }
      }
      expect(unlisted.sort()).toEqual([]);
    });

    it("C3b — module chỉ gate bằng cặp SENSITIVE thì phải có ≥1 cặp được allowlist (không câm)", () => {
      const mute: string[] = [];
      for (const [code, meta] of Object.entries(MODULE_APP_METADATA)) {
        if (meta.requiredAny.length === 0) continue; // ME: hiện cho mọi user, có chủ ý
        const surfaced = meta.requiredAny.some((p) => {
          const key = capKey(p.action, p.resourceType);
          if (!permissionCatalog.has(key)) return false;
          return (
            permissionCatalog.get(key) === false ||
            __SENSITIVE_CAPABILITY_ALLOWLIST_FOR_TEST.has(key)
          );
        });
        if (!surfaced) mute.push(code);
      }
      expect(mute.sort()).toEqual([]);
    });
  },
);
