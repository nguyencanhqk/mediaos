import { Injectable } from "@nestjs/common";
import { and, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, ne, or } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { attendanceRecords } from "../db/schema/hr";
import { employeeProfiles } from "../db/schema/employees";
import { users } from "../db/schema/users";
import { remoteWorkRequests } from "../db/schema/attendance";
import { publicHolidays } from "../db/schema/holidays";
import { notifications } from "../db/schema/communication";
import { addDaysToLocalDate } from "../common/tz.util";
import { AttendanceRepository } from "./attendance.repository";
import { shiftTimezone, toShiftCalc } from "./attendance.mappers";
import { isShiftWorkingDay, isWorkDateClosed } from "./attendance-alert-noti.logic";
import type { ShiftRow } from "./attendance.types";

/** Ứng viên missing-checkout/late — đọc trực tiếp `attendance_records` (workDate = cột DB đóng băng). */
export interface AttAlertRecordCandidate {
  id: string;
  userId: string;
  workDate: string;
  fullName: string | null;
}

/** Ứng viên vắng mặt — từ `employee_profiles`, KHÔNG có bản ghi chấm công (kể cả đã soft-delete) cho `workDate`. */
export interface AttAlertAbsentCandidate {
  employeeId: string;
  userId: string;
  workDate: string;
  fullName: string | null;
}

export interface AttAlertCandidateBundle {
  missingCheckout: AttAlertRecordCandidate[];
  late: AttAlertRecordCandidate[];
  absent: AttAlertAbsentCandidate[];
  /** Đếm quan sát-được cho `JobRunResult.metadata` — KHÔNG nuốt câm (silent-failure-hunter). */
  skippedNoEmployeeMapping: number;
  skippedNoShift: number;
  skippedNoWorkDays: number;
}

export interface MaterializeOpts {
  /** "Bây giờ" của lượt chạy — TRUYỀN VÀO (KHÔNG đọc `new Date()` rải rác trong repo) để closedness nhất quán. */
  now: Date;
  /** Số ngày lùi từ hôm nay — TRẦN AN TOÀN phủ ca đêm, KHÔNG backfill lịch sử (chốt #25). */
  lookbackDays: number;
  /** Trần SỐ ỨNG VIÊN nhận về mỗi tập (missingCheckout/late/absent) sau lọc closedness. */
  rawFetchCap: number;
  /** Trần số nhân viên active quét khi dò vắng mặt. */
  employeeScanCap: number;
  /** Ngày local 'YYYY-MM-DD' hôm nay (tz THAM CHIẾU dựng cửa sổ candidate). */
  todayLocalDate: string;
}

/** Bản ghi CHƯA điều chỉnh/khoá sổ (chốt #12) — dùng chung cho missing-checkout + late (an toàn hơn: một
 * bản ghi đã chốt sổ thì cũng không cần nhắc thiếu check-out nữa, dù chốt gốc chỉ nêu rõ cho late). */
const NOT_FINALIZED = and(
  isNull(attendanceRecords.lockedAt),
  or(isNull(attendanceRecords.isAdjusted), eq(attendanceRecords.isAdjusted, false)),
  ne(attendanceRecords.status, "approved_adjustment"),
  or(
    isNull(attendanceRecords.attendanceStatus),
    ne(attendanceRecords.attendanceStatus, "Adjusted"),
  ),
);

/** Trần bảo vệ tầng SQL (độc lập `rawFetchCap` áp SAU lọc closedness) — chống quét vô hạn công ty lớn. */
const SQL_SCAN_LIMIT = 2000;

/**
 * S10-ATT-NOTIPROD-1 — đọc CHỈ-ĐỌC (0 UPDATE/INSERT vào `attendance_records`) chạy TRONG `TenantTx` do
 * job-handler mở, mọi truy vấn `eq(companyId)` tường minh TRỪ `public_holidays` (company_id NULLABLE cho
 * hàng GLOBAL — chốt #20; viết lại query Ở ĐÂY nhận `tx` NGOÀI vì `HolidaysRepository.findInRange` tự mở
 * `withTenant` riêng ⇒ gọi từ trong tx của handler sẽ tạo tx LỒNG, vi phạm chốt #2).
 *
 * [CHỐT #3] Ca hiệu lực resolve THEO TỪNG NHÂN VIÊN qua `AttendanceRepository.resolveEffectiveShiftTx` +
 * `findDefaultShiftTx` (hàm CÓ SẴN, ONE implementation Employee≻Department≻Company≻System) — KHÔNG viết
 * lại specificity/priority ở đây. `missingCheckout`/`late` đọc `userId` từ `attendance_records` rồi map
 * sang `employee_profiles` active (chốt #21 — `attendance_records.employee_id` NULLABLE nên KHÔNG dùng
 * trực tiếp); map không ra ⇒ FAIL-CLOSED bỏ qua (`skippedNoEmployeeMapping`).
 */
