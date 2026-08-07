import fs from "node:fs";
import { resolveUploadPath } from "../paths";
import type { MediaFile } from "../types";
import { FacebookApiError, getGraphVersion, graphPost } from "./client";

/**
 * Reels dung endpoint rieng /{page-id}/video_reels voi 3 buoc:
 * start -> upload nhi phan len rupload.facebook.com -> finish.
 *
 * Khac voi video thuong, buoc finish nhan `video_state` (PUBLISHED /
 * SCHEDULED / DRAFT) thay vi tham so `published`.
 */

interface ReelStartResponse {
  video_id: string;
  upload_url: string;
}

export interface ReelPostParams {
  pageId: string;
  accessToken: string;
  media: MediaFile;
  description: string;
  title?: string | null;
  scheduledPublishTime?: number | null;
}

export async function publishReel(params: ReelPostParams): Promise<string> {
  const filePath = resolveUploadPath(params.media.filename);
  const fileSize = fs.statSync(filePath).size;

  // Buoc 1: xin video_id va dia chi upload.
  const start = await graphPost<ReelStartResponse>(`${params.pageId}/video_reels`, {
    access_token: params.accessToken,
    upload_phase: "start",
  });

  // Buoc 2: day toan bo file len rupload trong mot request.
  // Reels toi da 90 giay nen kich thuoc file luon o muc chap nhan duoc.
  const uploadUrl =
    start.upload_url ||
    `https://rupload.facebook.com/video-upload/${getGraphVersion()}/${start.video_id}`;

  const fileBuffer = fs.readFileSync(filePath);
  const uploadResponse = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `OAuth ${params.accessToken}`,
      offset: "0",
      file_size: String(fileSize),
      "Content-Type": "application/octet-stream",
    },
    body: new Uint8Array(fileBuffer),
  });

  if (!uploadResponse.ok) {
    const text = await uploadResponse.text();
    let payload: { error?: { message?: string; code?: number } } = {};
    try {
      payload = JSON.parse(text) as typeof payload;
    } catch {
      payload = { error: { message: text.slice(0, 300) } };
    }
    throw new FacebookApiError(payload.error ?? {}, uploadResponse.status);
  }

  // Buoc 3: chot va chon trang thai xuat ban.
  const finishParams: Record<string, string | number | boolean> = {
    access_token: params.accessToken,
    upload_phase: "finish",
    video_id: start.video_id,
    description: params.description,
  };
  if (params.title) finishParams.title = params.title;

  if (params.scheduledPublishTime) {
    finishParams.video_state = "SCHEDULED";
    finishParams.scheduled_publish_time = params.scheduledPublishTime;
  } else {
    finishParams.video_state = "PUBLISHED";
  }

  await graphPost<{ success: boolean }>(`${params.pageId}/video_reels`, finishParams);

  return start.video_id;
}
