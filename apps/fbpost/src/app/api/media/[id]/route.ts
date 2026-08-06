import { NextRequest } from "next/server";
import { fail, guard, ok } from "@/lib/api";
import { deleteMedia, getMedia } from "@/lib/repo/media-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const { id } = await context.params;
    const media = getMedia(Number(id));
    return media ? ok(media) : fail("Không tìm thấy file.", 404);
  });
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const { id } = await context.params;
    const mediaId = Number(id);
    if (!Number.isInteger(mediaId)) return fail("ID không hợp lệ.");
    if (!getMedia(mediaId)) return fail("Không tìm thấy file.", 404);

    deleteMedia(mediaId);
    return ok({ id: mediaId });
  });
}
