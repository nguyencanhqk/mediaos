/**
 * sync-lms-users.mjs — đồng bộ 1 chiều tài khoản MediaOS → LMS (fmc-app).
 *
 * Đọc users + employee_profiles của 1 company từ Postgres rồi POST sang LMS
 * /api/admin/sync-users (bearer MEDIAOS_SYNC_TOKEN):
 *   - user active   → LMS tạo nếu chưa có (verified, mật khẩu random — vào bằng SSO).
 *   - user locked / nghỉ việc → LMS thu hồi phiên + xáo mật khẩu (khóa đăng nhập, giữ dữ liệu học).
 *
 * Chạy TỪ apps/api:
 *   SEED_DIRECT_URL=postgres://mediaos:...@localhost:5432/mediaos \
 *   LMS_BASE_URL=https://lms.example.com \
 *   MEDIAOS_SYNC_TOKEN=... \
 *   node sync-lms-users.mjs --company-slug funtime [--dry-run]
 *
 * Idempotent (LMS bỏ qua user đã đúng trạng thái). Có thể chạy tay hoặc cron.
 */
import pg from "pg";

function parseArgs(argv) {
  const flags = { dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--company-slug") flags.companySlug = argv[++i];
    else if (a === "--dry-run") flags.dryRun = true;
    else throw new Error(`Tham số không hợp lệ: ${a}`);
  }
  if (!flags.companySlug) throw new Error("Bắt buộc: --company-slug <slug>");
  return flags;
}

async function main() {
  const flags = parseArgs(process.argv);
  const DIRECT_URL = process.env.SEED_DIRECT_URL;
  const LMS_BASE_URL = process.env.LMS_BASE_URL?.replace(/\/+$/, "");
  const SYNC_TOKEN = process.env.MEDIAOS_SYNC_TOKEN;
  if (!DIRECT_URL) throw new Error("Thiếu env SEED_DIRECT_URL");
  if (!flags.dryRun && (!LMS_BASE_URL || !SYNC_TOKEN))
    throw new Error("Thiếu env LMS_BASE_URL / MEDIAOS_SYNC_TOKEN (hoặc dùng --dry-run)");

  const c = new pg.Client({ connectionString: DIRECT_URL });
  await c.connect();
  let rows;
  try {
    // Chỉ user có hồ sơ nhân viên (bỏ tài khoản kỹ thuật admin@...). active = user active + hồ sơ active.
    const r = await c.query(
      `SELECT u.email, u.full_name AS name,
              (u.status = 'active' AND ep.status = 'active') AS active
         FROM users u
         JOIN companies co ON co.id = u.company_id AND co.slug = $1 AND co.deleted_at IS NULL
         JOIN employee_profiles ep ON ep.user_id = u.id AND ep.deleted_at IS NULL
        WHERE u.deleted_at IS NULL
        ORDER BY u.email`,
      [flags.companySlug],
    );
    rows = r.rows;
  } finally {
    await c.end();
  }

  const users = rows.map((r) => ({ email: r.email, name: r.name ?? undefined, active: r.active }));
  const activeCount = users.filter((u) => u.active).length;
  console.log(
    `→ ${users.length} tài khoản (${activeCount} active, ${users.length - activeCount} inactive) từ company ${flags.companySlug}`,
  );

  if (flags.dryRun) {
    for (const u of users) console.log(`  ${u.active ? "ACTIVE  " : "INACTIVE"} ${u.email}`);
    console.log("(--dry-run: không gọi LMS)");
    return;
  }

  const res = await fetch(`${LMS_BASE_URL}/api/admin/sync-users`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${SYNC_TOKEN}`,
    },
    body: JSON.stringify({ users }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`LMS trả ${res.status}: ${JSON.stringify(body)}`);
  console.log("✓ LMS sync:", JSON.stringify(body.summary ?? body));
}

main().catch((e) => {
  console.error("✗ SYNC LỖI:", e.message);
  process.exit(1);
});
