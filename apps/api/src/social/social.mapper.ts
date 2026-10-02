import type {
  FeedAttachmentDto,
  FeedAuthorDto,
  FeedCommentDto,
  FeedKudosBlockDto,
  FeedMentionDto,
  FeedPollResultsDto,
  FeedPostDto,
  FeedPostIdeaBlockDto,
  FeedReactionSummaryDto,
} from "@mediaos/contracts";
import { kudosRecipientDto, type SignedAvatars } from "./social-avatar-signer";
import type { CommentRow } from "./social-comments.repository";
import type { PostKudosBlock } from "./social-post-blocks";
import type { PostRow } from "./social-posts.repository";
import type { SocialViewerContext } from "./social.types";

/**
 * S16-SOCIAL-BE-1 — row → DTO. **Đường DUY NHẤT** dựng `FeedPostDto`/`FeedCommentDto`.
 *
 * ┌─ VÌ SAO MAPPER LÀ MỘT LỚP CHE, KHÔNG PHẢI MỘT PHÉP ĐỔI TÊN ───────────────────────────────────┐
 * │ Hàng `feed_posts` mang `author_user_id`, `status`, `deleted_at`. API-19 §6.1 chốt DTO của người │
 * │ đọc thường KHÔNG có ba thứ đó. Nếu mỗi điểm gọi tự ghép object, chỉ cần MỘT chỗ quên `delete`   │
 * │ một khoá là rò — và chỗ quên sẽ là đường ít người đọc nhất (WS, hoặc response của đường ghi).   │
 * │ ⇒ Mọi đường đi qua đây; thêm khoá vào DTO là sửa ĐÚNG MỘT file và review thấy ngay.             │
 * │                                                                                                 │
 * │ `authorUserId` KHÔNG BAO GIỜ ra ngoài, kể cả cho `manage:feed-post`: câu hỏi "bài này của ai"   │
 * │ đã được trả lời bằng `author.employeeId` + `author.fullName`, còn `userId` là khoá của tài khoản │
 * │ — thứ duy nhất cần để dò các đường `users/*`. Quyền sở hữu trả bằng cờ `isMine`.                 │
 * │ `status` CHỈ hiện cho tác giả hoặc `manage:feed-post` — với người đọc thường, sự CÓ MẶT của khoá │
 * │ này đã đủ để biết một bài `hidden` tồn tại.                                                     │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 */

/**
 * S16-SOCIAL-AVATARPRESIGN-1 — `avatarUrl` CHỈ đến từ `avatars.urlOf` (URL đã ký cho ĐÚNG cặp của tác
 * giả hàng này). Cột thô `authorAvatarRaw` không bao giờ lên DTO (spec cấu trúc S2 canh).
 */
function authorOf(
  row: {
    authorEmployeeId: string | null;
    authorFullName: string | null;
    authorAvatarRaw: string | null;
  },
  avatars: SignedAvatars,
): FeedAuthorDto {
  return {
    employeeId: row.authorEmployeeId,
    fullName: row.authorFullName,
    avatarUrl: avatars.urlOf({ employeeId: row.authorEmployeeId, avatarRaw: row.authorAvatarRaw }),
  };
}

/** ISO-8601 có offset — hợp đồng `z.string().datetime({offset:true})` của contracts. */
const iso = (d: Date): string => d.toISOString();

export function toFeedPostDto(
  row: PostRow,
  viewer: SocialViewerContext,
  extra: {
    tags: readonly string[];
    attachments: readonly FeedAttachmentDto[];
    myReaction: string | null;
    savedByMe: boolean;
    /** Vắng ⇒ khoá `mentions` VẮNG trên DTO (đường chưa nạp) — KHÔNG thành `[]` (vắng ≠ rỗng). */
    mentions?: readonly FeedMentionDto[];
    /** S16-SOCIAL-BE-2D — khối theo loại bài; vắng ⇒ khoá VẮNG (bài khác loại / đường không nạp / mồ côi). */
    kudos?: PostKudosBlock;
    poll?: FeedPollResultsDto;
    idea?: FeedPostIdeaBlockDto;
    /**
     * S16-SOCIAL-AVATARPRESIGN-1 — avatar ĐÃ KÝ của lô (tác giả + người nhận kudos). BẮT BUỘC: mọi lối
     * dựng DTO bài phải đi qua bộ ký (`NO_AVATARS` khi cố ý không ký) — quên là lỗi biên dịch.
     */
    avatars: SignedAvatars;
  },
): FeedPostDto {
  const isMine = row.authorUserId === viewer.actorUserId;
  const dto: FeedPostDto = {
    id: row.id,
    type: row.type,
    audience: row.audience as FeedPostDto["audience"],
    orgUnitId: row.orgUnitId,
    groupId: row.groupId,
    author: authorOf(row, extra.avatars),
    body: row.body,
    tags: [...extra.tags],
    attachments: [...extra.attachments],
    pinned: row.pinned,
    commentsLocked: row.commentsLocked,
    requiresAck: row.requiresAck,
    likeCount: row.likeCount,
    commentCount: row.commentCount,
    viewCount: row.viewCount,
    myReaction: extra.myReaction,
    savedByMe: extra.savedByMe,
    isMine,
    editedAt: row.editedAt ? iso(row.editedAt) : null,
    publishedAt: iso(row.publishedAt),
    lastActivityAt: iso(row.lastActivityAt),
    createdAt: iso(row.createdAt),
  };
  // Khoá `status` được THÊM VÀO, không phải bị xoá đi — mặc định là vắng mặt. Hướng này quan trọng:
  // quên một nhánh thì kết quả là THIẾU thông tin cho người có quyền, không phải RÒ cho người không.
  if (isMine || viewer.canManagePosts) {
    dto.status = row.status as NonNullable<FeedPostDto["status"]>;
  }
  if (extra.mentions) dto.mentions = extra.mentions.map(copyMention);
  if (extra.kudos) dto.kudos = copyKudos(extra.kudos, extra.avatars);
  if (extra.poll) dto.poll = copyPoll(extra.poll);
  if (extra.idea) dto.idea = { status: extra.idea.status };
  return dto;
}

