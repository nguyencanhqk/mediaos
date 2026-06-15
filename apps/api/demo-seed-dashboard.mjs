/**
 * DEMO seed + dashboard generator (G1 quick-view).
 *
 * Chạy:  node "c:/dev 2/MediaOS/apps/api/demo-seed-dashboard.mjs"
 *   (chạy từ apps/api để resolve được `pg` + `@node-rs/argon2`)
 *
 * Làm 2 việc:
 *   1) Seed idempotent: company "demo" + admin@demo.local + 16 task nhiều trạng thái.
 *   2) Đăng nhập qua API THẬT (/auth/login) → token → GET /tasks → sinh dashboard HTML.
 *
 * Output: c:/tmp/mediaos-dashboard.html  (mở bằng trình duyệt để xem).
 * KHÔNG phải code sản phẩm — chỉ là công cụ xem nhanh khi web còn login-mock (G1).
 */
import pg from "pg";
import { hash, Algorithm } from "@node-rs/argon2";
import { writeFileSync } from "node:fs";

const DIRECT_URL = "postgres://mediaos:changeme_dev_only@localhost:5432/mediaos";
const API = "http://localhost:3100/api/v1";
const OUT = "c:/tmp/mediaos-dashboard.html";

const COMPANY = { name: "MediaOS Demo", slug: "demo" };
const ADMIN = { email: "admin@demo.local", password: "Admin@12345", fullName: "Quản trị viên Demo" };

