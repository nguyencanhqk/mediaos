import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, guard, ok } from "@/lib/api";
import { nowSeconds } from "@/lib/db";
import { resolveMediaIds } from "@/lib/import/map-rows";
import { createContent } from "@/lib/repo/content-repo";
import { listPages } from "@/lib/repo/page-repo";
import { createPost } from "@/lib/repo/post-repo";
import { decideScheduleMode } from "@/lib/schedule";
import type { PageAccountWithToken } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const rowSchema = z.object({
  rowNumber: z.number().int(),
  type: z.enum(["text", "photo", "video", "reel"]),
  message: z.string().default(""),
  link: z.string().nullable().default(null),
  title: z.string().nullable().default(null),
  mediaPaths: z.array(z.string()).default([]),
  scheduledAt: z.number().int().positive().nullable().default(null),
  /** Ten/ID Page ghi trong cot `page` cua file. */
  pageNames: z.array(z.string()).default([]),
});

const schema = z.object({
  rows: z.array(rowSchema).min(1, "Không có dòng nào để nhập"),
  /**
   * - library: chi nap vao thu vien noi dung, chua xep lich
   * - schedule: tao luon lich dang len cac Page
   */
  mode: z.enum(["library", "schedule"]).default("schedule"),
  /** Page mac dinh cho nhung dong khong ghi cot `page`. */
  pageRefs: z.array(z.number().int()).default([]),
  /** O che do schedule, luu them mot ban vao thu vien de dung lai sau. */
  saveToLibrary: z.boolean().default(false),
});

export interface ImportRowResult {
  rowNumber: number;
  postIds: number[];
  contentId: number | null;
  pageNames: string[];
  error: string | null;
}

/** Tim Page theo ten (khong phan biet hoa thuong) hoac theo ID tren Facebook. */
function resolvePages(
  names: string[],
  fallback: PageAccountWithToken[],
  all: PageAccountWithToken[],
): { pages: PageAccountWithToken[]; missing: string[] } {
  if (names.length === 0) return { pages: fallback, missing: [] };

  const byName = new Map(all.map((page) => [page.name.trim().toLowerCase(), page]));
  const byId = new Map(all.map((page) => [page.pageId, page]));

  const pages: PageAccountWithToken[] = [];
  const missing: string[] = [];

  for (const name of names) {
    const found = byName.get(name.trim().toLowerCase()) ?? byId.get(name.trim());
    if (found) pages.push(found);
    else missing.push(name);
  }

  return { pages, missing };
}

export async function POST(request: NextRequest) {
  return guard(async () => {
    const body: unknown = await request.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return fail(parsed.error.issues.map((i) => i.message).join("; "));
    }

    const { rows, mode, pageRefs, saveToLibrary } = parsed.data;
    const allPages = listPages();
    const usablePages = allPages.filter((page) => page.isActive && page.canPost);
    const fallbackPages = usablePages.filter((page) => pageRefs.includes(page.id));

    if (
      mode === "schedule" &&
      fallbackPages.length === 0 &&
      rows.every((r) => r.pageNames.length === 0)
    ) {
      return fail('Chưa chọn Page nào để đăng. Chọn Page ở trên hoặc thêm cột "page" vào file.');
    }

    const results: ImportRowResult[] = [];
    const now = nowSeconds();

    // Xu ly tuan tu: sao chep media va ghi CSDL tung dong mot cho de doc log
    // khi co dong loi, va de khong nap hang tram file cung luc vao bo nho.
    for (const row of rows) {
      try {
        const mediaIds = resolveMediaIds(row.mediaPaths);

        const contentId =
          mode === "library" || saveToLibrary
            ? createContent({
                type: row.type,
                message: row.message,
                link: row.link,
                title: row.title,
                mediaIds,
              }).id
            : null;

        if (mode === "library") {
          results.push({
            rowNumber: row.rowNumber,
            postIds: [],
            contentId,
            pageNames: [],
            error: null,
          });
          continue;
        }

        const { pages, missing } = resolvePages(row.pageNames, fallbackPages, usablePages);
        if (missing.length > 0) {
          results.push({
            rowNumber: row.rowNumber,
            postIds: [],
            contentId,
            pageNames: [],
            error: `Không tìm thấy Page: ${missing.join(", ")}. Kiểm tra lại tên ở cột "page" hoặc kết nối Page đó trước.`,
          });
          continue;
        }
        if (pages.length === 0) {
          results.push({
            rowNumber: row.rowNumber,
            postIds: [],
            contentId,
            pageNames: [],
            error: "Dòng này không có Page nào để đăng.",
          });
          continue;
        }

        const decision = decideScheduleMode(row.scheduledAt, row.type, now);
        const batchId = `import-${Date.now()}-${row.rowNumber}`;

        const postIds = pages.map(
          (page) =>
            createPost(
              {
                pageRef: page.id,
                pageName: page.name,
                contentId,
                batchId: pages.length > 1 ? batchId : null,
                type: row.type,
                message: row.message,
                link: row.link,
                title: row.title,
                mediaIds,
                scheduledAt: row.scheduledAt,
                scheduleMode: decision.mode,
              },
              "queued",
            ).id,
        );

        results.push({
          rowNumber: row.rowNumber,
          postIds,
          contentId,
          pageNames: pages.map((page) => page.name),
          error: null,
        });
      } catch (error) {
        results.push({
          rowNumber: row.rowNumber,
          postIds: [],
          contentId: null,
          pageNames: [],
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return ok({
      mode,
      total: results.length,
      okCount: results.filter((r) => !r.error).length,
      postCount: results.reduce((sum, r) => sum + r.postIds.length, 0),
      results,
    });
  });
}
