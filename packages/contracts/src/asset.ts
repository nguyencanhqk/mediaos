import { z } from "zod";

/**
 * S11-ASSET-DB-1 — enum chuẩn module ASSET (SPEC-13 · DB-15 §7). NGUỒN SỰ THẬT cho DTO của S11-ASSET-BE-1.
 *
 * MỖI enum dưới đây MIRROR ĐÚNG BẰNG một CHECK của migration 0549 — HAI CHIỀU: không chặt hơn (giá trị DB
 * hợp lệ mà Zod từ chối ⇒ 400 oan), không lỏng hơn (Zod cho qua mà DB từ chối ⇒ 500 unique/check-violation
 * vô danh — bài học `contract-must-mirror-db-check-both-directions`). Pin hai chiều ở `asset.spec.ts`
 * (mảng literal chép từ migration, cố ý KHÔNG import từ schema drizzle).
 *
 * S11-ASSET-BE-1 — thêm request/response schema theo API-14 §5.1/§7 (phần "DTO" bên dưới). Enum GIỮ NGUYÊN.
 */

/** `chk_assets_status` — SPEC-01 §17.8. FSM chuyển tiếp ép ở service. */
export const assetLifecycleStatusSchema = z.enum([
  "In Stock",
  "Assigned",
  "Under Maintenance",
  "Disposed",
  "Lost",
]);
export type AssetLifecycleStatusDto = z.infer<typeof assetLifecycleStatusSchema>;

/** `chk_asset_assignments_status` — SPEC-01 §17.9. */
export const assetAssignmentStatusSchema = z.enum(["Active", "Returned"]);
export type AssetAssignmentStatusDto = z.infer<typeof assetAssignmentStatusSchema>;

/** `chk_asset_assignments_issue` — tình trạng lúc giao. */
export const assetIssueConditionSchema = z.enum(["Good", "Damaged"]);
export type AssetIssueConditionDto = z.infer<typeof assetIssueConditionSchema>;

/** `chk_asset_assignments_return` — tình trạng lúc thu hồi (`Lost` ⇒ tài sản sang `Lost`). */
export const assetReturnConditionSchema = z.enum(["Good", "Damaged", "Lost"]);
export type AssetReturnConditionDto = z.infer<typeof assetReturnConditionSchema>;

/** `chk_asset_maintenances_status`. */
export const assetMaintenanceStatusSchema = z.enum(["Open", "Closed"]);
export type AssetMaintenanceStatusDto = z.infer<typeof assetMaintenanceStatusSchema>;

/** `chk_asset_inventories_status`. */
export const assetInventoryStatusSchema = z.enum(["Open", "Closed"]);
export type AssetInventoryStatusDto = z.infer<typeof assetInventoryStatusSchema>;

/** `chk_asset_inventory_items_result`. */
export const assetInventoryItemResultSchema = z.enum(["Found", "Missing", "Not Checked"]);
export type AssetInventoryItemResultDto = z.infer<typeof assetInventoryItemResultSchema>;

/**
 * `chk_asset_inventory_items_expected` — ảnh chụp trạng thái lúc mở đợt: TẬP CON 3 giá trị, CỐ Ý KHÔNG tái dùng
 * `assetLifecycleStatusSchema` (nguồn loại trừ `Disposed`/`Lost` — DB-15 §7). Service mở đợt phải lọc trước khi
 * `INSERT … SELECT`, nếu không DB ném 23514 (map ra mã ASSET-ERR, không 500).
 */
export const assetInventoryExpectedStatusSchema = z.enum([
  "In Stock",
  "Assigned",
  "Under Maintenance",
]);
export type AssetInventoryExpectedStatusDto = z.infer<typeof assetInventoryExpectedStatusSchema>;

/** Đích của hành động `('dispose','asset')` — chỉ Zod, không CHECK riêng (đích FSM). */
export const assetDisposeKindSchema = z.enum(["Disposed", "Lost"]);
export type AssetDisposeKindDto = z.infer<typeof assetDisposeKindSchema>;

