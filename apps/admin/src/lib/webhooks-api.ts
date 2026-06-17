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
import { apiFetch } from "./api-client";

/**
 * AC-6 Webhooks API client (self-service TENANT). Mọi route gate manage/view:webhook (is_sensitive) ở BE +
 * chạy withTenant(actor.companyId). companyId trên path `/tenant/:companyId/webhooks` chỉ self-scope điều
 * hướng UI — BE ép tenant theo JWT.
 *
 * BẤT BIẾN #3: create trả { secret, endpoint } — secret plaintext CHỈ hiển thị 1 lần (không lưu lại).
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

  updateEndpoint: (
    id: string,
    body: { description?: string | null; active?: boolean },
  ): Promise<WebhookEndpointDto> =>
    apiFetch(`/webhooks/endpoints/${id}`, webhookEndpointSchema, {
      method: "PUT",
      body: JSON.stringify(body),
    }),

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
