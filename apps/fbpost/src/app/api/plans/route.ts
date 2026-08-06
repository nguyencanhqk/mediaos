import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, guard, ok } from "@/lib/api";
import { planConfigSchema, resolvePlan } from "@/lib/plan/service";
import { createPlan, listPlans, planStatusCounts } from "@/lib/repo/plan-repo";
import { createPost } from "@/lib/repo/post-repo";
import type { Content } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const commitSchema = z.object({
  name: z.string().trim().min(1, "Đặt tên cho kế hoạch").max(120, "Tên kế hoạch quá dài"),
  config: planConfigSchema,
});

export async function GET() {
  return guard(async () =>
    ok(
      listPlans().map((plan) => ({
        ...plan,
        statusCounts: planStatusCounts(plan.id),
      })),
    ),
  );
}

/**
 * Tao lich that tu cau hinh da xem truoc.
 *
 * Bai duoc ghi thang vao hang doi voi trang thai 'queued', khong goi Graph API
 * ngay trong request nay: mot ke hoach co the sinh ra hang tram bai, goi het
 * mot luc se qua thoi gian cho va cham gioi han tan suat cua Facebook.
 * Worker noi bo se day dan tung dot len Facebook.
 */
export async function POST(request: NextRequest) {
  return guard(async () => {
    const body: unknown = await request.json();
    const parsed = commitSchema.safeParse(body);
    if (!parsed.success) {
      return fail(parsed.error.issues.map((i) => i.message).join("; "));
    }

    const { name, config } = parsed.data;
    const resolved = resolvePlan(config);
    if (resolved.error) return fail(resolved.error);
    if (resolved.preview.total === 0) return fail("Không có bài nào để tạo lịch.");

    const contentById = new Map<number, Content>(resolved.contents.map((c) => [c.id, c]));
    const plan = createPlan(name, config, resolved.preview.total);
    const batchId = `plan-${plan.id}`;

    let created = 0;
    for (const planned of resolved.preview.posts) {
      const content = contentById.get(planned.contentId);
      if (!content) continue;

      createPost(
        {
          pageRef: planned.pageRef,
          pageName: planned.pageName,
          contentId: content.id,
          planId: plan.id,
          batchId,
          type: content.type,
          message: content.message,
          link: content.link,
          title: content.title,
          mediaIds: content.mediaIds,
          scheduledAt: planned.scheduledAt,
          scheduleMode: planned.scheduleMode,
        },
        "queued",
      );
      created += 1;
    }

    return ok(
      {
        plan,
        created,
        facebookCount: resolved.preview.facebookCount,
        localCount: resolved.preview.localCount,
        firstAt: resolved.preview.firstAt,
        lastAt: resolved.preview.lastAt,
        warnings: resolved.preview.warnings,
      },
      201,
    );
  });
}
