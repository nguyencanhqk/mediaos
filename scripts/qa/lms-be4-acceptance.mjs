#!/usr/bin/env node
/**
 * S5-LMS-BE-4 §6 — nghiệm thu tay phía LMS (bù việc apps/lms KHÔNG vào diff PR: .gitignore ignore
 * /apps/lms/ ⇒ security-reviewer/silent-failure-hunter/CI đều không nhìn thấy bản vá đó).
 *
 * Chứng minh nhánh `deactivated` đã IDEMPOTENT:
 *   1) active:true   → created=1                          (tạo account rác CÓ KIỂM SOÁT)
 *   2) active:false  → deactivated=1 + disabled_at NOT NULL (counter đúng KHÔNG chứng minh đã khoá thật)
 *   3) active:false  → deactivated=0, alreadyDisabled=1, updated_at KHÔNG đổi so với (2)
 *   4) dọn account rác
 *
 * ⛔ CHỈ dùng email tổng hợp TLD `.invalid` (RFC 2606 — không thể trùng người thật). CẤM chạy trên
 * tài khoản nhân viên: nhánh active:false XOÁ SẠCH SESSION + XÁO MẬT KHẨU, LMS PROD có 36 người đang học.
 *
 * Token đọc từ .env (BẤT BIẾN #3 — KHÔNG dán vào dòng lệnh/history shell).
 *
 * Chạy:  node scripts/qa/lms-be4-acceptance.mjs
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const LMS_URL = process.env.LMS_BASE_URL || "http://localhost:3400";
const DB_PATH = join(ROOT, "apps", "lms", "data", "app.db");
const EMAIL = `qa-be4-${new Date().toISOString().slice(0, 10)}@funtime.invalid`;

function readToken() {
  if (process.env.LMS_SYNC_TOKEN) return process.env.LMS_SYNC_TOKEN;
  const line = readFileSync(join(ROOT, ".env"), "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith("LMS_SYNC_TOKEN="));
  if (!line) throw new Error("Không tìm thấy LMS_SYNC_TOKEN trong .env");
  return line.slice("LMS_SYNC_TOKEN=".length).trim();
}

async function sync(token, active) {
  const res = await fetch(`${LMS_URL}/api/admin/sync-users`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ users: [{ email: EMAIL, name: "QA BE-4", active }] }),
  });
  if (!res.ok) throw new Error(`LMS trả HTTP ${res.status}`);
  return res.json();
}

function openDb() {
  const require = createRequire(join(ROOT, "apps", "lms", "package.json"));
  const Database = require("better-sqlite3");
  return new Database(DB_PATH, { readonly: true });
}

function row(db) {
  return db.prepare("SELECT id, disabled_at, updated_at FROM users WHERE email = ?").get(EMAIL);
}

const results = [];
function check(label, ok, detail) {
  results.push({ label, ok, detail });
  console.log(`${ok ? "  ✅" : "  ❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}

const token = readToken();
console.log(`LMS   : ${LMS_URL}`);
console.log(`Email : ${EMAIL}  (TLD .invalid — không thể trùng người thật)\n`);

// ── Bước 1: tạo ──
console.log("Bước 1 — active:true (tạo account QA)");
const s1 = await sync(token, true);
check("created = 1", s1.summary.created === 1, JSON.stringify(s1.summary));

// ── Bước 2: khoá lần đầu ──
console.log("\nBước 2 — active:false (khoá lần đầu)");
const s2 = await sync(token, false);
check("deactivated = 1", s2.summary.deactivated === 1, JSON.stringify(s2.summary));

let db = openDb();
const r2 = row(db);
db.close();
check(
  "disabled_at NOT NULL (đã khoá THẬT, không chỉ đúng counter)",
  r2?.disabled_at != null,
  `disabled_at=${r2?.disabled_at}`,
);

// ── Bước 3: khoá lại — ĐÂY LÀ ĐIỂM CỦA CẢ WO ──
console.log("\nBước 3 — active:false LẦN NỮA (phải IDEMPOTENT)");
const s3 = await sync(token, false);
check("deactivated = 0", s3.summary.deactivated === 0, JSON.stringify(s3.summary));
check("alreadyDisabled = 1 (counter hợp đồng mới)", s3.summary.alreadyDisabled === 1);

db = openDb();
const r3 = row(db);
db.close();
check(
  "updated_at KHÔNG đổi (không ghi lại, không scryptSync mỗi nhịp)",
  r3?.updated_at === r2?.updated_at,
  `${r2?.updated_at} → ${r3?.updated_at}`,
);

// ── Bất biến tổng (thứ MediaOS dựa vào để phát hiện drift shape) ──
const sum = (s) => Object.values(s).reduce((a, b) => a + b, 0);
check(
  "bất biến tổng bước 3 === users.length (1)",
  sum(s3.summary) === 1,
  JSON.stringify(s3.summary),
);

// ── Bước 4: dọn ──
console.log("\nBước 4 — dọn account rác");
const require = createRequire(join(ROOT, "apps", "lms", "package.json"));
const Database = require("better-sqlite3");
const w = new Database(DB_PATH);
w.prepare("DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE email = ?)").run(EMAIL);
const del = w.prepare("DELETE FROM users WHERE email = ?").run(EMAIL);
w.close();
check("đã xoá account QA khỏi PROD", del.changes === 1, `${del.changes} dòng`);

const failed = results.filter((r) => !r.ok);
console.log(
  `\n${failed.length === 0 ? "✅ NGHIỆM THU PASS" : `❌ FAIL ${failed.length}/${results.length}`}`,
);
process.exit(failed.length === 0 ? 0 : 1);
