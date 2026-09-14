import { Injectable } from "@nestjs/common";
import type {
  CreateSalaryComponentRequest,
  PayrollCatalogWriteResult,
  SalaryComponentDetailDto,
  SalaryComponentListQuery,
  UpdateSalaryComponentRequest,
  ValidateFormulaRequest,
  ValidateFormulaResult,
} from "@mediaos/contracts";
import { paginated, toPagination } from "../common/pagination";
import { DatabaseService } from "../db/db.service";
import type { SalaryComponent } from "../db/schema/payroll";
import { AuditService } from "../events/audit.service";
import { isFormulaError } from "./formula/formula.errors";
import { compileGraph, type GraphComponent } from "./formula/formula.graph";
import { parseFormula } from "./formula/formula.parser";
import { PayrollAccessService } from "./payroll-access.service";
import { payrollCatalogLockTx } from "./payroll-catalog.lock";
import {
  catalogGraphComponent,
  compileOrThrow,
  formulaIssueOf,
  isReservedComponentCode,
  moneyInput,
  templateGraphComponent,
  toSalaryComponentDto,
  valuePairOk,
} from "./payroll-catalog.support";
import { PayrollTemplatesRepository } from "./payroll-templates.repository";
import {
  mapPayrollPgError,
  payrollConflict,
  payrollDetails,
  payrollNotFound,
  payrollUnprocessable,
  PAYROLL_ERR,
} from "./payroll.errors";
import type { PayrollRequestUser } from "./payroll.types";
import { SalaryComponentsRepository } from "./salary-components.repository";

/** Trường mà hàng `is_system` còn sửa được — mirror trigger `salary_component_system_freeze` (mig 0570). */
const SYSTEM_MUTABLE_FIELDS: ReadonlySet<string> = new Set(["name", "sortOrder"]);

/** Trường làm đổi đồ thị phụ thuộc (REF · cạnh ngầm aggregate · khả năng phân giải) ⇒ phải kiểm vòng lại. */
const GRAPH_FIELDS = ["formula", "kind", "valueType", "pitDeductible", "isActive"] as const;

/**
 * S15-PAYROLL-BE-2 — `PAYROLL-API-044..048`: catalog thành phần lương.
 *
 * - Mọi đường GHI lấy `payrollCatalogLockTx` TRƯỚC `FOR UPDATE` ⇒ kiểm vòng lúc LƯU đọc được trạng thái đã commit
 *   của lượt trước (SPEC-11 §13.6 E).
 * - Hàng `is_system` ĐÓNG BĂNG (plan-review BE-2 M1): chỉ `name`/`sortOrder`; tuỳ biến cách tính qua ghi đè công
 *   thức trong MẪU. Tiền-kiểm ở đây để trả 409 024 đọc được thay vì 23514 của trigger.
 * - Audit GHI kèm CHUỖI công thức cũ/mới (§13.6 I), KHÔNG kèm số tiền (MF14) — `changedFields` là TÊN trường.
 * - Envelope GHI `{ id }` — 0 khoá tiền.
 */
