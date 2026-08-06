import fs from "node:fs";
import { resolveUploadPath } from "../paths";
import type { MediaFile } from "../types";
import { graphPost, graphPostForm } from "./client";
import { VIDEO_CHUNK_SIZE } from "./constants";

/**
 * Video dung chunked upload (start / transfer / finish) tren graph-video.facebook.com.
 * Chia nho file giup tranh timeout va cho phep upload video lon ma khong
 * phai nap toan bo file vao bo nho.
 */

interface StartResponse {
  video_id: string;
  upload_session_id: string;
  start_offset: string;
  end_offset: string;
}

interface TransferResponse {
  start_offset: string;
  end_offset: string;
}

export interface VideoPostParams {
  pageId: string;
  accessToken: string;
  media: MediaFile;
  title?: string | null;
  description: string;
  scheduledPublishTime?: number | null;
}

export async function publishVideoPost(params: VideoPostParams): Promise<string> {
  const filePath = resolveUploadPath(params.media.filename);
  const fileSize = fs.statSync(filePath).size;

  // Buoc 1: khoi tao phien upload.
  const start = await graphPost<StartResponse>(
    `${params.pageId}/videos`,
    {
      access_token: params.accessToken,
      upload_phase: "start",
      file_size: fileSize,
    },
    { videoHost: true },
  );

  // Buoc 2: truyen tung chunk theo offset Facebook yeu cau.
  const handle = fs.openSync(filePath, "r");
  try {
    let startOffset = Number(start.start_offset);
    let endOffset = Number(start.end_offset);

    while (startOffset < endOffset) {
      const length = Math.min(endOffset - startOffset, VIDEO_CHUNK_SIZE);
      const buffer = Buffer.alloc(length);
      fs.readSync(handle, buffer, 0, length, startOffset);

      const form = new FormData();
      form.set("access_token", params.accessToken);
      form.set("upload_phase", "transfer");
      form.set("upload_session_id", start.upload_session_id);
      form.set("start_offset", String(startOffset));
      form.set(
        "video_file_chunk",
        new Blob([new Uint8Array(buffer)], { type: "application/octet-stream" }),
        "chunk",
      );

      const transfer = await graphPostForm<TransferResponse>(`${params.pageId}/videos`, form, {
        videoHost: true,
      });

      const nextStart = Number(transfer.start_offset);
      // Facebook bao offset tiep theo; neu khong tien them thi dung de tranh lap vo han.
      if (nextStart <= startOffset) break;
      startOffset = nextStart;
      endOffset = Number(transfer.end_offset);
    }
  } finally {
    fs.closeSync(handle);
  }

  // Buoc 3: chot phien va dat che do dang / hen gio.
  const finishParams: Record<string, string | number | boolean> = {
    access_token: params.accessToken,
    upload_phase: "finish",
    upload_session_id: start.upload_session_id,
    description: params.description,
  };
  if (params.title) finishParams.title = params.title;

  if (params.scheduledPublishTime) {
    finishParams.published = false;
    finishParams.scheduled_publish_time = params.scheduledPublishTime;
  } else {
    finishParams.published = true;
  }

  await graphPost<{ success: boolean }>(`${params.pageId}/videos`, finishParams, {
    videoHost: true,
  });

  return start.video_id;
}
