import { z } from "zod";
import type {
  CreateChannelRequest,
  CreateProjectRequest,
  CreateContentItemRequest,
  AddProjectChannelRequest,
} from "@mediaos/contracts";
import {
  channelSchema,
  projectSchema,
  contentItemSchema,
} from "@mediaos/contracts";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3100/api/v1";

async function apiFetch<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${path}: ${body}`);
  }
  if (res.status === 204) return undefined as T;
  const json: unknown = await res.json();
  return schema.parse(json);
}

export const mediaApi = {
  listChannels: () => apiFetch("/channels", z.array(channelSchema)),
  createChannel: (data: CreateChannelRequest) =>
    apiFetch("/channels", channelSchema, { method: "POST", body: JSON.stringify(data) }),

  listProjects: () => apiFetch("/projects", z.array(projectSchema)),
  createProject: (data: CreateProjectRequest) =>
    apiFetch("/projects", projectSchema, { method: "POST", body: JSON.stringify(data) }),

  addProjectChannel: (projectId: string, data: AddProjectChannelRequest) =>
    apiFetch(`/projects/${projectId}/channels`, z.unknown(), {
      method: "POST",
      body: JSON.stringify(data),
    }),
  removeProjectChannel: (projectId: string, channelId: string) =>
    apiFetch(`/projects/${projectId}/channels/${channelId}`, z.void(), { method: "DELETE" }),

  listContent: (projectId: string) =>
    apiFetch(`/projects/${projectId}/content`, z.array(contentItemSchema)),
  createContent: (projectId: string, data: CreateContentItemRequest) =>
    apiFetch(`/projects/${projectId}/content`, contentItemSchema, {
      method: "POST",
      body: JSON.stringify(data),
    }),
};