@Injectable()
export class SalaryComponentsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: PayrollAccessService,
    private readonly repo: SalaryComponentsRepository,
    private readonly templates: PayrollTemplatesRepository,
    private readonly audit: AuditService,
  ) {}

  /** 044 */
  async list(user: PayrollRequestUser, query: SalaryComponentListQuery) {
    await this.access.resolveActor(user, "componentList");
    return this.db.withTenant(user.companyId, async (tx) => {
      const { rows, total } = await this.repo.listTx(tx, user.companyId, {
        kind: query.kind,
        isSystem: query.isSystem,
        isActive: query.isActive,
        page: query.page,
        perPage: query.per_page,
      });
      return paginated(rows.map(toSalaryComponentDto), toPagination(total, query.page, query.per_page));
    });
  }

  /** 046 — chi tiết + danh sách mẫu (CHƯA XOÁ) đang tham chiếu. */
  async get(user: PayrollRequestUser, id: string): Promise<SalaryComponentDetailDto> {
    await this.access.resolveActor(user, "componentDetail");
    return this.db.withTenant(user.companyId, async (tx) => {
      const row = await this.repo.findTx(tx, user.companyId, id);
      if (!row) throw payrollNotFound();
      const usedByTemplates = await this.templates.templatesContainingTx(tx, user.companyId, id);
      return { ...toSalaryComponentDto(row), usedByTemplates };
    });
  }

  /** 045 — tạo thành phần tự thêm (route KHÔNG BAO GIỜ tạo hàng hệ thống). */
  async create(
    user: PayrollRequestUser,
    dto: CreateSalaryComponentRequest,
  ): Promise<PayrollCatalogWriteResult> {
    await this.access.resolveActor(user, "componentCreate");
    if (isReservedComponentCode(dto.code)) {
      throw payrollConflict(
        "COMPONENT_CONFLICT",
        PAYROLL_ERR.COMPONENT_CODE_RESERVED(dto.code),
        payrollDetails("component-code-reserved"),
      );
    }
    return this.db.withTenant(user.companyId, async (tx) => {
      await payrollCatalogLockTx(tx, user.companyId);
      const formula = dto.valueType === "formula" ? (dto.formula ?? null) : null;
      if (dto.valueType === "formula") {
        const catalog = await this.repo.listActiveTx(tx, user.companyId);
        // Đồ thị giả định mã DUY NHẤT — để mã trùng lọt vào compile là ra 422 019 với chu trình RỖNG
        // (security-review BE-2 LOW-4). Trùng hàng ngưng dùng: UNIQUE partial ⇒ 23505 ⇒ cùng 024.
        if (catalog.some((c) => c.code === dto.code)) {
          throw payrollConflict(
            "COMPONENT_CONFLICT",
            PAYROLL_ERR.COMPONENT_CODE_EXISTS,
            payrollDetails("component-code-exists"),
          );
        }
        compileOrThrow(
          [
            ...catalog.map(catalogGraphComponent),
            {
              code: dto.code,
              kind: dto.kind,
              valueType: "formula",
              formula,
              fixedAmount: null,
              pitDeductible: dto.pitDeductible,
            },
          ],
          false,
        );
      }
      let row: SalaryComponent;
      try {
        row = await this.repo.createTx(
          tx,
          user.companyId,
          dto.code,
          {
            name: dto.name,
            kind: dto.kind,
            valueType: dto.valueType,
            formula,
            fixedAmount:
              dto.valueType === "fixed" && typeof dto.fixedAmount === "number"
                ? moneyInput(dto.fixedAmount)
                : null,
            pitDeductible: dto.pitDeductible,
            isActive: dto.isActive,
            sortOrder: dto.sortOrder,
          },
          user.id,
        );
      } catch (err) {
        throw mapPayrollPgError(err) ?? err;
      }
      await this.audit.record(tx, {
        action: "create",
        objectType: "salary_component",
        objectId: row.id,
        actorUserId: user.id,
        before: null,
        after: {
          code: row.code,
          kind: row.kind,
          valueType: row.valueType,
          formula: row.formula,
          pitDeductible: row.pitDeductible,
          isActive: row.isActive,
          hasFixedAmount: row.fixedAmount !== null,
        },
      });
      return { id: row.id };
    });
  }

  /** 047 — sửa · ngưng dùng · xoá mềm (`{delete:true}`). */
  async update(
    user: PayrollRequestUser,
    id: string,
    dto: UpdateSalaryComponentRequest,
  ): Promise<PayrollCatalogWriteResult> {
    await this.access.resolveActor(user, "componentUpdate");
    return this.db.withTenant(user.companyId, async (tx) => {
      await payrollCatalogLockTx(tx, user.companyId);
      const before = await this.repo.findTx(tx, user.companyId, id, { forUpdate: true });
      if (!before) throw payrollNotFound();

      const changedFields = Object.keys(dto);
      if (before.isSystem) {
        const frozen = changedFields.filter((k) => !SYSTEM_MUTABLE_FIELDS.has(k));
        if (frozen.length > 0) {
          throw payrollConflict(
            "COMPONENT_CONFLICT",
            PAYROLL_ERR.COMPONENT_SYSTEM_IMMUTABLE,
            payrollDetails("system-component-immutable", { fields: frozen.join(",") }),
          );
        }
      }

      if (dto.delete === true || dto.isActive === false) {
        const usedBy = await this.templates.templatesContainingTx(tx, user.companyId, id);
        if (usedBy.length > 0) {
          const codes = usedBy.map((t) => t.code).join(", ");
          throw payrollConflict(
            "COMPONENT_CONFLICT",
            PAYROLL_ERR.COMPONENT_IN_USE(codes),
            payrollDetails("component-in-use", { templates: codes }),
          );
        }
      }

      if (dto.delete === true) {
        // Xoá mềm cũng RÚT hàng khỏi catalog ⇒ kiểm lại đồ thị y như `{isActive:false}` (security-review BE-2
        // MEDIUM-3): thiếu vế này thì hàng khác đang tham chiếu mã này treo REF âm thầm.
        const catalog = await this.repo.listActiveTx(tx, user.companyId);
        compileOrThrow(catalog.filter((c) => c.id !== id).map(catalogGraphComponent), false);
        let deleted: SalaryComponent | null;
        try {
          deleted = await this.repo.softDeleteTx(tx, user.companyId, id, user.id);
        } catch (err) {
          throw mapPayrollPgError(err) ?? err;
        }
        if (!deleted) throw payrollNotFound();
        await this.audit.record(tx, {
          action: "delete",
          objectType: "salary_component",
          objectId: id,
          actorUserId: user.id,
          before: { code: before.code, formula: before.formula },
          after: null,
        });
        return { id };
      }

      const merged = SalaryComponentsService.merge(before, dto);
      if (!valuePairOk(merged)) {
        throw payrollUnprocessable(
          "FORMULA_INVALID",
          PAYROLL_ERR.COMPONENT_VALUE_PAIR,
          payrollDetails("component-value-pair"),
        );
      }
      if (!before.isSystem && GRAPH_FIELDS.some((k) => k in dto)) {
        await this.assertGraphsAfterEdit(tx, user.companyId, before, merged);
      }

      let row: SalaryComponent | null;
      try {
        row = await this.repo.updateTx(
          tx,
          user.companyId,
          id,
          {
            ...(dto.name !== undefined ? { name: dto.name } : {}),
            ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
            ...(before.isSystem
              ? {}
              : {
                  kind: merged.kind,
                  valueType: merged.valueType,
                  formula: merged.formula,
                  fixedAmount: merged.fixedAmount,
                  pitDeductible: merged.pitDeductible,
                  isActive: merged.isActive,
                }),
          },
          user.id,
        );
      } catch (err) {
        throw mapPayrollPgError(err) ?? err;
      }
      if (!row) throw payrollNotFound();
      await this.audit.record(tx, {
        action: "update",
        objectType: "salary_component",
        objectId: id,
        actorUserId: user.id,
        // §13.6 I — diff CHUỖI công thức (một ký tự đổi tiền cả công ty); số tiền KHÔNG vào audit (MF14).
        before: { code: before.code, formula: before.formula },
        after: { formula: row.formula, changedFields },
      });
      return { id };
    });
  }

  /**
   * 048 — kiểm tại chỗ, KHÔNG ghi. Luôn 200: lỗi cú pháp/tham chiếu/vòng là `valid:false` kèm `errors[]`, không
   * phải lỗi HTTP (nguồn cho editor FE tô đỏ theo `pos`).
   */
  async validateFormula(
    user: PayrollRequestUser,
    dto: ValidateFormulaRequest,
  ): Promise<ValidateFormulaResult> {
    await this.access.resolveActor(user, "componentValidateFormula");
    let parsed: ReturnType<typeof parseFormula>;
    try {
      parsed = parseFormula(dto.formula);
    } catch (err) {
      if (isFormulaError(err)) return { valid: false, errors: [formulaIssueOf(err)], refs: [], depth: 0, nodes: 0 };
      throw err;
    }
    const shape = { refs: [...parsed.refs], depth: parsed.depth, nodes: parsed.nodes };
    return this.db.withTenant(user.companyId, async (tx) => {
      const catalog = await this.repo.listActiveTx(tx, user.companyId);
      const existing = dto.componentCode ? catalog.find((c) => c.code === dto.componentCode) : undefined;
      // Mã giữ chỗ chữ thường KHÔNG thể là REF (REF chỉ chữ hoa) ⇒ không đụng thành phần thật nào.
      const code = dto.componentCode ?? "__validate__";
      const candidate: GraphComponent = {
        code,
        kind: dto.kind ?? (existing?.kind as GraphComponent["kind"] | undefined) ?? "earning",
        valueType: "formula",
        formula: dto.formula,
        fixedAmount: null,
        pitDeductible: dto.pitDeductible ?? existing?.pitDeductible ?? false,
      };
      try {
        compileGraph(
          [...catalog.filter((c) => c.code !== code).map(catalogGraphComponent), candidate],
          { requireEngineNodes: false },
        );
        return { valid: true, errors: [], ...shape };
      } catch (err) {
        if (isFormulaError(err)) return { valid: false, errors: [formulaIssueOf(err)], ...shape };
        throw err;
      }
    });
  }

  /**
   * Hàng SAU MERGE. Đổi `valueType` mà không gửi trường của loại mới ⇒ trường của loại CŨ tự về NULL (một thành
   * phần `fixed` không mang công thức cũ đi theo); gửi tường minh trường sai loại vẫn bị `valuePairOk` chặn.
   */
  private static merge(before: SalaryComponent, dto: UpdateSalaryComponentRequest) {
    const valueType = dto.valueType ?? before.valueType;
    const typeChanged = dto.valueType !== undefined && dto.valueType !== before.valueType;
    const formula =
      dto.formula !== undefined
        ? dto.formula
        : typeChanged && valueType !== "formula"
          ? null
          : before.formula;
    const fixedAmount =
      dto.fixedAmount !== undefined
        ? dto.fixedAmount === null
          ? null
          : moneyInput(dto.fixedAmount)
        : typeChanged && valueType !== "fixed"
          ? null
          : before.fixedAmount;
    return {
      kind: dto.kind ?? before.kind,
      valueType,
      formula,
      fixedAmount,
      pitDeductible: dto.pitDeductible ?? before.pitDeductible,
      isActive: dto.isActive ?? before.isActive,
    };
  }

  /**
   * Đổi `formula`/`kind`/`valueType`/`pitDeductible`/`isActive` ⇒ kiểm LẠI (a) đồ thị CATALOG và (b) đồ thị của MỌI
   * mẫu CHƯA XOÁ chứa thành phần — REF mới phải có mặt trong từng mẫu, và không mẫu nào được thành vòng (MF3). Để
   * mẫu hỏng âm thầm là đẩy lỗi sang lúc TÍNH lương (BE-3).
   */
  private async assertGraphsAfterEdit(
    tx: Parameters<Parameters<DatabaseService["withTenant"]>[1]>[0],
    companyId: string,
    before: SalaryComponent,
    merged: ReturnType<typeof SalaryComponentsService.merge>,
  ): Promise<void> {
    const edited: GraphComponent = {
      code: before.code,
      kind: merged.kind as GraphComponent["kind"],
      valueType: merged.valueType as GraphComponent["valueType"],
      formula: merged.valueType === "formula" ? merged.formula : null,
      fixedAmount: merged.valueType === "fixed" ? merged.fixedAmount : null,
      pitDeductible: merged.pitDeductible,
    };
    const catalog = await this.repo.listActiveTx(tx, companyId);
    const others = catalog.filter((c) => c.id !== before.id).map(catalogGraphComponent);
    // Hàng mang công thức LUÔN được parse + kiểm, kể cả khi đang/sẽ ngưng dùng (security-review BE-2 MEDIUM-2):
    // bỏ `edited` khỏi đồ thị là để chuỗi sai cú pháp/quá dài đi thẳng xuống CHECK DB ⇒ 500.
    if (merged.isActive || merged.valueType === "formula") compileOrThrow([...others, edited], false);
    // Ngưng dùng ⇒ phần catalog CÒN LẠI phải tự đứng được (không hàng nào treo REF vào hàng vừa rút).
    if (!merged.isActive) compileOrThrow(others, false);

    for (const t of await this.templates.templatesContainingTx(tx, companyId, before.id)) {
      const rows = await this.templates.componentsTx(tx, companyId, t.id);
      const graph = rows.map((r) =>
        r.componentId === before.id
          ? templateGraphComponent({
              ...r,
              kind: merged.kind,
              valueType: merged.valueType,
              catalogFormula: merged.formula,
              fixedAmount: merged.fixedAmount,
              pitDeductible: merged.pitDeductible,
            })
          : templateGraphComponent(r),
      );
      compileOrThrow(graph, true, { template: t.code });
    }
  }
}
