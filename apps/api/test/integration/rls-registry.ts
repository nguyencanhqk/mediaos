import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { seedUser, type SeededTenant } from "../helpers/seed";

/**
 * SỔ ĐĂNG KÝ bảng có RLS — nguồn cho harness tenant-isolation (G2-5).
 *
 * LUẬT (plan G2-5 / CLAUDE §2 bất biến #1): MỖI bảng nghiệp vụ mới có company_id PHẢI thêm 1 case
 * ở đây. KHÔNG skip. Harness sẽ tự kiểm: không ngữ cảnh ⇒ 0 row; withTenant(A) không thấy hàng của B.
 *
 * GHI CHÚ roles: system roles (company_id IS NULL) ĐỌC được bởi mọi tenant (USING policy cho phép).
 * Harness chỉ seed TENANT role (company_id NOT NULL) để kiểm tra cô lập chéo tenant.
 * Test riêng cần xác minh system roles hiển thị cho mọi tenant — ngoài phạm vi harness này.
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
  // permissions: global catalog (không RLS, không company_id) → KHÔNG đưa vào harness tenant-isolation.
  {
    name: "roles (tenant-scoped only)",
    table: "roles",
    // NOTE: chỉ seed TENANT role (company_id NOT NULL). System roles (company_id IS NULL) ĐỌC được bởi mọi
    // tenant theo thiết kế — không seed chúng ở đây vì harness kiểm cô lập chéo tenant, không phải visibility.
    seedRow: async (direct, t) => {
      const r = await direct.query(
        `INSERT INTO roles (company_id, name, is_system)
         VALUES ($1, $2, false) RETURNING id`,
        [t.companyId, `seed-role-${randomUUID().slice(0, 8)}`],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "role_permissions",
    table: "role_permissions",
    // Seed via a tenant role + a real permission from the catalog.
    seedRow: async (direct, t) => {
      // Insert a tenant-scoped role first.
      const roleRes = await direct.query(
        `INSERT INTO roles (company_id, name, is_system)
         VALUES ($1, $2, false) RETURNING id`,
        [t.companyId, `rp-seed-role-${randomUUID().slice(0, 8)}`],
      );
      const roleId = roleRes.rows[0].id as string;
      // Pick any permission from the catalog (read:company is always present).
      const permRes = await direct.query(
        `SELECT id FROM permissions WHERE action = 'read' AND resource_type = 'company' LIMIT 1`,
      );
      const permId = permRes.rows[0].id as string;
      await direct.query(
        `INSERT INTO role_permissions (role_id, permission_id, effect) VALUES ($1, $2, 'ALLOW')`,
        [roleId, permId],
      );
      // Return roleId as the "row id" — harness verifies the role is not visible cross-tenant,
      // which transitively means the role_permission is also not visible cross-tenant.
      return roleId;
    },
  },
  {
    name: "user_roles",
    table: "user_roles",
    seedRow: async (direct, t) => {
      const u = await seedUser(direct, t.companyId, `ur-${randomUUID().slice(0, 8)}@x.test`);
      // Use any system role (company_id IS NULL) so we don't need to create a tenant role.
      const roleRes = await direct.query(
        `SELECT id FROM roles WHERE name = 'employee' AND company_id IS NULL LIMIT 1`,
      );
      const roleId = roleRes.rows[0].id as string;
      const r = await direct.query(
        `INSERT INTO user_roles (user_id, role_id, company_id)
         VALUES ($1, $2, $3) RETURNING id`,
        [u, roleId, t.companyId],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "object_permissions",
    table: "object_permissions",
    seedRow: async (direct, t) => {
      const u = await seedUser(direct, t.companyId, `op-${randomUUID().slice(0, 8)}@x.test`);
      const permRes = await direct.query(
        `SELECT id FROM permissions WHERE action = 'read' AND resource_type = 'project' LIMIT 1`,
      );
      const permId = permRes.rows[0].id as string;
      const r = await direct.query(
        `INSERT INTO object_permissions
           (company_id, subject_type, subject_id, permission_id, object_type, object_id, effect)
         VALUES ($1, 'user', $2, $3, 'project', $4, 'ALLOW') RETURNING id`,
        [t.companyId, u, permId, randomUUID()],
      );
      return r.rows[0].id as string;
    },
  },
];
