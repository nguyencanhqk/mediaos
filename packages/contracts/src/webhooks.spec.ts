import { describe, expect, it } from "vitest";
import {
  createWebhookEndpointSchema,
  createWebhookSubscriptionSchema,
  webhookDeliveryStatusEnum,
  webhookEndpointSchema,
  webhookEventTypeEnum,
} from "./webhooks";

describe("AC-6 webhook contracts (BẤT BIẾN #3: no secret plaintext in DTO/request)", () => {
  it("createWebhookEndpointSchema KHÔNG có field secret (server sinh)", () => {
    const parsed = createWebhookEndpointSchema.parse({
      url: "https://hooks.example.com/in",
      description: "x",
      secret: "attacker-supplied-secret",
    } as Record<string, unknown>);
    expect((parsed as Record<string, unknown>).secret).toBeUndefined();
  });

  it("createWebhookEndpointSchema REJECT non-https url", () => {
    const res = createWebhookEndpointSchema.safeParse({ url: "http://hooks.example.com/in" });
    expect(res.success).toBe(false);
  });

  it("webhookEndpointSchema KHÔNG có cột envelope/secret", () => {
    const dto = webhookEndpointSchema.parse({
      id: "00000000-0000-0000-0000-000000000001",
      url: "https://hooks.example.com/in",
      description: null,
      active: true,
      createdAt: "2026-06-17T00:00:00.000Z",
    });
    const keys = Object.keys(dto);
    for (const forbidden of [
      "secret",
      "secretCiphertext",
      "encryptedDek",
      "dekKeyVersion",
      "kmsKeyId",
      "ivNonce",
      "authTag",
      "encAlgo",
    ]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("subscription event_type PHẢI ∈ taxonomy", () => {
    expect(createWebhookSubscriptionSchema.safeParse({ eventType: "task.created" }).success).toBe(
      true,
    );
    expect(
      createWebhookSubscriptionSchema.safeParse({ eventType: "not.a.real.event" }).success,
    ).toBe(false);
    expect(webhookEventTypeEnum.options.length).toBeGreaterThan(0);
  });

  it("delivery status enum = pending/success/failed", () => {
    expect(webhookDeliveryStatusEnum.options).toEqual(["pending", "success", "failed"]);
  });
});
