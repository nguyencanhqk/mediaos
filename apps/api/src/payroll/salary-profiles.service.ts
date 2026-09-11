import { Injectable } from "@nestjs/common";
import type {
  Allowance,
  CreateSalaryProfileRequest,
  PayrollPeoplePickerQuery,
  SalaryProfileItemInput,
  SalaryProfileListQuery,
  UpdateSalaryProfileRequest,
} from "@mediaos/contracts";
import type { TenantTx } from "../db/db.service";
import { DatabaseService } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { paginated, toPagination } from "../common/pagination";
import { PayrollAccessService } from "./payroll-access.service";
import { PayrollPeopleRepository } from "./payroll-people.repository";
import {
  mapPayrollPgError,
  payrollDetails,
  payrollNotFound,
  payrollUnprocessable,
  PAYROLL_ERR,
} from "./payroll.errors";
import { toSalaryProfileDto, toSalaryProfileListItem } from "./payroll.mapper";
import { payrollOffset, type PayrollRequestUser } from "./payroll.types";
import { SalaryProfilesRepository } from "./salary-profiles.repository";

/**
 * S13-PAYROLL-BE-1 — hồ sơ lương `PAYROLL-API-019..022` + danh bạ `034`.
 *
 * ⚠️ **AUDIT LƯỢT ĐỌC ATOMIC** (SPEC-11 §18 — khuôn `hr-read.service`): `019` và `021` ghi `audit_logs`
 * **trong CÙNG transaction** với lượt đọc ⇒ rollback thì 0 hàng audit, không có lượt đọc nào không để
 * lại vết. Đây là 2 trong 7 đường đọc phải ghi audit; 5 đường còn lại (`lines` · `summary` · `payslips`
 * · `payslips/:id` · `export`) thuộc BE-2.
 *
 * Payload audit **KHÔNG chứa số tiền** — kể cả `before/after` của PATCH: ghi tên trường đã đổi
 * (`changedFields`), không ghi giá trị.
 */
