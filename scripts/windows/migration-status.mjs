// migration-status.mjs — đo TỒN ĐỌNG migration giữa repo và DB (S5-DEVOPS-DEPLOYMIG-1).
//
// VÌ SAO TỒN TẠI: `m prod-update` từng build + restart mà KHÔNG migrate ⇒ dist mới chạy trên schema cũ,
// lỗi chỉ lộ ra ở job nền dưới dạng log rác (sự cố PROD 2026-07-24: 190/196 migration, thiếu 0511
// ⇒ SYSTEM_JOB_RUNS_RETENTION Failed mỗi nhịp, api.err.log phình 149 MB).
//
// CHỈ ĐỌC: đúng một câu SELECT trên drizzle.__drizzle_migrations. KHÔNG DDL, KHÔNG DML, KHÔNG migrate.
//
// Cách dùng:
//   node scripts/windows/migration-status.mjs            # người đọc
//   node scripts/windows/migration-status.mjs --json     # 1 dòng JSON ASCII (mediaos.ps1 dùng)
//   node scripts/windows/migration-status.mjs --self-test # kiểm hàm thuần, KHÔNG cần DB
//
// Exit code:  0 = đo được (kể cả có tồn đọng)  ·  2 = KHÔNG đo được (thiếu env / DB lỗi / journal hỏng)
//             1 = --self-test FAIL
// Người gọi PHẢI fail-closed ở exit 2 — "không biết" khác "không có gì tồn đọng".
//
// Mọi chuỗi IN RA đều ASCII thuần (JSON escape \uXXXX) — Windows PowerShell 5.1 decode stdout của native
// command theo codepage OEM, chữ có dấu sẽ thành mojibake và làm hỏng ConvertFrom-Json.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const MIGRATIONS_DIR = path.join(REPO_ROOT, "apps", "api", "migrations");
const JOURNAL_PATH = path.join(MIGRATIONS_DIR, "meta", "_journal.json");

/** Lỗi "không đo được" — tách khỏi lỗi lập trình để main() trả đúng exit 2. */
export class MigrationStatusError extends Error {}

// ── Journal (nguồn: apps/api/migrations/meta/_journal.json) ────────────────────────────────

/**
 * Parse journal → mảng entry {idx, when, tag}. Ném MigrationStatusError khi JSON hỏng / thiếu entries.
 * KHÔNG kiểm bất biến forward-only ở đây — đó là việc của `pnpm --filter @mediaos/api db:check` (CI gate).
 */
export function parseJournalEntries(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new MigrationStatusError(`journal JSON khong parse duoc: ${err.message}`);
  }
  const entries = parsed?.entries;
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new MigrationStatusError("journal thieu mang `entries` khong rong");
  }
  for (const e of entries) {
    if (typeof e?.when !== "number" || typeof e?.tag !== "string") {
      throw new MigrationStatusError("journal co entry thieu when/tag hop le");
    }
  }
  return entries;
}

/**
 * Tồn đọng theo ĐÚNG luật của drizzle-orm 0.45 (pg-core/dialect.cjs migrate()):
 * nó lấy row created_at LỚN NHẤT rồi áp mọi migration có `folderMillis` > giá trị đó
 * (folderMillis = `when` của journal). Bảng chưa có ⇒ lastAppliedMillis = null ⇒ tồn đọng TẤT CẢ.
 *
 * `appliedRowCount` chỉ dùng làm PHÉP CHÉO: lệch = DB từng migrate ở nhánh khác (journal/DB không cùng gốc).
 */
export function computePending(entries, lastAppliedMillis, appliedRowCount) {
  const pending =
    lastAppliedMillis === null || lastAppliedMillis === undefined
      ? entries.slice()
      : entries.filter((e) => e.when > lastAppliedMillis);
  const expectedApplied = entries.length - pending.length;
  const skew =
    typeof appliedRowCount === "number" && appliedRowCount !== expectedApplied
      ? `DB co ${appliedRowCount} row __drizzle_migrations nhung journal chi khop ${expectedApplied} entry da ap`
      : null;
  return {
    journalCount: entries.length,
    appliedCount: expectedApplied,
    pendingCount: pending.length,
    pendingTags: pending.map((e) => e.tag),
    firstPendingTag: pending.length > 0 ? pending[0].tag : null,
    skew,
  };
}