/** `chk_asset_categories_prefix` — vào mã `TS-<PREFIX>-<seq>` (ASSET-DEC-004). */
export const ASSET_CODE_PREFIX_RE = /^[A-Z0-9]{2,6}$/;

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// S11-ASSET-BE-1 — DTO request/response (API-14 §5.1 · §7). Triết lý như GOAL: ràng buộc THUẦN HÌNH THỨC
// (uuid · độ dài · enum · số không âm) chặn ở Zod = 400; luật CÓ MÃ LỖI (ASSET-ERR-014 ngày, 002 nhân viên…)
// ép ở service để trả 4xx kèm mã. Ngoại lệ có chủ đích: `reason` ≥ 3 ký tự (ASSET-ERR-009) và trần 200
// dòng bulk-mark là hằng tĩnh ⇒ ép luôn ở Zod (không cần logic động).
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/** Trần/mặc định 1 trang — chống unbounded read. */
export const ASSET_PAGE_MAX = 100;
export const ASSET_PAGE_DEFAULT = 20;
/** Trần dòng đánh dấu một lần (`bulk-mark`, API-14 §5.1 ASSET-API-021). */
export const ASSET_BULK_MARK_MAX = 200;

/** DATE-only (cột `date`, KHÔNG timestamp — UTC-at-rest không áp dụng). */
const assetDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày phải theo định dạng YYYY-MM-DD")
  // Ngày PHẢI tồn tại trên lịch: "2026-02-31" qua regex nhưng PG ném 22008 = 500 vô danh (gate HIGH-3).
  .refine((s) => {
    const t = Date.parse(`${s}T00:00:00Z`);
    return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
  }, "Ngày không tồn tại");

/**
 * Trường tiền `numeric(18,2)`: trần < 2^53 để float64 không mất chính xác, bước 0.01 để PG không làm tròn câm;
 * vượt ⇒ 400 tại biên thay vì `22003` = 500 (gate HIGH-2).
 */
export const ASSET_MONEY_MAX = 9_999_999_999_999.99;
const moneySchema = z.number().min(0).max(ASSET_MONEY_MAX).multipleOf(0.01);
/** Cột `integer` — trần để không rơi `22003 integer out of range`. */
export const ASSET_INTERVAL_DAYS_MAX = 3650;
export const ASSET_SORT_ORDER_MAX = 1_000_000;

/**
 * Boolean từ query-string. `z.preprocess` (KHÔNG `z.coerce.boolean()` trần): pipe chạy 2 lần (global +
 * method) ⇒ lần 2 nhận boolean thật — preprocess trả nguyên boolean nên IDEMPOTENT (memory
 * `zod-query-param-double-pipe-idempotent`). `z.coerce.boolean("false")` = true là bẫy kinh điển.
 */
const queryBoolSchema = z.preprocess((v) => {
  if (typeof v === "boolean") return v;
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0") return false;
  return v;
}, z.boolean().optional());

/** `page`/`per_page` — khớp envelope `pagination` API-01 §7.2 (KHÔNG limit/offset như GOAL). */
const pageQuerySchema = {
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(ASSET_PAGE_MAX).default(ASSET_PAGE_DEFAULT),
};

const nullableText = (max: number) => z.string().trim().max(max).nullish();

// ── Loại tài sản (ASSET-API-001..004) ─────────────────────────────────────────────────────────────

export const listAssetCategoriesQuerySchema = z.object({
  includeInactive: queryBoolSchema,
  /** Chỉ được honour khi caller có `('manage','asset-category')`; ngược lại BỎ QUA (không 403). */
  includeDeleted: queryBoolSchema,
});
export type ListAssetCategoriesQueryDto = z.infer<typeof listAssetCategoriesQuerySchema>;

export const createAssetCategorySchema = z.object({
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(1).max(255),
  codePrefix: z.string().regex(ASSET_CODE_PREFIX_RE, "Tiền tố mã: 2–6 ký tự A–Z hoặc 0–9"),
  description: nullableText(5000),
  defaultMaintenanceIntervalDays: z
    .number()
    .int()
    .positive()
    .max(ASSET_INTERVAL_DAYS_MAX)
    .nullish(),
  sortOrder: z.number().int().min(0).max(ASSET_SORT_ORDER_MAX).optional(),
});
export type CreateAssetCategoryDto = z.infer<typeof createAssetCategorySchema>;

