import type {
  AssetAssignmentResponseDto,
  AssetAssignmentStatusDto,
  AssetCategoryResponseDto,
  AssetDetailResponseDto,
  AssetInventoryItemResponseDto,
  AssetInventoryResponseDto,
  AssetInventoryExpectedStatusDto,
  AssetInventoryItemResultDto,
  AssetInventoryStatusDto,
  AssetIssueConditionDto,
  AssetLifecycleStatusDto,
  AssetListItemResponseDto,
  AssetMaintenanceResponseDto,
  AssetMaintenanceStatusDto,
  AssetReturnConditionDto,
  AssetSummaryResponseDto,
  MeAssetItemResponseDto,
} from "@mediaos/contracts";
import type { Asset, AssetCategory, AssetInventory, AssetMaintenance } from "../db/schema/assets";
import type { AssetAssignmentRow, MeAssetRow } from "./asset-assignments.repository";
import type { AssetInventoryItemRow } from "./asset-inventory.repository";
import type { AssetSummaryRows, AssetWithHolderRow } from "./assets.repository";

/**
 * S11-ASSET-BE-1 — projection row Drizzle → DTO contracts. ĐIỂM MASKING DUY NHẤT của module (SPEC-13 §18):
 *
 *   • Tài chính (`purchasePrice` · `supplier` · `cost`): CHỈ có khoá khi `showFinancial` (scope Company) — vắng
 *     khoá, không `null`.
 *   • Danh tính người giữ (`currentHolder`): quyết định bằng cờ `holderVisible` do `identityColumns` sinh —
 *     KHÔNG tự suy từ `employeeCode` (cột đó không qua L1; quên cờ = rò mã nhân viên mà ratchet vẫn xanh).
 *   • `/me/assets`: mapper RIÊNG, row đầu vào KHÔNG có trường tài chính và mapper KHÔNG bao giờ chép chúng.
 *
 * `numeric` về JS dạng CHUỖI ⇒ ép số ở đây, một chỗ. CẤM controller/service trả row thô.
 */