// ── Quét câu lệnh CONTRACT (REVOKE/DROP) trong lô tồn đọng ─────────────────────────────────

/**
 * Xoá block comment và line comment khỏi 1 dòng SQL, GIỮ NGUYÊN độ dài dòng (trả về dòng đã cắt đuôi).
 * Đơn giản có chủ đích: `.sql` của repo là DDL phẳng, không có `--` nằm trong chuỗi nhiều dòng.
 */
export function stripComments(line) {
  const noBlock = line.replace(/\/\*[\s\S]*?\*\//g, " ");
  const dash = noBlock.indexOf("--");
  return dash === -1 ? noBlock : noBlock.slice(0, dash);
}

/**
 * Các khoảng nằm TRONG chuỗi nháy đơn của 1 dòng (đã xử lý escape '' của SQL).
 * BẮT BUỘC có: migration repo này viết prose tiếng Viet lan REVOKE/DROP trong RAISE EXCEPTION '...'
 * (vd mig 0510) — coi chung la cau lenh contract = bao dong gia + keo ky tu co dau vao JSON.
 */
function quotedRanges(line) {
  const ranges = [];
  let start = -1;
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] !== "'") continue;
    if (start === -1) {
      start = i;
    } else if (line[i + 1] === "'") {
      i += 1; // '' = nháy đơn escape, vẫn trong chuỗi
    } else {
      ranges.push([start, i]);
      start = -1;
    }
  }
  if (start !== -1) ranges.push([start, line.length]); // chuỗi chưa đóng (dòng bị cắt)
  return ranges;
}

function isInsideQuotes(ranges, index) {
  return ranges.some(([a, b]) => index >= a && index <= b);
}

