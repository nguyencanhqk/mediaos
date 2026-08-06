import { nowSeconds } from "../db";
import { getManyMedia } from "../repo/media-repo";
import { getPage } from "../repo/page-repo";
import { claimForPublishing, getPost, updatePost } from "../repo/post-repo";
import { toFacebookScheduleTime } from "../schedule";
import type { MediaFile, Post, PostStatus } from "../types";
import { tryGetPermalink } from "./client";
import { publishFeedPost } from "./feed";
import { publishPhotoPost } from "./photos";
import { publishReel } from "./reels";
import { publishVideoPost } from "./videos";

/**
 * Diem vao duy nhat de dua mot bai len Facebook.
 * Ca thao tac tay tu giao dien lan worker noi bo deu goi ham nay,
 * nen quy tac khoa va xu ly loi chi ton tai o mot cho.
 *
 * Moi bai gan voi dung mot Page (cot `page_ref`) va dung Page Access Token
 * cua rieng Page do - khong con cau hinh Page toan cuc.
 */

export interface PublishResult {
  ok: boolean;
  post: Post;
  error?: string;
}

/** Trang thai duoc phep chuyen sang 'publishing'. */
const PUBLISHABLE_STATUSES: PostStatus[] = ["draft", "queued", "failed"];

function validate(post: Post, media: MediaFile[]): string | null {
  switch (post.type) {
    case "text":
      if (!post.message.trim() && !post.link) {
        return "Bài chữ phải có nội dung hoặc link.";
      }
      return null;
    case "photo":
      if (media.length === 0) return "Bài ảnh phải có ít nhất một ảnh.";
      if (media.some((m) => m.kind !== "image")) return "Bài ảnh chỉ được chứa file ảnh.";
      return null;
    case "video":
    case "reel":
      if (media.length === 0) return "Bài video/Reels phải có một file video.";
      if (media[0].kind !== "video") return "File đính kèm phải là video.";
      return null;
    default:
      return "Loại bài đăng không hợp lệ.";
  }
}

async function sendToFacebook(
  post: Post,
  media: MediaFile[],
  pageId: string,
  accessToken: string,
  scheduledPublishTime: number | null,
): Promise<string> {
  switch (post.type) {
    case "text":
      return publishFeedPost({
        pageId,
        accessToken,
        message: post.message,
        link: post.link,
        scheduledPublishTime,
      });
    case "photo":
      return publishPhotoPost({
        pageId,
        accessToken,
        message: post.message,
        media,
        scheduledPublishTime,
      });
    case "video":
      return publishVideoPost({
        pageId,
        accessToken,
        media: media[0],
        title: post.title,
        description: post.message,
        scheduledPublishTime,
      });
    case "reel":
      return publishReel({
        pageId,
        accessToken,
        media: media[0],
        title: post.title,
        description: post.message,
        scheduledPublishTime,
      });
    default:
      throw new Error(`Loại bài đăng không hỗ trợ: ${post.type as string}`);
  }
}

export async function publishPost(postId: number): Promise<PublishResult> {
  const existing = getPost(postId);
  if (!existing) throw new Error(`Không tìm thấy bài đăng #${postId}`);

  if (!claimForPublishing(postId, PUBLISHABLE_STATUSES)) {
    return {
      ok: false,
      post: existing,
      error: `Bài đang ở trạng thái "${existing.status}", không thể gửi lại.`,
    };
  }

  const post = getPost(postId) as Post;

  const fail = (message: string): PublishResult => {
    const updated = updatePost(postId, {
      status: "failed",
      error: message,
      attempts: post.attempts + 1,
    });
    return { ok: false, post: updated ?? post, error: message };
  };

  const page = getPage(post.pageRef);
  if (!page) {
    return fail(
      `Không tìm thấy Page "${post.pageName || post.pageRef}" trong danh sách đã kết nối. Vào trang Page để kết nối lại rồi thử lại.`,
    );
  }
  if (!page.isActive) {
    return fail(`Page "${page.name}" đang tắt. Bật lại ở trang Page rồi thử lại.`);
  }

  const media = getManyMedia(post.mediaIds);
  const validationError = validate(post, media);
  if (validationError) return fail(validationError);

  // Chi gui scheduled_publish_time khi Facebook la ben giu lich.
  // Voi bai do worker noi bo xu ly, den luc nay la dang ngay.
  const scheduledPublishTime =
    post.scheduleMode === "facebook" && post.scheduledAt
      ? toFacebookScheduleTime(post.scheduledAt, nowSeconds())
      : null;

  try {
    const fbPostId = await sendToFacebook(
      post,
      media,
      page.pageId,
      page.accessToken,
      scheduledPublishTime,
    );

    const permalink = await tryGetPermalink(fbPostId, page.accessToken);
    const updated = updatePost(postId, {
      status: scheduledPublishTime ? "scheduled" : "published",
      fbPostId,
      fbPermalink: permalink,
      error: null,
      attempts: post.attempts + 1,
    });

    return { ok: true, post: updated ?? post };
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}
