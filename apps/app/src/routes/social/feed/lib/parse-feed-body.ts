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
 * ┌─ 🔴 `@mention` THÀNH LINK CHỈ KHI SERVER NÓI (S16-SOCIAL-MENTIONLINK-1 — plan FE-2D §4 B1) ────┐
 * │ Từ BE-1D, DTO bài/bình luận mang `mentions?: FeedMentionDto[]` — `{withheld:false, employeeId,  │
 * │ label}` (người được nhắc VẪN trong audience lúc đọc) hoặc `{withheld:true}` (đã rút, KHÔNG nhãn) │
 * │ (`packages/contracts/src/social-api.ts` `feedMentionSchema`). Luật:                             │
 * │  · CHỈ phần tử `withheld:false` làm được link; đích = `employeeId` của SERVER. Phần tử rút giữ  │
 * │    span — FE KHÔNG tra theo tên (trùng tên + mở lại oracle dò danh bạ SPEC-16 §12 `ERR-009`).   │
 * │  · Hai phần tử cùng nhãn (NFC) mà KHÁC người ⇒ mơ hồ ⇒ span (không đoán ai) — và nhãn mơ hồ     │
 * │    CHẶN nhãn ngắn hơn ở cùng vị trí (không link nửa tên sang người thứ ba).                     │
 * │  · `label` = `users.full_name` lúc ĐỌC, thứ tự KHÔNG theo vị trí trong body; TK đổi tên ⇒ nhãn  │
 * │    không còn khớp chữ trong body ⇒ rơi về span (an toàn: mất link, không link nhầm).            │
 * │  · Chữ hiển thị là chữ NGUYÊN VĂN trong body — không chuẩn hoá chuỗi hiển thị. Chỉ PHÉP SO nhãn │
 * │    đi qua NFC (thẻ BE KHÔNG chuẩn hoá ⇒ NFC cả luồng token sẽ làm hỏng link `#thẻ` NFD).        │
 * │ `mentions` vắng (response 006 · payload WS · API cũ) / rỗng ⇒ đường code Y HỆT trước đây.       │
 * └───────────────────────────────────────────────────────────────────────────────────────────────┘
 */
import type { FeedMentionDto } from "@mediaos/contracts";

export type FeedBodyToken =
  | { kind: "text"; value: string }
  | { kind: "url"; value: string; href: string }
  /** `value` = nguyên văn trong bài (giữ hoa/thường); `tag` = dạng đã chuẩn hoá để lọc. */
  | { kind: "tag"; value: string; tag: string }
  | { kind: "mention"; value: string }
  /** `value` = chữ NGUYÊN VĂN trong body (kể cả NFD); `employeeId` = của SERVER (`withheld:false`). */
  | { kind: "mentionLink"; value: string; employeeId: string };

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
 * Mention SPAN (không có `mentions` khớp) — `@` + một chuỗi liền không có khoảng trắng.
 *
 * ⚠️ HẠN CHẾ ĐÃ BIẾT, ghi ra để không ai tưởng là lỗi: tên nhiều chữ chỉ được tô đậm chữ ĐẦU
 * (`@An` trong `@An Nguyễn`) — không có ranh giới nào phân biệt "phần còn lại của tên" với "từ kế
 * tiếp của câu" khi chỉ có chuỗi trong tay. Tên TRỌN chỉ có được qua `mentions` của server (token
 * `mentionLink`, xem `createMentionLinkFinder`). Nhánh span cũng còn hai lỗi CÓ SẴN, cố ý KHÔNG sửa ở
 * đây để đường «không mentions» giữ y hệt bản cũ (plan FE-2D §7): thân NFD bị cắt giữa chữ, và
 * lookbehind chạy trên phần CÒN LẠI nên mất ngữ cảnh trái (`#tag@An` ⇒ span `@An`). Span không phải
 * link nên đoán sai cũng không dẫn ai đi đâu sai.
 */
const MENTION_RE = /(?<![\p{L}\p{N}_])@([\p{L}\p{N}_.-]+)/u;

/**
 * Ký tự «chữ» cho HAI biên của mention link. CÓ `\p{M}` (dấu kết hợp đứng rời) — đo M26: thân gõ kiểu
 * «Unicode tổ hợp» TRỘN (`…Văn A` + U+0309 rời = `Văn Ả`) cho `indexOf("Nguyễn Văn A") === 0`; thiếu
 * `\p{M}` thì dấu rời lọt biên phải ⇒ nhãn `Nguyễn Văn A` thành link trên chữ hiển thị `@Nguyễn Văn Ả`
 * — NGƯỜI KHÁC.
 */
const WORD_CHAR_RE = /[\p{L}\p{M}\p{N}_]/u;

/** Dấu kết hợp — để đếm «ký tự gốc» khi lọc trước phép so NFC (xem `baseCountPrefix`). */
const MARK_RE = /\p{M}/u;

/**
 * Một chữ Việt dựng sẵn tách NFD thành tối đa 3 code point (gốc + dấu mũ/móc + dấu thanh) ⇒ chuỗi con
 * khớp một nhãn dài tối đa 3 lần nhãn (dạng NFC).
 */
