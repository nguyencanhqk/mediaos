#!/usr/bin/env node
/**
 * check-db-readiness.mjs — CHỐT HỒI QUY của S6-PERF-DB-1 (WS5 §14.3 + WS6 §15.2/§15.6).
 *
 * VÌ SAO CÓ FILE NÀY. Ba bảo đảm dưới đây hôm nay đều ĐANG ĐÚNG (đo 2026-07-29) nhưng KHÔNG ai canh:
 *   A. "Query bảng lớn có index phù hợp" (IMPLEMENTATION-09 §14.3) — là checklist NGƯỜI ĐỌC. Một
 *      migration xoá/đổi index, hay một bảng mới thêm mà quên index, sẽ không làm đỏ bất cứ thứ gì;
 *      hậu quả chỉ lộ ra ở PROD dưới tải.
 *   B. BẤT BIẾN #1 (FORCE RLS trên MỌI bảng có company_id) — có test tenant-isolation ở tầng app,
 *      nhưng không có chốt nào đọc thẳng pg_class sau khi migration chạy.
 *   C. BẤT BIẾN #2 (bảng ledger append-only: app role KHÔNG có UPDATE/DELETE) — cùng lý do.
 * Bài học neo: `tests-can-pin-a-hole-open` + `wo-seed-hand-measurements-can-be-incomplete` — thứ
 * không đo tự động thì trôi, và "đã đúng một lần" không phải bảo đảm.
 *
 * CHẠY:
 *   node scripts/check-db-readiness.mjs                    # đọc DATABASE_DIRECT_URL, mặc định .env
 *   node scripts/check-db-readiness.mjs --env .env.prod
 *   DATABASE_DIRECT_URL=postgres://… node scripts/check-db-readiness.mjs
 *   node scripts/check-db-readiness.mjs --json             # máy đọc
 *
 * KHÔNG với tới được DB (máy khác / CI không có Postgres) ⇒ exit 0 + cảnh báo — cùng khuôn
 * `check-prod-test-tenants.mjs`. Chốt này KHÔNG được phép tạo đỏ-giả ở nơi không có DB.
 *
 * ⚠️ CHỈ assert index TỒN TẠI (theo cột dẫn đầu), KHÔNG assert planner CHỌN index qua EXPLAIN —
 *    bài học `pg-planner-index-assert-trap`: trên dataset nhỏ seq scan là lựa chọn HỢP LỆ, assert
 *    EXPLAIN sẽ đỏ oan ở dev/CI. Thứ migration kiểm soát được là index có mặt hay không.
 *
 * ⚠️ Khớp theo CỘT DẪN ĐẦU, không theo TÊN index: đổi tên index (rebuild/rename) KHÔNG được làm đỏ,
 *    nhưng mất độ phủ thì phải đỏ. Muốn xoá một index trong danh sách ⇒ phải sửa file này CÓ CHỦ Ý.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

// ── A. Độ phủ index cho query nặng — mỗi dòng neo vào một ô của IMPLEMENTATION-09 §14.3 ──────────
// leading: các cột dẫn đầu BẮT BUỘC, đúng thứ tự. Index thật được phép có thêm cột đuôi.
// partial: (tuỳ chọn) chuỗi phải xuất hiện trong mệnh đề WHERE của index — dùng cho partial index.
const YEU_CAU_INDEX = [
  {
    oCheck: "§14.3 · Attendance records query theo employee/date có index",
    table: "attendance_records",
    leading: ["company_id", "employee_id", "work_date"],
  },
  {
    oCheck: "§14.3 · Attendance query theo tháng/phòng ban (dashboard ATT)",
    table: "attendance_records",
    leading: ["company_id", "department_id", "work_date"],
  },
  {
    oCheck: "§14.3 · Leave query theo employee/date có index",
    table: "leave_requests",
    leading: ["company_id", "employee_id", "start_date"],
  },
  {
    oCheck: "§14.3 · Leave approved DAY query theo employee/date có index",
    table: "leave_request_days",
    leading: ["company_id", "employee_id"],
  },
  {
    oCheck: "§14.3 · Hàng chờ duyệt nghỉ phép (pending theo approver)",
    table: "leave_requests",
    leading: ["company_id", "current_approver_user_id", "status"],
  },
  {
    oCheck: "§14.3 · Task list theo assignee/status/due có index",
    table: "tasks",
    leading: ["company_id", "main_assignee_employee_id", "task_status", "due_at"],
  },
  {
    oCheck: "§14.3 · Task board theo project/status (không N+1)",
    table: "tasks",
    leading: ["company_id", "project_id", "task_status"],
  },
  {
    oCheck: "§14.3 · Notification unread count có PARTIAL index",
    table: "notifications",
    leading: ["company_id", "recipient_user_id"],
    partial: "Unread",
  },
  {
    oCheck: "§14.3 · Notification list theo người nhận + thời gian",
    table: "notifications",
    leading: ["company_id", "recipient_user_id", "created_at"],
  },
  {
    oCheck: "§14.3 · Audit log query có index thời gian",
    table: "audit_logs",
    leading: ["company_id", "created_at"],
  },
  {
    oCheck: "§14.3 · Login log query có index thời gian (soi brute-force theo công ty)",
    table: "login_logs",
    leading: ["company_id", "created_at"],
  },
  {
    oCheck: "§14.3 · Employee list theo trạng thái (màn hình HR nặng nhất)",
    table: "employee_profiles",
    leading: ["company_id", "status"],
  },
];

// ── C. Bảng ledger append-only (CLAUDE.md BẤT BIẾN #2 + docs/erd-current.md §9) ───────────────────
const BANG_LEDGER = [
  "audit_logs",
  "login_logs",
  "attendance_logs",
  "leave_balance_transactions",
  "task_activity_logs",
  "notification_delivery_logs",
  "employee_status_histories",
  "user_security_events",
  "file_access_logs",
];
const APP_ROLE = process.env.APP_DB_ROLE?.trim() || "mediaos_app";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const envFile = args.includes("--env") ? args[args.indexOf("--env") + 1] : ".env";

function urlFromEnvFile(file) {
  const abs = resolve(process.cwd(), file);
  if (!existsSync(abs)) return null;
  for (const raw of readFileSync(abs, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    if (line.slice(0, eq).trim() === "DATABASE_DIRECT_URL") return line.slice(eq + 1).trim();
  }
  return null;
}

function ket(code, payload) {
  if (asJson) console.log(JSON.stringify(payload, null, 2));
  process.exit(code);
}

/**
 * Tách danh sách cột của một indexdef.
 * "CREATE INDEX x ON public.t USING btree (a, b DESC, lower(c)) WHERE (d IS NULL)" → ["a","b","lower(c)"]
 * Cắt đúng theo NGOẶC CÂN BẰNG (không dùng regex tham lam) để biểu thức có ngoặc không phá bộ tách.
 */
