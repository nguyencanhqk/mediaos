import { z } from "zod";

/**
 * S2-FND-BE-3 (L2) — Foundation file-access-log DTO (nguồn sự thật contracts cho GET
 * /api/v1/foundation/file-access-logs). DB-08 §8.8, BACKEND-11.
 *
 * BẤT BIẾN #2/#3: view WHITELIST an toàn — TUYỆT ĐỐI KHÔNG ip_address/user_agent/metadata/storage_path/
 * signed_url (PII/dấu vết + secret). z.object mặc định STRIP key lạ ⇒ các cột nhạy cảm nếu lọt từ row
 * KHÔNG ra ngoài. file_access_logs APPEND-ONLY: chỉ có DTO đọc (list/view), KHÔNG DTO mutate.
 */

/** action ∈ CHECK file_access_logs.action (mig 0433) — khớp FileAccessLogService.FileAccessAction. */
export const FILE_ACCESS_ACTIONS = [
  "Upload",
  "Download",
  "Preview",
  "Link",
  "Unlink",
  "Delete",
  "GenerateSignedUrl",
] as const;
export const fileAccessActionSchema = z.enum(FILE_ACCESS_ACTIONS);
export type FileAccessActionDto = z.infer<typeof fileAccessActionSchema>;

const LIST_LIMIT_DEFAULT = 50;
const LIST_LIMIT_MIN = 1;
const LIST_LIMIT_MAX = 100;

/**
 * Query GET /file-access-logs — filter + phân trang page-based. `coerce` để nhận query-string;
 * `.catch` + clamp để input rác → default (list đọc KHÔNG nên 400 vì page/limit rác — chống DoS unbounded).
 * from/to coerce sang Date (lọc theo created_at). fileId/actorUserId phải uuid; action ∈ enum.
 */
export const listFileAccessLogsQuerySchema = z.object({
  page: z.coerce
    .number()
    .int()
    .catch(1)
    .transform((n) => Math.max(1, n))
    .default(1),
  limit: z.coerce
    .number()
    .int()
    .catch(LIST_LIMIT_DEFAULT)
    .transform((n) => Math.min(LIST_LIMIT_MAX, Math.max(LIST_LIMIT_MIN, n)))
    .default(LIST_LIMIT_DEFAULT),
  fileId: z.string().uuid().optional(),
  actorUserId: z.string().uuid().optional(),
  action: fileAccessActionSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type ListFileAccessLogsQuery = z.infer<typeof listFileAccessLogsQuerySchema>;

/**
 * View DTO cho 1 dòng log truy cập file (response). WHITELIST an toàn — chỉ metadata không nhạy cảm.
 * KHÔNG chứa ip_address/user_agent/metadata/storage_path/signed_url (BẤT BIẾN). z.object STRIP mặc định
 * ⇒ nếu row raw có các cột đó, parse loại bỏ. createdAt = ISO-8601 string trên wire.
 */
export const fileAccessLogViewSchema = z
  .object({
    id: z.string().uuid(),
    fileId: z.string().uuid(),
    action: fileAccessActionSchema,
    accessGranted: z.boolean(),
    deniedReason: z.string().nullable(),
    actorUserId: z.string().uuid().nullable(),
    moduleCode: z.string().nullable(),
    entityType: z.string().nullable(),
    entityId: z.string().uuid().nullable(),
    permissionCode: z.string().nullable(),
    requestId: z.string().nullable(),
    createdAt: z.string(),
  })
  .strip();
export type FileAccessLogView = z.infer<typeof fileAccessLogViewSchema>;

/** Response GET /file-access-logs = mảng log masked (envelope + pagination bọc ở interceptor). */
export const fileAccessLogListResponseSchema = z.array(fileAccessLogViewSchema);
export type FileAccessLogListResponse = z.infer<typeof fileAccessLogListResponseSchema>;
