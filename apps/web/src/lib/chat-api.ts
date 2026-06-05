import { z } from "zod";
import type { CreateChatRoomRequest, SendMessageRequest } from "@mediaos/contracts";
import { chatMessageSchema, chatRoomSchema } from "@mediaos/contracts";
import { apiFetch } from "./api-client";

export const chatApi = {
  listRooms: () => apiFetch("/chat/rooms", z.array(chatRoomSchema)),

  createRoom: (data: CreateChatRoomRequest) =>
    apiFetch("/chat/rooms", chatRoomSchema, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  getMessages: (roomId: string) =>
    apiFetch(`/chat/rooms/${roomId}/messages`, z.array(chatMessageSchema)),

  sendMessage: (roomId: string, data: SendMessageRequest) =>
    apiFetch(`/chat/rooms/${roomId}/messages`, chatMessageSchema, {
      method: "POST",
      body: JSON.stringify(data),
    }),
};
