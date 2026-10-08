/**
 * S16-SOCIAL-FILEDISPOSITION-1 — tên tệp server phát ra khi tải về + giá trị `Content-Disposition: attachment`
 * (hàm THUẦN, TOÀN PHẦN).
 *
 * MỘT tên chuẩn ({@link servedFileName}) là nguồn của cả hai dạng trong header:
 *   - `filename*=UTF-8''…` — RFC 5987, percent-encode UTF-8 của đúng tên chuẩn; mã hoá THÊM `' ( ) * !` vì
 *     parser phía FE (`packages/web-core/src/lib/api-client.ts` — `parseContentDispositionFilename`) dừng
 *     nhóm bắt ở `'`;
 *   - `filename="…"` — dự phòng ASCII cho client cũ, dựng TỪ tên chuẩn: thân bỏ dấu tiếng Việt, đuôi KHÔNG
 *     chuyển tự.
 * Lúc đăng ký, phần mở rộng được kiểm trên chính hai dạng này ({@link servedFileNameExtensions}) ⇒ đuôi
 * phát ra khi tải về luôn là đuôi đã kiểm. Vì vậy phép làm sạch chỉ THAY ký tự, không xoá và không gộp: ký
 * tự bị loại · cụm dấu chấm / khoảng trắng cuối tên · chỗ cắt độ dài đều để lại `_`, không bao giờ để hai
 * phần của tên liền lại thành một đuôi khác.
 * Giá trị header LUÔN là ASCII in được (0x20–0x7E), không CR/LF. Không hàm nào ở đây ném.
 */

/** Tên dùng khi tên gốc rỗng hoặc không dựng được. */
const FALLBACK_FILE_NAME = "download";

/** Ký tự thế chỗ cho mọi thứ bị loại khỏi tên. */
const REPLACEMENT = "_";

/** Trần độ dài tên (byte UTF-8) — giữ URL đã ký ở mức vài trăm ký tự. */
const MAX_NAME_UTF8_BYTES = 180;

/** Đuôi tệp dài hơn mức này (kể cả dấu chấm) không được giữ nguyên khi cắt. */
const MAX_EXTENSION_CHARS = 12;

/** Độ dài tối đa (điểm mã) của đuôi trả cho bên gọi để LƯU — khớp cột `files.file_extension`. */
const MAX_STORED_EXTENSION_CHARS = 50;

type CodePointRange = readonly [from: number, to: number];

/** Các khoảng điểm mã bị THAY bằng `_`: [đầu, cuối] (đóng hai đầu). */
const REPLACED_CODE_POINT_RANGES: ReadonlyArray<CodePointRange> = [
  [0x0000, 0x001f], // C0
  [0x007f, 0x009f], // DEL + C1
  [0x2028, 0x2029], // ngắt dòng / ngắt đoạn Unicode
  [0x200e, 0x200f], // dấu chiều chữ
  [0x202a, 0x202e], // nhúng / ghi đè chiều chữ
  [0x2066, 0x2069], // cô lập chiều chữ
  [0xd800, 0xdfff], // surrogate LẺ (cặp hợp lệ là MỘT điểm mã ≥ 0x10000 nên không rơi vào đây)
  [0xfffd, 0xfffd], // ký tự thay thế — dạng của surrogate lẻ sau khi tên đi qua UTF-8 (lưu rồi đọc lại)
];

/** Dấu kết hợp Latin — bỏ khỏi THÂN tên ở dạng dự phòng ASCII sau khi tách dấu (NFD). */
const COMBINING_MARK_RANGE: CodePointRange = [0x0300, 0x036f];

const NON_PRINTABLE_ASCII = /[^\x20-\x7e]/g;

