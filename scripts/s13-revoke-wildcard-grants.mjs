// s13-revoke-wildcard-grants.mjs — GỠ grant wildcard ('*','*') khỏi role tuỳ biến của tenant.
//
// VÌ SAO TỒN TẠI: migration 0565 (S13-PAYROLL-DB-1) có census §6.7 fail-closed — RAISE nếu bất kỳ role nào
// (trừ `super-admin`) giữ ('*','*') / ('act','*') / ('*','res'). Trên DB PROD `mediaos`, hai role TUỲ BIẾN
// của tenant giữ ('*','*'): `SA` (10 người) và `QUẢN LÝ CẤP CAO` (4 người) ⇒ `pnpm db:migrate` đỏ ở 0565,
// cả lô 0564…0568 rollback (drizzle bọc MỘT transaction). Wildcard là ĐƯỜNG NGẦM vào 13 cặp lương nhạy cảm.
//
// NGUYÊN TẮC VÁ: KHÔNG đổi quyền hiệu dụng của ai. Wildcard đang phủ mọi cặp trong catalog ⇒ trước khi xoá
// nó, cấp TƯỜNG MINH mọi cặp mà role chưa có grant riêng — TRỪ nhóm tài nguyên LƯƠNG. Kết quả:
//   · quyền ngoài lương: y hệt trước (chỉ khác là ĐẾM ĐƯỢC và THU HỒI ĐƯỢC từng cặp)
//   · quyền lương: về 0 cho hai role này — đúng ma trận §9g mà 0565 verify (6.4) đòi (tổng đúng 32 hàng)
//
// KHÔNG dùng migration: hai role này là dữ liệu RIÊNG của tenant PROD, không tồn tại ở CI/lane-DB.
//
// Cách dùng:
//   node scripts/s13-revoke-wildcard-grants.mjs            # DRY RUN — in kế hoạch rồi ROLLBACK
//   node scripts/s13-revoke-wildcard-grants.mjs --apply    # thực thi trong MỘT transaction
// Cần env DATABASE_DIRECT_URL (nạp .env gốc repo trước — xem mediaos.ps1 Import-DotEnv).

import { Pool } from "pg";

/** Tài nguyên thuộc miền LƯƠNG — cả tên di sản (gạch dưới) lẫn tên chuẩn 0565 (gạch nối). */
const PAYROLL_RESOURCES = [
  "payroll",
  "payroll-period",
  "payroll_period",
  "salary-profile",
  "salary_profile",
  "bonus-penalty",
  "bonus_penalty",
  "payslip",
];

const TARGET_ROLES = ["SA", "QUẢN LÝ CẤP CAO"];

/**
 * Cặp NÂNG-QUYỀN: ai giữ chúng thì tự cấp lại được MỌI quyền khác cho mình qua UI console — kể cả 13 cặp
 * lương nhạy cảm mà 0565 vừa seed. Giữ chúng là để ngỏ đường vòng quanh chính cổng §6.7 đang chặn.
 * Owner chốt 02/09/2026: THU HỒI khỏi `QUẢN LÝ CẤP CAO` (4 người) — role này chỉ có chúng QUA WILDCARD,
 * chưa từng được cấp tường minh. `SA` (10 người) giữ cả 6 cặp TƯỜNG MINH từ trước ⇒ ngoài phạm vi đợt này,
 * không đụng (thu hồi thì cần quyết định riêng của owner).
 */
const ESCALATION_PAIRS = [
  ["manage", "api-key"],
  ["view", "chat-oversight"],
  ["assign", "permission"],
  ["grant-object-permission", "permission"],
  ["change-role", "role"],
  ["assign-role", "user"],
];

/** Role bị thu hồi nhóm nâng-quyền: KHÔNG backfill + xoá tường minh nếu có sót ở CẢ HAI bảng grant. */
const ESCALATION_REVOKE_ROLES = ["QUẢN LÝ CẤP CAO"];

const APPLY = process.argv.includes("--apply");

