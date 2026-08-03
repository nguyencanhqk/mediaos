import { Injectable } from "@nestjs/common";
import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { chatMessages, chatRoomMembers, chatRooms } from "../db/schema/communication";
import type { ChatRoomType } from "../db/schema/communication";
import { users } from "../db/schema/users";
import { ChatAccessService } from "./chat-access.service";
import type { ChatSearchCursor } from "./chat-search-cursor";

/** Một hàng kết quả tìm kiếm, TRƯỚC khi map sang DTO. */
export interface ChatSearchRow {
  id: string;
  roomId: string;
  roomName: string | null;
  roomType: ChatRoomType;
  roomSeq: number;
  senderId: string;
  senderName: string | null;
  body: string;
  createdAt: Date;
  /** `date_trunc('milliseconds', created_at)` — khoá sắp xếp VÀ nguồn dựng con trỏ. Xem `sortAtExpr`. */
  sortAt: Date;
  attachmentCount: number;
}

/**
 * Khoá sắp xếp của tìm kiếm.
 *
 * ⚠️ **`date_trunc('milliseconds', …)` KHÔNG phải làm đẹp.** `created_at` là `timestamptz` (micro-giây)
 * còn con trỏ chỉ mang tới mili-giây (giới hạn của JS `Date`). Sắp xếp theo cột THÔ mà so sánh bằng con
 * trỏ đã làm tròn sẽ **loại nhầm** các hàng cũ hơn nằm trong cùng mili-giây ⇒ trang sau sót tin, HTTP 200,
 * không lỗi. Cắt ở CẢ HAI vế (khoá sắp xếp và vế so sánh) làm phép so sánh toàn phần trở lại.
 * Đầy đủ: jsdoc `chat-search-cursor.ts`.
 */
function sortAtExpr(): SQL<Date> {
  return sql<Date>`date_trunc('milliseconds', ${chatMessages.createdAt})`;
}

/**
 * Cùng biểu thức, nhưng ÉP KIỂU TRẢ VỀ thành `Date`.
 *
 * ⚠️ Cần `.mapWith` vì cột dẫn xuất KHÔNG mang OID của `chat_messages.created_at`: drizzle/`node-postgres`
 * không suy được kiểu cho một biểu thức `sql` tự do, nên giá trị về tới JS có thể là **chuỗi**. Bản đầu
 * thiếu bước này và nổ `sortAt.toISOString is not a function` — **500 lúc chạy trong khi `tsc` hoàn toàn
 * mù**, vì `sql<Date>` chỉ là lời hứa kiểu ở phía TypeScript chứ không phải phép chuyển đổi lúc chạy.
 * Cùng lớp bẫy với `drizzle-array-bind-sql-param`: chú giải kiểu trên `sql` template không tự thành thật.
 */
function sortAtSelect(): SQL<Date> {
  return sortAtExpr().mapWith((v: unknown) => (v instanceof Date ? v : new Date(String(v))));
}

/**
 * S7-CHAT-BE-4 — CHAT-API-015. **Đường đọc RỘNG NHẤT của module.**
 *
 * ┌─ BẤT BIẾN CỦA FILE NÀY ────────────────────────────────────────────────────────────────────────┐
 * │ Mọi truy vấn ở đây bắt đầu bằng `this.access.messageReadConditions(companyId, actorUserId)` và  │
 * │ KHÔNG BAO GIỜ viết lại tay bất kỳ vế nào trong đó. Bộ 5 vế ấy là bản sao DUY NHẤT của luật       │
 * │ "được đọc tin nào" cho đường đa phòng — bản sao thứ hai là bản sao sẽ trôi                       │
 * │ (`module-closed-by-second-assert-not-scope`), và ở đây trôi nghĩa là rò nội dung toàn công ty.  │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ **KHÔNG có nhánh đọc-vượt.** SPEC-15 §3.3 + API-13 §5.3 ràng buộc 5 chốt: `/chat/search` giữ nguyên
 * vị từ membership cho MỌI role, kể cả Super Admin; không có `/chat/oversight/search`. Cặp
 * `('view','chat-oversight')` **không được** xuất hiện ở file này. Thêm vào là mở lại CHAT-DEC-004.
 *
 * ⚠️ **MỘT hàm cho CẢ HAI chế độ** (có/không `roomId`). Hai bộ dựng truy vấn là hai thứ sẽ trôi, và làm
 * ca census §13.4 nhập nhằng giữa dạng scalar và dạng cột.
 */
@Injectable()
export class ChatSearchRepository {
  constructor(private readonly access: ChatAccessService) {}