// Hai rổ, chia theo CÂU HỎI THẬT của bước này: "áp xong mà dist CŨ vẫn đang chạy thì có vỡ không?"
//
// contract (HỎI người) — gỡ hẳn thứ dist cũ có thể còn dùng, KHÔNG dựng lại trong cùng file:
//   REVOKE (dist cũ mất quyền ⇒ 42501 ngay) · DROP TABLE/COLUMN/SCHEMA/TYPE/SEQUENCE/DATABASE (mất dữ liệu
//   hoặc mất đối tượng dist cũ còn query). `DROP COLUMN` giữ diện contract KỂ CẢ có IF EXISTS — mất dữ liệu thật.
//
// Nhóm "dựng-lại" (DROP ... rồi CREATE ... ngay trong cùng migration, chạy trong MỘT transaction của drizzle):
//   CONSTRAINT · POLICY · INDEX · TRIGGER · FUNCTION · VIEW. Đây là thành ngữ khắp repo (DROP CONSTRAINT
//   IF EXISTS + ADD CONSTRAINT của union CHECK, DROP POLICY IF EXISTS + CREATE POLICY...). Có `IF EXISTS`
//   ⇒ routine (chỉ in ra); thiếu `IF EXISTS` ⇒ tác giả khẳng định nó ĐANG tồn tại và bị gỡ ⇒ contract.
//   Vì sao không nhét hết vào diện hỏi: deploy nào cũng hỏi ⇒ người gõ "MIGRATE" theo phản xạ ⇒ cảnh báo
//   mất giá trị đúng lúc cần nhất (một REVOKE thật lẫn giữa 40 dòng dựng-lại).
const RECREATE_SEVERITY = (m) => (m[1] ? "routine" : "contract");
const PATTERNS = [
  { kind: "REVOKE", re: /\bREVOKE\b/gi, severity: "contract" },
  { kind: "DROP TABLE", re: /\bDROP\s+TABLE\b/gi, severity: "contract" },
  { kind: "DROP COLUMN", re: /\bDROP\s+COLUMN\b/gi, severity: "contract" },
  { kind: "DROP SCHEMA", re: /\bDROP\s+SCHEMA\b/gi, severity: "contract" },
  { kind: "DROP TYPE", re: /\bDROP\s+TYPE\b/gi, severity: "contract" },
  { kind: "DROP SEQUENCE", re: /\bDROP\s+SEQUENCE\b/gi, severity: "contract" },
  { kind: "DROP DATABASE", re: /\bDROP\s+DATABASE\b/gi, severity: "contract" },
  {
    kind: "DROP CONSTRAINT",
    re: /\bDROP\s+CONSTRAINT\b(\s+IF\s+EXISTS\b)?/gi,
    severity: RECREATE_SEVERITY,
  },
  {
    kind: "DROP POLICY",
    re: /\bDROP\s+POLICY\b(\s+IF\s+EXISTS\b)?/gi,
    severity: RECREATE_SEVERITY,
  },
  {
    kind: "DROP TRIGGER",
    re: /\bDROP\s+TRIGGER\b(\s+IF\s+EXISTS\b)?/gi,
    severity: RECREATE_SEVERITY,
  },
  {
    kind: "DROP FUNCTION",
    re: /\bDROP\s+FUNCTION\b(\s+IF\s+EXISTS\b)?/gi,
    severity: RECREATE_SEVERITY,
  },
  {
    kind: "DROP INDEX",
    re: /\bDROP\s+INDEX\b(\s+(?:CONCURRENTLY\s+)?IF\s+EXISTS\b)?/gi,
    severity: RECREATE_SEVERITY,
  },
  {
    kind: "DROP VIEW",
    re: /\bDROP\s+(?:MATERIALIZED\s+)?VIEW\b(\s+IF\s+EXISTS\b)?/gi,
    severity: RECREATE_SEVERITY,
  },
];

const SNIPPET_MAX = 110;

/** Rút gọn + ép ASCII cho snippet (phòng khi DDL thật có ký tự lạ trong tên định danh). */
function toAsciiSnippet(text) {
  const flat = text.trim().replace(/\s+/g, " ");
  const cut = flat.length > SNIPPET_MAX ? `${flat.slice(0, SNIPPET_MAX)}...` : flat;
  return cut.replace(/[^\x20-\x7E]/g, "?");
}

/**
 * Quét 1 file .sql → danh sách {kind, severity, line, snippet}.
 * Quét THEO DÒNG, bỏ comment + bỏ mọi match nằm trong chuỗi nháy đơn.
 * Đánh đổi đã biết: DDL động `EXECUTE 'DROP ...'` thành âm tính giả — chấp nhận vì trong repo này
 * khối DO $$ là assertion, DDL thật nằm ở top-level.
 */
export function scanContractStatements(sql) {
  const findings = [];
  const lines = sql.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const code = stripComments(lines[i]);
    if (!code.trim()) continue;
    const quoted = quotedRanges(code);
    for (const p of PATTERNS) {
      p.re.lastIndex = 0;
      let m;
      while ((m = p.re.exec(code)) !== null) {
        if (isInsideQuotes(quoted, m.index)) continue;
        findings.push({
          kind: p.kind,
          severity: typeof p.severity === "function" ? p.severity(m) : p.severity,
          line: i + 1,
          snippet: toAsciiSnippet(code),
        });
      }
    }
  }
  return findings;
}

/** Quét toàn bộ lô tồn đọng → [{tag, kind, severity, line, snippet}] (file thiếu = báo lỗi, không im lặng). */
function scanPendingBatch(pendingTags) {
  const out = [];
  for (const tag of pendingTags) {
    const file = path.join(MIGRATIONS_DIR, `${tag}.sql`);
    if (!fs.existsSync(file)) {
      throw new MigrationStatusError(
        `thieu file migration ${tag}.sql (journal va thu muc lech nhau)`,
      );
    }
    for (const f of scanContractStatements(fs.readFileSync(file, "utf8"))) {
      out.push({ tag, ...f });
    }
  }
  return out;
}

