import { createHash } from "node:crypto";
import { BadRequestException } from "@nestjs/common";

/**
 * S16-SOCIAL-BE-1 — con trỏ keyset của `GET /social/feed` · `/social/saved` · `…/comments`. Hàm THUẦN,
 * không phụ thuộc Nest/DB ngoài kiểu ngoại lệ.
 *
 * Bản sao CÓ CHỦ Ý của luật ở `chat-search-cursor.ts` + `chat-oversight-audit-cursor.ts`, **không
 * import chúng**: hai file đó ném `CHAT_ERR.*` và mã lỗi là hợp đồng với FE/QA — một route SOCIAL trả
 * `CHAT-ERR-016` là nói dối về module đang hỏng. Luật thì giống hệt và được chép nguyên vẹn dưới đây.
 *
 * ┌─ VÌ SAO CẮT VỀ MILI-GIÂY — ĐỌC TRƯỚC KHI "DỌN" ────────────────────────────────────────────────┐
 * │ `feed_posts.last_activity_at`/`published_at` là `timestamptz`: Postgres lưu **micro-giây**. JS    │
 * │ `Date` chỉ giữ tới **mili-giây**. Sắp xếp theo cột THÔ mà con trỏ chỉ mang mili-giây thì hai bài  │
 * │ cách nhau 300µs trong cùng một mili-giây làm vế `(sortAt, id) < ($ms, $id)` loại LUÔN những hàng  │
 * │ cũ hơn nằm trong chính mili-giây đó ⇒ trang sau **sót bài, HTTP 200, không lỗi**.                 │
 * │ Vì vậy khoá sắp xếp trong SQL PHẢI là `date_trunc('milliseconds', …)` — BẰNG ĐÚNG độ chính xác    │
 * │ con trỏ mang được. Cặp `(trunc(ts), id)` vẫn toàn phần vì `id` là UUID PK.                        │
 * │ ⚠️ KHÔNG thêm hàm "truncateToMillisecond" ở phía JS: `new Date(d.getTime())` là **no-op** (Date   │
 * │ vốn chỉ có mili-giây) — tên hàm hứa một bảo đảm mà thân hàm không cấp.                            │
 * └───────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ VÌ SAO CON TRỎ PHẢI BIẾT BỘ LỌC ĐÃ SINH RA NÓ ───────────────────────────────────────────────────┐
 * │ Khoá keyset là một ĐIỂM CẮT, không mô tả tập kết quả. Con trỏ sinh ở `sort=active` dùng lại với    │
 * │ `sort=latest` (hai CỘT sắp xếp khác nhau!), hay sinh ở `tag=x` dùng lại với `tag=y`, vẫn là cú     │
 * │ pháp hợp lệ: server trả **200 kèm một trang trông rất bình thường** nhưng bị cắt theo mốc của tập  │
 * │ khác ⇒ người dùng mất bài, không tín hiệu nào. Vì vậy con trỏ mang **fingerprint** của bộ lọc;     │
 * │ lệch ⇒ **400**, không đoán, KHÔNG im lặng rơi về trang đầu (rơi về trang đầu biến con trỏ hỏng     │
 * │ thành vòng lặp vô hạn ở FE: trang 2 luôn trả trang 1).                                            │
 * │ Fingerprint KHÔNG phải cơ chế bảo mật (không ký, client tự chế được): nó chống **trôi**, không     │
 * │ chống **giả mạo** — mọi vế quyền/tenant vẫn ép ở tầng dưới, và con trỏ chỉ chứa dữ liệu người gọi  │
 * │ đã thấy.                                                                                          │
 * └───────────────────────────────────────────────────────────────────────────────────────────────────┘
 */

export interface SocialCursor {
  /** Mốc sắp xếp ĐÃ cắt về mili-giây, dạng ISO-8601 UTC (`…THH:mm:ss.sssZ`). */
  sortAt: Date;
  /** `id` của hàng cuối trang trước — vế phá hoà của khoá. */
  id: string;
}

/** Mã lỗi RIÊNG của SOCIAL — KHÔNG tái dùng chuỗi của CHAT. */
export const SOCIAL_CURSOR_INVALID =
  "SOCIAL-ERR-001: con trỏ phân trang không hợp lệ — hãy tải lại danh sách từ đầu.";
