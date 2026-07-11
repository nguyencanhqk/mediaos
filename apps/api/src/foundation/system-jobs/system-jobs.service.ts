import { Injectable } from "@nestjs/common";
import {
  systemJobRunViewSchema,
  type SystemJobRunView,
  type SystemJobRunsQuery,
} from "@mediaos/contracts";
import { DatabaseService } from "../../db/db.service";
import type { SystemJobRun } from "../../db/schema/system-jobs";
import { scrubSecrets } from "../../scheduler/job-error-scrubber";
import { SystemJobsRepository } from "./system-jobs.repository";

export interface SystemJobRunsListResult {
  data: SystemJobRunView[];
  meta: { total: number; page: number; limit: number };
}

/**
 * Map row DB → view WHITELIST (mẫu `toFileAccessLogView`, pure fn — unit-testable KHÔNG cần DB). `errorMessage`
 * scrub LẦN NỮA (ngoài scrub write-time trong JobRunLogger) — phòng thủ chiều sâu cho hàng ghi trước khi có
 * scrubber / lỗi ghi trực tiếp ngoài JobRunLogger (BẤT BIẾN #3). `metadata` KHÔNG bao giờ đưa vào view (contract
 * không khai trường này — WHITELIST tại nguồn, `.strip()` loại nếu lọt).
 */
export function toSystemJobRunView(row: SystemJobRun): SystemJobRunView {
  return systemJobRunViewSchema.parse({
    id: row.id,
    jobCode: row.jobCode,
    companyId: row.companyId,
    status: row.status,
    triggeredBy: row.triggeredBy,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    durationMs: row.durationMs ?? null,
    totalItems: row.totalItems ?? null,
    successItems: row.successItems ?? null,
    failedItems: row.failedItems ?? null,
    errorMessage: row.errorMessage ? scrubSecrets(row.errorMessage) : null,
  });
}

/**
 * S5-FND-JOBS-OBS-1 — SystemJobsService (READ-ONLY observability trên `system_job_runs` đã ship ở
 * S2-FND-JOBS-1). KHÔNG method trigger/run — chỉ đọc.
 *
 * BẤT BIẾN #1 — mọi đọc đi qua `db.withTenant(companyId)` (RLS+FORCE mig 0475 ép `company_id = GUC OR
 * company_id IS NULL` — tenant CHỈ thấy run-row CỦA MÌNH + run-row cấp system/global, KHÔNG rò tenant khác).
 */
@Injectable()
export class SystemJobsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: SystemJobsRepository,
  ) {}

  /**
   * GET /foundation/system-jobs — 1 hàng/jobCode = lần chạy MỚI NHẤT trong phạm vi tenant + global.
   * Sắp xếp theo jobCode (thứ tự ổn định, KHÔNG phụ thuộc thời gian chạy gần đây — dễ quét bằng mắt).
   */
  async listSummary(companyId: string): Promise<SystemJobRunView[]> {
    return this.db.withTenant(companyId, async (tx) => {
      const codes = await this.repo.findDistinctJobCodesTx(tx);
      const sortedCodes = [...codes].sort((a, b) => a.localeCompare(b));
      const views: SystemJobRunView[] = [];
      for (const code of sortedCodes) {
        const row = await this.repo.findLatestByJobCodeTx(tx, code);
        if (row) views.push(toSystemJobRunView(row));
      }
      return views;
    });
  }

  /**
   * GET /foundation/system-jobs/:jobName/runs — lịch sử chạy của 1 job (phân trang page-based). jobCode
   * lạ/không tồn tại trong phạm vi tenant → mảng rỗng + total=0 (KHÔNG 404 — đây là trạng thái hợp lệ,
   * KHÔNG lộ liệu job_code có tồn tại ở tenant khác hay không).
   */
  async listRuns(
    companyId: string,
    jobCode: string,
    query: SystemJobRunsQuery,
  ): Promise<SystemJobRunsListResult> {
    const offset = (query.page - 1) * query.limit;
    return this.db.withTenant(companyId, async (tx) => {
      const [rows, total] = await Promise.all([
        this.repo.findManyByJobCodeTx(tx, jobCode, query.limit, offset),
        this.repo.countByJobCodeTx(tx, jobCode),
      ]);
      return {
        data: rows.map((row) => toSystemJobRunView(row)),
        meta: { total, page: query.page, limit: query.limit },
      };
    });
  }
}
