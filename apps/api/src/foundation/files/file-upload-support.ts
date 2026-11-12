import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
  type Logger,
} from "@nestjs/common";
import { FOUNDATION_FILE_ERROR_CODES } from "@mediaos/contracts";
import { buildFileKey, InvalidStorageKeyError } from "../../storage/file-storage-key";
import { UnsupportedAttachmentError } from "../../storage/object-storage.service";
import type { StorageAdapter } from "../../storage/storage-adapter.port";
import type { FileRecord } from "../../db/schema/files";
import type { SettingService } from "../settings/setting.service";
import { describeSignRejection } from "./file-content-guard";

/**
 * Phần phụ trợ của `FileService.upload` (không trạng thái): đọc giới hạn từ system_settings, chuẩn hoá tên,
 * dựng storage key phía server, ký PUT và dựng lỗi MIME. Tách khỏi files.service.ts (S16-SOCIAL-FILESVCSPLIT-1)
 * — thân hàm giữ NGUYÊN, chỉ đổi `this.x` thành tham số tường minh.
 */

/** system_settings keys (precedence company > system > default via SettingService). */
const SETTING_MAX_UPLOAD_MB = "file.max_upload_size_mb";
const SETTING_ALLOWED_MIME = "file.allowed_mime_types";
const SETTING_BLOCKED_EXT = "file.blocked_extensions";
const BYTES_PER_MB = 1024 * 1024;
const DEFAULT_MAX_UPLOAD_MB = 25; // mirror setting-defaults.ts — only used if resolve returns non-number.

/** 415 FOUNDATION-FILE-ERR-MIME — chung cho lưới cứng, allowlist công ty và trần kiểu của tầng ký. */
export function mimeRejected(declaredMimeType: string): UnsupportedMediaTypeException {
  return new UnsupportedMediaTypeException({
    code: FOUNDATION_FILE_ERROR_CODES.MIME,
    message: `${FOUNDATION_FILE_ERROR_CODES.MIME}: MIME không được phép: ${declaredMimeType}`,
  });
}

/** Ký PUT cho hàng vừa ghi. Trần cứng của tầng ký ⇒ 415/413; lỗi khác ném lại nguyên. LUÔN ném ⇒ tx rollback hàng. */
export async function signUploadOrReject(
  storage: StorageAdapter,
  logger: Logger,
  row: FileRecord,
): ReturnType<StorageAdapter["signedUrl"]> {
  const { storagePath: key, mimeType: contentType, fileSizeBytes: sizeBytes } = row;
  try {
    return await storage.signedUrl({ key, contentType, sizeBytes });
  } catch (err) {
    if (!(err instanceof UnsupportedAttachmentError)) throw err;
    // 4xx dưới đây trùng thông điệp với allowlist công ty ⇒ để lại dấu vết riêng cho nguyên nhân này.
    logger.warn(describeSignRejection(row.companyId, contentType, err));
    if (err.kind === "content-type") throw mimeRejected(contentType);
    throw new PayloadTooLargeException({
      code: FOUNDATION_FILE_ERROR_CODES.SIZE,
      message: `${FOUNDATION_FILE_ERROR_CODES.SIZE}: kích thước file ngoài giới hạn của tầng lưu trữ.`,
    });
  }
}

/** Id tệp mới (UUID) — tách để upload() không phải import node:crypto. */
export function newFileId(): string {
  return randomUUID();
}

/**
 * Sanitize originalName chống path-traversal: bỏ NUL + ASCII control chars, lấy basename (phần sau dấu
 * phân tách cuối '/' hoặc '\\'), từ chối tên rút gọn về '.'/'..'/rỗng. Trả tên an toàn để LƯU METADATA
 * (KHÔNG dùng cho key — key luôn server-derive bằng fileId UUID, không bao giờ chứa tên này → mọi mưu
 * đồ path-traversal qua originalName là vô hại với storage_path).
 */
export function sanitizeFilename(name: string): string {
  // Bỏ NUL + ASCII control chars (0x00–0x1F, 0x7F) theo char-code (KHÔNG dùng control-char regex literal).
  let noControl = "";
  for (const ch of name) {
    const code = ch.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) continue;
    noControl += ch;
  }
  // Lấy basename: phần sau dấu phân tách cuối cùng ('/' hoặc '\\').
  const base = noControl.split(/[/\\]/).pop() ?? "";
  const trimmed = base.trim();
  if (trimmed === "" || trimmed === "." || trimmed === "..") {
    throw new BadRequestException({
      code: FOUNDATION_FILE_ERROR_CODES.FILENAME,
      message: `${FOUNDATION_FILE_ERROR_CODES.FILENAME}: tên file không hợp lệ sau khi chuẩn hoá.`,
    });
  }
  return trimmed.slice(0, 500);
}

/** Build key server-side; InvalidStorageKeyError → 400 (không lộ chi tiết). */
export function buildKeyOrThrow(companyId: string, fileId: string, originalName: string): string {
  try {
    return buildFileKey({ companyId, fileId, originalName });
  } catch (err) {
    if (err instanceof InvalidStorageKeyError) {
      throw new BadRequestException({
        code: FOUNDATION_FILE_ERROR_CODES.KEY,
        message: `${FOUNDATION_FILE_ERROR_CODES.KEY}: không thể tạo storage key hợp lệ.`,
      });
    }
    throw err;
  }
}

/**
 * Đọc giới hạn upload từ system_settings (precedence company > system > default qua SettingService —
 * S1-FND-SETTING-1). Nếu resolve trả kiểu rác → fallback default size; allowlist FAIL-CLOSED (thiếu
 * allowlist ⇒ Set rỗng ⇒ mọi MIME bị từ chối, KHÔNG fail-open).
 */
export async function loadUploadLimits(
  settings: SettingService,
  companyId: string,
): Promise<{
  allowedMime: Set<string>;
  maxBytes: number;
  blockedExtensions: Set<string>;
}> {
  const resolved = await settings.resolveMany(companyId, [
    SETTING_ALLOWED_MIME,
    SETTING_MAX_UPLOAD_MB,
    SETTING_BLOCKED_EXT,
  ]);
  const byKey = new Map(resolved.map((r) => [r.key, r.value]));

  const mimeValue = byKey.get(SETTING_ALLOWED_MIME);
  const allowedMime = new Set<string>(
    Array.isArray(mimeValue)
      ? (mimeValue as unknown[]).filter((v): v is string => typeof v === "string")
      : [],
  );

  const sizeValue = byKey.get(SETTING_MAX_UPLOAD_MB);
  const maxMb = typeof sizeValue === "number" && sizeValue > 0 ? sizeValue : DEFAULT_MAX_UPLOAD_MB;

  // blocked_extensions normalize về lowercase, không dấu chấm (khớp resolveRegisterExtension). Thiếu setting →
  // Set rỗng (không chặn theo extension; MIME-allowlist + extension↔MIME vẫn là hàng rào).
  const blockedValue = byKey.get(SETTING_BLOCKED_EXT);
  const blockedExtensions = new Set<string>(
    Array.isArray(blockedValue)
      ? (blockedValue as unknown[])
          .filter((v): v is string => typeof v === "string")
          .map((v) => v.replace(/^\./, "").toLowerCase())
      : [],
  );

  return { allowedMime, maxBytes: maxMb * BYTES_PER_MB, blockedExtensions };
}
