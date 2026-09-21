import type {
  FeedAttachmentDto,
  FeedAuthorDto,
  FeedCommentDto,
  FeedPostDto,
  FeedReactionSummaryDto,
} from "@mediaos/contracts";
import type { CommentRow } from "./social-comments.repository";
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

function authorOf(row: {
  authorEmployeeId: string | null;
  authorFullName: string | null;
  authorAvatarUrl: string | null;
}): FeedAuthorDto {
  return {
    employeeId: row.authorEmployeeId,
    fullName: row.authorFullName,
    avatarUrl: row.authorAvatarUrl,
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
  },
): FeedPostDto {
  const isMine = row.authorUserId === viewer.actorUserId;
  const dto: FeedPostDto = {
    id: row.id,
    type: row.type,
    audience: row.audience as FeedPostDto["audience"],
    orgUnitId: row.orgUnitId,
    groupId: row.groupId,
    author: authorOf(row),
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
  return dto;
}

export function toFeedCommentDto(
  row: CommentRow,
  viewer: SocialViewerContext,
  extra: { attachments: readonly FeedAttachmentDto[]; myReaction: string | null },
): FeedCommentDto {
  return {
    id: row.id,
    postId: row.postId,
    parentCommentId: row.parentCommentId,
    author: authorOf(row),
    body: row.body,
    attachments: [...extra.attachments],
    likeCount: row.likeCount,
    myReaction: extra.myReaction,
    isMine: row.authorUserId === viewer.actorUserId,
    editedAt: row.editedAt ? iso(row.editedAt) : null,
    createdAt: iso(row.createdAt),
  };
}

/** Tổng hợp cảm xúc theo emoji — `mine` là của RIÊNG actor. */
export function toReactionSummaries(
  rows: readonly { emoji: string; count: number }[],
  myEmoji: string | null,
): FeedReactionSummaryDto[] {
  return rows.map((r) => ({ emoji: r.emoji, count: r.count, mine: r.emoji === myEmoji }));
}
