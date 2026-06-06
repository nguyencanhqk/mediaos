import { z } from "zod";
import type { CreateContentItemRequest } from "@mediaos/contracts";
import { contentItemSchema } from "@mediaos/contracts";
import { apiFetch } from "./api-client";

/**
 * Content items (G4-2 legacy). Channels → channels-api, projects → projects-api (G6).
 * Content guard/ERD-full retrofit ở G6-4.
 */
export const mediaApi = {
  listContent: (projectId: string) =>
    apiFetch(`/projects/${projectId}/content`, z.array(contentItemSchema)),
  createContent: (projectId: string, data: CreateContentItemRequest) =>
    apiFetch(`/projects/${projectId}/content`, contentItemSchema, {
      method: "POST",
      body: JSON.stringify(data),
    }),
};
