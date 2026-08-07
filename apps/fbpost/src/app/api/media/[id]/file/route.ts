import fs from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { resolveUploadPath } from "@/lib/paths";
import { getMedia } from "@/lib/repo/media-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Phuc vu file media da upload de giao dien xem truoc. */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const media = getMedia(Number(id));
  if (!media) {
    return new NextResponse("Không tìm thấy file", { status: 404 });
  }

  const filePath = resolveUploadPath(media.filename);
  if (!fs.existsSync(filePath)) {
    return new NextResponse("File đã bị xoá khỏi ổ đĩa", { status: 404 });
  }

  const buffer = fs.readFileSync(filePath);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": media.mime,
      "Content-Length": String(buffer.length),
      "Cache-Control": "private, max-age=3600",
    },
  });
}
