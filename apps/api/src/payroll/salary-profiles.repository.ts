import { Injectable } from "@nestjs/common";
import { and, asc, count, desc, eq, isNull, lte, sql } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import {
  salaryComponents,
  salaryProfileItems,
  salaryProfiles,
  type SalaryProfile,
  type SalaryProfileItem,
} from "../db/schema/payroll";
import type { Allowance } from "@mediaos/contracts";

export interface SalaryProfileListFilter {
  userId?: string;
  /** Lọc bản HIỆU LỰC tại ngày X — mỗi nhân sự đúng một hàng (bản `effective_date <= X` mới nhất). */
  effectiveOn?: string;
}

/**
 * S13-PAYROLL-BE-1 — `salary_profiles`: hồ sơ lương **versioned theo `effective_date`** (PAY-DEC-003).
 *
 * Nguồn DUY NHẤT cho tính lương; `employee_profiles.base_salary` KHÔNG tham gia. Bản "hiệu lực tại
 * ngày X" = hàng `effective_date <= X` **mới nhất** chưa xoá mềm — cờ `status`/`is_active` cũ đã GỠ ở
 * `0564` (hai cơ chế song song là nguồn mâu thuẫn).
 *
 * GRANT app SELECT/INSERT/UPDATE — **NO DELETE**: xoá là `deleted_at` (bất biến #2).
 * Unique là **PARTIAL** `WHERE deleted_at IS NULL` ⇒ mọi truy vấn phải lọc `deleted_at IS NULL`, kẻo
 * bản xoá mềm quay lại làm nhân bản hàng (`partial-unique-index-makes-join-duplicate`).
 */
@Injectable()
export class SalaryProfilesRepository {
  private static scope(companyId: string) {
    return and(eq(salaryProfiles.companyId, companyId), isNull(salaryProfiles.deletedAt));
  }

  async findTx(tx: TenantTx, companyId: string, id: string): Promise<SalaryProfile | null> {
    const [row] = await tx
      .select()
      .from(salaryProfiles)
      .where(and(SalaryProfilesRepository.scope(companyId), eq(salaryProfiles.id, id)))
      .limit(1);
    return row ?? null;
  }

  /**
   * Danh sách. Khi có `effectiveOn`, trả **đúng một hàng/nhân sự** — bản hiệu lực tại ngày đó, chọn
   * bằng `DISTINCT ON (user_id)` chứ không phải `GROUP BY` + join lại (join lại là đường đẻ nhân bản).
   */
  async listTx(
    tx: TenantTx,
    companyId: string,
    f: SalaryProfileListFilter,
    limit: number,
    offset: number,
  ): Promise<SalaryProfile[]> {
    if (f.effectiveOn) {
      const res = await tx.execute(sql`
        select distinct on (sp.user_id) sp.*
          from salary_profiles sp
         where sp.company_id = ${companyId}
           and sp.deleted_at is null
           and sp.effective_date <= ${f.effectiveOn}::date
           ${f.userId ? sql`and sp.user_id = ${f.userId}` : sql``}
         order by sp.user_id, sp.effective_date desc, sp.id
         limit ${limit} offset ${offset}
      `);
      const list = (res as unknown as { rows?: unknown[] }).rows ?? (res as unknown as unknown[]);
      return (list as RawSalaryRow[]).map(fromRaw);
    }
    const conds = [SalaryProfilesRepository.scope(companyId)];
    if (f.userId) conds.push(eq(salaryProfiles.userId, f.userId));
    return (
      tx
        .select()
        .from(salaryProfiles)
        .where(and(...conds))
        // Thứ tự ổn định: `id` phá ties — `created_at` dùng now() per-statement nên trùng là THẬT.
        .orderBy(desc(salaryProfiles.effectiveDate), desc(salaryProfiles.id))
        .limit(limit)
        .offset(offset)
    );
  }

