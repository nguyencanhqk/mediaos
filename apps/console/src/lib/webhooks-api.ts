import { z } from "zod";
import {
  createWebhookEndpointResponseSchema,
  createWebhookEndpointSchema,
  webhookDeliverySchema,
  webhookEndpointSchema,
  webhookSubscriptionSchema,
  type CreateWebhookEndpointRequest,
  type CreateWebhookEndpointResponse,
  type CreateWebhookSubscriptionRequest,
  type WebhookDeliveryDto,
  type WebhookEndpointDto,
  type WebhookSubscriptionDto,
} from "@mediaos/contracts";
import { apiFetch } from "@mediaos/web-core";

/**
 * AC-6 Webhooks API client cho apps/console (Hệ thống — tenant self-service, aud=user).
 *
 * Mọi route gate view/manage:webhook (is_sensitive) ở BE + chạy withTenant(actor.companyId) — KHÔNG
 * cross-tenant. FE chỉ ẩn/hiện affordance. BẤT BIẾN #3: create trả { secret, endpoint } — secret plaintext
 * CHỈ hiển thị 1 lần (không lưu lại). Route dưới global prefix /api/v1.
 */
export const webhooksApi = {
  listEndpoints: (): Promise<WebhookEndpointDto[]> =>
    apiFetch("/webhooks/endpoints", z.array(webhookEndpointSchema)),

  createEndpoint: (body: CreateWebhookEndpointRequest): Promise<CreateWebhookEndpointResponse> => {
    const validated = createWebhookEndpointSchema.parse(body);
    return apiFetch("/webhooks/endpoints", createWebhookEndpointResponseSchema, {
      method: "POST",
      body: JSON.stringify(validated),
    });
  },

  deleteEndpoint: (id: string): Promise<void> =>
    apiFetch(`/webhooks/endpoints/${id}`, z.unknown(), { method: "DELETE" }).then(() => undefined),

  listSubscriptions: (endpointId: string): Promise<WebhookSubscriptionDto[]> =>
    apiFetch(`/webhooks/endpoints/${endpointId}/subscriptions`, z.array(webhookSubscriptionSchema)),

  subscribe: (
    endpointId: string,
    body: CreateWebhookSubscriptionRequest,
  ): Promise<WebhookSubscriptionDto> =>
    apiFetch(`/webhooks/endpoints/${endpointId}/subscriptions`, webhookSubscriptionSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  listDeliveries: (endpointId: string): Promise<WebhookDeliveryDto[]> =>
    apiFetch(`/webhooks/endpoints/${endpointId}/deliveries`, z.array(webhookDeliverySchema)),
};
