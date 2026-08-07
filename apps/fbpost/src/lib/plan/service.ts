import { z } from "zod";
import { nowSeconds } from "../db";
import { contentLabel, getManyContents } from "../repo/content-repo";
import { getManyPages } from "../repo/page-repo";
import type { Content, PageAccountWithToken, PlanConfig, PlanPreview } from "../types";
import { generatePlan, parseSlot } from "./generate";

/**
 * Lop trung gian giua API va bo sinh lich: kiem tra cau hinh, nap noi dung
 * va Page tu CSDL roi goi `generatePlan`. Ca duong xem truoc lan duong tao
 * lich that deu di qua day nen hai ket qua luon khop nhau.
 */

export const planConfigSchema = z.object({
  contentIds: z.array(z.number().int()).min(1, "Chưa chọn nội dung nào"),
  pageRefs: z.array(z.number().int()).min(1, "Chưa chọn Page nào"),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày bắt đầu phải có dạng 2026-08-10"),
  slots: z
    .array(z.string())
    .min(1, "Cần ít nhất một khung giờ")
    .refine((slots) => slots.every((slot) => parseSlot(slot) !== null), {
      message: "Khung giờ phải có dạng 08:00",
    }),
  weekdays: z.array(z.number().int().min(0).max(6)).min(1, "Chọn ít nhất một thứ trong tuần"),
  distribution: z.enum(["broadcast", "rotate"]),
  contentOrder: z.enum(["sequential", "shuffle"]),
  pageStaggerMinutes: z.number().int().min(0).max(720),
  repeatContents: z.boolean(),
  maxPosts: z.number().int().min(1).max(1000),
  seed: z.number().int(),
});

export interface ResolvedPlan {
  preview: PlanPreview;
  contents: Content[];
  pages: PageAccountWithToken[];
  /** Ly do khong the tao lich. null nghia la hop le. */
  error: string | null;
}

export function resolvePlan(config: PlanConfig): ResolvedPlan {
  const contents = getManyContents(config.contentIds);
  const requestedPages = getManyPages(config.pageRefs);

  // Giu dung thu tu nguoi dung da chon - thu tu nay quyet dinh Page nao
  // nhan bai truoc o che do xoay vong va do lech gio giua cac Page.
  const byId = new Map(requestedPages.map((page) => [page.id, page]));
  const pages = config.pageRefs
    .map((id) => byId.get(id))
    .filter((page): page is PageAccountWithToken => Boolean(page));

  const usablePages = pages.filter((page) => page.isActive && page.canPost);
  const warnings: string[] = [];

  if (contents.length < config.contentIds.length) {
    warnings.push("Một số nội dung đã chọn không còn trong thư viện và bị bỏ qua.");
  }
  const skippedPages = pages.filter((page) => !page.isActive || !page.canPost);
  if (skippedPages.length > 0) {
    warnings.push(
      `Bỏ qua ${skippedPages.length} Page đang tắt hoặc không có quyền đăng bài: ${skippedPages
        .map((page) => page.name)
        .join(", ")}.`,
    );
  }

  if (contents.length === 0) {
    return {
      preview: emptyPreview(warnings),
      contents,
      pages,
      error: "Không còn nội dung hợp lệ nào để xếp lịch.",
    };
  }
  if (usablePages.length === 0) {
    return {
      preview: emptyPreview(warnings),
      contents,
      pages,
      error: "Không còn Page hợp lệ nào để đăng.",
    };
  }

  const preview = generatePlan({
    contents: contents.map((content) => ({
      id: content.id,
      label: contentLabel(content),
      type: content.type,
    })),
    pages: usablePages.map((page) => ({ id: page.id, name: page.name })),
    config,
    now: nowSeconds(),
  });

  return {
    preview: { ...preview, warnings: [...warnings, ...preview.warnings] },
    contents,
    pages: usablePages,
    error:
      preview.total === 0
        ? "Không xếp được bài nào. Kiểm tra lại ngày bắt đầu và khung giờ."
        : null,
  };
}

function emptyPreview(warnings: string[]): PlanPreview {
  return {
    posts: [],
    total: 0,
    perPage: [],
    firstAt: null,
    lastAt: null,
    facebookCount: 0,
    localCount: 0,
    warnings,
    truncated: false,
  };
}
