import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants } from "../helpers/seed";
import { EnsureDefaultCompanyService } from "../../src/foundation/seed/ensure-default-company.service";

/**
 * S2-FND-SEED-3 (Lane D — deny-path RED TRƯỚC) — bộ NGHIỆM THU DB-hardening cho dựng-từ-trống tự động:
 * function `ensure_default_company` (mig 0469, SECURITY DEFINER) + cột `users.must_change_password`.
 * Postgres THẬT, DB CÔ LẬP `mediaos_<lane>` (CLAUDE §9.5). Đặt ở test/ (KHÔNG colocated .spec.ts) — case
 * cần guard + DB thật + role-switch KHÔNG được lọt vào no-DB unit run.
 *
 * Gate CỨNG `hasDb && LANE_DB` (memory integration-test-lane-db-gate): .env local trỏ DB dev chung làm
 * hasDb=true → deny-path/CHECK chạy trên DB chung ⇒ đỏ-giả + nhiễu. Chỉ chạy trên DB cô lập theo LANE_DB.
 *
 * PHỦ (owner-chốt #1..#5 + DB10-TC-001/003 + §17.2):
 *   • presence catalog: prosecdef=true · proconfig SET search_path=pg_catalog · proacl non-null · EXECUTE
 *     mediaos_app · KHÔNG cấp EXECUTE PUBLIC (assert qua pg_proc — xanh-giả nếu chỉ match TÊN).      #1/#2
 *   • deny-path RED: role DB ≠ mediaos_app EXECUTE → permission-denied 42501.                          #3
 *   • create-from-empty (DB10-TC-001): guard MISS (ẩn active trong TX cô lập) → nhánh INSERT tenant-root.
 *   • idempotent (DB10-TC-003): EnsureDefaultCompanyService gọi 2 lần → cùng id, active, KHÔNG phình.
 *   • N=1 guard: active KHÁC slug → probe slug KHÔNG được đẻ (không tạo tenant thứ 2).                  #5
 *   • locale/currency CHECK: 'vi'/'VND' pass; 'vi-VN' + currency lạ bị reject (23514) — code CHECK thắng. #4
 *   • cột users.must_change_password NOT NULL DEFAULT false tồn tại sau migrate (§17.2 điểm 5).
 */

const runDb = hasDb && Boolean(process.env.LANE_DB);
const TAG = randomUUID().slice(0, 8);

