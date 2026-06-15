import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  ComputeKpiRequest,
  ConfirmKpiResultRequest,
  CreateKpiDefinitionRequest,
  KpiComponentWeights,
} from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { OutboxService } from "../events/outbox.service";
import { PermissionService } from "../permission/permission.service";
import { KpiRepository } from "./kpi.repository";
import {
  aggregateComponentScores,
  assertWeightSum,
  computeKpiTotalScore,
} from "./kpi.formula";

/**
 * G8-4 — KpiService: định nghĩa KPI (trọng số 5 thành phần) + tính KPI cá nhân/team (snapshot append-only).
 *
 * 5 chốt fail-closed:
 *  (a) RLS 2-tenant — mọi đọc/ghi/aggregate qua withTenant (RLS ép company_id ở DB, bất biến #1).
 *  (b) Append-only  — kpi_results chỉ INSERT (DB từ chối UPDATE/DELETE cho app role); confirm = snapshot mới.
 *  (c) Permission   — manage:kpi-definition (CRUD def) · read:kpi (compute) · confirm:kpi (xác nhận)
 *                     check TRƯỚC khi mở tx → deny ⇒ KHÔNG side-effect (mirror EvaluationService).
 *  (d) Audit        — computeKpi ghi object_type='kpi_result'; createDefinition ghi 'kpi_definition';
 *                     confirm ghi 'kpi_result' — CÙNG tx, không nuốt lỗi.
 *  (e) BR-007       — compute → confirmed_by/confirmed_at NULL (THAM KHẢO); confirm chỉ qua confirm:kpi,
 *                     INSERT snapshot MỚI có cờ (KHÔNG mutate bản cũ), KHÔNG đụng payroll.
 */

const DEFINITION_RESOURCE = "kpi-definition";
const DEFINITION_ACTION = "manage";
const READ_RESOURCE = "kpi";
const READ_ACTION = "read";
const CONFIRM_RESOURCE = "kpi";
const CONFIRM_ACTION = "confirm";

/** numeric (number) → string cho Drizzle; chặn giá trị không hữu hạn ở boundary. */
function numToStr(value: number, scale = 2): string {
  if (!Number.isFinite(value)) throw new BadRequestException(`Giá trị không hợp lệ: ${value}`);
  return value.toFixed(scale);
}