// Băm khớp PasswordService (argon2id, OWASP 2024). verify đọc params từ hash nên luôn khớp.
const ARGON = { algorithm: Algorithm.Argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
const due = (d) => new Date(now + d * DAY); // d ngày kể từ hôm nay (âm = quá hạn)

/** 16 task mẫu — phủ đủ 6 trạng thái, nhiều task_type, vài cái quá hạn. */
const TASKS = [
  { title: "Viết kịch bản video 'Review iPhone 16 Pro'", status: "not_started", type: "workflow_step", due: due(3) },
  { title: "Lên outline series 'Tết 2026'", status: "not_started", type: "office", due: due(7) },
  { title: "Chuẩn bị họp kế hoạch nội dung tháng 7", status: "not_started", type: "meeting_action", due: due(2) },
  { title: "Dựng video 'Top 5 laptop gaming 2026'", status: "in_progress", type: "workflow_step", due: due(1) },
  { title: "Quay phỏng vấn khách mời số tháng 6", status: "in_progress", type: "workflow_step", due: due(-1) },
  { title: "Thiết kế thumbnail kênh Ẩm Thực", status: "in_progress", type: "office", due: due(0) },
  { title: "Xử lý hồ sơ nhân sự mới onboard", status: "in_progress", type: "hr", due: due(4) },
  { title: "QA video 'Hướng dẫn nấu phở bò'", status: "waiting_review", type: "workflow_step", due: due(-2) },
  { title: "Duyệt kịch bản 'Khám phá Đà Lạt'", status: "waiting_review", type: "workflow_step", due: due(1) },
  { title: "Sửa lại phần intro video 'Công nghệ AI'", status: "revision", type: "workflow_step", due: due(2), origin: "revision", round: 1 },
  { title: "Chỉnh màu video 'Vlog Sài Gòn về đêm'", status: "revision", type: "workflow_step", due: due(-3), origin: "revision", round: 2 },
  { title: "Upload video 'Mẹo tiết kiệm pin điện thoại'", status: "approved", type: "workflow_step", due: due(1) },
  { title: "Lên lịch đăng bài fanpage tuần 24", status: "approved", type: "office", due: due(0) },
  { title: "Xuất bản video 'Đánh giá Galaxy S25 Ultra'", status: "completed", type: "workflow_step", due: due(-5) },
  { title: "Tổng kết KPI kênh tháng 5", status: "completed", type: "office", due: due(-6) },
  { title: "Báo cáo chi phí sản xuất Quý 2", status: "completed", type: "finance", due: due(-4) },
];

async function seed() {
  const client = new pg.Client({ connectionString: DIRECT_URL });
  await client.connect();
  try {
    await client.query("BEGIN");

    // company (idempotent theo slug)
    let r = await client.query("SELECT id FROM companies WHERE slug = $1 AND deleted_at IS NULL LIMIT 1", [COMPANY.slug]);
    let companyId = r.rows[0]?.id;
    if (!companyId) {
      r = await client.query(
        "INSERT INTO companies (name, slug, status) VALUES ($1, $2, 'active') RETURNING id",
        [COMPANY.name, COMPANY.slug],
      );
      companyId = r.rows[0].id;
    }

    // admin user (idempotent theo company+email) — reset mật khẩu mỗi lần chạy
    const pwHash = await hash(ADMIN.password, ARGON);
    r = await client.query(
      "SELECT id FROM users WHERE company_id = $1 AND email = $2 AND deleted_at IS NULL LIMIT 1",
      [companyId, ADMIN.email],
    );
    let adminId = r.rows[0]?.id;
    if (!adminId) {
      r = await client.query(
        "INSERT INTO users (company_id, email, password_hash, full_name, status) VALUES ($1,$2,$3,$4,'active') RETURNING id",
        [companyId, ADMIN.email, pwHash, ADMIN.fullName],
      );
      adminId = r.rows[0].id;
    } else {
      await client.query("UPDATE users SET password_hash = $1, full_name = $2 WHERE id = $3", [pwHash, ADMIN.fullName, adminId]);
    }

    // tasks — xoá cũ rồi seed lại để board ổn định
    await client.query("DELETE FROM task_comments WHERE company_id = $1", [companyId]);
    await client.query("DELETE FROM tasks WHERE company_id = $1", [companyId]);
    for (const t of TASKS) {
      await client.query(
        `INSERT INTO tasks (company_id, task_type, title, assignee_user_id, status, origin, revision_round, due_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [companyId, t.type, t.title, adminId, t.status, t.origin ?? "initial", t.round ?? 0, t.due],
      );
    }

    await client.query("COMMIT");
    return { companyId, adminId, taskCount: TASKS.length };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    await client.end();
  }
}

async function fetchViaApi() {
  // 1) login thật
  const loginRes = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ companySlug: COMPANY.slug, email: ADMIN.email, password: ADMIN.password }),
  });
  const loginBody = await loginRes.json();
  if (!loginRes.ok) throw new Error(`login ${loginRes.status}: ${JSON.stringify(loginBody)}`);
  const tok = loginBody.data ?? loginBody;
  const accessToken = tok.accessToken ?? tok.access_token ?? tok.token;
  if (!accessToken) throw new Error(`no access token in: ${JSON.stringify(tok)}`);
  const auth = { Authorization: `Bearer ${accessToken}` };

  // 2) /me + /tasks
  const meRes = await fetch(`${API}/auth/me`, { headers: auth });
  const me = (await meRes.json()).data;
  const tasksRes = await fetch(`${API}/tasks`, { headers: auth });
  const tasksBody = await tasksRes.json();
  if (!tasksRes.ok) throw new Error(`/tasks ${tasksRes.status}: ${JSON.stringify(tasksBody)}`);
  const tasks = tasksBody.data ?? tasksBody;
  return { me, tasks };
}

// ─── HTML dashboard ──────────────────────────────────────────────────────────
const STATUS_META = {
  not_started:   { label: "Chưa bắt đầu",  color: "#64748b", bg: "#f1f5f9" },
  in_progress:   { label: "Đang làm",       color: "#2563eb", bg: "#eff6ff" },
  waiting_review:{ label: "Chờ duyệt",       color: "#d97706", bg: "#fffbeb" },
  revision:      { label: "Trả sửa",         color: "#dc2626", bg: "#fef2f2" },
  approved:      { label: "Đã duyệt",         color: "#7c3aed", bg: "#f5f3ff" },
  completed:     { label: "Hoàn thành",       color: "#059669", bg: "#ecfdf5" },
};
const STATUS_ORDER = ["not_started", "in_progress", "waiting_review", "revision", "approved", "completed"];
const TYPE_LABEL = { workflow_step: "Quy trình", office: "Văn phòng", meeting_action: "Sau họp", hr: "Nhân sự", finance: "Tài chính" };
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function fmtDue(iso) {
  if (!iso) return { text: "—", overdue: false };
  const d = new Date(iso);
  const days = Math.round((d.getTime() - now) / DAY);
  const overdue = days < 0;
  const txt = d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" });
  const rel = days === 0 ? "hôm nay" : days > 0 ? `còn ${days}n` : `quá ${-days}n`;
  return { text: `${txt} · ${rel}`, overdue };
}

function buildHtml({ me, tasks }) {
  const byStatus = Object.fromEntries(STATUS_ORDER.map((s) => [s, []]));
  for (const t of tasks) (byStatus[t.status] ??= []).push(t);
  const total = tasks.length;
  const overdue = tasks.filter((t) => t.dueDate && new Date(t.dueDate).getTime() < now && t.status !== "completed").length;

  const stat = STATUS_ORDER.map((s) => {
    const m = STATUS_META[s];
    return `<div class="chip" style="--c:${m.color};--b:${m.bg}"><b>${byStatus[s].length}</b> ${m.label}</div>`;
  }).join("");

  const columns = STATUS_ORDER.map((s) => {
    const m = STATUS_META[s];
    const cards = byStatus[s].map((t) => {
      const d = fmtDue(t.dueDate);
      return `<div class="card">
        <div class="card-title">${esc(t.title)}</div>
        <div class="card-meta">
          <span class="tag">${esc(TYPE_LABEL[t.taskType] ?? t.taskType ?? "—")}</span>
          ${t.revisionRound > 0 ? `<span class="tag warn">vòng sửa ${t.revisionRound}</span>` : ""}
          <span class="due ${d.overdue && s !== "completed" ? "overdue" : ""}">⏱ ${esc(d.text)}</span>
        </div>
      </div>`;
    }).join("") || `<div class="empty">— trống —</div>`;
    return `<div class="col">
      <div class="col-head" style="--c:${m.color};--b:${m.bg}">
        <span>${m.label}</span><span class="count">${byStatus[s].length}</span>
      </div>
      <div class="col-body">${cards}</div>
    </div>`;
  }).join("");

  const stamp = new Date().toLocaleString("vi-VN");
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>MediaOS — Bảng Task (demo)</title>
<style>
  * { box-sizing: border-box; }
  body { margin:0; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background:#f8fafc; color:#0f172a; }
  header { background:#0f172a; color:#fff; padding:18px 28px; }
  header h1 { margin:0; font-size:20px; }
  header .sub { color:#94a3b8; font-size:13px; margin-top:4px; }
  .bar { display:flex; gap:10px; flex-wrap:wrap; padding:16px 28px; align-items:center; }
  .chip { background:var(--b); color:var(--c); border:1px solid color-mix(in srgb, var(--c) 25%, transparent); padding:6px 12px; border-radius:999px; font-size:13px; }
  .chip b { font-size:15px; }
  .kpi { margin-left:auto; display:flex; gap:18px; font-size:13px; color:#475569; }
  .kpi b { font-size:18px; color:#0f172a; display:block; }
  .kpi .red b { color:#dc2626; }
  .board { display:grid; grid-template-columns: repeat(6, minmax(200px,1fr)); gap:14px; padding:8px 28px 40px; overflow-x:auto; }
  .col { background:#fff; border:1px solid #e2e8f0; border-radius:12px; display:flex; flex-direction:column; min-height:200px; }
  .col-head { display:flex; justify-content:space-between; align-items:center; padding:10px 14px; font-weight:600; font-size:14px; color:var(--c); background:var(--b); border-radius:12px 12px 0 0; }
  .col-head .count { background:#fff; color:var(--c); border-radius:999px; padding:1px 9px; font-size:12px; }
  .col-body { padding:10px; display:flex; flex-direction:column; gap:10px; }
  .card { border:1px solid #e2e8f0; border-radius:10px; padding:11px 12px; background:#fff; box-shadow:0 1px 2px rgba(0,0,0,.03); }
  .card-title { font-size:13.5px; font-weight:500; line-height:1.35; }
  .card-meta { display:flex; gap:6px; flex-wrap:wrap; align-items:center; margin-top:9px; }
  .tag { font-size:11px; background:#f1f5f9; color:#475569; padding:2px 7px; border-radius:6px; }
  .tag.warn { background:#fef2f2; color:#dc2626; }
  .due { font-size:11px; color:#64748b; margin-left:auto; }
  .due.overdue { color:#dc2626; font-weight:600; }
  .empty { color:#cbd5e1; font-size:12px; text-align:center; padding:20px 0; }
  footer { padding:0 28px 30px; color:#94a3b8; font-size:12px; }
  code { background:#f1f5f9; padding:1px 5px; border-radius:4px; }
</style></head><body>
<header>
  <h1>📋 MediaOS — Bảng quản lý Task <span style="font-weight:400;color:#94a3b8">(demo · dữ liệu qua API thật)</span></h1>
  <div class="sub">Công ty <b style="color:#fff">${esc(COMPANY.name)}</b> · đăng nhập <b style="color:#fff">${esc(me?.email ?? ADMIN.email)}</b> · nguồn: <code>GET ${API}/tasks</code></div>
</header>
<div class="bar">
  ${stat}
  <div class="kpi">
    <div><b>${total}</b> Tổng task</div>
    <div class="red"><b>${overdue}</b> Quá hạn</div>
  </div>
</div>
<div class="board">${columns}</div>
<footer>Sinh lúc ${esc(stamp)} · Snapshot từ API. Chạy lại script để cập nhật. Web app hiện vẫn dùng login-mock (G1) nên đây là cách xem nhanh trực quan.</footer>
</body></html>`;
}

(async () => {
  console.log("→ Seeding demo data…");
  const s = await seed();
  console.log(`  ✓ company=${s.companyId} admin=${s.adminId} tasks=${s.taskCount}`);
  console.log("→ Gọi API (login + /tasks)…");
  const data = await fetchViaApi();
  console.log(`  ✓ /me=${data.me?.email} · /tasks trả ${data.tasks.length} task`);
  writeFileSync(OUT, buildHtml(data), "utf8");
  console.log(`→ Dashboard: ${OUT}`);
  console.log(`\nĐăng nhập demo:  companySlug=demo  email=${ADMIN.email}  password=${ADMIN.password}`);
})().catch((e) => { console.error("✗", e); process.exit(1); });