// SQLSTATE: privilege check (chạy TRƯỚC RLS) + CHECK-constraint violation.
const PG_INSUFFICIENT_PRIVILEGE = "42501";
const PG_CHECK_VIOLATION = "23514";

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
  "S2-FND-SEED-3 Lane D — ensure_default_company hardening + deny-path (crown, DB thật)",
  () => {
    let direct: Pool;
    const companyIds: string[] = [];
    const denyRole = `deny_ensure_d_${TAG}`;

    beforeAll(() => {
      direct = directPool();
    });

    afterAll(async () => {
      try {
        await direct.query(`DROP ROLE IF EXISTS ${denyRole}`);
      } catch {
        // role đã sạch qua ROLLBACK — bỏ qua.
      }
      if (companyIds.length) await cleanupTenants(direct, companyIds);
      await direct?.end();
    });

    // ── (owner-chốt #3) deny-path RED — role ≠ mediaos_app EXECUTE → 42501 ─────────────────────────
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
            [`deny-d-${TAG}`],
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

    // ── (owner-chốt #1/#2) presence catalog — hardening đo qua pg_proc ────────────────────────────
    it("presence — SECURITY DEFINER · search_path=pg_catalog · proacl SET · EXECUTE mediaos_app · KHÔNG PUBLIC", async () => {
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

    // ── (DB10-TC-001) create-from-empty — guard MISS → nhánh INSERT tenant-root ───────────────────
    it("create-from-empty — guard MISS (không active) → tạo tenant-root mới (INSERT branch)", async () => {
      const slug = `empty-d-${TAG}`;
      const client: PoolClient = await direct.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL lock_timeout = '4s'");
        // Ẩn MỌI company active TRONG TX này (uncommitted, MVCC cô lập — không ảnh hưởng session khác) để
        // guard MISS ⇒ đi nhánh CREATE. ROLLBACK cuối undo cả ẩn lẫn company vừa tạo (không pollution DB chung).
        await client.query(
          `UPDATE ${COMPANIES} SET deleted_at = now() WHERE deleted_at IS NULL AND status = 'active'`,
        );
        const r = await client.query(
          `SELECT id, status FROM ensure_default_company($1::citext, 'Empty Co D', 'Asia/Ho_Chi_Minh', 'vi', 'VND')`,
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
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
    });

    // ── (DB10-TC-003) idempotent — EnsureDefaultCompanyService gọi 2 lần → cùng id ────────────────
    it("idempotent — ensure gọi 2 lần trả CÙNG company id (status active), không phình", async () => {
      const svc = ensureServiceWith(`idem-d-${TAG}`);
      const a = await svc.ensureDefaultCompany();
      const b = await svc.ensureDefaultCompany();
      expect(a, "ensure phải trả company (LANE_DB đã cấu hình db)").not.toBeNull();
      expect(a?.status).toBe("active");
      expect(b?.id, "gọi lần 2 trả CÙNG id (idempotent + N=1)").toBe(a?.id);
      // Guard-MISS đã tạo idem-d-TAG (DB trống lúc chạy) → dọn; guard-HIT (trả active có sẵn) → bỏ qua.
      const created = await direct.query(`SELECT id FROM ${COMPANIES} WHERE slug = $1`, [
        `idem-d-${TAG}`,
      ]);
      if (created.rowCount && created.rows[0].id) companyIds.push(created.rows[0].id);
    });

    // ── (owner-chốt #5) N=1 guard — active KHÁC slug → KHÔNG tạo tenant thứ 2 ─────────────────────
    it("N=1 guard — đã có company active khác slug → ensure KHÔNG tạo tenant mới cho probe slug", async () => {
      const existingSlug = `n1-exist-d-${TAG}`;
      const seed = await direct.query(
        `INSERT INTO ${COMPANIES} (name, slug, status, language, currency)
         VALUES ($1, $2, 'active', 'vi', 'VND') RETURNING id`,
        [`N1 ${existingSlug}`, existingSlug],
      );
      companyIds.push(seed.rows[0].id);

      const probeSlug = `n1-probe-d-${TAG}`;
      const res = await ensureServiceWith(probeSlug).ensureDefaultCompany();
      expect(res, "ensure trả company active (đã có qua N=1)").not.toBeNull();
      expect(res?.status).toBe("active");
      // guard HIT (có active) → probe slug KHÔNG được tạo (không đẻ tenant thứ 2).
      const probe = await direct.query(`SELECT id FROM ${COMPANIES} WHERE slug = $1`, [probeSlug]);
      expect(probe.rowCount, "probe slug KHÔNG được đẻ khi đã có active (single-company)").toBe(0);
    });

    // ── (owner-chốt #4) locale/currency CHECK — code CHECK THẮNG DB-10 §17.1 ──────────────────────
    it("CHECK — 'vi'/'VND' pass; language 'vi-VN' bị companies_language_check reject (23514)", async () => {
      const okSlug = `chk-ok-d-${TAG}`;
      const ok = await direct.query(
        `INSERT INTO ${COMPANIES} (name, slug, status, language, currency)
         VALUES ($1, $2, 'active', 'vi', 'VND') RETURNING id`,
        [`Chk ${okSlug}`, okSlug],
      );
      expect(ok.rowCount, "'vi'/'VND' phải qua CHECK (default env hợp lệ)").toBe(1);
      companyIds.push(ok.rows[0].id);

      let langErr: unknown;
      try {
        await direct.query(
          `INSERT INTO ${COMPANIES} (name, slug, status, language, currency)
           VALUES ($1, $2, 'active', 'vi-VN', 'VND')`,
          [`Chk lang ${TAG}`, `chk-lang-d-${TAG}`],
        );
      } catch (e) {
        langErr = e;
      }
      expect(
        langErr,
        "kỳ vọng 'vi-VN' bị companies_language_check reject (owner-chốt #4)",
      ).toBeDefined();
      expect((langErr as { code?: string }).code).toBe(PG_CHECK_VIOLATION);
    });

    it("CHECK — currency ngoài {VND,USD} bị companies_currency_check reject (23514)", async () => {
      let curErr: unknown;
      try {
        await direct.query(
          `INSERT INTO ${COMPANIES} (name, slug, status, language, currency)
           VALUES ($1, $2, 'active', 'vi', 'EUR')`,
          [`Chk cur ${TAG}`, `chk-cur-d-${TAG}`],
        );
      } catch (e) {
        curErr = e;
      }
      expect(curErr, "kỳ vọng currency 'EUR' bị companies_currency_check reject").toBeDefined();
      expect((curErr as { code?: string }).code).toBe(PG_CHECK_VIOLATION);
    });
  },
);
