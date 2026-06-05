import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

/**
 * Seed tiện ích cho integration test. Dùng kết nối DIRECT (superuser, bypass RLS) để dựng dữ liệu
 * 2 tenant — KHÔNG phản ánh đường app; chỉ để tạo lưới test cho deny-path RLS.
 */

export interface SeededTenant {
  companyId: string;
  slug: string;
}

/** Tạo 1 company với slug ngẫu nhiên (tránh đụng giữa các lần chạy CI). */
export async function seedCompany(direct: Pool, label = "t"): Promise<SeededTenant> {
  const slug = `${label}-${randomUUID().slice(0, 8)}`;
  const res = await direct.query(
    "INSERT INTO companies (name, slug) VALUES ($1, $2) RETURNING id",
    [`Company ${slug}`, slug],
  );
  return { companyId: res.rows[0].id as string, slug };
}

/** Tạo 1 user thuộc company (set company_id tường minh qua superuser). Trả về user id. */
export async function seedUser(
  direct: Pool,
  companyId: string,
  email: string,
  passwordHash = "seed-not-a-real-hash",
): Promise<string> {
  const res = await direct.query(
    "INSERT INTO users (company_id, email, password_hash) VALUES ($1, $2, $3) RETURNING id",
    [companyId, email, passwordHash],
  );
  return res.rows[0].id as string;
}

/** Dọn dữ liệu test theo companyId — xoá theo THỨ TỰ phụ thuộc FK (con trước, companies sau cùng). */
export async function cleanupTenants(direct: Pool, companyIds: string[]): Promise<void> {
  if (companyIds.length === 0) return;
  const ids = [companyIds];
  // processed_events tham chiếu outbox_events; dead_letter tham chiếu cả hai → xoá trước outbox.
  await direct.query(
    `DELETE FROM processed_events WHERE event_id IN
       (SELECT id FROM outbox_events WHERE company_id = ANY($1::uuid[]))`,
    ids,
  );
  await direct.query("DELETE FROM dead_letter_events WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM outbox_events WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM audit_logs WHERE company_id = ANY($1::uuid[])", ids);
  // refresh_tokens tự tham chiếu (replaced_by) → gỡ liên kết trước khi xoá để tránh vướng FK.
  await direct.query(
    "UPDATE refresh_tokens SET replaced_by = NULL WHERE company_id = ANY($1::uuid[])",
    ids,
  );
  await direct.query("DELETE FROM refresh_tokens WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM password_reset_tokens WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM users WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM companies WHERE id = ANY($1::uuid[])", ids);
}
