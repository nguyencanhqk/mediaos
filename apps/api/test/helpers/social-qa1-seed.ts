import { randomUUID } from "node:crypto";
import type { SeededTenant } from "./seed";
import { FALLBACK_S3_SECRET } from "./fixture-secrets";
import {
  addComment,
  createGroup,
  ideaPost,
  joinGroup,
  newsPost,
  pollPost,
  reactComment,
  reactPost,
  reportTarget,
  savePost,
  sharePost,
  votePoll,
  type Json,
  type Qa1Actor,
  type Qa1Res,
  type Qa1World,
} from "./social-qa1-kit";
import { QA1_FILE_UPLOAD_BODY, type Qa1Slice } from "./social-qa1-routes";

/**
 * S16-SOCIAL-QA-1 (L1) — BỘ GIEO «lát dữ liệu» cho bảng 59 route (`social-qa1-routes.ts`).
 *
 * ĐÓNG BĂNG sau L1: các lát sau KHÔNG sửa file này (kể cả thêm hàm).
 *
 * Mọi thứ dựng QUA API (counter · thẻ · outbox chỉ đúng khi đi qua route — plan §6-B18), trừ MỘT câu
 * UPDATE đặt tệp sang `Uploaded` thay cho bước «client đẩy bytes» (kỹ thuật không-cần-storage của
 * `test/integration/social-be1c-file-door.int-spec.ts`).
 */

const short = (n = 10): string => randomUUID().replace(/-/g, "").slice(0, n);

/**
 * Đặt giá trị MẶC ĐỊNH cho cấu hình kho tệp để route 054 ký URL NGOẠI TUYẾN (HMAC, không gọi mạng,
 * không cần kho tệp chạy). Chỉ điền biến CHƯA có (`??=`). PHẢI gọi TRƯỚC `bootQa1World(...)` ở mọi
 * file spec sẽ gọi 054 / `seedQa1Slice`.
 */
export function ensureQa1FileDoorEnv(): void {
  process.env.S3_ENDPOINT ??= "http://localhost:9000";
  process.env.S3_ACCESS_KEY ??= "mediaos";
  process.env.S3_SECRET_KEY ??= FALLBACK_S3_SECRET;
  process.env.S3_BUCKET ??= "mediaos-assets";
  process.env.S3_FORCE_PATH_STYLE ??= "true";
}

function okData(res: Qa1Res, status: number, what: string): Json {
  if (res.status !== status) {
    throw new Error(
      `[social-qa1-seed] ${what}: mong ${status}, nhận ${res.status} ${JSON.stringify(res.body)}`,
    );
  }
  return (res.body.data ?? {}) as Json;
}

function needId(value: unknown, what: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`[social-qa1-seed] ${what}: thiếu id trong response`);
  }
  return value;
}

/**
 * Gieo MỘT lát dữ liệu đủ cho `owner` đi hết 59 route của `QA1_ROUTES` đúng một lượt.
 *
 * @param w      thế giới của kit — app phải được boot SAU `ensureQa1FileDoorEnv()`.
 * @param tenant công ty của lát; PHẢI là công ty của cả `owner` lẫn `opts.privileged`.
 * @param owner  người sẽ gọi 59 route. Dựng mọi thứ cặp của nó cho phép, nên PHẢI giữ ít nhất 7 cặp
 *               của vai nhân viên (`EMPLOYEE_FEED_PAIRS`) ở scope Company và có hồ sơ nhân viên —
 *               thiếu thì hàm NÉM kèm status + thân (không gieo nửa vời).
 * @param opts.privileged actor KHÁC `owner`, giữ ĐỦ 15 cặp feed ở scope Company, có hồ sơ nhân viên.
 *               Dựng phần `owner` có thể không được phép dựng: tin `requiresAck` · huy hiệu · bài để
 *               kiểm duyệt · báo cáo đang mở · bài trong thùng rác; và đóng vai «người kia» trong
 *               nhóm (đang chờ duyệt · thành viên · chủ nhóm để `owner` tham gia / rời).
 * @returns `Qa1Slice` — ý nghĩa từng trường ghi ở interface. Mỗi lời gọi tạo ≈ 35 request.
 *
 * Bẫy: KHÔNG dùng chung một lát cho hai người được CHO PHÉP (xem `QA1_ONE_SHOT_CODES`); người bị từ
 * chối ở tầng quyền dùng lát nào cũng được. Lát KHÔNG gieo vinh danh: 047 trả danh sách có thể rỗng.
 */