@Injectable()
export class AttendanceAlertNotiRepository {
  constructor(private readonly attendanceRepo: AttendanceRepository) {}

  async materializeCandidatesTx(
    companyId: string,
    opts: MaterializeOpts,
    tx: TenantTx,
  ): Promise<AttAlertCandidateBundle> {
    const fromDate = addDaysToLocalDate(opts.todayLocalDate, -opts.lookbackDays);

    const [rawMissingCheckout, rawLate] = await Promise.all([
      this.fetchMissingCheckoutRowsTx(companyId, fromDate, opts.todayLocalDate, tx),
      this.fetchLateRowsTx(companyId, fromDate, opts.todayLocalDate, tx),
    ]);

    let skippedNoEmployeeMapping = 0;
    let skippedNoShift = 0;
    const missingCheckout: AttAlertRecordCandidate[] = [];
    const late: AttAlertRecordCandidate[] = [];

    for (const row of rawMissingCheckout) {
      if (missingCheckout.length >= opts.rawFetchCap) break;
      const status = await this.resolveClosedShiftForRecordTx(companyId, row, opts.now, tx);
      if (status === "no-employee-mapping") skippedNoEmployeeMapping++;
      else if (status === "no-shift") skippedNoShift++;
      else if (status === "closed") missingCheckout.push(row);
    }

    for (const row of rawLate) {
      if (late.length >= opts.rawFetchCap) break;
      const status = await this.resolveClosedShiftForRecordTx(companyId, row, opts.now, tx);
      if (status === "no-employee-mapping") skippedNoEmployeeMapping++;
      else if (status === "no-shift") skippedNoShift++;
      else if (status === "closed") late.push(row);
    }

    const { absent, skippedNoWorkDays } = await this.materializeAbsentCandidatesTx(
      companyId,
      opts,
      tx,
    );

    return {
      missingCheckout,
      late,
      absent,
      skippedNoEmployeeMapping,
      skippedNoShift,
      skippedNoWorkDays,
    };
  }

  async findExistingDedupeKeysTx(
    companyId: string,
    keys: string[],
    tx: TenantTx,
  ): Promise<Set<string>> {
    if (keys.length === 0) return new Set();
    // [CHỐT #7/#19] KHÔNG lọc deleted_at — notification đã soft-delete VẪN tính "đã từng phát" (chống
    // hồi sinh: người dùng xoá thông báo rồi job chạy lại KHÔNG được tạo lại cùng dedupe_key).
    const rows = await tx
      .select({ dedupeKey: notifications.dedupeKey })
      .from(notifications)
      .where(and(eq(notifications.companyId, companyId), inArray(notifications.dedupeKey, keys)));
    return new Set(rows.map((r) => r.dedupeKey).filter((k): k is string => k !== null));
  }

  // ─── missing-checkout / late (đọc attendance_records, workDate ĐÓNG BĂNG) ──

  private fetchMissingCheckoutRowsTx(
    companyId: string,
    fromDate: string,
    toDate: string,
    tx: TenantTx,
  ): Promise<AttAlertRecordCandidate[]> {
    return tx
      .select({
        id: attendanceRecords.id,
        userId: attendanceRecords.userId,
        workDate: attendanceRecords.workDate,
        fullName: users.fullName,
      })
      .from(attendanceRecords)
      .leftJoin(users, eq(attendanceRecords.userId, users.id))
      .where(
        and(
          eq(attendanceRecords.companyId, companyId),
          isNotNull(attendanceRecords.checkInAt),
          isNull(attendanceRecords.checkOutAt),
          isNull(attendanceRecords.deletedAt),
          gte(attendanceRecords.workDate, fromDate),
          lte(attendanceRecords.workDate, toDate),
          NOT_FINALIZED,
        ),
      )
      .orderBy(attendanceRecords.workDate, attendanceRecords.id)
      .limit(SQL_SCAN_LIMIT);
  }

