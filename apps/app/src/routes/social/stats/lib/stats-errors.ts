/**
 * S16-SOCIAL-FE-3B (L5) — lỗi của màn Thống kê tương tác: `052` (đọc số liệu) và `053` (xuất XLSX) CHUNG một
 * bảng — hai route cùng guard, cùng schema query, cùng phép kiểm phạm vi đơn vị (plan §3 L5).
 *
 * Màn / nút chỉ gọi `describeStatsError(err, params)` rồi làm theo `recovery` — không tự suy từ status / mã:
 *  · `clearOrgUnit` — đơn vị đang lọc nằm ngoài phạm vi ⇒ màn vẽ «Bỏ lọc đơn vị»;
 *  · `resetRange`   — khoảng ngày đang gửi bị từ chối ⇒ màn vẽ «Về mặc định»;
 *  · `retry`        — gửi lại NGUYÊN yêu cầu đó có thể thành công ⇒ «Thử lại»;
 *  · `none`         — kết cục (403 tầng quyền…): thử lại vô ích, không có nút.
 *
 * Cả hai lời gọi đều CHỈ ĐỌC (053 chỉ ghi audit) ⇒ không có nhánh «chưa rõ đã ghi hay chưa»: mọi lỗi không
 * phải 403 / 400 là `generic` + thử lại, kể cả hết hạn chờ và tệp tải về hỏng.
 *
 * Mọi `reason` thuộc tập đóng `ADMIN_ERROR_REASONS` ⇒ đưa thẳng vào `<AdminErrorNotice reason>`. `message`
 * của server không đi qua bất kỳ trường nào ở đây.
 */
import { SOCIAL_ERROR_CODES } from "@mediaos/contracts";
import type { FeedEngagementParams } from "@mediaos/web-core";
import {
  adminErrorReason,
  behaviorOf,
  type AdminBehaviorTable,
  type AdminErrorReason,
  type AdminErrorTable,
} from "../../admin/lib/admin-errors";

/** 052 · 053. 403 mang mã này là «đơn vị ngoài phạm vi», KHÁC 403 tầng quyền (`forbidden`). */
export const STATS_ERROR_TABLE = {
  [SOCIAL_ERROR_CODES.STATS_UNIT_OUT_OF_SCOPE]: "statsUnitOutOfScope",
} as const satisfies AdminErrorTable;

export type StatsErrorRecovery = "clearOrgUnit" | "resetRange" | "retry" | "none";

export interface StatsErrorOutcome {
  reason: AdminErrorReason;
  recovery: StatsErrorRecovery;
}

/**
 * `053` trả 2xx nhưng thứ nhận được không phải một tệp dùng được (rỗng · trang HTML / JSON của proxy). Ném
 * trong lượt xuất để nó đi CÙNG đường với mọi lỗi khác: có dải lỗi, không tải tệp.
 */
export class StatsExportFileError extends Error {
  constructor() {
    super("Stats export returned an unusable file");
    this.name = "StatsExportFileError";
  }
}

const STATS_ERROR_RECOVERY: AdminBehaviorTable<StatsErrorRecovery> = {
  statsUnitOutOfScope: "clearOrgUnit",
  statsRangeInvalid: "resetRange",
  forbidden: "none",
  invalidRequest: "none",
  generic: "retry",
};

/**
 * `params` = tham số của CHÍNH yêu cầu vừa hỏng. 400 chỉ được quy cho khoảng ngày khi yêu cầu có gửi khoảng:
 * không gửi mà vẫn 400 thì «Về mặc định» không đổi được gì ⇒ `invalidRequest`, không mời bấm.
 */
export function describeStatsError(err: unknown, params: FeedEngagementParams): StatsErrorOutcome {
  const base = adminErrorReason(err, STATS_ERROR_TABLE);
  const sentRange = params.from !== undefined || params.to !== undefined;
  const reason: AdminErrorReason =
    base === "invalidRequest" && sentRange ? "statsRangeInvalid" : base;
  return { reason, recovery: behaviorOf(STATS_ERROR_RECOVERY, reason) };
}