export async function seedQa1Slice(
  w: Qa1World,
  tenant: SeededTenant,
  owner: Qa1Actor,
  opts: { privileged: Qa1Actor },
): Promise<Qa1Slice> {
  const priv = opts.privileged;
  if (owner.tenant.companyId !== tenant.companyId || priv.tenant.companyId !== tenant.companyId) {
    throw new Error("[social-qa1-seed] owner / privileged phải thuộc đúng công ty của lát");
  }
  if (owner.userId === priv.userId) {
    throw new Error("[social-qa1-seed] privileged phải là actor KHÁC owner");
  }
  if (owner.employeeId === null || priv.employeeId === null) {
    throw new Error("[social-qa1-seed] owner / privileged phải có hồ sơ nhân viên");
  }

  const marker = `moc${short(12)}`;
  const tag = `qa${short(10)}`;

  // ── Bài ──
  const post = await sharePost(w, owner, `Bài lát ${marker} #${tag}`);
  const aux = await sharePost(w, owner);
  await savePost(w, owner, aux.id);
  await reactPost(w, owner, aux.id);
  const deletePost = await sharePost(w, owner);
  const reportTargetPost = await sharePost(w, owner);
  const moderatePost = await sharePost(w, priv);
  const trashed = await sharePost(w, priv);
  okData(await w.del(priv.token, `/social/posts/${trashed.id}`), 200, "005 đưa bài vào thùng rác");

  // ── Bình luận ──
  const comment = await addComment(w, owner, post.id);
  const reactedComment = await addComment(w, owner, post.id);
  await reactComment(w, owner, reactedComment.id);
  const deleteComment = await addComment(w, owner, post.id);

  // ── Tin cần xác nhận · báo cáo đang mở ──
  const ackNews = await newsPost(w, priv, { requiresAck: true });
  const report = await reportTarget(w, priv, "post", post.id);

  // ── Nhóm ──
  const group = await createGroup(w, owner, "private");
  const pending = await joinGroup(w, priv, group.id);
  if (pending.myStatus !== "pending") {
    throw new Error(`[social-qa1-seed] nhóm kín: mong pending, nhận ${String(pending.myStatus)}`);
  }
  const memberGroup = await createGroup(w, owner, "public");
  const member = await joinGroup(w, priv, memberGroup.id);
  if (member.myStatus !== "active") {
    throw new Error(
      `[social-qa1-seed] nhóm công khai: mong active, nhận ${String(member.myStatus)}`,
    );
  }
  const deleteGroup = await createGroup(w, owner, "public");
  const joinTarget = await createGroup(w, priv, "public");
  const leaveTarget = await createGroup(w, priv, "public");
  await joinGroup(w, owner, leaveTarget.id);

  // ── Bình chọn · sáng kiến ──
  const poll = await pollPost(w, owner);
  const votedPoll = await pollPost(w, owner);
  await votePoll(w, owner, votedPoll.id, [votedPoll.optionIds[0]]);
  const closePoll = await pollPost(w, owner);
  const idea = await ideaPost(w, owner);

  // ── Huy hiệu ──
  const makeBadge = async (what: string): Promise<string> =>
    needId(
      okData(
        await w
          .post(priv.token, "/social/kudos-badges")
          .send({ code: `qa1-${short(12)}`, name: `Huy hiệu ${short(6)}` }),
        201,
        what,
      ).id,
      what,
    );
  const badgeId = await makeBadge("049 huy hiệu");
  const deleteBadgeId = await makeBadge("049 huy hiệu để tắt");

  // ── Tệp: đăng ký qua 054, rồi đặt `Uploaded` thay cho bước đẩy bytes ──
  const uploadedFileId = needId(
    okData(
      await w.post(owner.token, "/social/files/upload-url").send({ ...QA1_FILE_UPLOAD_BODY }),
      200,
      "054 đăng ký tệp",
    ).fileId,
    "054 đăng ký tệp",
  );
  const marked = await w.direct.query(
    `UPDATE files SET upload_status = 'Uploaded' WHERE id = $1 AND company_id = $2`,
    [uploadedFileId, tenant.companyId],
  );
  if (marked.rowCount !== 1) {
    throw new Error(`[social-qa1-seed] không đặt được trạng thái tệp ${uploadedFileId}`);
  }

  return {
    companyId: tenant.companyId,
    ownerUserId: owner.userId,
    ownerEmployeeId: owner.employeeId,
    privilegedUserId: priv.userId,
    privilegedEmployeeId: priv.employeeId,
    marker,
    tag,
    recipientQuery: "Qa",
    postId: post.id,
    auxPostId: aux.id,
    deletePostId: deletePost.id,
    reportTargetPostId: reportTargetPost.id,
    moderatePostId: moderatePost.id,
    trashedPostId: trashed.id,
    commentId: comment.id,
    reactedCommentId: reactedComment.id,
    deleteCommentId: deleteComment.id,
    ackNewsPostId: ackNews.id,
    reportId: report.id,
    groupId: group.id,
    pendingUserId: priv.userId,
    memberGroupId: memberGroup.id,
    memberUserId: priv.userId,
    deleteGroupId: deleteGroup.id,
    joinGroupId: joinTarget.id,
    leaveGroupId: leaveTarget.id,
    pollPostId: poll.id,
    pollOptionId: poll.optionIds[0],
    votedPollPostId: votedPoll.id,
    closePollPostId: closePoll.id,
    ideaPostId: idea.id,
    badgeId,
    deleteBadgeId,
    uploadedFileId,
  };
}
