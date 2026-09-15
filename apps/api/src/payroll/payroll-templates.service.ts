import { Injectable } from "@nestjs/common";
import type {
  CreatePayrollTemplateRequest,
  PayrollCatalogWriteResult,
  PayrollTemplateDetailDto,
  PayrollTemplateListQuery,
  PayrollTemplatePreviewRequest,
  PayrollTemplatePreviewResult,
  PutPayrollTemplateComponentsRequest,
  UpdatePayrollTemplateRequest,
} from "@mediaos/contracts";
import { paginated, toPagination } from "../common/pagination";
import { DatabaseService } from "../db/db.service";
import type { PayrollTemplate } from "../db/schema/payroll";
import { AuditService } from "../events/audit.service";
import { D, type Dec } from "./formula/formula.decimal";
import { isFormulaError } from "./formula/formula.errors";
import { Budget } from "./formula/formula.evaluator";
import { evaluatePass } from "./formula/formula.graph";
import { TEMPLATE_MAX_COMPONENTS } from "./formula/formula.limits";
import { toStatutoryValues, type StatutoryValues } from "./formula/formula.statutory";
import { SYS_REFS, type SysRef } from "./formula/formula.vocabulary";
import { PayrollAccessService } from "./payroll-access.service";
import { payrollCatalogLockTx } from "./payroll-catalog.lock";
import {
  compileOrThrow,
  fingerprintOf,
  templateGraphComponent,
  toTemplateComponentDto,
  toTemplateDto,
} from "./payroll-catalog.support";
import {
  PayrollTemplatesRepository,
  type TemplateComponentInsert,
  type TemplateComponentRow,
} from "./payroll-templates.repository";
import {
  formulaErrorToHttp,
  mapPayrollPgError,
  payrollDetails,
  payrollNotFound,
  payrollUnprocessable,
  PAYROLL_ERR,
} from "./payroll.errors";
import type { PayrollRequestUser } from "./payroll.types";
import { SalaryComponentsRepository } from "./salary-components.repository";

/** Loại giá trị KHÔNG nhận ghi đè công thức: engine do máy cộng; profile_item lấy định mức theo hồ sơ lương. */
const OVERRIDE_FORBIDDEN: ReadonlySet<string> = new Set(["engine", "profile_item"]);

/** Tóm tắt thành phần cho audit 053 — công thức/nhãn/ẩn hiện/thứ tự, KHÔNG số tiền. */
const auditSummary = (
  r: Pick<
    TemplateComponentRow,
    "code" | "formulaOverride" | "isVisible" | "sortOrder" | "columnLabel"
  >,
) => ({
  code: r.code,
  formulaOverride: r.formulaOverride,
  isVisible: r.isVisible,
  sortOrder: r.sortOrder,
  columnLabel: r.columnLabel,
});

/**
 * S15-PAYROLL-BE-2 — `PAYROLL-API-049..054`: mẫu bảng lương.
 *
 * - 053 ĐẶT LẠI toàn bộ danh sách trong MỘT transaction (advisory lock catalog → `FOR UPDATE` hàng mẫu → kiểm đồ
 *   thị trên TRẠNG THÁI SAU → DELETE rồi INSERT). Sửa từng dòng rời làm đồ thị tạm thời có vòng giữa chừng.
 * - 054 xem trước: **0 lượt đọc dữ liệu thật** ngoài mẫu + catalog; KHÔNG đọc `payroll_statutory_rates` (tránh
 *   đọc-xuyên cặp `view:statutory-rate`); không ghi; KHÔNG audit (§18.1 B — dữ liệu giả). Fail-closed: mẫu thiếu 4
 *   nút aggregate ⇒ 422 018, không bao giờ 200 với số 0.
 */
