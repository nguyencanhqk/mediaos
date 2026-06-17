import { z } from "zod";
import { contentItemSchema } from "@mediaos/contracts";
import { apiFetch } from "@mediaos/web-core";

/**
 * Content items — thin client cho danh sách/tạo content theo project (dùng trong ProjectDetail tab).
 * Content ERD-full (publish targets / assets / types) ở `content-api.ts` (G6-4). Channels → channels-api,
 * projects → projects-api.
 */
export const mediaApi = {
  listContent: (projectId: string) =>
    apiFetch(`/content?projectId=${encodeURIComponent(projectId)}`, z.array(contentItemSchema)),
  createContent: (projectId: string, data: { title: string; contentTypeId?: string }) =>
    apiFetch(`/content`, contentItemSchema, {
      method: "POST",
      body: JSON.stringify({ ...data, projectId }),
    }),
};