/** Ký tự làm hỏng `filename="…"` hoặc bị client đọc thành dấu phân tách / thoát. */
const QUOTED_VALUE_UNSAFE = /["\\;%*/]/g;

const WHITESPACE = /\s/;

function inRange(codePoint: number, [from, to]: CodePointRange): boolean {
  return codePoint >= from && codePoint <= to;
}

function isReplacedCharacter(char: string): boolean {
  if (char === "\\" || char === "/") return true;
  const codePoint = char.codePointAt(0) ?? 0;
  return REPLACED_CODE_POINT_RANGES.some((range) => inRange(codePoint, range));
}

/** Duyệt theo ĐIỂM MÃ: mỗi ký tự bị loại thành đúng một `_` tại chỗ. */
function replaceUnsafeCharacters(name: string): string {
  return Array.from(name, (char) => (isReplacedCharacter(char) ? REPLACEMENT : char)).join("");
}

/** Độ dài của tên sau khi bỏ cụm dấu chấm / khoảng trắng ở cuối (quét lùi, tuyến tính). */
function lengthWithoutTrailingDots(name: string): number {
  let end = name.length;
  while (end > 0 && (name.charAt(end - 1) === "." || WHITESPACE.test(name.charAt(end - 1)))) {
    end -= 1;
  }
  return end;
}

/** Cụm dấu chấm / khoảng trắng ở cuối tên thành MỘT `_` (client bỏ cụm này khi lưu ⇒ đuôi sẽ đổi). */
function sealTrailingDots(name: string): string {
  const end = lengthWithoutTrailingDots(name);
  return end === name.length ? name : name.slice(0, end) + REPLACEMENT;
}

/** Đuôi như hệ điều hành thấy: bỏ cụm dấu chấm / khoảng trắng cuối, lấy phần sau dấu chấm CUỐI, chữ thường. */
function effectiveExtension(name: string): string | null {
  const base = name.slice(0, lengthWithoutTrailingDots(name));
  const dot = base.lastIndexOf(".");
  return dot < 0 ? null : base.slice(dot + 1).toLowerCase();
}

/** Cắt theo byte UTF-8, theo từng điểm mã — không bao giờ cắt đôi một ký tự. */
function truncateUtf8(value: string, maxBytes: number): string {
  const kept: string[] = [];
  let usedBytes = 0;
  for (const char of value) {
    const charBytes = Buffer.byteLength(char, "utf8");
    if (usedBytes + charBytes > maxBytes) break;
    kept.push(char);
    usedBytes += charBytes;
  }
  return kept.join("");
}

function replaceLastCharacter(name: string): string {
  return Array.from(name).slice(0, -1).join("") + REPLACEMENT;
}

/**
 * Đưa tên về trần byte. Đuôi ngắn được giữ NGUYÊN (chỉ thân bị cắt). Không giữ được đuôi thì cắt thẳng, và
 * nếu chỗ cắt để lại một đuôi KHÁC đuôi ban đầu thì ký tự cuối thành `_` — phép cắt không sinh đuôi mới.
 */
function truncateKeepingExtension(name: string): string {
  if (Buffer.byteLength(name, "utf8") <= MAX_NAME_UTF8_BYTES) return name;
  const dot = name.lastIndexOf(".");
  if (dot > 0 && name.length - dot <= MAX_EXTENSION_CHARS) {
    const extension = name.slice(dot);
    const stemBudget = MAX_NAME_UTF8_BYTES - Buffer.byteLength(extension, "utf8");
    return truncateUtf8(name.slice(0, dot), stemBudget) + extension;
  }
  const cut = sealTrailingDots(truncateUtf8(name, MAX_NAME_UTF8_BYTES));
  return effectiveExtension(cut) === effectiveExtension(name) ? cut : replaceLastCharacter(cut);
}

/**
 * Tên chuẩn của một tệp khi tải về — đúng chuỗi Unicode được mã hoá vào `filename*`.
 * NFC → ký tự bị loại thành `_` → bỏ khoảng trắng hai đầu → cụm dấu chấm / khoảng trắng cuối thành `_` →
 * cắt về trần byte. Áp lần hai không đổi gì. Không phải chuỗi · rỗng · chỉ gồm dấu chấm ⇒ tên dự phòng.
 */
export function servedFileName(rawName: unknown): string {
  if (typeof rawName !== "string") return FALLBACK_FILE_NAME;
  const cleaned = replaceUnsafeCharacters(rawName.normalize("NFC")).trim();
  if (lengthWithoutTrailingDots(cleaned) === 0) return FALLBACK_FILE_NAME;
  return truncateKeepingExtension(sealTrailingDots(cleaned));
}

/**
 * Phần mở rộng của một tên như hệ điều hành thấy khi lưu: tự bỏ cụm dấu chấm / khoảng trắng cuối, lấy phần
 * sau dấu chấm CUỐI, chữ thường, tối đa 50 ký tự. Không có dấu chấm ⇒ `null`; tên dạng «.xyz» CÓ đuôi `xyz`.
 */
export function fileNameExtension(name: string): string | null {
  const extension = effectiveExtension(name);
  if (extension === null) return null;
  return Array.from(extension).slice(0, MAX_STORED_EXTENSION_CHARS).join("");
}

function stripCombiningMarks(text: string): string {
  return Array.from(text)
    .filter((char) => !inRange(char.codePointAt(0) ?? 0, COMBINING_MARK_RANGE))
    .join("");
}

/**
 * Dạng dự phòng ASCII của tên chuẩn, cho `filename="…"`. Tách thân / đuôi ở dấu chấm cuối:
 *   - THÂN: `đ` → `d`, tách dấu bằng NFD (KHÔNG dùng dạng tương thích — nó biến ký tự toàn chiều rộng thành
 *     `.` `/` và chữ ASCII), bỏ dấu kết hợp, phần còn lại ngoài ASCII in được thành `_`;
 *   - ĐUÔI: không chuyển tự, không bỏ dấu — ký tự ngoài ASCII in được thành `_`.
 */
function toAsciiFileName(name: string): string {
  const dot = name.lastIndexOf(".");
  const stem = dot < 0 ? name : name.slice(0, dot);
  const extension = dot < 0 ? "" : name.slice(dot);
  const transliterated = stem.replace(/đ/g, "d").replace(/Đ/g, "D").normalize("NFD");
  const asciiStem = stripCombiningMarks(transliterated).replace(NON_PRINTABLE_ASCII, REPLACEMENT);
  const asciiExtension = extension.replace(NON_PRINTABLE_ASCII, REPLACEMENT);
  const ascii = `${asciiStem}${asciiExtension}`.replace(QUOTED_VALUE_UNSAFE, REPLACEMENT);
  return ascii === "" ? FALLBACK_FILE_NAME : ascii;
}

/**
 * Phần mở rộng (chữ thường, không trùng, không cắt độ dài) của HAI dạng tên server phát ra cho `rawName` —
 * dạng Unicode của `filename*` và dạng ASCII của `filename=`. Đây là thứ lúc đăng ký phải đem so với các
 * tập chặn: một đuôi không nằm trong mảng này thì không dạng nào của header mang nó. Mảng rỗng = không đuôi.
 */
export function servedFileNameExtensions(rawName: unknown): readonly string[] {
  const name = servedFileName(rawName);
  const extensions = [effectiveExtension(name), effectiveExtension(toAsciiFileName(name))];
  return [...new Set(extensions.filter((extension): extension is string => extension !== null))];
}

/** RFC 5987 `ext-value` của tên chuẩn (tên chuẩn không còn surrogate lẻ nên phép mã hoá không ném). */
function toExtendedValue(name: string): string {
  return encodeURIComponent(name).replace(
    /['()*!]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function render(asciiName: string, extendedValue: string): string {
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${extendedValue}`;
}

/**
 * Dựng giá trị `Content-Disposition` dạng `attachment` cho tên tệp `rawName`.
 * Không bao giờ ném — kể cả khi đầu vào lúc chạy không phải chuỗi.
 */
export function buildAttachmentDisposition(rawName: string): string {
  try {
    const name = servedFileName(rawName);
    return render(toAsciiFileName(name), toExtendedValue(name));
  } catch {
    // Rơi xuống tên dự phòng bên dưới: hàm này nằm trên đường ký URL tải, không được phép ném.
  }
  return render(FALLBACK_FILE_NAME, FALLBACK_FILE_NAME);
}