@Injectable()
export class PayrollTemplatesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: PayrollAccessService,
    private readonly repo: PayrollTemplatesRepository,
    private readonly components: SalaryComponentsRepository,
    private readonly audit: AuditService,
  ) {}

  /** 049 */
  async list(user: PayrollRequestUser, query: PayrollTemplateListQuery) {
    await this.access.resolveActor(user, "templateList");
    return this.db.withTenant(user.companyId, async (tx) => {
      const { rows, total } = await this.repo.listTx(tx, user.companyId, {
        scope: query.scope,
        isActive: query.isActive,
        page: query.page,
        perPage: query.per_page,
      });
      return paginated(rows.map(toTemplateDto), toPagination(total, query.page, query.per_page));
    });
  }

  /** 051 — chi tiết + thành phần + fingerprint tập công thức HIỆN TẠI (§13.6 G tầng 1). */
  async get(user: PayrollRequestUser, id: string): Promise<PayrollTemplateDetailDto> {
    await this.access.resolveActor(user, "templateDetail");
    return this.db.withTenant(user.companyId, async (tx) => {
      const row = await this.repo.findTx(tx, user.companyId, id);
      if (!row) throw payrollNotFound();
      const rows = await this.repo.componentsTx(tx, user.companyId, id);
      return {
        ...toTemplateDto(row),
        components: rows.map(toTemplateComponentDto),
        formulaSetFingerprint: fingerprintOf(rows),
      };
    });
  }

  /** 050 — tạo mẫu RỖNG; thành phần đặt qua 053. */
  async create(
    user: PayrollRequestUser,
    dto: CreatePayrollTemplateRequest,
  ): Promise<PayrollCatalogWriteResult> {
    await this.access.resolveActor(user, "templateCreate");
    return this.db.withTenant(user.companyId, async (tx) => {
      await payrollCatalogLockTx(tx, user.companyId);
      const orgUnitId = dto.scope === "org_unit" ? (dto.orgUnitId ?? null) : null;
      if (orgUnitId !== null && !(await this.repo.orgUnitLiveTx(tx, user.companyId, orgUnitId))) {
        throw payrollNotFound();
      }
      let row: PayrollTemplate;
      try {
        row = await this.repo.createTx(
          tx,
          user.companyId,
          dto.code,
          { name: dto.name, scope: dto.scope, orgUnitId, isActive: dto.isActive },
          user.id,
        );
      } catch (err) {
        throw mapPayrollPgError(err) ?? err;
      }
      await this.audit.record(tx, {
        action: "create",
        objectType: "payroll_template",
        objectId: row.id,
        actorUserId: user.id,
        before: null,
        after: {
          code: row.code,
          scope: row.scope,
          orgUnitId: row.orgUnitId,
          isActive: row.isActive,
        },
      });
      return { id: row.id };
    });
  }

  /** 052 — sửa · ngưng dùng · xoá mềm (`{delete:true}`). Cặp scope kiểm trên hàng SAU MERGE. */
  async update(
    user: PayrollRequestUser,
    id: string,
    dto: UpdatePayrollTemplateRequest,
  ): Promise<PayrollCatalogWriteResult> {
    await this.access.resolveActor(user, "templateUpdate");
    return this.db.withTenant(user.companyId, async (tx) => {
      await payrollCatalogLockTx(tx, user.companyId);
      const before = await this.repo.findTx(tx, user.companyId, id, { forUpdate: true });
      if (!before) throw payrollNotFound();
      const summary = (t: PayrollTemplate) => ({
        code: t.code,
        scope: t.scope,
        orgUnitId: t.orgUnitId,
        isActive: t.isActive,
      });

      if (dto.delete === true) {
        const deleted = await this.repo.softDeleteTx(tx, user.companyId, id, user.id);
        if (!deleted) throw payrollNotFound();
        await this.audit.record(tx, {
          action: "delete",
          objectType: "payroll_template",
          objectId: id,
          actorUserId: user.id,
          before: summary(before),
          after: null,
        });
        return { id };
      }

      const scope = dto.scope ?? before.scope;
      // Đổi sang `company` mà không gửi `orgUnitId` ⇒ tự bỏ đơn vị (mẫu toàn công ty không gắn đơn vị).
      const orgUnitId =
        dto.orgUnitId !== undefined
          ? dto.orgUnitId
          : dto.scope === "company"
            ? null
            : before.orgUnitId;
      if ((scope === "org_unit") !== (orgUnitId !== null)) {
        throw payrollUnprocessable(
          "FORMULA_INVALID",
          PAYROLL_ERR.TEMPLATE_SCOPE_PAIR,
          payrollDetails("template-scope-pair"),
        );
      }
      if (
        orgUnitId !== null &&
        orgUnitId !== before.orgUnitId &&
        !(await this.repo.orgUnitLiveTx(tx, user.companyId, orgUnitId))
      ) {
        throw payrollNotFound();
      }

      let row: PayrollTemplate | null;
      try {
        row = await this.repo.updateTx(
          tx,
          user.companyId,
          id,
          { name: dto.name, scope, orgUnitId, isActive: dto.isActive },
          user.id,
        );
      } catch (err) {
        throw mapPayrollPgError(err) ?? err;
      }
      if (!row) throw payrollNotFound();
      await this.audit.record(tx, {
        action: "update",
        objectType: "payroll_template",
        objectId: id,
        actorUserId: user.id,
        before: summary(before),
        after: { ...summary(row), changedFields: Object.keys(dto) },
      });
      return { id };
    });
  }

  /** 053 — ĐẶT LẠI toàn bộ thành phần của mẫu; kiểm trên TRẠNG THÁI SAU. */
  async putComponents(
    user: PayrollRequestUser,
    id: string,
    dto: PutPayrollTemplateComponentsRequest,
  ): Promise<PayrollCatalogWriteResult> {
    await this.access.resolveActor(user, "templatePutComponents");
    if (dto.components.length > TEMPLATE_MAX_COMPONENTS) {
      throw payrollUnprocessable(
        "FORMULA_INVALID",
        PAYROLL_ERR.TEMPLATE_TOO_MANY_COMPONENTS(TEMPLATE_MAX_COMPONENTS),
        payrollDetails("template-too-many-components", { max: TEMPLATE_MAX_COMPONENTS }),
      );
    }
    const ids = dto.components.map((c) => c.componentId);
    if (new Set(ids).size !== ids.length) {
      throw payrollUnprocessable(
        "FORMULA_INVALID",
        PAYROLL_ERR.TEMPLATE_COMPONENT_DUPLICATE,
        payrollDetails("template-component-duplicate"),
      );
    }

    return this.db.withTenant(user.companyId, async (tx) => {
      await payrollCatalogLockTx(tx, user.companyId);
      const template = await this.repo.findTx(tx, user.companyId, id, { forUpdate: true });
      if (!template) throw payrollNotFound();

      const catalog = new Map(
        (await this.components.findManyTx(tx, user.companyId, ids)).map((c) => [c.id, c]),
      );
      if (ids.some((cid) => catalog.get(cid)?.isActive !== true)) {
        throw payrollUnprocessable(
          "FORMULA_INVALID",
          PAYROLL_ERR.TEMPLATE_COMPONENT_UNKNOWN,
          payrollDetails("template-component-unknown"),
        );
      }

      const after: TemplateComponentRow[] = dto.components.map((input) => {
        const c = catalog.get(input.componentId)!;
        return {
          componentId: c.id,
          code: c.code,
          name: c.name,
          kind: c.kind,
          valueType: c.valueType,
          catalogFormula: c.formula,
          fixedAmount: c.fixedAmount,
          pitDeductible: c.pitDeductible,
          isSystem: c.isSystem,
          componentActive: c.isActive,
          componentDeletedAt: c.deletedAt,
          columnLabel: input.columnLabel ?? null,
          formulaOverride: input.formulaOverride ?? null,
          isVisible: input.isVisible,
          sortOrder: input.sortOrder,
        };
      });
      const badOverrides = after.filter(
        (r) => r.formulaOverride !== null && OVERRIDE_FORBIDDEN.has(r.valueType),
      );
      if (badOverrides.length > 0) {
        const codes = badOverrides.map((r) => r.code).join(", ");
        throw payrollUnprocessable(
          "FORMULA_INVALID",
          PAYROLL_ERR.FORMULA_OVERRIDE_NOT_ALLOWED(codes),
          payrollDetails("formula-override-not-allowed", { components: codes }),
        );
      }
      compileOrThrow(after.map(templateGraphComponent), true, { template: template.code });

      const beforeRows = await this.repo.componentsTx(tx, user.companyId, id);
      const inserts: TemplateComponentInsert[] = after.map((r) => ({
        componentId: r.componentId,
        columnLabel: r.columnLabel,
        formulaOverride: r.formulaOverride,
        isVisible: r.isVisible,
        sortOrder: r.sortOrder,
      }));
      try {
        await this.repo.replaceComponentsTx(tx, user.companyId, id, inserts, user.id);
      } catch (err) {
        throw mapPayrollPgError(err) ?? err;
      }
      await this.audit.record(tx, {
        action: "update",
        objectType: "payroll_template",
        objectId: id,
        actorUserId: user.id,
        before: { components: beforeRows.map(auditSummary) },
        after: { components: after.map(auditSummary) },
      });
      return { id };
    });
  }

  /** 054 — xem trước với dữ liệu GIẢ do client gửi. KHÔNG ghi, KHÔNG audit. */
  async preview(
    user: PayrollRequestUser,
    id: string,
    dto: PayrollTemplatePreviewRequest,
  ): Promise<PayrollTemplatePreviewResult> {
    await this.access.resolveActor(user, "templatePreview");
    const statutory = PayrollTemplatesService.statutoryOrThrow(dto);
    const sys = Object.fromEntries(SYS_REFS.map((k) => [k, new D(dto.inputs[k] ?? "0")])) as Record<
      SysRef,
      Dec
    >;
    const profileItems = Object.fromEntries(
      Object.entries(dto.profileItems).map(([k, v]) => [k, new D(v)]),
    ) as Record<string, Dec>;

    const rows = await this.db.withTenant(user.companyId, async (tx) => {
      const template = await this.repo.findTx(tx, user.companyId, id);
      if (!template) throw payrollNotFound();
      return this.repo.componentsTx(tx, user.companyId, id);
    });
    // Fail-closed: thành phần ngưng dùng HOẶC đã xoá mềm lọt vào mẫu (ghi thẳng DB) ⇒ không tính trên nó
    // (security-review BE-2 LOW-7).
    if (rows.some((r) => !r.componentActive || r.componentDeletedAt !== null)) {
      throw payrollUnprocessable(
        "FORMULA_INVALID",
        PAYROLL_ERR.TEMPLATE_COMPONENT_UNKNOWN,
        payrollDetails("template-component-unknown"),
      );
    }
    // Khoá `profileItems` không khớp thành phần `profile_item` nào của mẫu ⇒ 422, KHÔNG âm thầm = 0 (khoá gõ sai,
    // khoá của thành phần không phải profile_item) — silent-failure-hunter BE-2 MEDIUM-2.
    const profileCodes = new Set(
      rows.filter((r) => r.valueType === "profile_item").map((r) => r.code),
    );
    const unknownItems = Object.keys(dto.profileItems)
      .filter((k) => !profileCodes.has(k))
      .sort();
    if (unknownItems.length > 0) {
      throw payrollUnprocessable(
        "FORMULA_INVALID",
        PAYROLL_ERR.PROFILE_ITEM_UNKNOWN_COMPONENT(unknownItems.join(", ")),
        payrollDetails("profile-item-unknown-component", {
          componentCodes: unknownItems.join(","),
        }),
      );
    }
    const graph = compileOrThrow(rows.map(templateGraphComponent), true);
    const budget = new Budget();
    let values: Map<string, Dec>;
    try {
      values = evaluatePass(
        graph,
        { sys, profileItems, pitPayer: dto.pitPayer, statutory },
        budget,
      );
    } catch (err) {
      if (isFormulaError(err)) throw formulaErrorToHttp(err);
      throw err;
    }
    return {
      columns: rows.map((r) => ({
        code: r.code,
        label: r.columnLabel ?? r.name,
        kind: r.kind as PayrollTemplatePreviewResult["columns"][number]["kind"],
        isVisible: r.isVisible,
        sortOrder: r.sortOrder,
      })),
      values: Object.fromEntries([...values].map(([code, v]) => [code, v.toFixed(2)])),
      formulaSetFingerprint: fingerprintOf(rows),
      nodesVisited: budget.visitsInLine,
    };
  }

  private static statutoryOrThrow(dto: PayrollTemplatePreviewRequest): StatutoryValues {
    try {
      return toStatutoryValues(dto.statutory);
    } catch (err) {
      if (isFormulaError(err)) throw formulaErrorToHttp(err);
      throw err;
    }
  }
}
