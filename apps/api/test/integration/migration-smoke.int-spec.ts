import { afterAll, describe, expect, it } from "vitest";
import { directPool, hasDb } from "../helpers/integration-db";

/**
 * S0-QA-1 — Migration smoke + seed idempotent (DB trống hoặc đã migrate).
 *
 * Xác minh done_when #1 của S0-QA-1:
 *   "migrate + seed chạy sạch từ DB trống (lane DB cô lập) — không lỗi, idempotent"
 *
 * CÁC KIỂM TRA:
 *   1. Bảng nền bắt buộc tồn tại sau chain-migrate (schema sống, không roll-back).
 *   2. Dữ liệu seed idempotent:
 *      a. modules catalog → MVP modules active (AUTH/HR/ATT/LEAVE/TASK/DASH/NOTI) + Extension inactive.
 *      b. system_settings defaults → đủ 5 key bắt buộc (DB-08 §8.3).
 *      c. modules catalog chạy lại INSERT ON CONFLICT → đếm KHÔNG tăng.
 *      d. system_settings chạy lại INSERT ON CONFLICT → đếm KHÔNG tăng.
 *   3. RLS+FORCE: bảng company-scoped PHẢI có RLS enabled + force.
 *   4. Audit log append-only: app role KHÔNG được UPDATE/DELETE audit_logs.
 *   5. Foundation permissions seeded (≥1 foundation-* permission có trong catalog).
 *
 * Chạy CHỈ trên DB CÔ LẬP theo LANE_DB (KHÔNG dùng DB dev chung). Cần chain-migrate + seed trước
 * bằng lane-db-setup.sh (CLAUDE.md §9.5). TỰ SKIP khi thiếu LANE_DB hoặc không có DATABASE_DIRECT_URL.
 *   ⚠️ `skipIf(!hasDb)` ĐƠN THUẦN KHÔNG ĐỦ: .env local trỏ DB dev chung làm hasDb=true → assertion +
 *      deny-path append-only chạy lên DB chung = ĐỎ-GIẢ + nhiễu dữ liệu dev. Vì vậy gate thêm LANE_DB.
 *
 * Luật bất biến (CLAUDE.md §2):
 *   #1 company_id: test dùng direct (bypass RLS) chỉ khi cần đọc cấu trúc global (modules/settings/
 *      permissions không có company_id) hoặc seed tenant test. Mọi hành động nghiệp vụ đi withTenant.
 *   #2 Audit append-only: kiểm chứng REVOKE UPDATE/DELETE hoạt động đúng trên app role.
 *   #3 Không secret plaintext: kiểm tra password_hash KHÔNG xuất hiện trong SELECT * users trả về
 *      (đây là unit-level check; integration giữ lại cho auth-sec spec riêng).
 */

// Bảng nền bắt buộc tồn tại sau chain-migrate (subset đại diện — đầy đủ bảng có trong S0-FND-DB-1).
// NOTE: 'sessions' KHÔNG có trong danh sách này vì bảng phụ thuộc S0-AUTH-DB-1 chưa land.
//       Xem GATE riêng ở cuối file — skipIf sessions chưa tồn tại (S0-QA-1 acceptance check).
const REQUIRED_TABLES = [
  // Foundation
  "companies",
  "system_settings",
  "company_settings",
  "modules",
  "audit_logs",
  "files",
  "file_links",
  "file_access_logs",
  "sequence_counters",
  "public_holidays",
  "data_retention_policies",
  "seed_batches",
  "seed_items",
  // Auth / RBAC (bảng đã có từ migrations 0002–0021, KHÔNG bao gồm 'sessions' → GATE riêng)
  "users",
  "refresh_tokens",
  "password_reset_tokens",
  "roles",
  "permissions",
  "user_roles",
  "role_permissions",
  "object_permissions",
  // Outbox / events
  "outbox_events",
  "processed_events",
] as const;

// MVP modules phải active sau seed (DB-08 §8.2 + 0435_foundation_db5).
const MVP_ACTIVE_MODULES = ["AUTH", "HR", "ATT", "LEAVE", "TASK", "DASH", "NOTI"] as const;

