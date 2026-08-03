import { Injectable, Logger } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { DatabaseService } from "../db/db.service";
import {
  SystemJobHandler,
  type JobHandler,
  type JobRunContext,
  type JobRunResult,
} from "../scheduler/job-handler";
import { ChatDerivedRoomsSyncService, type ChatSyncActor } from "./chat-derived-rooms-sync.service";
import { CHAT_ROOM_ELIGIBLE_ORG_UNIT_TYPES } from "./chat-derived-rooms-predicates";

/** jobCode DUY NHẤT toàn hệ — khoá `system_job_locks` + `system_job_runs.job_code`. */
export const CHAT_DERIVED_ROOMS_RECONCILE_JOB_CODE = "CHAT_DERIVED_ROOMS_RECONCILE";

/** Trạng thái dự án ĐÃ KẾT THÚC — phòng của chúng phải được đóng. Mirror `TERMINAL_STATUSES` của TASK. */
const TERMINAL_PROJECT_STATUSES = ["Completed", "Cancelled", "Archived"] as const;

interface ScanRow {
  id: string;
  name: string;
}

const JOB_ACTOR: ChatSyncActor = { kind: "job" };

/**
 * S7-CHAT-BE-5 — job đối soát phòng dẫn xuất (SPEC-15 §13.3 "định kỳ").
 *
 * Hook thời-gian-thực đã lo 99% ca; job này là **lưới an toàn** cho phần còn lại: hàng ghi thẳng DB
 * (import/script), một nhánh CẤP bị SAVEPOINT nuốt, hoặc company có sẵn dữ liệu TRƯỚC khi tính năng ra
 * đời. Nó KHÔNG phải đường chính — đường THU HỒI chạy trong tx nguồn, cửa sổ lệch = 0.
 *
 * ══ Ba pha, và vì sao KHÔNG gộp thành một `withTenant` như `GoalReconciliationJobHandler` ══
 * Goal không cấp mã gì cả nên một tx bọc trọn vòng là an toàn cho nó. Job này PHẢI cấp `room_code`, và
 * `SequenceService.nextCode()` tự mở `withTenant` bên trong ⇒ không lồng được vào tx nghiệp vụ (owner
 * chốt 02/08, điểm 3). Gộp lại là treo trên PgBouncer transaction-mode.
 *
 *   Pha 1 — SCAN (tx#1, ĐÓNG trước khi cấp mã): 3 danh sách id thuần. KHÔNG materialize danh sách thành
 *           viên — đó là việc của Pha 3 và nó đọc-mới TẠI CHỖ GHI.
 *   Pha 2 — ALLOCATE + INSERT (ngoài tx, mỗi phòng một tx riêng, best-effort per-item): lỗi một phòng
 *           không chặn phòng còn lại.
 *   Pha 3 — DIFF THÀNH VIÊN (tx#2 mới, set-based): hai câu SQL, vị từ tái kiểm ngay trong `WHERE`.
 *
 * Idempotent theo hợp đồng `JobHandler`: chạy lại ngay lập tức trên cùng dữ liệu ⇒ Pha 1 thấy ít việc
 * hơn (phòng đã tạo không xuất hiện lại), Pha 3 trả 0/0.
 *
 * Đăng ký: `@SystemJobHandler()` + khai trong `providers` của `ChatModule`. SchedulerModule
 * (DiscoveryService) gom mọi provider mang metadata đó — ChatModule KHÔNG import SchedulerModule.
 */
@Injectable()
@SystemJobHandler()
export class ChatDerivedRoomsReconcileJobHandler implements JobHandler {
  readonly jobCode = CHAT_DERIVED_ROOMS_RECONCILE_JOB_CODE;
  private readonly logger = new Logger(ChatDerivedRoomsReconcileJobHandler.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly sync: ChatDerivedRoomsSyncService,
  ) {}

