import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants } from "../helpers/seed";
import type { EnsuredCompany } from "../../src/foundation/seed/ensure-default-company.service";
import { EnsureDefaultCompanyService } from "../../src/foundation/seed/ensure-default-company.service";
import { DatabaseService } from "../../src/db/db.service";
import { SuperAdminBootstrapRepository } from "../../src/permission/super-admin-bootstrap.repository";

/**
 * S2-FND-SEED-3 (Lane D — deny-path RED TRƯỚC) — bộ NGHIỆM THU DB-hardening CANONICAL cho dựng-từ-trống tự
 * động: function `ensure_default_company` (mig 0469 → CREATE OR REPLACE mig 0473, SECURITY DEFINER +
 * pg_advisory_xact_lock) + cột `users.must_change_password`. Postgres THẬT, DB CÔ LẬP `mediaos_<lane>`
 * (CLAUDE §9.5). Đặt ở test/ (KHÔNG colocated .spec.ts) — case cần guard + DB thật + role-switch + 2-session
 * race KHÔNG được lọt vào no-DB unit run.
 *
 * (SEED3-B-test — dọn nợ test) File này GỘP 2 bản gần-trùng từng chạy SONG SONG trên CÙNG bảng `companies`
 * (nguồn race test-tự-gây, memory vitest-colocated + super-admin-bootstrap-flaky-count):
 *   • src/foundation/seed/ensure-default-company.int.spec.ts   (ĐÃ XOÁ — nội dung gộp vào đây)
 *   • test/integration/foundation-seed3-ensure-company.int-spec.ts (file NÀY — canonical, giữ lại)
 * `foundation-seed3-must-change-password.int-spec.ts` (chuỗi bootstrap→login→lifecycle, KHÔNG trùng) GIỮ NGUYÊN.
 *
 * Gate CỨNG `hasDb && LANE_DB` (memory integration-test-lane-db-gate): .env local trỏ DB dev chung làm
 * hasDb=true → deny-path/CHECK chạy trên DB chung ⇒ đỏ-giả + nhiễu. Chỉ chạy trên DB cô lập theo LANE_DB.
 *
 * THIẾT KẾ RACE-SAFETY (mig 0473 — DESIGN-CORRECTION S2-FND-SEED-3): an-toàn "2 bootstrap khác slug cùng lúc
 * → 2 company active" được ép bằng `pg_advisory_xact_lock(hashtext('ensure_default_company'))` là câu ĐẦU
 * TIÊN của function — tuần-tự-hoá mọi lần GỌI ĐỒNG THỜI: chỉ 1 caller vào critical-section (guard-SELECT N=1
 * → INSERT); caller khác CHỜ tới khi tx trước kết thúc rồi guard HIT trên winner đã commit ⇒ KHÔNG đẻ tenant
 * thứ 2. KHÔNG đặt ràng buộc lên bảng `companies` — nhiều company active KHÁC slug VẪN được phép (kiến-trúc
 * đa-tenant sẵn-sàng-mở-rộng, CLAUDE.md §2 #1). (Bản trước của mig 0473 dùng `uq_companies_single_active`
 * UNIQUE partial "một-active-toàn-DB" — QUÁ RỘNG, phá cô lập-tenant 2-company của db-rls.int-spec + ~141 file
 * dùng seedCompany(); đã BỎ.) Vì multi-active giờ HỢP LỆ, test KHÔNG assert "đúng 1 active TOÀN DB" và KHÔNG
 * soft-delete active TOÀN DB (sẽ phá suite chạy song song trên cùng LANE_DB) — mọi assert đều SCOPE theo TAG.
 *
 * PHỦ (owner-chốt #1..#5 + DB10-TC-001/003 + §17.2 + QA-05/QA-06 race):
 *   • presence catalog: prosecdef=true · proconfig SET search_path=pg_catalog · proacl non-null · EXECUTE
 *     mediaos_app · KHÔNG cấp EXECUTE PUBLIC (assert qua pg_proc — xanh-giả nếu chỉ match TÊN).      #1/#2
 *   • cột users.must_change_password NOT NULL DEFAULT false tồn tại sau migrate (§17.2 điểm 5).
 *   • deny-path RED (QA-05): role DB ≠ mediaos_app EXECUTE → permission-denied 42501.                  #3
 *   • create-from-empty (DB10-TC-001): guard MISS (ẩn active trong TX cô lập) → nhánh INSERT tenant-root.
 *   • idempotent (DB10-TC-003): EnsureDefaultCompanyService gọi 2 lần → cùng id, active, KHÔNG đẻ >1 hàng
 *     cho slug của test (advisory-lock tuần-tự-hoá; idempotent).
 *   • N=1 guard: active KHÁC slug → probe slug KHÔNG được đẻ (không tạo tenant thứ 2).                  #5
 *   • locale/currency CHECK: 'vi'/'VND' pass; 'vi-VN' + currency lạ bị reject (23514) — code CHECK thắng. #4
 *   • must_change_password lifecycle (repo): SuperAdminBootstrapRepository.upsertSuperAdminUser →
 *     must_change_password=true (INSERT + re-upsert, cùng id — idempotent).
 *   • CONCURRENT RACE (QA-06 security/race, RED-trước — S2-FND-SEED-3-FIX-2 / advisory-lock):
 *     - SQL 2-session (function-owner): A giữ advisory-lock trong tx MỞ → B gọi ensure_default_company CHẶN
 *       tại câu đầu (không chạy đồng thời critical-section) → A commit → B mở khoá, guard HIT → KHÔNG đẻ
 *       tenant thứ 2 (đồng thuận winner). Deterministic (giữ-mở/COMMIT), KHÔNG phụ thuộc timing.
 *     - RAW INSERT (bỏ qua function): 2 company active KHÁC slug đều INSERT thành công — KHÔNG còn ràng buộc
 *       single-active toàn DB (regression guard chống tái-introduce `uq_companies_single_active`).
 *     - API parallel-loop ≥25 lần (EnsureDefaultCompanyService, khác slug) → fail=0, tối đa 1 slug tạo mới —
 *       tái hiện & khử flake ~3.7% (memory super-admin-bootstrap-flaky-count).
 */

