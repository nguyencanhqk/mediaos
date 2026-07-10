import { Injectable } from "@nestjs/common";
import { and, desc, eq, gte, isNull, lte, sql, type SQL } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { notifications } from "../db/schema/communication";
import type { MyNotificationRow } from "./my-notifications.mapper";

/** Bộ lọc GET /notifications (NOTI-API-001, API-07 §11.1). */
export interface MyNotificationListFilter {
  status?: string;
  notificationType?: string;
  sourceModule?: string;
  eventCode?: string;
  priority?: string;
  createdFrom?: Date;
  createdTo?: Date;
  includeArchived: boolean;
  includeHidden: boolean;
}

const ROW_COLUMNS = {
  id: notifications.id,
  title: notifications.title,
  body: notifications.body,
  shortBody: notifications.shortBody,
  notificationType: notifications.notificationType,
  priority: notifications.priority,
  status: notifications.status,
  isRead: notifications.isRead,
  moduleCode: notifications.moduleCode,
  eventCode: notifications.eventCode,
  targetModule: notifications.targetModule,
  targetType: notifications.targetType,
  targetId: notifications.targetId,
  targetUrl: notifications.targetUrl,
  payload: notifications.payload,
  createdAt: notifications.createdAt,
  readAt: notifications.readAt,
} as const;

/** status hiệu lực = COALESCE(status, is_read?'Read':'Unread') — khoan dung hàng thiếu cột mới khi ĐỌC. */
const EFFECTIVE_STATUS = sql`coalesce(${notifications.status}, case when ${notifications.isRead} then 'Read' else 'Unread' end)`;

/** `and(...)` với danh sách cụ thể (không rỗng) luôn trả SQL — throw thay vì rơi vào 0-row âm thầm. */
function mustAnd(...conds: SQL[]): SQL {
  const combined = and(...conds);
  if (!combined)
    throw new Error("my-notifications.repository: and() với điều kiện cụ thể trả undefined");
  return combined;
}

/**
 * MyNotificationsRepository — CHỈ thao tác trên `notifications` qua cột MỚI (S4-NOTI-DB-1 mig 0479).
 * Own-scope TUYỆT ĐỐI: MỌI method nhận companyId+userId tường minh, filter cứng `recipient_user_id`
 * (KHÔNG COALESCE với `user_id` legacy — hàng chỉ có cột legacy cũ sẽ KHÔNG hiện ở API này, đúng phạm vi
 * WO). Mọi method nhận `tx` từ `withTenant` (RLS sống) — KHÔNG tự mở context (CLAUDE.md §2 bất biến #1).
 */
@Injectable()
export class MyNotificationsRepository {
  private ownScope(companyId: string, userId: string): SQL {
    return mustAnd(
      eq(notifications.companyId, companyId),
      eq(notifications.recipientUserId, userId),
      isNull(notifications.deletedAt),
    );
  }

  private statusVisibility(
    filter: Pick<MyNotificationListFilter, "status" | "includeArchived" | "includeHidden">,
  ): SQL {
    if (filter.status) return sql`${EFFECTIVE_STATUS} = ${filter.status}`;
    const excluded = ["Deleted"];
    if (!filter.includeHidden) excluded.push("Hidden");
    if (!filter.includeArchived) excluded.push("Archived");
    return sql`${EFFECTIVE_STATUS} NOT IN (${sql.join(
      excluded.map((e) => sql`${e}`),
      sql`, `,
    )})`;
  }

  private listWhere(companyId: string, userId: string, filter: MyNotificationListFilter): SQL {
    const conds: SQL[] = [this.ownScope(companyId, userId), this.statusVisibility(filter)];
    if (filter.notificationType)
      conds.push(eq(notifications.notificationType, filter.notificationType));
    if (filter.sourceModule) conds.push(eq(notifications.moduleCode, filter.sourceModule));
    if (filter.eventCode) conds.push(eq(notifications.eventCode, filter.eventCode));
    if (filter.priority) conds.push(eq(notifications.priority, filter.priority));
    if (filter.createdFrom) conds.push(gte(notifications.createdAt, filter.createdFrom));
    if (filter.createdTo) conds.push(lte(notifications.createdAt, filter.createdTo));
    return mustAnd(...conds);
  }

  async findManyTx(
    tx: TenantTx,
    companyId: string,
    userId: string,
    filter: MyNotificationListFilter,
    limit: number,
    offset: number,
  ): Promise<MyNotificationRow[]> {
    return tx
      .select(ROW_COLUMNS)
      .from(notifications)
      .where(this.listWhere(companyId, userId, filter))
      .orderBy(desc(notifications.createdAt))
      .limit(limit)
      .offset(offset);
  }

  async countTx(
    tx: TenantTx,
    companyId: string,
    userId: string,
    filter: MyNotificationListFilter,
  ): Promise<number> {
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(notifications)
      .where(this.listWhere(companyId, userId, filter));
    return row?.n ?? 0;
  }

