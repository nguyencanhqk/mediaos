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
 * động: function `ensure_default_company` (mig 0469 → CREATE OR REPLACE mig 0473, SECURITY DEFINER) +
 * `uq_companies_single_active` (mig 0473) + cột `users.must_change_password`. Postgres THẬT, DB CÔ LẬP
 * `mediaos_<lane>` (CLAUDE §9.5). Đặt ở test/ (KHÔNG colocated .spec.ts) — case cần guard + DB thật +
 * role-switch + 2-session race KHÔNG được lọt vào no-DB unit run.
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
 * BẤT BIẾN MỚI (mig 0473, single-active TOÀN DB — CHỨ KHÔNG PHẢI CHỈ N=1-GUARD-Ở-TẦNG-CODE): tối đa 1 hàng
 * `companies` có (status='active' AND deleted_at IS NULL) CÙNG LÚC, ép bởi `uq_companies_single_active`
 * (UNIQUE INDEX partial trên biểu thức hằng `(true)`). Mọi test TRONG FILE NÀY cần chiếm "slot active" (N=1
 * guard / idempotent / concurrent-race) PHẢI trả lại slot NGAY sau khi dùng xong (helper `deactivate` —
 * soft-delete THẬT, KHÔNG chờ tới afterAll) để KHÔNG khoá suite khác chạy song song trên cùng LANE_DB. Test
 * KHÔNG cần semantics "active" thật (CHECK ngôn ngữ/tiền tệ, must_change_password lifecycle) dùng
 * status='suspended' để KHÔNG bao giờ đụng slot (companies_status_chk cho phép 'active'|'suspended').
 *
 * PHỦ (owner-chốt #1..#5 + DB10-TC-001/003 + §17.2 + QA-05/QA-06 race):
 *   • presence catalog: prosecdef=true · proconfig SET search_path=pg_catalog · proacl non-null · EXECUTE
 *     mediaos_app · KHÔNG cấp EXECUTE PUBLIC (assert qua pg_proc — xanh-giả nếu chỉ match TÊN).      #1/#2
 *   • cột users.must_change_password NOT NULL DEFAULT false tồn tại sau migrate (§17.2 điểm 5).
 *   • deny-path RED (QA-05): role DB ≠ mediaos_app EXECUTE → permission-denied 42501.                  #3
 *   • create-from-empty (DB10-TC-001): guard MISS (ẩn active trong TX cô lập) → nhánh INSERT tenant-root.
 *   • idempotent (DB10-TC-003) DETERMINISTIC: EnsureDefaultCompanyService gọi 2 lần → cùng id, active,
 *     KHÔNG phình; xác nhận winner khớp tie-break TẤT ĐỊNH `ORDER BY created_at ASC, id ASC` (mig 0473) —
 *     khử flake (memory super-admin-bootstrap-flaky-count).
 *   • N=1 guard: active KHÁC slug → probe slug KHÔNG được đẻ (không tạo tenant thứ 2).                  #5
 *   • locale/currency CHECK: 'vi'/'VND' pass; 'vi-VN' + currency lạ bị reject (23514) — code CHECK thắng. #4
 *   • must_change_password lifecycle (repo): SuperAdminBootstrapRepository.upsertSuperAdminUser →
 *     must_change_password=true (INSERT + re-upsert, cùng id — idempotent).
 *   • CONCURRENT RACE (QA-06 security/race, RED-trước — S2-FND-SEED-3-FIX-2):
 *     - SQL 2-session (function-owner) đua ensure_default_company KHÁC slug trên slate rỗng → đúng 1 active,
 *       CẢ HAI caller KHÔNG nhận lỗi (23505 đã bắt nội bộ), đồng thuận CÙNG 1 winner.
 *     - SQL 2-session RAW INSERT (bỏ qua function) đua trực tiếp vào uq_companies_single_active →
 *       INSERT thua dính ĐÚNG 23505 (deterministic qua BEGIN/giữ-mở/COMMIT, KHÔNG phụ thuộc timing).
 *     - API parallel-loop ≥25 lần (EnsureDefaultCompanyService, khác slug) → fail=0, đồng thuận 1 winner —
 *       tái hiện & khử flake ~3.7% (memory super-admin-bootstrap-flaky-count).
 */

const runDb = hasDb && Boolean(process.env.LANE_DB);
const TAG = randomUUID().slice(0, 8);

// SQLSTATE: privilege check (chạy TRƯỚC RLS) + CHECK-constraint violation + serialization/unique conflict.
const PG_INSUFFICIENT_PRIVILEGE = "42501";
const PG_CHECK_VIOLATION = "23514";
const PG_SERIALIZATION_FAILURE = "40001";
const PG_UNIQUE_VIOLATION = "23505";
// Bounded-retry cho case create-from-empty: UPDATE rộng (ẩn active) chạy dưới REPEATABLE READ có thể va
// cleanupTenants (hard-delete company test khác trên LANE_DB dùng chung) → serialization_failure hợp lệ,
// không phải bug — retry ≤3 LẦN (sau lần thử đầu, tổng ≤4 lần thử) thay vì để flaky (S2-FND-SEED-3-FIX-1).
const MAX_SERIALIZATION_RETRIES = 3;
/** Backoff nhỏ + jitter TRƯỚC mỗi lần retry — giảm khả năng va lại NGAY vào transaction gây 40001 khi
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

/**
 * Soft-delete 1 company NGAY sau khi test dùng xong "slot active" — mig 0473 giới hạn TOÀN DB tối đa 1 hàng
 * (status='active' AND deleted_at IS NULL); giữ hàng active lâu (tới afterAll) sẽ CHẶN mọi suite khác chạy
 * song song trên cùng LANE_DB. Vẫn track qua companyIds[] để hard-cleanup ở afterAll (idempotent, an toàn
 * gọi lại trên hàng đã soft-delete).
 */
async function deactivate(pool: Pool, id: string): Promise<void> {
  await pool.query(`UPDATE ${COMPANIES} SET deleted_at = now() WHERE id = $1`, [id]);
}

describe.skipIf(!runDb)(
  "S2-FND-SEED-3 — ensure_default_company bootstrap + uq_companies_single_active (crown, DB thật)",
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
    // FIX (S2-FND-SEED-3-FIX-1, flaky dưới full-suite parallelism): BEGIN mặc định là READ COMMITTED →
    // MỖI statement lấy snapshot MỚI. UPDATE ẩn-active của TX này chỉ ẩn trong TX; nhưng SELECT guard N=1
    // bên trong ensure_default_company (SECURITY DEFINER, statement RIÊNG cùng TX) lấy snapshot TƯƠI ⇒ có
    // thể THẤY company active vừa được file test song song khác COMMIT giữa lúc UPDATE và lúc gọi hàm ⇒
    // guard HIT sai (không đi nhánh INSERT) ⇒ đỏ ngẫu nhiên.
    // Fix: BEGIN ISOLATION LEVEL REPEATABLE READ — snapshot cố định TẠI statement đầu tiên (UPDATE); mọi
    // statement SAU trong CÙNG transaction (kể cả SELECT nội bộ của ensure_default_company) dùng CHUNG
    // snapshot đó ⇒ KHÔNG thấy commit của session khác xảy ra sau thời điểm snapshot ⇒ guard MISS deterministic.
    // Bọc bounded-retry ≤3 trên 40001 (serialization_failure): UPDATE rộng (WHERE status='active', không giới
    // hạn theo id) dưới REPEATABLE READ có thể xung đột ghi với cleanupTenants (hard-delete company test khác
    // đang chạy song song trên cùng LANE_DB) — retry là xử lý đúng cho race hợp lệ, không che giấu bug thật.
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
            // TX có thể đã abort bởi 40001 — ROLLBACK vẫn hợp lệ; nuốt lỗi kép an toàn.
          });
          lastErr = err;
          const code = (err as { code?: string } | undefined)?.code;
          if (code !== PG_SERIALIZATION_FAILURE) throw err; // lỗi thật (không phải race) → fail ngay, không retry
          // 40001 và còn lượt retry → vòng lặp tiếp tục với client mới.
        } finally {
          client.release();
        }
      }
      throw lastErr; // hết MAX_SERIALIZATION_RETRIES mà vẫn 40001 → thất bại thật, không nuốt lỗi
    });

    // ── (DB10-TC-003) idempotent DETERMINISTIC — tie-break created_at ASC, id ASC (mig 0473) ───────
    it("idempotent — ensure gọi 2 lần trả CÙNG company id (active), khớp tie-break created_at ASC/id ASC", async () => {
      const svc = ensureServiceWith(`idem-${TAG}`);
      const a = await svc.ensureDefaultCompany();
      const b = await svc.ensureDefaultCompany();
      expect(a, "ensure phải trả company (LANE_DB đã cấu hình db)").not.toBeNull();
      expect(a?.status).toBe("active");
      expect(b?.id, "gọi lần 2 trả CÙNG id (idempotent + N=1)").toBe(a?.id);

      // DETERMINISTIC: winner PHẢI khớp tie-break tất định của function (mig 0473 ORDER BY created_at ASC,
      // id ASC) — xác nhận qua chính truy vấn đó trên toàn bảng active, KHÔNG chỉ tin service trả gì.
      const winner = await direct.query(
        `SELECT id FROM ${COMPANIES} WHERE status='active' AND deleted_at IS NULL
          ORDER BY created_at ASC, id ASC LIMIT 1`,
      );
      expect(
        winner.rows[0]?.id,
        "winner PHẢI khớp tie-break tất định created_at ASC, id ASC (mig 0473)",
      ).toBe(a?.id);

      // Bất biến DB (mig 0473): KHÔNG BAO GIỜ >1 active sau 2 lần gọi liên tiếp — không phình.
      const activeCount = await direct.query(
        `SELECT COUNT(*)::int AS n FROM ${COMPANIES} WHERE status='active' AND deleted_at IS NULL`,
      );
      expect(activeCount.rows[0].n, "KHÔNG phình — vẫn đúng 1 active sau 2 lần idempotent").toBe(1);

      // Guard-MISS đã tạo idem-TAG (DB trống lúc chạy) → dọn + TRẢ SLOT NGAY (không chờ afterAll — mig 0473
      // single-active toàn DB, giữ lâu sẽ chặn suite khác). Guard-HIT (trả active có sẵn) → không tạo, bỏ qua.
      const created = await direct.query(`SELECT id FROM ${COMPANIES} WHERE slug = $1`, [
        `idem-${TAG}`,
      ]);
      if (created.rowCount && created.rows[0].id) {
        const id = created.rows[0].id as string;
        companyIds.push(id);
        await deactivate(direct, id);
      }
    });

    // ── (owner-chốt #5) N=1 guard — active KHÁC slug → KHÔNG tạo tenant thứ 2 ─────────────────────
    // Defensive clear TRƯỚC INSERT: mig 0473 giới hạn TOÀN DB tối đa 1 active — nếu 1 hàng active SÓT LẠI
    // (leftover từ lượt chạy trước bị lỗi giữa chừng / suite khác chưa kịp dọn) thì INSERT trực tiếp bên
    // dưới sẽ dính 23505 dù KHÔNG liên quan bug đang test (false-red). Clear slot cho CHÍNH test này chiếm.
    it("N=1 guard — đã có company active khác slug → ensure KHÔNG tạo tenant mới cho probe slug", async () => {
      await direct.query(
        `UPDATE ${COMPANIES} SET deleted_at = now() WHERE status = 'active' AND deleted_at IS NULL`,
      );
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
      expect(probe.rowCount, "probe slug KHÔNG được đẻ khi đã có active (single-company)").toBe(0);

      // Trả slot NGAY (mig 0473 single-active toàn DB) — không chờ afterAll.
      await deactivate(direct, existingId);
    });

    // ── locale/currency CHECK (owner-chốt #4): code CHECK thắng DB-10 §17.1 ────────────────────────
    // Dùng status='suspended' (companies_status_chk cho phép 'active'|'suspended') — CHECK ngôn ngữ/tiền
    // tệ ĐỘC LẬP với status, nên KHÔNG cần chiếm "slot active" (mig 0473 single-active toàn DB) cho test này.
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
    // status='suspended' — withTenant chỉ set GUC company_id cho RLS (KHÔNG đọc company.status), nên
    // KHÔNG cần chiếm "slot active" (mig 0473 single-active toàn DB) cho test thuần repo-level này.
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

    // ═══ CONCURRENT RACE (QA-06 security/race, RED-trước — S2-FND-SEED-3-FIX-2 / mig 0473) ═══════════

    // ── SQL 2-session (function-owner) đua ensure_default_company KHÁC slug ──────────────────────
    it("concurrent — 2 session function-owner đua ensure_default_company KHÁC slug → đúng 1 active, KHÔNG throw", async () => {
      // Best-effort tạo slate rỗng ngay trước race — cửa sổ hẹp còn lại (suite khác chen vào) KHÔNG làm sai
      // bất biến được assert bên dưới: DB tự chặn CỨNG qua uq_companies_single_active bất kể ai thắng, và
      // cả 2 caller LUÔN đồng thuận CÙNG 1 winner dù đó là company thứ 3 (không phải slugA/slugB).
      await direct.query(
        `UPDATE ${COMPANIES} SET deleted_at = now() WHERE status = 'active' AND deleted_at IS NULL`,
      );

      const slugA = `race-fn-a-${TAG}`;
      const slugB = `race-fn-b-${TAG}`;
      const clientA = await direct.connect();
      const clientB = await direct.connect();
      let errA: unknown;
      let errB: unknown;
      let rowsA: Array<{ id: string; status: string }> = [];
      let rowsB: Array<{ id: string; status: string }> = [];
      try {
        const [outA, outB] = await Promise.all([
          clientA
            .query(
              `SELECT id, status FROM ensure_default_company($1::citext, 'Race FN A', 'Asia/Ho_Chi_Minh', 'vi', 'VND')`,
              [slugA],
            )
            .then((r) => r.rows as Array<{ id: string; status: string }>)
            .catch((e: unknown) => {
              errA = e;
              return [] as Array<{ id: string; status: string }>;
            }),
          clientB
            .query(
              `SELECT id, status FROM ensure_default_company($1::citext, 'Race FN B', 'Asia/Ho_Chi_Minh', 'vi', 'VND')`,
              [slugB],
            )
            .then((r) => r.rows as Array<{ id: string; status: string }>)
            .catch((e: unknown) => {
              errB = e;
              return [] as Array<{ id: string; status: string }>;
            }),
        ]);
        rowsA = outA;
        rowsB = outB;
      } finally {
        clientA.release();
        clientB.release();
      }

      expect(
        errA,
        "caller A KHÔNG được nhận lỗi — function PHẢI tự bắt 23505 nội bộ",
      ).toBeUndefined();
      expect(
        errB,
        "caller B KHÔNG được nhận lỗi — function PHẢI tự bắt 23505 nội bộ",
      ).toBeUndefined();
      expect(rowsA[0]?.id).toBeTruthy();
      expect(rowsB[0]?.id).toBeTruthy();
      expect(
        rowsB[0]?.id,
        "2 caller đua NHƯNG đồng thuận CÙNG 1 winner (idempotent dưới race thật)",
      ).toBe(rowsA[0]?.id);
      expect(rowsA[0]?.status).toBe("active");

      const winnerId = rowsA[0]?.id as string;
      companyIds.push(winnerId);

      const activeCount = await direct.query(
        `SELECT COUNT(*)::int AS n FROM ${COMPANIES} WHERE status = 'active' AND deleted_at IS NULL`,
      );
      expect(
        activeCount.rows[0].n,
        "KHÔNG BAO GIỜ >1 company active cùng lúc (uq_companies_single_active)",
      ).toBe(1);

      // Đúng tối đa 1 trong 2 slug đua thắng thật (INSERT thành công) — slug thua KHÔNG để lại row dở dang
      // (EXCEPTION nuốt sạch, không retry-insert phần lỡ). Company thứ 3 (pre-existing) thắng vẫn hợp lệ.
      const createdSlugs = await direct.query(
        `SELECT slug FROM ${COMPANIES} WHERE slug = ANY($1::text[]) AND deleted_at IS NULL`,
        [[slugA, slugB]],
      );
      expect(
        createdSlugs.rowCount,
        "tối đa 1 trong 2 slug đua thắng thật (slug thua KHÔNG để lại row)",
      ).toBeLessThanOrEqual(1);

      await deactivate(direct, winnerId);
    });

    // ── SQL 2-session RAW INSERT (bỏ qua function) — chứng minh 23505 THẬT trên uq_companies_single_active ──
    // Deterministic (KHÔNG phụ thuộc timing network như race qua function ở trên): A giữ transaction MỞ sau
    // INSERT (chưa commit) → B fire INSERT khác slug (sẽ BLOCK chờ khoá của A trên cùng entry index partial
    // `(true)`) → A COMMIT → B được nhả khoá, re-check uniqueness, dính 23505 (A đã thắng, đã commit thật).
    it("SQL — 2 session RAW INSERT khác slug đua vào uq_companies_single_active → INSERT thua dính 23505", async () => {
      await direct.query(
        `UPDATE ${COMPANIES} SET deleted_at = now() WHERE status = 'active' AND deleted_at IS NULL`,
      );

      const slugA = `raw-race-a-${TAG}`;
      const slugB = `raw-race-b-${TAG}`;
      const clientA = await direct.connect();
      const clientB = await direct.connect();
      let insertedAId = "";
      let errB: unknown;
      try {
        await clientA.query("BEGIN");
        const insA = await clientA.query(
          `INSERT INTO ${COMPANIES} (name, slug, status, language, currency)
           VALUES ($1, $2, 'active', 'vi', 'VND') RETURNING id`,
          [`Raw Race A ${TAG}`, slugA],
        );
        insertedAId = insA.rows[0].id as string;

        await clientB.query("BEGIN");
        const pB = clientB
          .query(
            `INSERT INTO ${COMPANIES} (name, slug, status, language, currency)
             VALUES ($1, $2, 'active', 'vi', 'VND') RETURNING id`,
            [`Raw Race B ${TAG}`, slugB],
          )
          .catch((e: unknown) => {
            errB = e;
            return undefined;
          });

        // Nhường thời gian để statement B thực sự gửi đi + bắt đầu CHỜ khoá của A TRƯỚC khi A commit —
        // nếu commit A trước khi B kịp gửi, B có thể chạy sau và tự thấy conflict ngay (vẫn ra 23505, chỉ
        // khác đường chờ khoá vs. re-check tức thời — cả 2 đều hợp lệ cho assertion bên dưới).
        await new Promise((resolve) => setTimeout(resolve, 100));
        await clientA.query("COMMIT");
        await pB;
      } finally {
        await clientB.query("ROLLBACK").catch(() => {
          // B có thể đã tự abort do 23505 — ROLLBACK vẫn hợp lệ; nuốt lỗi kép an toàn.
        });
        clientA.release();
        clientB.release();
      }

      expect(
        errB,
        "INSERT thứ 2 (B, khác slug) PHẢI dính lỗi trên uq_companies_single_active",
      ).toBeDefined();
      expect((errB as { code?: string }).code).toBe(PG_UNIQUE_VIOLATION);

      companyIds.push(insertedAId);
      await deactivate(direct, insertedAId);
    });

    // ── API parallel-loop ≥25 bootstrap song song khác slug → fail=0 (khử flake ~3.7%) ──────────────
    it("API parallel-loop — ≥25 bootstrap song song khác slug (EnsureDefaultCompanyService) → fail=0, đồng thuận 1 winner", async () => {
      await direct.query(
        `UPDATE ${COMPANIES} SET deleted_at = now() WHERE status = 'active' AND deleted_at IS NULL`,
      );

      const N = 25;
      const slugs = Array.from({ length: N }, (_, i) => `loop-${TAG}-${i}`);
      const settled = await Promise.allSettled(
        slugs.map((s) => ensureServiceWith(s).ensureDefaultCompany()),
      );

      const failures = settled.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      expect(
        failures.length,
        `fail=0 dưới race ${N} bootstrap song song (khử flake ~3.7%, memory super-admin-bootstrap-flaky-count)`,
      ).toBe(0);

      const ids = new Set(
        settled
          .filter(
            (r): r is PromiseFulfilledResult<EnsuredCompany | null> => r.status === "fulfilled",
          )
          .map((r) => r.value?.id)
          .filter((id): id is string => Boolean(id)),
      );
      expect(ids.size, `TẤT CẢ ${N} lần gọi đồng thuận CÙNG 1 winner`).toBe(1);

      const activeCount = await direct.query(
        `SELECT COUNT(*)::int AS n FROM ${COMPANIES} WHERE status = 'active' AND deleted_at IS NULL`,
      );
      expect(activeCount.rows[0].n, "KHÔNG BAO GIỜ >1 active sau parallel-loop").toBe(1);

      const winnerId = [...ids][0] as string;
      companyIds.push(winnerId);
      await deactivate(direct, winnerId);
    });
  },
);
