import { Injectable } from "@nestjs/common";
import { desc, eq, sql } from "drizzle-orm";
import type { TenantTx } from "../../db/db.service";
import { systemJobRuns, type SystemJobRun } from "../../db/schema/system-jobs";

/**
 * S5-FND-JOBS-OBS-1 — SystemJobsRepository (READ-ONLY, `system_job_runs` là nhật ký append-mostly ghi bởi
 * `JobRunLogger`/worker — repository này KHÔNG có method INSERT/UPDATE/DELETE, chỉ SELECT).
 *
 * Mọi method nhận `tx` từ `DatabaseService.withTenant` (BẤT BIẾN #1) — RLS (mig 0475) tự lọc
 * `company_id = GUC OR company_id IS NULL`, repository KHÔNG tự thêm điều kiện company_id (RLS ép ở DB,
 * tránh trùng lặp logic phạm vi 2 nơi).
 *
 * KHÔNG dùng `SELECT DISTINCT ON` (drizzle-orm 0.45 chưa hỗ trợ `.distinctOn()` ở query-builder) — thay
 * bằng 2 bước: `.selectDistinct()` lấy tập job_code rồi query "mới nhất" riêng từng code (N+1, nhưng N =
 * số job_code ĐÃ TỪNG chạy, nhỏ/bounded — KISS hơn raw SQL cho use-case quan sát không hot-path).
 */
@Injectable()
export class SystemJobsRepository {
  /** Tập job_code phân biệt đã có run-row trong phạm vi tenant (RLS ép). */
  async findDistinctJobCodesTx(tx: TenantTx): Promise<string[]> {
    const rows = await tx.selectDistinct({ jobCode: systemJobRuns.jobCode }).from(systemJobRuns);
    return rows.map((r) => r.jobCode);
  }

  /** Hàng MỚI NHẤT (started_at desc) của 1 job_code — `undefined` nếu job_code chưa từng chạy trong phạm vi. */
  async findLatestByJobCodeTx(tx: TenantTx, jobCode: string): Promise<SystemJobRun | undefined> {
    const [row] = await tx
      .select()
      .from(systemJobRuns)
      .where(eq(systemJobRuns.jobCode, jobCode))
      .orderBy(desc(systemJobRuns.startedAt))
      .limit(1);
    return row;
  }

  /** 1 trang lịch sử chạy của 1 job_code, mới nhất trước; `id desc` tie-break ổn định (mẫu file-access-log). */
  async findManyByJobCodeTx(
    tx: TenantTx,
    jobCode: string,
    limit: number,
    offset: number,
  ): Promise<SystemJobRun[]> {
    return tx
      .select()
      .from(systemJobRuns)
      .where(eq(systemJobRuns.jobCode, jobCode))
      .orderBy(desc(systemJobRuns.startedAt), desc(systemJobRuns.id))
      .limit(limit)
      .offset(offset);
  }

  /** Tổng số run-row của 1 job_code trong phạm vi (cho pagination.total). */
  async countByJobCodeTx(tx: TenantTx, jobCode: string): Promise<number> {
    const [row] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(systemJobRuns)
      .where(eq(systemJobRuns.jobCode, jobCode));
    return row?.count ?? 0;
  }
}
