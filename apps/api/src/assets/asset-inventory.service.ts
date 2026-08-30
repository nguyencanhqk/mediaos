import { Injectable } from "@nestjs/common";
import type {
  AssetInventoryItemResponseDto,
  AssetInventoryResponseDto,
  BulkMarkInventoryItemsDto,
  CloseInventoryDto,
  ListAssetInventoriesQueryDto,
  ListAssetInventoryItemsQueryDto,
  MarkInventoryItemDto,
  OpenInventoryDto,
} from "@mediaos/contracts";
import { paginated, toPagination, type PaginatedResult } from "../common/pagination";
import { DatabaseService, type TenantTx } from "../db/db.service";
import type { AssetInventory } from "../db/schema/assets";
import { AuditService } from "../events/audit.service";
import { AssetAccessService } from "./asset-access.service";
import { AssetCategoriesRepository } from "./asset-categories.repository";
import { AssetInventoryRepository } from "./asset-inventory.repository";
import {
  ASSET_ERR,
  ASSET_ERR_CODE,
  assetDetails,
  conflict,
  notFound,
  rethrowAssetPgError,
} from "./assets.errors";
import { toAssetInventoryDto, toAssetInventoryItemDto } from "./assets.mapper";
import type { AssetRequestUser } from "./assets.types";

/**
 * S11-ASSET-BE-1 — AssetInventoryService (018–022, SPEC-13 §13.4).
 *
 *   • Đợt kiểm kê chỉ thuộc Company (§13.6): danh sách 018 trả RỖNG ở Own/Department (không lỗi); chi tiết
 *     020 trả **404** (giống đợt không tồn tại).
 *   • Mở đợt = INSERT đợt + `INSERT … SELECT` ảnh chụp lọc Disposed/Lost — 1 tx; chốt cuối `uq_asset_inventories_open`.
 *   • Đánh dấu/đóng = 1 câu UPDATE gate `status='Open'` trong WHERE; 4 số tổng kết tính TRONG SQL.
 *   • Đóng đợt KHÔNG đổi `assets.status` (Missing ≠ Lost — xác nhận từng cái ở màn 002).
 */
