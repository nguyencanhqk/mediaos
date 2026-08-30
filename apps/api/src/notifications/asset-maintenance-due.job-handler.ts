import { Injectable, Logger } from "@nestjs/common";
import { sql } from "drizzle-orm";
import {
  SystemJobHandler,
  type JobHandler,
  type JobRunContext,
  type JobRunResult,
} from "../scheduler/job-handler";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { AssetAudienceReader } from "./asset-audience.reader";
import { NotificationEngineService } from "./notification-engine.service";

export const ASSET_MAINTENANCE_DUE_JOB_CODE = "ASSET_MAINTENANCE_DUE";
const EVENT_CODE = "ASSET_MAINTENANCE_DUE";
/** SPEC-13 §17: `next_maintenance_due ≤ hôm nay + 7`. */
export const ASSET_MAINTENANCE_DUE_WINDOW_DAYS = 7;
/** Quá hạn lâu hơn ngưỡng này thì rời cửa sổ quét (đã nhắc, dedupe once-ever) — tập kết quả không lớn mãi (gate HIGH-4). */
export const ASSET_MAINTENANCE_OVERDUE_GRACE_DAYS = 30;
/** Trần hàng/nhịp — chống unbounded read. */
export const ASSET_MAINTENANCE_DUE_BATCH = 500;
const SOURCE_MODULE = "ASSET";
const SOURCE_ENTITY_TYPE = "asset";

interface DueAssetRow {
  id: string;
  assetCode: string;
  name: string;
  nextMaintenanceDue: string;
}

/**
 * S11-ASSET-BE-1 — AssetMaintenanceDueJobHandler: quét `assets` có `next_maintenance_due ≤ today+7`, không
 * Disposed/Lost, chưa xoá (đúng `idx_assets_company_maintenance_due`) → phát `ASSET_MAINTENANCE_DUE` cho user
 * đang giữ role `asset-manager`/`company-admin` qua `NotificationEngineService.intake()` in-process (mirror
 * `TaskReminderJobHandler`, KHÔNG qua outbox — job không có tx nghiệp vụ).
 *
 * IDEMPOTENT: catalog 0551 `dedupe_strategy='DedupeKey'`; `dedupeKey = "<assetId>:<dueDate>"` ⇒ engine ghép
 * `ASSET_MAINTENANCE_DUE:<assetId>:<dueDate>` — cùng hạn KHÔNG nhắc lại (job chạy mỗi nhịp scheduler 60s), đổi
 * hạn ⇒ khoá mới. Nhịp "1 lần/ngày" của SPEC-13 §13.3 là hạ tầng chung (ghi nợ ở PR).
 *
 * BẤT BIẾN #1: JobRunContext CHỈ `companyId` — handler TỰ mở `withTenant`. Payload ĐỦ 4 biến template 0551
 * (`asset_name · asset_code · due_date · asset_id`) — không giá/chi phí.
 * Sống ở `notifications/**` + khai `NotificationsModule.providers` (tự đăng ký qua DiscoveryService).
 */
@Injectable()
@SystemJobHandler()
export class AssetMaintenanceDueJobHandler implements JobHandler {
  readonly jobCode = ASSET_MAINTENANCE_DUE_JOB_CODE;
  private readonly logger = new Logger(AssetMaintenanceDueJobHandler.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly reader: AssetAudienceReader,
    private readonly engine: NotificationEngineService,
  ) {}

  async run(ctx: JobRunContext): Promise<JobRunResult> {
    const { companyId } = ctx;
    const [dueAssets, recipients] = await this.db.withTenant(companyId, async (tx) => {
      const due = await this.queryDue(tx, companyId);
      const users = due.length > 0 ? await this.reader.assetManagerUserIds(tx, companyId) : [];
      return [due, users] as const;
    });
    // MỘT intake/asset với TOÀN BỘ recipient (gate HIGH-4): engine tự lặp recipient + dedupe từng người
    // (savepoint) — không mở N×M tx mỗi nhịp 60s. 0 recipient mà có tài sản đến hạn ⇒ KÊU (warn + failed),
    // không để run-log "Success" vĩnh viễn trong khi không ai được nhắc (gate silent-failure M2).
    if (dueAssets.length > 0 && recipients.length === 0) {
      this.logger.warn(
        `ASSET_MAINTENANCE_DUE tenant=${companyId}: ${dueAssets.length} tài sản đến hạn nhưng KHÔNG có user nào giữ role asset-manager/company-admin còn hiệu lực.`,
      );
      return {
        total: dueAssets.length,
        success: 0,
        failed: dueAssets.length,
        metadata: { dueAssets: dueAssets.length, recipients: 0, reason: "no_recipient" },
      };
    }
    let success = 0;
    let failed = 0;
    for (const asset of dueAssets) {
      if (await this.fireSafe(companyId, asset, recipients)) success += 1;
      else failed += 1;
    }
    return {
      total: dueAssets.length,
      success,
      failed,
      metadata: { dueAssets: dueAssets.length, recipients: recipients.length },
    };
  }

  private async queryDue(tx: TenantTx, companyId: string): Promise<DueAssetRow[]> {
    const res = await tx.execute(sql`
      select a.id, a.asset_code as "assetCode", a.name,
             to_char(a.next_maintenance_due, 'YYYY-MM-DD') as "nextMaintenanceDue"
        from assets a
       where a.company_id = ${companyId}
         and a.deleted_at is null
         and a.next_maintenance_due is not null
         and a.next_maintenance_due <= (current_date + ${ASSET_MAINTENANCE_DUE_WINDOW_DAYS}::int)
         and a.next_maintenance_due >= (current_date - ${ASSET_MAINTENANCE_OVERDUE_GRACE_DAYS}::int)
         and a.status not in ('Disposed', 'Lost')
       order by a.next_maintenance_due asc, a.asset_code asc
       limit ${ASSET_MAINTENANCE_DUE_BATCH}
    `);
    return res.rows as unknown as DueAssetRow[];
  }

  /** true = phát thành công (hoặc dedupe/skip — KHÔNG phải lỗi); false = engine ném lỗi thật (log, không nuốt câm). */
  private async fireSafe(
    companyId: string,
    asset: DueAssetRow,
    userIds: string[],
  ): Promise<boolean> {
    try {
      await this.engine.intake(companyId, {
        eventCode: EVENT_CODE,
        sourceModule: SOURCE_MODULE,
        sourceEntityType: SOURCE_ENTITY_TYPE,
        sourceEntityId: asset.id,
        dedupeKey: `${asset.id}:${asset.nextMaintenanceDue}`,
        recipient: { mode: "UserIds", userIds, employeeIds: [] },
        payload: {
          asset_name: asset.name,
          asset_code: asset.assetCode,
          due_date: asset.nextMaintenanceDue,
          asset_id: asset.id,
        },
      });
      return true;
    } catch (err) {
      this.logger.error(
        `ASSET_MAINTENANCE_DUE: intake(asset=${asset.id}, recipients=${userIds.length}) THẤT BẠI: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
      return false;
    }
  }
}
