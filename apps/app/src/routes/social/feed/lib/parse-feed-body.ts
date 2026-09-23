/**
 * S16-SOCIAL-FE-1 (plan D5) — tokenize nội dung bài/bình luận thành mảng token để React render.
 *
 * ┌─ 🔴 VÌ SAO TOKENIZE CHỨ KHÔNG SINH HTML ─────────────────────────────────────────────────────┐
 * │ BE lưu `body` là **plain text** (không HTML). Muốn biến URL/`#thẻ` thành link mà vẫn không mở  │
 * │ một cửa XSS cho toàn công ty thì chỉ có một đường: cắt chuỗi thành token rồi để React dựng      │
 * │ node. `dangerouslySetInnerHTML` + sanitizer là đường còn lại, và một lần cấu hình sai sanitizer │
 * │ là một lỗ XSS trên mọi dòng cuộn của mọi nhân viên. Hàm này THUẦN ⇒ test được không cần DOM.    │
 * │ **TUYỆT ĐỐI KHÔNG** thêm nhánh trả chuỗi HTML vào đây.                                         │
 * └───────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ 🔴 `@mention` KHÔNG THÀNH LINK — plan D5 nói sai, đo lại 23/09/2026 ─────────────────────────┐
 * │ Plan D5 viết «`@mention` thành link profile». **Hợp đồng không cho phép**: `feedPostSchema`     │
 * │ (`packages/contracts/src/social-api.ts:154-181`) trả `body`, `tags[]`, `author` — **KHÔNG có**  │
 * │ mảng mention nào. Mention đi theo chiều NGƯỢC LẠI: client gửi `mentionedUserIds[]` lên (suy từ  │
 * │ nháp, khuôn `collectMentionIds` của CHAT), server dùng nó để bắn thông báo, rồi KHÔNG trả lại.  │
 * │ Nghĩa là từ chuỗi `"@An Nguyễn"` trong `body`, FE **không có đường nào** ra `employeeId` —      │
 * │ ngoài việc tra theo TÊN, thứ vừa sai (trùng tên) vừa là một oracle dò danh bạ đúng bằng cái mà  │
 * │ SPEC-16 §12 `ERR-009` dựng ra để đóng.                                                          │
 * │ ⇒ Token `mention` được tô đậm như một **span**, KHÔNG phải `<a>`. Tiền lệ: `MessageBubble` của  │
 * │ CHAT cũng không render mention thành link. Nợ: BE trả `mentions[{userId,employeeId,label}]` thì │
 * │ mới nối được — ghi vào §8 của plan.                                                            │
 * └───────────────────────────────────────────────────────────────────────────────────────────────┘
 */

export type FeedBodyToken =
  | { kind: "text"; value: string }
  | { kind: "url"; value: string; href: string }
  /** `value` = nguyên văn trong bài (giữ hoa/thường); `tag` = dạng đã chuẩn hoá để lọc. */
  | { kind: "tag"; value: string; tag: string }
  | { kind: "mention"; value: string };

/**
 * Hashtag — **chép ĐÚNG regex của BE** (`apps/api/src/social/social-mentions.ts:36`).
 *
 * `\p{L}` + cờ `u` là bắt buộc, không phải cầu kỳ: `[a-zA-Z0-9_]` sẽ cắt `#tuyểndụng` thành `#tuy`,
 * và hashtag tiếng Việt có dấu là ca THƯỜNG. Lệch regex hai bên ⇒ FE gạch chân một thứ mà BE không
 * hề lưu thành thẻ (bấm vào lọc ra rỗng), hoặc ngược lại.
 */
const HASHTAG_RE = /(?<![\p{L}\p{N}_])#([\p{L}\p{N}_]+)/u;

/** `feed_tags.tag` là `varchar(64)` — dài hơn thì BE BỎ, nên FE cũng không được vẽ thành link. */
const TAG_MAX_LENGTH = 64;

/**
 * URL — chỉ `http`/`https`.
 *
 * ⚠️ Cố ý KHÔNG nhận `javascript:`, `data:`, `vbscript:` hay đường không có lược đồ (`www.x.com`).
 * Đây là lưới thứ hai sau React: kể cả khi ai đó sau này đưa `href` vào một API nguy hiểm hơn
 * `<a href>`, chuỗi đi qua đây đã không bao giờ là một lược đồ thực thi được.
 */
