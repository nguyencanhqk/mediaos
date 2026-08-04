import { addDaysToLocalDate, wallTimeToInstant } from "../common/tz.util";

/**
 * S7-CHAT-BE-9 🔒 — quy đổi bộ lọc của `CHAT-API-019` từ **NGÀY công ty** sang **khoảng instant**. Hàm
 * THUẦN: không Nest, không DB, không đọc đồng hồ.
 *
 * ┌─ VÌ SAO QUY ĐỔI Ở SERVER, KHÔNG Ở CLIENT ───────────────────────────────────────────────────────┐
 * │ CHAT-SCREEN-008 hỏi "ngày 04/08 ai đã đọc-vượt?". Nếu client tự đổi ngày → mốc UTC thì hai người  │
 * │ ngồi hai múi giờ hỏi CÙNG một câu và nhận HAI kết quả khác nhau — trên một sổ kiểm soát, đó là hai │
 * │ phiên bản sự thật. Ngày là khái niệm của CÔNG TY (cột `companies.timezone` — KHÔNG phải khoá KV    │
 * │ `company.timezone`, khoá đó là hàng chết, xem `ChatOversightService.resolveCompanyTimeZone`), nên  │
 * │ phép quy đổi phải nằm ở nơi biết TZ công ty.                                                      │
 * └───────────────────────────────────────────────────────────────────────────────────────────────────┘
 */

/** Bộ lọc đã quy đổi — dạng repo tiêu thụ được. Mọi trường `undefined` = không giới hạn. */
export interface ChatOversightAuditFilter {
  actorUserId?: string;
  /** Cận dưới **BAO GỒM** (`created_at >= …`). */
  fromInstant?: Date;
  /** Cận trên **LOẠI TRỪ** (`created_at < …`) — xem cảnh báo ở `resolveAuditFilter`. */
  toInstantExclusive?: Date;
}

export interface AuditFilterQuery {
  actorUserId?: string;
  /** `YYYY-MM-DD` theo TZ công ty, BAO GỒM ngày này. */
  from?: string;
  /** `YYYY-MM-DD` theo TZ công ty, BAO GỒM ngày này. */
  to?: string;
}

/**
 * `{ from, to }` (ngày công ty) → `{ fromInstant, toInstantExclusive }`.
 *
 * ┌─ ⚠️ CẬN TRÊN PHẢI NỬA MỞ — ĐỪNG "SỬA" VỀ `<= 23:59:59.999` ─────────────────────────────────────┐
 * │ `audit_logs.created_at` là `timestamptz`: Postgres lưu **micro-giây**. Một dòng ghi lúc            │
 * │ `23:59:59.9995` LỚN HƠN `23:59:59.999`, nên mốc đóng làm mất đúng những dòng cuối ngày — HTTP 200, │
 * │ không lỗi, không cảnh báo. Nửa mở tới **00:00:00 của ngày kế** thì không có khe nào để lọt.        │
 * │ Cùng họ bẫy với `date_trunc('milliseconds', …)` ở `chat-search-cursor.ts`, chỉ khác đầu dải.       │
 * └───────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ `wallTimeToInstant` (two-pass, ADR-0008) chứ không phải `new Date(`${day}T00:00:00`)`: chuỗi không
 * hậu tố Z được Node đọc theo TZ **của tiến trình**, tức cửa sổ lọc phụ thuộc vào máy chạy API — cùng một
 * câu hỏi cho hai đáp án khác nhau giữa dev và PROD. Two-pass cũng là bản DUY NHẤT giải DST gap/overlap
 * ổn định của repo (VN không DST, nhưng luật không được phụ thuộc vào điều đó).
 *
 * `assertValidTimezone` KHÔNG gọi ở đây: caller (`ChatOversightService`) đã chốt tz hợp lệ trước khi vào —
 * hàm thuần này không có chỗ để log cảnh báo, và ném ở đây sẽ giết cả màn nhật ký vì một ô cấu hình sai.
 */
export function resolveAuditFilter(
  query: AuditFilterQuery,
  timeZone: string,
): ChatOversightAuditFilter {
  return {
    ...(query.actorUserId === undefined ? {} : { actorUserId: query.actorUserId }),
    ...(query.from === undefined
      ? {}
      : { fromInstant: wallTimeToInstant(query.from, "00:00:00", timeZone) }),
    ...(query.to === undefined
      ? {}
      : {
          toInstantExclusive: wallTimeToInstant(
            addDaysToLocalDate(query.to, 1),
            "00:00:00",
            timeZone,
          ),
        }),
  };
}