@Injectable()
export class SalaryProfilesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: PayrollAccessService,
    private readonly repo: SalaryProfilesRepository,
    private readonly people: PayrollPeopleRepository,
    private readonly audit: AuditService,
  ) {}

  /** 019 — danh sách + **audit lượt đọc**. */
  async list(user: PayrollRequestUser, query: SalaryProfileListQuery) {
    const actor = await this.access.resolveActor(user, "salaryProfileList");
    return this.db.withTenant(user.companyId, async (tx) => {
      const filter = { userId: query.userId, effectiveOn: query.effectiveOn };
      const [rows, total] = await Promise.all([
        this.repo.listTx(
          tx,
          user.companyId,
          filter,
          query.per_page,
          payrollOffset(query.page, query.per_page),
        ),
        this.repo.countTx(tx, user.companyId, filter),
      ]);
      await this.audit.record(tx, {
        action: "read",
        objectType: "salary_profile",
        actorUserId: user.id,
        before: null,
        after: { filter, rows: rows.length },
      });
      return paginated(
        rows.map((r) => toSalaryProfileListItem(r, actor)),
        toPagination(total, query.page, query.per_page),
      );
    });
  }


  /**
   * 🔴 **S15-PAYROLL-BE-1 — LÕI AN TOÀN TIỀN của `items[]`. Đọc kỹ trước khi đơn giản hoá.**
   *
   * Kiểm BA điều kiện rồi trả đúng hai thứ caller cần: `catalog` (dựng DTO đọc) và `allowances`
   * (mirror cho máy tính lương v1).
   *
   *  (a) mã **tồn tại** trong `salary_components` của công ty · (b) **chưa xoá mềm**
   *      → trượt ⇒ 422 `PAYROLL-ERR-018` `kind='profile-item-unknown-component'`.
   *      Đây chính là 🔻 **nợ DB-1**: hồ sơ di sản mang mã `PC_nnn` do backfill mig `0570` sinh, NGOÀI
   *      catalog (catalog seed RUNTIME, chưa tồn tại lúc backfill chạy). Đường ĐỌC trả nguyên; đường
   *      GHI dừng ở đây với thông điệp hướng chọn mã catalog thật — KHÔNG 500, KHÔNG im lặng mất dòng.
   *  (c) 🔴 mã phải có **`value_type = 'profile_item'`**
   *      → trượt ⇒ 422 `PAYROLL-ERR-018` `kind='profile-item-wrong-type'`.
   *
   * **Vì sao (c) là chốt chặn TIỀN, không phải khắt khe thừa:** cột `salary_profiles.allowances` là đầu
   * vào tính lương v1 và `payroll-calc.repository.ts` cộng **MỌI** phần tử của nó vào `gross`. Catalog
   * có thành phần `kind` = `tax` (`TNCN`), `deduction` (`NGHI_KHONG_LUONG`), `statutory_employee`
   * (`DOAN_PHI`) và 4 nút `aggregate`. Thiếu (c) thì `items:[{componentCode:"TNCN", amount:5000000}]`
   * qua validate, được mirror, và nhân viên **ĐƯỢC CỘNG** 5 triệu thay vì bị trừ thuế — một lỗi tiền
   * mà mọi bất biến SQL vẫn xanh. Lọc theo `value_type` (không theo `kind`) vì `profile_item` là đúng
   * MỘT giá trị và nó chính là nghĩa "số do hồ sơ lương cấp".
   *
   * 🔴 **Mirror CHỈ item `isActive`** — item tắt vẫn ghi xuống `salary_profile_items` (giữ lịch sử)
   * nhưng KHÔNG vào `allowances` ⇒ không vào `gross`. Thiếu vế này thì "tắt một phụ cấp" vẫn trả tiền.
   *
   * Chạy TRƯỚC mọi câu ghi; ném ở đây để lại ZERO side-effect.
   */
  private async resolveItems(
    tx: TenantTx,
    companyId: string,
    items: readonly SalaryProfileItemInput[],
  ): Promise<{
    catalog: Map<string, { name: string; kind: string; valueType: string }>;
    allowances: Allowance[];
  }> {
    const catalog = await this.repo.componentsByCodeTx(
      tx,
      companyId,
      items.map((i) => i.componentCode),
    );
    const unknown = items.filter((i) => !catalog.has(i.componentCode)).map((i) => i.componentCode);
    if (unknown.length > 0) {
      throw payrollUnprocessable(
        "FORMULA_INVALID",
        PAYROLL_ERR.PROFILE_ITEM_UNKNOWN_COMPONENT(unknown.join(", ")),
        payrollDetails("profile-item-unknown-component", { componentCodes: unknown.join(",") }),
      );
    }
    const wrongType = items
      .filter((i) => catalog.get(i.componentCode)?.valueType !== "profile_item")
      .map((i) => i.componentCode);
    if (wrongType.length > 0) {
      throw payrollUnprocessable(
        "FORMULA_INVALID",
        PAYROLL_ERR.PROFILE_ITEM_WRONG_TYPE(wrongType.join(", ")),
        payrollDetails("profile-item-wrong-type", { componentCodes: wrongType.join(",") }),
      );
    }
    const allowances: Allowance[] = items
      .filter((i) => i.isActive)
      .map((i) => ({
        name: catalog.get(i.componentCode)?.name ?? i.componentCode,
        amount: i.amount,
      }));
    return { catalog, allowances };
  }

  /** Đọc `items[]` + catalog của một phiên bản — dùng chung cho 020/021/022. */
  private async readItems(tx: TenantTx, companyId: string, salaryProfileId: string) {
    const rows = await this.repo.listItemsTx(tx, companyId, salaryProfileId);
    const catalog = await this.repo.componentsByCodeTx(
      tx,
      companyId,
      rows.map((r) => r.componentCode),
    );
    return { rows, catalog };
  }

  /** 020 — tạo phiên bản. Trùng `(user, effectiveDate)` ⇒ 409 `014` (chốt cuối unique partial). */
  async create(user: PayrollRequestUser, dto: CreateSalaryProfileRequest) {
    const actor = await this.access.resolveActor(user, "salaryProfileCreate");
    return this.db.withTenant(user.companyId, async (tx) => {
      // Validate + dựng mirror TRƯỚC mọi câu ghi (ném ở đây ⇒ 0 side-effect).
      const { allowances } = await this.resolveItems(tx, user.companyId, dto.items);
      let row;
      try {
        row = await this.repo.createTx(
          tx,
          user.companyId,
          {
            userId: dto.userId,
            effectiveDate: dto.effectiveDate,
            baseSalary: dto.baseSalary,
            allowances,
            note: dto.note ?? null,
            ...(dto.salaryType !== undefined ? { salaryType: dto.salaryType } : {}),
            ...(dto.pitPayer !== undefined ? { pitPayer: dto.pitPayer } : {}),
            ...(dto.insuranceSalary !== undefined ? { insuranceSalary: dto.insuranceSalary } : {}),
            ...(dto.probationSalary !== undefined ? { probationSalary: dto.probationSalary } : {}),
            ...(dto.payRatioPct !== undefined ? { payRatioPct: dto.payRatioPct } : {}),
          },
          user.id,
        );
        // CÙNG transaction — hai nguồn (`items` + cột `allowances`) không bao giờ lệch nửa chừng.
        await this.repo.replaceItemsTx(tx, user.companyId, row.id, dto.items, user.id);
      } catch (err) {
        throw mapPayrollPgError(err) ?? err;
      }
      await this.audit.record(tx, {
        action: "create",
        objectType: "salary_profile",
        objectId: row.id,
        actorUserId: user.id,
        before: null,
        // KHÔNG `baseSalary`/`allowances` — audit không mang số tiền (SPEC-11 §18).
        after: { userId: row.userId, effectiveDate: String(row.effectiveDate) },
      });
      return toSalaryProfileDto(row, actor, await this.readItems(tx, user.companyId, row.id));
    });
  }

  /** 021 — chi tiết + **audit lượt đọc**. */
  async get(user: PayrollRequestUser, id: string) {
    const actor = await this.access.resolveActor(user, "salaryProfileDetail");
    return this.db.withTenant(user.companyId, async (tx) => {
      const row = await this.repo.findTx(tx, user.companyId, id);
      if (!row) throw payrollNotFound();
      await this.audit.record(tx, {
        action: "read",
        objectType: "salary_profile",
        objectId: row.id,
        actorUserId: user.id,
        before: null,
        after: { userId: row.userId, effectiveDate: String(row.effectiveDate) },
      });
      // Hồ sơ DI SẢN có mã ngoài catalog: trả NGUYÊN kèm `note` — không lọc, không kiểm mã lúc ĐỌC.
      return toSalaryProfileDto(row, actor, await this.readItems(tx, user.companyId, row.id));
    });
  }

  /**
   * 022 — sửa **hoặc** xoá mềm (`{ delete: true }`). Không đụng phiếu lương đã phát hành: `payslips`
   * giữ `salary_profile_id` + snapshot ĐÓNG BĂNG của chính nó, nên sửa ở đây không hồi tố số cũ.
   */
  async update(user: PayrollRequestUser, id: string, dto: UpdateSalaryProfileRequest) {
    const actor = await this.access.resolveActor(user, "salaryProfileUpdate");
    return this.db.withTenant(user.companyId, async (tx) => {
      const before = await this.repo.findTx(tx, user.companyId, id);
      if (!before) throw payrollNotFound();

      if (dto.delete === true) {
        const row = await this.repo.softDeleteTx(tx, user.companyId, id, user.id);
        if (!row) throw payrollNotFound();
        await this.audit.record(tx, {
          action: "delete",
          objectType: "salary_profile",
          objectId: row.id,
          actorUserId: user.id,
          before: { userId: before.userId, effectiveDate: String(before.effectiveDate) },
          after: null,
        });
        return toSalaryProfileDto(row, actor);
      }

      const changedFields = Object.keys(dto).filter((k) => k !== "delete");

      /**
       * 🔴 **`items` VẮNG ⇒ KHÔNG chạm `salary_profile_items` VÀ KHÔNG chạm cột `allowances`.**
       * `undefined` khác `[]` ở đây là khác biệt SỐNG CÒN: coi vắng như rỗng thì `PATCH {note:"x"}`
       * **xoá sạch phụ cấp trong im lặng**, và kỳ lương sau trả thiếu tiền mà không lỗi nào phát ra.
       */
      const mirror =
        dto.items !== undefined ? await this.resolveItems(tx, user.companyId, dto.items) : null;

      let row;
      try {
        row = await this.repo.updateTx(
          tx,
          user.companyId,
          id,
          {
            ...(dto.effectiveDate !== undefined ? { effectiveDate: dto.effectiveDate } : {}),
            ...(dto.baseSalary !== undefined ? { baseSalary: dto.baseSalary } : {}),
            ...(mirror ? { allowances: mirror.allowances } : {}),
            ...(dto.note !== undefined ? { note: dto.note } : {}),
            ...(dto.salaryType !== undefined ? { salaryType: dto.salaryType } : {}),
            ...(dto.pitPayer !== undefined ? { pitPayer: dto.pitPayer } : {}),
            ...(dto.insuranceSalary !== undefined ? { insuranceSalary: dto.insuranceSalary } : {}),
            ...(dto.probationSalary !== undefined ? { probationSalary: dto.probationSalary } : {}),
            ...(dto.payRatioPct !== undefined ? { payRatioPct: dto.payRatioPct } : {}),
          },
          user.id,
        );
        // ĐẶT LẠI TOÀN BỘ trong CÙNG tx — chỉ khi client thực sự gửi `items`.
        if (dto.items !== undefined && row) {
          await this.repo.replaceItemsTx(tx, user.companyId, row.id, dto.items, user.id);
        }
      } catch (err) {
        throw mapPayrollPgError(err) ?? err;
      }
      if (!row) throw payrollNotFound();
      await this.audit.record(tx, {
        action: "update",
        objectType: "salary_profile",
        objectId: row.id,
        actorUserId: user.id,
        // Tên trường, KHÔNG giá trị — `changedFields` là mức chi tiết tối đa audit lương được mang.
        before: { userId: before.userId, effectiveDate: String(before.effectiveDate) },
        after: { effectiveDate: String(row.effectiveDate), changedFields },
      });
      return toSalaryProfileDto(row, actor, await this.readItems(tx, user.companyId, row.id));
    });
  }

  /**
   * 034 — danh bạ chọn nhân sự. Gác bằng `('view','salary-profile')`: §11.1 bảo đảm **mọi vai giữ
   * `('manage','bonus-penalty')` đều giữ cặp này** (migration verify fail-loud), nên màn thưởng/phạt
   * không chết vì thiếu danh bạ. `payroll-officer` giữ 0 cặp HR ⇒ KHÔNG dùng API-03 được.
   */
  async pickPeople(user: PayrollRequestUser, query: PayrollPeoplePickerQuery) {
    const actor = await this.access.resolveActor(user, "pickerPeople");
    return this.db.withTenant(user.companyId, async (tx) => {
      const rows = await this.people.pickPeopleTx(tx, actor, query.q, query.limit);
      return rows.map((p) => ({
        userId: p.userId,
        fullName: p.displayName,
        employeeCode: p.employeeCode,
      }));
    });
  }
}