@Injectable()
export class KpiService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: KpiRepository,
    private readonly permissions: PermissionService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  // ─── Definitions (manage:kpi-definition) ────────────────────────────────────

  listDefinitions(companyId: string, _userId: string, opts: { includeInactive?: boolean } = {}) {
    return this.repo.listDefinitions(companyId, opts);
  }

  /** Tạo định nghĩa KPI (trọng số 5 thành phần, tổng=100). audit 'kpi_definition' cùng tx. */
  async createDefinition(companyId: string, userId: string, dto: CreateKpiDefinitionRequest) {
    await this.assertCan(companyId, userId, DEFINITION_ACTION, DEFINITION_RESOURCE);
    assertWeightSum(dto.weights);

    return this.db.withTenant(companyId, async (tx) => {
      const def = await this.repo.insertDefinitionTx(tx, {
        name: dto.name,
        description: dto.description ?? null,
        weights: dto.weights,
      });
      await this.audit.record(tx, {
        action: "KpiDefinitionCreated",
        objectType: "kpi_definition",
        objectId: def.id,
        actorUserId: userId,
        after: { name: def.name },
      });
      return def;
    });
  }

  // ─── Compute (read:kpi) — snapshot append-only ──────────────────────────────

  /**
   * Tính KPI cho 1 chủ thể (user XOR team) trong kỳ → INSERT 1 snapshot kpi_results.
   * BR-007: confirmed_by/confirmed_at = NULL (THAM KHẢO). audit object_type='kpi_result' CÙNG tx.
   * Permission read:kpi check NGOÀI tx → deny ⇒ KHÔNG side-effect.
   */
  async computeKpi(companyId: string, userId: string, dto: ComputeKpiRequest) {
    await this.assertCan(companyId, userId, READ_ACTION, READ_RESOURCE);

    const hasUser = Boolean(dto.subjectUserId);
    const hasTeam = Boolean(dto.subjectTeamId);
    if (hasUser === hasTeam) {
      throw new BadRequestException("Phải có đúng 1 chủ thể: subjectUserId HOẶC subjectTeamId.");
    }

    return this.db.withTenant(companyId, async (tx) => {
      const def = await this.repo.findDefinitionByIdTx(tx, companyId, dto.definitionId);
      if (!def) throw new NotFoundException(`Định nghĩa KPI không tồn tại: ${dto.definitionId}`);
      const weights = def.weights as KpiComponentWeights;
      assertWeightSum(weights);

      // Chủ thể → tập user_id (user đơn, hoặc members của team).
      let userIds: string[];
      if (hasUser) {
        userIds = [dto.subjectUserId as string];
      } else {
        userIds = await this.repo.findTeamMemberUserIdsTx(tx, companyId, dto.subjectTeamId as string);
      }

      const raw = await this.repo.aggregateRawMetricsTx(tx, {
        companyId,
        userIds,
        periodStart: dto.periodStart,
        periodEnd: dto.periodEnd,
      });
      const components = aggregateComponentScores(raw);
      const totalScore = computeKpiTotalScore(weights, components);

      const result = await this.repo.insertResultTx(tx, {
        definitionId: dto.definitionId,
        subjectUserId: dto.subjectUserId ?? null,
        subjectTeamId: dto.subjectTeamId ?? null,
        periodStart: dto.periodStart,
        periodEnd: dto.periodEnd,
        tasksDone: numToStr(components.tasksDone),
        onTimeRate: numToStr(components.onTimeRate),
        evaluationScore: numToStr(components.evaluationScore),
        defectScore: numToStr(components.defectScore),
        firstPassApprovalRate: numToStr(components.firstPassApprovalRate),
        totalScore: numToStr(totalScore),
        confirmedBy: null, // BR-007: THAM KHẢO — chưa xác nhận.
        confirmedAt: null,
        computedBy: userId,
      });

      await this.audit.record(tx, {
        action: "KpiComputed",
        objectType: "kpi_result",
        objectId: result.id,
        actorUserId: userId,
        after: {
          definitionId: dto.definitionId,
          subjectUserId: dto.subjectUserId ?? null,
          subjectTeamId: dto.subjectTeamId ?? null,
          totalScore: result.totalScore,
        },
      });
      await this.outbox.enqueue(tx, {
        eventType: "kpi.computed",
        payload: { kpiResultId: result.id, definitionId: dto.definitionId, actorUserId: userId },
      });
      return result;
    });
  }

  // ─── Confirm (confirm:kpi) — BR-007: snapshot mới có cờ xác nhận ─────────────

  /**
   * Xác nhận 1 kết quả KPI (BR-007): chỉ confirm:kpi. INSERT snapshot MỚI sao chép số liệu + set
   * confirmed_by/confirmed_at (APPEND-ONLY — KHÔNG mutate bản gốc). audit object_type='kpi_result' cùng tx.
   */
  async confirmResult(companyId: string, userId: string, dto: ConfirmKpiResultRequest) {
    await this.assertCan(companyId, userId, CONFIRM_ACTION, CONFIRM_RESOURCE);

    return this.db.withTenant(companyId, async (tx) => {
      const src = await this.repo.findResultByIdTx(tx, companyId, dto.kpiResultId);
      if (!src) throw new NotFoundException(`Kết quả KPI không tồn tại: ${dto.kpiResultId}`);
      if (src.confirmedAt) {
        throw new BadRequestException("Kết quả KPI này đã được xác nhận.");
      }

      const confirmed = await this.repo.insertResultTx(tx, {
        definitionId: src.definitionId,
        subjectUserId: src.subjectUserId,
        subjectTeamId: src.subjectTeamId,
        periodStart: (src.periodStart as Date).toISOString(),
        periodEnd: (src.periodEnd as Date).toISOString(),
        tasksDone: src.tasksDone,
        onTimeRate: src.onTimeRate,
        evaluationScore: src.evaluationScore,
        defectScore: src.defectScore,
        firstPassApprovalRate: src.firstPassApprovalRate,
        totalScore: src.totalScore,
        confirmedBy: userId,
        confirmedAt: new Date().toISOString(),
        computedBy: src.computedBy,
      });

      await this.audit.record(tx, {
        action: "KpiConfirmed",
        objectType: "kpi_result",
        objectId: confirmed.id,
        actorUserId: userId,
        after: { sourceKpiResultId: src.id, totalScore: confirmed.totalScore },
      });
      await this.outbox.enqueue(tx, {
        eventType: "kpi.confirmed",
        payload: {
          kpiResultId: confirmed.id,
          sourceKpiResultId: src.id,
          actorUserId: userId,
        },
      });
      return confirmed;
    });
  }

  // ─── Internals ──────────────────────────────────────────────────────────────

  /** Fail-closed permission gate. KIỂM TRA NGOÀI tx → deny không mở transaction ⇒ KHÔNG side-effect. */
  private async assertCan(
    companyId: string,
    userId: string,
    action: string,
    resourceType: string,
  ): Promise<void> {
    const decision = await this.permissions.can({ userId, companyId, action, resourceType });
    if (!decision.allow) {
      throw new ForbiddenException(`Permission denied: ${decision.reason}`);
    }
  }
}
