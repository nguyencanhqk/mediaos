import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  decideExpenseSchema,
  type CreateExpenseRequestRequest,
  type DecideExpenseRequest,
  type ExpenseRequestDto,
  type ListExpenseQuery,
} from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { OutboxService } from "../events/outbox.service";
import { PermissionService } from "../permission/permission.service";
import { CostRepository } from "./cost.repository";
import { ExpenseRequestRepository } from "./expense.repository";
import { FinanceTasksService } from "./finance-tasks.service";

/**
 * G13-4 — ExpenseRequestService: đề xuất chi → duyệt QUA Task Hub (task_type='finance', BẤT BIẾN #4)
 * → khi duyệt SINH cost_record (lineage qua expense_request_id) + ghi expense_approvals (log
 * append-only) + audit. KHÔNG bảng/luồng duyệt riêng; expense_approvals CHỈ là log, tasks là nguồn việc.
 *
 * Hợp đồng:
 *  - KHÔNG có update()/delete() — expense_approvals + cost_records APPEND-ONLY (chỉ INSERT).
 *    expense_requests mutable status (GRANT UPDATE) qua updateStatusTx, KHÔNG xoá.
 *  - Permission fail-closed NGOÀI tx: create=create:expense-request, approve/reject=approve:expense-request
 *    (KHÁC create:finance). Deny ⇒ KHÔNG mở tx ⇒ 0 side-effect (0 task, 0 cost, 0 approval).
 *  - SEC-1 tenant-FK guard (approverUserId trỏ PK toàn cục) TRƯỚC insert.
 *  - Atomicity: task + request + (cost+approval+status+đóng-task) cùng 1 tx (1 commit/rollback);
 *    audit+outbox cùng tx.
 *  - Số tiền expense KHÔNG mask (requester/approver phải thấy số mình đề xuất/duyệt) — khác sổ cái revenue/cost.
 */

const RESOURCE_TYPE = "expense-request";
const ACTION_CREATE = "create";
const ACTION_APPROVE = "approve";

/** numeric (number) → string cho Drizzle; chặn giá trị không hữu hạn ở boundary. */
function numToStr(value: number): string {
  if (!Number.isFinite(value)) throw new BadRequestException(`Invalid amount: ${value}`);
  return value.toFixed(2);
}

/** Hàng expense_requests đọc từ Drizzle (numeric → string; timestamp → Date). */
interface ExpenseRow {
  id: string;
  companyId: string;
  requestedBy: string;
  orgUnitId: string | null;
  projectId: string | null;
  channelId: string | null;
  title: string;
  description: string | null;
  amount: string;
  currency: string;
  expenseType: string;
  neededAt: string | null;
  status: string;
  currentApprovalLevel: number;
  attachmentUrl: string | null;
  taskId: string | null;
  costRecordId: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

@Injectable()
export class ExpenseRequestService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ExpenseRequestRepository,
    private readonly costRepo: CostRepository,
    private readonly financeTasks: FinanceTasksService,
    private readonly permissions: PermissionService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /** Liệt kê đề xuất chi của tenant (RLS lọc). `mine` ⇒ chỉ request do caller tạo. */
  async list(
    companyId: string,
    userId: string,
    query: ListExpenseQuery = {},
  ): Promise<ExpenseRequestDto[]> {
    const rows = await this.repo.list(companyId, {
      status: query.status,
      mineUserId: query.mine ? userId : undefined,
    });
    return rows.map((r) => this.toDto(r as ExpenseRow));
  }

