import { z } from "zod";
import { feedIdeaStatusSchema, feedPollStatusSchema } from "./social";

/**
 * S16-SOCIAL-BE-2D — khối CHI TIẾT theo loại bài chở trên thẻ bài (`feedPostSchema.kudos?/poll?/idea?`)
 * và dùng lại ở `041..044` (poll) · `047` (vinh danh).
 *
 * ┌─ 🔴 FILE LÁ — CHỈ ĐƯỢC IMPORT `zod` + `./social` ───────────────────────────────────────────────┐
 * │ `social-api-b.ts` import `feedPostSchema` từ `./social-api` rồi `.extend` NGAY ở cấp module, còn │
 * │ `social-api-{polls,ideas,kudos}.ts` import `./social-api-b`. `social-api.ts` import ngược bất kỳ │
 * │ file nào trong ba file đó là VÒNG: lúc nạp, `feedPostSchema` còn `undefined` (CJS) / ở TDZ (ESM)  │
 * │ ⇒ api lẫn web chết ngay khi khởi động. Khối nào `feedPostSchema` cần thì sống Ở ĐÂY.            │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 */

// ═══════════════ Vinh danh ═══════════════

/**
 * Một người được vinh danh — CÙNG hình dạng ở thẻ bài và `047` (plan BE-2D D4: một luật cho cả hai).
 *
 * 🔴 **KHÔNG `userId`** (ca `K-7`): cùng luật `feedAuthorSchema` — `users.id` là khoá tài khoản, phơi
 * ra danh sách công khai là bản đồ user-id của cả công ty.
 *
 * `fullName`/`avatarUrl` `null` khi: người đó không có tài khoản (tên sống ở `users.full_name`), HOẶC
 * hồ sơ nhân sự / tài khoản đã XOÁ MỀM (owner K1 — bản ghi đã xoá không chiếu danh tính ra ngoài).
 * `isFormerEmployee` = hồ sơ không còn `active` HOẶC hồ sơ/tài khoản đã xoá mềm — FE hiện nhãn, không
 * đoán. Tài khoản bị KHOÁ vẫn giữ tên (S6: người nghỉ việc thường bị khoá TK, vinh danh là lịch sử).
 *
 * ⚠️ `avatarUrl` là cột THÔ `employee_profiles.avatar_url` (thường là fileId, không phải URL; cột
 * đa-người-ghi) — KHÔNG vẽ làm `src`/`href` tới khi `S16-SOCIAL-AVATARPRESIGN-1` xong (owner K4).
 */
export const feedKudosRecipientSchema = z.object({
  employeeId: z.string().uuid(),
  fullName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  isFormerEmployee: z.boolean(),
});
export type FeedKudosRecipientDto = z.infer<typeof feedKudosRecipientSchema>;

/** Huy hiệu gắn trên một lời vinh danh. Huy hiệu ĐÃ TẮT vẫn hiện trên bài cũ (D13 của BE-2B-2). */
export const feedKudosBadgeRefSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  /** Tên icon lucide — `null` = FE dùng icon mặc định. */
  icon: z.string().nullable(),
});
export type FeedKudosBadgeRefDto = z.infer<typeof feedKudosBadgeRefSchema>;

/**
 * Khối vinh danh trên thẻ bài `type='kudos'`. `047` = khối này + `postId` + `createdAt`.
 *
 * Người nhận xếp theo `employeeId` (thứ tự của `047`), KHÔNG theo thứ tự chọn lúc soạn.
 */
export const feedKudosBlockSchema = z.object({
  kudosId: z.string().uuid(),
  message: z.string().nullable(),
  isOfficial: z.boolean(),
  badge: feedKudosBadgeRefSchema.nullable(),
  recipients: z.array(feedKudosRecipientSchema),
});
export type FeedKudosBlockDto = z.infer<typeof feedKudosBlockSchema>;

// ═══════════════ Bình chọn ═══════════════

/** Một lựa chọn kèm số phiếu. KHÔNG có danh sách cử tri — kể cả với bình chọn công khai. */
export const feedPollOptionResultSchema = z.object({
  id: z.string().uuid(),
  label: z.string(),
  voteCount: z.number().int().min(0),
});
export type FeedPollOptionResultDto = z.infer<typeof feedPollOptionResultSchema>;

/**
 * `041` (bỏ/đổi phiếu) · `042` (rút phiếu) · `043` (kết quả) · `044` (đóng tay) — MỘT hình dạng cho
 * cả bốn (`SocialPollsService.readResultsTx`), nên FE ghi thẳng kết quả mutation vào cache của `043`.
 * **S16-SOCIAL-BE-2D**: cũng là khối `poll?` trên thẻ bài (cùng một bộ dựng SQL phía BE) ⇒ FE seed
 * cache `043` thẳng từ thẻ.
 *
 * 🔴 **Không trường nào chở danh tính cử tri** (SOC-DEC-009 — ẩn danh thì `user_id` không bao giờ ra
 * khỏi server, kể cả với `company-admin`). `myVote` là phiếu của CHÍNH người gọi. Thêm `voters` /
 * `userIds` vào đây là mở đúng đường rò mà bất biến đó cấm.
 *
 * `totalVoters` = số NGƯỜI đã bỏ phiếu (không phải tổng phiếu) — mẫu số của thanh %.
 * `status` y như DB: vẫn `open` quá `closesAt` tới khi job đóng chạy — FE suy «còn nhận phiếu» từ
 * CẢ `status` lẫn `closesAt` (`isPollAcceptingVotes`).
 */
export const feedPollResultsSchema = z.object({
  pollId: z.string().uuid(),
  postId: z.string().uuid(),
  question: z.string(),
  status: feedPollStatusSchema,
  multipleChoice: z.boolean(),
  isAnonymous: z.boolean(),
  closesAt: z.string().datetime({ offset: true }).nullable(),
  totalVoters: z.number().int().min(0),
  myVote: z.array(z.string().uuid()),
  options: z.array(feedPollOptionResultSchema),
});
export type FeedPollResultsDto = z.infer<typeof feedPollResultsSchema>;

// ═══════════════ Sáng kiến ═══════════════

/**
 * Khối sáng kiến trên thẻ bài `type='idea'` — **CHỈ `status`** (pill trạng thái, G4 của FE-2).
 *
 * KHÔNG `reviewNote` (mặt nạ D19 theo người xem — chỉ tác giả/`approve:feed-idea`), KHÔNG người duyệt
 * (điểm danh tính riêng của `045`). Nội dung sáng kiến chính là `body` của bài.
 */
export const feedPostIdeaBlockSchema = z.object({
  status: feedIdeaStatusSchema,
});
export type FeedPostIdeaBlockDto = z.infer<typeof feedPostIdeaBlockSchema>;
