import fs from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { loadEnv } from "../config/env.schema";

/**
 * db:check — gate tích phân CI cho migration journal.
 *
 * VÌ SAO: drizzle áp migration forward-only theo `migrations/meta/_journal.json`. Nếu journal có GAP
 * idx, TRÙNG tag, hoặc lệch số file .sql, migrator có thể skip/đảo migration trên DB chung ⇒ schema
 * lệch âm thầm (xanh-giả). Bước này migrate lên DB RỖNG rồi kiểm các BẤT BIẾN NỘI TẠI của journal —
 * head idx ĐỌC ĐỘNG từ entries[last].idx (KHÔNG hard-code EXPECTED_HEAD_IDX → không drift khi thêm migration).
 *
 * Logic kiểm journal tách thành hàm THUẦN (parseJournal/assertJournalInvariants/summarizeJournal) để
 * unit-test KHÔNG cần Postgres (xem check.spec.ts). main() lo phần I/O (migrate + đọc file + so .sql).
 */

/** Một entry trong drizzle `_journal.json`. */
export interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

/** Tổng hợp head động của journal. */
export interface JournalSummary {
  headIdx: number;
  tag: string;
  count: number;
}

/** Lỗi vi phạm bất biến journal — phân biệt với lỗi I/O/migrate để main() exit 1 đúng ngữ cảnh. */
export class JournalIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JournalIntegrityError";
  }
}

/**
 * Parse JSON journal → mảng entries. Ném JournalIntegrityError khi JSON hỏng hoặc `entries` không phải mảng.
 * KHÔNG kiểm bất biến ở đây (giữ thuần & tách trách nhiệm) — gọi assertJournalInvariants sau.
 */
export function parseJournal(raw: string): JournalEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const reason = err instanceof Error ? err.message : "unknown";
    throw new JournalIntegrityError(`journal JSON không parse được: ${reason}`);
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray((parsed as { entries?: unknown }).entries)
  ) {
    throw new JournalIntegrityError(
      "journal thiếu mảng `entries` (cấu trúc _journal.json không hợp lệ)",
    );
  }
  return (parsed as { entries: JournalEntry[] }).entries;
}

/**
 * Kiểm BẤT BIẾN forward-only trên entries (hàm thuần, ném JournalIntegrityError khi vi phạm):
 *  - KHÔNG rỗng;
 *  - idx liên tục từ 0, tăng đơn điệu theo thứ tự mảng (entries[k].idx === k) → no-gap, no out-of-order;
 *  - tag DUY NHẤT (no-dup).
 */
export function assertJournalInvariants(entries: readonly JournalEntry[]): void {
  if (entries.length === 0) {
    throw new JournalIntegrityError(
      "journal rỗng — không có migration nào (forward-only cần ≥1 entry)",
    );
  }
  const seenTags = new Set<string>();
  for (let k = 0; k < entries.length; k += 1) {
    const entry = entries[k];
    if (typeof entry?.idx !== "number" || typeof entry?.tag !== "string") {
      throw new JournalIntegrityError(`entry #${k} thiếu idx/tag hợp lệ`);
    }
    if (entry.idx !== k) {
      throw new JournalIntegrityError(
        `journal gap/out-of-order tại vị trí ${k}: expected idx ${k}, gặp idx ${entry.idx} (tag '${entry.tag}') — forward-only yêu cầu idx liên tục từ 0`,
      );
    }
    if (seenTags.has(entry.tag)) {
      throw new JournalIntegrityError(
        `duplicate tag '${entry.tag}' tại idx ${entry.idx} — tag phải duy nhất (trùng = re-applied/conflict)`,
      );
    }
    seenTags.add(entry.tag);
  }
}

/** Tổng hợp head động: headIdx = entries[last].idx (ĐỌC ĐỘNG), tag head, count = số entries. */
export function summarizeJournal(entries: readonly JournalEntry[]): JournalSummary {
  const last = entries[entries.length - 1];
  return { headIdx: last.idx, tag: last.tag, count: entries.length };
}

/** Đếm số file .sql trong thư mục migrations (mỗi entry journal ↔ 1 file áp). */
function countSqlFiles(migrationsFolder: string): number {
  return fs.readdirSync(migrationsFolder).filter((f) => f.endsWith(".sql")).length;
}

async function main(): Promise<void> {
  const env = loadEnv();
  if (!env.DATABASE_DIRECT_URL) {
    throw new Error("DATABASE_DIRECT_URL is required to run db:check.");
  }

  const migrationsFolder = path.join(__dirname, "..", "..", "migrations");

  // 1) Migrate DB rỗng qua kết nối DIRECT (giống migrate.ts: Pool max:1). Lỗi migrate → throw → exit 1.
  const pool = new Pool({ connectionString: env.DATABASE_DIRECT_URL, max: 1 });
  try {
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder });
  } finally {
    await pool.end();
  }

  // 2) Đọc journal + kiểm BẤT BIẾN NỘI TẠI (hàm thuần).
  const journalPath = path.join(migrationsFolder, "meta", "_journal.json");
  const entries = parseJournal(fs.readFileSync(journalPath, "utf8"));
  assertJournalInvariants(entries);
  const summary = summarizeJournal(entries);

  // 3) Đối chiếu số file .sql áp = số entries (journal không lệch file).
  const sqlCount = countSqlFiles(migrationsFolder);
  if (sqlCount !== summary.count) {
    throw new JournalIntegrityError(
      `số file .sql (${sqlCount}) != số entries journal (${summary.count}) — journal/migrations lệch nhau`,
    );
  }

  // head idx ĐỌC ĐỘNG (KHÔNG hằng số chép tay).
  console.log(
    `[db:check] head idx: ${summary.headIdx} (${summary.tag}) — journal OK (forward-only, no-gap, no-dup; ${summary.count} migrations áp)`,
  );
}

main().catch((err) => {
  if (err instanceof JournalIntegrityError) {
    console.error(`[db:check] BẤT BIẾN journal vi phạm: ${err.message}`);
  } else {
    console.error("[db:check] failed:", err);
  }
  process.exit(1);
});