  private fetchLateRowsTx(
    companyId: string,
    fromDate: string,
    toDate: string,
    tx: TenantTx,
  ): Promise<AttAlertRecordCandidate[]> {
    return tx
      .select({
        id: attendanceRecords.id,
        userId: attendanceRecords.userId,
        workDate: attendanceRecords.workDate,
        fullName: users.fullName,
      })
      .from(attendanceRecords)
      .leftJoin(users, eq(attendanceRecords.userId, users.id))
      .where(
        and(
          eq(attendanceRecords.companyId, companyId),
          isNotNull(attendanceRecords.checkInAt),
          isNull(attendanceRecords.deletedAt),
          gte(attendanceRecords.workDate, fromDate),
          lte(attendanceRecords.workDate, toDate),
          or(eq(attendanceRecords.isLate, true), gt(attendanceRecords.lateMinutes, 0)),
          NOT_FINALIZED,
        ),
      )
      .orderBy(attendanceRecords.workDate, attendanceRecords.id)
      .limit(SQL_SCAN_LIMIT);
  }

  private async resolveClosedShiftForRecordTx(
    companyId: string,
    row: { userId: string; workDate: string },
    now: Date,
    tx: TenantTx,
  ): Promise<"no-employee-mapping" | "no-shift" | "not-closed" | "closed"> {
    const employee = await this.findActiveEmployeeByUserIdTx(companyId, row.userId, tx);
    if (!employee) return "no-employee-mapping";
    const shift = await this.resolveEffectiveOrDefaultShiftTx(
      companyId,
      employee,
      row.workDate,
      tx,
    );
    if (!shift) return "no-shift";
    const shiftCalc = toShiftCalc(shift, shiftTimezone(shift));
    return isWorkDateClosed(now, row.workDate, shiftCalc) ? "closed" : "not-closed";
  }