function cotCuaIndex(indexdef) {
  const usingAt = indexdef.search(/USING\s+\w+\s*\(/i);
  if (usingAt === -1) return [];
  const open = indexdef.indexOf("(", usingAt);
  let depth = 0;
  let close = -1;
  for (let i = open; i < indexdef.length; i++) {
    if (indexdef[i] === "(") depth++;
    else if (indexdef[i] === ")") {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close === -1) return [];
  const raw = indexdef.slice(open + 1, close);

  const parts = [];
  let buf = "";
  depth = 0;
  for (const ch of raw) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(buf);
      buf = "";
    } else buf += ch;
  }
  parts.push(buf);

  return parts
    .map((p) =>
      p
        .trim()
        // bỏ đuôi sắp xếp/opclass/NULLS: "created_at DESC", "email varchar_pattern_ops"
        .replace(/\s+(ASC|DESC)\b/gi, "")
        .replace(/\s+NULLS\s+(FIRST|LAST)\b/gi, "")
        .replace(/\s+\w+_ops\b/gi, "")
        .trim()
        .replace(/^"(.*)"$/, "$1"),
    )
    .filter(Boolean);
}

function menhDeWhere(indexdef) {
  const at = indexdef.search(/\)\s*WHERE\s/i);
  return at === -1 ? "" : indexdef.slice(at + 1);
}

const url = process.env.DATABASE_DIRECT_URL?.trim() || urlFromEnvFile(envFile);
if (!url) {
  if (!asJson)
    console.warn(
      `[db-readiness] BỎ QUA: không có DATABASE_DIRECT_URL (và ${envFile} không có/không khai).`,
    );
  ket(0, { skipped: true, reason: "no-database-url" });
}

const pool = new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 5000 });

