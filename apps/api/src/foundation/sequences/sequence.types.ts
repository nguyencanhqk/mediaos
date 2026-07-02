/**
 * FOUNDATION-BE-2 SequenceService — types/contracts (BACKEND-04 §8.6/§11.5, DB-08 §8.9).
 *
 * SequenceService sinh mã nghiệp vụ (mã NV, mã đơn nghỉ phép, mã chứng từ…) AN TOÀN-ĐỒNG-THỜI:
 * SELECT ... FOR UPDATE trên `sequence_counters` trong cùng transaction `withTenant` (KHÔNG MAX(code)+1).
 * Mã format = prefix + datePattern(theo tz công ty) + zero-pad(value) + suffix; reset theo chu kỳ
 * Never/Yearly/Monthly/Daily tính theo wall-clock tz công ty (UTC-at-rest — ADR-0008).
 */

/** Chu kỳ reset counter (đồng bộ CHECK reset_policy ở migration 0434). */
export type ResetPolicy = "Never" | "Yearly" | "Monthly" | "Daily";

/** Trạng thái counter (đồng bộ CHECK status ở migration 0434). */
export type SequenceStatus = "Active" | "Inactive";

/** scope_type của counter (đồng bộ CHECK scope_type ở migration 0434). */
export type SequenceScopeType = "System" | "Company" | "Department" | "Employee" | "Custom";

/**
 * Cấu hình format dùng để build mã. Lấy từ row counter; tách riêng để formatter thuần-hàm test được
 * KHÔNG cần DB.
 */
export interface SequenceFormat {
  prefix?: string | null;
  suffix?: string | null;
  /**
   * Mẫu ngày chèn vào mã (token date-fns-like tối giản: yyyy/yy/MM/dd). Tính theo tz công ty.
   * NULL/rỗng = không chèn ngày.
   */
  datePattern?: string | null;
  /** Độ dài zero-pad cho phần số. 0 = không pad. value vượt padding KHÔNG bị cắt. */
  paddingLength: number;
}

/** Input dựng mã từ một giá trị số đã biết (thuần-hàm, không DB). */
export interface BuildCodeInput extends SequenceFormat {
  /** Giá trị số của counter (đã tăng). */
  value: number | bigint;
  /** Instant để render datePattern (mặc định now). Render theo tz công ty. */
  now?: Date;
  /** IANA tz công ty để render datePattern + (ở reset) chu kỳ. */
  timeZone: string;
}

/** Khoá định danh 1 counter trong phạm vi tenant. */
export interface SequenceCounterKey {
  sequenceKey: string;
  scopeType?: SequenceScopeType;
  scopeReferenceId?: string | null;
}

/** Input cấp mã kế tiếp. */
export interface NextCodeInput extends SequenceCounterKey {
  /** Instant để render datePattern + xác định chu kỳ reset (mặc định now). */
  now?: Date;
}

/** Kết quả cấp mã. */
export interface NextCodeResult {
  sequenceKey: string;
  value: number;
  code: string;
}

/** Input xem trước mã kế tiếp (KHÔNG mutate counter). */
export interface PreviewNextCodeInput extends SequenceCounterKey {
  now?: Date;
}

/**
 * Input đảm bảo tồn tại counter (idempotent "insert-if-missing") — dùng khi seed/khởi tạo theo module
 * (S2-FND-SEED-2). `status` mặc định 'Active' khi KHÔNG truyền — truyền 'Inactive' để mirror 1 config đã
 * bị tắt (PATCH-sync employee-code) NGAY TỪ LẦN TẠO ĐẦU (KHÔNG tự ý bật lại — BẤT BIẾN thiết kế counter).
 */
export interface EnsureSequenceCounterInput extends SequenceCounterKey {
  moduleCode: string;
  prefix?: string | null;
  suffix?: string | null;
  datePattern?: string | null;
  paddingLength?: number;
  incrementBy?: number;
  resetPolicy?: ResetPolicy;
  status?: SequenceStatus;
  startValue?: number;
  actorUserId?: string;
}

/** Cấu hình admin được phép sửa (KHÔNG cho sửa current_value qua đường này). */
export interface UpdateSequenceInput {
  prefix?: string | null;
  suffix?: string | null;
  datePattern?: string | null;
  paddingLength?: number;
  incrementBy?: number;
  resetPolicy?: ResetPolicy;
  status?: SequenceStatus;
  actorUserId?: string;
}

/** Lỗi nghiệp vụ: counter không tồn tại trong tenant. */
export class SequenceNotFoundError extends Error {
  constructor(sequenceKey: string) {
    super(`Sequence counter không tồn tại: ${sequenceKey}`);
    this.name = "SequenceNotFoundError";
  }
}

/** Lỗi nghiệp vụ: counter đang Inactive — KHÔNG sinh mã từ counter bị tắt. */
export class SequenceInactiveError extends Error {
  constructor(sequenceKey: string) {
    super(`Sequence counter đang Inactive (không sinh mã): ${sequenceKey}`);
    this.name = "SequenceInactiveError";
  }
}
