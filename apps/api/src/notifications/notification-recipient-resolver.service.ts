import { Injectable } from "@nestjs/common";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { InternalEventIntakeDto } from "@mediaos/contracts";
import type { TenantTx } from "../db/db.service";
import { users } from "../db/schema/users";
import { employeeProfiles } from "../db/schema/employees";

/** Chỉ 2 field engine cần từ event để resolve recipient (actor-exclusion). */
export interface ResolverEvent {
  isSystemEvent: boolean;
}

export interface ResolveResult {
  /** user_id đủ điều kiện nhận (active, cùng company, đã trừ actor nếu cần) — DUY NHẤT, KHÔNG trùng. */
  recipients: string[];
  /** Số ứng viên bị LOẠI vì inactive/locked/deleted/cross-tenant (đếm vào skipped_count). */
  droppedCount: number;
}

/**
 * S4-NOTI-BE-2 (L2-engine) — resolve danh sách người nhận từ event intake.
 *
 * Luồng: gom ứng viên (UserIds trực tiếp / EmployeeIds → user_id) → lọc user ACTIVE + CÙNG COMPANY (RLS ép
 * cross-tenant vô hình = 0 row, BẤT BIẾN #1) → actor-exclusion (bỏ actorUserId TRỪ `is_system_event=true`,
 * plan §6.1 — SYSTEM_* seed 0481:85-86). Recipient bị lọc = filter-and-drop (KHÔNG tạo notification ⇒ KHÔNG
 * delivery_log vì FK notification_id NOT NULL — plan §6.3), đếm vào `droppedCount`.
 *
 * Nhận `tx: TenantTx` NGOÀI (engine mở `withTenant` một lần) — service KHÔNG tự mở transaction.
 */
@Injectable()
export class NotificationRecipientResolverService {
  async resolve(
    tx: TenantTx,
    companyId: string,
    event: ResolverEvent,
    dto: InternalEventIntakeDto,
  ): Promise<ResolveResult> {
    const candidateIds = await this.collectCandidates(tx, companyId, dto);
    const uniqueCandidates = [...new Set(candidateIds)];
    if (uniqueCandidates.length === 0) {
      return { recipients: [], droppedCount: 0 };
    }

    const activeIds = await this.filterActiveUsers(tx, companyId, uniqueCandidates);
    // Dropped = inactive/locked/deleted/cross-tenant (NON actor-exclusion). Actor-exclusion KHÔNG tính skip
    // vì actor cố ý không nhận (trừ system-event) — khác ngữ nghĩa "recipient hợp lệ nhưng bị chặn".
    const droppedCount = uniqueCandidates.length - activeIds.length;

    let recipients = activeIds;
    if (!event.isSystemEvent && dto.actorUserId) {
      recipients = recipients.filter((id) => id !== dto.actorUserId);
    }

    return { recipients, droppedCount };
  }

  /** Gom user_id ứng viên theo mode. EmployeeIds → user_id (profile active, chưa xoá, có user_id). */
  private async collectCandidates(
    tx: TenantTx,
    companyId: string,
    dto: InternalEventIntakeDto,
  ): Promise<string[]> {
    if (dto.recipient.mode === "UserIds") {
      return dto.recipient.userIds;
    }
    // mode === "EmployeeIds"
    const employeeIds = dto.recipient.employeeIds;
    if (employeeIds.length === 0) return [];

    const rows = await tx
      .select({ userId: employeeProfiles.userId })
      .from(employeeProfiles)
      .where(
        and(
          eq(employeeProfiles.companyId, companyId),
          inArray(employeeProfiles.id, employeeIds),
          eq(employeeProfiles.status, "active"),
          isNull(employeeProfiles.deletedAt),
          isNotNull(employeeProfiles.userId),
        ),
      );
    return rows
      .map((r) => r.userId)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
  }

  /** Giữ lại user ACTIVE (status='active', chưa khoá, chưa xoá) CÙNG company. RLS ẩn cross-tenant. */
  private async filterActiveUsers(
    tx: TenantTx,
    companyId: string,
    ids: string[],
  ): Promise<string[]> {
    if (ids.length === 0) return [];
    const rows = await tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.companyId, companyId),
          inArray(users.id, ids),
          eq(users.status, "active"),
          isNull(users.lockedAt),
          isNull(users.deletedAt),
        ),
      );
    return rows.map((r) => r.id);
  }
}
