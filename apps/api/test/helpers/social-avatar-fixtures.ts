import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { captureQueries, type CapturedQuery } from "./query-capture";

/**
 * S16-SOCIAL-AVATARPRESIGN-1 — fixture avatar ĐÃ XÁC MINH + đo câu cổng ký avatar.
 *
 * Avatar «đã xác minh» = đúng điều kiện của `FileRepository.findVerifiedAvatarsTx`: tệp `image/*`
 * `Uploaded` chưa xoá, link `ME/avatar/Avatar` SỐNG trỏ `entity_id = employeeId`, và người TẠO link sở
 * hữu tệp (`files.owner_user_id = file_links.created_by`). Gieo bằng SQL thẳng (khuôn
 * `avatar-presign.int-spec.ts`) — đường ghi thật (`MeAvatarService`) cần MinIO HEAD, không cần ở đây:
 * ký là HMAC cục bộ, không chạm object.
 */

/** URL đã ký qua S3 presign — dấu hiệu ĐỦ để phân biệt với fileId thô / URL passthrough. */
export const SIGNED_RE = /X-Amz-Signature=/;

/** Một tệp ảnh của `ownerUserId` (CHƯA link). Trả `fileId`. */
export async function insertImageFile(
  direct: Pool,
  companyId: string,
  ownerUserId: string,
): Promise<string> {
  const fileId = randomUUID();
  await direct.query(
    `INSERT INTO files (id, company_id, original_name, stored_name, mime_type, file_size_bytes,
       storage_provider, storage_path, visibility, upload_status, scan_status, owner_user_id, uploaded_by)
     VALUES ($1,$2,'avatar.png',$3,'image/png',10,'MinIO',$4,'Private','Uploaded','NotRequired',$5,$5)`,
    [fileId, companyId, `${fileId}-avatar.png`, `${companyId}/files/${fileId}`, ownerUserId],
  );
  return fileId;
}

/** Link `ME/avatar/Avatar` SỐNG của tệp tới hồ sơ `employeeId`, do `createdBy` tạo. */
export async function insertAvatarLink(
  direct: Pool,
  companyId: string,
  fileId: string,
  employeeId: string,
  createdBy: string,
): Promise<void> {
  await direct.query(
    `INSERT INTO file_links (company_id, file_id, module_code, entity_type, entity_id, link_type, created_by)
     VALUES ($1,$2,'ME','avatar',$3,'Avatar',$4)`,
    [companyId, fileId, employeeId, createdBy],
  );
}

/**
 * Avatar ĐÃ XÁC MINH cho `employeeId` + ghi `employee_profiles.avatar_url = fileId`.
 * `ownerUserId` = chính nhân viên (self-service) hoặc HR (HR-managed — hồ sơ không tài khoản).
 */
export async function giveVerifiedAvatar(
  direct: Pool,
  companyId: string,
  employeeId: string,
  ownerUserId: string,
): Promise<string> {
  const fileId = await insertImageFile(direct, companyId, ownerUserId);
  await insertAvatarLink(direct, companyId, fileId, employeeId, ownerUserId);
  await setAvatarRaw(direct, employeeId, fileId);
  return fileId;
}

/** Ghi THẲNG cột đa-người-ghi `employee_profiles.avatar_url` (dựng cảnh đầu độc / scheme lạ). */
export async function setAvatarRaw(
  direct: Pool,
  employeeId: string,
  raw: string | null,
): Promise<void> {
  await direct.query(`UPDATE employee_profiles SET avatar_url = $2 WHERE id = $1`, [
    employeeId,
    raw,
  ]);
}

/** Chạy `fn` trong lúc bắt câu SQL ở tầng driver — luôn gỡ bản vá, kể cả khi `fn` ném. */
export async function captured<T>(fn: () => Promise<T>): Promise<{ out: T; qs: CapturedQuery[] }> {
  const cap = captureQueries();
  try {
    const out = await fn();
    return { out, qs: cap.stop() };
  } catch (e) {
    cap.stop();
    throw e;
  }
}

/**
 * Câu CỔNG xác minh avatar (`findVerifiedAvatarsTx`): đọc `file_links` với tham số bind `'Avatar'`.
 * Đính kèm cũng đọc `file_links` nhưng với `linkType` khác — tham số là thứ phân biệt.
 */
export function gateQueries(qs: readonly CapturedQuery[]): CapturedQuery[] {
  return qs.filter((q) => /from\s+"file_links"/i.test(q.text) && q.values.includes("Avatar"));
}

/** Số transaction ĐƯỢC MỞ (`begin`) — SAVEPOINT không tính (không phải kết nối/tx mới). */
export function beginCount(qs: readonly CapturedQuery[]): number {
  return qs.filter((q) => /^\s*begin\b/i.test(q.text)).length;
}

/** Mọi tham số bind của các câu cổng, phẳng. */
export function gateValues(qs: readonly CapturedQuery[]): unknown[] {
  return gateQueries(qs).flatMap((q) => q.values);
}

/**
 * Đặt `avatar_url = NULL` cho MỌI hồ sơ của tenant trong lúc chạy `fn`, rồi khôi phục NGUYÊN giá trị
 * (kể cả khi `fn` ném). Dùng cho vế (b) của T-CNT: cùng request, không avatar nào ⇒ 0 câu cổng.
 */
export async function withTenantAvatarsCleared<T>(
  direct: Pool,
  companyId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const saved = await direct.query<{ id: string; avatar_url: string }>(
    `SELECT id, avatar_url FROM employee_profiles WHERE company_id = $1 AND avatar_url IS NOT NULL`,
    [companyId],
  );
  await direct.query(`UPDATE employee_profiles SET avatar_url = NULL WHERE company_id = $1`, [
    companyId,
  ]);
  try {
    return await fn();
  } finally {
    for (const r of saved.rows) await setAvatarRaw(direct, r.id, r.avatar_url);
  }
}
