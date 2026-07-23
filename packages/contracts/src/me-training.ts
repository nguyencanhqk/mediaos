import { z } from "zod";

/**
 * S5-LMS-BE-3 — DTO tiến độ đào tạo (LMS) cho `GET /api/v1/me/training`.
 *
 * NGUỒN SỰ THẬT DTO (CLAUDE.md §4): shape response sống Ở ĐÂY. `apps/api` (MeTrainingService) parse response
 * của LMS QUA schema này TRƯỚC khi trả ra controller — **CẤM forward raw JSON của LMS** (LMS là hệ ngoài,
 * shape của nó không phải hợp đồng của MediaOS). FE (S5-LMS-FE-1) import lại type ở đây, KHÔNG khai cục bộ.
 *
 * Căn cứ: `docs/plans/S5-LMS-APP-3.md` §5 (hợp đồng JSON v1 THẬT — đối chiếu kiểu TS trong
 * `apps/lms/lib/lms/mediaos-progress.ts`) · §4.6 (404 = *chưa từng có* tài khoản; đã khoá vẫn 200 +
 * `user.active=false`) · §9.4 (nợ bàn giao cho WO này).
 *
 * KỶ LUẬT SCHEMA (cố ý):
 *  - `.strip()` MẶC ĐỊNH — KHÔNG `.passthrough()`: field lạ (kể cả PII mà LMS thêm về sau: id nội bộ, nội
 *    dung bài làm, số điện thoại…) bị **loại** trước khi ra FE. KHÔNG `.strict()`: LMS thêm field phụ
 *    KHÔNG được phép làm hỏng request của người dùng (fail-safe hai chiều).
 *  - `version` là LITERAL 1 — LMS bump v2 ⇒ parse fail ⇒ 502 ME-ERR-TRAINING-CONTRACT-MISMATCH. Đây là
 *    hành vi MONG MUỐN: thà báo lỗi rõ còn hơn render dữ liệu hiểu-sai-shape (memory: apifetch-drops-
 *    pagination-bare-array).
 *  - PIN **SHAPE**, KHÔNG pin **GIÁ TRỊ**: kiểu/field bắt buộc là chặt (drift shape ⇒ 502 rõ ràng), nhưng
 *    biên số học chỉ `nonnegative()` — KHÔNG chặn trên. Lý do: các số này là DẪN XUẤT phía LMS
 *    (`percent = round(completed/total*100)`, `score10` trộn trọng số); một dòng dữ liệu dị thường (vd
 *    `completed > total` do trùng bản ghi) mà làm 502 thì **xoá trắng toàn bộ thẻ Đào tạo** của người dùng —
 *    thiệt hại lớn hơn lợi ích. Chuẩn hoá để hiển thị (kẹp 0–100 cho thanh tiến độ) là việc của FE.
 *  - `percent` KHÔNG ép `.int()` (LMS `Math.round` nhưng ép int ở đây biến đổi-cách-làm-tròn thành 502 oan).
 */

/** Phiên bản hợp đồng DUY NHẤT MediaOS chấp nhận (APP-3 §5). Bump = đổi code có chủ đích, không tự động. */
export const ME_TRAINING_CONTRACT_VERSION = 1;

/**
 * Trần phòng thủ số khoá học trong 1 response. LMS đã cắt ở 100 (`MAX_COURSES` + cờ `coursesTruncated`);
 * 200 là biên gấp đôi — vượt ⇒ shape không còn tin được ⇒ 502 contract-mismatch (KHÔNG âm thầm cắt bớt).
 */
export const ME_TRAINING_MAX_COURSES = 200;

/** Chuỗi thời gian ISO-8601 do LMS sinh (`new Date().toISOString()` / cột text ISO). */
const isoString = z.string().min(1).max(64);

/** 1 khoá học trong danh sách (APP-3 §5 `ProgressCourse`). KHÔNG có id nội bộ của LMS — cố ý. */
export const meTrainingCourseSchema = z.object({
  slug: z.string().max(512),
  title: z.string().max(1000),
  /** round(completed/total*100); total=0 ⇒ 0. Không chặn trên — xem ghi chú "PIN SHAPE, KHÔNG PIN GIÁ TRỊ". */
  percent: z.number().nonnegative(),
  completed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  learningTimeSec: z.number().int().nonnegative(),
  lastActivityAt: isoString.nullable(),
});
export type MeTrainingCourse = z.infer<typeof meTrainingCourseSchema>;