async function main() {
  const url = process.env.DATABASE_DIRECT_URL;
  if (!url) throw new Error("Thiếu DATABASE_DIRECT_URL — nạp .env gốc repo trước khi chạy.");

  const pool = new Pool({ connectionString: url, max: 1 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('lock_timeout', '5s', true)");

    const { rows: roles } = await client.query(
      `SELECT id, name, company_id FROM roles
        WHERE name = ANY($1) AND deleted_at IS NULL`,
      [TARGET_ROLES],
    );
    if (roles.length !== TARGET_ROLES.length) {
      throw new Error(
        `Kỳ vọng ${TARGET_ROLES.length} role sống, đo được ${roles.length} — DỪNG fail-closed.`,
      );
    }
    const companyIds = [...new Set(roles.map((r) => r.company_id))];
    if (companyIds.length !== 1 || !companyIds[0]) {
      throw new Error("Hai role không cùng một company_id (hoặc global) — DỪNG fail-closed.");
    }
    // RLS FORCE trên role_permissions/audit_logs bám app.current_company_id.
    await client.query("SELECT set_config('app.current_company_id', $1, true)", [companyIds[0]]);

    const escAction = ESCALATION_PAIRS.map((p) => p[0]);
    const escResource = ESCALATION_PAIRS.map((p) => p[1]);

    const summary = [];
    const escalationRevoked = [];
    for (const role of roles) {
      const revokeEscalation = ESCALATION_REVOKE_ROLES.includes(role.name);

      // Cặp đang CHỈ được wildcard phủ ⇒ phải cấp tường minh để không đổi quyền hiệu dụng.
      // Loại miền lương (0565 seed theo ma trận §9g) và — với role bị thu hồi — loại nhóm nâng-quyền:
      // KHÔNG backfill chính là hình thức thu hồi, vì nguồn duy nhất của chúng là hàng wildcard sắp xoá.
      const { rows: gap } = await client.query(
        `SELECT p.id, p.action, p.resource_type, p.is_sensitive
           FROM permissions p
          WHERE p.action <> '*' AND p.resource_type <> '*'
            AND p.resource_type <> ALL($2)
            AND NOT ($3::boolean AND EXISTS (
                  SELECT 1 FROM unnest($4::text[], $5::text[]) AS e(a, r)
                   WHERE e.a = p.action AND e.r = p.resource_type))
            AND NOT EXISTS (SELECT 1 FROM role_permissions rp
                             WHERE rp.role_id = $1 AND rp.permission_id = p.id)
          ORDER BY p.resource_type, p.action`,
        [role.id, PAYROLL_RESOURCES, revokeEscalation, escAction, escResource],
      );

      const { rows: wildcard } = await client.query(
        `SELECT p.action, p.resource_type, rp.effect, rp.data_scope
           FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
          WHERE rp.role_id = $1 AND (p.action = '*' OR p.resource_type = '*')`,
        [role.id],
      );
      if (wildcard.length === 0) {
        throw new Error(
          `Role ${role.name} KHÔNG còn hàng wildcard — trạng thái khác kỳ vọng, DỪNG fail-closed.`,
        );
      }

      if (APPLY) {
        // (1) Cấp tường minh TRƯỚC khi gỡ wildcard — không có khoảnh khắc nào role mất quyền.
        const ins = await client.query(
          `INSERT INTO role_permissions (role_id, permission_id, effect, data_scope)
           SELECT $1, unnest($2::uuid[]), 'ALLOW', 'Company'
           ON CONFLICT DO NOTHING`,
          [role.id, gap.map((g) => g.id)],
        );
        if (ins.rowCount !== gap.length) {
          throw new Error(
            `Role ${role.name}: chèn ${ins.rowCount} hàng, kỳ vọng ${gap.length} — DỪNG fail-closed.`,
          );
        }

        // (2) Gỡ wildcard.
        const del = await client.query(
          `DELETE FROM role_permissions rp USING permissions p
            WHERE p.id = rp.permission_id AND rp.role_id = $1
              AND (p.action = '*' OR p.resource_type = '*')`,
          [role.id],
        );
        if (del.rowCount !== wildcard.length) {
          throw new Error(
            `Role ${role.name}: xoá ${del.rowCount} hàng wildcard, kỳ vọng ${wildcard.length} — DỪNG.`,
          );
        }

        // (3) Thu hồi nhóm nâng-quyền — xoá SÓT tường minh ở CẢ HAI bảng grant.
        //     object_permissions là exact ⇒ nó THOẢ THẲNG cổng sensitive, hình dạng bypass mạnh hơn
        //     wildcard; chỉ dọn role_permissions là để ngỏ đúng lỗ §9g.1. Đo 02/09: cả hai bảng = 0 hàng
        //     (role này chỉ giữ 6 cặp QUA wildcard) ⇒ lượt chạy này NO-OP, nhưng lệnh phải có.
        if (revokeEscalation) {
          const delRp = await client.query(
            `DELETE FROM role_permissions rp USING permissions p, unnest($2::text[], $3::text[]) AS e(a, r)
              WHERE p.id = rp.permission_id AND rp.role_id = $1
                AND p.action = e.a AND p.resource_type = e.r`,
            [role.id, escAction, escResource],
          );
          const delOp = await client.query(
            `DELETE FROM object_permissions op USING permissions p, unnest($2::text[], $3::text[]) AS e(a, r)
              WHERE p.id = op.permission_id AND op.subject_id = $1
                AND p.action = e.a AND p.resource_type = e.r`,
            [role.id, escAction, escResource],
          );
          escalationRevoked.push({
            role: role.name,
            pairs: ESCALATION_PAIRS.length,
            rolePermissionRowsDeleted: delRp.rowCount,
            objectPermissionRowsDeleted: delOp.rowCount,
          });
        }

        // (4) Vết audit (bảng append-only — chỉ INSERT).
        await client.query(
          `INSERT INTO audit_logs (company_id, actor_user_id, actor_type, action, object_type, object_id,
                                   before, after, module_code, sensitivity_level, result_status, diff_summary)
           VALUES ($1, NULL, 'System', 'revoke-wildcard-grant', 'role_permission', $2,
                   $3::jsonb, $4::jsonb, 'FOUNDATION', 'HighlySensitive', 'Success', $5)`,
          [
            role.company_id,
            role.id,
            JSON.stringify({ role: role.name, wildcard }),
            JSON.stringify({
              role: role.name,
              wildcard: [],
              explicitGrantsAdded: gap.map((g) => `${g.action}:${g.resource_type}`),
              escalationRevoked: revokeEscalation
                ? ESCALATION_PAIRS.map(([a, r]) => `${a}:${r}`)
                : [],
            }),
            `S13: gỡ ${wildcard.length} hàng wildcard, cấp tường minh ${gap.length} cặp (loại miền lương` +
              (revokeEscalation ? ` + thu hồi ${ESCALATION_PAIRS.length} cặp nâng-quyền)` : ")"),
          ],
        );
      }

      summary.push({
        role: role.name,
        wildcardRows: wildcard.length,
        explicitAdded: gap.length,
        sensitiveAdded: gap.filter((g) => g.is_sensitive).length,
        escalationRevoked: revokeEscalation ? ESCALATION_PAIRS.length : 0,
      });
    }

    if (APPLY) {
      // ── Verify fail-closed: 0 hàng wildcard còn lại ở MỌI role (trừ super-admin, theo TÊN) ──
      const { rows: left } = await client.query(
        `SELECT r.name, p.action, p.resource_type
           FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
           JOIN permissions p ON p.id = rp.permission_id
          WHERE r.deleted_at IS NULL AND r.name <> 'super-admin'
            AND (p.action = '*' OR p.resource_type = '*')`,
      );
      if (left.length > 0) {
        throw new Error(`verify: VẪN còn ${left.length} hàng wildcard: ${JSON.stringify(left)}`);
      }

      const { rows: pay } = await client.query(
        `SELECT r.name, p.action, p.resource_type
           FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
           JOIN permissions p ON p.id = rp.permission_id
          WHERE r.name = ANY($1) AND p.resource_type = ANY($2)`,
        [TARGET_ROLES, PAYROLL_RESOURCES],
      );
      if (pay.length > 0) {
        console.log(
          `[chú ý] hai role còn ${pay.length} cặp lương DI SẢN tường minh — 0565 bước (3) sẽ thu hồi:`,
        );
        console.table(pay);
      }

      // ── Verify nhóm nâng-quyền = 0 hàng ở CẢ HAI bảng grant, cho role bị thu hồi ──
      const { rows: esc } = await client.query(
        `SELECT r.name, p.action, p.resource_type, 'role_permissions' AS src
           FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
           JOIN permissions p ON p.id = rp.permission_id
           JOIN unnest($2::text[], $3::text[]) AS e(a, r2) ON e.a = p.action AND e.r2 = p.resource_type
          WHERE r.name = ANY($1)
          UNION ALL
         SELECT r.name, p.action, p.resource_type, 'object_permissions'
           FROM object_permissions op JOIN roles r ON r.id = op.subject_id
           JOIN permissions p ON p.id = op.permission_id
           JOIN unnest($2::text[], $3::text[]) AS e(a, r2) ON e.a = p.action AND e.r2 = p.resource_type
          WHERE r.name = ANY($1)`,
        [ESCALATION_REVOKE_ROLES, escAction, escResource],
      );
      if (esc.length > 0) {
        throw new Error(
          `verify: role bị thu hồi VẪN giữ ${esc.length} cặp nâng-quyền: ${JSON.stringify(esc)}`,
        );
      }
      if (escalationRevoked.length > 0) console.table(escalationRevoked);
    }

    console.table(summary);
    if (APPLY) {
      await client.query("COMMIT");
      console.log("[apply] COMMIT — wildcard đã gỡ, grant tường minh đã cấp.");
    } else {
      await client.query("ROLLBACK");
      console.log("[dry-run] ROLLBACK — chưa ghi gì. Chạy lại với --apply để thực thi.");
    }
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[s13-revoke-wildcard-grants] THẤT BẠI:", err.message);
  process.exit(1);
});
