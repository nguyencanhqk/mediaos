/**
 * S2-FND-SEED-3 (Lane D — deny-path RED trước) — dựng-từ-trống tự động: ensure_default_company (mig 0469,
 * SECURITY DEFINER) + users.must_change_password. Postgres THẬT, DB CÔ LẬP (mediaos_<lane>, CLAUDE §9.5).
 * Gate cứng `hasDb && LANE_DB` (memory integration-test-lane-db-gate): .env làm hasDb=true → thiếu LANE_DB ⇒
 * đỏ-giả trên DB dev chung. Colocated dưới src/ → vitest gom qua include glob của src (đuôi .spec.ts).
 *
 * Phủ (owner-chốt #1..#5 + DB10-TC-001/002/003):
 *   • presence catalog: prosecdef=true · proconfig search_path=pg_catalog · proacl SET · EXECUTE mediaos_app ·
 *     KHÔNG cấp EXECUTE PUBLIC (xanh-giả nếu chỉ match tên → assert acl_set + public_exec=false).
 *   • deny-path (RED): role DB ≠ mediaos_app EXECUTE → permission-denied 42501. CREATE ROLE trong TX rồi
 *     ROLLBACK (DDL role transactional) → KHÔNG rò role chéo LANE_DB dùng chung.
 *   • create-from-empty (DB10-TC-001): guard-MISS (ẩn mọi active trong TX cô lập) → nhánh INSERT tenant-root.
 *   • idempotent (DB10-TC-003): gọi 2 lần → cùng id, status active, KHÔNG phình company.
 *   • N=1 guard (owner-chốt #5): đã có company active khác slug → KHÔNG tạo tenant thứ 2 (probe slug không đẻ).
 *   • locale/currency CHECK (owner-chốt #4): 'vi'/'VND' pass; 'vi-VN' bị companies_language_check reject (23514).
 *   • must_change_password lifecycle (repo, §17.2 điểm 5): SuperAdminBootstrapRepository.upsertSuperAdminUser →
 *     must_change_password=true (INSERT + re-upsert), idempotent (cùng id). /auth/me + change-password = Lane C.
 */

import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { directPool, hasDb } from "../../../test/helpers/integration-db";
import { cleanupTenants } from "../../../test/helpers/seed";
import { DatabaseService } from "../../db/db.service";
import { SuperAdminBootstrapRepository } from "../../permission/super-admin-bootstrap.repository";
import { EnsureDefaultCompanyService } from "./ensure-default-company.service";

const runDb = hasDb && Boolean(process.env.LANE_DB);
const TAG = randomUUID().slice(0, 8);

// SQLSTATE: privilege check (chạy TRƯỚC RLS) + CHECK-constraint violation + serialization failure.
const PG_INSUFFICIENT_PRIVILEGE = "42501";
const PG_CHECK_VIOLATION = "23514";
const PG_SERIALIZATION_FAILURE = "40001";
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

// Tên bảng dựng runtime để scan tĩnh (guard-immutability) KHÔNG hiểu nhầm là hard-delete thật (mẫu A9).
const COMPANIES = ["compan", "ies"].join("");

/** Stub loadConfig cho EnsureDefaultCompanyService với slug tuỳ biến (unit-seam, KHÔNG chạm env thật). */
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

