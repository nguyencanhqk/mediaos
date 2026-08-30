import { createZodDto } from "nestjs-zod";
import {
  assetSummaryQuerySchema,
  assignAssetSchema,
  bulkMarkInventoryItemsSchema,
  closeInventorySchema,
  closeMaintenanceSchema,
  createAssetCategorySchema,
  createAssetSchema,
  disposeAssetSchema,
  listAssetAssignmentsQuerySchema,
  listAssetCategoriesQuerySchema,
  listAssetInventoriesQuerySchema,
  listAssetInventoryItemsQuerySchema,
  listAssetMaintenancesQuerySchema,
  listAssetsQuerySchema,
  markInventoryItemSchema,
  meAssetsQuerySchema,
  openInventorySchema,
  openMaintenanceSchema,
  recoverAssetSchema,
  revokeAssetSchema,
  updateAssetCategorySchema,
  updateAssetSchema,
} from "@mediaos/contracts";

/**
 * S11-ASSET-BE-1 — DTO biên module ASSET. Nguồn sự thật = Zod ở `@mediaos/contracts/asset`
 * (`createZodDto` ⇒ metatype tồn tại lúc chạy ⇒ `ZodValidationPipe` chiếu được schema — KI-068).
 */

// ── Loại tài sản (001–004) ──
export class ListAssetCategoriesQueryDto extends createZodDto(listAssetCategoriesQuerySchema) {}
export class CreateAssetCategoryDto extends createZodDto(createAssetCategorySchema) {}
export class UpdateAssetCategoryDto extends createZodDto(updateAssetCategorySchema) {}

// ── Hồ sơ tài sản (005–009, 024) ──
export class ListAssetsQueryDto extends createZodDto(listAssetsQuerySchema) {}
export class AssetSummaryQueryDto extends createZodDto(assetSummaryQuerySchema) {}
export class CreateAssetDto extends createZodDto(createAssetSchema) {}
/** `.strict()` — khoá lạ (`assetCode`/`status`) ⇒ 400 tại biên (plan §1.1). */
export class UpdateAssetDto extends createZodDto(updateAssetSchema) {}

// ── Cấp phát / thu hồi (010–012) ──
export class AssignAssetDto extends createZodDto(assignAssetSchema) {}
export class RevokeAssetDto extends createZodDto(revokeAssetSchema) {}
export class ListAssetAssignmentsQueryDto extends createZodDto(listAssetAssignmentsQuerySchema) {}

// ── Bảo trì (013–015) ──
export class OpenMaintenanceDto extends createZodDto(openMaintenanceSchema) {}
export class CloseMaintenanceDto extends createZodDto(closeMaintenanceSchema) {}
export class ListAssetMaintenancesQueryDto extends createZodDto(listAssetMaintenancesQuerySchema) {}

// ── Thanh lý / mất / tìm thấy lại (016–017) ──
export class DisposeAssetDto extends createZodDto(disposeAssetSchema) {}
export class RecoverAssetDto extends createZodDto(recoverAssetSchema) {}

// ── Kiểm kê (018–022) ──
export class ListAssetInventoriesQueryDto extends createZodDto(listAssetInventoriesQuerySchema) {}
export class OpenInventoryDto extends createZodDto(openInventorySchema) {}
export class ListAssetInventoryItemsQueryDto extends createZodDto(
  listAssetInventoryItemsQuerySchema,
) {}
export class MarkInventoryItemDto extends createZodDto(markInventoryItemSchema) {}
export class BulkMarkInventoryItemsDto extends createZodDto(bulkMarkInventoryItemsSchema) {}
export class CloseInventoryDto extends createZodDto(closeInventorySchema) {}

// ── Tài sản của tôi (023) ──
/** CỐ Ý KHÔNG có `employeeId` — chủ thể từ token (SPEC-09 §14.4). */
export class MeAssetsQueryDto extends createZodDto(meAssetsQuerySchema) {}