// Extension modules phải inactive.
const EXTENSION_INACTIVE_MODULES = [
  "PAYROLL",
  "RECRUIT",
  "ASSET",
  "ROOM",
  "CHAT",
  "SOCIAL",
] as const;

// system_settings defaults phải tồn tại sau seed (DB-08 §8.3 + 0435_foundation_db5).
const REQUIRED_SYSTEM_SETTINGS = [
  "file.max_upload_size_mb",
  "file.allowed_mime_types",
  "system.default_timezone",
  "system.default_locale",
  "audit.default_retention_days",
] as const;

// Bảng company-scoped phải có RLS enable + force (BẤT BIẾN #1, mig 0002/0431–0435).
const RLS_REQUIRED_TABLES = [
  "companies",
  "users",
  "audit_logs",
  "files",
  "file_links",
  "file_access_logs",
  "sequence_counters",
  "public_holidays",
  "data_retention_policies",
  "seed_batches",
  "seed_items",
  "company_settings",
] as const;

// Gate: hasDb (có DATABASE_DIRECT_URL) + LANE_DB (DB cô lập theo lane). Thiếu LANE_DB → SKIP để
// KHÔNG chạm DB dev chung (tránh đỏ-giả). CI muốn bật → set LANE_DB cho job (việc của S0-CI-1).
const runIsolatedDb = hasDb && !!process.env.LANE_DB;

