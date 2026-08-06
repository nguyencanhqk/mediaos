import { NextRequest } from "next/server";
import { fail, guard, ok } from "@/lib/api";
import { publishPost } from "@/lib/fb/publish";
import { getPost, updatePost } from "@/lib/repo/post-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Dang ngay / thu lai mot bai.
 * Dung cho nut "Thử lại" khi bai loi va nut "Đăng ngay" voi bai trong hang doi.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const { id } = await context.params;
    const postId = Number(id);
    const post = getPost(postId);
    if (!post) return fail("Không tìm thấy bài đăng.", 404);

    const publishNow = request.nextUrl.searchParams.get("now") === "1";

    // "Đăng ngay" thi bo lich cu de publishPost khong gui scheduled_publish_time.
    if (publishNow) {
      updatePost(postId, { scheduledAt: null, scheduleMode: "now" });
    }

    // Cho phep gui lai bai da huy.
    if (post.status === "cancelled") {
      updatePost(postId, { status: "draft" });
    }

    const result = await publishPost(postId);
    return result.ok ? ok(result.post) : fail(result.error ?? "Đăng bài thất bại.", 422);
  });
}
