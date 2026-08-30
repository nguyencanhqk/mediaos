import { z } from "zod";
import {
  assetCategoryResponseSchema,
  type AssetCategoryResponseDto,
  assetListItemResponseSchema,
  type AssetListItemResponseDto,
  assetDetailResponseSchema,
  type AssetDetailResponseDto,
  assetSummaryResponseSchema,
  type AssetSummaryResponseDto,
  assetAssignmentResponseSchema,
  type AssetAssignmentResponseDto,
  assetMaintenanceResponseSchema,
  type AssetMaintenanceResponseDto,
  assetInventoryResponseSchema,
  type AssetInventoryResponseDto,
  assetInventoryItemResponseSchema,
  type AssetInventoryItemResponseDto,
  meAssetItemResponseSchema,
  type MeAssetItemResponseDto,
  type ListAssetCategoriesQueryDto,
  type CreateAssetCategoryDto,
  type UpdateAssetCategoryDto,
  type ListAssetsQueryDto,
  type AssetSummaryQueryDto,
  type CreateAssetDto,
  type UpdateAssetDto,
  type AssignAssetDto,
  type RevokeAssetDto,
  type ListAssetAssignmentsQueryDto,
  type OpenMaintenanceDto,
  type CloseMaintenanceDto,
  type ListAssetMaintenancesQueryDto,
  type DisposeAssetDto,
  type RecoverAssetDto,
  type ListAssetInventoriesQueryDto,
  type OpenInventoryDto,
  type ListAssetInventoryItemsQueryDto,
  type MarkInventoryItemDto,
  type BulkMarkInventoryItemsDto,
  type CloseInventoryDto,
  type MeAssetsQueryDto,
} from "@mediaos/contracts";
import { apiFetch, apiFetchPaginated, type PaginatedResult } from "./api-client";
import { buildQueryString } from "./api-params";

/**
 * S11-ASSET-FE-1 — ASSET API client (SPEC-13 §15 ASSET-API-001..024). MIRROR BE 4 controller:
 * `AssetsController` · `AssetCategoriesController` · `AssetInventoriesController` · `MeAssetsController`.
 *
 * ⚠️ **PHÂN TRANG: dùng `apiFetchPaginated`, KHÔNG `apiFetch`.** BE ASSET trả `PaginatedResult` ⇒
 * `ResponseEnvelopeInterceptor` hoist block `pagination` lên top-level, nhưng `unwrapEnvelope` của
 * `apiFetch` chỉ trích `.data` và **vứt** `pagination` (memory `apifetch-drops-pagination-bare-array`).
 * Đi đường `apiFetch` thì màn danh sách mất `total` và phải đoán "còn trang sau" bằng heuristic
 * `items.length === per_page` — sai ngay ở trang cuối vừa đúng bội số. ASSET dùng `page`/`per_page`
 * (KHÔNG `limit`/`offset` như GOAL) để khớp envelope API-01 §7.2.
 *
 * Endpoint KHÔNG phân trang (`/asset-categories`, `/assets/summary`, chi tiết) vẫn đi `apiFetch` —
 * chúng trả mảng trần / object trần, không có block pagination để mà đọc.
 *
 * company_id + data-scope + masking là việc của SERVER — client chỉ gửi filter/id, KHÔNG gửi
 * company_id. Response validate Zod ở ranh giới; shape sai ⇒ ném ngay (KHÔNG âm thầm render sai).
 *
 * Trường tài chính (`purchasePrice`/`supplier`) **vắng khoá** khi scope hiệu dụng < Company — contracts
 * đã khai `.optional()`, KHÔNG được siết lại ở đây (memory `server-masking-needs-optional-fe-schema`:
 * schema chặt hơn server làm ZodError trắng trang đúng cho người vừa được bảo vệ).
 */