const MAX_DECOMPOSITION_FACTOR = 3;

interface Match {
  index: number;
  length: number;
  token: FeedBodyToken;
}

interface MentionLabel {
  /** Nhãn của server, ĐÃ NFC. */
  label: string;
  /** `null` = MƠ HỒ (hai người cùng nhãn) — không link, nhưng CHẶN nhãn ngắn hơn ở cùng vị trí. */
  employeeId: string | null;
  /** Số code point KHÔNG phải dấu trong NFD của nhãn — xem `baseCountPrefix`. */
  baseCount: number;
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

/** Số code point KHÔNG phải dấu (`\p{M}`) trong NFD của `s`. */
function countBase(s: string): number {
  let n = 0;
  for (const cp of s.normalize("NFD")) if (!MARK_RE.test(cp)) n += 1;
  return n;
}

/**
 * `prefix[k]` = `countBase(body.slice(0, k))` tính theo từng code point (ô giữa một cặp surrogate
 * mang giá trị của ô trước nó).
 *
 * Vì sao cần: hai chuỗi tương đương chính tắc có NFD giống hệt nhau ⇒ cùng số ký tự gốc. Đây là điều
 * kiện CẦN của phép so `slice.normalize("NFC") === nhãn`, kiểm O(1) cho mỗi `j` ⇒ phép so NFC (O(|nhãn|))
 * chỉ chạy ở vài vị trí. Không có nó, một thân 4000 ký tự toàn `@…` + 50 nhãn cùng chữ đầu đủ làm treo
 * trình duyệt của MỌI người cuộn qua bài đó. Bộ lọc chỉ BỎ vị trí không thể khớp — không đổi kết quả.
 */
function baseCountPrefix(body: string): Int32Array {
  const prefix = new Int32Array(body.length + 1);
  let k = 0;
  while (k < body.length) {
    const cp = body.codePointAt(k) as number;
    const width = cp > 0xffff ? 2 : 1;
    const next = prefix[k] + countBase(String.fromCodePoint(cp));
    if (width === 2) prefix[k + 1] = prefix[k];
    prefix[k + width] = next;
    k += width;
  }
  return prefix;
}

/** Code point BẮT ĐẦU tại `j` có phải ký tự chữ không (`j` ngoài chuỗi ⇒ không). */
function isWordCharAt(body: string, j: number): boolean {
  const cp = body.codePointAt(j);
  return cp !== undefined && WORD_CHAR_RE.test(String.fromCodePoint(cp));
}

/** Code point KẾT THÚC ngay trước `i` có phải ký tự chữ không (gộp cặp surrogate). */
function isWordCharBefore(body: string, i: number): boolean {
  if (i <= 0) return false;
  const last = Array.from(body.slice(Math.max(0, i - 2), i)).pop();
  return last !== undefined && WORD_CHAR_RE.test(last);
}

/**
 * Bảng nhãn dùng được: CHỈ phần tử `withheld:false` (đọc qua narrowing — nhánh rút không có `label`
 * trong hợp đồng, và một phần tử rút bị nhét lậu nhãn cũng KHÔNG được đọc). Sắp nhãn DÀI trước: cùng
 * vị trí thì `@An Nguyễn` thắng `@An`.
 *
 * Nhãn NFC trùng mà khác `employeeId` ⇒ MƠ HỒ (`employeeId: null`): KHÔNG link, nhưng VẪN ở trong bảng
 * làm CHẶN. Loại hẳn nó (bản đầu) thì ở `@Nguyễn Văn An Bình` — tên TRỌN của một trong hai người trùng
 * tên — nhãn ngắn `Nguyễn Văn An` của người THỨ BA khớp nửa tên và link sang người đó (FULL gate lượt 1,
 * probe R-B2; ca P3b). Phần tử RÚT không có nhãn nên không chặn được theo cách này — giới hạn đã ghi ở
 * plan FE-2D §9 R6.
 */
function buildMentionLabels(mentions: readonly FeedMentionDto[] | undefined): MentionLabel[] {
  if (!mentions || mentions.length === 0) return [];

  /** `null` = mơ hồ (hai người cùng nhãn). */
  const byLabel = new Map<string, string | null>();
  for (const m of mentions) {
    if (m.withheld) continue;
    const label = m.label.normalize("NFC");
    if (label.length === 0) continue;
    const seen = byLabel.get(label);
    if (seen === undefined) byLabel.set(label, m.employeeId);
    else if (seen !== m.employeeId) byLabel.set(label, null);
  }

  const out: MentionLabel[] = [];
  for (const [label, employeeId] of byLabel) {
    out.push({ label, employeeId, baseCount: countBase(label) });
  }
  return out.sort((a, b) => b.label.length - a.label.length);
}

/**
 * Bộ dò `mentionLink` trên CHUỖI GỐC với offset TUYỆT ĐỐI.
 *
 * Trả hàm `(from) ⇒ match đầu tiên có offset ≥ from`. Biên TRÁI đọc `body[i-1]` — KHÔNG đọc phần còn
 * lại sau token trước (đo M27: `#tag@An` thì `tag@An` mới là ngữ cảnh thật, `@An` không có biên trái).
 *
 * CON TRỎ (FULL gate lượt 1, ca P8): `from` chỉ TĂNG (`base` của `parseFeedBody`). Lượt dò trước đã
 * chứng minh KHÔNG có link nào trong `[scannedFrom, hit.index)` ⇒ mọi `from` trong `[scannedFrom,
 * hit.index]` có cùng đáp án — trả lại `hit`, không dò lại. Chỉ dò tiếp khi `from` đã VƯỢT `hit` (token
 * khác nuốt mất nó) ⇒ mỗi vị trí `@` được đi qua MỘT lần cho cả bài. Bản đầu dò lại MỌI `@` còn lại sau
 * MỖI token: `@A@A…` 4000 ký tự + 50 nhãn ≈ 60 ms/lượt parse, lặp lại ở mỗi lần refetch.
 */
function createMentionLinkFinder(
  body: string,
  labels: readonly MentionLabel[],
): (from: number) => Match | null {
  const bases = baseCountPrefix(body);

  /**
   * Nhãn khớp TRỌN ngay sau `@` ở vị trí `i` (biên phải + so NFC), dài trước. Nhãn khớp ĐẦU TIÊN quyết
   * vị trí: mơ hồ ⇒ `null` và KHÔNG thử nhãn ngắn hơn (ca P3b — xem `buildMentionLabels`).
   */
  const labelMatchAt = (i: number): Match | null => {
    const start = i + 1;
    for (const { label, employeeId, baseCount } of labels) {
      const last = Math.min(body.length, start + MAX_DECOMPOSITION_FACTOR * label.length);
      for (let j = start + label.length; j <= last; j++) {
        if (bases[j] - bases[start] !== baseCount) continue; // điều kiện CẦN, O(1)
        if (isWordCharAt(body, j)) continue; // biên PHẢI — `\p{M}` chặn cắt giữa chuỗi kết hợp
        if (body.slice(start, j).normalize("NFC") !== label) continue;
        if (employeeId === null) return null; // CHẶN: tên trọn ở đây là của một người trùng tên
        return {
          index: i,
          length: j - i,
          token: { kind: "mentionLink", value: body.slice(i, j), employeeId },
        };
      }
    }
    return null;
  };

  let scannedFrom: number | null = null;
  let hit: Match | null = null;

  return (from) => {
    if (scannedFrom !== null && from >= scannedFrom && (hit === null || hit.index >= from)) {
      return hit;
    }
    scannedFrom = from;
    hit = null;
    for (let i = body.indexOf("@", from); i !== -1; i = body.indexOf("@", i + 1)) {
      if (isWordCharBefore(body, i)) continue; // biên TRÁI trên chuỗi GỐC
      hit = labelMatchAt(i);
      if (hit) break;
    }
    return hit;
  };
}

/**
 * Cắt `body` thành token theo thứ tự xuất hiện.
 *
 * `null`/rỗng ⇒ mảng RỖNG (không phải `[{kind:"text", value:""}]`): `body` được phép NULL với bài
 * `poll`/`kudos` (`chk_feed_posts_body_required`), và component gọi hàm này phải phân biệt được
 * "không có nội dung" với "nội dung là chuỗi rỗng" để KHÔNG vẽ một khối trống.
 *
 * `mentions` — mảng của DTO (BE-1D); xem hộp đầu file. Vắng/rỗng/chỉ phần tử rút ⇒ token y hệt bản cũ.
 */
export function parseFeedBody(
  body: string | null | undefined,
  mentions?: readonly FeedMentionDto[],
): FeedBodyToken[] {
  if (!body) return [];

  const labels = buildMentionLabels(mentions);
  const findMentionLink = labels.length > 0 ? createMentionLinkFinder(body, labels) : null;

  const out: FeedBodyToken[] = [];
  /** Offset của phần CÒN LẠI trong `body` — mọi `Match` dưới đây đều theo offset tuyệt đối. */
  let base = 0;

  while (base < body.length) {
    const rest = body.slice(base);
    // Tìm CẢ BỐN rồi lấy cái đứng TRƯỚC NHẤT. Chạy tuần tự từng loại trên cả chuỗi sẽ cho thứ tự
    // token sai khi một bài có `#thẻ` đứng trước một URL.
    const candidates: Match[] = [firstUrl(rest), firstTag(rest), firstMention(rest)]
      .filter((c): c is Match => c !== null)
      .map((c) => ({ ...c, index: c.index + base }));
    const link = findMentionLink?.(base) ?? null;
    if (link) candidates.push(link);

    if (candidates.length === 0) {
      out.push({ kind: "text", value: rest });
      break;
    }

    // Cùng vị trí ⇒ `mentionLink` (tên TRỌN của server) thắng span một chữ của `MENTION_RE`.
    const next = candidates.reduce((a, b) =>
      b.index < a.index || (b.index === a.index && b.token.kind === "mentionLink") ? b : a,
    );
    if (next.index > base) out.push({ kind: "text", value: body.slice(base, next.index) });
    out.push(next.token);
    base = next.index + next.length;
  }

  return out;
}
