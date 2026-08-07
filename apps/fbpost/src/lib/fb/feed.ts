import { graphPost } from "./client";

/** Dang bai chu / link, hoac bai gom nhieu anh da upload san. */

export interface FeedPostParams {
  pageId: string;
  accessToken: string;
  message: string;
  link?: string | null;
  /** Danh sach media_fbid cua cac anh da upload voi published=false. */
  attachedMediaIds?: string[];
  /** Unix seconds. Bo trong de dang ngay. */
  scheduledPublishTime?: number | null;
}

export async function publishFeedPost(params: FeedPostParams): Promise<string> {
  const body: Record<string, string | number | boolean> = {
    access_token: params.accessToken,
  };

  if (params.message) body.message = params.message;
  if (params.link) body.link = params.link;

  params.attachedMediaIds?.forEach((mediaFbid, index) => {
    body[`attached_media[${index}]`] = JSON.stringify({ media_fbid: mediaFbid });
  });

  if (params.scheduledPublishTime) {
    body.published = false;
    body.scheduled_publish_time = params.scheduledPublishTime;
  } else {
    body.published = true;
  }

  const result = await graphPost<{ id: string }>(`${params.pageId}/feed`, body);
  return result.id;
}
