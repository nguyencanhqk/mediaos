import { Injectable } from "@nestjs/common";
import { and, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { notificationDeliveryLogs, type NotificationDeliveryLog } from "../db/schema/noti";

/** Bộ lọc GET /notifications/delivery-logs (NOTI-API-401, API-07 §15.1). */
export interface DeliveryLogListFilter {
  notificationId?: string;
  recipientUserId?: string;
  channel?: string;
  deliveryStatus?: string;
  createdFrom?: Date;
  createdTo?: Date;
}

/** `and(...)` với điều kiện cụ thể (company_id luôn có) luôn trả SQL — throw thay vì rơi 0-row âm thầm. */
function mustAnd(...conds: SQL[]): SQL {
  const combined = and(...conds);
  if (!combined) throw new Error("notification-delivery-log.repository: and() trả undefined");
  return combined;
}

/** 3 trạng thái TERMINAL app role được phép ghi — KHÔNG bao giờ 'Pending'/'Delivered'/'Cancelled' ở đây
 * (những trạng thái đó thuộc luồng worker retry ngoài phạm vi S4-NOTI-BE-2). */
export type DeliveryTerminalStatus = "Sent" | "Skipped" | "Failed";

export interface InsertDeliveryLogInput {
  notificationId: string;
  recipientUserId: string;
  channel: string;
  deliveryStatus: DeliveryTerminalStatus;
  attemptNo?: number;
  maxAttempts?: number;
  provider?: string | null;
  requestPayload?: Record<string, unknown> | null;
  responsePayload?: Record<string, unknown> | null;
  externalMessageId?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * NotificationDeliveryLogRepository — bảng APPEND-ONLY (DB-07 §7.4, BẤT BIẾN #2). Migration 0479 GRANT
 * SELECT,INSERT cho `mediaos_app` — KHÔNG UPDATE/DELETE. CỐ Ý class này CHỈ có 1 method ghi (`insertLog`),
 * KHÔNG có `updateLog`/`markDelivered`… — retry = INSERT hàng `attempt_no` MỚI, KHÔNG update in-place hàng
 * cũ (silent-failure-hunter canh vi phạm append-only qua việc thiếu method update ở đây).
 *
 * Nhận `tx: TenantTx` từ caller (engine service — cùng transaction/SAVEPOINT với `createFromEngine`) —
 * repo KHÔNG tự mở transaction.
 */
@Injectable()
export class NotificationDeliveryLogRepository {
  async insertLog(
    tx: TenantTx,
    companyId: string,
    data: InsertDeliveryLogInput,
  ): Promise<NotificationDeliveryLog> {
    // chk_notification_delivery_logs_attempt (0479): attempt_no >= 1 AND max_attempts >= attempt_no.
    const attemptNo = data.attemptNo ?? 1;
    const maxAttempts = data.maxAttempts ?? attemptNo;
    const now = sql`now()`;

    const [row] = await tx
      .insert(notificationDeliveryLogs)
      .values({
        companyId,
        notificationId: data.notificationId,
        recipientUserId: data.recipientUserId,
        channel: data.channel,
        deliveryStatus: data.deliveryStatus,
        attemptNo,
        maxAttempts,
        provider: data.provider ?? null,
        requestPayload: data.requestPayload ?? null,
        responsePayload: data.responsePayload ?? null,
        externalMessageId: data.externalMessageId ?? null,
        errorCode: data.errorCode ?? null,
        errorMessage: data.errorMessage ?? null,
        metadata: data.metadata ?? null,
        sentAt: data.deliveryStatus === "Sent" ? now : null,
        failedAt: data.deliveryStatus === "Failed" ? now : null,
      })
      .returning();

    if (!row) {
      throw new Error("NotificationDeliveryLogRepository.insertLog: INSERT không trả về hàng nào");
    }
    return row;
  }

  /**
   * GET /notifications/delivery-logs (NOTI-API-401, S4-NOTI-BE-3) — CHỈ ĐỌC (SELECT, đã có GRANT 0479).
   * KHÔNG vi phạm append-only (BẤT BIẾN #2): 2 method dưới đây KHÔNG ghi. company_id literal-GUC (bảng
   * KHÔNG nullable-tenant, khác notification_events/templates) — filter tường minh (defense-in-depth).
   */
  private listWhere(companyId: string, filter: DeliveryLogListFilter): SQL {
    const conds: SQL[] = [eq(notificationDeliveryLogs.companyId, companyId)];
    if (filter.notificationId)
      conds.push(eq(notificationDeliveryLogs.notificationId, filter.notificationId));
    if (filter.recipientUserId)
      conds.push(eq(notificationDeliveryLogs.recipientUserId, filter.recipientUserId));
    if (filter.channel) conds.push(eq(notificationDeliveryLogs.channel, filter.channel));
    if (filter.deliveryStatus)
      conds.push(eq(notificationDeliveryLogs.deliveryStatus, filter.deliveryStatus));
    if (filter.createdFrom) conds.push(gte(notificationDeliveryLogs.createdAt, filter.createdFrom));
    if (filter.createdTo) conds.push(lte(notificationDeliveryLogs.createdAt, filter.createdTo));
    return mustAnd(...conds);
  }

  async list(
    tx: TenantTx,
    companyId: string,
    filter: DeliveryLogListFilter,
    limit: number,
    offset: number,
  ): Promise<NotificationDeliveryLog[]> {
    return tx
      .select()
      .from(notificationDeliveryLogs)
      .where(this.listWhere(companyId, filter))
      .orderBy(desc(notificationDeliveryLogs.createdAt))
      .limit(limit)
      .offset(offset);
  }

  async count(tx: TenantTx, companyId: string, filter: DeliveryLogListFilter): Promise<number> {
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(notificationDeliveryLogs)
      .where(this.listWhere(companyId, filter));
    return row?.n ?? 0;
  }
}
