import { createHash } from "node:crypto";
import { BadRequestException } from "@nestjs/common";
import { CHAT_ERR } from "./chat.errors";

/**
 * S17-CHAT-UX2-BE-2 — con trỏ phân trang của `CHAT-API-031`, **mang dấu vân PHÒNG**. Hàm THUẦN.
 *
 * ┌─ VÌ SAO KHÔNG DÙNG LẠI `beforeSeq` CỦA CHAT-API-017 ───────────────────────────────────────────┐
 * │ `beforeSeq` là con trỏ theo TIN. Tab «Tệp» sống được với nó nhờ `trimToMessageBoundary`: cắt    │
 * │ trang ở ranh giới tin, chấp nhận trang dài/ngắn hơn `limit`. Ở `/links` cách đó KHÔNG dùng lại  │
 * │ được — một tin có thể chứa NHIỀU liên kết hơn cả `limit`, và khi đó "trả trọn nhóm" nghĩa là    │
 * │ trần trang không còn là trần. Vì vậy con trỏ ở đây phải chỉ được vào GIỮA một tin.              │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ VÌ SAO CON TRỎ PHẢI BIẾT PHÒNG ĐÃ SINH RA NÓ ─────────────────────────────────────────────────┐
 * │ `room_seq` là **per-room** (mig `0539`): phòng nào cũng đánh số từ 1. Con trỏ `roomSeq=40` sinh │
 * │ ở phòng A đem dùng ở phòng B vẫn hợp cú pháp, và server trả **200 kèm một trang trông rất bình  │
 * │ thường** — cắt theo mốc của một phòng khác. Không lỗi, không log, chỉ là một danh sách thiếu.   │
 * │ Vì vậy con trỏ mang thêm vân của `roomId`; lệch ⇒ **400 CHAT-ERR-016**, không đoán, không âm    │
 * │ thầm rơi về trang đầu (rơi về trang đầu biến con trỏ hỏng thành vòng lặp vô hạn ở FE).          │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ **KHÔNG bọc `chat-search-cursor.ts`.** Codec đó mang `(sortAt, id)` — sai hệ quy chiếu ở đây
 * (`/links` sắp theo `room_seq`, không theo thời gian). Cái được sao khuôn từ
 * `chat-oversight-audit-cursor.ts` là **luật vân**, không phải phần khoá.
 *
 * Vân KHÔNG phải cơ chế bảo mật (không ký, client tự chế được): nó chống **trôi**, không chống **giả
 * mạo**. Không cần chống giả mạo — con trỏ chỉ chứa số người gọi đã thấy, còn membership/tenant vẫn ép
 * ở tầng dưới (`assertMember` + RLS).
 */

/** Bảng chữ base64url là `A-Za-z0-9-_` ⇒ `.` không bao giờ xuất hiện trong phần khoá. */
const SEPARATOR = ".";
const FINGERPRINT_LENGTH = 16;
const FINGERPRINT_RE = /^[0-9a-f]{16}$/;
const KEY_SEPARATOR = "|";

/**
 * `linkIndex` = **vị trí ĐÃ TIÊU THỤ cuối cùng**, không phải "vị trí bắt đầu trang sau".
 *
 * | giá trị | nghĩa | trang kế đọc từ đâu |
 * | --- | --- | --- |
 * | `≥ 0`   | đã trả tới liên kết thứ `linkIndex` của tin `roomSeq` | `room_seq <= roomSeq`, bỏ qua link `idx <= linkIndex` ở đúng tin đó |
 * | `-1`    | đã tiêu thụ TRỌN tin `roomSeq` (kể cả tin 0 link)      | `room_seq < roomSeq` |
 *
 * Vế `-1` là thứ làm cho ca "chạm trần quét" lật tiếp được: khi 50 tin liền không có link nào, không có
 * link cuối để trỏ vào, nhưng vị trí quét thì vẫn phải ghi lại — nếu không client lật lại đúng 50 tin đó
 * mãi mãi.
 */
export interface ChatRoomLinksCursor {
  roomSeq: number;
  linkIndex: number;
}

/** Vân của phòng — 16 hex đầu của sha256(roomId). Đủ để phát hiện NHẦM LẪN; không nhằm chống va chạm. */
export function fingerprintChatRoom(roomId: string): string {
  return createHash("sha256").update(roomId, "utf8").digest("hex").slice(0, FINGERPRINT_LENGTH);
}

/** `<base64url(roomSeq|linkIndex)>.<vân phòng>` — LUÔN có vế vân, không có hình dạng thứ hai. */
export function encodeChatRoomLinksCursor(cursor: ChatRoomLinksCursor, roomId: string): string {
  const payload = `${cursor.roomSeq}${KEY_SEPARATOR}${cursor.linkIndex}`;
  const key = Buffer.from(payload, "utf8").toString("base64url");
  return `${key}${SEPARATOR}${fingerprintChatRoom(roomId)}`;
}

/**
 * Giải mã + **đối chiếu vân với phòng của REQUEST HIỆN TẠI**. Mọi đường hỏng cùng một kết cục: 400.
 *
 * ⚠️ **KHÔNG có nhánh tương thích ngược cho con trỏ không-vân.** Một nhánh "thiếu vân thì bỏ qua kiểm
 * tra" chính là lỗ mà vân dựng ra để bịt, và nó sẽ sống mãi vì không ai dám gỡ. `CHAT-API-031` là route
 * MỚI ⇒ không có con trỏ cũ nào đang lưu hành.
 */
export function decodeChatRoomLinksCursor(raw: string, roomId: string): ChatRoomLinksCursor {
  const invalid = (): never => {
    throw new BadRequestException(CHAT_ERR.LINKS_CURSOR_INVALID);
  };

  const at = raw.lastIndexOf(SEPARATOR);
  if (at <= 0) invalid();

  const fingerprint = raw.slice(at + SEPARATOR.length);
  if (!FINGERPRINT_RE.test(fingerprint)) invalid();
  if (fingerprint !== fingerprintChatRoom(roomId)) {
    throw new BadRequestException(CHAT_ERR.LINKS_CURSOR_ROOM_MISMATCH);
  }

  let payload = "";
  try {
    payload = Buffer.from(raw.slice(0, at), "base64url").toString("utf8");
  } catch {
    invalid();
  }

  const sep = payload.indexOf(KEY_SEPARATOR);
  if (sep <= 0) invalid();
  const roomSeq = Number(payload.slice(0, sep));
  const linkIndex = Number(payload.slice(sep + KEY_SEPARATOR.length));

  // `Number.isSafeInteger` chứ không `parseInt`: `parseInt("12abc")` = 12 — nó nuốt phần rác và cho một
  // con trỏ "hợp lệ" chỉ trong im lặng. `Number("")` = 0 nên vế `sep <= 0` ở trên phải chạy trước.
  if (!Number.isSafeInteger(roomSeq) || roomSeq < 1) invalid();
  if (!Number.isSafeInteger(linkIndex) || linkIndex < -1) invalid();

  return { roomSeq, linkIndex };
}