  async countTx(tx: TenantTx, companyId: string, f: SalaryProfileListFilter): Promise<number> {
    if (f.effectiveOn) {
      const res = await tx.execute<{ n: number }>(sql`
        select count(*)::int as n from (
          select distinct on (sp.user_id) sp.id
            from salary_profiles sp
           where sp.company_id = ${companyId}
             and sp.deleted_at is null
             and sp.effective_date <= ${f.effectiveOn}::date
             ${f.userId ? sql`and sp.user_id = ${f.userId}` : sql``}
           order by sp.user_id, sp.effective_date desc, sp.id
        ) t
      `);
      const list = (res as unknown as { rows?: unknown[] }).rows ?? (res as unknown as unknown[]);
      return Number((list as { n: number }[])[0]?.n ?? 0);
    }
    const conds = [SalaryProfilesRepository.scope(companyId)];
    if (f.userId) conds.push(eq(salaryProfiles.userId, f.userId));
    const [row] = await tx
      .select({ n: count() })
      .from(salaryProfiles)
      .where(and(...conds));
    return Number(row?.n ?? 0);
  }

  /**
   * `userId → salary_profile` hiệu lực tại `onDate` — tập nền của `readiness` (006) và của máy tính
   * lương (BE-2). `DISTINCT ON` + `deleted_at IS NULL`.
   */
  async effectiveByUserTx(
    tx: TenantTx,
    companyId: string,
    onDate: string,
  ): Promise<Map<string, { id: string; baseSalary: string }>> {
    const res = await tx.execute<{ id: string; user_id: string; base_salary: string }>(sql`
      select distinct on (sp.user_id) sp.id, sp.user_id, sp.base_salary
        from salary_profiles sp
       where sp.company_id = ${companyId}
         and sp.deleted_at is null
         and sp.effective_date <= ${onDate}::date
       order by sp.user_id, sp.effective_date desc, sp.id
    `);
    const list = (res as unknown as { rows?: unknown[] }).rows ?? (res as unknown as unknown[]);
    const out = new Map<string, { id: string; baseSalary: string }>();
    for (const r of list as { id: string; user_id: string; base_salary: string }[]) {
      out.set(r.user_id, { id: r.id, baseSalary: r.base_salary });
    }
    return out;
  }

  async createTx(
    tx: TenantTx,
    companyId: string,
    input: {
      userId: string;
      effectiveDate: string;
      baseSalary: number;
      /** Mirror cho máy tính lương v1 — service dựng, đã LỌC theo `value_type`/`isActive` (§3.2). */
      allowances: Allowance[];
      note: string | null;
      salaryType?: string;
      pitPayer?: string;
      insuranceSalary?: number | null;
      probationSalary?: number | null;
      payRatioPct?: number;
    },
    actorUserId: string,
  ): Promise<SalaryProfile> {
    const [row] = await tx
      .insert(salaryProfiles)
      .values({
        companyId,
        userId: input.userId,
        effectiveDate: input.effectiveDate,
        // numeric(18,2) — gửi CHUỖI, không để JS float đi vào cột tiền.
        baseSalary: input.baseSalary.toFixed(2),
        allowances: input.allowances,
        note: input.note,
        ...(input.salaryType !== undefined ? { salaryType: input.salaryType } : {}),
        ...(input.pitPayer !== undefined ? { pitPayer: input.pitPayer } : {}),
        ...(input.insuranceSalary !== undefined
          ? { insuranceSalary: input.insuranceSalary === null ? null : input.insuranceSalary.toFixed(2) }
          : {}),
        ...(input.probationSalary !== undefined
          ? { probationSalary: input.probationSalary === null ? null : input.probationSalary.toFixed(2) }
          : {}),
        ...(input.payRatioPct !== undefined ? { payRatioPct: input.payRatioPct.toFixed(2) } : {}),
        createdBy: actorUserId,
        updatedBy: actorUserId,
      })
      .returning();
    return row;
  }

