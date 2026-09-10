/**
 * S17-CHAT-UX2-BE-2 — trích liên kết từ `chat_messages.body` cho `CHAT-API-031`. Hàm THUẦN, 0 I/O.
 *
 * ┌─ LUẬT NÀY CÓ HAI NGƯỜI ĐỌC, VÀ CHÚNG PHẢI NÓI CÙNG MỘT CHUYỆN ────────────────────────────────┐
 * │ • BE (file này) — quyết định dòng nào xuất hiện ở bảng «Liên kết» của phòng;                    │
 * │ • FE (`apps/app/src/components/chat/chat-format.ts` → `splitTextWithLinks`) — quyết định đoạn   │
 * │   nào trong bong bóng tin được vẽ thành thẻ `<a>`.                                              │
 * │                                                                                                 │
 * │ Lệch nhau thì bảng liệt kê một địa chỉ mà chính tin chứa nó lại hiện dạng chữ (hoặc ngược lại)  │
 * │ — và KHÔNG test nào đỏ, vì mỗi đường đi qua một literal riêng. Đó là lý do `chat-link-extract   │
 * │ .spec.ts` có ca ĐỌC FILE FE và so literal: đổi luật ở một bên là ĐỎ ngay, không trôi âm thầm.   │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ **CHỈ `http`/`https`.** `javascript:`, `data:`, `file:`, `ftp:` ở lại dạng CHỮ ở cả hai đầu. Neo
 * `https?://` không phải để lọc "đẹp": một bảng liên kết bấm-được chứa `javascript:` là một đường XSS
 * qua đúng chỗ người dùng tin tưởng nhất.
 *
 * ⚠️ Trích Ở JS trên trang tin đã đọc, KHÔNG bằng `regexp_matches` trong SQL — CÓ CHỦ ĐÍCH. Cú pháp
 * regex của Postgres (POSIX ARE) không trùng với `RegExp` của JS ở chính những chỗ luật này dùng
 * (`[^\s<>"']`, cách xử lý ký tự Unicode), nên "cùng một biểu thức" ở hai máy sẽ ra hai kết quả khác
 * nhau trên đúng những chuỗi biên — tức dựng lại đúng cái lệch mà file này tồn tại để chặn.
 */

/**
 * Biểu thức nhận diện — **PHẢI trùng nguyên văn** `splitTextWithLinks`.
 *
 * Giữ ở dạng chuỗi `source` (không phải literal `RegExp`) vì ca đối chiếu FE so bằng chuỗi, và vì cờ
 * `g` mang `lastIndex` có trạng thái: một `RegExp` dùng chung ở cấp module sẽ nhớ vị trí giữa hai lần
 * gọi và bỏ sót link ở lần gọi thứ hai. `extractChatLinks` dựng bản mới mỗi lần chạy.
 */
export const CHAT_LINK_PATTERN_SOURCE = "https?:\\/\\/[^\\s<>\"']+";

/**
 * Dấu câu bị GỌT khỏi đuôi URL — cũng phải trùng nguyên văn FE.
 *
 * "…xem tại https://a.vn/b." thì dấu chấm là của CÂU, không của địa chỉ. Không gọt thì bảng liên kết
 * hiện một URL 404.
 */
export const CHAT_LINK_TRAILING_CHARS = ".,;:!?)]}";

/** Một liên kết + vị trí của nó trong tin (0-based) — `linkIndex` là vế tie-break của con trỏ keyset. */
export interface ExtractedChatLink {
  url: string;
  linkIndex: number;
}

/**
 * Trích theo thứ tự XUẤT HIỆN trong `body`.
 *
 * KHÔNG khử trùng lặp: cùng một địa chỉ dán hai lần trong một tin là hai dòng (API-13 §5.1d bảng —
 * "không dedupe URL ở server"). Khử ở đây làm `linkIndex` không còn đếm được từ `body`, tức con trỏ
 * keyset mất khả năng nối lại giữa hai trang.
 */
export function extractChatLinks(body: string): ExtractedChatLink[] {
  if (body.length === 0) return [];

  const pattern = new RegExp(CHAT_LINK_PATTERN_SOURCE, "g");
  const out: ExtractedChatLink[] = [];
  for (const match of body.matchAll(pattern)) {
    let url = match[0];
    while (url.length > 0 && CHAT_LINK_TRAILING_CHARS.includes(url[url.length - 1])) {
      url = url.slice(0, -1);
    }
    // Vế phòng thủ NGANG BẰNG FE (`if (url.length > 0)` trong `splitTextWithLinks`). Với luật hiện tại
    // nó KHÔNG BAO GIỜ chạy — `:` và `/` không nằm trong tập gọt nên mọi kết quả khớp luôn giữ được
    // phần `https://` (đo ở `chat-link-extract.spec.ts`, ca `https://).`). Giữ nó vì PARITY là hợp
    // đồng của file này: nếu ai đó nới biểu thức và một chuỗi rỗng trở nên khả dĩ, hai bên phải hỏng
    // GIỐNG NHAU, không phải một bên đẩy `url: ""` vào DTO và làm lệch `linkIndex` của những link sau.
    if (url.length === 0) continue;
    out.push({ url, linkIndex: out.length });
  }
  return out;
}
