/**
 * perf-smoke.mjs — S5-PERF-1 · Workstream H (IMPLEMENTATION-08 §17)
 *
 * Smoke/baseline latency probe cho 5 endpoint SLA lõi MVP (§17.2):
 *   1. Employee list          GET /hr/employees?page=1&pageSize=20   (canonical, đã paginate)
 *   2. Attendance records     GET /attendance/records?page&pageSize   (index tháng/employee/scope)
 *   3. Task board             GET /tasks/board                        (không N+1 summary)
 *   4. Notification unread    GET /notifications/unread-count         (partial index idx_notifications_unread)
 *   5. Dashboard me           GET /dashboard/me                       (widget cache/degraded)
 *
 * KHÔNG phải load test (§17.2 "Không load test sâu"). Chạy tuần tự, ít vòng, đo p50/p95 một client —
 * mục tiêu là phát hiện điểm nghẽn thô + regression rõ rệt, KHÔNG mô phỏng tải đồng thời.
 *
 * QUAN SÁT (§17.3): mỗi response PHẢI có `meta.request_id` (echo header X-Request-Id) — script assert
 * điều này như một smoke observability check, in ra khi thiếu.
 *
 * AN TOÀN:
 *   - CHỈ ĐỌC (GET). Không ghi DB, không mutate. An toàn chạy trên dev-online.
 *   - MẶC ĐỊNH nhắm dev-online :3200 (KHÔNG PROD :3100) — đổi qua PERF_BASE_URL nếu cần.
 *   - Creds đọc từ env (PERF_EMAIL/PERF_PASSWORD/PERF_COMPANY_SLUG); mặc định tài khoản demo dev-online.
 *     KHÔNG log token/mật khẩu.
 *   - Server không với tới / login hỏng → in "SKIP" và exit 0 (KHÔNG phá CI). Dùng --strict để exit 1
 *     khi p95 vượt ngưỡng SLA hoặc có endpoint đỏ.
 *
 * DÙNG:
 *   node scripts/perf-smoke.mjs                 # bảng người đọc
 *   node scripts/perf-smoke.mjs --json          # JSON máy đọc (ghi số đo vào report)
 *   node scripts/perf-smoke.mjs --strict        # exit 1 nếu vượt SLA / có đỏ
 *   PERF_ITERATIONS=50 node scripts/perf-smoke.mjs
 */

const BASE_URL = (process.env.PERF_BASE_URL ?? "http://localhost:3200/api/v1").replace(/\/$/, "");
const EMAIL = process.env.PERF_EMAIL ?? "admin@demo.local";
const PASSWORD = process.env.PERF_PASSWORD ?? "Admin@12345";
const COMPANY_SLUG = process.env.PERF_COMPANY_SLUG ?? "demo";
const ITERATIONS = clampInt(process.env.PERF_ITERATIONS, 20, 1, 200);
const WARMUP = clampInt(process.env.PERF_WARMUP, 3, 0, 20);
const TIMEOUT_MS = clampInt(process.env.PERF_TIMEOUT_MS, 10_000, 1_000, 60_000);

const JSON_OUT = process.argv.includes("--json");
const STRICT = process.argv.includes("--strict");

/**
 * Ngưỡng p95 (ms) — SLA smoke MVP một-client. KHÔNG phải SLA sản xuất dưới tải; chỉ để bắt hồi quy thô
 * (một truy vấn chậm bất thường / N+1 / thiếu index). Đặt rộng tay, ưu tiên ít báo động giả.
 */
const P95_BUDGET_MS = 800;

/** @type {{ key: string, label: string, path: string, expectMeta?: boolean }[]} */
const ENDPOINTS = [
  { key: "employee_list", label: "Employee list", path: "/hr/employees?page=1&pageSize=20" },
  {
    key: "attendance_records",
    label: "Attendance records",
    path: "/attendance/records?page=1&pageSize=20",
  },
  { key: "task_board", label: "Task board", path: "/tasks/board" },
  { key: "notification_unread", label: "Notification unread", path: "/notifications/unread-count" },
  { key: "dashboard_me", label: "Dashboard me", path: "/dashboard/me" },
];

