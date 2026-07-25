/**
 * S5-BE-CONTRACT-1 (WS-D §13.2 "Idempotency") — hằng số dùng CHUNG cho cả hai phía của hợp đồng.
 *
 * Trước WO này, `Idempotency-Key` chỉ tồn tại ở client (`packages/web-core` gắn header khi caller truyền
 * `opts.idempotencyKey`) — KHÔNG endpoint nào phía server đọc nó, và KHÔNG caller nào truyền. Tức là
 * "idempotency" chỉ có trên giấy: bấm-đúp / retry mạng vẫn tạo 2 đơn nghỉ, 2 lần check-in.
 * Đặt tên header + mã lỗi ở `packages/contracts` (nguồn sự thật DTO — CLAUDE.md §4) để hai phía KHÔNG
 * thể lệch chuỗi.
 */

/** Header client gửi để đánh dấu "cùng một ý định" khi retry (RFC 9110 §9.2.2 idempotency). */
export const IDEMPOTENCY_HEADER = "Idempotency-Key";

/** Header server trả khi phản hồi là BẢN PHÁT LẠI của request trước (không chạy lại nghiệp vụ). */
export const IDEMPOTENCY_REPLAYED_HEADER = "Idempotency-Replayed";

/** Giới hạn độ dài khoá — chặn header rác/lạm dụng bộ nhớ. UUID v4 = 36 ký tự. */
export const IDEMPOTENCY_KEY_MAX_LENGTH = 200;

/**
 * Mã lỗi idempotency (SPEC-01 §9 `MODULE-ERR-XXX`). Client bắt theo mã, KHÔNG so khớp message:
 *  - IN_PROGRESS  → request TRƯỚC cùng khoá đang chạy: chờ rồi thử lại, TUYỆT ĐỐI không gửi khoá mới.
 *  - KEY_REUSED   → cùng khoá nhưng NỘI DUNG khác: lỗi phía client (khoá phải sinh mới cho ý định mới).
 *  - INVALID_KEY  → khoá rỗng/quá dài.
 */
export const IDEMPOTENCY_ERROR_CODES = {
  IN_PROGRESS: "REQUEST-ERR-IDEMPOTENCY-IN-PROGRESS",
  KEY_REUSED: "REQUEST-ERR-IDEMPOTENCY-KEY-REUSED",
  INVALID_KEY: "REQUEST-ERR-IDEMPOTENCY-INVALID-KEY",
} as const;

export type IdempotencyErrorCode =
  (typeof IDEMPOTENCY_ERROR_CODES)[keyof typeof IDEMPOTENCY_ERROR_CODES];