/** Tài khoản học phía LMS. `active=false` = ĐÃ KHOÁ (vẫn có dữ liệu) — khác hẳn `no_account`. */
export const meTrainingUserSchema = z.object({
  email: z.string().max(254),
  name: z.string().max(500).nullable(),
  active: z.boolean(),
});
export type MeTrainingUser = z.infer<typeof meTrainingUserSchema>;

/** Tổng hợp toàn tài khoản (APP-3 §5 `summary`). */
export const meTrainingSummarySchema = z.object({
  courseCount: z.number().int().nonnegative(),
  completedCourses: z.number().int().nonnegative(),
  learningTimeSec: z.number().int().nonnegative(),
  lastActivityAt: isoString.nullable(),
});
export type MeTrainingSummary = z.infer<typeof meTrainingSummarySchema>;

/**
 * Tóm tắt bài thi. `submitted` đếm theo LƯỢT NỘP (trang học viên gộp theo phiên ⇒ hai số có thể lệch —
 * APP-3 §10 L5, cố ý). `bestScore10` thang 10. KHÔNG có đáp án/nội dung bài làm.
 */
export const meTrainingExamsSchema = z.object({
  submitted: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  pendingGrading: z.number().int().nonnegative(),
  bestScore10: z.number().nonnegative().nullable(),
  lastSubmittedAt: isoString.nullable(),
  truncated: z.boolean(),
});
export type MeTrainingExams = z.infer<typeof meTrainingExamsSchema>;

/** Tóm tắt quiz (1 dòng gộp — KHÔNG trả từng lượt ⇒ không phình payload). */
export const meTrainingQuizzesSchema = z.object({
  submitted: z.number().int().nonnegative(),
  averagePercent: z.number().nonnegative().nullable(),
  lastSubmittedAt: isoString.nullable(),
});
export type MeTrainingQuizzes = z.infer<typeof meTrainingQuizzesSchema>;

/** Payload tiến độ v1 (APP-3 §5). Parse fail ⇒ 502 ME-ERR-TRAINING-CONTRACT-MISMATCH. */
export const meTrainingProgressSchema = z.object({
  version: z.literal(ME_TRAINING_CONTRACT_VERSION),
  generatedAt: isoString,
  user: meTrainingUserSchema,
  summary: meTrainingSummarySchema,
  courses: z.array(meTrainingCourseSchema).max(ME_TRAINING_MAX_COURSES),
  coursesTruncated: z.boolean(),
  exams: meTrainingExamsSchema,
  quizzes: meTrainingQuizzesSchema,
});
export type MeTrainingProgress = z.infer<typeof meTrainingProgressSchema>;

/**
 * Trạng thái envelope:
 *  - `ok`         : có tài khoản LMS (kể cả đã khoá — `progress.user.active=false`), `progress` != null.
 *  - `no_account` : LMS trả 404 = email này **chưa từng có** tài khoản học (APP-3 §4.6). KHÔNG phải lỗi
 *                   hạ tầng ⇒ KHÔNG map thành 502 (nói dối "LMS chết") và KHÔNG ném 404 ra FE (vỡ card
 *                   /me) — fail-soft mirror SPEC-09 §18.2.
 */
export const ME_TRAINING_STATUSES = ["ok", "no_account"] as const;
export const meTrainingStatusSchema = z.enum(ME_TRAINING_STATUSES);
export type MeTrainingStatus = z.infer<typeof meTrainingStatusSchema>;

/** Response `GET /api/v1/me/training`. `progress` null ⇔ status `no_account`. */
export const meTrainingResponseSchema = z
  .object({
    status: meTrainingStatusSchema,
    progress: meTrainingProgressSchema.nullable(),
  })
  .refine((r) => (r.status === "ok") === (r.progress !== null), {
    message: "status 'ok' phải kèm progress, 'no_account' phải progress=null.",
    path: ["progress"],
  });
export type MeTrainingResponse = z.infer<typeof meTrainingResponseSchema>;