function clampInt(raw, def, min, max) {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

async function fetchWithTimeout(url, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function skip(reason) {
  const payload = { skipped: true, reason, baseUrl: BASE_URL };
  if (JSON_OUT) {
    process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
  } else {
    console.log(`\n⏭  PERF SMOKE SKIPPED — ${reason}`);
    console.log(`   base_url=${BASE_URL}  (đặt PERF_BASE_URL để trỏ nơi khác)`);
    console.log("   Đây KHÔNG phải lỗi: smoke bỏ qua khi không có server (không phá CI).\n");
  }
  // Skip luôn exit 0 — kể cả --strict (không có bằng chứng ≠ vi phạm SLA).
  process.exit(0);
}

async function login() {
  let res;
  try {
    res = await fetchWithTimeout(`${BASE_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD, companySlug: COMPANY_SLUG }),
    });
  } catch (err) {
    skip(`không kết nối được API (${err?.name === "AbortError" ? "timeout" : (err?.code ?? err)})`);
  }
  if (!res.ok) {
    skip(`login trả ${res.status} (kiểm tra PERF_EMAIL/PERF_PASSWORD/PERF_COMPANY_SLUG)`);
  }
  const body = await res.json().catch(() => null);
  const token = body?.data?.accessToken;
  if (!token) skip("login OK nhưng thiếu data.accessToken");
  return token;
}

async function measureEndpoint(token, ep) {
  const url = `${BASE_URL}${ep.path}`;
  const headers = { Authorization: `Bearer ${token}` };
  const samples = [];
  let lastStatus = 0;
  let sawRequestId = false;
  let firstError = null;

  // Warmup — không tính giờ (JIT/cache mồi).
  for (let i = 0; i < WARMUP; i++) {
    try {
      await fetchWithTimeout(url, { headers });
    } catch {
      /* warmup errors bỏ qua — đo chính thức bên dưới sẽ ghi nhận */
    }
  }

  for (let i = 0; i < ITERATIONS; i++) {
    const t0 = performance.now();
    try {
      const res = await fetchWithTimeout(url, { headers });
      const dt = performance.now() - t0;
      lastStatus = res.status;
      if (res.headers.get("x-request-id")) sawRequestId = true;
      // Đọc hết body để tính thời gian truyền đầy đủ (không chỉ TTFB header).
      const body = await res.json().catch(() => null);
      if (body?.meta?.request_id) sawRequestId = true;
      samples.push(dt);
    } catch (err) {
      firstError ??= err?.name === "AbortError" ? "timeout" : String(err?.code ?? err);
    }
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const ok = lastStatus >= 200 && lastStatus < 300 && samples.length > 0;
  const p95 = percentile(sorted, 95);
  return {
    key: ep.key,
    label: ep.label,
    path: ep.path,
    status: lastStatus,
    ok,
    samples: samples.length,
    min: round1(sorted[0] ?? 0),
    p50: round1(percentile(sorted, 50)),
    p95: round1(p95),
    max: round1(sorted[sorted.length - 1] ?? 0),
    request_id_present: sawRequestId,
    over_budget: ok && p95 > P95_BUDGET_MS,
    error: firstError,
  };
}

async function main() {
  const token = await login();

  const results = [];
  for (const ep of ENDPOINTS) {
    results.push(await measureEndpoint(token, ep));
  }

  const stamp = new Date().toISOString();
  const summary = {
    base_url: BASE_URL,
    measured_at: stamp,
    iterations: ITERATIONS,
    warmup: WARMUP,
    p95_budget_ms: P95_BUDGET_MS,
    results,
  };

  if (JSON_OUT) {
    process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
  } else {
    console.log(
      `\n📊 PERF SMOKE — ${BASE_URL}   (${ITERATIONS} vòng, warmup ${WARMUP}, ${stamp})\n`,
    );
    const head = ["Endpoint", "Path", "HTTP", "min", "p50", "p95", "max", "req-id"];
    console.log(fmtRow(head));
    console.log("  " + "-".repeat(96));
    for (const r of results) {
      console.log(
        fmtRow([
          r.label,
          r.path.length > 34 ? r.path.slice(0, 33) + "…" : r.path,
          r.ok ? String(r.status) : `✗${r.status || r.error || "err"}`,
          `${r.min}`,
          `${r.p50}`,
          `${r.p95}${r.over_budget ? "⚠" : ""}`,
          `${r.max}`,
          r.request_id_present ? "✓" : "✗",
        ]),
      );
    }
    console.log("");
    const reds = results.filter((r) => !r.ok);
    const slow = results.filter((r) => r.over_budget);
    const noReqId = results.filter((r) => r.ok && !r.request_id_present);
    if (reds.length)
      console.log(`  ⛔ ${reds.length} endpoint KHÔNG 2xx: ${reds.map((r) => r.label).join(", ")}`);
    if (slow.length)
      console.log(
        `  ⚠  ${slow.length} endpoint p95 > ${P95_BUDGET_MS}ms: ${slow.map((r) => r.label).join(", ")}`,
      );
    if (noReqId.length)
      console.log(
        `  ⚠  ${noReqId.length} endpoint thiếu request_id (§17.3): ${noReqId.map((r) => r.label).join(", ")}`,
      );
    if (!reds.length && !slow.length && !noReqId.length)
      console.log("  ✅ Tất cả 2xx · p95 trong ngưỡng · request_id đầy đủ.");
    console.log("");
  }

  if (STRICT && results.some((r) => !r.ok || r.over_budget)) process.exit(1);
}

function fmtRow(cols) {
  const widths = [20, 35, 8, 7, 7, 8, 7, 7];
  return "  " + cols.map((c, i) => String(c).padEnd(widths[i])).join("");
}

main().catch((err) => {
  // Lỗi ngoài dự kiến (KHÔNG phải "server không có") → in ra nhưng vẫn exit 0 trừ khi --strict.
  console.error(`perf-smoke lỗi: ${err?.stack ?? err}`);
  process.exit(STRICT ? 1 : 0);
});