export function toFeedCommentDto(
  row: CommentRow,
  viewer: SocialViewerContext,
  extra: {
    attachments: readonly FeedAttachmentDto[];
    myReaction: string | null;
    mentions?: readonly FeedMentionDto[];
    /** S16-SOCIAL-AVATARPRESIGN-1 — BẮT BUỘC, xem `toFeedPostDto`. */
    avatars: SignedAvatars;
  },
): FeedCommentDto {
  const dto: FeedCommentDto = {
    id: row.id,
    postId: row.postId,
    parentCommentId: row.parentCommentId,
    author: authorOf(row, extra.avatars),
    body: row.body,
    attachments: [...extra.attachments],
    likeCount: row.likeCount,
    myReaction: extra.myReaction,
    isMine: row.authorUserId === viewer.actorUserId,
    editedAt: row.editedAt ? iso(row.editedAt) : null,
    createdAt: iso(row.createdAt),
  };
  if (extra.mentions) dto.mentions = extra.mentions.map(copyMention);
  return dto;
}

/**
 * Chép một phần tử theo DANH SÁCH KHOÁ của từng nhánh — không spread: một khoá lạ (vd `userId`) lỡ
 * gắn vào phần tử ở tầng dưới sẽ không đi được qua đây. Nhánh rút ra ĐÚNG `{withheld:true}`.
 */
function copyMention(m: FeedMentionDto): FeedMentionDto {
  return m.withheld
    ? { withheld: true }
    : { withheld: false, employeeId: m.employeeId, label: m.label };
}

/**
 * S16-SOCIAL-BE-2D — chép khối theo DANH SÁCH KHOÁ (khuôn `copyMention`): không có serializer response
 * nào phía sau (controller trả thẳng object), nên đây là lớp CHE cuối cùng — một `userId` lỡ gắn vào
 * người nhận / một `voters` lỡ gắn vào poll ở tầng dưới không đi được qua đây.
 * Người nhận đi qua `kudosRecipientDto` (S16-SOCIAL-AVATARPRESIGN-1): MỘT luật cho thẻ + `047`, avatar
 * ký theo CẶP của chính người nhận (raw đã che K1 ⇒ `null`, kể cả khi cùng người được ký ở ô tác giả).
 */
function copyKudos(k: PostKudosBlock, avatars: SignedAvatars): FeedKudosBlockDto {
  return {
    kudosId: k.kudosId,
    message: k.message,
    isOfficial: k.isOfficial,
    badge: k.badge ? { id: k.badge.id, code: k.badge.code, name: k.badge.name, icon: k.badge.icon } : null,
    recipients: k.recipients.map((r) => kudosRecipientDto(r, avatars)),
  };
}

function copyPoll(p: FeedPollResultsDto): FeedPollResultsDto {
  return {
    pollId: p.pollId,
    postId: p.postId,
    question: p.question,
    status: p.status,
    multipleChoice: p.multipleChoice,
    isAnonymous: p.isAnonymous,
    closesAt: p.closesAt,
    totalVoters: p.totalVoters,
    myVote: [...p.myVote],
    options: p.options.map((o) => ({ id: o.id, label: o.label, voteCount: o.voteCount })),
  };
}

/** Tổng hợp cảm xúc theo emoji — `mine` là của RIÊNG actor. */
export function toReactionSummaries(
  rows: readonly { emoji: string; count: number }[],
  myEmoji: string | null,
): FeedReactionSummaryDto[] {
  return rows.map((r) => ({ emoji: r.emoji, count: r.count, mine: r.emoji === myEmoji }));
}