  /**
   * Một trang kết quả. Trả **`limit + 1`** hàng khi còn trang sau — caller cắt và dựng `nextCursor` từ
   * hàng thứ `limit`. Lấy dư một hàng là cách duy nhất biết "còn trang sau" mà không đếm toàn bộ.
   *
   * `q` LUÔN là tham số **bind** (`sql` template của drizzle) — tuyệt đối không `sql.raw`. Đây là đường
   * rộng nhất module; nối chuỗi ở đây là SQL injection trên chính nó.
   */
  async search(
    tx: TenantTx,
    companyId: string,
    actorUserId: string,
    opts: {
      q: string;
      roomId?: string;
      cursor?: ChatSearchCursor;
      limit: number;
    },
  ): Promise<ChatSearchRow[]> {
    const sortAt = sortAtExpr();

    const conds: SQL[] = [
      // BỘ 5 VẾ — membership + tin↔phòng + phòng sống + §13.4. KHÔNG viết lại tay.
      ...this.access.messageReadConditions(companyId, actorUserId),

      // Tin đã THU HỒI rơi khỏi kết quả (SPEC-15 §13.7 câu cuối). Vế này nằm TRONG truy vấn, không phải
      // việc của mapper: thu hồi KHÔNG xoá `body` (append-only) nên `search_vector` vẫn khớp. Mapper che
      // `body` thì nội dung không rò, nhưng SỐ LƯỢNG kết quả thì rò — gõ từng từ khoá và đếm hit là đọc
      // được nội dung tin đã thu hồi từng chữ một. Đó là oracle, cùng lớp với CHAT-ERR-001.
      isNull(chatMessages.recalledAt),

      // `websearch_to_tsquery`, KHÔNG `to_tsquery`: bản kia NÉM lỗi cú pháp trên input người dùng
      // (`&`, `|`, `!`, ngoặc lệch) ⇒ 500 từ một ô tìm kiếm. `websearch_` nuốt mọi thứ.
      // `f_unaccent` áp cho CẢ vế truy vấn — cột generated đã unaccent lúc INSERT; quên ở đây thì gõ CÓ
      // DẤU ra 0 kết quả, hỏng theo chiều khó phát hiện nhất.
      // `'simple'` chứ không `'english'`: tiếng Việt không có bộ stemming trong Postgres (§13.7).
      sql`${chatMessages.searchVector} @@ websearch_to_tsquery('simple', public.f_unaccent(${opts.q}))`,
    ];

    // Chế độ MỘT phòng: caller đã `assertMember` (để có đúng 404), đây chỉ là vế thu hẹp — KHÔNG phải
    // điểm khẳng định quyền, và không thay thế bất kỳ vế nào ở trên.
    if (opts.roomId) conds.push(eq(chatMessages.roomId, opts.roomId));

    if (opts.cursor) {
      // Keyset: hàng "cũ hơn" theo đúng thứ tự sắp xếp `(sortAt DESC, id DESC)`.
      conds.push(
        or(
          lt(sortAt, opts.cursor.sortAt),
          and(eq(sortAt, opts.cursor.sortAt), lt(chatMessages.id, opts.cursor.id)),
        ) as SQL,
      );
    }

    return (
      tx
        .select({
          id: chatMessages.id,
          roomId: chatMessages.roomId,
          roomName: chatRooms.name,
          roomType: sql<ChatRoomType>`${chatRooms.roomType}`,
          roomSeq: chatMessages.roomSeq,
          senderId: chatMessages.senderId,
          senderName: users.fullName,
          body: chatMessages.body,
          createdAt: chatMessages.createdAt,
          sortAt: sortAtSelect(),
          attachmentCount: chatMessages.attachmentCount,
        })
        .from(chatMessages)
        .innerJoin(chatRooms, eq(chatRooms.id, chatMessages.roomId))
        .innerJoin(chatRoomMembers, eq(chatRoomMembers.roomId, chatRooms.id))
        // `leftJoin` BÓ TENANT ở cả hai vế — sao đúng `chat-messages.repository.ts`. Người gửi đã bị xoá
        // vẫn phải trả được hàng (tên `null`), nên `leftJoin` chứ không `innerJoin`.
        .leftJoin(
          users,
          and(eq(users.id, chatMessages.senderId), eq(users.companyId, chatMessages.companyId)),
        )
        .where(and(...conds))
        .orderBy(desc(sortAt), desc(chatMessages.id))
        .limit(opts.limit + 1)
    );
  }
}
