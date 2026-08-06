import fs from "node:fs";
import { resolveUploadPath } from "../paths";
import type { MediaFile } from "../types";
import { graphPostForm } from "./client";
import { publishFeedPost } from "./feed";

/**
 * Anh co hai luong khac nhau:
 * - Mot anh: POST thang len /{page-id}/photos kem caption.
 * - Nhieu anh: upload tung anh voi published=false de lay media_fbid,
 *   sau do gom lai thanh mot bai /{page-id}/feed qua attached_media.
 */

function fileToBlob(media: MediaFile): Blob {
  const buffer = fs.readFileSync(resolveUploadPath(media.filename));
  return new Blob([new Uint8Array(buffer)], { type: media.mime });
}

/** Upload mot anh o che do khong hien thi, tra ve media_fbid. */
async function uploadUnpublishedPhoto(
  pageId: string,
  accessToken: string,
  media: MediaFile,
): Promise<string> {
  const form = new FormData();
  form.set("access_token", accessToken);
  form.set("published", "false");
  form.set("source", fileToBlob(media), media.originalName);

  const result = await graphPostForm<{ id: string }>(`${pageId}/photos`, form);
  return result.id;
}

export interface PhotoPostParams {
  pageId: string;
  accessToken: string;
  message: string;
  media: MediaFile[];
  scheduledPublishTime?: number | null;
}

export async function publishPhotoPost(params: PhotoPostParams): Promise<string> {
  if (params.media.length === 0) {
    throw new Error("Bài ảnh phải có ít nhất một ảnh.");
  }

  if (params.media.length === 1) {
    const form = new FormData();
    form.set("access_token", params.accessToken);
    form.set("source", fileToBlob(params.media[0]), params.media[0].originalName);
    if (params.message) form.set("message", params.message);

    if (params.scheduledPublishTime) {
      form.set("published", "false");
      form.set("scheduled_publish_time", String(params.scheduledPublishTime));
    } else {
      form.set("published", "true");
    }

    const result = await graphPostForm<{ id: string; post_id?: string }>(
      `${params.pageId}/photos`,
      form,
    );
    return result.post_id ?? result.id;
  }

  // Album: upload tuan tu de tranh bi Facebook chan vi goi qua nhanh.
  const mediaFbids: string[] = [];
  for (const media of params.media) {
    mediaFbids.push(await uploadUnpublishedPhoto(params.pageId, params.accessToken, media));
  }

  return publishFeedPost({
    pageId: params.pageId,
    accessToken: params.accessToken,
    message: params.message,
    attachedMediaIds: mediaFbids,
    scheduledPublishTime: params.scheduledPublishTime,
  });
}
