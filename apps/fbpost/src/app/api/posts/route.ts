import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, guard, ok } from "@/lib/api";
import { nowSeconds } from "@/lib/db";
import { publishPost } from "@/lib/fb/publish";
import { createContent } from "@/lib/repo/content-repo";
import { getManyPages } from "@/lib/repo/page-repo";
import { createPost, listPosts } from "@/lib/repo/post-repo";
import { decideScheduleMode } from "@/lib/schedule";
import type { Post, PostStatus } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * So Page toi da con goi Graph API ngay trong request.
 * Chon nhieu hon thi bai vao hang doi va worker day dan - tranh de nguoi dung
 * ngoi cho hang chuc lan upload video trong mot request duy nhat.
 */
const INLINE_PUBLISH_LIMIT = 3;

const createSchema = z
  .object({
    /** Cac Page se nhan bai. Moi Page tao ra mot bai rieng. */
    pageRefs: z.array(z.number().int()).min(1, "Chưa chọn Page nào để đăng."),
    type: z.enum(["text", "photo", "video", "reel"]),
    message: z.string().default(""),
    link: z.string().trim().url("Link không hợp lệ").or(z.literal("")).nullish(),
    title: z.string().trim().nullish(),
    mediaIds: z.array(z.number().int()).default([]),
    /** Unix seconds. Bo trong de dang ngay. */
    scheduledAt: z.number().int().positive().nullish(),
    /** Luu them mot ban vao thu vien noi dung de dung lai sau. */
    saveToLibrary: z.boolean().default(false),
    label: z.string().trim().max(120, "Nhãn quá dài").nullish(),
  })
  // Chan bai rong ngay tu day de khong ghi rac vao CSDL.
  .refine((input) => input.type !== "text" || input.message.trim() !== "" || Boolean(input.link), {
    message: "Bài chữ phải có nội dung hoặc link.",
  })
  .refine((input) => input.type === "text" || input.mediaIds.length > 0, {
    message: "Bài ảnh/video/Reels phải có file đính kèm.",
  })
  .refine((input) => !["video", "reel"].includes(input.type) || input.mediaIds.length === 1, {
    message: "Bài video/Reels chỉ nhận đúng một file.",
  });

export async function GET(request: NextRequest) {
  return guard(async () => {
    const params = request.nextUrl.searchParams;
    const statusParam = params.get("status");
    const pageParam = params.get("pageRef");
    const planParam = params.get("planId");

    return ok(
      listPosts({
        status: statusParam ? (statusParam as PostStatus) : undefined,
        pageRef: pageParam ? Number(pageParam) : undefined,
        planId: planParam ? Number(planParam) : undefined,
      }),
    );
  });
}

export interface CreatePostTargetResult {
  pageRef: number;
  pageName: string;
  postId: number;
  status: PostStatus;
  error: string | null;
}

export async function POST(request: NextRequest) {
  return guard(async () => {
    const body: unknown = await request.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      // Loi tu .refine() khong gan voi truong nao nen bo tien to duong dan.
      return fail(
        parsed.error.issues
          .map((i) => (i.path.length > 0 ? `${i.path.join(".")}: ${i.message}` : i.message))
          .join("; "),
      );
    }

    const input = parsed.data;
    const pages = getManyPages(input.pageRefs).filter((page) => page.isActive && page.canPost);
    if (pages.length === 0) {
      return fail("Không có Page hợp lệ nào trong danh sách đã chọn. Kiểm tra lại ở trang Page.");
    }

    const scheduledAt = input.scheduledAt ?? null;
    const decision = decideScheduleMode(scheduledAt, input.type, nowSeconds());
    const publishInline = decision.mode !== "local" && pages.length <= INLINE_PUBLISH_LIMIT;

    const contentId = input.saveToLibrary
      ? createContent({
          label: input.label || null,
          type: input.type,
          message: input.message,
          link: input.link || null,
          title: input.title || null,
          mediaIds: input.mediaIds,
        }).id
      : null;

    const batchId = `compose-${Date.now()}`;
    const results: CreatePostTargetResult[] = [];
    const posts: Post[] = [];

    for (const page of pages) {
      const post = createPost(
        {
          pageRef: page.id,
          pageName: page.name,
          contentId,
          batchId: pages.length > 1 ? batchId : null,
          type: input.type,
          message: input.message,
          link: input.link || null,
          title: input.title || null,
          mediaIds: input.mediaIds,
          scheduledAt,
          scheduleMode: decision.mode,
        },
        // Bai gui di ngay thi de 'draft' roi publish luon; con lai vao hang doi
        // cho worker xu ly (bai hen xa, hoac lo nhieu Page).
        publishInline ? "draft" : "queued",
      );

      if (!publishInline) {
        posts.push(post);
        results.push({
          pageRef: page.id,
          pageName: page.name,
          postId: post.id,
          status: post.status,
          error: null,
        });
        continue;
      }

      const result = await publishPost(post.id);
      posts.push(result.post);
      results.push({
        pageRef: page.id,
        pageName: page.name,
        postId: post.id,
        status: result.post.status,
        error: result.error ?? null,
      });
    }

    return ok(
      {
        posts,
        results,
        decision,
        contentId,
        queued: !publishInline,
        okCount: results.filter((r) => !r.error).length,
      },
      201,
    );
  });
}
