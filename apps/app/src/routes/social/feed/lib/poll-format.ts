/**
 * S16-SOCIAL-FE-2 — hàm THUẦN của khối bình chọn (`SOC-SCREEN-007`, plan D5).
 *
 * Tách khỏi `PollBlock` để test bằng gọi hàm, và để luật «ai được đóng / rút phiếu» có đúng một bản
 * — thẻ bài ở dòng cuộn và ở màn chi tiết cùng dùng nó.
 */
import type { FeedPollResultsDto } from "@mediaos/contracts";

/**
 * Phần trăm của một lựa chọn, làm tròn số nguyên.
 *
 * Mẫu số là `totalVoters` (số NGƯỜI đã bỏ phiếu), KHÔNG phải tổng số phiếu: với bình chọn nhiều lựa
 * chọn, một người góp phiếu cho nhiều ô, và câu người đọc cần trả lời là «bao nhiêu người chọn ô
 * này». Hệ quả CÓ CHỦ ĐÍCH: tổng các ô của poll nhiều-lựa-chọn có thể vượt 100%.
 *
 * `totalVoters <= 0` ⇒ `0`, không bao giờ `NaN`: poll vừa đăng chưa ai bỏ phiếu là ca THƯỜNG, và
 * `NaN%` trên thanh đầu tiên người dùng thấy đọc như giao diện hỏng.
 */
export function pollOptionPercent(voteCount: number, totalVoters: number): number {
  if (!Number.isFinite(voteCount) || !Number.isFinite(totalVoters) || totalVoters <= 0) return 0;
  const ratio = Math.min(Math.max(voteCount, 0), totalVoters) / totalVoters;
  return Math.round(ratio * 100);
}

/**
 * Nút «Đóng bình chọn» hiện khi bình chọn còn mở **và** actor là chủ bài **hoặc** giữ
 * `manage:feed-post` — mirror đúng `assertCanMutateContent` ở `SocialPollsService.close`
 * (`social-polls.service.ts`, route `044`). Lệch một vế là nút 403 hoặc nút biến mất trong khi server
 * vẫn cho làm.
 */
export function canClosePoll(input: {
  status: FeedPollResultsDto["status"];
  isMine: boolean;
  canManagePost: boolean;
}): boolean {
  return input.status === "open" && (input.isMine || input.canManagePost);
}

/**
 * Bình chọn còn NHẬN PHIẾU không (plan FE-2 §8 H4).
 *
 * 🔴 `status==='open'` là CHƯA ĐỦ: poll quá `closesAt` vẫn mang `status:'open'` cho tới khi job đóng
 * theo hạn chạy (`social-polls.repository.ts#closeExpiredTx`), trong khi `041`/`042` đã từ chối nó
 * bằng đồng hồ DB (409 `SOCIAL-ERR-016`). Chỉ xét `status` là hiện nút bỏ phiếu cho một lượt chắc chắn
 * thất bại. Đồng hồ trình duyệt có thể lệch vài giây so với DB — lệch đó chỉ làm nút tắt sớm/muộn
 * vài giây, server vẫn là cổng cuối.
 */
export function isPollAcceptingVotes(
  results: Pick<FeedPollResultsDto, "status" | "closesAt">,
  now: number = Date.now(),
): boolean {
  if (results.status !== "open") return false;
  if (results.closesAt === null) return true;
  const closesAt = Date.parse(results.closesAt);
  return Number.isNaN(closesAt) || closesAt > now;
}

/** «Rút phiếu» (`042`) chỉ có nghĩa khi actor ĐANG có phiếu và bình chọn còn nhận phiếu. */
export function canWithdrawVote(
  results: Pick<FeedPollResultsDto, "status" | "closesAt" | "myVote">,
  now: number = Date.now(),
): boolean {
  return isPollAcceptingVotes(results, now) && results.myVote.length > 0;
}

/**
 * Tập lựa chọn đang được CHỌN trên form, khởi tạo từ phiếu hiện có của actor.
 *
 * So sánh hai tập để biết nút «Bỏ phiếu» có việc gì để làm không: gửi lại đúng tập đang có là một
 * lượt ghi vô ích (server chấp nhận, nhưng nó ghi audit/bộ đếm cho một thay đổi không có).
 */
export function isSameSelection(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

/**
 * Chọn / bỏ chọn một ô theo kiểu bình chọn.
 *
 * Một-lựa-chọn: chọn ô mới THAY ô cũ (radio). Nhiều-lựa-chọn: bật/tắt ô đó (checkbox). Trả mảng
 * MỚI — không sửa mảng đầu vào.
 */
export function toggleSelection(
  current: readonly string[],
  optionId: string,
  multipleChoice: boolean,
): string[] {
  if (!multipleChoice) return [optionId];
  return current.includes(optionId)
    ? current.filter((id) => id !== optionId)
    : [...current, optionId];
}