// ── DB ─────────────────────────────────────────────────────────────────────────────────────

export function maskUrl(url) {
  return String(url).replace(/:\/\/([^:/@]+):[^@]*@/, "://$1:***@");
}

export function dbNameFromUrl(url) {
  const noQuery = String(url).split("?")[0];
  return noQuery.slice(noQuery.lastIndexOf("/") + 1) || "(?)";
}

/** SELECT duy nhất: bảng drizzle chưa có ⇒ coi như CHƯA áp gì (đúng hành vi migrator lần đầu). */
async function queryApplied(url) {
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 10000 });
  try {
    await client.connect();
  } catch (err) {
    // Node happy-eyeballs gói lỗi vào AggregateError với message RỖNG ⇒ "khong ket noi duoc DB: " trống trơn,
    // người vận hành không biết vì sao. Gộp code của từng lỗi con làm lý do.
    const nested = Array.isArray(err?.errors)
      ? err.errors
          .map((e) => e?.code || e?.message)
          .filter(Boolean)
          .join(", ")
      : "";
    const reason = err?.message || nested || err?.code || "khong ro nguyen nhan";
    throw new MigrationStatusError(`khong ket noi duoc DB: ${reason}`);
  }
  try {
    const present = await client.query(
      "select to_regclass('drizzle.__drizzle_migrations') is not null as ok",
    );
    if (!present.rows[0]?.ok) return { lastAppliedMillis: null, appliedRowCount: 0 };
    const r = await client.query(
      "select count(*)::int as rows, max(created_at) as last_millis from drizzle.__drizzle_migrations",
    );
    const last = r.rows[0]?.last_millis;
    return {
      lastAppliedMillis: last === null || last === undefined ? null : Number(last),
      appliedRowCount: r.rows[0]?.rows ?? 0,
    };
  } catch (err) {
    throw new MigrationStatusError(`doc drizzle.__drizzle_migrations that bai: ${err.message}`);
  } finally {
    await client.end().catch(() => {});
  }
}

async function collectStatus() {
  const url = process.env.DATABASE_DIRECT_URL;
  if (!url) {
    throw new MigrationStatusError(
      "thieu DATABASE_DIRECT_URL trong moi truong (nap .env goc repo truoc khi goi)",
    );
  }
  const entries = parseJournalEntries(fs.readFileSync(JOURNAL_PATH, "utf8"));
  const { lastAppliedMillis, appliedRowCount } = await queryApplied(url);
  const base = computePending(entries, lastAppliedMillis, appliedRowCount);
  const findings = scanPendingBatch(base.pendingTags);
  const contract = findings.filter((f) => f.severity === "contract");
  const routine = findings.filter((f) => f.severity === "routine");
  return {
    ok: true,
    target: maskUrl(url),
    db: dbNameFromUrl(url),
    headTag: entries[entries.length - 1].tag,
    ...base,
    contractCount: contract.length,
    contract,
    routineCount: routine.length,
    routine,
  };
}

// ── Output ─────────────────────────────────────────────────────────────────────────────────

/** Mọi ký tự ngoài ASCII (dựng qua RegExp() để escape nằm trong CHUỖI, khỏi lệ thuộc encoding file). */
const NON_ASCII = new RegExp("[^\\x00-\\x7F]", "g");

/** JSON 1 dòng, ASCII thuần (escape \\uXXXX) — an toàn qua stdout của Windows PowerShell 5.1. */
function printJson(obj) {
  const ascii = JSON.stringify(obj).replace(NON_ASCII, (c) => {
    return "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0");
  });
  process.stdout.write(ascii + "\n");
}

