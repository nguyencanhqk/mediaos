/**
 * Helpers định dạng/convert cho viewer Audit log (S2-FE-FND-2).
 */
import { format, subDays } from "date-fns";

/**
 * S2-FE-FND-7 (§7) — cửa sổ lọc mặc định: nhìn lại 30 ngày gần nhất.
 * Trước đây filter mặc định RỖNG → tải toàn bộ lịch sử (nặng + khó dùng). Đặt fromDate = hôm-nay−30.
 */
export const AUDIT_DEFAULT_RANGE_DAYS = 30;

/** Bộ lọc viewer Audit log (form draft + applied dùng chung shape). */
export type AuditLogFilters = {
  moduleCode: string;
  action: string;
  actorUserId: string;
  entityType: string;
  fromDate: string; // yyyy-mm-dd (date-only input)
  toDate: string;
};

/** yyyy-MM-dd của (hôm nay − AUDIT_DEFAULT_RANGE_DAYS ngày) — dùng làm fromDate mặc định. */
export function defaultAuditFromDate(now: Date = new Date()): string {
  return format(subDays(now, AUDIT_DEFAULT_RANGE_DAYS), "yyyy-MM-dd");
}

/**
 * Tạo bộ lọc khởi tạo — fromDate = mặc-định-30-ngày (áp cho CẢ draft LẪN applied), toDate để mở
 * ("đến hiện tại"). resetFilters của useAuditLogFilters trả về CHÍNH object này (không phải rỗng).
 */
export function createInitialAuditFilters(now: Date = new Date()): AuditLogFilters {
  return {
    moduleCode: "",
    action: "",
    actorUserId: "",
    entityType: "",
    fromDate: defaultAuditFromDate(now),
    toDate: "",
  };
}

/** Chuyển 1 chuỗi rỗng → undefined (để KHÔNG gửi param rỗng lên API). */
export function emptyToUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** ISO datetime → chuỗi hiển thị vi-VN (an toàn với chuỗi rỗng/không hợp lệ). */
export function toDateFromIso(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("vi-VN");
}

/**
 * input[type=date] "yyyy-mm-dd" → ISO datetime đầu ngày (00:00:00.000Z), khớp
 * `auditLogQuerySchema.dateFrom` (z.string().datetime()). Rỗng → undefined.
 */
export function toIsoRangeStart(dateOnly: string): string | undefined {
  const trimmed = dateOnly.trim();
  if (trimmed === "") return undefined;
  return `${trimmed}T00:00:00.000Z`;
}

/**
 * input[type=date] "yyyy-mm-dd" → ISO datetime cuối ngày (23:59:59.999Z), khớp
 * `auditLogQuerySchema.dateTo`. Rỗng → undefined.
 */
export function toIsoRangeEnd(dateOnly: string): string | undefined {
  const trimmed = dateOnly.trim();
  if (trimmed === "") return undefined;
  return `${trimmed}T23:59:59.999Z`;
}