const toNumber = (v: string | number | null | undefined): number | null => {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

const toIso = (v: Date | string | null | undefined): string | null => {
  if (v === null || v === undefined) return null;
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
};

const isoOrEpoch = (v: Date | string | null | undefined): string =>
  toIso(v) ?? new Date(0).toISOString();

export function toAssetCategoryDto(
  row: AssetCategory,
  opts: { includeDeleted?: boolean } = {},
): AssetCategoryResponseDto {
  const base: AssetCategoryResponseDto = {
    id: row.id,
    code: row.code,
    name: row.name,
    codePrefix: row.codePrefix,
    description: row.description,
    defaultMaintenanceIntervalDays: row.defaultMaintenanceIntervalDays,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    createdAt: isoOrEpoch(row.createdAt),
    updatedAt: isoOrEpoch(row.updatedAt),
  };
  if (!opts.includeDeleted) return base;
  return { ...base, deleted: row.deletedAt !== null, deletedAt: toIso(row.deletedAt) };
}

function holderOf(row: AssetWithHolderRow): AssetListItemResponseDto["currentHolder"] {
  if (!row.holderVisible || !row.holderEmployeeId) return undefined;
  return {
    employeeId: row.holderEmployeeId,
    employeeCode: row.holderEmployeeCode ?? null,
    fullName: row.holderFullName ?? null,
    assignedAt: isoOrEpoch(row.holderAssignedAt),
  };
}

export function toAssetListItemDto(row: AssetWithHolderRow): AssetListItemResponseDto {
  const holder = holderOf(row);
  return {
    id: row.id,
    assetCode: row.assetCode,
    name: row.name,
    category: { id: row.categoryId, code: row.categoryCode, name: row.categoryName },
    status: row.status as AssetLifecycleStatusDto,
    serialNumber: row.serialNumber,
    brand: row.brand,
    model: row.model,
    location: row.location,
    nextMaintenanceDue: row.nextMaintenanceDue,
    ...(holder ? { currentHolder: holder } : {}),
    createdAt: isoOrEpoch(row.createdAt),
    updatedAt: isoOrEpoch(row.updatedAt),
  };
}

export function toAssetDetailDto(
  row: AssetWithHolderRow,
  extra: {
    showFinancial: boolean;
    openMaintenance: AssetMaintenance | null;
    counts: { assignments: number; maintenances: number };
  },
): AssetDetailResponseDto {
  const item = toAssetListItemDto(row);
  return {
    ...item,
    purchaseDate: row.purchaseDate,
    ...(extra.showFinancial
      ? { purchasePrice: toNumber(row.purchasePrice), supplier: row.supplier }
      : {}),
    warrantyEndDate: row.warrantyEndDate,
    conditionNote: row.conditionNote,
    statusReason: row.statusReason,
    statusChangedAt: toIso(row.statusChangedAt),
    description: row.description,
    openMaintenance: extra.openMaintenance
      ? {
          id: extra.openMaintenance.id,
          openedAt: isoOrEpoch(extra.openMaintenance.openedAt),
          reason: extra.openMaintenance.reason,
          vendor: extra.openMaintenance.vendor,
        }
      : null,
    counts: extra.counts,
  };
}

/**
 * Snapshot audit — CHỈ trường nhận dạng/định vị/trạng thái (BẤT BIẾN #3): strip `purchasePrice`/`supplier`
 * KHÔNG ĐIỀU KIỆN (dù actor ghi luôn là Company — phòng thủ kép, SPEC-13 §12 "giá mua không vào audit").
 */
export function toAssetAuditSnapshot(row: Asset): Record<string, unknown> {
  return {
    id: row.id,
    assetCode: row.assetCode,
    name: row.name,
    categoryId: row.categoryId,
    serialNumber: row.serialNumber,
    status: row.status,
    statusReason: row.statusReason,
    location: row.location,
    nextMaintenanceDue: row.nextMaintenanceDue,
    deletedAt: toIso(row.deletedAt),
  };
}

export function toAssetCategoryAuditSnapshot(row: AssetCategory): Record<string, unknown> {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    codePrefix: row.codePrefix,
    isActive: row.isActive,
    defaultMaintenanceIntervalDays: row.defaultMaintenanceIntervalDays,
    deletedAt: toIso(row.deletedAt),
  };
}

export function toAssetAssignmentDto(row: AssetAssignmentRow): AssetAssignmentResponseDto {
  return {
    id: row.id,
    assetId: row.assetId,
    employeeId: row.employeeId,
    employeeCode: row.employeeCode,
    employeeFullName: row.holderVisible ? (row.employeeFullName ?? null) : null,
    assignedAt: isoOrEpoch(row.assignedAt),
    assignedBy: row.assignedBy,
    issueCondition: row.issueCondition as AssetIssueConditionDto | null,
    issueNote: row.issueNote,
    expectedReturnDate: row.expectedReturnDate,
    status: row.status as AssetAssignmentStatusDto,
    returnedAt: toIso(row.returnedAt),
    returnedBy: row.returnedBy,
    returnCondition: row.returnCondition as AssetReturnConditionDto | null,
    returnNote: row.returnNote,
  };
}

/** Snapshot audit lượt cấp phát — id/asset/employee/trạng thái, không ghi chú tự do. */
export function toAssignmentAuditSnapshot(row: {
  id: string;
  assetId: string;
  employeeId: string;
  status: string;
  returnCondition: string | null;
}): Record<string, unknown> {
  return {
    id: row.id,
    assetId: row.assetId,
    employeeId: row.employeeId,
    status: row.status,
    returnCondition: row.returnCondition,
  };
}

