import { Injectable } from "@nestjs/common";
import type {
  ChatRoomLinkDto,
  ChatRoomLinksResponseDto,
  ListChatRoomLinksQuery,
} from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { ChatAccessService } from "./chat-access.service";
import { extractChatLinks } from "./chat-link-extract";
import {
  decodeChatRoomLinksCursor,
  encodeChatRoomLinksCursor,
  type ChatRoomLinksCursor,
} from "./chat-links-cursor";
import { ChatMessagesRepository, type ChatLinkCandidateRow } from "./chat-messages.repository";
import type { ChatActor } from "./chat-rooms.service";

/**
 * S17-CHAT-UX2-BE-2 — `CHAT-API-031` `GET /chat/rooms/:id/links` (SPEC-15 §15b · CHAT-FUNC-025 ·
 * CHAT-DEC-025 — accordion «Liên kết» của bảng thông tin phòng v2).
 *
 * ┌─ HAI TRẦN KHÁC NHAU, ĐỪNG GỘP ────────────────────────────────────────────────────────────────┐
 * │ • `limit` (1..50) — trần **KẾT QUẢ**: bao nhiêu liên kết trả về một trang.                     │
 * │ • `SCAN_CAP` (50)  — trần **CÔNG**: bao nhiêu TIN được đọc để tìm ra chúng.                    │
 * │                                                                                                │
 * │ Hai trần này tồn tại vì mật độ liên kết trong tin là bất kỳ: một phòng 5000 tin có thể không   │
 * │ có link nào. Không có `SCAN_CAP` thì "trang 1 của bảng Liên kết" là một lần quét cả phòng.     │
 * │ Nhưng trần công làm sinh ra một trạng thái mà trần kết quả không có: **trang rỗng mà chưa      │
 * │ hết dữ liệu** — và đó là lý do DTO phải mang `truncated` (API-13 §5.1d(6)).                    │
 * └────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ `truncated: true` **KHÔNG** phải "trang đầy". Trang đầy là chuyện bình thường và `nextCursor` đã
 * nói đủ. `truncated` chỉ đúng khi server **dừng vì hết ngân sách quét**, tức client biết rằng lật tiếp
 * là còn, dù trang này ít (hoặc rỗng). Nhầm hai thứ này là dựng lại đúng lỗi đã bịt ở `018a`: "cắt trang
 * mà im lặng đọc ra y hệt đã trả hết".
 *
 * ⚠️ **KHÔNG cache.** Nội dung tin là per-membership; một bản cache theo `roomId` sẽ phục vụ chéo giữa
 * hai người có `visible_from_seq` khác nhau (memory `cache-breaks-two-source-flag-invariants`).
 *
 * ⚠️ **KHÔNG ghi `file_access_logs`/audit.** Đây là đường đọc TIN, không phải đường ký URL tệp — cùng
 * lý do `/messages` không ghi (xem `ChatAttachmentPresignService.decorate`). `listRoomFiles` ghi vì nó
 * KÉO CẢ KHO TỆP và cấp URL tải được.
 *
 * ⚠️ Oversight KHÔNG được miễn `assertMember` ở đây, và **không có** đường `/chat/oversight/…/links`
 * (API-13 §5.1d(4)): người có `('view','chat-oversight')` mà không thuộc phòng nhận **404** y hệt người
 * lạ. Đường đọc-vượt-membership là controller riêng, cặp quyền riêng, và nó cố ý KHÔNG có bề mặt này.
 */
@Injectable()
export class ChatLinksService {
  /**
   * Trần CÔNG: số TIN đọc tối đa cho một request.
   *
   * Bằng đúng trần `limit` (50) là trùng hợp về con số, không phải về ý nghĩa — đổi cái này không kéo
   * theo cái kia. Giữ ở đây (không ở contracts) vì nó là ngân sách THI CÔNG của server, client không
   * chọn được và cũng không cần biết; cái client thấy là cờ `truncated`.
   */
  private static readonly SCAN_CAP = 50;

  constructor(
    private readonly db: DatabaseService,
    private readonly access: ChatAccessService,
    private readonly messages: ChatMessagesRepository,
  ) {}