export const assetApi = {
  // ── Loại tài sản (ASSET-API-001..004) ───────────────────────────────────────────────────────────

  /**
   * GET /asset-categories — danh mục loại (`view:asset`). Mảng trần, KHÔNG phân trang.
   *
   * `includeDeleted` chỉ được server honour khi caller có `('manage','asset-category')`; thiếu quyền
   * thì tham số bị BỎ QUA (không 403). Đây là đường DUY NHẤT phát ra id của loại đã xoá mềm — không
   * có nó thì `restore` là route chết.
   */
  listCategories: (
    query?: Partial<ListAssetCategoriesQueryDto>,
  ): Promise<AssetCategoryResponseDto[]> =>
    apiFetch(
      `/asset-categories${buildQueryString(query ?? {})}`,
      z.array(assetCategoryResponseSchema),
    ),

  /** POST /asset-categories — tạo loại + bộ đếm mã trong CÙNG tx (`manage:asset-category`). */
  createCategory: (body: CreateAssetCategoryDto): Promise<AssetCategoryResponseDto> =>
    apiFetch("/asset-categories", assetCategoryResponseSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /**
   * PATCH /asset-categories/:id — sửa loại HOẶC khôi phục (`manage:asset-category`).
   * `{ restore: true }` đặt `deleted_at = NULL` và GIỮ bộ đếm (đếm tiếp) — đường duy nhất dùng lại
   * một `code_prefix` đã tiêu, vì unique trên prefix KHÔNG partial.
   */
  updateCategory: (id: string, body: UpdateAssetCategoryDto): Promise<AssetCategoryResponseDto> =>
    apiFetch(`/asset-categories/${id}`, assetCategoryResponseSchema, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  /** DELETE /asset-categories/:id — xoá mềm, chặn khi còn tài sản (ASSET-ERR-010 `has-assets`). */
  deleteCategory: (id: string): Promise<void> =>
    apiFetch(`/asset-categories/${id}`, z.void(), { method: "DELETE" }),

  // ── Hồ sơ tài sản (ASSET-API-005..009, 024) ─────────────────────────────────────────────────────

  /** GET /assets — danh sách theo data_scope (`view:asset`), CÓ phân trang. */
  listAssets: (
    query?: Partial<ListAssetsQueryDto>,
  ): Promise<PaginatedResult<AssetListItemResponseDto[]>> =>
    apiFetchPaginated(
      `/assets${buildQueryString(query ?? {})}`,
      z.array(assetListItemResponseSchema),
    ),

  /** GET /assets/summary — đếm theo trạng thái × loại trong scope (`view:asset`). Object trần. */
  getSummary: (query?: Partial<AssetSummaryQueryDto>): Promise<AssetSummaryResponseDto> =>
    apiFetch(`/assets/summary${buildQueryString(query ?? {})}`, assetSummaryResponseSchema),

  /** GET /assets/:id — chi tiết + người giữ + đếm lượt (`view:asset`). Ngoài scope ⇒ 404. */
  getAsset: (id: string): Promise<AssetDetailResponseDto> =>
    apiFetch(`/assets/${id}`, assetDetailResponseSchema),

  /** POST /assets — tạo hồ sơ (`create:asset`); `assetCode` sinh ở SERVER. */
  createAsset: (body: CreateAssetDto): Promise<AssetDetailResponseDto> =>
    apiFetch("/assets", assetDetailResponseSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** PATCH /assets/:id — sửa mô tả (`update:asset`). KHÔNG nhận `assetCode`/`status` (schema strict). */
  updateAsset: (id: string, body: UpdateAssetDto): Promise<AssetDetailResponseDto> =>
    apiFetch(`/assets/${id}`, assetDetailResponseSchema, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  /** DELETE /assets/:id — xoá mềm có điều kiện (`delete:asset`, ASSET-ERR-015). */
  deleteAsset: (id: string): Promise<void> =>
    apiFetch(`/assets/${id}`, z.void(), { method: "DELETE" }),

  // ── Cấp phát / thu hồi (ASSET-API-010..012) ─────────────────────────────────────────────────────

  /**
   * POST /assets/:id/assign — cấp phát 1 bước (`assign:asset`).
   *
   * `idempotencyKey` do CLIENT sinh khi mở form (SPEC-13 §12) — server KHÔNG suy khoá từ payload:
   * ngày cấp không nằm trong body nên mọi khoá "suy từ payload" buộc phải lấy đồng hồ server (vi phạm
   * `period-key-idempotency-needs-frozen-source`), và nó chặn nhầm ca hợp lệ "thu hồi rồi cấp lại cùng
   * người trong ngày". Tham số để BẮT BUỘC ở đây (không `?`) dù interceptor cho phép vắng: FE ASSET
   * luôn gửi, và quên gửi thì bấm-đúp tạo hai lượt mà không có gì đỏ.
   */
  assignAsset: (
    id: string,
    body: AssignAssetDto,
    idempotencyKey: string,
  ): Promise<AssetDetailResponseDto> =>
    apiFetch(
      `/assets/${id}/assign`,
      assetDetailResponseSchema,
      { method: "POST", body: JSON.stringify(body) },
      { idempotencyKey },
    ),

  /**
   * POST /assets/:id/revoke — thu hồi (`revoke:asset`).
   * `returnCondition: "Lost"` đưa tài sản sang `Lost` thay vì về kho (SPEC-13 §13.2).
   */
  revokeAsset: (id: string, body: RevokeAssetDto): Promise<AssetDetailResponseDto> =>
    apiFetch(`/assets/${id}/revoke`, assetDetailResponseSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** GET /assets/:id/assignments — lịch sử cấp phát (`view:asset`), mới nhất trước, CÓ phân trang. */
  listAssignments: (
    id: string,
    query?: Partial<ListAssetAssignmentsQueryDto>,
  ): Promise<PaginatedResult<AssetAssignmentResponseDto[]>> =>
    apiFetchPaginated(
      `/assets/${id}/assignments${buildQueryString(query ?? {})}`,
      z.array(assetAssignmentResponseSchema),
    ),

  // ── Bảo trì (ASSET-API-013..015) ────────────────────────────────────────────────────────────────

  /** POST /assets/:id/maintenances — mở lượt (`manage:asset-maintenance`), ASSET-ERR-004 nếu đã có Open. */
  openMaintenance: (id: string, body: OpenMaintenanceDto): Promise<AssetMaintenanceResponseDto> =>
    apiFetch(`/assets/${id}/maintenances`, assetMaintenanceResponseSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** POST /assets/:id/maintenances/:maintenanceId/close — đóng lượt; trạng thái sau là DẪN XUẤT (§13.1). */
  closeMaintenance: (
    id: string,
    maintenanceId: string,
    body: CloseMaintenanceDto,
  ): Promise<AssetMaintenanceResponseDto> =>
    apiFetch(`/assets/${id}/maintenances/${maintenanceId}/close`, assetMaintenanceResponseSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** GET /assets/:id/maintenances — lịch sử bảo trì (`view:asset`), CÓ phân trang. */
  listMaintenances: (
    id: string,
    query?: Partial<ListAssetMaintenancesQueryDto>,
  ): Promise<PaginatedResult<AssetMaintenanceResponseDto[]>> =>
    apiFetchPaginated(
      `/assets/${id}/maintenances${buildQueryString(query ?? {})}`,
      z.array(assetMaintenanceResponseSchema),
    ),

  // ── Thanh lý / mất / tìm thấy lại (ASSET-API-016..017) ──────────────────────────────────────────

  /** POST /assets/:id/dispose — `{ kind: 'Disposed' | 'Lost', reason }` (`dispose:asset`). */
  disposeAsset: (id: string, body: DisposeAssetDto): Promise<AssetDetailResponseDto> =>
    apiFetch(`/assets/${id}/dispose`, assetDetailResponseSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** POST /assets/:id/recover — `Lost → In Stock` (`dispose:asset`), lý do bắt buộc. */
  recoverAsset: (id: string, body: RecoverAssetDto): Promise<AssetDetailResponseDto> =>
    apiFetch(`/assets/${id}/recover`, assetDetailResponseSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // ── Kiểm kê (ASSET-API-018..022) ────────────────────────────────────────────────────────────────

  /** GET /asset-inventories — danh sách đợt (`view:asset`, Company scope; scope khác trả rỗng). */
  listInventories: (
    query?: Partial<ListAssetInventoriesQueryDto>,
  ): Promise<PaginatedResult<AssetInventoryResponseDto[]>> =>
    apiFetchPaginated(
      `/asset-inventories${buildQueryString(query ?? {})}`,
      z.array(assetInventoryResponseSchema),
    ),

  /** POST /asset-inventories — mở đợt + snapshot dòng (`manage:asset-inventory`), ASSET-ERR-006. */
  openInventory: (body: OpenInventoryDto): Promise<AssetInventoryResponseDto> =>
    apiFetch("/asset-inventories", assetInventoryResponseSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** GET /asset-inventories/:id — chi tiết đợt (`view:asset`). */
  getInventory: (id: string): Promise<AssetInventoryResponseDto> =>
    apiFetch(`/asset-inventories/${id}`, assetInventoryResponseSchema),

  /** GET /asset-inventories/:id/items — dòng (`view:asset`), filter `result`, CÓ phân trang. */
  listInventoryItems: (
    id: string,
    query?: Partial<ListAssetInventoryItemsQueryDto>,
  ): Promise<PaginatedResult<AssetInventoryItemResponseDto[]>> =>
    apiFetchPaginated(
      `/asset-inventories/${id}/items${buildQueryString(query ?? {})}`,
      z.array(assetInventoryItemResponseSchema),
    ),

  /** PATCH /asset-inventories/:id/items/:itemId — đánh dấu 1 dòng (`manage:asset-inventory`). */
  markInventoryItem: (
    id: string,
    itemId: string,
    body: MarkInventoryItemDto,
  ): Promise<AssetInventoryItemResponseDto> =>
    apiFetch(`/asset-inventories/${id}/items/${itemId}`, assetInventoryItemResponseSchema, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  /** POST /asset-inventories/:id/items/bulk-mark — đánh dấu nhiều dòng (trần `ASSET_BULK_MARK_MAX`). */
  bulkMarkInventoryItems: (
    id: string,
    body: BulkMarkInventoryItemsDto,
  ): Promise<AssetInventoryItemResponseDto[]> =>
    apiFetch(
      `/asset-inventories/${id}/items/bulk-mark`,
      z.array(assetInventoryItemResponseSchema),
      { method: "POST", body: JSON.stringify(body) },
    ),

  /** POST /asset-inventories/:id/close — đóng đợt + cache 4 số tổng kết; KHÔNG tự đổi trạng thái tài sản. */
  closeInventory: (id: string, body: CloseInventoryDto): Promise<AssetInventoryResponseDto> =>
    apiFetch(`/asset-inventories/${id}/close`, assetInventoryResponseSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // ── Tài sản của tôi (ASSET-API-023) ─────────────────────────────────────────────────────────────

  /**
   * GET /me/assets — own-scope (`view:asset`). Employee resolve TỪ TOKEN — endpoint KHÔNG nhận tham số
   * nhân viên (chống IDOR); không có employee profile ⇒ danh sách RỖNG, không phải lỗi.
   * KHÔNG BAO GIỜ trả trường tài chính, kể cả khi caller là company-admin.
   */
  listMyAssets: (
    query?: Partial<MeAssetsQueryDto>,
  ): Promise<PaginatedResult<MeAssetItemResponseDto[]>> =>
    apiFetchPaginated(
      `/me/assets${buildQueryString(query ?? {})}`,
      z.array(meAssetItemResponseSchema),
    ),
};