  /** NOTI-API-002 dropdown — chỉ Unread/Read, mới nhất trước, LIMIT nhỏ (tối ưu header). */
  async findDropdownTx(
    tx: TenantTx,
    companyId: string,
    userId: string,
    limit: number,
    unreadOnly: boolean,
  ): Promise<MyNotificationRow[]> {
    const statusCond = unreadOnly
      ? sql`${EFFECTIVE_STATUS} = 'Unread'`
      : sql`${EFFECTIVE_STATUS} IN ('Unread', 'Read')`;
    return tx
      .select(ROW_COLUMNS)
      .from(notifications)
      .where(mustAnd(this.ownScope(companyId, userId), statusCond))
      .orderBy(desc(notifications.createdAt))
      .limit(limit);
  }

  /**
   * NOTI-API-003 unread-count — WHERE khớp NGUYÊN VĂN `idx_notifications_unread` (company_id,
   * recipient_user_id) WHERE status='Unread' (mig 0479/0481): dùng literal `status='Unread'` (KHÔNG
   * EFFECTIVE_STATUS/COALESCE) để hit partial index, không scan bảng (WO done_when).
   */
  async unreadStatsTx(
    tx: TenantTx,
    companyId: string,
    userId: string,
  ): Promise<{ unread: number; highPriorityUnread: number; urgentUnread: number }> {
    const [row] = await tx
      .select({
        unread: sql<number>`count(*)::int`,
        highPriorityUnread: sql<number>`count(*) filter (where ${notifications.priority} = 'High')::int`,
        urgentUnread: sql<number>`count(*) filter (where ${notifications.priority} = 'Urgent')::int`,
      })
      .from(notifications)
      .where(
        mustAnd(
          eq(notifications.companyId, companyId),
          eq(notifications.recipientUserId, userId),
          eq(notifications.status, "Unread"),
        ),
      );
    return {
      unread: row?.unread ?? 0,
      highPriorityUnread: row?.highPriorityUnread ?? 0,
      urgentUnread: row?.urgentUnread ?? 0,
    };
  }

  async lastNotificationAtTx(
    tx: TenantTx,
    companyId: string,
    userId: string,
  ): Promise<Date | null> {
    const [row] = await tx
      .select({ maxCreatedAt: sql<string | Date | null>`max(${notifications.createdAt})` })
      .from(notifications)
      .where(this.ownScope(companyId, userId));
    const raw = row?.maxCreatedAt;
    // pg driver KHÔNG luôn parse aggregate raw sql thành Date (khác cột đã map qua schema) — chuẩn hoá
    // tường minh thay vì tin `sql<Date>` (chỉ là type hint compile-time, không ép runtime).
    if (!raw) return null;
    return raw instanceof Date ? raw : new Date(raw);
  }

  async findOneTx(
    tx: TenantTx,
    companyId: string,
    userId: string,
    id: string,
  ): Promise<MyNotificationRow | undefined> {
    const [row] = await tx
      .select(ROW_COLUMNS)
      .from(notifications)
      .where(mustAnd(this.ownScope(companyId, userId), eq(notifications.id, id)))
      .limit(1);
    return row;
  }

  /** NOTI-API-101 — idempotent: `read_at` giữ nguyên nếu đã có (COALESCE), is_read/status luôn đồng bộ. */
  async markReadTx(
    tx: TenantTx,
    companyId: string,
    userId: string,
    id: string,
  ): Promise<MyNotificationRow | undefined> {
    const [row] = await tx
      .update(notifications)
      .set({
        status: "Read",
        readAt: sql`coalesce(${notifications.readAt}, now())`,
        isRead: true,
        updatedAt: sql`now()`,
        updatedBy: userId,
      })
      .where(mustAnd(this.ownScope(companyId, userId), eq(notifications.id, id)))
      .returning(ROW_COLUMNS);
    return row;
  }

  /** NOTI-API-103 — bulk UPDATE 1 câu (KHÔNG loop từng dòng), chỉ đụng status='Unread' hiện có. */
  async markAllReadTx(
    tx: TenantTx,
    companyId: string,
    userId: string,
    filter: { sourceModule?: string; notificationType?: string; createdBefore?: Date },
  ): Promise<number> {
    const conds: SQL[] = [
      eq(notifications.companyId, companyId),
      eq(notifications.recipientUserId, userId),
      eq(notifications.status, "Unread"),
    ];
    if (filter.sourceModule) conds.push(eq(notifications.moduleCode, filter.sourceModule));
    if (filter.notificationType)
      conds.push(eq(notifications.notificationType, filter.notificationType));
    if (filter.createdBefore) conds.push(lte(notifications.createdAt, filter.createdBefore));

    const rows = await tx
      .update(notifications)
      .set({
        status: "Read",
        readAt: sql`now()`,
        isRead: true,
        updatedAt: sql`now()`,
        updatedBy: userId,
      })
      .where(mustAnd(...conds))
      .returning({ id: notifications.id });
    return rows.length;
  }

  /** NOTI-API-106 — soft-delete (BẤT BIẾN #2): `deleted_at`/`deleted_by`, KHÔNG hard-delete. */
  async softDeleteTx(
    tx: TenantTx,
    companyId: string,
    userId: string,
    id: string,
  ): Promise<{ id: string } | undefined> {
    const [row] = await tx
      .update(notifications)
      .set({
        status: "Deleted",
        deletedAt: sql`now()`,
        deletedBy: userId,
        updatedAt: sql`now()`,
        updatedBy: userId,
      })
      .where(mustAnd(this.ownScope(companyId, userId), eq(notifications.id, id)))
      .returning({ id: notifications.id });
    return row;
  }
}