/**
 * PATCH loại. `codePrefix` khoá ở service khi loại đã sinh mã (ASSET-ERR-010 `prefix-locked`). `restore: true`
 * = khôi phục loại đã xoá mềm (đường DUY NHẤT để dùng lại prefix — DB-15 §6.7). `code` KHÔNG đổi qua PATCH.
 */
export const updateAssetCategorySchema = createAssetCategorySchema
  .omit({ code: true })
  .partial()
  .extend({
    isActive: z.boolean().optional(),
    restore: z.literal(true).optional(),
  })
  // `.strict()` như PATCH hồ sơ: gửi `code` (bất biến) hay khoá lạ ⇒ 400, không strip im lặng (gate LOW).
  .strict();
export type UpdateAssetCategoryDto = z.infer<typeof updateAssetCategorySchema>;

export const assetCategoryResponseSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  codePrefix: z.string(),
  description: z.string().nullable(),
  defaultMaintenanceIntervalDays: z.number().int().nullable(),
  isActive: z.boolean(),
  sortOrder: z.number().int(),
  /** Chỉ có khi `includeDeleted=true` được honour. */
  deleted: z.boolean().optional(),
  deletedAt: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AssetCategoryResponseDto = z.infer<typeof assetCategoryResponseSchema>;

// ── Hồ sơ tài sản (ASSET-API-005..009, 024) ───────────────────────────────────────────────────────

/** `status` nhận CSV (`?status=In Stock,Assigned`) HOẶC mảng — preprocess idempotent với mảng. */
const statusListQuerySchema = z.preprocess((v) => {
  if (typeof v === "string") {
    return v
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  return v;
}, z.array(assetLifecycleStatusSchema).min(1).optional());

export const listAssetsQuerySchema = z.object({
  categoryId: z.string().uuid().optional(),
  status: statusListQuerySchema,
  /** Lọc theo người ĐANG giữ (lượt Active) — phục vụ màn offboarding. Vẫn qua scope của caller. */
  holderEmployeeId: z.string().uuid().optional(),
  q: z.string().trim().min(1).max(120).optional(),
  maintenanceDueBefore: assetDateSchema.optional(),
  sortBy: z.enum(["assetCode", "createdAt"]).default("assetCode"),
  sortDir: z.enum(["asc", "desc"]).default("asc"),
  ...pageQuerySchema,
});
export type ListAssetsQueryDto = z.infer<typeof listAssetsQuerySchema>;

export const assetSummaryQuerySchema = z.object({
  categoryId: z.string().uuid().optional(),
});
export type AssetSummaryQueryDto = z.infer<typeof assetSummaryQuerySchema>;

export const createAssetSchema = z.object({
  categoryId: z.string().uuid(),
  name: z.string().trim().min(1).max(255),
  serialNumber: nullableText(120),
  brand: nullableText(120),
  model: nullableText(120),
  purchaseDate: assetDateSchema.nullish(),
  /** Trường tài chính — chỉ trả ở scope Company (SPEC-13 §18). */
  purchasePrice: moneySchema.nullish(),
  supplier: nullableText(255),
  warrantyEndDate: assetDateSchema.nullish(),
  location: nullableText(255),
  description: nullableText(5000),
});
export type CreateAssetDto = z.infer<typeof createAssetSchema>;

/**
 * PATCH hồ sơ — `.strict()`: body mang `assetCode`/`status` (hoặc bất kỳ khoá lạ) ⇒ 400 VALIDATION-ERR ở biên
 * (quyết định S11-ASSET-BE-1 plan §1.1 — không có nhánh service nào kiểm được khoá đã bị Zod strip).
 */
export const updateAssetSchema = createAssetSchema
  .partial()
  .strict()
  .refine((o) => Object.keys(o).length > 0, { message: "Body PATCH không được rỗng" });
export type UpdateAssetDto = z.infer<typeof updateAssetSchema>;

export const assetCategoryRefSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
});

