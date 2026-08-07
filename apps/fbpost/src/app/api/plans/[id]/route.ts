import { NextRequest } from "next/server";
import { fail, guard, ok } from "@/lib/api";
import { deletePlan, getPlan, planStatusCounts } from "@/lib/repo/plan-repo";
import { cancelPendingPostsOfPlan, listPosts } from "@/lib/repo/post-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const { id } = await context.params;
    const plan = getPlan(Number(id));
    if (!plan) return fail("Không tìm thấy kế hoạch.", 404);

    return ok({
      plan,
      statusCounts: planStatusCounts(plan.id),
      posts: listPosts({ planId: plan.id }),
    });
  });
}

/**
 * Huy ke hoach: cac bai chua gui di chuyen sang 'Đã huỷ'.
 *
 * Bai da nam tren Facebook (trang thai 'Đã hẹn trên Facebook') KHONG bi go -
 * viec do phai lam trong Meta Business Suite, nen so luong do duoc bao lai
 * cho nguoi dung biet.
 */
export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const { id } = await context.params;
    const planId = Number(id);
    const plan = getPlan(planId);
    if (!plan) return fail("Không tìm thấy kế hoạch.", 404);

    const counts = planStatusCounts(planId);
    const cancelled = cancelPendingPostsOfPlan(planId);
    deletePlan(planId);

    return ok({
      id: planId,
      cancelled,
      stillOnFacebook: counts.scheduled ?? 0,
    });
  });
}
