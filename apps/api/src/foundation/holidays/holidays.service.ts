import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { addDaysToLocalDate, monthDateRange } from "../../common/tz.util";
import { DatabaseService } from "../../db/db.service";
import { publicHolidays } from "../../db/schema/holidays";
import type {
  CheckWorkingDayQuery,
  CreateHolidayInput,
  HolidayListQuery,
  UpdateHolidayInput,
} from "./holidays.dto";
import {
  DEFAULT_WORKING_DAYS,
  computeIsWorkingDay,
  effectiveHolidaysForDate,
  filterByCountry,
} from "./holidays.logic";
import { HolidaysRepository } from "./holidays.repository";
import { isUniqueViolation } from "../../common/db-error";

type HolidayRow = typeof publicHolidays.$inferSelect;

interface Actor {
  id: string;
  companyId: string;
}

/** DTO trả ra — `scope` cho FE phân biệt global vs riêng công ty mà không cần đoán từ companyId. */
export interface HolidayView {
  id: string;
  scope: "company" | "global";
  companyId: string | null;
  holidayCode: string;
  name: string;
  holidayDate: string;
  holidayType: string;
  countryCode: string | null;
  regionCode: string | null;
  isRecurring: boolean;
  affectsAttendance: boolean;
  affectsLeaveCalculation: boolean;
  isPaidHoliday: boolean;
  status: string;
  source: string | null;
  description: string | null;
}

function toHolidayView(row: HolidayRow): HolidayView {
  return {
    id: row.id,
    scope: row.companyId === null ? "global" : "company",
    companyId: row.companyId,
    holidayCode: row.holidayCode,
    name: row.name,
    holidayDate: row.holidayDate,
    holidayType: row.holidayType,
    countryCode: row.countryCode,
    regionCode: row.regionCode,
    isRecurring: row.isRecurring,
    affectsAttendance: row.affectsAttendance,
    affectsLeaveCalculation: row.affectsLeaveCalculation,
    isPaidHoliday: row.isPaidHoliday,
    status: row.status,
    source: row.source,
    description: row.description,
  };
}

/**
 * FOUNDATION-BE-6 — HolidayService.
 *
 * Đọc holiday CỦA CÔNG TY + GLOBAL (RLS lo cô lập tenant). Override theo NGÀY: holiday công ty đè holiday
 * global cùng ngày (DB-08 §8.10 rule 1). `isWorkingDay` / `getHolidaysInRange` là HỢP ĐỒNG NỘI BỘ cho
 * ATT/LEAVE (chấm công, tính phép). CRUD chỉ tạo/sửa/xoá holiday RIÊNG CÔNG TY (global do seed/system).
 *
 * GHI CHÚ: chưa ghi audit ở WO này — AuditService v2 (FOUNDATION-BE-3) đang được xây song song; wiring
 * audit cho CONFIG_UPDATE holiday để FOUNDATION-BE-9 (gom FoundationModule) làm khi API audit ổn định.
 * weekend lấy mặc định Thứ 2–Thứ 6; caller (ATT/LEAVE) truyền workingDays riêng khi SettingService (BE-1) sẵn.
 */
