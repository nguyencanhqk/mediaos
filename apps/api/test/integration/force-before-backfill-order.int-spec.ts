import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * GX-4 (g2rls) — CONTRACT TĨNH chống cửa-sổ-rò backfill (CLAUDE §3 / TASKS §2):
 *
 *   "Migration: tạo RLS policy + FORCE RLS TRƯỚC khi backfill company_id (nếu không sẽ có cửa sổ rò rỉ chéo tenant)."
 *
 * Quét MỌI file migration .sql. Với mỗi bảng được CREATE có cột company_id, khẳng định trong CÙNG file:
 *   (1) Có ENABLE + FORCE ROW LEVEL SECURITY cho bảng đó.
 *   (2) Có CREATE POLICY cho bảng đó (ép tenant).
 *   (3) ENABLE/FORCE/POLICY đứng TRƯỚC mọi `UPDATE <table> SET ... company_id` (backfill company_id) — KHÔNG
 *       có cửa sổ ghi/backfill company_id trước khi RLS được FORCE.
 *
 * KHÔNG cần DB (phân tích tĩnh nội dung .sql). Đây là gate "đọc được trong CI mọi lúc", bổ trợ cho
 * rls-coverage-assert (chạy trên DB thật). LƯU Ý: hôm nay KHÔNG bảng company_id nào thiếu FORCE ⇒ không có
 * migration band 0160 mới; test này khẳng định BẤT BIẾN giữ vững trên TOÀN BỘ lịch sử migration.
 */

// tsconfig module=commonjs → dùng __dirname (như src/db/migrate.ts) thay vì import.meta.
// __dirname = apps/api/test/integration → lùi 2 cấp tới apps/api, rồi vào migrations.
const MIGRATIONS_DIR = join(__dirname, "..", "..", "migrations");

interface CreatedTable {
  table: string;
  /** Vị trí ký tự của `CREATE TABLE <table>` trong file (đã chuẩn hoá). */
  createPos: number;
  /** Khối DDL của CREATE TABLE (từ `(` tới `)` cân đối) — để biết bảng có company_id không. */
  hasCompanyId: boolean;
}

/** Chuẩn hoá: bỏ comment dòng `-- ...` + hạ chữ thường để regex ổn định (literal SQL hiếm chứa từ khoá viết thường). */
function stripSqlComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("--");
      return idx >= 0 ? line.slice(0, idx) : line;
    })
    .join("\n");
}

/** Tìm vị trí dấu `)` cân đối mở từ `openParen`. Trả -1 nếu không cân đối. */
function matchParen(s: string, openParen: number): number {
  let depth = 0;
  for (let i = openParen; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function findCreatedTables(sql: string): CreatedTable[] {
  const out: CreatedTable[] = [];
  // CREATE TABLE [IF NOT EXISTS] <name> (
  const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    const table = m[1].toLowerCase();
    const openParen = sql.indexOf("(", m.index + m[0].length - 1);
    const closeParen = matchParen(sql, openParen);
    const body = closeParen > openParen ? sql.slice(openParen, closeParen + 1) : "";
    const hasCompanyId = /\bcompany_id\b/i.test(body);
    out.push({ table, createPos: m.index, hasCompanyId });
  }
  return out;
}

/** Vị trí đầu tiên khớp regex sau `after`; -1 nếu không có. */
function firstPosAfter(sql: string, re: RegExp, after = 0): number {
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    if (m.index >= after) return m.index;
  }
  return -1;
}

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort();
}

describe("GX-4 FORCE-before-backfill order (static migration contract)", () => {
  const files = migrationFiles();

  it("có ít nhất 1 migration để quét (sanity)", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const raw = readFileSync(`${MIGRATIONS_DIR}/${file}`, "utf8");
    const sql = stripSqlComments(raw);
    const created = findCreatedTables(sql).filter((t) => t.hasCompanyId);
    if (created.length === 0) continue; // file không tạo bảng company_id → bỏ qua

    describe(file, () => {
      for (const ct of created) {
        const t = ct.table;
        // Escape không cần (tên bảng [a-z0-9_]).
        const enableRe = new RegExp(`alter\\s+table\\s+(?:only\\s+)?${t}\\s+enable\\s+row\\s+level\\s+security`, "gi");
        const forceRe = new RegExp(`alter\\s+table\\s+(?:only\\s+)?${t}\\s+force\\s+row\\s+level\\s+security`, "gi");
        const policyRe = new RegExp(`create\\s+policy\\s+[a-z0-9_]+\\s+on\\s+${t}\\b`, "gi");
        // Backfill company_id: UPDATE <t> SET ... company_id ... (gán/ghi đè company_id trên bảng vừa tạo).
        const backfillRe = new RegExp(`update\\s+(?:only\\s+)?${t}\\s+set\\b[\\s\\S]*?\\bcompany_id\\b`, "gi");

        describe(`bảng ${t}`, () => {
          it("ENABLE + FORCE RLS tồn tại trong file", () => {
            expect(firstPosAfter(sql, enableRe, ct.createPos), `${file}: thiếu ENABLE RLS cho ${t}`).toBeGreaterThan(ct.createPos);
            expect(firstPosAfter(sql, forceRe, ct.createPos), `${file}: thiếu FORCE RLS cho ${t}`).toBeGreaterThan(ct.createPos);
          });

          it("CREATE POLICY tồn tại sau CREATE TABLE", () => {
            expect(firstPosAfter(sql, policyRe, ct.createPos), `${file}: thiếu CREATE POLICY cho ${t}`).toBeGreaterThan(ct.createPos);
          });

          it("FORCE RLS + POLICY ĐỨNG TRƯỚC mọi backfill company_id (không cửa sổ rò)", () => {
            const forcePos = firstPosAfter(sql, forceRe, ct.createPos);
            const policyPos = firstPosAfter(sql, policyRe, ct.createPos);
            const backfillPos = firstPosAfter(sql, backfillRe, ct.createPos);
            if (backfillPos === -1) return; // không backfill company_id → không có cửa sổ rò
            expect(
              backfillPos,
              `${file}: backfill company_id trên ${t} ĐỨNG TRƯỚC FORCE RLS (cửa sổ rò chéo tenant)`,
            ).toBeGreaterThan(forcePos);
            expect(
              backfillPos,
              `${file}: backfill company_id trên ${t} ĐỨNG TRƯỚC CREATE POLICY (cửa sổ rò chéo tenant)`,
            ).toBeGreaterThan(policyPos);
          });
        });
      }
    });
  }
});