@Injectable()
export class AssetInventoryService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: AssetAccessService,
    private readonly repo: AssetInventoryRepository,
    private readonly categories: AssetCategoriesRepository,
    private readonly audit: AuditService,
  ) {}

  /** 018 — Company thấy đủ; scope khác ⇒ rỗng. */
  async list(
    user: AssetRequestUser,
    q: ListAssetInventoriesQueryDto,
  ): Promise<PaginatedResult<AssetInventoryResponseDto[]>> {
    return this.db.withTenant(user.companyId, async (tx) => {
      const actor = await this.access.resolveActorScope(tx, user);
      if (!actor.isCompanyScope) return paginated([], toPagination(0, q.page, q.per_page));
      const { rows, total } = await this.repo.listTx(tx, user.companyId, q.status, {
        page: q.page,
        perPage: q.per_page,
      });
      return paginated(rows.map(toAssetInventoryDto), toPagination(total, q.page, q.per_page));
    });
  }

  /** 020a — Own/Department ⇒ 404 (không 403, không rỗng). */
  async get(user: AssetRequestUser, id: string): Promise<AssetInventoryResponseDto> {
    return this.db.withTenant(user.companyId, async (tx) => {
      const actor = await this.access.resolveActorScope(tx, user);
      const row = await this.requireCompanyInventoryTx(
        tx,
        user.companyId,
        id,
        actor.isCompanyScope,
      );
      return toAssetInventoryDto(row);
    });
  }

  /** 020b — dòng của đợt (filter `result`, phân trang). */
  async listItems(
    user: AssetRequestUser,
    id: string,
    q: ListAssetInventoryItemsQueryDto,
  ): Promise<PaginatedResult<AssetInventoryItemResponseDto[]>> {
    return this.db.withTenant(user.companyId, async (tx) => {
      const actor = await this.access.resolveActorScope(tx, user);
      await this.requireCompanyInventoryTx(tx, user.companyId, id, actor.isCompanyScope);
      const { rows, total } = await this.repo.listItemsTx(tx, user.companyId, id, q.result, {
        page: q.page,
        perPage: q.per_page,
      });
      return paginated(rows.map(toAssetInventoryItemDto), toPagination(total, q.page, q.per_page));
    });
  }

  /** 019 — mở đợt + ảnh chụp, 1 tx. */
  async open(user: AssetRequestUser, dto: OpenInventoryDto): Promise<AssetInventoryResponseDto> {
    await this.access.assertCan(user, "manage", "asset-inventory");
    return this.db.withTenant(user.companyId, async (tx) => {
      if (dto.categoryId) {
        const cat = await this.categories.findByIdTx(tx, user.companyId, dto.categoryId);
        if (!cat) throw notFound(ASSET_ERR.REF_NOT_FOUND("loại tài sản"));
      }
      const inventory = await this.repo
        .insertTx(tx, user.companyId, {
          name: dto.name,
          categoryId: dto.categoryId ?? null,
          note: dto.note ?? null,
          openedBy: user.id,
        })
        .catch((err: unknown) => rethrowAssetPgError(err));
      const snapshotCount = await this.repo
        .snapshotItemsTx(tx, user.companyId, inventory.id, dto.categoryId ?? null)
        .catch((err: unknown) => rethrowAssetPgError(err));
      await this.audit.record(tx, {
        action: "AssetInventoryOpened",
        objectType: "asset_inventory",
        objectId: inventory.id,
        actorUserId: user.id,
        after: {
          id: inventory.id,
          name: inventory.name,
          categoryId: inventory.categoryId,
          snapshotCount,
        },
      });
      return toAssetInventoryDto(inventory);
    });
  }

  /** 021a — đánh dấu 1 dòng. */
  async markOne(
    user: AssetRequestUser,
    id: string,
    itemId: string,
    dto: MarkInventoryItemDto,
  ): Promise<void> {
    await this.markMany(user, id, { itemIds: [itemId], result: dto.result, note: dto.note });
  }

  /** 021b — đánh dấu hàng loạt (≤200 — trần ở Zod). */
  async markMany(
    user: AssetRequestUser,
    id: string,
    dto: BulkMarkInventoryItemsDto,
  ): Promise<void> {
    await this.access.assertCan(user, "manage", "asset-inventory");
    await this.db.withTenant(user.companyId, async (tx) => {
      const itemIds = [...new Set(dto.itemIds)];
      // FOR UPDATE hàng đợt TRƯỚC (gate HIGH-1): mark/close xếp hàng — EXISTS trong markItemsTx chỉ là lưới thứ hai.
      const locked = await this.repo.lockByIdTx(tx, user.companyId, id);
      if (!locked) throw notFound(ASSET_ERR.REF_NOT_FOUND("đợt kiểm kê"));
      if (locked.status === "Closed") {
        throw conflict(
          ASSET_ERR_CODE.INVENTORY_CLOSED,
          ASSET_ERR.INVENTORY_CLOSED,
          assetDetails("already-closed"),
        );
      }
      const updated = await this.repo.markItemsTx(tx, user.companyId, id, itemIds, {
        result: dto.result,
        note: dto.note ?? null,
        userId: user.id,
      });
      if (updated.length !== itemIds.length) {
        // Chẩn đoán (chỉ CHỌN THÔNG ĐIỆP, không gate ghi tiếp): đợt không có → 404 · Closed → 409 · dòng lạ → 404.
        const inv = await this.repo.findByIdTx(tx, user.companyId, id);
        if (!inv) throw notFound(ASSET_ERR.REF_NOT_FOUND("đợt kiểm kê"));
        if (inv.status === "Closed") {
          throw conflict(
            ASSET_ERR_CODE.INVENTORY_CLOSED,
            ASSET_ERR.INVENTORY_CLOSED,
            assetDetails("already-closed"),
          );
        }
        const missing = itemIds.filter((x) => !updated.includes(x));
        throw notFound(ASSET_ERR.REF_NOT_FOUND(`dòng kiểm kê (${missing.length} dòng)`));
      }
      await this.audit.record(tx, {
        action: "AssetInventoryItemsMarked",
        objectType: "asset_inventory",
        objectId: id,
        actorUserId: user.id,
        after: { itemIds, result: dto.result, note: dto.note ?? null },
      });
    });
  }

  /** 022 — đóng đợt: 1 UPDATE, 4 số trong SQL; không đổi trạng thái tài sản. */
  async close(
    user: AssetRequestUser,
    id: string,
    dto: CloseInventoryDto,
  ): Promise<AssetInventoryResponseDto> {
    await this.access.assertCan(user, "manage", "asset-inventory");
    return this.db.withTenant(user.companyId, async (tx) => {
      // FOR UPDATE (gate HIGH-1): 4 số tổng kết chỉ tính sau khi mọi mark đang chạy đã commit hoặc bị chặn.
      const current = await this.repo.lockByIdTx(tx, user.companyId, id);
      if (!current) throw notFound(ASSET_ERR.REF_NOT_FOUND("đợt kiểm kê"));
      const closed = await this.repo.closeTx(tx, user.companyId, id, {
        note: dto.note,
        userId: user.id,
      });
      if (!closed) {
        throw conflict(
          ASSET_ERR_CODE.INVENTORY_CLOSED,
          ASSET_ERR.INVENTORY_CLOSED,
          assetDetails("already-closed"),
        );
      }
      await this.audit.record(tx, {
        action: "AssetInventoryClosed",
        objectType: "asset_inventory",
        objectId: id,
        actorUserId: user.id,
        before: { id, status: current.status },
        after: {
          id,
          status: closed.status,
          totalItems: closed.totalItems,
          foundCount: closed.foundCount,
          missingCount: closed.missingCount,
          notCheckedCount: closed.notCheckedCount,
        },
      });
      return toAssetInventoryDto(closed);
    });
  }

  private async requireCompanyInventoryTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    isCompany: boolean,
  ): Promise<AssetInventory> {
    if (!isCompany) throw notFound(ASSET_ERR.REF_NOT_FOUND("đợt kiểm kê"));
    const row = await this.repo.findByIdTx(tx, companyId, id);
    if (!row) throw notFound(ASSET_ERR.REF_NOT_FOUND("đợt kiểm kê"));
    return row;
  }
}
