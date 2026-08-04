import { createHash } from "node:crypto";
import { BadRequestException } from "@nestjs/common";
import {
  decodeChatSearchCursor,
  encodeChatSearchCursor,
  type ChatSearchCursor,
} from "./chat-search-cursor";
import { CHAT_ERR } from "./chat.errors";
import type { ChatOversightAuditFilter } from "./chat-oversight-audit-filter";

/**
 * S7-CHAT-BE-9 🔒 — con trỏ phân trang của `CHAT-API-019`, **mang dấu vân của bộ lọc**. Hàm THUẦN.
 *
 * ┌─ VÌ SAO CON TRỎ PHẢI BIẾT BỘ LỌC ĐÃ SINH RA NÓ ─────────────────────────────────────────────────┐
 * │ Khoá keyset là `(sortAt, id)` — nó KHÔNG mô tả tập kết quả, chỉ mô tả một ĐIỂM CẮT trên tập đó.  │
 * │ Con trỏ sinh ở trang `actorUserId=A` mà dùng lại với `actorUserId=B` vẫn là cú pháp hợp lệ: server │
 * │ trả **200 kèm một trang trông rất bình thường**, nhưng nó bị cắt theo mốc thời gian của một tập    │
 * │ khác ⇒ người điều tra mất dòng mà không có bất kỳ tín hiệu nào. Trên đúng màn hình mà nghề của nó  │
 * │ là "đếm đủ bằng chứng", im lặng sai là kiểu hỏng tệ nhất.                                          │
 * │ Vì vậy con trỏ mang thêm **fingerprint** của bộ lọc; lệch ⇒ **400**, không đoán, không rơi trang 1.│
 * └───────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ **KHÔNG sửa `chat-search-cursor.ts`.** Luật "cắt về mili-giây ở CẢ khoá lẫn con trỏ" là thứ dễ hiện
 * thực sai một cách im lặng, nên nó chỉ được phép có MỘT bản. File này **bọc** codec đó, không nhân bản:
 * phần `(sortAt, id)` vẫn do `encode/decodeChatSearchCursor` lo, ở đây chỉ nối thêm một đoạn.
 *
 * ⚠️ Fingerprint tính trên **instant ĐÃ quy đổi**, không trên chuỗi ngày thô. Nhờ vậy đổi
 * `companies.timezone` giữa hai lần lật trang cũng làm con trỏ hết hiệu lực — và đó là ĐÚNG: cửa sổ lọc
 * đã dịch, trang sau không còn nối tiếp trang trước.
 *
 * Fingerprint KHÔNG phải cơ chế bảo mật (nó không ký, client tự chế được): nó chống **trôi**, không chống
 * **giả mạo**. Không cần chống giả mạo ở đây — con trỏ chỉ chứa dữ liệu người gọi đã thấy, và mọi vế
 * quyền/tenant vẫn ép ở tầng dưới.
 */

/** Bảng chữ base64url là `A-Za-z0-9-_` ⇒ `.` không bao giờ xuất hiện trong phần khoá. */
const SEPARATOR = ".";
const FINGERPRINT_LENGTH = 16;
const FINGERPRINT_RE = /^[0-9a-f]{16}$/;

/**
 * Dấu vân của bộ lọc — 16 hex đầu của sha256 trên chuỗi chuẩn hoá.
 *
 * `undefined` và chuỗi rỗng phải cho ra dấu vân KHÁC NHAU ở các trường khác nhau, nên mỗi trường được
 * phân tách bằng `\n` (ký tự không thể có trong UUID lẫn ISO-8601). Cắt 16 hex là đủ: đây là phát hiện
 * nhầm lẫn, không phải chống va chạm có chủ đích.
 */
export function fingerprintAuditFilter(filter: ChatOversightAuditFilter): string {
  const canonical = [
    filter.actorUserId ?? "",
    filter.fromInstant?.toISOString() ?? "",
    filter.toInstantExclusive?.toISOString() ?? "",
  ].join("\n");
  return createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, FINGERPRINT_LENGTH);
}

/** `<base64url(sortAt|id)>.<fingerprint>` — luôn CÓ vế fingerprint, kể cả khi không lọc gì. */
export function encodeOversightAuditCursor(
  keyset: ChatSearchCursor,
  filter: ChatOversightAuditFilter,
): string {
  return `${encodeChatSearchCursor(keyset)}${SEPARATOR}${fingerprintAuditFilter(filter)}`;
}

/**
 * Giải mã + **đối chiếu dấu vân với bộ lọc của REQUEST HIỆN TẠI**.
 *
 * Ba đường hỏng, cùng một kết cục 400:
 *   · thiếu vế fingerprint (con trỏ hình dạng cũ, hoặc client tự chế) → `CHAT-ERR-016`;
 *   · fingerprint lệch (con trỏ của bộ lọc khác)                      → `CHAT-ERR-016` (thông điệp riêng);
 *   · phần khoá hỏng                                                  → `CHAT-ERR-016` (từ codec dùng chung).
 *
 * ⚠️ **KHÔNG có nhánh tương thích ngược cho con trỏ không-fingerprint.** Một nhánh "thiếu thì bỏ qua kiểm
 * tra" chính là lỗ mà WO này bịt, và nó sẽ sống mãi vì không ai dám gỡ. Module CHAT còn `is_active=false`,
 * client duy nhất là `apps/console` — không có con trỏ cũ nào đang lưu hành.
 */
export function decodeOversightAuditCursor(
  raw: string,
  filter: ChatOversightAuditFilter,
): ChatSearchCursor {
  const at = raw.lastIndexOf(SEPARATOR);
  if (at <= 0) {
    throw new BadRequestException(CHAT_ERR.SEARCH_CURSOR_INVALID);
  }

  const fingerprint = raw.slice(at + SEPARATOR.length);
  if (!FINGERPRINT_RE.test(fingerprint)) {
    throw new BadRequestException(CHAT_ERR.SEARCH_CURSOR_INVALID);
  }
  if (fingerprint !== fingerprintAuditFilter(filter)) {
    throw new BadRequestException(CHAT_ERR.OVERSIGHT_CURSOR_FILTER_MISMATCH);
  }

  return decodeChatSearchCursor(raw.slice(0, at));
}