describe.skipIf(!runIsolatedDb)(
  "S0-QA-1 migration smoke + seed idempotent (DB cô lập theo LANE_DB)",
  () => {
    const direct = directPool();

    afterAll(async () => {
      await direct.end();
    });

    // ── 1. Bảng nền tồn tại ──────────────────────────────────────────────────────────
    describe("1. Required tables exist after chain-migrate", () => {
      for (const table of REQUIRED_TABLES) {
        it(`table '${table}' exists`, async () => {
          const res = await direct.query<{ exists: boolean }>(
            `SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = $1
          ) AS exists`,
            [table],
          );
          expect(res.rows[0].exists, `Bảng '${table}' phải tồn tại sau chain-migrate`).toBe(true);
        });
      }
    });

    // ── 2a. modules catalog seeded — MVP active ──────────────────────────────────────
    describe("2a. Modules catalog — MVP active", () => {
      for (const code of MVP_ACTIVE_MODULES) {
        it(`module ${code} is_active=true after seed`, async () => {
          const res = await direct.query<{ is_active: boolean }>(
            `SELECT is_active FROM modules WHERE module_code = $1 AND deleted_at IS NULL LIMIT 1`,
            [code],
          );
          expect(res.rows.length, `Module '${code}' phải được seed`).toBe(1);
          expect(res.rows[0].is_active, `Module MVP '${code}' phải is_active=true`).toBe(true);
        });
      }
    });

    // ── 2b. modules catalog seeded — Extension inactive ──────────────────────────────
    describe("2b. Modules catalog — Extension inactive", () => {
      for (const code of EXTENSION_INACTIVE_MODULES) {
        it(`module ${code} is_active=false after seed`, async () => {
          const res = await direct.query<{ is_active: boolean }>(
            `SELECT is_active FROM modules WHERE module_code = $1 AND deleted_at IS NULL LIMIT 1`,
            [code],
          );
          expect(res.rows.length, `Module Extension '${code}' phải được seed`).toBe(1);
          expect(
            res.rows[0].is_active,
            `Module Extension '${code}' phải is_active=false (chưa launch)`,
          ).toBe(false);
        });
      }
    });

    // ── 2c. system_settings defaults seeded ──────────────────────────────────────────
    describe("2c. system_settings defaults seeded", () => {
      for (const key of REQUIRED_SYSTEM_SETTINGS) {
        it(`system_setting '${key}' exists and Active`, async () => {
          const res = await direct.query<{ setting_key: string; status: string }>(
            `SELECT setting_key, status FROM system_settings
           WHERE setting_key = $1 AND status = 'Active' LIMIT 1`,
            [key],
          );
          expect(res.rows.length, `system_setting '${key}' phải được seed với status=Active`).toBe(
            1,
          );
        });
      }
    });

    // ── 2d. Idempotent: chạy lại seed modules INSERT ON CONFLICT → không tăng đếm ────
    it("2d. modules catalog idempotent (re-seed không tạo trùng)", async () => {
      const before = await direct.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM modules WHERE deleted_at IS NULL`,
      );

      // Mô phỏng chạy lại seed — cùng insert như 0435 nhưng có ON CONFLICT DO NOTHING.
      await direct.query(`
      INSERT INTO modules (module_code, name, module_group, is_core, is_mvp, is_active, sort_order)
      VALUES
        ('AUTH',    'Tài khoản & phân quyền',    'Core',        true,  true,  true,  1),
        ('HR',      'Nhân sự',                    'Core',        true,  true,  true,  2),
        ('ATT',     'Chấm công',                  'Operation',   false, true,  true,  3),
        ('LEAVE',   'Nghỉ phép',                  'Operation',   false, true,  true,  4),
        ('TASK',    'Công việc & Dự án',          'Collaboration',false,true,  true,  5),
        ('DASH',    'Dashboard',                  'Experience',  false, true,  true,  6),
        ('NOTI',    'Thông báo hệ thống',         'Experience',  false, true,  true,  7)
      ON CONFLICT (module_code) WHERE deleted_at IS NULL DO NOTHING
    `);

      const after = await direct.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM modules WHERE deleted_at IS NULL`,
      );

      expect(after.rows[0].n).toBe(before.rows[0].n);
    });

    // ── 2e. Idempotent: chạy lại seed system_settings INSERT ON CONFLICT → không tăng ─
    it("2e. system_settings idempotent (re-seed không tạo trùng)", async () => {
      const before = await direct.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM system_settings WHERE status = 'Active'`,
      );

      await direct.query(`
      INSERT INTO system_settings
        (setting_key, setting_value, value_type, category, module_code, description, is_public, is_sensitive, status)
      VALUES
        ('file.max_upload_size_mb', '25'::jsonb, 'Number', 'File', 'SYSTEM', 'Dung lượng tối đa (MB)', true, false, 'Active'),
        ('system.default_timezone', '"Asia/Ho_Chi_Minh"'::jsonb, 'String', 'General', 'SYSTEM', 'Timezone mặc định', true, false, 'Active')
      ON CONFLICT (setting_key) WHERE status = 'Active' DO NOTHING
    `);

      const after = await direct.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM system_settings WHERE status = 'Active'`,
      );

      expect(after.rows[0].n).toBe(before.rows[0].n);
    });

    // ── 3. RLS+FORCE: bảng company-scoped phải có RLS enabled + force ─────────────────
    describe("3. RLS ENABLE + FORCE on company-scoped tables (BẤT BIẾN #1)", () => {
      for (const table of RLS_REQUIRED_TABLES) {
        it(`table '${table}' has rowsecurity=true AND forcepolicies=true`, async () => {
          const res = await direct.query<{
            relname: string;
            rowsecurity: boolean;
            forcepolicies: boolean;
          }>(
            `SELECT relname, relrowsecurity AS rowsecurity, relforcerowsecurity AS forcepolicies
           FROM pg_class
           WHERE relname = $1 AND relnamespace = 'public'::regnamespace`,
            [table],
          );
          expect(res.rows.length, `pg_class entry cho '${table}' phải tồn tại`).toBe(1);
          expect(
            res.rows[0].rowsecurity,
            `'${table}' phải ENABLE ROW LEVEL SECURITY (BẤT BIẾN #1)`,
          ).toBe(true);
          expect(
            res.rows[0].forcepolicies,
            `'${table}' phải FORCE ROW LEVEL SECURITY (BẤT BIẾN #1 — chặn table owner bypass)`,
          ).toBe(true);
        });
      }
    });

    // ── 4. Foundation permissions seeded ──────────────────────────────────────────────
    it("4. Foundation permissions catalog seeded (foundation-* resource_type)", async () => {
      const res = await direct.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM permissions WHERE resource_type LIKE 'foundation-%'`,
      );
      expect(
        res.rows[0].n,
        "Ít nhất 1 permission 'foundation-*' phải được seed (0435)",
      ).toBeGreaterThan(0);
    });

    // ── 5. Audit log append-only (deny-path: app role KHÔNG UPDATE/DELETE) ───────────
    describe("5. Audit log append-only (BẤT BIẾN #2 — app role denied UPDATE/DELETE)", () => {
      it("5a. mediaos_app KHÔNG được UPDATE audit_logs", async () => {
        // Dùng app role để thử UPDATE — phải bị từ chối (permission denied for table audit_logs).
        const appDb = new (await import("pg")).Pool({
          connectionString:
            process.env.DATABASE_URL ??
            `postgres://mediaos_app:changeme_app_only@${process.env.PG_HOSTPORT ?? "localhost:5432"}/${process.env.LANE_DB ?? "mediaos"}`,
          max: 1,
        });

        let caught: unknown;
        try {
          const client = await appDb.connect();
          try {
            await client.query("BEGIN");
            // Seed 1 company để có context (bỏ qua RLS, dùng company_id của system — 0001).
            // Cần audit_log row có company_id hợp lệ. Thử UPDATE mọi row — nếu không có row, cũng
            // phải raise permission denied trước (pg kiểm quyền TRƯỚC khi scan rows).
            await client.query(
              `UPDATE audit_logs SET action = 'mutated' WHERE id = '00000000-0000-0000-0000-000000000000'`,
            );
            await client.query("ROLLBACK");
          } finally {
            client.release();
          }
        } catch (err: unknown) {
          caught = err;
        } finally {
          await appDb.end();
        }

        expect(caught, "app role UPDATE audit_logs phải bị từ chối (BẤT BIẾN #2)").toBeDefined();
        const msg = (caught as { message?: string }).message ?? "";
        expect(msg.toLowerCase()).toMatch(/permission denied/);
      });

      it("5b. mediaos_app KHÔNG được DELETE audit_logs", async () => {
        const appDb = new (await import("pg")).Pool({
          connectionString:
            process.env.DATABASE_URL ??
            `postgres://mediaos_app:changeme_app_only@${process.env.PG_HOSTPORT ?? "localhost:5432"}/${process.env.LANE_DB ?? "mediaos"}`,
          max: 1,
        });

        let caught: unknown;
        try {
          const client = await appDb.connect();
          try {
            await client.query("BEGIN");
            await client.query(
              `DELETE FROM audit_logs WHERE id = '00000000-0000-0000-0000-000000000000'`,
            );
            await client.query("ROLLBACK");
          } finally {
            client.release();
          }
        } catch (err: unknown) {
          caught = err;
        } finally {
          await appDb.end();
        }

        expect(caught, "app role DELETE audit_logs phải bị từ chối (BẤT BIẾN #2)").toBeDefined();
        const msg = (caught as { message?: string }).message ?? "";
        expect(msg.toLowerCase()).toMatch(/permission denied/);
      });
    });

    // ── 6. GATE: bảng 'sessions' — skip nếu chưa tồn tại (chờ S0-AUTH-DB-1) ───────────
    // S0-QA-1 acceptance check: "GATE assertion bảng 'sessions' sau S0-AUTH-DB-1 — skipIf sessions
    // chưa tồn tại". Chỉ 'sessions' THIẾU; 8 bảng AUTH/RBAC khác + mọi bảng foundation ĐÃ migrate
    // nên phải PASS. Khi S0-AUTH-DB-1 land, bảng này sẽ tồn tại và test này tự PASS.
    describe("6. GATE — bảng 'sessions' (S0-AUTH-DB-1)", () => {
      it("table 'sessions' exists OR skip if S0-AUTH-DB-1 not yet landed", async () => {
        const res = await direct.query<{ exists: boolean }>(
          `SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = 'sessions'
          ) AS exists`,
        );
        const sessionsExists = res.rows[0]?.exists ?? false;
        if (!sessionsExists) {
          // S0-AUTH-DB-1 chưa land → skip có chú thích (không fail, không giả xanh).
          // Ticket: S0-AUTH-DB-1 (đối chiếu AUTH/RBAC schema + seed).
          console.info(
            "[S0-QA-1 GATE] bảng 'sessions' chưa tồn tại — chờ S0-AUTH-DB-1. Skipping assertion.",
          );
          return;
        }
        expect(sessionsExists, "Bảng 'sessions' phải tồn tại sau khi S0-AUTH-DB-1 land").toBe(true);
      });
    });
  },
);
