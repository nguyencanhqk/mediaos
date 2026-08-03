import { fileDownloadStateDenyReason } from "../foundation/files/file-download-state";

/**
 * S7-CHAT-BE-3 — hằng + vị từ thuần của đường đính kèm (SPEC-15 §13.5 · DB-12 §6.5).
 *
 * Ba giá trị đầu là **KHOÁ ĐIỀU PHỐI** của `FilePolicyService`. Chúng nằm ở MỘT chỗ vì hai cách nhìn
 * KHÁC NHAU cùng đọc chúng, và lệch chính tả gây hậu quả ngược nhau tuỳ chiều:
 *
 *   • registry của `FilePolicyService` ghép resolver theo khoá **đã chuẩn hoá** (`trim().toLowerCase()`);
 *   • CHAT truy vấn `file_links` của mình bằng **so-chuỗi chính xác**.
 *
 * ⚠️ Vì vậy KHÔNG đúng khi nói "lệch một ký tự là `deny-no-resolver`" (bản đầu của comment này viết thế —
 * FULL gate chứng minh ngược lại bằng probe): resolver VẪN nhận, tức là VẪN CẤP QUYỀN TẢI, chỉ có CHAT là
 * mù. Một hàng link như thế không lên DTO, không lên tab Tệp, không gỡ được — grant vô hình và vĩnh viễn.
 * Chốt chặn nằm ở biên ghi `FileService.link` (`FilePolicyService.canonicalOwnerKey`); các hằng ở đây là
 * nguồn của dạng chính tắc đó.
 *
 * `CHAT_MODULE_CODE` không lặp lại ở đây — nó đã là hằng trong `chat.errors.ts` (dùng chung với
 * `module_code` của audit).
 */

/** `file_links.entity_type` của mọi đính kèm CHAT. `entity_id` LUÔN là `chat_messages.id`. */
export const CHAT_MESSAGE_ENTITY_TYPE = "chat_message";

/** `file_links.link_type` — ∈ CHECK `chk_file_links_link_type` (mig `0433`). */
export const CHAT_ATTACHMENT_LINK_TYPE = "Attachment";

/**
 * `file_links.access_scope` cho đính kèm chat.
 *
 * ⚠️ Cột này **KHÔNG phải nguồn quyền** — `FilePolicyService` không hề đọc nó; quyền đến từ resolver.
 * Đặt `'Company'` (mặc định của cột) chỉ để không tự chế ngữ nghĩa mới ở một cột không ai enforce.
 */
export const CHAT_ATTACHMENT_ACCESS_SCOPE = "Company";

/**
 * Trần tệp mỗi tin — PHẢI khớp `.max()` của `sendMessageSchema.fileIds` ở contracts.
 * Mỗi fileId là một INSERT `file_links` trong cùng transaction đang giữ hàng phòng.
 */
export const CHAT_MAX_ATTACHMENTS_PER_MESSAGE = 10;

/*
 * KHÔNG có hằng "trần trang tab Tệp" ở đây — CỐ Ý. Trần đó do `listChatRoomFilesQuerySchema.limit.max()`
 * ở contracts ép, và service chỉ đọc `query.limit` đã qua Zod. Khai thêm một hằng ở BE tạo con số thứ
 * hai cho cùng một luật, và bản sao sẽ trôi mà không test nào đỏ (không đường nào so hai giá trị đó).
 * `CHAT_MAX_ATTACHMENTS_PER_MESSAGE` khác: nó được DÙNG trong tính toán ngân sách trang (§`listRoomFiles`).
 */

/** Server quyết định "có phải ảnh không" từ MIME, KHÔNG từ phần mở rộng do client đặt tên. */
export function isImageMimeType(mimeType: string): boolean {
  return mimeType.toLowerCase().startsWith("image/");
}

/**
 * Tệp có ở trạng thái dùng được không (đã tải xong · không nhiễm).
 *
 * ⚠️ UỶ QUYỀN sang `fileDownloadStateDenyReason` của FOUNDATION — KHÔNG viết lại điều kiện. Đây là cùng
 * một câu hỏi ở hai đầu vòng đời (gắn vào tin ⟷ ký URL tải); hai bản sao sẽ trôi ngay lần FOUNDATION
 * thêm một trạng thái mới, và CHAT sẽ gắn/ký một tệp mà FOUNDATION đã từ chối — không test nào bắt được
 * vì mỗi đường đi qua một hằng khác nhau.
 *
 * Dùng ở CẢ HAI đầu: `sendMessage` (CHAT-ERR-015) và `ChatAttachmentPresignService` (bỏ trắng `url`).
 */
export function isAttachableFile(row: { scanStatus: string; uploadStatus: string }): boolean {
  return fileDownloadStateDenyReason(row) === null;
}

/**
 * Cắt trang tab "Tệp" ở RANH GIỚI TIN — không bao giờ để một tin bị chẻ đôi giữa hai trang.
 *
 * ⚠️ VÌ SAO CẦN: con trỏ trang kế là `beforeSeq = room_seq nhỏ nhất của trang này`, và vị từ là
 * `room_seq < beforeSeq` (LOẠI TRỪ). Một tin 3 tệp mà trang cắt sau tệp thứ nhất thì hai tệp còn lại
 * **biến mất vĩnh viễn**: trang này không có chúng, trang sau đã nhảy qua `room_seq` đó. Người dùng thấy
 * tab Tệp thiếu tệp, không lỗi, không log — đúng loại mất mát chỉ lộ ra khi có ai đó đi đếm tay.
 *
 * @param rows PHẢI được lấy dư ít nhất `CHAT_MAX_ATTACHMENTS_PER_MESSAGE + 1` hàng so với `limit`, và
 *   sắp xếp sao cho các hàng cùng `roomSeq` NẰM LIỀN NHAU. Dư đủ là điều kiện để ca biên dưới đây trả
 *   được TRỌN một nhóm.
 *
 * Ca biên: một tin có nhiều tệp hơn cả `limit` (trần 10 tệp/tin, `limit` nhỏ nhất là 1). Cắt sạch sẽ trả
 * **0 hàng** ⇒ client lặp vô hạn trên cùng con trỏ mà không tiến được. Khi đó trả **TRỌN** nhóm đó (vượt
 * `limit` tối đa 9 hàng) — trang vẫn tiến được và không tệp nào rơi.
 */
export function trimToMessageBoundary<T extends { roomSeq: number }>(
  rows: readonly T[],
  limit: number,
): T[] {
  if (rows.length <= limit) return [...rows];

  // Có hàng thứ `limit + 1` ⇒ còn trang sau. Nếu nó CÙNG tin với hàng cuối của trang thì tin đó đang bị
  // chẻ đôi — bỏ toàn bộ hàng của tin đó khỏi trang này, trang sau sẽ lấy trọn.
  const page = rows.slice(0, limit);
  const boundarySeq = rows[limit].roomSeq;
  if (page[page.length - 1].roomSeq !== boundarySeq) return page;

  const trimmed = page.filter((r) => r.roomSeq !== boundarySeq);
  if (trimmed.length > 0) return trimmed;
  return rows.filter((r) => r.roomSeq === boundarySeq);
}