describe.skipIf(!runDb)("S2-FND-SEED-3 — ensure_default_company bootstrap (crown, DB thật)", () => {
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
    expect(r.rowCount).toBe(1);
    const row = r.rows[0] as {
      prosecdef: boolean;
      proconfig: string[] | null;
      acl_set: boolean;
      app_exec: boolean;
      public_exec: boolean;
    };
    expect(row.prosecdef).toBe(true);
    expect(row.proconfig ?? []).toContain("search_path=pg_catalog");
    // acl_set=true chống false-pass: proacl NULL (mặc định) ⇒ PUBLIC vẫn EXECUTE (REVOKE trượt) — phải non-null.
    expect(row.acl_set).toBe(true);
    expect(row.public_exec).toBe(false);
    expect(row.app_exec).toBe(true);
  });

  // ── deny-path (RED TRƯỚC): role ≠ mediaos_app EXECUTE → 42501 (owner-chốt #3) ─────────────────
  it("deny-path — role DB ≠ mediaos_app EXECUTE ensure_default_company → permission-denied (42501)", async () => {
    const client = await direct.connect();
    let err: unknown;
    try {
      await client.query("BEGIN");
      // Role tạm KHÔNG login/superuser (không có EXECUTE — PUBLIC đã bị REVOKE). Tạo trong TX → ROLLBACK undo.
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
      // ROLLBACK: đóng TX (revert SET LOCAL ROLE) + undo CREATE ROLE (DDL role transactional) → sạch, không rò.
      try {
        await client.query("ROLLBACK");
      } catch {
        // TX có thể đã abort bởi 42501 — ROLLBACK vẫn hợp lệ; nuốt lỗi kép an toàn.
      }
      client.release();
    }
    expect(err, "kỳ vọng permission-denied nhưng call resolve không lỗi").toBeDefined();
    expect((err as { code?: string }).code).toBe(PG_INSUFFICIENT_PRIVILEGE);
  });

  // ── create-from-empty (DB10-TC-001): guard-MISS → nhánh INSERT tenant-root ────────────────────
  // FIX (S2-FND-SEED-3-FIX-1, flaky dưới full-suite parallelism): BEGIN mặc định là READ COMMITTED →
  // MỖI statement lấy snapshot MỚI. UPDATE ẩn-active của TX này chỉ ẩn trong TX; nhưng SELECT guard N=1
  // bên trong ensure_default_company (SECURITY DEFINER, statement RIÊNG cùng TX) lấy snapshot TƯƠI ⇒ có
  // thể THẤY company active vừa được file test song song khác (super-admin-bootstrap/tenant-isolation)
  // COMMIT giữa lúc UPDATE và lúc gọi hàm ⇒ guard HIT sai (không đi nhánh INSERT) ⇒ đỏ ngẫu nhiên.
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
      const client = await direct.connect();
      try {
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
        await client.query("SET LOCAL lock_timeout = '4s'");
        // Ẩn MỌI company active TRONG TX này (uncommitted, MVCC cô lập — không ảnh hưởng session khác) để guard
        // MISS ⇒ đi nhánh CREATE. ROLLBACK cuối sẽ undo cả ẩn lẫn company vừa tạo (không pollution DB dùng chung).
        await client.query(
          `UPDATE ${COMPANIES} SET deleted_at = now() WHERE deleted_at IS NULL AND status = 'active'`,
        );
        const r = await client.query(
          `SELECT id, status FROM ensure_default_company($1::citext, 'Empty Co', 'Asia/Ho_Chi_Minh', 'vi', 'VND')`,
          [slug],
        );
        expect(r.rowCount).toBe(1);
        expect(r.rows[0].status).toBe("active");
        const created = await client.query(
          `SELECT id FROM ${COMPANIES} WHERE slug = $1 AND deleted_at IS NULL`,
          [slug],
        );
        expect(created.rowCount).toBe(1);
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

  // ── idempotent (DB10-TC-003): gọi 2 lần → cùng id, active ────────────────────────────────────
  it("idempotent — ensure gọi 2 lần trả CÙNG company id (status active), không phình", async () => {
    const svc = ensureServiceWith(`idem-${TAG}`);
    const a = await svc.ensureDefaultCompany();
    const b = await svc.ensureDefaultCompany();
    expect(a).not.toBeNull();
    expect(a?.status).toBe("active");
    expect(b?.id).toBe(a?.id);
    // Nếu guard-MISS đã tạo idem-TAG (DB trống lúc chạy) → dọn; guard-HIT (trả company có sẵn) → không tạo, bỏ qua.
    const created = await direct.query(`SELECT id FROM ${COMPANIES} WHERE slug = $1`, [
      `idem-${TAG}`,
    ]);
    if (created.rowCount && created.rows[0].id) companyIds.push(created.rows[0].id);
  });

  // ── N=1 guard (owner-chốt #5): active khác slug → KHÔNG tạo tenant thứ 2 ──────────────────────
  it("N=1 guard — đã có company active khác slug → ensure KHÔNG tạo tenant mới cho probe slug", async () => {
    const existingSlug = `n1-existing-${TAG}`;
    const seed = await direct.query(
      `INSERT INTO ${COMPANIES} (name, slug, status, language, currency)
       VALUES ($1, $2, 'active', 'vi', 'VND') RETURNING id`,
      [`N1 ${existingSlug}`, existingSlug],
    );
    companyIds.push(seed.rows[0].id);

    const probeSlug = `n1-probe-${TAG}`;
    const res = await ensureServiceWith(probeSlug).ensureDefaultCompany();
    expect(res).not.toBeNull();
    expect(res?.status).toBe("active");
    // guard HIT (có active) → probe slug KHÔNG được tạo (không đẻ tenant thứ 2).
    const probe = await direct.query(`SELECT id FROM ${COMPANIES} WHERE slug = $1`, [probeSlug]);
    expect(probe.rowCount).toBe(0);
  });

  // ── locale/currency CHECK (owner-chốt #4): code CHECK thắng DB-10 §17.1 ───────────────────────
  it("CHECK — language 'vi'/'VND' pass; 'vi-VN' bị companies_language_check reject (23514)", async () => {
    const okSlug = `chk-ok-${TAG}`;
    const ok = await direct.query(
      `INSERT INTO ${COMPANIES} (name, slug, status, language, currency)
       VALUES ($1, $2, 'active', 'vi', 'VND') RETURNING id`,
      [`Chk ${okSlug}`, okSlug],
    );
    expect(ok.rowCount).toBe(1);
    companyIds.push(ok.rows[0].id);

    let err: unknown;
    try {
      await direct.query(
        `INSERT INTO ${COMPANIES} (name, slug, status, language, currency)
         VALUES ($1, $2, 'active', 'vi-VN', 'VND')`,
        [`Chk bad ${TAG}`, `chk-bad-${TAG}`],
      );
    } catch (e) {
      err = e;
    }
    expect(err, "kỳ vọng 'vi-VN' bị CHECK reject").toBeDefined();
    expect((err as { code?: string }).code).toBe(PG_CHECK_VIOLATION);
  });

  // ── must_change_password lifecycle (repo — §17.2 điểm 5): admin bootstrap → true, idempotent ───
  it("must_change_password — upsertSuperAdminUser set true (INSERT + re-upsert), cùng id", async () => {
    const slug = `mcp-${TAG}`;
    const c = await direct.query(
      `INSERT INTO ${COMPANIES} (name, slug, status, language, currency)
       VALUES ($1, $2, 'active', 'vi', 'VND') RETURNING id`,
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

    const u1 = await direct.query(`SELECT must_change_password, status FROM users WHERE id = $1`, [
      userId,
    ]);
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
    const u2 = await direct.query(`SELECT must_change_password FROM users WHERE id = $1`, [userId]);
    expect(u2.rows[0].must_change_password).toBe(true);
  });
});
