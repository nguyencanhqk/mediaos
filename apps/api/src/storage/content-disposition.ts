/**
 * S16-SOCIAL-FILEDISPOSITION-1 — dựng giá trị `Content-Disposition: attachment` từ tên tệp gốc (hàm THUẦN).
 *
 * Đầu ra LUÔN là ASCII in được (0x20–0x7E), không CR/LF, gồm hai dạng tên:
 *   - `filename="…"`      — dự phòng ASCII cho client cũ (bỏ dấu tiếng Việt, ký tự lạ thành `_`);
 *   - `filename*=UTF-8''…` — RFC 5987, percent-encode UTF-8; mã hoá THÊM `' ( ) * !` vì parser phía FE
 *     (`packages/web-core/src/lib/api-client.ts` — `parseContentDispositionFilename`) dừng nhóm bắt ở `'`.
 * Tên được làm sạch trước: bỏ ký tự điều khiển + ký tự đổi chiều chữ, `\` `/` thành `_`, cắt theo BYTE
 * UTF-8 (giữ đuôi tệp). Hàm TOÀN PHẦN — không bao giờ ném; tên không dựng được ⇒ {@link FALLBACK_FILE_NAME}.
 */

/** Tên dùng khi tên gốc rỗng hoặc không dựng được. */
const FALLBACK_FILE_NAME = "download";

/** Trần độ dài tên (byte UTF-8) — giữ URL đã ký ở mức vài trăm ký tự. */
const MAX_NAME_UTF8_BYTES = 180;

/** Đuôi tệp dài hơn mức này (kể cả dấu chấm) không được coi là đuôi khi cắt. */
const MAX_EXTENSION_CHARS = 12;

/** Các khoảng điểm mã bị xoá khỏi tên: [đầu, cuối] (đóng hai đầu). */
const STRIPPED_CODE_POINT_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0000, 0x001f], // C0
  [0x007f, 0x009f], // DEL + C1
  [0x2028, 0x2029], // ngắt dòng / ngắt đoạn Unicode
  [0x200e, 0x200f], // dấu chiều chữ
  [0x202a, 0x202e], // nhúng / ghi đè chiều chữ
  [0x2066, 0x2069], // cô lập chiều chữ
];

function isStrippedCodePoint(codePoint: number): boolean {
  return STRIPPED_CODE_POINT_RANGES.some(([from, to]) => codePoint >= from && codePoint <= to);
}

function stripUnsafeCharacters(name: string): string {
  return Array.from(name)
    .filter((char) => !isStrippedCodePoint(char.codePointAt(0) ?? 0))
    .join("");
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

function truncateKeepingExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  const extension = dot > 0 && name.length - dot <= MAX_EXTENSION_CHARS ? name.slice(dot) : "";
  const stem = extension ? name.slice(0, dot) : name;
  const stemBudget = Math.max(0, MAX_NAME_UTF8_BYTES - Buffer.byteLength(extension, "utf8"));
  return truncateUtf8(stem, stemBudget) + extension;
}

function sanitizeFileName(rawName: unknown): string {
  const text = typeof rawName === "string" ? rawName.normalize("NFC") : "";
  const cleaned = stripUnsafeCharacters(text).replace(/[\\/]/g, "_").trim();
  const truncated = truncateKeepingExtension(cleaned);
  return truncated === "" || /^\.+$/.test(truncated) ? FALLBACK_FILE_NAME : truncated;
}

/** Dự phòng ASCII cho `filename="…"`: không nháy kép, gạch chéo ngược, `;`, `%`, `*`. */
function toAsciiFallback(name: string): string {
  const ascii = name
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\;%*]/g, "_");
  return ascii === "" ? FALLBACK_FILE_NAME : ascii;
}

/** RFC 5987 `ext-value`; `null` khi tên không mã hoá được (surrogate lẻ ⇒ `URIError`). */
function toExtendedValue(name: string): string | null {
  try {
    return encodeURIComponent(name).replace(
      /['()*!]/g,
      (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
    );
  } catch {
    return null;
  }
}

function render(name: string, extendedValue: string): string {
  return `attachment; filename="${toAsciiFallback(name)}"; filename*=UTF-8''${extendedValue}`;
}

/**
 * Dựng giá trị `Content-Disposition` dạng `attachment` cho tên tệp `rawName`.
 * Không bao giờ ném — kể cả khi đầu vào lúc chạy không phải chuỗi.
 */
export function buildAttachmentDisposition(rawName: string): string {
  try {
    const name = sanitizeFileName(rawName);
    const extendedValue = toExtendedValue(name);
    if (extendedValue !== null) return render(name, extendedValue);
  } catch {
    // Rơi xuống tên dự phòng bên dưới: hàm này nằm trên đường ký URL tải, không được phép ném.
  }
  return render(FALLBACK_FILE_NAME, FALLBACK_FILE_NAME);
}
