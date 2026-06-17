import { z } from "zod";

/**
 * AC-6 Webhooks (TENANT self-service) DTOs — nguồn sự thật cho contract api ↔ admin.
 *
 * BẤT BIẾN #3 (không secret plaintext):
 *   - HMAC secret = reversible → envelope-KMS server-side. DTO list/get KHÔNG bao giờ chứa secret hay cột
 *     envelope (secret_ciphertext/encrypted_dek/…). Plaintext secret trả ĐÚNG 1 LẦN ở createWebhookEndpointResponse
 *     ngay khi tạo, server KHÔNG lưu plaintext, KHÔNG log, KHÔNG vào audit detail.
 *   - Client KHÔNG gửi được secret khi tạo (field không có trong createWebhookEndpointSchema → strip).
 *
 * companyId LẤY TỪ JWT (server) — KHÔNG nhận từ body/param (chống cross-tenant).
 */

/**
 * Taxonomy event_type cho webhook subscription. Align với outbox_events.event_type (domain.action).
 * Đây là NGUỒN taxonomy ở tầng contract: subscription chỉ được đăng ký event_type ∈ tập này. Mở rộng =
 * thêm ở đây (1 nơi) + đồng bộ với event mà delivery consumer fan-out.
 */
export const webhookEventTypeEnum = z.enum([
  "task.created",
  "task.updated",
  "task.completed",
  "workflow.step_completed",
  "workflow.instance_completed",
  "approval.requested",
  "approval.approved",
  "approval.rejected",
  "content.published",
]);
export type WebhookEventType = z.infer<typeof webhookEventTypeEnum>;

/** Trạng thái 1 lần giao webhook (delivery lifecycle). */
export const webhookDeliveryStatusEnum = z.enum(["pending", "success", "failed"]);
export type WebhookDeliveryStatus = z.infer<typeof webhookDeliveryStatusEnum>;

/**
 * URL webhook — PHẢI https. Validate cú pháp ở contract; chặn SSRF (RFC1918/loopback/metadata/*.internal +
 * DNS-rebinding resolve-then-pin) là việc của SERVER (WebhookUrlValidator) — KHÔNG đủ ở tầng schema.
 */
export const webhookUrlSchema = z
  .string()
  .url()
  .max(2048)
  .refine((u) => u.startsWith("https://"), { message: "Webhook URL phải dùng https." });

/**
 * DTO 1 webhook endpoint cho màn list/get (KHÔNG secret / KHÔNG cột envelope). `active` bật/tắt giao.
 */
export const webhookEndpointSchema = z.object({
  id: z.string().uuid(),
  url: z.string(),
  description: z.string().nullable(),
  active: z.boolean(),
  createdAt: z.string().datetime(),
});
export type WebhookEndpointDto = z.infer<typeof webhookEndpointSchema>;

/**
 * POST /webhooks/endpoints — body tạo endpoint. KHÔNG có field `secret` (server sinh HMAC secret).
 * companyId KHÔNG nhận từ client (lấy từ JWT).
 */
export const createWebhookEndpointSchema = z.object({
  url: webhookUrlSchema,
  description: z.string().max(500).nullable().optional(),
  active: z.boolean().optional(),
});
export type CreateWebhookEndpointRequest = z.infer<typeof createWebhookEndpointSchema>;

/** PUT /webhooks/endpoints/:id — cập nhật mô tả/active. KHÔNG đổi url (tạo mới nếu cần) / KHÔNG secret. */
export const updateWebhookEndpointSchema = z.object({
  description: z.string().max(500).nullable().optional(),
  active: z.boolean().optional(),
});
export type UpdateWebhookEndpointRequest = z.infer<typeof updateWebhookEndpointSchema>;

/**
 * Response khi TẠO endpoint — chứa `secret` plaintext ĐÚNG 1 LẦN (client tự lưu để verify HMAC chữ ký;
 * server không giữ plaintext). Tách schema riêng khỏi `webhookEndpointSchema` để secret KHÔNG lọt vào DTO list.
 */
export const createWebhookEndpointResponseSchema = z.object({
  /** Plaintext HMAC secret — chỉ hiển thị 1 lần, KHÔNG thể lấy lại. */
  secret: z.string(),
  endpoint: webhookEndpointSchema,
});
export type CreateWebhookEndpointResponse = z.infer<typeof createWebhookEndpointResponseSchema>;

/** DTO 1 subscription event_type của endpoint. */
export const webhookSubscriptionSchema = z.object({
  id: z.string().uuid(),
  endpointId: z.string().uuid(),
  eventType: webhookEventTypeEnum,
  createdAt: z.string().datetime(),
});
export type WebhookSubscriptionDto = z.infer<typeof webhookSubscriptionSchema>;

/** POST /webhooks/endpoints/:id/subscriptions — đăng ký 1 event_type (∈ taxonomy). */
export const createWebhookSubscriptionSchema = z.object({
  eventType: webhookEventTypeEnum,
});
export type CreateWebhookSubscriptionRequest = z.infer<typeof createWebhookSubscriptionSchema>;

/** DTO 1 lần giao (delivery log). KHÔNG chứa payload/secret. */
export const webhookDeliverySchema = z.object({
  id: z.string().uuid(),
  endpointId: z.string().uuid(),
  eventType: z.string(),
  status: webhookDeliveryStatusEnum,
  attempts: z.number().int(),
  responseCode: z.number().int().nullable(),
  lastError: z.string().nullable(),
  scheduledAt: z.string().datetime(),
  deliveredAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type WebhookDeliveryDto = z.infer<typeof webhookDeliverySchema>;

/** Purpose KMS cho HMAC secret webhook (mirror KeyPurpose union ở api/src/crypto). */
export const WEBHOOK_SECRET_PURPOSE = "webhook_secret" as const;
