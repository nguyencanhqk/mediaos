import { Injectable } from "@nestjs/common";
import { and, desc, eq, isNull } from "drizzle-orm";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { expenseApprovals, expenseRequests, users } from "../db/schema";

/**
 * G13-4 — ExpenseRequestRepository. Đề xuất chi qua Task Hub (BẤT BIẾN #4); expense_approvals = log
 * quyết định APPEND-ONLY (BẤT BIẾN #2 — app role chỉ SELECT,INSERT). expense_requests mutable có kiểm
 * soát (GRANT SELECT,INSERT,UPDATE — KHÔNG DELETE; cập nhật status/level/task_id/cost_record_id).
 *
 * Mọi truy vấn nghiệp vụ qua withTenant (RLS ép company_id ở DB). Write nhận TenantTx (cùng tx audit).
 */

/** Cột app được phép set khi INSERT expense (company_id lấy từ DB DEFAULT current_setting). */
export interface InsertExpenseData {
  requestedBy: string;
  title: string;
  description?: string | null;
  amount: string; // numeric → string (Drizzle)
  currency: string;
  expenseType: string;
  neededAt?: string | null;
  orgUnitId?: string | null;
  projectId?: string | null;
  channelId?: string | null;
  attachmentUrl?: string | null;
}

/** Bản vá status hợp lệ (expense_requests CÓ GRANT UPDATE — KHÔNG cấp cho approvals/cost). */
export interface UpdateExpenseStatusData {
  status?: string;
  currentApprovalLevel?: number;
  costRecordId?: string | null;
  taskId?: string | null;
}

export interface ListExpenseFilter {
  status?: string;
  /** true = chỉ request do `userId` tạo (mine). */
  mineUserId?: string;
}

@Injectable()
export class ExpenseRequestRepository {
  constructor(private readonly db: DatabaseService) {}

  /** Liệt kê expense của tenant (RLS lọc company_id). */
  list(companyId: string, filter: ListExpenseFilter = {}) {
    return this.db.withTenant(companyId, async (tx) => {
      const conds = [eq(expenseRequests.companyId, companyId)];
      if (filter.status) conds.push(eq(expenseRequests.status, filter.status));
      if (filter.mineUserId) conds.push(eq(expenseRequests.requestedBy, filter.mineUserId));
      return tx
        .select()
        .from(expenseRequests)
        .where(and(...conds))
        .orderBy(desc(expenseRequests.createdAt));
    });
  }

  /** Expense theo id trong CÙNG tx (guard thuộc tenant trước decide). null nếu không có/khác tenant. */
  async findByIdTx(tx: TenantTx, companyId: string, id: string) {
    const [row] = await tx
      .select()
      .from(expenseRequests)
      .where(and(eq(expenseRequests.companyId, companyId), eq(expenseRequests.id, id)))
      .limit(1);
    return row ?? null;
  }

  /** INSERT 1 expense (CÙNG tx). status='pending', level=1 mặc định. */
  async insertRequestTx(tx: TenantTx, companyId: string, data: InsertExpenseData) {
    const [row] = await tx
      .insert(expenseRequests)
      .values({
        companyId,
        requestedBy: data.requestedBy,
        title: data.title,
        description: data.description ?? null,
        amount: data.amount,
        currency: data.currency,
        expenseType: data.expenseType,
        neededAt: data.neededAt ?? null,
        orgUnitId: data.orgUnitId ?? null,
        projectId: data.projectId ?? null,
        channelId: data.channelId ?? null,
        attachmentUrl: data.attachmentUrl ?? null,
        status: "pending",
        currentApprovalLevel: 1,
      })
      .returning();
    return row;
  }

  /** UPDATE status/level/cost_record_id/task_id (expense_requests CÓ GRANT UPDATE). */
  async updateStatusTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    patch: UpdateExpenseStatusData,
  ) {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.currentApprovalLevel !== undefined)
      set.currentApprovalLevel = patch.currentApprovalLevel;
    if (patch.costRecordId !== undefined) set.costRecordId = patch.costRecordId;
    if (patch.taskId !== undefined) set.taskId = patch.taskId;

    const [row] = await tx
      .update(expenseRequests)
      .set(set)
      .where(and(eq(expenseRequests.companyId, companyId), eq(expenseRequests.id, id)))
      .returning();
    return row ?? null;
  }

  /** INSERT 1 log quyết định (append-only). uq(expense_request_id, approval_level) chặn double-decision. */
  async insertApprovalTx(
    tx: TenantTx,
    companyId: string,
    data: {
      expenseRequestId: string;
      approvalLevel: number;
      approverUserId: string;
      decision: "approved" | "rejected";
      comment?: string | null;
    },
  ) {
    const [row] = await tx
      .insert(expenseApprovals)
      .values({
        companyId,
        expenseRequestId: data.expenseRequestId,
        approvalLevel: data.approvalLevel,
        approverUserId: data.approverUserId,
        decision: data.decision,
        comment: data.comment ?? null,
      })
      .returning();
    return row;
  }

  /** Log quyết định của 1 expense (theo level). */
  findApprovalsByRequestTx(tx: TenantTx, companyId: string, expenseRequestId: string) {
    return tx
      .select()
      .from(expenseApprovals)
      .where(
        and(
          eq(expenseApprovals.companyId, companyId),
          eq(expenseApprovals.expenseRequestId, expenseRequestId),
        ),
      )
      .orderBy(expenseApprovals.approvalLevel);
  }

  /**
   * SEC-1 tenant-FK guard: user phải tồn tại, active, cùng tenant (FK trỏ PK toàn cục → chéo tenant
   * vẫn thoả ràng buộc DB; phải chặn app-side). Mirror TasksRepository.assigneeActiveTx.
   */
  async userActiveTx(tx: TenantTx, companyId: string, userId: string): Promise<boolean> {
    const [row] = await tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.companyId, companyId),
          eq(users.id, userId),
          eq(users.status, "active"),
          isNull(users.deletedAt),
        ),
      )
      .limit(1);
    return row !== undefined;
  }
}