let indexes, rlsThieu, grantThua, db;
try {
  const [rIdx, rRls, rGrant, rDb] = await Promise.all([
    pool.query(`SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'`),
    // B. BẤT BIẾN #1 — mọi bảng thường có cột company_id PHẢI bật FORCE RLS.
    pool.query(
      `SELECT c.relname
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
        WHERE c.relkind = 'r'
          AND EXISTS (SELECT 1 FROM pg_attribute a
                       WHERE a.attrelid = c.oid AND a.attname = 'company_id' AND NOT a.attisdropped)
          AND NOT c.relforcerowsecurity
        ORDER BY 1`,
    ),
    // C. BẤT BIẾN #2 — app role KHÔNG được có UPDATE/DELETE trên bảng ledger.
    pool.query(
      `SELECT table_name, privilege_type
         FROM information_schema.role_table_grants
        WHERE grantee = $1
          AND privilege_type IN ('UPDATE','DELETE')
          AND table_name = ANY($2::text[])
        ORDER BY 1, 2`,
      [APP_ROLE, BANG_LEDGER],
    ),
    pool.query(`SELECT current_database() AS db`),
  ]);
  indexes = rIdx.rows;
  rlsThieu = rRls.rows.map((r) => r.relname);
  grantThua = rGrant.rows.map((r) => `${r.table_name}:${r.privilege_type}`);
  db = rDb.rows[0].db;
} catch (err) {
  if (!asJson) console.warn(`[db-readiness] BỎ QUA: không nối được DB (${err.message}).`);
  await pool.end().catch(() => {});
  ket(0, { skipped: true, reason: "unreachable", error: err.message });
}
await pool.end();

// ── Đối chiếu A ────────────────────────────────────────────────────────────────────────────────
const thieuIndex = [];
for (const yc of YEU_CAU_INDEX) {
  const ungVien = indexes.filter((i) => i.tablename === yc.table);
  if (ungVien.length === 0) {
    thieuIndex.push({ ...yc, lyDo: `bảng '${yc.table}' không tồn tại hoặc không có index nào` });
    continue;
  }
  const khop = ungVien.some((i) => {
    const cols = cotCuaIndex(i.indexdef);
    const dungTienTo = yc.leading.every((c, idx) => cols[idx] === c);
    if (!dungTienTo) return false;
    if (!yc.partial) return true;
    return menhDeWhere(i.indexdef).toLowerCase().includes(yc.partial.toLowerCase());
  });
  if (!khop)
    thieuIndex.push({
      ...yc,
      lyDo: `không index nào trên '${yc.table}' dẫn đầu bằng (${yc.leading.join(", ")})${
        yc.partial ? ` kèm WHERE chứa '${yc.partial}'` : ""
      }`,
    });
}

const chiTiet = {
  db,
  index_yeu_cau: YEU_CAU_INDEX.length,
  index_dat: YEU_CAU_INDEX.length - thieuIndex.length,
  index_thieu: thieuIndex,
  rls_khong_force: rlsThieu,
  ledger_grant_thua: grantThua,
  app_role: APP_ROLE,
};

const hong = thieuIndex.length > 0 || rlsThieu.length > 0 || grantThua.length > 0;

if (!hong) {
  if (!asJson) {
    console.log(`[db-readiness] DB "${db}" ✅`);
    console.log(
      `  A. index query nặng §14.3 : ${YEU_CAU_INDEX.length}/${YEU_CAU_INDEX.length} đạt`,
    );
    console.log(`  B. FORCE RLS (BẤT BIẾN #1): 0 bảng có company_id thiếu FORCE`);
    console.log(
      `  C. append-only (BẤT BIẾN #2): 0 grant UPDATE/DELETE cho '${APP_ROLE}' trên ${BANG_LEDGER.length} bảng ledger`,
    );
  }
  ket(0, { ok: true, ...chiTiet });
}

if (!asJson) {
  console.error(`\n[db-readiness] ❌ ĐỎ trên DB "${db}"\n`);
  if (thieuIndex.length) {
    console.error(`A. THIẾU ĐỘ PHỦ INDEX cho query nặng (${thieuIndex.length}):`);
    for (const t of thieuIndex) console.error(`   · ${t.oCheck}\n     → ${t.lyDo}`);
    console.error(
      `   Sửa: thêm migration additive CREATE INDEX IF NOT EXISTS (đánh số tiếp head THẬT).\n` +
        `   Nếu index bị xoá CÓ CHỦ Ý: sửa danh sách trong scripts/check-db-readiness.mjs kèm lý do.\n`,
    );
  }
  if (rlsThieu.length) {
    console.error(
      `B. BẤT BIẾN #1 VỠ — bảng có company_id nhưng KHÔNG FORCE RLS (${rlsThieu.length}):`,
    );
    for (const t of rlsThieu) console.error(`   · ${t}`);
    console.error(
      `   Sửa: ALTER TABLE <t> ENABLE ROW LEVEL SECURITY; ALTER TABLE <t> FORCE ROW LEVEL SECURITY;\n`,
    );
  }
  if (grantThua.length) {
    console.error(
      `C. BẤT BIẾN #2 VỠ — '${APP_ROLE}' có quyền ghi đè trên bảng ledger (${grantThua.length}):`,
    );
    for (const g of grantThua) console.error(`   · ${g}`);
    console.error(`   Sửa: REVOKE UPDATE, DELETE ON <bảng> FROM ${APP_ROLE};\n`);
  }
}
ket(1, { ok: false, ...chiTiet });