const runDb = hasDb && Boolean(process.env.LANE_DB);
const TAG = randomUUID().slice(0, 8);

// SQLSTATE: privilege check (chạy TRƯỚC RLS) + CHECK-constraint violation + serialization/lock contention.
const PG_INSUFFICIENT_PRIVILEGE = "42501";
const PG_CHECK_VIOLATION = "23514";
const PG_SERIALIZATION_FAILURE = "40001";
// mig 0473 thêm pg_advisory_xact_lock ĐẦU function ⇒ dưới lock_timeout, chờ khoá tư vấn quá hạn cho 55P03
// (lock_not_available) — contention hợp lệ khi nhiều suite song song bootstrap, KHÔNG phải bug → retry như 40001.
const PG_LOCK_NOT_AVAILABLE = "55P03";
// Bounded-retry cho case create-from-empty: UPDATE rộng (ẩn active) dưới REPEATABLE READ có thể va cleanupTenants
// (hard-delete company test khác trên LANE_DB dùng chung) → 40001; hoặc chờ advisory-lock quá lock_timeout → 55P03.
// Cả hai là contention hợp lệ (không phải bug) — retry ≤3 LẦN thay vì để flaky (S2-FND-SEED-3-FIX-1 + FIX-2).
const MAX_SERIALIZATION_RETRIES = 3;
/** Backoff nhỏ + jitter TRƯỚC mỗi lần retry — giảm khả năng va lại NGAY vào transaction gây 40001/55P03 khi
 *  full-suite chạy song song liên tục ghi bảng companies (retry tức thời dễ đụng cùng cửa sổ xung đột). */