  async listRoomLinks(
    actor: ChatActor,
    roomId: string,
    query: ListChatRoomLinksQuery,
  ): Promise<ChatRoomLinksResponseDto> {
    // Giải mã TRƯỚC khi chạm DB: con trỏ hỏng là lỗi của request, không đáng một round-trip. Vân phòng
    // đối chiếu với `:id` của URL — con trỏ của phòng khác ⇒ 400, không phải một trang cắt sai lặng lẽ.
    const cursor = query.cursor ? decodeChatRoomLinksCursor(query.cursor, roomId) : null;

    const fetched = await this.db.withTenant(actor.companyId, async (tx) => {
      // `assertMember` TRƯỚC mọi thứ khác: 404 HẰNG, không phân biệt "phòng lạ" với "không phải thành
      // viên". `visibleFromSeq` lấy từ chính kết quả đó, KHÔNG tự bịa (`chat-visibility.ts`).
      const acc = await this.access.assertMember(tx, actor.companyId, roomId, actor.id);
      return this.messages.listRoomLinkCandidates(tx, actor.companyId, roomId, {
        // `linkIndex = -1` nghĩa là tin ở mốc đã tiêu thụ TRỌN ⇒ loại trừ nó; ngược lại phải đọc LẠI
        // tin đó để lấy phần liên kết còn dư (service bỏ qua phần đã trả).
        beforeSeqExclusive: cursor && cursor.linkIndex < 0 ? cursor.roomSeq : undefined,
        beforeSeqInclusive: cursor && cursor.linkIndex >= 0 ? cursor.roomSeq : undefined,
        // Lấy DƯ 1 hàng: nó là bằng chứng "còn tin phía sau", và KHÔNG được đưa vào phần trích.
        limit: ChatLinksService.SCAN_CAP + 1,
        visibleFromSeq: acc.membership.visibleFromSeq,
      });
    });

    const scanned = fetched.slice(0, ChatLinksService.SCAN_CAP);
    const hasMoreMessages = fetched.length > ChatLinksService.SCAN_CAP;

    const links = this.flatten(scanned, cursor);
    const page = links.slice(0, query.limit);

    // Còn liên kết CHƯA trả trong chính tập đã quét ⇒ dừng vì TRANG ĐẦY, không phải vì trần công.
    if (links.length > page.length) {
      const last = page[page.length - 1];
      return {
        data: page,
        nextCursor: encodeChatRoomLinksCursor(
          { roomSeq: last.roomSeq, linkIndex: last.linkIndex },
          roomId,
        ),
        truncated: false,
      };
    }

    // Đã tiêu hết phần trích được từ tập quét. Còn tin phía sau ⇒ chạm trần công: con trỏ trỏ vào TIN
    // cuối cùng đã quét với `linkIndex = -1` ("trọn tin này rồi"). Không có vế đó thì một phòng mở đầu
    // bằng 50 tin không-link làm client lật lại đúng 50 tin ấy mãi mãi.
    if (hasMoreMessages) {
      const lastScanned = scanned[scanned.length - 1];
      return {
        data: page,
        nextCursor: encodeChatRoomLinksCursor({ roomSeq: lastScanned.roomSeq, linkIndex: -1 }, roomId),
        truncated: true,
      };
    }

    // Quét tới đáy phòng: đây là "hết dữ liệu" THẬT — trang cuối, không mời lật tiếp.
    return { data: page, nextCursor: null, truncated: false };
  }

  /**
   * Tin (đã sắp `room_seq DESC`) → dòng liên kết, giữ nguyên thứ tự xuất hiện trong `body`.
   *
   * Con trỏ dừng GIỮA một tin (`linkIndex >= 0`) thì tin đó ĐƯỢC ĐỌC LẠI (vị từ SQL là `<=`) và phần
   * đã trả bị bỏ ở đây. Làm cách khác — nhớ "offset trong tin" ở SQL — là đưa một khái niệm offset vào
   * đúng chỗ API-13 §6.4 cấm, và nó trôi ngay khi có tin mới chèn vào giữa.
   */
  private flatten(
    rows: readonly ChatLinkCandidateRow[],
    cursor: ChatRoomLinksCursor | null,
  ): ChatRoomLinkDto[] {
    const out: ChatRoomLinkDto[] = [];
    for (const row of rows) {
      const skipUpTo =
        cursor !== null && cursor.linkIndex >= 0 && row.roomSeq === cursor.roomSeq
          ? cursor.linkIndex
          : -1;
      for (const link of extractChatLinks(row.body)) {
        if (link.linkIndex <= skipUpTo) continue;
        out.push({
          messageId: row.id,
          roomSeq: row.roomSeq,
          linkIndex: link.linkIndex,
          url: link.url,
          senderId: row.senderId,
          senderName: row.senderName,
          createdAt: row.createdAt.toISOString(),
        });
      }
    }
    return out;
  }
}