/**
 * Người đang giữ — VẮNG KHOÁ (không `null`) khi ngoài scope danh tính của caller (SPEC-13 §13.6):
 * Own chỉ khi là chính caller · Department chỉ nhân viên trong đơn vị · Company đủ.
 */
export const assetCurrentHolderSchema = z.object({
  employeeId: z.string().uuid(),
  employeeCode: z.string().nullable(),
  fullName: z.string().nullable(),
  assignedAt: z.string(),
});
export type AssetCurrentHolderDto = z.infer<typeof assetCurrentHolderSchema>;

export const assetListItemResponseSchema = z.object({
  id: z.string().uuid(),
  assetCode: z.string(),
  name: z.string(),
  category: assetCategoryRefSchema,
  status: assetLifecycleStatusSchema,
  serialNumber: z.string().nullable(),
  brand: z.string().nullable(),
  model: z.string().nullable(),
  location: z.string().nullable(),
  nextMaintenanceDue: z.string().nullable(),
  currentHolder: assetCurrentHolderSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AssetListItemResponseDto = z.infer<typeof assetListItemResponseSchema>;

export const assetOpenMaintenanceRefSchema = z.object({
  id: z.string().uuid(),
  openedAt: z.string(),
  reason: z.string(),
  vendor: z.string().nullable(),
});

/**
 * Chi tiết (ASSET-API-007). `purchasePrice`/`supplier` CHỈ có khoá khi scope hiệu dụng = Company — FE PHẢI
 * `.optional()` (memory `server-masking-needs-optional-fe-schema`). `counts.assignments` đếm trên tập đã lọc scope.
 */
export const assetDetailResponseSchema = assetListItemResponseSchema.extend({
  purchaseDate: z.string().nullable(),
  purchasePrice: z.number().nullable().optional(),
  supplier: z.string().nullable().optional(),
  warrantyEndDate: z.string().nullable(),
  conditionNote: z.string().nullable(),
  statusReason: z.string().nullable(),
  statusChangedAt: z.string().nullable(),
  description: z.string().nullable(),
  openMaintenance: assetOpenMaintenanceRefSchema.nullable(),
  counts: z.object({
    assignments: z.number().int().nonnegative(),
    maintenances: z.number().int().nonnegative(),
  }),
});
export type AssetDetailResponseDto = z.infer<typeof assetDetailResponseSchema>;

export const assetSummaryResponseSchema = z.object({
  byStatus: z.record(assetLifecycleStatusSchema, z.number().int().nonnegative()),
  byCategory: z.array(
    z.object({
      categoryId: z.string().uuid(),
      code: z.string(),
      name: z.string(),
      total: z.number().int().nonnegative(),
      assigned: z.number().int().nonnegative(),
    }),
  ),
  /** `next_maintenance_due ≤ hôm nay + 7`, không Disposed/Lost — cùng cửa sổ job ASSET_MAINTENANCE_DUE. */
  maintenanceDueSoon: z.number().int().nonnegative(),
});
export type AssetSummaryResponseDto = z.infer<typeof assetSummaryResponseSchema>;

// ── Cấp phát / thu hồi (ASSET-API-010..012) ───────────────────────────────────────────────────────

export const assignAssetSchema = z.object({
  employeeId: z.string().uuid(),
  issueCondition: assetIssueConditionSchema.optional(),
  issueNote: nullableText(2000),
  expectedReturnDate: assetDateSchema.nullish(),
});
export type AssignAssetDto = z.infer<typeof assignAssetSchema>;

/** `returnCondition` BẮT BUỘC (ASSET-ERR-016 — CHECK DB cho NULL vì hàng Active, nhưng Returned luôn có). */
export const revokeAssetSchema = z.object({
  returnCondition: assetReturnConditionSchema,
  returnNote: nullableText(2000),
});
export type RevokeAssetDto = z.infer<typeof revokeAssetSchema>;

export const listAssetAssignmentsQuerySchema = z.object({ ...pageQuerySchema });
export type ListAssetAssignmentsQueryDto = z.infer<typeof listAssetAssignmentsQuerySchema>;

export const assetAssignmentResponseSchema = z.object({
  id: z.string().uuid(),
  assetId: z.string().uuid(),
  employeeId: z.string().uuid(),
  employeeCode: z.string().nullable(),
  employeeFullName: z.string().nullable(),
  assignedAt: z.string(),
  assignedBy: z.string().uuid().nullable(),
  issueCondition: assetIssueConditionSchema.nullable(),
  issueNote: z.string().nullable(),
  expectedReturnDate: z.string().nullable(),
  status: assetAssignmentStatusSchema,
  returnedAt: z.string().nullable(),
  returnedBy: z.string().uuid().nullable(),
  returnCondition: assetReturnConditionSchema.nullable(),
  returnNote: z.string().nullable(),
});
export type AssetAssignmentResponseDto = z.infer<typeof assetAssignmentResponseSchema>;

// ── Bảo trì (ASSET-API-013..015) ──────────────────────────────────────────────────────────────────

export const openMaintenanceSchema = z.object({
  reason: z.string().trim().min(1).max(2000),
  vendor: nullableText(255),
});
export type OpenMaintenanceDto = z.infer<typeof openMaintenanceSchema>;

export const closeMaintenanceSchema = z.object({
  resultNote: nullableText(2000),
  /** Trường tài chính — chỉ trả ở scope Company. */
  cost: moneySchema.nullish(),
  /** > ngày đóng (ASSET-ERR-014 ở service); ghi vào `assets.next_maintenance_due`. */
  nextDueDate: assetDateSchema.nullish(),
});
export type CloseMaintenanceDto = z.infer<typeof closeMaintenanceSchema>;

export const listAssetMaintenancesQuerySchema = z.object({ ...pageQuerySchema });
export type ListAssetMaintenancesQueryDto = z.infer<typeof listAssetMaintenancesQuerySchema>;

export const assetMaintenanceResponseSchema = z.object({
  id: z.string().uuid(),
  assetId: z.string().uuid(),
  openedAt: z.string(),
  openedBy: z.string().uuid().nullable(),
  reason: z.string(),
  vendor: z.string().nullable(),
  status: assetMaintenanceStatusSchema,
  closedAt: z.string().nullable(),
  closedBy: z.string().uuid().nullable(),
  resultNote: z.string().nullable(),
  /** Chỉ có khoá ở scope Company. */
  cost: z.number().nullable().optional(),
  nextDueDate: z.string().nullable(),
});
export type AssetMaintenanceResponseDto = z.infer<typeof assetMaintenanceResponseSchema>;

// ── Thanh lý / mất / tìm thấy lại (ASSET-API-016..017) ────────────────────────────────────────────

export const ASSET_REASON_MIN = 3;

export const disposeAssetSchema = z.object({
  kind: assetDisposeKindSchema,
  reason: z.string().trim().min(ASSET_REASON_MIN).max(2000),
});
export type DisposeAssetDto = z.infer<typeof disposeAssetSchema>;

export const recoverAssetSchema = z.object({
  reason: z.string().trim().min(ASSET_REASON_MIN).max(2000),
});
export type RecoverAssetDto = z.infer<typeof recoverAssetSchema>;

// ── Kiểm kê (ASSET-API-018..022) ──────────────────────────────────────────────────────────────────

export const listAssetInventoriesQuerySchema = z.object({
  status: assetInventoryStatusSchema.optional(),
  ...pageQuerySchema,
});
export type ListAssetInventoriesQueryDto = z.infer<typeof listAssetInventoriesQuerySchema>;

export const openInventorySchema = z.object({
  name: z.string().trim().min(1).max(255),
  /** NULL = toàn bộ tài sản. */
  categoryId: z.string().uuid().nullish(),
  note: nullableText(2000),
});
export type OpenInventoryDto = z.infer<typeof openInventorySchema>;

export const listAssetInventoryItemsQuerySchema = z.object({
  result: assetInventoryItemResultSchema.optional(),
  ...pageQuerySchema,
});
export type ListAssetInventoryItemsQueryDto = z.infer<typeof listAssetInventoryItemsQuerySchema>;

/**
 * Kết quả đánh dấu qua API — CHẶT HƠN CHECK CÓ CHỦ ĐÍCH: không có đường API đặt lại "Not Checked"
 * (SPEC-13 §13.4: `result ∈ Found/Missing`). Đây không phải trôi hợp đồng — ghi rõ ở plan §11.
 */
export const assetInventoryMarkResultSchema = z.enum(["Found", "Missing"]);
export type AssetInventoryMarkResultDto = z.infer<typeof assetInventoryMarkResultSchema>;

export const markInventoryItemSchema = z.object({
  result: assetInventoryMarkResultSchema,
  note: nullableText(2000),
});
export type MarkInventoryItemDto = z.infer<typeof markInventoryItemSchema>;

export const bulkMarkInventoryItemsSchema = z.object({
  itemIds: z.array(z.string().uuid()).min(1).max(ASSET_BULK_MARK_MAX),
  result: assetInventoryMarkResultSchema,
  note: nullableText(2000),
});
export type BulkMarkInventoryItemsDto = z.infer<typeof bulkMarkInventoryItemsSchema>;

export const closeInventorySchema = z.object({
  note: nullableText(2000),
});
export type CloseInventoryDto = z.infer<typeof closeInventorySchema>;

export const assetInventoryResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  categoryId: z.string().uuid().nullable(),
  status: assetInventoryStatusSchema,
  openedAt: z.string(),
  openedBy: z.string().uuid().nullable(),
  closedAt: z.string().nullable(),
  closedBy: z.string().uuid().nullable(),
  note: z.string().nullable(),
  totalItems: z.number().int().nullable(),
  foundCount: z.number().int().nullable(),
  missingCount: z.number().int().nullable(),
  notCheckedCount: z.number().int().nullable(),
});
export type AssetInventoryResponseDto = z.infer<typeof assetInventoryResponseSchema>;

