/**
 * S16-SOCIAL-FE-1 — thẻ bài trên dòng cuộn (UI-07 §34b.4 · `SOC-SCREEN-001`).
 *
 * Thứ tự trong thẻ: đầu thẻ (avatar · tên · thời gian · huy hiệu · menu ⋯) → thân → lưới ảnh →
 * dải số đếm → thanh hành động (cảm xúc · bình luận · lưu).
 *
 * ┌─ 🔴 R16/C27 — LOẠI BÀI LẠ PHẢI SUY BIẾN AN TOÀN, KHÔNG ĐƯỢC NÉM ─────────────────────────────┐
 * │ `feedPostSchema.type` là `z.string()` (không phải enum đóng), và từ khi BE-2B-1 (#534) merge   │
 * │ thì bài `type:'poll'` TẠO ĐƯỢC qua API — dù composer của FE-1 chỉ có 2 nút. Bài như thế nằm    │
 * │ ngay trong cùng danh sách mà thẻ này render, và `body` của nó được phép **NULL**               │
 * │ (`chk_feed_posts_body_required` cho phép NULL đúng với `poll`/`kudos`).                        │
 * │ ⇒ Thẻ vẫn vẽ phần CHUNG, bỏ phần thân đặc thù, và **không** vẽ chữ "null".                    │
 * │ S16-SOCIAL-FE-2 lát A: `poll` có khối bỏ phiếu (`PollBlock`), `idea` có nhãn + link màn 008.   │
 * │ S16-SOCIAL-FE-2C: `kudos` có `KudosBlock` khi DTO chở `post.kudos`; khối VẮNG (006 · WS · API  │
 * │ cũ · hàng mồ côi) ⇒ vẫn suy biến như trên. Loại lạ khác cũng vậy.                              │
 * │ S16-SOCIAL-FEBLOCKSEED-1: `post.poll` seed `PollBlock` (không gọi `043`); `post.idea` thêm pill │
 * │ trạng thái cạnh link. Khối vắng ⇒ `PollBlock` tự tải / chỉ nhãn + link, như trước.             │
 * └───────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Phân quyền: xem `PostCardMenu` — mọi quyết định gate của thẻ tập trung ở đó.
 */
import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Bookmark, Lightbulb, MessageSquare, Pin } from "lucide-react";
import { Avatar, cn } from "@mediaos/ui";
import type { FeedPostDto, FeedReactionEmojiDto, FeedReactionSummaryDto } from "@mediaos/contracts";
import { PostBody } from "./PostBody";
import { FeedReactionBar } from "./FeedReactionBar";
import { PostCardMenu, type PostCardMenuActions } from "./PostCardMenu";
import { PollBlock } from "./PollBlock";
import { KudosBlock } from "../../kudos/components/KudosBlock";
import { IdeaStatusPill } from "../../ideas/components/IdeaStatusPill";
import {
  authorDisplayName,
  avatarSrc,
  buildImageGrid,
  isFullyRenderableType,
  relativeTime,
} from "../lib/feed-format";

interface PostCardProps {
  post: FeedPostDto;
  /** Thẻ đang ở màn chi tiết ⇒ không gập thân, không hiện link "mở bài viết". */
  variant?: "feed" | "detail";
  onReactionChange: (emoji: FeedReactionEmojiDto | null) => void;
  /**
   * Bảng tổng hợp theo emoji — CHỈ có sau khi actor vừa thả (phản hồi 011/012). Trang giữ nó trong
   * cache của mình và truyền xuống; `undefined` là trạng thái BÌNH THƯỜNG lúc mới tải danh sách,
   * không phải thiếu dữ liệu. Xem docblock `FeedReactionBar`.
   */
  reactionSummary?: readonly FeedReactionSummaryDto[];
  onToggleSave: () => void;
  menuActions: PostCardMenuActions;
  isReactionPending?: boolean;
  isSavePending?: boolean;
  className?: string;
}

