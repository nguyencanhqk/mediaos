import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { seedUser, type SeededTenant } from "../helpers/seed";

/**
 * SỔ ĐĂNG KÝ bảng có RLS — nguồn cho harness tenant-isolation (G2-5).
 *
 * LUẬT (plan G2-5 / CLAUDE §2 bất biến #1): MỖI bảng nghiệp vụ mới có company_id PHẢI thêm 1 case
 * ở đây. KHÔNG skip. Harness sẽ tự kiểm: không ngữ cảnh ⇒ 0 row; withTenant(A) không thấy hàng của B.
 */
export interface RlsTableCase {
  /** Tên hiển thị + tên bảng thật. */
  name: string;
  table: string;
  /** Seed 1 hàng thuộc tenant `t`, trả về id của hàng (để khẳng định không lọt sang tenant khác). */
  seedRow(direct: Pool, t: SeededTenant): Promise<string>;
}

export const RLS_TABLES: RlsTableCase[] = [
  {
    name: "companies",
    table: "companies",
    // Bản thân company là "hàng" của chính tenant đó (đã tạo bởi seedCompany).
    seedRow: async (_direct, t) => t.companyId,
  },
  {
    name: "users",
    table: "users",
    seedRow: (direct, t) =>
      seedUser(direct, t.companyId, `iso-${randomUUID().slice(0, 8)}@x.test`),
  },
  {
    name: "audit_logs",
    table: "audit_logs",
    seedRow: async (direct, t) => {
      const r = await direct.query(
        "INSERT INTO audit_logs (company_id, action, object_type) VALUES ($1, 'seed', 'company') RETURNING id",
        [t.companyId],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "outbox_events",
    table: "outbox_events",
    seedRow: async (direct, t) => {
      const r = await direct.query(
        "INSERT INTO outbox_events (company_id, event_type, payload) VALUES ($1, 'seed.event', '{}'::jsonb) RETURNING id",
        [t.companyId],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "dead_letter_events",
    table: "dead_letter_events",
    seedRow: async (direct, t) => {
      const ev = await direct.query(
        "INSERT INTO outbox_events (company_id, event_type, payload) VALUES ($1, 'seed.dl', '{}'::jsonb) RETURNING id",
        [t.companyId],
      );
      const r = await direct.query(
        `INSERT INTO dead_letter_events (company_id, event_id, consumer_name, event_type, payload, error)
         VALUES ($1, $2, 'seed-consumer', 'seed.dl', '{}'::jsonb, 'seed') RETURNING id`,
        [t.companyId, ev.rows[0].id],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "refresh_tokens",
    table: "refresh_tokens",
    seedRow: async (direct, t) => {
      const u = await seedUser(direct, t.companyId, `rt-${randomUUID().slice(0, 8)}@x.test`);
      const r = await direct.query(
        `INSERT INTO refresh_tokens (company_id, user_id, token_hash, expires_at)
         VALUES ($1, $2, $3, now() + interval '30 days') RETURNING id`,
        [t.companyId, u, randomUUID()],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "password_reset_tokens",
    table: "password_reset_tokens",
    seedRow: async (direct, t) => {
      const u = await seedUser(direct, t.companyId, `prt-${randomUUID().slice(0, 8)}@x.test`);
      const r = await direct.query(
        `INSERT INTO password_reset_tokens (company_id, user_id, token_hash, expires_at)
         VALUES ($1, $2, $3, now() + interval '1 hour') RETURNING id`,
        [t.companyId, u, randomUUID()],
      );
      return r.rows[0].id as string;
    },
  },
  // processed_events: bảng hạ tầng worker (không RLS, app không có grant) → KHÔNG đưa vào harness app-path.
];
