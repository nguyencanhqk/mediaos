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

/**
 * Cận trên MỖI NHỊP cho Pha 2 (tạo/đóng phòng). Pha 2 tốn ~3 transaction cho mỗi phòng thiếu (tra trước →
 * cấp `room_code` ở tx riêng → tạo phòng), chạy TUẦN TỰ. Trên tenant có hàng nghìn dự án, lần chạy đầu
 * không cận trên có thể vượt `JobRunner.DEFAULT_LOCK_TTL_MS` (10 phút) ⇒ khoá hết hạn GIỮA CHỪNG ⇒ instance
 * thứ hai vào chạy song song. Tính đúng đắn vẫn được idempotency cứu, nhưng nó đốt `room_code` và nhân đôi
 * `system_job_runs` (bảng này từng phình 3 triệu dòng).
 *
 * Cắt bớt KHÔNG im lặng: phần dư được `log()` và nhịp sau tự thấy lại (Pha 1 vẫn báo chúng thiếu).
 */
const PHASE2_MAX_PER_TICK = 200;

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
    this.warnIfCapped(ctx.companyId, scan);

    let created = 0;
    let failed = 0;
    for (const unit of scan.orgUnitsMissingRoom.slice(0, PHASE2_MAX_PER_TICK)) {
      const ok = await this.ensure(() =>
        this.sync.ensureOrgUnitRoom(ctx.companyId, unit.id, unit.name, JOB_ACTOR),
      );
      if (ok) created++;
      else failed++;
    }
    for (const project of scan.projectsMissingRoom.slice(0, PHASE2_MAX_PER_TICK)) {
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
    for (const unit of scan.orgUnitsNeedingArchive) {
      const ok = await this.ensure(() =>
        this.sync.archiveOrgUnitRoom(ctx.companyId, unit.id, JOB_ACTOR),
      );
      if (ok) archived++;
      else failed++;
    }

    // Pha 3 — transaction MỚI (Pha 1 đã đóng, Pha 2 chạy ngoài tx) ⇒ không lồng.
    const diff = await this.db.withTenant(ctx.companyId, (tx) =>
      this.sync.reconcileMembershipTx(tx, ctx.companyId, JOB_ACTOR),
    );

    const total = created + archived + diff.joined + diff.left;
    if (failed > 0) {
      this.logger.error(
        `${this.jobCode} tenant=${ctx.companyId}: ${failed} mục KHÔNG sửa được (đã sửa ${total}). ` +
          `Nhịp sau thử lại — nếu số này không giảm thì lệch đang TỒN ĐỌNG.`,
      );
    } else if (total > 0) {
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
    orgUnitsNeedingArchive: ScanRow[];
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
            WHERE r.company_id = ${companyId}::uuid
              AND r.org_unit_id = o.id
              -- Bỏ qua tombstone: phòng đã xoá mềm KHÔNG tính là đã-có-phòng, nếu không org_unit này
              -- vĩnh viễn không có phòng chat và không nhịp nào phát hiện được (ensureOrgUnitRoom hồi
              -- sinh đúng hàng cũ, vì unique partial phủ cả tombstone nên INSERT mới sẽ là 23505).
              AND r.deleted_at IS NULL
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
            WHERE r.company_id = ${companyId}::uuid AND r.ref_id = p.id AND r.deleted_at IS NULL
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

      // Phòng ban bị xoá mềm / chuyển `inactive` mà phòng còn mở — ĐỐI XỨNG với dự án ở trên.
      //
      // Không có vế này thì `deleteOrgUnit`/`updateOrgUnit(status='inactive')` để lại một phòng chat SỐNG:
      // vẫn nhận tin mới, thành viên nguyên vẹn, không log gì. Vị từ thành viên
      // (`desiredDepartmentPairsSql`) nối qua `r.org_unit_id = ep.org_unit_id` và KHÔNG đọc bảng
      // `org_units` lần nào, nên nó cũng không tự phát hiện được phòng ban đã biến mất.
      const staleOrgUnits = await tx.execute(sql`
        SELECT o.id, o.name
        FROM org_units o
        JOIN chat_rooms r
          ON r.company_id = o.company_id AND r.org_unit_id = o.id
        WHERE o.company_id = ${companyId}::uuid
          AND r.company_id = ${companyId}::uuid
          AND r.is_archived = false
          AND r.deleted_at IS NULL
          AND (o.deleted_at IS NOT NULL OR o.status <> 'active' OR o.type NOT IN (${eligibleTypes}))
      `);

      return {
        orgUnitsMissingRoom: (orgUnits as unknown as { rows: ScanRow[] }).rows ?? [],
        projectsMissingRoom: (projects as unknown as { rows: ScanRow[] }).rows ?? [],
        projectsNeedingArchive: (stale as unknown as { rows: ScanRow[] }).rows ?? [],
        orgUnitsNeedingArchive: (staleOrgUnits as unknown as { rows: ScanRow[] }).rows ?? [],
      };
    });
  }

  /**
   * Cắt bớt phải NÓI RA. Một job lặng lẽ xử lý 200/5000 mục rồi báo "xong" đọc y hệt như "không có gì
   * lệch" — đó là cách một tồn đọng lớn sống sót qua hàng trăm nhịp mà không ai biết.
   */
  private warnIfCapped(
    companyId: string,
    scan: { orgUnitsMissingRoom: ScanRow[]; projectsMissingRoom: ScanRow[] },
  ): void {
    const pending = scan.orgUnitsMissingRoom.length + scan.projectsMissingRoom.length;
    if (pending > PHASE2_MAX_PER_TICK) {
      this.logger.warn(
        `${this.jobCode} tenant=${companyId}: ${pending} phòng còn thiếu, nhịp này chỉ tạo ` +
          `${PHASE2_MAX_PER_TICK} (cận trên chống vượt TTL khoá). Phần dư sẽ được nhịp sau xử lý.`,
      );
    }
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