function printHuman(s) {
  console.log(`DB       : ${s.target}`);
  console.log(`migration: ${s.appliedCount}/${s.journalCount} da ap (head repo: ${s.headTag})`);
  if (s.skew) console.log(`SKEW     : ${s.skew}`);
  if (s.pendingCount === 0) {
    console.log("ton dong : 0 - schema o head");
    return;
  }
  console.log(`ton dong : ${s.pendingCount} - dau tien chua ap: ${s.firstPendingTag}`);
  for (const tag of s.pendingTags) console.log(`           - ${tag}`);
  if (s.contractCount > 0) {
    console.log(`CONTRACT : ${s.contractCount} cau lenh REVOKE/DROP can nguoi xac nhan:`);
    for (const c of s.contract)
      console.log(`           ${c.tag}:${c.line} [${c.kind}] ${c.snippet}`);
  }
  if (s.routineCount > 0)
    console.log(`routine  : ${s.routineCount} DROP ... IF EXISTS (re-create, khong hoi)`);
}

// ── Self-test (hàm thuần, KHÔNG cần Postgres) ──────────────────────────────────────────────

const ASSERT_GROUPS = 11;

function selfTest() {
  const fails = [];
  const check = (name, cond) => {
    if (!cond) fails.push(name);
  };
  const J = [
    { idx: 0, when: 100, tag: "0000_a" },
    { idx: 1, when: 200, tag: "0001_b" },
    { idx: 2, when: 300, tag: "0002_c" },
  ];

  // 1) DB rỗng (chưa có bảng drizzle) ⇒ tồn đọng TẤT CẢ.
  const empty = computePending(J, null, 0);
  check("empty-db-all-pending", empty.pendingCount === 3 && empty.firstPendingTag === "0000_a");
  check("empty-db-no-skew", empty.skew === null);

  // 2) Áp tới giữa ⇒ chỉ phần `when` LỚN HƠN mới là tồn đọng (đúng luật drizzle).
  const mid = computePending(J, 200, 2);
  check("mid-pending-count", mid.pendingCount === 1 && mid.firstPendingTag === "0002_c");
  check("mid-applied-count", mid.appliedCount === 2 && mid.skew === null);

  // 3) Ở head ⇒ 0 tồn đọng.
  const head = computePending(J, 300, 3);
  check("head-zero-pending", head.pendingCount === 0 && head.firstPendingTag === null);

  // 4) Phép chéo: số row DB không khớp số entry đã áp ⇒ báo SKEW (DB từng migrate ở nhánh khác).
  check("skew-detected", computePending(J, 200, 5).skew !== null);

  // 5) Comment KHÔNG phải câu lệnh (mig 0510 nói về REVOKE trong prose suốt phần đầu file).
  check(
    "comment-revoke-ignored",
    scanContractStatements("-- REVOKE DELETE ON x FROM y;").length === 0,
  );
  check(
    "block-comment-ignored",
    scanContractStatements("/* DROP TABLE users; */ SELECT 1;").length === 0,
  );

  // 6) Chuỗi nháy đơn KHÔNG phải câu lệnh (RAISE EXCEPTION '... sau REVOKE ...' của mig 0510).
  check(
    "quoted-revoke-ignored",
    scanContractStatements("  RAISE EXCEPTION '[0510] con DELETE sau REVOKE - vo bat bien';")
      .length === 0,
  );
  check(
    "escaped-quote-handled",
    scanContractStatements("  RAISE NOTICE 'it''s ok: DROP TABLE t';").length === 0,
  );

  // 7) Câu lệnh THẬT ⇒ contract.
  const revoke = scanContractStatements("REVOKE DELETE ON org_units, projects FROM mediaos_app;");
  check("real-revoke-contract", revoke.length === 1 && revoke[0].severity === "contract");
  const dropCol = scanContractStatements("ALTER TABLE employees\n  DROP COLUMN IF EXISTS salary;");
  check(
    "drop-column-contract-even-if-exists",
    dropCol.length === 1 && dropCol[0].severity === "contract" && dropCol[0].line === 2,
  );
  check(
    "drop-table-contract",
    scanContractStatements("DROP TABLE legacy_media;")[0]?.severity === "contract",
  );

  // 8) Thành ngữ dựng-lại ⇒ routine (KHÔNG hỏi, kẻo deploy nào cũng hỏi rồi bị bấm qua theo phản xạ).
  //    Mẫu thật trong repo: union CHECK (mig 0525) + tenant_isolation policy (mig 0526).
  const idem = scanContractStatements(
    [
      "ALTER TABLE dashboard_widgets DROP CONSTRAINT IF EXISTS chk_module_code;",
      "DROP POLICY IF EXISTS tenant_isolation ON task_templates;",
      "DROP INDEX IF EXISTS i;",
      "DROP TRIGGER IF EXISTS tg ON t;",
      "DROP FUNCTION IF EXISTS f(uuid);",
      "DROP MATERIALIZED VIEW IF EXISTS mv_task_status;",
    ].join("\n"),
  );
  check("recreate-drops-routine", idem.length === 6 && idem.every((f) => f.severity === "routine"));
  check(
    "drop-policy-without-if-exists-contract",
    scanContractStatements("DROP POLICY p ON t;")[0]?.severity === "contract",
  );
  check(
    "drop-constraint-without-if-exists-contract",
    scanContractStatements("ALTER TABLE t DROP CONSTRAINT chk_x;")[0]?.severity === "contract",
  );

  // 9) DDL lành tính ⇒ không báo gì.
  check(
    "benign-ddl-clean",
    scanContractStatements("CREATE TABLE t (id uuid);\nGRANT SELECT ON t TO mediaos_app;")
      .length === 0,
  );

  // 10) Journal hỏng ⇒ MigrationStatusError (không trả số giả).
  let threw = false;
  try {
    parseJournalEntries('{"entries":[]}');
  } catch (e) {
    threw = e instanceof MigrationStatusError;
  }
  check("empty-journal-throws", threw);

  // 11) Che mật khẩu URL. Phần mật khẩu GHÉP CHUỖI theo CLAUDE.md §5 (fixture giống-secret không viết
  //     literal — literal high-entropy trip rule gitleaks generic-api-key ⇒ đỏ oan CI/PR).
  const fakePw = ["pw", "placeholder"].join("-");
  check(
    "mask-url",
    maskUrl(`postgres://mediaos:${fakePw}@localhost:5432/mediaos`) ===
      "postgres://mediaos:***@localhost:5432/mediaos",
  );
  check(
    "db-name",
    dbNameFromUrl("postgres://u:p@h:5432/mediaos_dev?sslmode=disable") === "mediaos_dev",
  );

  if (fails.length > 0) {
    console.error(`[migration-status] SELF-TEST FAIL (${fails.length}): ${fails.join(", ")}`);
    return 1;
  }
  console.log(`[migration-status] SELF-TEST PASS (${ASSERT_GROUPS} nhom assert)`);
  return 0;
}

// ── main ───────────────────────────────────────────────────────────────────────────────────

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--self-test")) return selfTest();

  const asJson = argv.includes("--json");
  try {
    const status = await collectStatus();
    if (asJson) printJson(status);
    else printHuman(status);
    return 0;
  } catch (err) {
    const message =
      err instanceof MigrationStatusError ? err.message : `loi khong mong doi: ${err.message}`;
    if (asJson) printJson({ ok: false, error: message });
    else console.error(`[migration-status] ${message}`);
    return 2; // fail-closed: nguoi goi PHAI coi "khong do duoc" khac "khong ton dong"
  }
}

// Chỉ chạy khi được gọi TRỰC TIẾP — để import lấy hàm thuần (self-test/tooling khác) không kích side-effect.
const isDirectRun =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      console.error(`[migration-status] crash: ${err?.stack || err}`);
      process.exitCode = 2;
    },
  );
}
