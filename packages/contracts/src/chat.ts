import { z } from "zod";

export const chatRoomTypeSchema = z.enum(["project", "direct"]);
export type ChatRoomType = z.infer<typeof chatRoomTypeSchema>;

export const chatRoomSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  refId: z.string().uuid().nullable(),
  roomType: chatRoomTypeSchema,
  name: z.string(),
  createdAt: z.string().datetime(),
});
export type ChatRoomDto = z.infer<typeof chatRoomSchema>;

export const createChatRoomSchema = z.object({
  name: z.string().min(1).max(200),
  roomType: chatRoomTypeSchema.default("direct"),
  refId: z.string().uuid().optional(),
});
export type CreateChatRoomRequest = z.infer<typeof createChatRoomSchema>;

export const chatMessageSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  roomId: z.string().uuid(),
  senderId: z.string().uuid(),
  senderName: z.string().nullable(),
  body: z.string(),
  createdAt: z.string().datetime(),
});
export type ChatMessageDto = z.infer<typeof chatMessageSchema>;

export const sendMessageSchema = z.object({
  body: z.string().min(1).max(4000),
});
export type SendMessageRequest = z.infer<typeof sendMessageSchema>;
