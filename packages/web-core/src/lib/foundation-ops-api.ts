import { z } from "zod";
import {
  sequenceCounterViewSchema,
  sequencePreviewResponseSchema,
  seedBatchStatusViewSchema,
  type SequenceCounterView,
  type SequencePreviewResponse,
  type PatchSequenceDto,
  type SeedBatchStatusView,
} from "@mediaos/contracts";
import { apiFetch } from "./api-client";

/**
 * Foundation ops admin API client — S2-FE-FND-5 (lane FE batch C).
 *
 * Cặp engine SEED THẬT (mig 0435 — nguồn apps/api/src/foundation/sequences/sequence.controller.ts +
 * apps/api/src/foundation/seed/seed.controller.ts):
 *  - GET   /foundation/sequences             view:foundation-sequence   (is_sensitive=false)
 *  - GET   /foundation/sequences/:id/preview view:foundation-sequence   (KHÔNG mutate counter)
 *  - PATCH /foundation/sequences/:id         update:foundation-sequence (is_sensitive=false)
 *  - GET   /foundation/seeds                 view:foundation-seed       (is_sensitive=TRUE — System scope,
 *          KHÔNG kế thừa qua wildcard bulk-grant, phải cấp tường minh per-user)
 *
 * company_id do SERVER resolve từ AuthContext — client KHÔNG gửi (BẤT BIẾN #1). WHITELIST view (KHÔNG
 * current_value/secret/payload) — client chỉ render shape server trả (BẤT BIẾN #3).
 */
export const foundationOpsApi = {
  /** GET /foundation/sequences — mọi counter (deleted_at IS NULL) của tenant. */
  listSequences: (): Promise<SequenceCounterView[]> =>
    apiFetch("/foundation/sequences", z.array(sequenceCounterViewSchema)),

  /** GET /foundation/sequences/:id/preview — mã KẾ TIẾP, KHÔNG mutate current_value. */
  previewSequence: (id: string): Promise<SequencePreviewResponse> =>
    apiFetch(`/foundation/sequences/${id}/preview`, sequencePreviewResponseSchema),

  /** PATCH /foundation/sequences/:id — sửa cấu hình mutable (whitelist .strict() ở contract). */
  updateSequence: (id: string, body: PatchSequenceDto): Promise<SequenceCounterView> =>
    apiFetch(`/foundation/sequences/${id}`, sequenceCounterViewSchema, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  /** GET /foundation/seeds — trạng thái RUN batch seed của tenant (read-only, System scope). */
  listSeeds: (): Promise<SeedBatchStatusView[]> =>
    apiFetch("/foundation/seeds", z.array(seedBatchStatusViewSchema)),
};
