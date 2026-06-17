import { Injectable } from "@nestjs/common";
import { WebhookRepository, type WebhookDeliveryRow } from "./webhooks.repository";
import {
  validateWebhookUrl,
  type ValidatedTarget,
} from "./ssrf/webhook-url-validator";

/**
 * WebhookDeliveryService (AC-6) — ghi 1 bản ghi delivery (status='pending') + validate URL qua SSRF guard
 * (resolve-then-pin) TRƯỚC khi enqueue gửi thật. HTTP fan-out external = CONSUMER MỚI (worker/retry bước kế,
 * KHÔNG reuse outbox dispatcher) — lượt này dừng ở record + validate + (sign path ở WebhookSigner).
 *
 * Tách validate ra service riêng để worker (bước kế) tái dùng cùng guard mỗi attempt + mỗi redirect hop.
 */
@Injectable()
export class WebhookDeliveryService {
  constructor(private readonly repo: WebhookRepository) {}

  /**
   * Tạo bản ghi giao (pending) cho 1 event tới 1 endpoint. Validate URL ngay để fail-loud sớm nếu endpoint
   * trỏ tới IP nội bộ (SSRF) — KHÔNG enqueue gửi nếu URL không an toàn.
   */
  async enqueueDelivery(
    companyId: string,
    endpoint: { id: string; url: string },
    eventType: string,
  ): Promise<{ delivery: WebhookDeliveryRow; target: ValidatedTarget }> {
    // resolve-then-pin: ném WebhookSsrfError nếu non-https / host nội bộ / resolve về IP nội bộ.
    const target = await validateWebhookUrl(endpoint.url);
    const delivery = await this.repo.insertDelivery(companyId, endpoint.id, eventType);
    return { delivery, target };
  }
}