  async updateTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    patch: {
      effectiveDate?: string;
      baseSalary?: number;
      allowances?: Allowance[];
      note?: string | null;
      salaryType?: string;
      pitPayer?: string;
      insuranceSalary?: number | null;
      probationSalary?: number | null;
      payRatioPct?: number;
    },
    actorUserId: string,
  ): Promise<SalaryProfile | null> {
    const set: Record<string, unknown> = { updatedBy: actorUserId, updatedAt: new Date() };
    if (patch.effectiveDate !== undefined) set["effectiveDate"] = patch.effectiveDate;
    if (patch.baseSalary !== undefined) set["baseSalary"] = patch.baseSalary.toFixed(2);
    if (patch.allowances !== undefined) set["allowances"] = patch.allowances;
    if (patch.note !== undefined) set["note"] = patch.note;
    if (patch.salaryType !== undefined) set["salaryType"] = patch.salaryType;
    if (patch.pitPayer !== undefined) set["pitPayer"] = patch.pitPayer;
    if (patch.insuranceSalary !== undefined) {
      set["insuranceSalary"] =
        patch.insuranceSalary === null ? null : patch.insuranceSalary.toFixed(2);
    }
    if (patch.probationSalary !== undefined) {
      set["probationSalary"] =
        patch.probationSalary === null ? null : patch.probationSalary.toFixed(2);
    }
    if (patch.payRatioPct !== undefined) set["payRatioPct"] = patch.payRatioPct.toFixed(2);
    const [row] = await tx
      .update(salaryProfiles)
      .set(set)
      .where(and(SalaryProfilesRepository.scope(companyId), eq(salaryProfiles.id, id)))
      .returning();
    return row ?? null;
  }

  /** Xoá MỀM (không có GRANT DELETE cho app role). */
  async softDeleteTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    actorUserId: string,
  ): Promise<SalaryProfile | null> {
    const [row] = await tx
      .update(salaryProfiles)
      .set({ deletedAt: new Date(), deletedBy: actorUserId, updatedBy: actorUserId })
      .where(and(SalaryProfilesRepository.scope(companyId), eq(salaryProfiles.id, id)))
      .returning();
    return row ?? null;
  }

  /** Có bản hiệu lực nào tại `onDate` không — dùng cho đếm `eligibleCount` nhanh. */
  static effectiveOnCond(onDate: string) {
    return lte(salaryProfiles.effectiveDate, onDate);
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // S15-PAYROLL-BE-1 — `salary_profile_items` (EXPAND-CONTRACT thay cột `allowances` jsonb)
  // ══════════════════════════════════════════════════════════════════════════════════════════════

  /**
   * Tra catalog cho tập `component_code` — **MỘT câu**, trả đủ `name`/`kind`/`valueType` để dùng lại
   * cho CẢ ba việc: validate · mirror `allowances` (cần `name`) · dựng DTO đọc (cần `name` + `kind`).
   * Chạy hai câu riêng cho cùng dữ liệu là đường để hai bên lệch nhau.
   *
   * ⚠️ **KHÔNG lọc `is_active`** — thành phần đã ngưng dùng vẫn hợp lệ để hồ sơ CŨ tham chiếu; chỉ mã
   * **không tồn tại / đã xoá mềm** mới là lỗi. Lọc `is_active` ở đây sẽ làm mọi hồ sơ cũ trở nên
   * không-lưu-lại-được ngay khi HR ngưng một phụ cấp.
   */
  async componentsByCodeTx(
    tx: TenantTx,
    companyId: string,
    codes: readonly string[],
  ): Promise<Map<string, { name: string; kind: string; valueType: string }>> {
    const out = new Map<string, { name: string; kind: string; valueType: string }>();
    const uniq = [...new Set(codes)];
    if (uniq.length === 0) return out;
    const rows = await tx
      .select({
        code: salaryComponents.code,
        name: salaryComponents.name,
        kind: salaryComponents.kind,
        valueType: salaryComponents.valueType,
      })
      .from(salaryComponents)
      .where(
        and(
          eq(salaryComponents.companyId, companyId),
          isNull(salaryComponents.deletedAt),
          // `sql.param` cho mảng — drizzle không tự bind `text[]` (memory `drizzle-array-bind-sql-param`).
          sql`${salaryComponents.code} = ANY(${sql.param(uniq)})`,
        ),
      );
    for (const r of rows) out.set(r.code, { name: r.name, kind: r.kind, valueType: r.valueType });
    return out;
  }

  /** Đọc `items[]` của MỘT phiên bản, kèm chiếu catalog (`null` khi mã ngoài catalog — hồ sơ di sản). */
  async listItemsTx(
    tx: TenantTx,
    companyId: string,
    salaryProfileId: string,
  ): Promise<SalaryProfileItem[]> {
    return tx
      .select()
      .from(salaryProfileItems)
      .where(
        and(
          eq(salaryProfileItems.companyId, companyId),
          eq(salaryProfileItems.salaryProfileId, salaryProfileId),
          isNull(salaryProfileItems.deletedAt),
        ),
      )
      .orderBy(asc(salaryProfileItems.componentCode));
  }

  /**
   * **ĐẶT LẠI TOÀN BỘ** tập items của một phiên bản, trong CÙNG transaction của caller.
   *
   * Xoá mềm hàng cũ TRƯỚC rồi INSERT hàng mới là an toàn với unique PARTIAL
   * `salary_profile_items_profile_component_uq … WHERE deleted_at IS NULL`: hàng cũ đã "chết" nên không
   * còn trong phạm vi index khi hàng mới sinh. Hai dòng cùng `component_code` TRONG payload mới vẫn
   * đụng unique ⇒ `23505` → **409 PAYROLL-ERR-014** `profile-item-duplicate` (chốt cuối ở DB, không
   * phải vòng lặp kiểm ở JS).
   */
  async replaceItemsTx(
    tx: TenantTx,
    companyId: string,
    salaryProfileId: string,
    items: readonly { componentCode: string; amount: number; isActive: boolean; note?: string }[],
    actorUserId: string,
  ): Promise<void> {
    await tx
      .update(salaryProfileItems)
      .set({ deletedAt: sql`now()`, deletedBy: actorUserId, updatedBy: actorUserId })
      .where(
        and(
          eq(salaryProfileItems.companyId, companyId),
          eq(salaryProfileItems.salaryProfileId, salaryProfileId),
          isNull(salaryProfileItems.deletedAt),
        ),
      );
    if (items.length === 0) return;
    await tx.insert(salaryProfileItems).values(
      items.map((it) => ({
        companyId,
        salaryProfileId,
        componentCode: it.componentCode,
        // numeric(18,2) — gửi CHUỖI, không để JS float đi vào cột tiền (cùng luật `base_salary`).
        amount: it.amount.toFixed(2),
        isActive: it.isActive,
        note: it.note ?? null,
        createdBy: actorUserId,
        updatedBy: actorUserId,
      })),
    );
  }
}