const URL_RE = /https?:\/\/[^\s<>"')\]]+/i;

/** Dấu câu dính đuôi URL khi người ta viết `(xem https://a.b/c).` — cắt ra khỏi href. */
const TRAILING_PUNCT_RE = /[.,;:!?]+$/;

/**
 * Mention — `@` + một chuỗi liền không có khoảng trắng.
 *
 * ⚠️ HẠN CHẾ ĐÃ BIẾT, ghi ra để không ai tưởng là lỗi: nhãn mention do `mentionLabel()` sinh ra là
 * `@<Họ Tên>` **CÓ DẤU CÁCH** (khuôn CHAT), nên với tên nhiều chữ, token này chỉ tô đậm chữ ĐẦU
 * (`@An` trong `@An Nguyễn`). Không thể làm tốt hơn nếu chỉ có chuỗi trong tay: không có ranh giới
 * nào phân biệt "phần còn lại của tên" với "từ kế tiếp của câu". Vế đúng cần BE trả danh sách
 * mention kèm offset — xem docblock đầu file. Tô đậm một nửa vẫn tốt hơn không tô gì, và nó **không
 * phải link** nên đoán sai cũng không dẫn ai đi đâu sai.
 */
const MENTION_RE = /(?<![\p{L}\p{N}_])@([\p{L}\p{N}_.-]+)/u;

interface Match {
  index: number;
  length: number;
  token: FeedBodyToken;
}

function firstUrl(input: string): Match | null {
  const m = URL_RE.exec(input);
  if (!m) return null;
  const raw = m[0];
  const trimmed = raw.replace(TRAILING_PUNCT_RE, "");
  // Chỉ còn `https://` sau khi cắt dấu câu ⇒ không phải link, để nguyên thành text.
  if (!/^https?:\/\/\S+/i.test(trimmed)) return null;
  return {
    index: m.index,
    length: trimmed.length,
    token: { kind: "url", value: trimmed, href: trimmed },
  };
}

function firstTag(input: string): Match | null {
  const m = HASHTAG_RE.exec(input);
  if (!m) return null;
  const word = m[1];
  // Thẻ quá dài: BE không lưu nó thành thẻ ⇒ vẽ link ở đây là hứa một bộ lọc không tồn tại.
  if (word.length > TAG_MAX_LENGTH) return null;
  return {
    index: m.index,
    length: m[0].length,
    token: { kind: "tag", value: m[0], tag: word.toLowerCase() },
  };
}

function firstMention(input: string): Match | null {
  const m = MENTION_RE.exec(input);
  if (!m) return null;
  return { index: m.index, length: m[0].length, token: { kind: "mention", value: m[0] } };
}

/**
 * Cắt `body` thành token theo thứ tự xuất hiện.
 *
 * `null`/rỗng ⇒ mảng RỖNG (không phải `[{kind:"text", value:""}]`): `body` được phép NULL với bài
 * `poll`/`kudos` (`chk_feed_posts_body_required`), và component gọi hàm này phải phân biệt được
 * "không có nội dung" với "nội dung là chuỗi rỗng" để KHÔNG vẽ một khối trống.
 */
export function parseFeedBody(body: string | null | undefined): FeedBodyToken[] {
  if (!body) return [];

  const out: FeedBodyToken[] = [];
  let rest = body;

  while (rest.length > 0) {
    // Tìm CẢ BA rồi lấy cái đứng TRƯỚC NHẤT. Chạy tuần tự từng loại trên cả chuỗi sẽ cho thứ tự
    // token sai khi một bài có `#thẻ` đứng trước một URL.
    const candidates = [firstUrl(rest), firstTag(rest), firstMention(rest)].filter(
      (c): c is Match => c !== null,
    );

    if (candidates.length === 0) {
      out.push({ kind: "text", value: rest });
      break;
    }

    const next = candidates.reduce((a, b) => (b.index < a.index ? b : a));
    if (next.index > 0) out.push({ kind: "text", value: rest.slice(0, next.index) });
    out.push(next.token);
    rest = rest.slice(next.index + next.length);
  }

  return out;
}