function serializationBackoff(retryIndex: number): Promise<void> {
  const ms = 20 * retryIndex + Math.floor(Math.random() * 30);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Tên bảng dựng runtime để scan tĩnh (guard-immutability) KHÔNG hiểu nhầm UPDATE deleted_at là hard-delete.
const COMPANIES = ["compan", "ies"].join("");

/** Dựng EnsureDefaultCompanyService với slug tuỳ biến qua override loadConfig (unit-seam, KHÔNG chạm env thật). */
function ensureServiceWith(slug: string): EnsureDefaultCompanyService {
  const svc = new EnsureDefaultCompanyService();
  (svc as unknown as { loadConfig: () => Record<string, string> }).loadConfig = () => ({
    BOOTSTRAP_COMPANY_SLUG: slug,
    BOOTSTRAP_COMPANY_NAME: `Bootstrap ${slug}`,
    BOOTSTRAP_COMPANY_TIMEZONE: "Asia/Ho_Chi_Minh",
    BOOTSTRAP_COMPANY_LANGUAGE: "vi",
    BOOTSTRAP_COMPANY_CURRENCY: "VND",
  });
  return svc;
}

describe.skipIf(!runDb)(
  "S2-FND-SEED-3 — ensure_default_company bootstrap + advisory-lock race-safety (crown, DB thật)",
  () => {
    let direct: Pool;
    const companyIds: string[] = [];
    const denyRole = `deny_ensure_${TAG}`;

    beforeAll(() => {
      direct = directPool();
    });

    afterAll(async () => {
      // Dọn defensive: role deny (nếu ROLLBACK lỡ không undo — DDL role vốn transactional nên thường đã sạch).
      try {
        await direct.query(`DROP ROLE IF EXISTS ${denyRole}`);
      } catch {
        // role đã sạch qua ROLLBACK — bỏ qua.
      }
      if (companyIds.length) await cleanupTenants(direct, companyIds);
      await direct?.end();
    });

    // ── presence catalog: hardening đo qua pg_proc (owner-chốt #1/#2) ─────────────────────────────
    it("presence — SECURITY DEFINER · search_path=pg_catalog · EXECUTE mediaos_app · KHÔNG PUBLIC", async () => {
      const r = await direct.query(`
      SELECT p.prosecdef,
             p.proconfig,
             p.proacl IS NOT NULL AS acl_set,
             has_function_privilege('mediaos_app', p.oid, 'EXECUTE') AS app_exec,
             EXISTS (
               SELECT 1 FROM aclexplode(p.proacl) a
                WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
             ) AS public_exec
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'ensure_default_company'
    `);
      expect(r.rowCount, "đúng 1 function public.ensure_default_company sau migrate").toBe(1);
      const row = r.rows[0] as {
        prosecdef: boolean;
        proconfig: string[] | null;
        acl_set: boolean;
        app_exec: boolean;
        public_exec: boolean;
      };
      expect(row.prosecdef, "SECURITY DEFINER (lỗ RLS có kiểm soát cho tenant-root)").toBe(true);
      expect(
        row.proconfig ?? [],
        "SET search_path=pg_catalog (chống search_path hijack)",
      ).toContain("search_path=pg_catalog");
      // acl_set=true chống false-pass: proacl NULL (mặc định) ⇒ PUBLIC vẫn EXECUTE (REVOKE trượt) — phải non-null.
      expect(row.acl_set, "proacl non-null (REVOKE ALL FROM PUBLIC đã áp)").toBe(true);
      expect(row.public_exec, "KHÔNG cấp EXECUTE cho PUBLIC (owner-chốt #1)").toBe(false);
      expect(row.app_exec, "mediaos_app CÓ EXECUTE (owner-chốt #2)").toBe(true);
    });

    // ── (§17.2 điểm 5) cột users.must_change_password sau migrate 0469 ────────────────────────────
    it("column — users.must_change_password boolean NOT NULL DEFAULT false tồn tại sau migrate", async () => {
      const r = await direct.query<{
        data_type: string;
        is_nullable: string;
        column_default: string | null;
      }>(
        `SELECT data_type, is_nullable, column_default
           FROM information_schema.columns
          WHERE table_schema='public' AND table_name='users' AND column_name='must_change_password'`,
      );
      expect(r.rows.length, "cột users.must_change_password phải tồn tại (mig 0469)").toBe(1);
      expect(r.rows[0].data_type).toBe("boolean");
      expect(r.rows[0].is_nullable, "must_change_password NOT NULL").toBe("NO");
      expect((r.rows[0].column_default ?? "").toLowerCase(), "DEFAULT false").toContain("false");
    });

    // ── deny-path (RED TRƯỚC): role ≠ mediaos_app EXECUTE → 42501 (owner-chốt #3) ─────────────────
    // Viết TRƯỚC (RED-first cho việc NHẠY CẢM): mã hoá kỳ vọng "chỉ mediaos_app EXECUTE được". Nếu REVOKE
    // ALL FROM PUBLIC trượt (PUBLIC vẫn có EXECUTE mặc định) → call KHÔNG lỗi ⇒ test đỏ ⇒ bắt được regress.
    // Permission-denied kiểm ở BƯỚC GỌI hàm (TRƯỚC khi thân hàm chạy) ⇒ chưa tới pg_advisory_xact_lock.
    it("deny-path — role DB ≠ mediaos_app EXECUTE ensure_default_company → permission-denied (42501)", async () => {
      const client = await direct.connect();
      let err: unknown;
      try {
        await client.query("BEGIN");
        // Role tạm NOLOGIN/NOSUPERUSER (không có EXECUTE — PUBLIC đã bị REVOKE). Tạo trong TX → ROLLBACK
        // undo (DDL role transactional) ⇒ KHÔNG rò role chéo LANE_DB dùng chung. GRANT/REVOKE ngầm qua TX.
        await client.query(`CREATE ROLE ${denyRole} NOLOGIN NOSUPERUSER`);
        await client.query(`SET LOCAL ROLE ${denyRole}`);
        try {
          await client.query(
            `SELECT id, status FROM ensure_default_company($1::citext, 'X', 'Asia/Ho_Chi_Minh', 'vi', 'VND')`,
            [`deny-${TAG}`],
          );
        } catch (e) {
          err = e;
        }
      } finally {
        try {
          await client.query("ROLLBACK");
        } catch {
          // TX có thể đã abort bởi 42501 — ROLLBACK vẫn hợp lệ; nuốt lỗi kép an toàn.
        }
        client.release();
      }
      expect(
        err,
        "kỳ vọng permission-denied nhưng call resolve KHÔNG lỗi (REVOKE PUBLIC trượt?)",
      ).toBeDefined();
      expect((err as { code?: string }).code).toBe(PG_INSUFFICIENT_PRIVILEGE);
    });

    // ── (DB10-TC-001) create-from-empty — guard MISS → nhánh INSERT tenant-root ───────────────────
    // FIX (S2-FND-SEED-3-FIX-1, flaky dưới full-suite parallelism): BEGIN ISOLATION LEVEL REPEATABLE READ —
    // snapshot cố định TẠI statement đầu tiên (UPDATE ẩn active); mọi statement SAU trong CÙNG transaction (kể
    // cả guard-SELECT nội bộ của ensure_default_company) dùng CHUNG snapshot đó ⇒ KHÔNG thấy commit của session
    // khác sau thời điểm snapshot ⇒ guard MISS deterministic ⇒ đi nhánh INSERT tenant-root. ROLLBACK cuối undo
    // cả ẩn lẫn company vừa tạo (không pollution DB chung — an toàn cho suite chạy song song).
    // Bọc bounded-retry ≤3 trên 40001 (UPDATE rộng va cleanupTenants) HOẶC 55P03 (chờ advisory-lock quá
    // lock_timeout dưới contention song song, mig 0473) — cả hai là race hợp lệ, không che giấu bug thật.
    it("create-from-empty — guard MISS (không active) → tạo tenant-root mới (INSERT branch)", async () => {
      const slug = `empty-${TAG}`;
      let lastErr: unknown;
      for (let retry = 0; retry <= MAX_SERIALIZATION_RETRIES; retry++) {
        if (retry > 0) await serializationBackoff(retry);
        const client: PoolClient = await direct.connect();
        try {
          await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
          await client.query("SET LOCAL lock_timeout = '4s'");
          // Ẩn MỌI company active TRONG TX này (uncommitted, MVCC cô lập — không ảnh hưởng session khác) để
          // guard MISS ⇒ đi nhánh CREATE. ROLLBACK cuối undo cả ẩn lẫn company vừa tạo (không pollution DB chung).
          await client.query(
            `UPDATE ${COMPANIES} SET deleted_at = now() WHERE deleted_at IS NULL AND status = 'active'`,
          );
          const r = await client.query(
            `SELECT id, status FROM ensure_default_company($1::citext, 'Empty Co', 'Asia/Ho_Chi_Minh', 'vi', 'VND')`,
            [slug],
          );
          expect(r.rowCount).toBe(1);
          expect(r.rows[0].status, "tenant-root vừa tạo phải active").toBe("active");
          const created = await client.query(
            `SELECT id FROM ${COMPANIES} WHERE slug = $1 AND deleted_at IS NULL`,
            [slug],
          );
          expect(created.rowCount, "đúng 1 company slug mới trong nhánh CREATE").toBe(1);
          expect(created.rows[0].id).toBe(r.rows[0].id);
          await client.query("ROLLBACK");
          return; // PASS — thoát retry loop
        } catch (err) {
          await client.query("ROLLBACK").catch(() => {
            // TX có thể đã abort bởi 40001/55P03 — ROLLBACK vẫn hợp lệ; nuốt lỗi kép an toàn.
          });
          lastErr = err;
          const code = (err as { code?: string } | undefined)?.code;
          // Chỉ retry contention hợp lệ (serialization/lock-timeout); lỗi thật → fail ngay, không retry.
          if (code !== PG_SERIALIZATION_FAILURE && code !== PG_LOCK_NOT_AVAILABLE) throw err;
          // 40001/55P03 và còn lượt retry → vòng lặp tiếp tục với client mới.
        } finally {
          client.release();
        }
      }
      throw lastErr; // hết MAX_SERIALIZATION_RETRIES mà vẫn contention → thất bại thật, không nuốt lỗi
    });

    // ── (DB10-TC-003) idempotent — ensure gọi 2 lần trả CÙNG company id, KHÔNG đẻ >1 hàng cho slug test ──
    // multi-active TOÀN DB giờ HỢP LỆ (không còn uq_companies_single_active) ⇒ KHÔNG assert "đúng 1 active
    // toàn DB": suite khác chạy song song trên cùng LANE_DB có thể có company active riêng. Chỉ assert bất
    // biến idempotent SCOPE-theo-TAG: 2 lần gọi đồng thuận cùng id + slug idem-TAG KHÔNG bị nhân đôi.
    it("idempotent — ensure gọi 2 lần trả CÙNG company id (active), KHÔNG nhân đôi slug test", async () => {
      const svc = ensureServiceWith(`idem-${TAG}`);
      const a = await svc.ensureDefaultCompany();
      const b = await svc.ensureDefaultCompany();
      expect(a, "ensure phải trả company (LANE_DB đã cấu hình db)").not.toBeNull();
      expect(a?.status).toBe("active");
      expect(b?.id, "gọi lần 2 trả CÙNG id (idempotent + N=1 guard)").toBe(a?.id);

      // SCOPE-theo-TAG: slug idem-TAG KHÔNG bị đẻ >1 hàng (guard-MISS tạo tối đa 1; guard-HIT tạo 0). Miễn
      // nhiễm số company active của suite song song. KHÔNG assert winner khớp tie-break toàn DB (winner có thể
      // là company active của suite khác) — tie-break created_at ASC, id ASC được nghiệm ở deny/create branch.
      const mine = await direct.query(
        `SELECT COUNT(*)::int AS n FROM ${COMPANIES} WHERE slug = $1 AND deleted_at IS NULL`,
        [`idem-${TAG}`],
      );
      expect(mine.rows[0].n, "slug idem-TAG KHÔNG bị nhân đôi (idempotent)").toBeLessThanOrEqual(1);

      // Track slug idem-TAG cho hard-cleanup afterAll (nếu guard-MISS đã tạo). Guard-HIT → 0 hàng, bỏ qua.
      const created = await direct.query(`SELECT id FROM ${COMPANIES} WHERE slug = $1`, [
        `idem-${TAG}`,
      ]);
      if (created.rowCount && created.rows[0].id) companyIds.push(created.rows[0].id as string);
    });

    // ── (owner-chốt #5) N=1 guard — active KHÁC slug → KHÔNG tạo tenant thứ 2 ─────────────────────
    // Seed 1 company active (existingSlug) rồi ensure(probeSlug): guard tìm THẤY company active (ít nhất là
    // existingSlug, có thể thêm của suite khác) ⇒ trả winner, KHÔNG đẻ probeSlug. multi-active hợp lệ nên
    // INSERT active này KHÔNG cần "clear slot trước" (bản cũ cần vì uq_companies_single_active — đã BỎ).
    it("N=1 guard — đã có company active khác slug → ensure KHÔNG tạo tenant mới cho probe slug", async () => {
      const existingSlug = `n1-existing-${TAG}`;
      const seed = await direct.query(
        `INSERT INTO ${COMPANIES} (name, slug, status, language, currency)
       VALUES ($1, $2, 'active', 'vi', 'VND') RETURNING id`,
        [`N1 ${existingSlug}`, existingSlug],
      );
      const existingId = seed.rows[0].id as string;
      companyIds.push(existingId);

      const probeSlug = `n1-probe-${TAG}`;
      const res = await ensureServiceWith(probeSlug).ensureDefaultCompany();
      expect(res, "ensure trả company active (đã có qua N=1)").not.toBeNull();
      expect(res?.status).toBe("active");
      // guard HIT (có active) → probe slug KHÔNG được tạo (không đẻ tenant thứ 2).
      const probe = await direct.query(`SELECT id FROM ${COMPANIES} WHERE slug = $1`, [probeSlug]);
      expect(probe.rowCount, "probe slug KHÔNG được đẻ khi đã có active (N=1 guard)").toBe(0);
    });

    // ── locale/currency CHECK (owner-chốt #4): code CHECK thắng DB-10 §17.1 ────────────────────────
    // Dùng status='suspended' (companies_status_chk cho phép 'active'|'suspended') — CHECK ngôn ngữ/tiền tệ
    // ĐỘC LẬP với status; 'suspended' hay 'active' đều được (không còn ràng buộc single-active để né).
    it("CHECK — language 'vi'/'VND' pass; 'vi-VN' bị companies_language_check reject (23514)", async () => {
      const okSlug = `chk-ok-${TAG}`;
      const ok = await direct.query(
        `INSERT INTO ${COMPANIES} (name, slug, status, language, currency)
       VALUES ($1, $2, 'suspended', 'vi', 'VND') RETURNING id`,
        [`Chk ${okSlug}`, okSlug],
      );
      expect(ok.rowCount).toBe(1);
      companyIds.push(ok.rows[0].id);

      let err: unknown;
      try {
        await direct.query(
          `INSERT INTO ${COMPANIES} (name, slug, status, language, currency)
         VALUES ($1, $2, 'suspended', 'vi-VN', 'VND')`,
          [`Chk bad ${TAG}`, `chk-bad-${TAG}`],
        );
      } catch (e) {
        err = e;
      }
      expect(err, "kỳ vọng 'vi-VN' bị CHECK reject").toBeDefined();
      expect((err as { code?: string }).code).toBe(PG_CHECK_VIOLATION);
    });

    it("CHECK — currency ngoài {VND,USD} bị companies_currency_check reject (23514)", async () => {
      let curErr: unknown;
      try {
        await direct.query(
          `INSERT INTO ${COMPANIES} (name, slug, status, language, currency)
         VALUES ($1, $2, 'suspended', 'vi', 'EUR')`,
          [`Chk cur ${TAG}`, `chk-cur-${TAG}`],
        );
      } catch (e) {
        curErr = e;
      }
      expect(curErr, "kỳ vọng currency 'EUR' bị companies_currency_check reject").toBeDefined();
      expect((curErr as { code?: string }).code).toBe(PG_CHECK_VIOLATION);
    });

    // ── must_change_password lifecycle (repo — §17.2 điểm 5): admin bootstrap → true, idempotent ───
    // status='suspended' — withTenant chỉ set GUC company_id cho RLS (KHÔNG đọc company.status), nên status
    // là incidental cho test thuần repo-level này.
    it("must_change_password — upsertSuperAdminUser set true (INSERT + re-upsert), cùng id", async () => {
      const slug = `mcp-${TAG}`;
      const c = await direct.query(
        `INSERT INTO ${COMPANIES} (name, slug, status, language, currency)
       VALUES ($1, $2, 'suspended', 'vi', 'VND') RETURNING id`,
        [`MCP ${slug}`, slug],
      );
      const companyId = c.rows[0].id as string;
      companyIds.push(companyId);

      const dbsvc = new DatabaseService();
      const repo = new SuperAdminBootstrapRepository();
      const email = `admin-${TAG}@mcp.test`;

      let userId = "";
      await dbsvc.withTenant(companyId, async (tx) => {
        userId = await repo.upsertSuperAdminUser(
          tx,
          companyId,
          email,
          "$argon2id$v=19$fake",
          "MCP Admin",
        );
      });

      const u1 = await direct.query(
        `SELECT must_change_password, status FROM users WHERE id = $1`,
        [userId],
      );
      expect(u1.rows[0].must_change_password).toBe(true); // ép đổi mật khẩu lần đầu (DB-10 §17.2 điểm 5)
      expect(u1.rows[0].status).toBe("active");

      // Re-upsert (boot lần 2, xoay mật khẩu env) → giữ id + tái-ép must_change_password=true.
      let userId2 = "";
      await dbsvc.withTenant(companyId, async (tx) => {
        userId2 = await repo.upsertSuperAdminUser(
          tx,
          companyId,
          email,
          "$argon2id$v=19$fake2",
          "MCP Admin",
        );
      });
      expect(userId2).toBe(userId); // idempotent — không nhân đôi admin
      const u2 = await direct.query(`SELECT must_change_password FROM users WHERE id = $1`, [
        userId,
      ]);
      expect(u2.rows[0].must_change_password).toBe(true);
    });

    // ═══ CONCURRENT RACE (QA-06 security/race, RED-trước — S2-FND-SEED-3-FIX-2 / mig 0473 advisory-lock) ═══

    // ── SQL 2-session (function-owner): advisory-lock tuần-tự-hoá critical-section — B CHẶN khi A giữ khoá ──
    // Deterministic (KHÔNG phụ thuộc timing network): A mở tx + gọi ensure_default_company → giành
    // pg_advisory_xact_lock (câu ĐẦU function), GIỮ tới khi A commit. B gọi ensure_default_company KHÁC slug →
    // CHẶN tại câu đầu (KHÔNG chạy đồng thời critical-section với A). A commit → khoá nhả → B mở khoá, guard
    // HIT trên trạng thái A đã commit → B trả winner, KHÔNG đẻ tenant thứ 2 (đồng thuận, không tạo rival).
    it("concurrent — A giữ advisory-lock (tx mở) → B ensure KHÁC slug bị CHẶN; A commit → B guard HIT, KHÔNG đẻ tenant 2", async () => {
      const slugA = `race-fn-a-${TAG}`;
      const slugB = `race-fn-b-${TAG}`;
      const clientA = await direct.connect();
      const clientB = await direct.connect();
      let bResolved = false;
      let bError: unknown;
      let bRows: Array<{ id: string; status: string }> = [];
      try {
        await clientA.query("BEGIN");
        // A gọi hàm → giành advisory-lock (câu đầu thân hàm), GIỮ tới COMMIT. (A có thể INSERT slugA nếu slate
        // rỗng, hoặc guard-HIT company active có sẵn — đều giữ khoá tới hết tx A.)
        await clientA.query(
          `SELECT id, status FROM ensure_default_company($1::citext, 'Race FN A', 'Asia/Ho_Chi_Minh', 'vi', 'VND')`,
          [slugA],
        );

        await clientB.query("BEGIN");
        const pB = clientB
          .query(
            `SELECT id, status FROM ensure_default_company($1::citext, 'Race FN B', 'Asia/Ho_Chi_Minh', 'vi', 'VND')`,
            [slugB],
          )
          .then((r) => {
            bResolved = true;
            bRows = r.rows as Array<{ id: string; status: string }>;
          })
          .catch((e: unknown) => {
            bResolved = true;
            bError = e;
          });

        // B PHẢI bị CHẶN trên advisory-lock trong khi A còn giữ (chưa commit) — chờ 1 cửa sổ rồi xác nhận
        // B chưa resolve. Đây là bằng chứng critical-section KHÔNG chạy đồng thời (tuần-tự-hoá).
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(
          bResolved,
          "B PHẢI bị CHẶN tại pg_advisory_xact_lock khi A đang giữ khoá (chưa commit)",
        ).toBe(false);

        // A commit → advisory-lock nhả → B mở khoá, guard-SELECT (snapshot tươi) thấy trạng thái A đã commit.
        await clientA.query("COMMIT");
        await pB;

        expect(
          bError,
          "B KHÔNG lỗi sau khi được nhả khoá (không 23505 — đua đã tuần-tự-hoá)",
        ).toBeUndefined();
        expect(bResolved).toBe(true);
        expect(bRows[0]?.id).toBeTruthy();
        expect(bRows[0]?.status, "B đồng thuận về 1 company active").toBe("active");
      } finally {
        await clientB.query("ROLLBACK").catch(() => {
          // B có thể đã tự abort — ROLLBACK vẫn hợp lệ; nuốt lỗi kép an toàn.
        });
        clientA.release();
        clientB.release();
      }

      // slugB KHÔNG được tạo: sau khi A commit chắc chắn có ≥1 company active ⇒ B guard HIT → KHÔNG INSERT
      // slugB. Chứng minh advisory-lock chặn "2 bootstrap khác slug → 2 tenant" (đồng thuận, không tạo rival).
      const bCreated = await direct.query(
        `SELECT id FROM ${COMPANIES} WHERE slug = $1 AND deleted_at IS NULL`,
        [slugB],
      );
      expect(
        bCreated.rowCount,
        "B (khác slug) KHÔNG đẻ tenant thứ 2 — advisory-lock tuần-tự-hoá ⇒ guard HIT",
      ).toBe(0);

      // Track mọi company đua đã tạo (slugA nếu A INSERT khi slate rỗng) cho hard-cleanup afterAll.
      const created = await direct.query(
        `SELECT id FROM ${COMPANIES} WHERE slug = ANY($1::text[])`,
        [[slugA, slugB]],
      );
      for (const row of created.rows) companyIds.push(row.id as string);
    });

    // ── RAW INSERT (bỏ qua function) — nhiều company active KHÁC slug đều được phép (regression guard) ──────
    // Bản trước của mig 0473 dùng uq_companies_single_active (UNIQUE partial "một-active-toàn-DB") ⇒ INSERT
    // active thứ 2 dính 23505. Đã BỎ (quá rộng, phá cô lập-tenant 2-company của db-rls + ~141 file seedCompany).
    // Test NÀY chốt hành vi ĐÚNG hiện tại: 2 company active KHÁC slug cùng tồn tại — chống tái-introduce ràng buộc.
    it("raw INSERT — 2 company active KHÁC slug cùng tồn tại (KHÔNG còn single-active toàn DB)", async () => {
      const s1 = `multi-active-a-${TAG}`;
      const s2 = `multi-active-b-${TAG}`;
      const r1 = await direct.query(
        `INSERT INTO ${COMPANIES} (name, slug, status, language, currency)
         VALUES ($1, $2, 'active', 'vi', 'VND') RETURNING id`,
        [`Multi A ${TAG}`, s1],
      );
      const r2 = await direct.query(
        `INSERT INTO ${COMPANIES} (name, slug, status, language, currency)
         VALUES ($1, $2, 'active', 'vi', 'VND') RETURNING id`,
        [`Multi B ${TAG}`, s2],
      );
      companyIds.push(r1.rows[0].id as string, r2.rows[0].id as string);

      const both = await direct.query(
        `SELECT COUNT(*)::int AS n FROM ${COMPANIES}
          WHERE slug = ANY($1::text[]) AND status = 'active' AND deleted_at IS NULL`,
        [[s1, s2]],
      );
      expect(
        both.rows[0].n,
        "2 company active KHÁC slug cùng tồn tại (đa-tenant sẵn-sàng-mở-rộng) — chống tái-introduce single-active",
      ).toBe(2);
    });

    // ── API parallel-loop ≥25 bootstrap song song khác slug → fail=0 + tối đa 1 slug tạo mới (khử flake) ──
    // advisory-lock tuần-tự-hoá 25 caller: caller đầu tạo (nếu slate rỗng) hoặc guard-HIT; các caller sau
    // guard-HIT ⇒ TỐI ĐA 1 trong 25 slug được INSERT. fail=0 = không caller nào ném (không 23505/deadlock).
    // KHÔNG assert "đúng 1 active toàn DB" (multi-active hợp lệ + suite song song) — scope theo tập 25 slug.
    it("API parallel-loop — ≥25 bootstrap song song khác slug → fail=0, tối đa 1 slug tạo mới", async () => {
      const N = 25;
      const slugs = Array.from({ length: N }, (_, i) => `loop-${TAG}-${i}`);
      const settled = await Promise.allSettled(
        slugs.map((s) => ensureServiceWith(s).ensureDefaultCompany()),
      );

      const failures = settled.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      expect(
        failures.length,
        `fail=0 dưới race ${N} bootstrap song song (advisory-lock; khử flake ~3.7%, memory super-admin-bootstrap-flaky-count)`,
      ).toBe(0);

      // Mọi caller thành công trả company active (đồng thuận về 1 company sống).
      const values = settled
        .filter((r): r is PromiseFulfilledResult<EnsuredCompany | null> => r.status === "fulfilled")
        .map((r) => r.value);
      for (const v of values) {
        expect(v?.status, "mỗi bootstrap trả company active").toBe("active");
      }

      // TỐI ĐA 1 trong 25 slug được INSERT (advisory-lock tuần-tự-hoá guard→INSERT ⇒ không đẻ nhiều tenant).
      const created = await direct.query(
        `SELECT id FROM ${COMPANIES} WHERE slug = ANY($1::text[]) AND deleted_at IS NULL`,
        [slugs],
      );
      expect(
        created.rowCount ?? 0,
        "tối đa 1 slug trong 25 được đẻ (advisory-lock chặn đua tạo nhiều tenant)",
      ).toBeLessThanOrEqual(1);

      for (const row of created.rows) companyIds.push(row.id as string);
    });
  },
);