/**
 * ⚠️ **Interface này PHẢI phủ ĐỦ cột của `salary_profiles`.** Nó là bản đồ tay cho `tx.execute` (raw
 * snake_case), và `fromRaw` ép kiểu `as SalaryProfile` nên **trình biên dịch KHÔNG bắt được cột
 * thiếu**. Cột nào quên ở đây thì nhánh `effectiveOn` của `listTx` trả DTO **thiếu trường trong im
 * lặng**, còn nhánh không-`effectiveOn` lại trả đủ — cùng một route, hai hành vi (silent-failure
 * review S15-PAYROLL-BE-1, HIGH #1). Thêm cột vào bảng ⇒ thêm vào ĐÂY và vào `fromRaw` CÙNG LƯỢT.
 */
interface RawSalaryRow {
  id: string;
  company_id: string;
  user_id: string;
  effective_date: string;
  base_salary: string;
  allowances: unknown;
  // ── v2 (mig 0570) ──
  salary_type: string | null;
  pit_payer: string | null;
  insurance_salary: string | null;
  probation_salary: string | null;
  pay_ratio_pct: string | null;
  note: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
}

/** `tx.execute` trả hàng RAW (snake_case, không qua drizzle mapper) — chuyển về hình dạng schema. */
function fromRaw(r: RawSalaryRow): SalaryProfile {
  return {
    id: r.id,
    companyId: r.company_id,
    userId: r.user_id,
    effectiveDate: r.effective_date,
    baseSalary: r.base_salary,
    allowances: r.allowances,
    salaryType: r.salary_type,
    pitPayer: r.pit_payer,
    insuranceSalary: r.insurance_salary,
    probationSalary: r.probation_salary,
    payRatioPct: r.pay_ratio_pct,
    note: r.note,
    createdAt: new Date(r.created_at),
    createdBy: r.created_by,
    updatedAt: new Date(r.updated_at),
    updatedBy: r.updated_by,
    deletedAt: r.deleted_at ? new Date(r.deleted_at) : null,
    deletedBy: r.deleted_by,
  } as SalaryProfile;
}