export const SOCIAL_CURSOR_FILTER_MISMATCH =
  "SOCIAL-ERR-001: con trỏ phân trang thuộc về một bộ lọc khác — hãy tải lại danh sách từ đầu.";

/** Bảng chữ base64url là `A-Za-z0-9-_` ⇒ `.` không bao giờ xuất hiện trong phần khoá. */
const FP_SEPARATOR = ".";
const KEY_SEPARATOR = "|";
const FINGERPRINT_LENGTH = 16;
const FINGERPRINT_RE = /^[0-9a-f]{16}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Dấu vân của bộ lọc — 16 hex đầu của sha256 trên chuỗi chuẩn hoá.
 *
 * `undefined` và chuỗi rỗng phải cho ra dấu vân KHÁC NHAU ở các trường khác nhau, nên mỗi trường được
 * phân tách bằng `\n` (ký tự không thể có trong UUID, tên thẻ, hay tên enum). Cắt 16 hex là đủ: đây
 * là phát hiện nhầm lẫn, không phải chống va chạm có chủ đích.
 *
 * Caller truyền MỌI thứ ảnh hưởng tới tập kết quả HOẶC tới cột sắp xếp. Quên một trường = mở lại đúng
 * cái lỗ này cho trường đó.
 */
export function fingerprintFeedFilter(parts: readonly (string | null | undefined)[]): string {
  return createHash("sha256")
    .update(parts.map((p) => p ?? "").join("\n"), "utf8")
    .digest("hex")
    .slice(0, FINGERPRINT_LENGTH);
}

/** `<base64url(sortAt|id)>.<fingerprint>` — LUÔN có vế fingerprint, kể cả khi không lọc gì. */
export function encodeFeedCursor(cursor: SocialCursor, fingerprint: string): string {
  const payload = `${cursor.sortAt.toISOString()}${KEY_SEPARATOR}${cursor.id}`;
  const key = Buffer.from(payload, "utf8").toString("base64url");
  return `${key}${FP_SEPARATOR}${fingerprint}`;
}

/**
 * Giải mã + **đối chiếu dấu vân với bộ lọc của REQUEST HIỆN TẠI**. Ba đường hỏng, cùng kết cục 400:
 * thiếu vế fingerprint · fingerprint lệch · phần khoá hỏng.
 *
 * ⚠️ **KHÔNG có nhánh tương thích ngược cho con trỏ không-fingerprint.** Một nhánh "thiếu thì bỏ qua
 * kiểm tra" chính là lỗ mà hàm này bịt, và nó sẽ sống mãi vì không ai dám gỡ. Module SOCIAL chưa
 * `is_active` (FE-1 mới bật cờ) ⇒ không có con trỏ cũ nào đang lưu hành.
 */
export function decodeFeedCursor(raw: string, fingerprint: string): SocialCursor {
  const invalid = (): never => {
    throw new BadRequestException(SOCIAL_CURSOR_INVALID);
  };

  const at = raw.lastIndexOf(FP_SEPARATOR);
  if (at <= 0) invalid();

  const got = raw.slice(at + FP_SEPARATOR.length);
  if (!FINGERPRINT_RE.test(got)) invalid();
  if (got !== fingerprint) {
    throw new BadRequestException(SOCIAL_CURSOR_FILTER_MISMATCH);
  }

  let payload = "";
  try {
    payload = Buffer.from(raw.slice(0, at), "base64url").toString("utf8");
  } catch {
    invalid();
  }

  const sep = payload.indexOf(KEY_SEPARATOR);
  if (sep <= 0) invalid();
  const isoPart = payload.slice(0, sep);
  const idPart = payload.slice(sep + KEY_SEPARATOR.length);

  if (!UUID_RE.test(idPart)) invalid();

  const parsed = new Date(isoPart);
  if (Number.isNaN(parsed.getTime())) invalid();
  // Vòng khứ hồi phải TRÙNG NGUYÊN VĂN: chặn `"2026-08-03"` hay `"…T01:02:03Z"` (thiếu mili-giây)
  // lọt qua `new Date()` rồi so lệch với khoá sắp xếp đã cắt-về-mili-giây.
  if (parsed.toISOString() !== isoPart) invalid();

  return { sortAt: parsed, id: idPart };
}