  async run(ctx: JobRunContext): Promise<JobRunResult> {
    const scan = await this.scanTx(ctx.companyId);

    let created = 0;
    let failed = 0;
    for (const unit of scan.orgUnitsMissingRoom) {
      const ok = await this.ensure(() =>
        this.sync.ensureOrgUnitRoom(ctx.companyId, unit.id, unit.name, JOB_ACTOR),
      );
      if (ok) created++;
      else failed++;
    }
    for (const project of scan.projectsMissingRoom) {
      const ok = await this.ensure(() =>
        this.sync.ensureProjectRoom(ctx.companyId, project.id, project.name, JOB_ACTOR),
      );
      if (ok) created++;
      else failed++;
    }
    let archived = 0;
    for (const project of scan.projectsNeedingArchive) {
      const ok = await this.ensure(() =>
        this.sync.archiveProjectRoom(ctx.companyId, project.id, JOB_ACTOR),
      );
      if (ok) archived++;
      else failed++;
    }

    // Pha 3 — transaction MỚI (Pha 1 đã đóng, Pha 2 chạy ngoài tx) ⇒ không lồng.
    const diff = await this.db.withTenant(ctx.companyId, (tx) =>
      this.sync.reconcileMembershipTx(tx, ctx.companyId, JOB_ACTOR),
    );

    const total = created + archived + diff.joined + diff.left;
    if (total > 0) {
      this.logger.warn(
        `${this.jobCode} tenant=${ctx.companyId}: LỆCH đã sửa — phòng mới ${created}, đóng ${archived}, vào ${diff.joined}, rời ${diff.left}.`,
      );
    } else {
      this.logger.debug(`${this.jobCode} tenant=${ctx.companyId}: không lệch.`);
    }

    return {
      total: total + failed,
      success: total,
      failed,
      metadata: {
        roomsCreated: created,
        roomsArchived: archived,
        membersJoined: diff.joined,
        membersLeft: diff.left,
      },
    };
  }

  /**
   * Pha 1 — SCAN. Một `withTenant` DUY NHẤT, ĐÓNG trước khi Pha 2 cấp mã.
   *
   * Đọc thẳng bảng `org_units`/`projects` bằng SQL thay vì qua `OrgRepository`/`ProjectsRepository`: bơm
   * hai class đó vào đây sẽ kéo `ChatModule → OrgModule/TasksModule`, trong khi hai module kia đã import
   * `ChatModule` cho hook ⇒ cycle. Chiều phụ thuộc phải MỘT HƯỚNG.
   */
  private async scanTx(companyId: string): Promise<{
    orgUnitsMissingRoom: ScanRow[];
    projectsMissingRoom: ScanRow[];
    projectsNeedingArchive: ScanRow[];
  }> {
    return this.db.withTenant(companyId, async (tx) => {
      const eligibleTypes = sql.join(
        CHAT_ROOM_ELIGIBLE_ORG_UNIT_TYPES.map((t) => sql`${t}`),
        sql`, `,
      );
      const terminal = sql.join(
        TERMINAL_PROJECT_STATUSES.map((s) => sql`${s}`),
        sql`, `,
      );

      const orgUnits = await tx.execute(sql`
        SELECT o.id, o.name
        FROM org_units o
        WHERE o.company_id = ${companyId}::uuid
          AND o.type IN (${eligibleTypes})
          AND o.status = 'active'
          AND o.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM chat_rooms r
            WHERE r.company_id = ${companyId}::uuid AND r.org_unit_id = o.id
          )
      `);

      const projects = await tx.execute(sql`
        SELECT p.id, p.name
        FROM projects p
        WHERE p.company_id = ${companyId}::uuid
          AND p.deleted_at IS NULL
          AND (p.project_status IS NULL OR p.project_status NOT IN (${terminal}))
          AND NOT EXISTS (
            SELECT 1 FROM chat_rooms r
            WHERE r.company_id = ${companyId}::uuid AND r.ref_id = p.id
          )
      `);

      // Dự án đã kết thúc/xoá mềm mà phòng còn mở — đóng lại (đóng băng thành viên, giữ lịch sử đọc được).
      const stale = await tx.execute(sql`
        SELECT p.id, p.name
        FROM projects p
        JOIN chat_rooms r
          ON r.company_id = p.company_id AND r.ref_id = p.id
        WHERE p.company_id = ${companyId}::uuid
          AND r.company_id = ${companyId}::uuid
          AND r.is_archived = false
          AND r.deleted_at IS NULL
          AND (p.deleted_at IS NOT NULL OR p.project_status IN (${terminal}))
      `);

      return {
        orgUnitsMissingRoom: (orgUnits as unknown as { rows: ScanRow[] }).rows ?? [],
        projectsMissingRoom: (projects as unknown as { rows: ScanRow[] }).rows ?? [],
        projectsNeedingArchive: (stale as unknown as { rows: ScanRow[] }).rows ?? [],
      };
    });
  }

  /** Lỗi MỘT phòng không được chặn phòng còn lại — nhịp sau thử lại (Pha 1 vẫn thấy nó thiếu). */
  private async ensure(fn: () => Promise<unknown>): Promise<boolean> {
    try {
      await fn();
      return true;
    } catch (err) {
      this.logger.warn(
        `${this.jobCode}: một mục thất bại, tiếp tục các mục còn lại: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }
}
