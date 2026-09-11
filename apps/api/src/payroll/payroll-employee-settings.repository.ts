import { Injectable } from "@nestjs/common";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { payrollEmployeeSettings, type PayrollEmployeeSetting } from "../db/schema/payroll";

/** Giá trị ghi được ở 039 — `undefined` = không đụng, `null` = xoá giá trị. */
export interface PayrollEmployeeSettingsWrite {
  joinsSocialInsurance: boolean;
  socialInsuranceNo?: string | null;
  joinsUnion: boolean;
  bankAccountNumber?: string | null;
  bankName?: string | null;
  bankBranch?: string | null;
  accountHolder?: string | null;
}

/**
 * S15-PAYROLL-BE-1 — `payroll_employee_settings` (`PAYROLL-API-038/039`): BH · công đoàn · **tài khoản
 * ngân hàng** của MỘT nhân sự. **1 hàng / (company, user)** — unique PARTIAL
 * `payroll_employee_settings_user_uq` `WHERE deleted_at IS NULL`.
 *
 * 🔴 `bank_account_number` là **PII thanh toán** (SPEC-11 §3.12): repository trả cột THẬT, nhưng
 * **mapper CHỈ được phát `bankAccountLast4`**. Số đầy đủ chỉ rời server qua tệp UNC của
 * `PAYROLL-API-071` (BE-4). Không có route nào của BE-1 trả nó.
 *
 * GRANT app SELECT/INSERT/UPDATE — **NO DELETE** (bất biến #2): xoá là `deleted_at`.
 */
@Injectable()
export class PayrollEmployeeSettingsRepository {
  private static scope(companyId: string, userId: string) {
    return and(
      eq(payrollEmployeeSettings.companyId, companyId),
      eq(payrollEmployeeSettings.userId, userId),
      isNull(payrollEmployeeSettings.deletedAt),
    );
  }

  /** 038 — `null` khi nhân sự CHƯA từng được thiết lập (hợp lệ, không phải lỗi). */
  async findTx(
    tx: TenantTx,
    companyId: string,
    userId: string,
  ): Promise<PayrollEmployeeSetting | null> {
    const [row] = await tx
      .select()
      .from(payrollEmployeeSettings)
      .where(PayrollEmployeeSettingsRepository.scope(companyId, userId))
      .limit(1);
    return row ?? null;
  }

  /**
   * 039 — **UPSERT THẬT** trong MỘT câu.
   *
   * ⚠️ `onConflictDoUpdate` phải khai **CẢ `target` LẪN `targetWhere`** khớp ĐÚNG vị từ của unique
   * PARTIAL (`db/schema/payroll.ts` — `WHERE deleted_at IS NULL`). Thiếu `targetWhere`, Postgres không
   * khớp được index nào và ném `42P10` ⇒ **500** ngay trên đường ghi.
   *
   * Vì sao KHÔNG "select rồi branch insert/update": hai request song song cùng thấy "chưa có" rồi cùng
   * INSERT ⇒ một bên ăn `23505` trên một unique mà route này **không có mã lỗi nghiệp vụ nào** để map
   * (039 là upsert — trùng hàng không phải lỗi của người dùng). Upsert thật làm race thành no-op.
   */
  async upsertTx(
    tx: TenantTx,
    companyId: string,
    userId: string,
    w: PayrollEmployeeSettingsWrite,
    actorUserId: string,
  ): Promise<PayrollEmployeeSetting> {
    const values = {
      joinsSocialInsurance: w.joinsSocialInsurance,
      joinsUnion: w.joinsUnion,
      ...(w.socialInsuranceNo !== undefined ? { socialInsuranceNo: w.socialInsuranceNo } : {}),
      ...(w.bankAccountNumber !== undefined ? { bankAccountNumber: w.bankAccountNumber } : {}),
      ...(w.bankName !== undefined ? { bankName: w.bankName } : {}),
      ...(w.bankBranch !== undefined ? { bankBranch: w.bankBranch } : {}),
      ...(w.accountHolder !== undefined ? { accountHolder: w.accountHolder } : {}),
    };
    const [row] = await tx
      .insert(payrollEmployeeSettings)
      .values({ companyId, userId, createdBy: actorUserId, updatedBy: actorUserId, ...values })
      .onConflictDoUpdate({
        target: [payrollEmployeeSettings.companyId, payrollEmployeeSettings.userId],
        targetWhere: isNull(payrollEmployeeSettings.deletedAt),
        set: { ...values, updatedBy: actorUserId, updatedAt: sql`now()` },
      })
      .returning();
    return row as PayrollEmployeeSetting;
  }
}