@Injectable()
export class HolidaysService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: HolidaysRepository,
  ) {}

  // ─── Internal contract cho ATT/LEAVE ─────────────────────────────────────────

  /**
   * Holiday HIỆU DỤNG (đã override company>global) trong [from, toExclusive). Batch 1 query — KHÔNG gọi
   * từng ngày N lần. ATT/LEAVE gọi 1 lần cho cả kỳ rồi tra cứu cục bộ.
   */
  async getHolidaysInRange(
    companyId: string,
    from: string,
    toExclusive: string,
    opts?: { countryCode?: string | null; companyOnly?: boolean },
  ): Promise<HolidayView[]> {
    const rows = await this.repo.findInRange(companyId, {
      from,
      toExclusive,
      companyOnly: opts?.companyOnly,
    });
    const filtered = filterByCountry(rows, opts?.countryCode ?? null);
    const dates = [...new Set(filtered.map((r) => r.holidayDate))].sort();
    return dates.flatMap((d) => effectiveHolidaysForDate(filtered, d)).map(toHolidayView);
  }

  /** `date` có phải ngày làm việc của công ty không (weekend + holiday override company>global). */
  async isWorkingDay(
    companyId: string,
    date: string,
    opts?: { countryCode?: string | null; workingDays?: readonly number[] },
  ): Promise<boolean> {
    const effective = await this.effectiveForDate(companyId, date, opts?.countryCode ?? null);
    return computeIsWorkingDay(date, effective, opts?.workingDays ?? DEFAULT_WORKING_DAYS);
  }

  private async effectiveForDate(
    companyId: string,
    date: string,
    countryCode: string | null,
  ): Promise<HolidayRow[]> {
    const rows = await this.repo.findInRange(companyId, {
      from: date,
      toExclusive: addDaysToLocalDate(date, 1),
    });
    return effectiveHolidaysForDate(filterByCountry(rows, countryCode), date);
  }

  // ─── HTTP surface ────────────────────────────────────────────────────────────

  listHolidays(companyId: string, query: HolidayListQuery): Promise<HolidayView[]> {
    const { from, toExclusive } = resolveRange(query);
    return this.getHolidaysInRange(companyId, from, toExclusive, {
      countryCode: query.countryCode ?? null,
      companyOnly: query.companyOnly ?? false,
    });
  }

  async checkWorkingDay(companyId: string, query: CheckWorkingDayQuery) {
    const effective = await this.effectiveForDate(companyId, query.date, query.countryCode ?? null);
    return {
      date: query.date,
      isWorkingDay: computeIsWorkingDay(query.date, effective),
      holidays: effective.map(toHolidayView),
    };
  }

  // ─── CRUD (chỉ holiday RIÊNG CÔNG TY) ────────────────────────────────────────

  createHoliday(actor: Actor, dto: CreateHolidayInput): Promise<HolidayView> {
    return this.db.withTenant(actor.companyId, async (tx) => {
      try {
        const [row] = await this.repo.insertTx(
          actor.companyId,
          {
            holidayCode: dto.holidayCode,
            name: dto.name,
            holidayDate: dto.holidayDate,
            holidayType: dto.holidayType ?? "CompanyHoliday",
            countryCode: dto.countryCode ?? null,
            regionCode: dto.regionCode ?? null,
            isRecurring: dto.isRecurring ?? false,
            affectsAttendance: dto.affectsAttendance ?? true,
            affectsLeaveCalculation: dto.affectsLeaveCalculation ?? true,
            isPaidHoliday: dto.isPaidHoliday ?? true,
            description: dto.description ?? null,
            source: "manual",
            createdBy: actor.id,
            updatedBy: actor.id,
          },
          tx,
        );
        return toHolidayView(row);
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new ConflictException("Ngày nghỉ trùng (mã + ngày đã tồn tại trong công ty).");
        }
        throw err;
      }
    });
  }

  updateHoliday(actor: Actor, id: string, dto: UpdateHolidayInput): Promise<HolidayView> {
    return this.db.withTenant(actor.companyId, async (tx) => {
      const [existing] = await this.repo.findOwnByIdTx(actor.companyId, id, tx);
      if (!existing) throw new NotFoundException("Không tìm thấy ngày nghỉ.");

      const patch: Partial<typeof publicHolidays.$inferInsert> = { updatedBy: actor.id };
      if (dto.holidayCode !== undefined) patch.holidayCode = dto.holidayCode;
      if (dto.name !== undefined) patch.name = dto.name;
      if (dto.holidayDate !== undefined) patch.holidayDate = dto.holidayDate;
      if (dto.holidayType !== undefined) patch.holidayType = dto.holidayType;
      if (dto.countryCode !== undefined) patch.countryCode = dto.countryCode;
      if (dto.regionCode !== undefined) patch.regionCode = dto.regionCode;
      if (dto.isRecurring !== undefined) patch.isRecurring = dto.isRecurring;
      if (dto.affectsAttendance !== undefined) patch.affectsAttendance = dto.affectsAttendance;
      if (dto.affectsLeaveCalculation !== undefined)
        patch.affectsLeaveCalculation = dto.affectsLeaveCalculation;
      if (dto.isPaidHoliday !== undefined) patch.isPaidHoliday = dto.isPaidHoliday;
      if (dto.description !== undefined) patch.description = dto.description;

      try {
        const [row] = await this.repo.updateOwnTx(actor.companyId, id, patch, tx);
        if (!row) throw new NotFoundException("Không tìm thấy ngày nghỉ.");
        return toHolidayView(row);
      } catch (err) {
        if (isUniqueViolation(err)) throw new ConflictException("Ngày nghỉ trùng (mã + ngày).");
        throw err;
      }
    });
  }

  deleteHoliday(actor: Actor, id: string): Promise<{ id: string; deleted: true }> {
    return this.db.withTenant(actor.companyId, async (tx) => {
      const [row] = await this.repo.softDeleteOwnTx(actor.companyId, id, actor.id, tx);
      if (!row) throw new NotFoundException("Không tìm thấy ngày nghỉ.");
      return { id: row.id, deleted: true as const };
    });
  }
}

/** Khoảng [from, toExclusive) từ query year/month — mặc định năm hiện tại; có month → đúng 1 tháng. */
function resolveRange(query: HolidayListQuery): { from: string; toExclusive: string } {
  const year = query.year ?? new Date().getUTCFullYear();
  if (query.month) {
    return monthDateRange(`${year}-${String(query.month).padStart(2, "0")}`);
  }
  return { from: `${year}-01-01`, toExclusive: `${year + 1}-01-01` };
}