export const assetInventoryItemResponseSchema = z.object({
  id: z.string().uuid(),
  inventoryId: z.string().uuid(),
  assetId: z.string().uuid(),
  assetCode: z.string(),
  assetName: z.string(),
  expectedStatus: assetInventoryExpectedStatusSchema,
  expectedHolderEmployeeId: z.string().uuid().nullable(),
  result: assetInventoryItemResultSchema,
  checkedAt: z.string().nullable(),
  checkedBy: z.string().uuid().nullable(),
  note: z.string().nullable(),
});
export type AssetInventoryItemResponseDto = z.infer<typeof assetInventoryItemResponseSchema>;

// ── Tài sản của tôi (ASSET-API-023) ───────────────────────────────────────────────────────────────

/** CỐ Ý KHÔNG có `employeeId` — chủ thể lấy từ token (SPEC-09 §14.4, chống IDOR). */
export const meAssetsQuerySchema = z.object({
  includeReturned: queryBoolSchema,
  ...pageQuerySchema,
});
export type MeAssetsQueryDto = z.infer<typeof meAssetsQuerySchema>;

/** KHÔNG BAO GIỜ có trường tài chính — bất kể data_scope của caller (SPEC-13 §18). */
export const meAssetItemResponseSchema = z.object({
  assignmentId: z.string().uuid(),
  assetId: z.string().uuid(),
  assetCode: z.string(),
  assetName: z.string(),
  category: assetCategoryRefSchema,
  assetStatus: assetLifecycleStatusSchema,
  serialNumber: z.string().nullable(),
  assignedAt: z.string(),
  issueCondition: assetIssueConditionSchema.nullable(),
  expectedReturnDate: z.string().nullable(),
  assignmentStatus: assetAssignmentStatusSchema,
  returnedAt: z.string().nullable(),
  returnCondition: assetReturnConditionSchema.nullable(),
});
export type MeAssetItemResponseDto = z.infer<typeof meAssetItemResponseSchema>;
