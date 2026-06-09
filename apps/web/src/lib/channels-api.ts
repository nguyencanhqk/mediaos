import { z } from "zod";
import type {
  AddChannelMemberRequest,
  CreateChannelRequest,
  UpdateChannelHealthRequest,
  UpdateChannelMemberRequest,
  UpdateChannelRequest,
} from "@mediaos/contracts";
import {
  channelMemberSchema,
  channelSchema,
  platformSchema,
} from "@mediaos/contracts";
import { apiFetch } from "./api-client";

/** Filter list kênh (CH-001) — gửi sang `GET /channels` dưới dạng query param. */
export interface ChannelFilters {
  platform?: string;
  status?: string;
  managerId?: string;
  niche?: string;
  q?: string;
  /** Chỉ kênh rủi ro — health_status ∈ {risk, declining} (G6-5). */
  risk?: boolean;
}

function buildChannelQuery(filters: ChannelFilters = {}): string {
  const qs = new URLSearchParams();
  if (filters.platform) qs.set("platform", filters.platform);
  if (filters.status) qs.set("status", filters.status);
  if (filters.managerId) qs.set("managerId", filters.managerId);
  if (filters.niche) qs.set("niche", filters.niche);
  if (filters.q) qs.set("q", filters.q);
  if (filters.risk) qs.set("risk", "true");
  const suffix = qs.toString();
  return suffix ? `?${suffix}` : "";
}

export const channelsApi = {
  // ── Platforms (catalog) ───────────────────────────────────────────────────
  listPlatforms: () => apiFetch("/platforms", z.array(platformSchema)),

  // ── Channels ──────────────────────────────────────────────────────────────
  listChannels: (filters?: ChannelFilters) =>
    apiFetch(`/channels${buildChannelQuery(filters)}`, z.array(channelSchema)),

  getChannel: (id: string) => apiFetch(`/channels/${id}`, channelSchema),

  createChannel: (data: CreateChannelRequest) =>
    apiFetch("/channels", channelSchema, { method: "POST", body: JSON.stringify(data) }),

  updateChannel: (id: string, data: UpdateChannelRequest) =>
    apiFetch(`/channels/${id}`, channelSchema, { method: "PATCH", body: JSON.stringify(data) }),

  updateChannelHealth: (id: string, data: UpdateChannelHealthRequest) =>
    apiFetch(`/channels/${id}/health`, channelSchema, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  deleteChannel: (id: string) =>
    apiFetch(`/channels/${id}`, z.void(), { method: "DELETE" }),

  // ── Channel members ───────────────────────────────────────────────────────
  listChannelMembers: (channelId: string) =>
    apiFetch(`/channels/${channelId}/members`, z.array(channelMemberSchema)),

  addChannelMember: (channelId: string, data: AddChannelMemberRequest) =>
    apiFetch(`/channels/${channelId}/members`, channelMemberSchema, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateChannelMember: (
    channelId: string,
    memberId: string,
    data: UpdateChannelMemberRequest,
  ) =>
    apiFetch(`/channels/${channelId}/members/${memberId}`, channelMemberSchema, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  removeChannelMember: (channelId: string, memberId: string) =>
    apiFetch(`/channels/${channelId}/members/${memberId}`, z.void(), { method: "DELETE" }),
};
