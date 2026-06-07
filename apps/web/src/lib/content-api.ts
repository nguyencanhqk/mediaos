import { z } from "zod";
import type {
  AddContentChannelRequest,
  CreateContentAssetRequest,
  CreateContentAssetVersionRequest,
  CreateContentItemRequest,
  CreateContentTypeRequest,
  UpdateContentChannelRequest,
  UpdateContentItemRequest,
} from "@mediaos/contracts";
import {
  contentAssetSchema,
  contentChannelSchema,
  contentItemSchema,
  contentTypeSchema,
  suggestWorkflowSchema,
} from "@mediaos/contracts";
import { apiFetch } from "./api-client";

/** Filter list content (CNT-001) — gửi sang `GET /content` dưới dạng query param. */
export interface ContentFilters {
  projectId?: string;
  status?: string;
  productionStatus?: string;
  contentTypeId?: string;
  mainChannelId?: string;
  q?: string;
}

function buildContentQuery(filters: ContentFilters = {}): string {
  const qs = new URLSearchParams();
  if (filters.projectId) qs.set("projectId", filters.projectId);
  if (filters.status) qs.set("status", filters.status);
  if (filters.productionStatus) qs.set("productionStatus", filters.productionStatus);
  if (filters.contentTypeId) qs.set("contentTypeId", filters.contentTypeId);
  if (filters.mainChannelId) qs.set("mainChannelId", filters.mainChannelId);
  if (filters.q) qs.set("q", filters.q);
  const suffix = qs.toString();
  return suffix ? `?${suffix}` : "";
}

export const contentApi = {
  // ── Content items ───────────────────────────────────────────────────────────
  listContent: (filters?: ContentFilters) =>
    apiFetch(`/content${buildContentQuery(filters)}`, z.array(contentItemSchema)),

  getContent: (id: string) => apiFetch(`/content/${id}`, contentItemSchema),

  createContent: (data: CreateContentItemRequest) =>
    apiFetch("/content", contentItemSchema, { method: "POST", body: JSON.stringify(data) }),

  updateContent: (id: string, data: UpdateContentItemRequest) =>
    apiFetch(`/content/${id}`, contentItemSchema, { method: "PATCH", body: JSON.stringify(data) }),

  deleteContent: (id: string) => apiFetch(`/content/${id}`, z.void(), { method: "DELETE" }),

  suggestWorkflow: (id: string) =>
    apiFetch(`/content/${id}/suggest-workflow`, suggestWorkflowSchema),

  // ── Content types (catalog) ─────────────────────────────────────────────────
  listContentTypes: () => apiFetch("/content-types", z.array(contentTypeSchema)),

  createContentType: (data: CreateContentTypeRequest) =>
    apiFetch("/content-types", contentTypeSchema, { method: "POST", body: JSON.stringify(data) }),

  // ── Publish targets (content_channels, CNT-002) ─────────────────────────────
  addContentChannel: (contentId: string, data: AddContentChannelRequest) =>
    apiFetch(`/content/${contentId}/channels`, contentChannelSchema, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateContentChannel: (
    contentId: string,
    contentChannelId: string,
    data: UpdateContentChannelRequest,
  ) =>
    apiFetch(`/content/${contentId}/channels/${contentChannelId}`, contentChannelSchema, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  removeContentChannel: (contentId: string, contentChannelId: string) =>
    apiFetch(`/content/${contentId}/channels/${contentChannelId}`, z.void(), { method: "DELETE" }),

  // ── Assets (version chain, CNT-003) ─────────────────────────────────────────
  createAsset: (contentId: string, data: CreateContentAssetRequest) =>
    apiFetch(`/content/${contentId}/assets`, contentAssetSchema, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  createAssetVersion: (contentId: string, assetId: string, data: CreateContentAssetVersionRequest) =>
    apiFetch(`/content/${contentId}/assets/${assetId}/versions`, contentAssetSchema, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  deleteAsset: (contentId: string, assetId: string) =>
    apiFetch(`/content/${contentId}/assets/${assetId}`, z.void(), { method: "DELETE" }),
};
