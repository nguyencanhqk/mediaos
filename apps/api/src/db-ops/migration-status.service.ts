import { readFile } from "node:fs/promises";
import path from "node:path";
import { Injectable, Logger } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { type MigrationEntry, type MigrationStatusDto } from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}
interface Journal {
  entries: JournalEntry[];
}

/**
 * MigrationStatusService (🔴 AC-9 P1) — READ-ONLY trạng thái migration. Đọc bảng GLOBAL
 * drizzle.__drizzle_migrations (qua runRaw — bảng global no-RLS, withTenant vô nghĩa) + đối chiếu
 * meta/_journal.json ⇒ applied/pending. KHÔNG chạy migration (không gọi migrate()).
 *
 * drizzle.__drizzle_migrations(created_at bigint) = epoch-ms KHỚP journal.when ⇒ migration applied =
 * tồn tại 1 row created_at = when. (drizzle áp migration đơn điệu theo when; created_at chính là when.)
 */
@Injectable()
export class MigrationStatusService {
  private readonly logger = new Logger(MigrationStatusService.name);

  constructor(private readonly db: DatabaseService) {}

  async getStatus(): Promise<MigrationStatusDto> {
    const journal = await this.readJournal();
    const appliedWhens = await this.readAppliedWhens();

    const entries: MigrationEntry[] = journal.entries
      .slice()
      .sort((a, b) => a.when - b.when)
      .map((j) => {
        const applied = appliedWhens.has(j.when);
        return {
          idx: j.idx,
          tag: j.tag,
          when: j.when,
          applied,
          appliedAt: applied ? new Date(j.when).toISOString() : null,
        };
      });

    const appliedCount = entries.filter((e) => e.applied).length;
    return { entries, appliedCount, pendingCount: entries.length - appliedCount };
  }

  /** Đọc journal từ migrations/meta/_journal.json (cùng folder migrate.ts dùng). */
  private async readJournal(): Promise<Journal> {
    const journalPath = path.join(__dirname, "..", "..", "migrations", "meta", "_journal.json");
    const raw = await readFile(journalPath, "utf-8");
    const parsed = JSON.parse(raw) as Journal;
    return { entries: Array.isArray(parsed.entries) ? parsed.entries : [] };
  }

  /**
   * Đọc set `when` đã áp từ drizzle.__drizzle_migrations.created_at. Bảng GLOBAL (schema drizzle, no-RLS) ⇒
   * runRaw (KHÔNG withTenant). Fail-closed: lỗi đọc ⇒ ném (KHÔNG trả set rỗng giả "tất cả pending").
   */
  private async readAppliedWhens(): Promise<Set<number>> {
    const rows = await this.db.runRaw<{ created_at: string | number }>(
      sql`SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY created_at ASC`,
    );
    return new Set(rows.map((r) => Number(r.created_at)));
  }
}