  /**
   * Tạo đề xuất chi → SINH 1 task duyệt ở Task Hub (task_type='finance') trong CÙNG tx. Permission
   * create:expense-request check NGOÀI tx (fail-closed). SEC-1 guard approverUserId cùng tenant.
   */
  async create(
    companyId: string,
    userId: string,
    dto: CreateExpenseRequestRequest,
  ): Promise<ExpenseRequestDto> {
    await this.assertCan(companyId, userId, ACTION_CREATE);

    return this.db.withTenant(companyId, async (tx) => {
      // SEC-1: approver phải active + cùng tenant (FK trỏ PK toàn cục → chéo tenant vẫn thoả DB).
      const approverOk = await this.repo.userActiveTx(tx, companyId, dto.approverUserId);
      if (!approverOk) {
        throw new BadRequestException(
          "Người duyệt không hợp lệ (không cùng công ty hoặc đã ngưng hoạt động).",
        );
      }

      const inserted = await this.repo.insertRequestTx(tx, companyId, {
        requestedBy: userId,
        title: dto.title,
        description: dto.description ?? null,
        amount: numToStr(dto.amount),
        currency: dto.currency,
        expenseType: dto.expenseType,
        neededAt: dto.neededAt ?? null,
        orgUnitId: dto.orgUnitId ?? null,
        projectId: dto.projectId ?? null,
        channelId: dto.channelId ?? null,
        attachmentUrl: dto.attachmentUrl ?? null,
      });

      // Task Hub: tạo task duyệt giao cho approver (cùng tx) → set task_id lên request.
      const task = await this.financeTasks.createApprovalTaskTx(tx, companyId, {
        title: `Duyệt chi: ${dto.title}`,
        assigneeUserId: dto.approverUserId,
        dueDate: dto.neededAt ? new Date(dto.neededAt) : null,
      });
      const updated = await this.repo.updateStatusTx(tx, companyId, inserted.id, {
        taskId: task.id,
      });

      await this.audit.record(tx, {
        action: "ExpenseRequestCreated",
        objectType: "expense_request",
        objectId: inserted.id,
        actorUserId: userId,
        after: {
          title: dto.title,
          amount: inserted.amount,
          expenseType: dto.expenseType,
          approverUserId: dto.approverUserId,
          taskId: task.id,
        },
      });
      await this.outbox.enqueue(tx, {
        eventType: "finance.expense.created",
        payload: { expenseRequestId: inserted.id, taskId: task.id, actorUserId: userId },
      });

      return this.toDto((updated ?? inserted) as ExpenseRow);
    });
  }

