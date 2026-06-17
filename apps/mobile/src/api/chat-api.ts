import { z } from "zod";
import { chatRoomSchema, chatMessageSchema, type SendMessageRequest } from "@mediaos/contracts";
import { apiFetch } from "./client";

/**
 * Chat API client for mobile — mirrors the NestJS ChatController routes.
 * All calls attach Bearer token; authorization is enforced by RLS + PermissionGuard server-side.
 */
export const chatApi = {
  /** GET /chat/rooms — list rooms the caller is a member of. */
  listRooms: () =>
    apiFetch("/chat/rooms", z.array(chatRoomSchema), { authenticated: true }),

  /** GET /chat/rooms/:roomId/messages — paginated message history. */
  listMessages: (roomId: string) =>
    apiFetch(`/chat/rooms/${roomId}/messages`, z.array(chatMessageSchema), {
      authenticated: true,
    }),

  /** POST /chat/rooms/:roomId/messages — send a new message. */
  sendMessage: (roomId: string, data: SendMessageRequest) =>
    apiFetch(`/chat/rooms/${roomId}/messages`, chatMessageSchema, {
      authenticated: true,
      method: "POST",
      body: JSON.stringify(data),
    }),
};
