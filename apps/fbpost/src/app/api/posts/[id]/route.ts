import { NextRequest } from "next/server";
import { fail, guard, ok } from "@/lib/api";
import { deletePost, getPost, updatePost } from "@/lib/repo/post-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const { id } = await context.params;
    const post = getPost(Number(id));
    return post ? ok(post) : fail("Không tìm thấy bài đăng.", 404);
  });
}

/**
 * Xoa bai khoi phan mem.
 *
 * Luu y: bai da o trang thai 'scheduled' dang nam tren Facebook. Xoa o day
 * chi go khoi danh sach cua phan mem, KHONG huy lich tren Facebook - viec do
 * phai lam trong Meta Business Suite.
 */
export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const { id } = await context.params;
    const postId = Number(id);
    const post = getPost(postId);
    if (!post) return fail("Không tìm thấy bài đăng.", 404);

    if (post.status === "publishing") {
      return fail("Bài đang được gửi lên Facebook, chờ xử lý xong rồi thử lại.");
    }

    deletePost(postId);
    return ok({
      id: postId,
      warnedFacebookStillScheduled: post.status === "scheduled",
    });
  });
}

/** Huy bai trong hang doi noi bo (khong ap dung cho bai da len Facebook). */
export async function PATCH(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const { id } = await context.params;
    const postId = Number(id);
    const post = getPost(postId);
    if (!post) return fail("Không tìm thấy bài đăng.", 404);

    if (post.status !== "queued" && post.status !== "draft" && post.status !== "failed") {
      return fail(`Không thể huỷ bài đang ở trạng thái "${post.status}".`);
    }

    const updated = updatePost(postId, { status: "cancelled", error: null });
    return ok(updated);
  });
}
