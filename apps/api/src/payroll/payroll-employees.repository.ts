import { Injectable } from "@nestjs/common";
import { and, asc, count, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { employeeProfiles } from "../db/schema/employees";
import { orgUnits } from "../db/schema/org";
import { positions } from "../db/schema/positions";
import { users } from "../db/schema/users";

export interface PayrollEmployeeListFilter {
  q?: string;
  orgUnitId?: string;
  hasSalaryProfile?: boolean;
}

/** Hàng thô của 036/037 — **KHÔNG mang `fullName`/`employeeCode`** (xem luật 1 ở docblock lớp). */
export interface PayrollEmployeeRow {
  userId: string;
  orgUnitName: string | null;
  positionName: string | null;
  employeeStatus: string | null;
  startDate: string | null;
  taxCode: string | null;
  hasSalaryProfile: boolean;
}

/**
 * S15-PAYROLL-BE-1 — `PAYROLL-API-036/037`: **chiếu HR BÓ HẸP** cho màn Nhân viên PAYROLL (PAY-DEC-016).
 *
 * `payroll-officer` giữ **0 cặp HR** (SPEC-11 §11.1 · permission-matrix §9g) nên không dùng được
 * `HR-API-*`; đây là đường riêng, cố ý hẹp: đơn vị · vị trí · trạng thái · ngày vào + `taxCode`
 * **có điều kiện**. KHÔNG `email`, KHÔNG điện thoại, KHÔNG lương (SPEC-11 §18).
 *
 * ─── BA LUẬT CẤP FILE, phá một cái là ĐỎ CI (và hai trong ba là lỗ thật) ───
 *
 * 1. 🔴 **KHÔNG `.select()` cột danh tính** (`users.fullName`, `employee_profiles.employee_code`).
 *    `PayrollPeopleRepository` là **ĐIỂM CHIẾU DANH TÍNH DUY NHẤT** của module (SPEC-11 §18) và ratchet
 *    `identity-projection` gác điều đó. Service ghép tên vào SAU qua `namesByUserIdsTx`. Lọc/sắp theo
 *    `users.fullName` thì ĐƯỢC — vị từ `ilike`/`ORDER BY` là kind PREDICATE/ORDER, không phải
 *    projection; và **cấm raw `sql` chứa `full_name`** (census đếm nó vào `blindSpots().rawSqlIdentity`,
 *    ratchet pin `toBeLessThanOrEqual` ⇒ một hit mới là ĐỎ).
 *
 * 2. 🔴 **Base table là `employee_profiles`, KHÔNG phải `users` JOIN sang nó.** Unique
 *    `employee_profiles_company_user_uq` là **PARTIAL** `WHERE deleted_at IS NULL` (`employees.ts:98-100`)
 *    ⇒ một user có thể có NHIỀU hồ sơ đã xoá mềm. JOIN `users → employee_profiles` mà chỉ lọc tenant sẽ
 *    **nhân bản hàng** và làm `pagination.total` đếm sai (`partial-unique-index-makes-join-duplicate`).
 *    Lấy `employee_profiles` làm gốc + lọc `deleted_at IS NULL` cho **đúng một hàng/nhân sự** theo chính
 *    bất biến của unique đó — không cần `DISTINCT ON`, không cần LATERAL. `org_units`/`positions` join
 *    theo **PK** nên 1:1, không đẻ hàng. Hồ sơ lương là **nhiều hàng/nhân sự** (versioned) nên dùng
 *    `EXISTS`, tuyệt đối không join.
 *
 * 3. **Phân trang THẬT ở SQL** (`LIMIT/OFFSET` + `COUNT` riêng). KHÔNG tái dùng
 *    `PayrollPeopleRepository.pickPeopleTx` — đó là **picker** có trần quét `PAYROLL_PICKER_SCAN_CAP`
 *    và lọc trong TS; dùng nó cho màn danh sách thì công ty > 1000 nhân sự mất người ở trang sau.
 *
 * ⚠️ **Không có "oracle `q`" ở route này** (khác picker 034): cặp `('view','payroll-employee')` khai
 * `companyFloor = true`, nên `resolveActor` đã 403 mọi scope hẹp hơn Company TRƯỚC khi tới đây ⇒ caller
 * tới được đây thì thấy được tên của mọi người trong công ty, lọc `q` ở SQL không lộ thêm gì. Picker
 * 034 phải lọc SAU khi bọc cột vì cặp của nó (`view:salary-profile`) không có sàn ấy.
 *
 * BẤT BIẾN #1: mọi câu bind `company_id` tường minh dù RLS đã đỡ; `deleted_at IS NULL` ở mọi bảng.
 */
@Injectable()
export class PayrollEmployeesRepository {
  /**
   * Nhân sự "hưởng lương" = hồ sơ NHÂN SỰ còn sống **và** tài khoản user còn sống. Neo theo `user_id`
   * cho nhất quán với SPEC-11 §8.1 (không mở lại nợ `employee_id`).
   */
  private static scope(companyId: string): SQL {
    return and(
      eq(employeeProfiles.companyId, companyId),
      isNull(employeeProfiles.deletedAt),
      eq(users.companyId, companyId),
      isNull(users.deletedAt),
    ) as SQL;
  }

  /**
   * `EXISTS` tương quan trên `salary_profiles` — KHÔNG join (bảng versioned, nhiều hàng/nhân sự).
   * ⚠️ `employee_profiles.user_id` viết CHỮ trong subquery: drizzle bỏ tên bảng cho Column trong `sql`
   * ở vị trí này (memory `drizzle-sql-template-renders-columns-unqualified`).
   */
  private static hasSalaryProfileSql(companyId: string) {
    return sql<boolean>`exists (
      select 1 from salary_profiles sp
       where sp.user_id = employee_profiles.user_id
         and sp.company_id = ${companyId}
         and sp.deleted_at is null
    )`;
  }

  private static where(companyId: string, f: PayrollEmployeeListFilter): SQL {
    const parts: SQL[] = [PayrollEmployeesRepository.scope(companyId)];
    if (f.q) {
      const needle = `%${f.q}%`;
      // Vị từ trên cột danh tính — KHÔNG phải projection (luật 1). `ilike` là drizzle identifier nên
      // census cú pháp thấy được; raw `sql` chứa `full_name` thì không (và sẽ trip ratchet).
      parts.push(
        or(ilike(users.fullName, needle), ilike(employeeProfiles.employeeCode, needle)) as SQL,
      );
    }
    if (f.orgUnitId) parts.push(eq(employeeProfiles.orgUnitId, f.orgUnitId));
    if (f.hasSalaryProfile !== undefined) {
      const e = PayrollEmployeesRepository.hasSalaryProfileSql(companyId);
      parts.push(f.hasSalaryProfile ? e : (sql`not ${e}` as SQL));
    }
    return and(...parts) as SQL;
  }

  private static columns(companyId: string) {
    return {
      userId: employeeProfiles.userId,
      orgUnitName: orgUnits.name,
      positionName: positions.name,
      employeeStatus: employeeProfiles.status,
      startDate: employeeProfiles.startDate,
      taxCode: employeeProfiles.taxCode,
      hasSalaryProfile: PayrollEmployeesRepository.hasSalaryProfileSql(companyId),
    };
  }

  private static toRow(r: {
    userId: string | null;
    orgUnitName: string | null;
    positionName: string | null;
    employeeStatus: string | null;
    startDate: unknown;
    taxCode: string | null;
    hasSalaryProfile: unknown;
  }): PayrollEmployeeRow {
    return {
      userId: r.userId as string,
      orgUnitName: r.orgUnitName ?? null,
      positionName: r.positionName ?? null,
      employeeStatus: r.employeeStatus ?? null,
      startDate: r.startDate ? String(r.startDate) : null,
      taxCode: r.taxCode ?? null,
      hasSalaryProfile: Boolean(r.hasSalaryProfile),
    };
  }

  private static base(tx: TenantTx, companyId: string) {
    return tx
      .select(PayrollEmployeesRepository.columns(companyId))
      .from(employeeProfiles)
      .innerJoin(users, eq(users.id, employeeProfiles.userId))
      .leftJoin(
        orgUnits,
        and(eq(orgUnits.id, employeeProfiles.orgUnitId), eq(orgUnits.companyId, companyId)),
      )
      .leftJoin(
        positions,
        and(eq(positions.id, employeeProfiles.positionId), eq(positions.companyId, companyId)),
      );
  }

  async listTx(
    tx: TenantTx,
    companyId: string,
    f: PayrollEmployeeListFilter,
    limit: number,
    offset: number,
  ): Promise<PayrollEmployeeRow[]> {
    const rows = await PayrollEmployeesRepository.base(tx, companyId)
      .where(PayrollEmployeesRepository.where(companyId, f))
      // Thứ tự ỔN ĐỊNH: thiếu `ORDER BY` thì hai lần gọi liên tiếp có thể cắt hai tập khác nhau tuỳ
      // planner ⇒ trang 2 lặp/mất người. Neo phụ `user_id` để không phụ thuộc tên trùng.
      .orderBy(asc(users.fullName), asc(employeeProfiles.userId))
      .limit(limit)
      .offset(offset);
    return rows.map(PayrollEmployeesRepository.toRow);
  }

  async countTx(tx: TenantTx, companyId: string, f: PayrollEmployeeListFilter): Promise<number> {
    const [row] = await tx
      .select({ n: count() })
      .from(employeeProfiles)
      .innerJoin(users, eq(users.id, employeeProfiles.userId))
      .where(PayrollEmployeesRepository.where(companyId, f));
    return Number(row?.n ?? 0);
  }

  /** 037 — một nhân sự. `null` ⇒ service ném sentinel 404 (không 403, chống dò tồn tại). */
  async findTx(
    tx: TenantTx,
    companyId: string,
    userId: string,
  ): Promise<PayrollEmployeeRow | null> {
    const rows = await PayrollEmployeesRepository.base(tx, companyId)
      .where(
        and(
          PayrollEmployeesRepository.scope(companyId),
          eq(employeeProfiles.userId, userId),
        ) as SQL,
      )
      .limit(1);
    const row = rows[0];
    return row ? PayrollEmployeesRepository.toRow(row) : null;
  }
}