  private async findActiveEmployeeByUserIdTx(
    companyId: string,
    userId: string,
    tx: TenantTx,
  ): Promise<{ id: string; orgUnitId: string | null } | null> {
    const rows = await tx
      .select({ id: employeeProfiles.id, orgUnitId: employeeProfiles.orgUnitId })
      .from(employeeProfiles)
      .where(
        and(
          eq(employeeProfiles.companyId, companyId),
          eq(employeeProfiles.userId, userId),
          eq(employeeProfiles.status, "active"),
          isNull(employeeProfiles.deletedAt),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  private async resolveEffectiveOrDefaultShiftTx(
    companyId: string,
    employee: { id: string; orgUnitId: string | null },
    workDate: string,
    tx: TenantTx,
  ): Promise<ShiftRow | null> {
    return (
      (await this.attendanceRepo.resolveEffectiveShiftTx(
        companyId,
        { employeeId: employee.id, orgUnitId: employee.orgUnitId, workDate },
        tx,
      )) ?? (await this.attendanceRepo.findDefaultShiftTx(companyId, tx))
    );
  }

  // ─── absence (anti-join employee_profiles vs attendance_records) ──────────

  private async materializeAbsentCandidatesTx(
    companyId: string,
    opts: MaterializeOpts,
    tx: TenantTx,
  ): Promise<{ absent: AttAlertAbsentCandidate[]; skippedNoWorkDays: number }> {
    const candidateDates = this.buildCandidateDates(opts.todayLocalDate, opts.lookbackDays);

    const employees = await tx
      .select({
        id: employeeProfiles.id,
        userId: employeeProfiles.userId,
        orgUnitId: employeeProfiles.orgUnitId,
        startDate: employeeProfiles.startDate,
        endDate: employeeProfiles.endDate,
        fullName: users.fullName,
      })
      .from(employeeProfiles)
      .innerJoin(users, eq(employeeProfiles.userId, users.id))
      .where(
        and(
          eq(employeeProfiles.companyId, companyId),
          eq(employeeProfiles.status, "active"),
          isNull(employeeProfiles.deletedAt),
          isNotNull(employeeProfiles.userId),
        ),
      )
      .orderBy(employeeProfiles.id)
      .limit(opts.employeeScanCap);

    const absent: AttAlertAbsentCandidate[] = [];
    let skippedNoWorkDays = 0;

    outer: for (const date of candidateDates) {
      // [CHỐT #20] holiday CÔNG TY ∪ GLOBAL — cả ngày công ty nghỉ thì KHÔNG ai bị coi vắng mặt ngày đó.
      if (await this.hasHolidayTx(date, tx)) continue;

      for (const emp of employees) {
        if (!emp.userId) continue; // đã filter ở SQL — phòng thủ kép (TS narrowing)
        // [CHỐT #6] cửa sổ hợp đồng.
        if (emp.startDate && emp.startDate > date) continue;
        if (emp.endDate && emp.endDate < date) continue;

        // [CHỐT #13] BẤT KỲ bản ghi nào tồn tại cho (user,date) — KỂ CẢ đã soft-delete — tính "ĐÃ CÓ DỮ
        // LIỆU" ⇒ fail-closed bỏ qua (KHÔNG bắn vắng mặt).
        if (await this.hasAnyRecordTx(companyId, emp.userId, date, tx)) continue;

        const shift = await this.resolveEffectiveOrDefaultShiftTx(
          companyId,
          { id: emp.id, orgUnitId: emp.orgUnitId },
          date,
          tx,
        );
        if (!shift) continue; // fail-closed — không suy đoán ca
        if (shift.workDays === null) {
          skippedNoWorkDays++;
          continue; // [CHỐT #18] work_days NULL ⇒ KHÔNG xét absent (KHÔNG mặc định "mọi ngày là ngày làm")
        }
        if (!isShiftWorkingDay(date, shift.workDays)) continue;

        const shiftCalc = toShiftCalc(shift, shiftTimezone(shift));
        if (!isWorkDateClosed(opts.now, date, shiftCalc)) continue;

        const onLeave = await this.attendanceRepo.findApprovedFullDayLeaveTx(
          companyId,
          { userId: emp.userId, employeeId: emp.id, workDate: date },
          tx,
        );
        if (onLeave) continue;

        if (await this.hasApprovedRemoteTx(companyId, emp.id, date, tx)) continue;

        absent.push({
          employeeId: emp.id,
          userId: emp.userId,
          workDate: date,
          fullName: emp.fullName,
        });
        if (absent.length >= opts.rawFetchCap) break outer;
      }
    }
    return { absent, skippedNoWorkDays };
  }

  private buildCandidateDates(todayLocalDate: string, lookbackDays: number): string[] {
    const dates: string[] = [];
    for (let i = lookbackDays; i >= 0; i--) {
      dates.push(addDaysToLocalDate(todayLocalDate, -i));
    }
    return dates;
  }

  /**
   * [CHỐT #20] `public_holidays.company_id` NULLABLE cho hàng GLOBAL — CỐ Ý KHÔNG `eq(companyId)` (mirror
   * `HolidaysRepository.findInRange`, viết lại nhận `tx` NGOÀI để KHÔNG mở tx lồng, chốt #2). RLS FORCE vẫn
   * ẩn hàng công ty KHÁC; hàng `company_id IS NULL` luôn thấy được (đúng ngữ nghĩa global).
   */
  private async hasHolidayTx(date: string, tx: TenantTx): Promise<boolean> {
    const toExclusive = addDaysToLocalDate(date, 1);
    const rows = await tx
      .select({ id: publicHolidays.id })
      .from(publicHolidays)
      .where(
        and(
          eq(publicHolidays.status, "Active"),
          eq(publicHolidays.affectsAttendance, true),
          isNull(publicHolidays.deletedAt),
          gte(publicHolidays.holidayDate, date),
          lt(publicHolidays.holidayDate, toExclusive),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  /** Existence-check KHÔNG lọc `deleted_at` (chốt #13 — soft-deleted vẫn tính "đã có dữ liệu"). */
  private async hasAnyRecordTx(
    companyId: string,
    userId: string,
    workDate: string,
    tx: TenantTx,
  ): Promise<boolean> {
    const rows = await tx
      .select({ id: attendanceRecords.id })
      .from(attendanceRecords)
      .where(
        and(
          eq(attendanceRecords.companyId, companyId),
          eq(attendanceRecords.userId, userId),
          eq(attendanceRecords.workDate, workDate),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  /** [CHỐT #5] `remote_work_requests` status LẪN CASE (`'Approved'` ∪ `'approved'`) phủ ngày ⇒ loại trừ. */
  private async hasApprovedRemoteTx(
    companyId: string,
    employeeId: string,
    workDate: string,
    tx: TenantTx,
  ): Promise<boolean> {
    const rows = await tx
      .select({ id: remoteWorkRequests.id })
      .from(remoteWorkRequests)
      .where(
        and(
          eq(remoteWorkRequests.companyId, companyId),
          eq(remoteWorkRequests.employeeId, employeeId),
          isNull(remoteWorkRequests.deletedAt),
          inArray(remoteWorkRequests.status, ["Approved", "approved"]),
          lte(remoteWorkRequests.startDate, workDate),
          gte(remoteWorkRequests.endDate, workDate),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }
}
