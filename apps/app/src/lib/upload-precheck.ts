/**
 * S16-SOCIAL-FILEOPENUX-1 (D10) — lọc sớm ở form tải cho nhóm tệp server LUÔN từ chối lúc đăng ký.
 *
 * CHỈ hai lưới cứng trong code API (không setting công ty nào mở được), xét cùng thứ tự với server
 * (`registerContentRejection` ở `apps/api/src/foundation/files/file-content-guard.ts`):
 *   1. `active-mime`: MIME khai (`file.type`, đúng thứ client gửi lên) thuộc nhóm trình duyệt tự dựng thành tài
 *      liệu — tập tường minh + hậu tố `+xml` so bằng `endsWith` (KHÔNG so chuỗi con: OOXML chứa `xml` mà hợp lệ).
 *   2. `blocked-extension`: đuôi sau dấu chấm cuối (chữ thường) thuộc tập chặn cứng.
 * KHÔNG mirror lưới theo công ty (allowlist MIME · đuôi chặn · cỡ — cần API đọc giới hạn) và KHÔNG mirror luật
 * dạng đuôi (server xét trên tên ĐÃ làm sạch ⇒ mirror dễ từ chối nhầm). Đây là UX: server vẫn là lưới chính.
 *
 * Hằng dưới đây là BẢN SAO của `apps/api/src/storage/content-serving.ts` (`apps/app` không import được
 * `apps/api`); `upload-precheck.spec.ts` (U-3) đọc văn bản nguồn API và đỏ khi hai bên lệch.
 */
export const UPLOAD_HARD_BLOCKED_EXTENSIONS: ReadonlySet<string> = new Set([
  "html",
  "htm",
  "xhtml",
  "xht",
  "shtml",
  "svg",
  "svgz",
  "xml",
  "xsl",
  "xslt",
]);

export const UPLOAD_ACTIVE_MIME_TYPES: ReadonlySet<string> = new Set([
  "text/html",
  "application/xhtml+xml",
  "image/svg+xml",
  "text/xml",
  "application/xml",
]);

export const UPLOAD_ACTIVE_MIME_SUFFIX = "+xml";

/** `type/subtype` theo token RFC 6838 (đã chữ thường) — cùng dạng server dùng trước khi so. */
const MIME_SHAPE = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;

export type UploadPrecheckRejection =
  | { reason: "active-mime" }
  | { reason: "blocked-extension"; extension: string };

function isActiveMime(declared: string): boolean {
  const [essence = ""] = declared.split(";");
  const normalized = essence.trim().toLowerCase();
  if (!MIME_SHAPE.test(normalized)) return false;
  return UPLOAD_ACTIVE_MIME_TYPES.has(normalized) || normalized.endsWith(UPLOAD_ACTIVE_MIME_SUFFIX);
}

function lastExtension(name: string): string | null {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return null;
  return name.slice(dot + 1).toLowerCase();
}

/** `null` = không lưới cứng nào ở đây chặn (server vẫn có thể từ chối vì lưới công ty). */
export function uploadPrecheck(file: {
  readonly name: string;
  readonly type: string;
}): UploadPrecheckRejection | null {
  if (isActiveMime(file.type)) return { reason: "active-mime" };
  const extension = lastExtension(file.name);
  if (extension !== null && UPLOAD_HARD_BLOCKED_EXTENSIONS.has(extension)) {
    return { reason: "blocked-extension", extension };
  }
  return null;
}

/**
 * Khoá i18n (namespace `common`) + giá trị nội suy cho thông báo tại chỗ. `null` = cho qua.
 * Caller: `t(msg.key, msg.values)` — một nguồn câu chữ cho cả 4 form tải.
 */
export function uploadPrecheckMessage(file: {
  readonly name: string;
  readonly type: string;
}): { key: string; values: Record<string, string> } | null {
  const rejection = uploadPrecheck(file);
  if (rejection === null) return null;
  return rejection.reason === "active-mime"
    ? { key: "common:uploadPrecheck.activeMime", values: { name: file.name } }
    : {
        key: "common:uploadPrecheck.blockedExtension",
        values: { name: file.name, extension: rejection.extension },
      };
}