export function toAssetMaintenanceDto(
  row: AssetMaintenance,
  showFinancial: boolean,
): AssetMaintenanceResponseDto {
  return {
    id: row.id,
    assetId: row.assetId,
    openedAt: isoOrEpoch(row.openedAt),
    openedBy: row.openedBy,
    reason: row.reason,
    vendor: row.vendor,
    status: row.status as AssetMaintenanceStatusDto,
    closedAt: toIso(row.closedAt),
    closedBy: row.closedBy,
    resultNote: row.resultNote,
    ...(showFinancial ? { cost: toNumber(row.cost) } : {}),
    nextDueDate: row.nextDueDate,
  };
}

/** Snapshot audit lượt bảo trì — strip `cost`. */
export function toMaintenanceAuditSnapshot(row: AssetMaintenance): Record<string, unknown> {
  return {
    id: row.id,
    assetId: row.assetId,
    status: row.status,
    reason: row.reason,
    vendor: row.vendor,
    nextDueDate: row.nextDueDate,
  };
}

export function toAssetInventoryDto(row: AssetInventory): AssetInventoryResponseDto {
  return {
    id: row.id,
    name: row.name,
    categoryId: row.categoryId,
    status: row.status as AssetInventoryStatusDto,
    openedAt: isoOrEpoch(row.openedAt),
    openedBy: row.openedBy,
    closedAt: toIso(row.closedAt),
    closedBy: row.closedBy,
    note: row.note,
    totalItems: row.totalItems,
    foundCount: row.foundCount,
    missingCount: row.missingCount,
    notCheckedCount: row.notCheckedCount,
  };
}

export function toAssetInventoryItemDto(row: AssetInventoryItemRow): AssetInventoryItemResponseDto {
  return {
    id: row.id,
    inventoryId: row.inventoryId,
    assetId: row.assetId,
    assetCode: row.assetCode,
    assetName: row.assetName,
    expectedStatus: row.expectedStatus as AssetInventoryExpectedStatusDto,
    expectedHolderEmployeeId: row.expectedHolderEmployeeId,
    result: row.result as AssetInventoryItemResultDto,
    checkedAt: toIso(row.checkedAt),
    checkedBy: row.checkedBy,
    note: row.note,
  };
}

export function toAssetSummaryDto(rows: AssetSummaryRows): AssetSummaryResponseDto {
  const byStatus: AssetSummaryResponseDto["byStatus"] = {
    "In Stock": 0,
    Assigned: 0,
    "Under Maintenance": 0,
    Disposed: 0,
    Lost: 0,
  };
  for (const r of rows.byStatus) {
    if (r.status in byStatus) byStatus[r.status as AssetLifecycleStatusDto] = r.n;
  }
  return {
    byStatus,
    byCategory: rows.byCategory.map((c) => ({
      categoryId: c.categoryId,
      code: c.code,
      name: c.name,
      total: c.total,
      assigned: c.assigned,
    })),
    maintenanceDueSoon: rows.maintenanceDueSoon,
  };
}

/**
 * `/me/assets` — KHÔNG BAO GIỜ có `purchasePrice`/`supplier`/`cost`: chép TỪNG TRƯỜNG tường minh, không spread
 * row (row "bẩn" có mang trường tài chính cũng không lọt — `assets.mapper.spec.ts`).
 */
export function toMeAssetItemDto(row: MeAssetRow): MeAssetItemResponseDto {
  return {
    assignmentId: row.assignmentId,
    assetId: row.assetId,
    assetCode: row.assetCode,
    assetName: row.assetName,
    category: { id: row.categoryId, code: row.categoryCode, name: row.categoryName },
    assetStatus: row.assetStatus as AssetLifecycleStatusDto,
    serialNumber: row.serialNumber,
    assignedAt: isoOrEpoch(row.assignedAt),
    issueCondition: row.issueCondition as AssetIssueConditionDto | null,
    expectedReturnDate: row.expectedReturnDate,
    assignmentStatus: row.assignmentStatus as AssetAssignmentStatusDto,
    returnedAt: toIso(row.returnedAt),
    returnCondition: row.returnCondition as AssetReturnConditionDto | null,
  };
}
