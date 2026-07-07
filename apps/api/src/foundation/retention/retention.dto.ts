import { createZodDto } from "nestjs-zod";
import {
  createRetentionPolicySchema,
  patchRetentionPolicySchema,
  retentionPolicyViewSchema,
  simulateResultSchema,
  type RetentionPolicyView,
  type SimulateResultView,
} from "@mediaos/contracts";
import type { RetentionPolicyRow, SimulateResult } from "./retention.types";

/**
 * S2-FND-BE-3 (L3) — DTO ranh giới HTTP cho RetentionController. Nguồn sự thật = packages/contracts
 * (retention.ts, L2). Ở đây CHỈ bọc createZodDto cho ZodValidationPipe + mapper row→view (WHITELIST).
 *
 * BẤT BIẾN: view WHITELIST — KHÔNG lộ companyId/metadata/createdBy/updatedBy/deletedAt. patch .strict()
 * chặn leo thang (id/moduleCode/entityType bất biến). KHÔNG secret trong DTO (retention config không có
 * cột secret; view schema .strip() vẫn loại field lạ như phòng thủ chiều sâu).
 */

/** PATCH body — chỉ field mutable (contracts patchRetentionPolicySchema: .partial().strict().refine ≥1). */
export class PatchRetentionPolicyDto extends createZodDto(patchRetentionPolicySchema) {}

/**
 * S2-FND-BE-8 — POST create body (contracts createRetentionPolicySchema: .strict(), KHÔNG companyId/createdBy).
 * ZodValidationPipe validate ở ranh giới; entityType ép snake_case identifier (khớp guard service).
 */
export class CreateRetentionPolicyDto extends createZodDto(createRetentionPolicySchema) {}

/**
 * Map 1 hàng service (RetentionPolicyRow) → view DTO wire-safe. `updatedAt` → ISO-8601 string (khớp
 * convention companyViewSchema). Parse qua schema để STRIP mọi field ngoài whitelist (phòng thủ chiều sâu).
 */
export function toRetentionPolicyView(row: RetentionPolicyRow): RetentionPolicyView {
  return retentionPolicyViewSchema.parse({
    id: row.id,
    moduleCode: row.moduleCode,
    entityType: row.entityType,
    retentionDays: row.retentionDays,
    cleanupAction: row.cleanupAction,
    archiveAfterDays: row.archiveAfterDays,
    deleteAfterDays: row.deleteAfterDays,
    isLegalHoldSupported: row.isLegalHoldSupported,
    isEnabled: row.isEnabled,
    description: row.description,
    updatedAt: row.updatedAt.toISOString(),
  });
}

/**
 * Map kết quả simulate (§17.3, READ-ONLY) → view wire-safe. `cutoffTime` → ISO-8601 string (khớp updatedAt).
 * Parse qua schema để STRIP field ngoài whitelist (KHÔNG lộ companyId — phòng thủ chiều sâu).
 */
export function toSimulateResultView(result: SimulateResult): SimulateResultView {
  return simulateResultSchema.parse({
    policyId: result.policyId,
    moduleCode: result.moduleCode,
    entityType: result.entityType,
    eligibleRecords: result.eligibleRecords,
    action: result.action,
    cutoffTime: result.cutoffTime.toISOString(),
    isEnabled: result.isEnabled,
  });
}