export function PostCard({
  post,
  variant = "feed",
  onReactionChange,
  reactionSummary,
  onToggleSave,
  menuActions,
  isReactionPending = false,
  isSavePending = false,
  className,
}: PostCardProps): React.ReactElement {
  const { t } = useTranslation("social");

  const name = authorDisplayName(post.author, t("post.unknownAuthor"));
  const grid = buildImageGrid(post.attachments);
  const renderBody = isFullyRenderableType(post.type);

  return (
    <article
      data-testid="post-card"
      data-post-type={post.type}
      className={cn("rounded-lg border border-border bg-card p-4", className)}
    >
      <header className="flex items-start gap-3">
        {/*
          `avatarUrl` = URL ký hoặc null — `Avatar` tự rơi về chữ cái đầu của `name`. `avatarSrc` CHỈ
          nhận URL presign: không chuỗi rỗng (`<img src="">` tải lại chính trang), không fileId thô hay
          URL http(s) ngoài của API chưa deploy (S16-SOCIAL-AVATARPRESIGN-1 D8 + FULL gate lượt 1).
        */}
        <Avatar name={name} src={avatarSrc(post.author.avatarUrl)} size="md" />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {/*
              Tên tác giả KHÔNG phải link: `feedAuthorSchema.employeeId` có thể `null` (người đã rời
              công ty) và một link tới `/feed/profiles/null` là link chết. Chỉ khi có id mới trỏ đi.
            */}
            {post.author.employeeId ? (
              <Link
                to="/feed/profiles/$employeeId"
                params={{ employeeId: post.author.employeeId }}
                className="rounded text-sm font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {name}
              </Link>
            ) : (
              <span className="text-sm font-medium text-foreground">{name}</span>
            )}

            {post.pinned && (
              <span
                data-testid="post-pinned-badge"
                className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-xs text-accent-foreground"
              >
                <Pin className="h-3 w-3" aria-hidden="true" />
                {t("post.pinned")}
              </span>
            )}

            {post.requiresAck && (
              <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                {t("post.requiresAck")}
              </span>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            {relativeTime(post.publishedAt)}
            {post.editedAt ? ` · ${t("post.edited")}` : ""}
          </p>
        </div>

        <PostCardMenu post={post} actions={menuActions} />
      </header>

      {/*
        Thân bài. `renderBody === false` (loại lạ) ⇒ bỏ hẳn khối này — xem R16 ở đầu file.
        `PostBody` cũng tự trả `null` khi `body` rỗng/NULL (poll không mô tả), nên hai lưới chồng
        nhau là CỐ Ý.
      */}
      {renderBody && (
        <PostBody body={post.body} collapsible={variant === "feed"} className="mt-3" />
      )}

      {/* `post.poll` vắng ⇒ `seed` undefined ⇒ khối tự tải `043` (xem docblock `PollBlock`). */}
      {post.type === "poll" && (
        <PollBlock postId={post.id} isMine={post.isMine} seed={post.poll} className="mt-3" />
      )}

      {/* S16-SOCIAL-FE-2C — khối vinh danh. Vắng `post.kudos` ⇒ không vẽ gì (C27). */}
      {post.type === "kudos" && post.kudos && <KudosBlock block={post.kudos} className="mt-3" />}

      {/*
        Sáng kiến: nhãn + link sang màn 008 (nơi ghi chú xét duyệt + người duyệt hiện đầy đủ — mặt nạ D19
        sống ở `045`). Pill trạng thái từ `post.idea.status` (BE-2D D6: không mask dưới `view:feed` ⇒
        KHÔNG gate). Pill là ANH EM của link, không lồng trong nó — lồng thì trạng thái thành một phần
        tên truy cập của link. Đọc `post.idea`, KHÔNG BAO GIỜ `post.status` (trường kiểm duyệt).
        Khối vắng ⇒ chỉ nhãn + link, không đoán trạng thái.
      */}
      {post.type === "idea" && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Link
            to="/feed/ideas"
            data-testid="post-idea-badge"
            className="inline-flex items-center gap-1.5 rounded-full bg-accent px-2.5 py-1 text-xs text-accent-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Lightbulb className="h-3.5 w-3.5" aria-hidden="true" />
            {t("idea.label")} · {t("idea.viewAll")}
          </Link>
          {post.idea && <IdeaStatusPill status={post.idea.status} />}
        </div>
      )}

      {grid.shown.length > 0 && (
        <div
          data-testid="post-image-grid"
          className={cn("mt-3 grid gap-1", grid.columns === 1 ? "grid-cols-1" : "grid-cols-2")}
        >
          {grid.shown.map((att, i) => (
            <div key={att.fileId} className="relative overflow-hidden rounded-md bg-muted">
              <img
                src={att.url ?? undefined}
                alt={t("post.imageAlt", { index: i + 1, total: grid.shown.length })}
                loading="lazy"
                className="h-full w-full object-cover"
              />
              {i === grid.shown.length - 1 && grid.overflow > 0 && (
                <span className="absolute inset-0 flex items-center justify-center bg-foreground/60 text-lg font-semibold text-background">
                  {t("post.moreImages", { count: grid.overflow })}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-border pt-3">
        <FeedReactionBar
          reactions={reactionSummary}
          likeCount={post.likeCount}
          myReaction={post.myReaction}
          onChange={onReactionChange}
          isPending={isReactionPending}
        />

        {/*
          Bình luận. Ở dòng cuộn đây là LINK sang màn chi tiết (SOC-SCREEN-002); ở chính màn chi tiết
          thì chỉ là con số — link tự trỏ về mình là một cái bẫy điều hướng.
        */}
        {variant === "feed" ? (
          <Link
            to="/feed/posts/$postId"
            params={{ postId: post.id }}
            className="flex items-center gap-1.5 rounded px-2 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <MessageSquare className="h-4 w-4" aria-hidden="true" />
            {t("post.commentCount", { count: post.commentCount })}
          </Link>
        ) : (
          <span className="flex items-center gap-1.5 px-2 py-1 text-sm text-muted-foreground">
            <MessageSquare className="h-4 w-4" aria-hidden="true" />
            {t("post.commentCount", { count: post.commentCount })}
          </span>
        )}

        {/*
          Lưu / bỏ lưu — gate `view:feed` (SPEC-16 §11.2: thao tác CÁ NHÂN, không có cặp riêng).
          Người vào được màn này đã có `view:feed` nên KHÔNG bọc `PermissionGate` ở đây: bọc bằng một
          cặp bịa ra sẽ ẩn nút với tất cả mọi người (ca C7 là lưới cho lỗi đó).
        */}
        <button
          type="button"
          onClick={onToggleSave}
          disabled={isSavePending}
          aria-pressed={post.savedByMe}
          data-testid="post-save-toggle"
          className={cn(
            "ml-auto flex items-center gap-1.5 rounded px-2 py-1 text-sm transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "disabled:cursor-not-allowed disabled:opacity-60",
            post.savedByMe
              ? "font-medium text-primary"
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          <Bookmark
            className={cn("h-4 w-4", post.savedByMe && "fill-current")}
            aria-hidden="true"
          />
          {post.savedByMe ? t("saved.unsave") : t("saved.save")}
        </button>
      </div>

      {post.commentsLocked && (
        <p className="mt-2 text-xs text-muted-foreground">{t("post.commentsLocked")}</p>
      )}
    </article>
  );
}