  /**
   * Quyết định đề xuất (approve/reject). Permission approve:expense-request check NGOÀI tx (fail-closed).
   * approve ⇒ sinh cost_record(original, lineage) + approval(approved) + status='approved'+cost_record_id +
   *   đóng task('approved') + audit ExpenseApproved/CostCreated. reject ⇒ approval(rejected, comment) +
   *   status='rejected' + đóng task('completed') + audit ExpenseRejected; KHÔNG sinh cost.
   */
  async decide(
    companyId: string,
    userId: string,
    expenseId: string,
    input: DecideExpenseRequest,
  ): Promise<ExpenseRequestDto> {
    // Validate ở biên service (mirror contract — reject phải có comment). Không chạm DB nếu sai.
    const parsed = decideExpenseSchema.safeParse(input);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues[0]?.message ?? "Quyết định duyệt không hợp lệ.",
      );
    }
    const decision = parsed.data;

    await this.assertCan(companyId, userId, ACTION_APPROVE);

    return this.db.withTenant(companyId, async (tx) => {
      const expense = await this.repo.findByIdTx(tx, companyId, expenseId);
      if (!expense) throw new NotFoundException(`Expense request not found: ${expenseId}`);
      // Idempotent guard (CỘNG uq DB) — chỉ duyệt khi còn pending; chặn double-cost khi 2 approver đua.
      if (expense.status !== "pending") {
        throw new BadRequestException(
          `Đề xuất chi không ở trạng thái chờ duyệt (status=${expense.status}).`,
        );
      }
      const level = expense.currentApprovalLevel;

      if (decision.decision === "approved") {
        // 1) Sinh cost_record gốc (lineage qua expense_request_id) — append-only INSERT.
        const cost = await this.costRepo.insertTx(tx, {
          costType: expense.expenseType,
          amount: expense.amount,
          currency: expense.currency,
          costDate: new Date().toISOString().slice(0, 10),
          orgUnitId: expense.orgUnitId,
          projectId: expense.projectId,
          channelId: expense.channelId,
          vendorName: null,
          description: expense.title,
          attachmentUrl: expense.attachmentUrl,
          enteredBy: userId,
          entryKind: "original",
          replacesRecordId: null,
          expenseRequestId: expense.id,
        });

        // 2) Log quyết định (append-only; uq(request,level) chặn race) + 3) cập nhật status/cost.
        await this.repo.insertApprovalTx(tx, companyId, {
          expenseRequestId: expense.id,
          approvalLevel: level,
          approverUserId: userId,
          decision: "approved",
          comment: decision.comment ?? null,
        });
        const updated = await this.repo.updateStatusTx(tx, companyId, expense.id, {
          status: "approved",
          costRecordId: cost.id,
        });

        // 4) Đóng task duyệt.
        if (expense.taskId) {
          await this.financeTasks.closeTaskTx(tx, companyId, expense.taskId, "approved");
        }

        await this.audit.record(tx, {
          action: "ExpenseApproved",
          objectType: "expense_request",
          objectId: expense.id,
          actorUserId: userId,
          before: { status: expense.status },
          after: { status: "approved", costRecordId: cost.id, approvalLevel: level },
        });
        await this.audit.record(tx, {
          action: "CostCreated",
          objectType: "cost_record",
          objectId: cost.id,
          actorUserId: userId,
          after: {
            amount: cost.amount,
            costType: cost.costType,
            expenseRequestId: expense.id,
          },
        });
        await this.outbox.enqueue(tx, {
          eventType: "finance.expense.approved",
          payload: {
            expenseRequestId: expense.id,
            costRecordId: cost.id,
            actorUserId: userId,
          },
        });

        return this.toDto((updated ?? expense) as ExpenseRow);
      }

      // reject — log quyết định (comment bắt buộc đã validate), status='rejected', đóng task; KHÔNG cost.
      await this.repo.insertApprovalTx(tx, companyId, {
        expenseRequestId: expense.id,
        approvalLevel: level,
        approverUserId: userId,
        decision: "rejected",
        comment: decision.comment ?? null,
      });
      const updated = await this.repo.updateStatusTx(tx, companyId, expense.id, {
        status: "rejected",
      });
      if (expense.taskId) {
        await this.financeTasks.closeTaskTx(tx, companyId, expense.taskId, "completed");
      }

      await this.audit.record(tx, {
        action: "ExpenseRejected",
        objectType: "expense_request",
        objectId: expense.id,
        actorUserId: userId,
        before: { status: expense.status },
        after: { status: "rejected", comment: decision.comment, approvalLevel: level },
      });
      await this.outbox.enqueue(tx, {
        eventType: "finance.expense.rejected",
        payload: { expenseRequestId: expense.id, actorUserId: userId },
      });

      return this.toDto((updated ?? expense) as ExpenseRow);
    });
  }

  /** Map row DB → DTO. Số tiền KHÔNG mask (khác sổ cái revenue/cost). numeric(18,2) → number. */
  private toDto(row: ExpenseRow): ExpenseRequestDto {
    const iso = (v: Date | string): string => (v instanceof Date ? v.toISOString() : String(v));
    return {
      id: row.id,
      companyId: row.companyId,
      requestedBy: row.requestedBy,
      orgUnitId: row.orgUnitId,
      projectId: row.projectId,
      channelId: row.channelId,
      title: row.title,
      description: row.description,
      amount: Number(row.amount),
      currency: row.currency,
      expenseType: row.expenseType as ExpenseRequestDto["expenseType"],
      neededAt: row.neededAt,
      status: row.status as ExpenseRequestDto["status"],
      currentApprovalLevel: row.currentApprovalLevel,
      attachmentUrl: row.attachmentUrl,
      taskId: row.taskId,
      costRecordId: row.costRecordId,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    };
  }

  /**
   * Fail-closed permission gate. KIỂM TRA NGOÀI tx → deny không mở transaction ⇒ KHÔNG side-effect.
   * Lỗi hạ tầng trong can() ⇒ deny (PermissionService.can fail-closed nội bộ).
   */
  private async assertCan(companyId: string, userId: string, action: string): Promise<void> {
    const decision = await this.permissions.can({
      userId,
      companyId,
      action,
      resourceType: RESOURCE_TYPE,
    });
    if (!decision.allow) {
      throw new ForbiddenException(`Permission denied: ${decision.reason}`);
    }
  }
}
