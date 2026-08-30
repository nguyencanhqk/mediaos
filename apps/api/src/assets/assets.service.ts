import { Injectable } from "@nestjs/common";
import type {
  AssetDetailResponseDto,
  AssetListItemResponseDto,
  AssetSummaryQueryDto,
  AssetSummaryResponseDto,
  CreateAssetDto,
  ListAssetsQueryDto,
  MeAssetItemResponseDto,
  MeAssetsQueryDto,
  UpdateAssetDto,
} from "@mediaos/contracts";
import { paginated, toPagination, type PaginatedResult } from "../common/pagination";
import { DatabaseService, type TenantTx } from "../db/db.service";
import type { Asset } from "../db/schema/assets";
import { AuditService } from "../events/audit.service";
import { SequenceService } from "../foundation/sequences/sequence.service";
import { SequenceNotFoundError } from "../foundation/sequences/sequence.types";
import { AssetAccessService } from "./asset-access.service";
import { AssetAssignmentsRepository } from "./asset-assignments.repository";
import { AssetCategoriesRepository } from "./asset-categories.repository";
import { AssetMaintenanceRepository } from "./asset-maintenance.repository";
import { ASSET_CODE_SEQUENCE_KEY } from "./asset-categories.service";
import {
  ASSET_ERR,
  ASSET_ERR_CODE,
  assetDetails,
  conflict,
  notFound,
  rethrowAssetPgError,
  unprocessable,
} from "./assets.errors";
import {
  toAssetAuditSnapshot,
  toAssetDetailDto,
  toAssetListItemDto,
  toAssetSummaryDto,
  toMeAssetItemDto,
} from "./assets.mapper";
import { AssetsRepository, type AssetListFilter } from "./assets.repository";
import type { AssetActorScope, AssetRequestUser } from "./assets.types";

/**
 * Hôm nay theo UTC (+ `offsetDays`) — ADR-0008 UTC-at-rest; cột `date` thuần. Luật "ngày mua không ở tương lai"
 * dùng `todayUtc(1)`: công ty UTC+7 nhập ngày-hôm-nay-local lúc 00:00–07:00 sẽ sớm hơn UTC 1 ngày — cho phép
 * chênh 1 ngày thay vì 422 oan (gate silent-failure M8; TZ công ty đầy đủ = việc FND chung).
 */
export const todayUtc = (offsetDays = 0): string =>
  new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

/**
 * S11-ASSET-BE-1 — AssetsService: đọc (005/007/024) + CRUD mô tả (006/008/009). Mutation TRẠNG THÁI ở
 * `AssetLifecycleService`/`AssetMaintenanceService` — service này KHÔNG chạm `status`.
 *
 * BẤT BIẾN #1: mọi truy vấn qua `db.withTenant`; #2: xoá MỀM + audit TRONG cùng tx; #3: snapshot audit không tiền.
 * Đọc: scope resolve MỘT lần (`resolveActorScope`), vị từ đi thẳng vào WHERE ⇒ ngoài scope = 404 (§4.5).
 * Ghi: chỉ `assertCan` (mọi cặp ghi @Company — plan §0).
 */
@Injectable()
export class AssetsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: AssetAccessService,
    private readonly repo: AssetsRepository,
    private readonly categories: AssetCategoriesRepository,
    private readonly assignments: AssetAssignmentsRepository,
    private readonly maintenances: AssetMaintenanceRepository,
    private readonly sequence: SequenceService,
    private readonly audit: AuditService,
  ) {}

  // ── Reads ──────────────────────────────────────────────────────────────────

  async list(
    user: AssetRequestUser,
    q: ListAssetsQueryDto,
  ): Promise<PaginatedResult<AssetListItemResponseDto[]>> {
    return this.db.withTenant(user.companyId, async (tx) => {
      const actor = await this.access.resolveActorScope(tx, user);
      const holderFilter = this.scopedHolderFilter(q.holderEmployeeId, actor);
      if (holderFilter === "denied") {
        return paginated([], toPagination(0, q.page, q.per_page));
      }
      const filter: AssetListFilter = {
        categoryId: q.categoryId,
        status: q.status,
        holderEmployeeId: holderFilter,
        q: q.q,
        maintenanceDueBefore: q.maintenanceDueBefore,
        sortBy: q.sortBy,
        sortDir: q.sortDir,
      };
      const { rows, total } = await this.repo.listTx(
        tx,
        user.companyId,
        filter,
        { page: q.page, perPage: q.per_page },
        actor,
      );
      return paginated(rows.map(toAssetListItemDto), toPagination(total, q.page, q.per_page));
    });
  }

  /**
   * Bộ lọc `holderEmployeeId` theo scope (review B9 — chống oracle "ai đang giữ"): Company ⇒ honour; Own/Team ⇒
   * chỉ khi là chính employee của caller; Department ⇒ chỉ nhân viên trong đơn vị. Ngoài scope ⇒ tập RỖNG (không lỗi).
   */
  private scopedHolderFilter(
    holderEmployeeId: string | undefined,
    actor: AssetActorScope,
  ): string | undefined | "denied" {
    if (!holderEmployeeId) return undefined;
    if (actor.scope === "Company" || actor.scope === "System") return holderEmployeeId;
    if (actor.scope === "Department") {
      return actor.deptOrgUnitIds.length > 0 ? holderEmployeeId : "denied";
    }
    return actor.actorEmployeeId === holderEmployeeId ? holderEmployeeId : "denied";
  }

  async summary(user: AssetRequestUser, q: AssetSummaryQueryDto): Promise<AssetSummaryResponseDto> {
    return this.db.withTenant(user.companyId, async (tx) => {
      const actor = await this.access.resolveActorScope(tx, user);
      const rows = await this.repo.summaryTx(tx, user.companyId, q.categoryId, actor);
      return toAssetSummaryDto(rows);
    });
  }

  /**
   * `afterWrite`: đọc lại NGAY SAU một mutation đã commit — writer đã qua cổng ghi @Company nên KHÔNG áp vị từ scope
   * ĐỌC (Own/Department) lên response (gate: có `assign@Company` mà `view@Department` sẽ nhận 404 dù ghi thành công).
   * Masking tài chính/danh tính vẫn theo scope đọc thật của actor.
   */
  async get(
    user: AssetRequestUser,
    id: string,
    opts: { afterWrite?: boolean } = {},
  ): Promise<AssetDetailResponseDto> {
    return this.db.withTenant(user.companyId, async (tx) => {
      const resolved = await this.access.resolveActorScope(tx, user);
      const actor = opts.afterWrite ? { ...resolved, readScopeExists: undefined } : resolved;
      const row = await this.repo.findDetailTx(tx, user.companyId, id, actor);
      if (!row) throw notFound(); // cross-tenant HOẶC ngoài scope — CÙNG 404 (ASSET-ERR-012/013)
      const [openMaintenance, assignments, maintenances] = await Promise.all([
        this.maintenances.findOpenByAssetTx(tx, user.companyId, id),
        this.assignments.countByAssetScopedTx(tx, user.companyId, id, actor),
        this.maintenances.countByAssetTx(tx, user.companyId, id),
      ]);
      return toAssetDetailDto(row, {
        showFinancial: actor.showFinancial,
        openMaintenance: openMaintenance ?? null,
        counts: { assignments, maintenances },
      });
    });
  }

  // ── Writes (006/008/009) ───────────────────────────────────────────────────

  /**
   * ASSET-API-006. `asset_code` cấp qua SequenceService Ở TX RIÊNG TRƯỚC tx nghiệp vụ (mirror GOAL — `nextCode`
   * tự mở `withTenant`, KHÔNG lồng). Thiếu counter ⇒ 409 COUNTER-MISSING (fail-loud, không tự tạo — SPEC-13 §13.5).
   */
  async create(user: AssetRequestUser, dto: CreateAssetDto): Promise<AssetDetailResponseDto> {
    await this.access.assertCan(user, "create", "asset");
    this.assertDates({ purchaseDate: dto.purchaseDate, warrantyEndDate: dto.warrantyEndDate });
    // Loại phải tồn tại + đang hoạt động — kiểm TRƯỚC khi đốt số counter.
    await this.db.withTenant(user.companyId, async (tx) => {
      await this.requireActiveCategoryTx(tx, user.companyId, dto.categoryId);
    });
    const { code } = await this.sequence
      .nextCode(user.companyId, {
        sequenceKey: ASSET_CODE_SEQUENCE_KEY,
        scopeType: "Custom",
        scopeReferenceId: dto.categoryId,
      })
      .catch((err: unknown) => {
        if (err instanceof SequenceNotFoundError) {
          throw conflict(ASSET_ERR_CODE.COUNTER_MISSING, ASSET_ERR.COUNTER_MISSING);
        }
        throw err;
      });
    const created = await this.db.withTenant(user.companyId, async (tx) => {
      const row = await this.repo
        .insertTx(tx, user.companyId, {
          categoryId: dto.categoryId,
          assetCode: code,
          name: dto.name,
          serialNumber: dto.serialNumber ?? null,
          brand: dto.brand ?? null,
          model: dto.model ?? null,
          purchaseDate: dto.purchaseDate ?? null,
          purchasePrice: dto.purchasePrice == null ? null : String(dto.purchasePrice),
          supplier: dto.supplier ?? null,
          warrantyEndDate: dto.warrantyEndDate ?? null,
          location: dto.location ?? null,
          description: dto.description ?? null,
          createdBy: user.id,
        })
        .catch((err: unknown) =>
          rethrowAssetPgError(err, { serialNumber: dto.serialNumber ?? undefined, code }),
        );
      await this.audit.record(tx, {
        action: "AssetCreated",
        objectType: "asset",
        objectId: row.id,
        actorUserId: user.id,
        after: toAssetAuditSnapshot(row),
      });
      return row;
    });
    return this.get(user, created.id, { afterWrite: true });
  }

  /** ASSET-API-008 — PATCH mô tả; ASSET-ERR-014 kiểm trên giá trị HỢP NHẤT (review B12). */
  async update(
    user: AssetRequestUser,
    id: string,
    dto: UpdateAssetDto,
  ): Promise<AssetDetailResponseDto> {
    await this.access.assertCan(user, "update", "asset");
    await this.db.withTenant(user.companyId, async (tx) => {
      const current = await this.repo.lockByIdTx(tx, user.companyId, id);
      if (!current) throw notFound();
      if (dto.categoryId !== undefined && dto.categoryId !== current.categoryId) {
        await this.requireActiveCategoryTx(tx, user.companyId, dto.categoryId);
      }
      const merged = {
        purchaseDate: dto.purchaseDate === undefined ? current.purchaseDate : dto.purchaseDate,
        warrantyEndDate:
          dto.warrantyEndDate === undefined ? current.warrantyEndDate : dto.warrantyEndDate,
      };
      this.assertDates(merged);
      const updated = await this.repo
        .updateTx(tx, user.companyId, id, {
          categoryId: dto.categoryId,
          name: dto.name,
          serialNumber: dto.serialNumber,
          brand: dto.brand,
          model: dto.model,
          purchaseDate: dto.purchaseDate,
          purchasePrice:
            dto.purchasePrice === undefined
              ? undefined
              : dto.purchasePrice === null
                ? null
                : String(dto.purchasePrice),
          supplier: dto.supplier,
          warrantyEndDate: dto.warrantyEndDate,
          location: dto.location,
          description: dto.description,
          updatedBy: user.id,
        })
        .catch((err: unknown) =>
          rethrowAssetPgError(err, { serialNumber: dto.serialNumber ?? undefined }),
        );
      if (!updated) throw notFound();
      await this.audit.record(tx, {
        action: "AssetUpdated",
        objectType: "asset",
        objectId: id,
        actorUserId: user.id,
        before: toAssetAuditSnapshot(current),
        after: toAssetAuditSnapshot(updated),
      });
    });
    return this.get(user, id, { afterWrite: true });
  }

  /** ASSET-API-009 — xoá MỀM chỉ khi `In Stock` + 0 lịch sử (ASSET-ERR-015). */
  async remove(user: AssetRequestUser, id: string): Promise<void> {
    await this.access.assertCan(user, "delete", "asset");
    await this.db.withTenant(user.companyId, async (tx) => {
      const current = await this.repo.lockByIdTx(tx, user.companyId, id);
      if (!current) throw notFound();
      if (current.status !== "In Stock") {
        throw conflict(
          ASSET_ERR_CODE.DELETE_BLOCKED,
          ASSET_ERR.DELETE_BLOCKED,
          assetDetails("not-in-stock", { status: current.status }),
        );
      }
      const history = await this.repo.countHistoryTx(tx, user.companyId, id);
      if (history.assignments > 0 || history.maintenances > 0) {
        throw conflict(
          ASSET_ERR_CODE.DELETE_BLOCKED,
          ASSET_ERR.DELETE_BLOCKED,
          assetDetails("has-history"),
        );
      }
      const deleted = await this.repo.softDeleteTx(tx, user.companyId, id, user.id);
      if (!deleted) throw notFound();
      await this.audit.record(tx, {
        action: "AssetDeleted",
        objectType: "asset",
        objectId: id,
        actorUserId: user.id,
        before: toAssetAuditSnapshot(current),
        after: toAssetAuditSnapshot(deleted),
      });
    });
  }

  /**
   * ASSET-API-023 `/me/assets` — employee LUÔN từ token; không có hồ sơ ⇒ rỗng (không lỗi). KHÔNG BAO GIỜ có
   * trường tài chính bất kể data_scope (repository không SELECT, mapper không chép — SPEC-13 §18).
   */
  async listMine(
    user: AssetRequestUser,
    q: MeAssetsQueryDto,
  ): Promise<PaginatedResult<MeAssetItemResponseDto[]>> {
    await this.access.assertCan(user, "view", "asset");
    return this.db.withTenant(user.companyId, async (tx) => {
      const employee = await this.access.findEmployeeByUserTx(tx, user.companyId, user.id);
      if (!employee) return paginated([], toPagination(0, q.page, q.per_page));
      const { rows, total } = await this.assignments.listMineTx(
        tx,
        user.companyId,
        employee.id,
        q.includeReturned === true,
        { page: q.page, perPage: q.per_page },
      );
      return paginated(rows.map(toMeAssetItemDto), toPagination(total, q.page, q.per_page));
    });
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async requireActiveCategoryTx(
    tx: TenantTx,
    companyId: string,
    categoryId: string,
  ): Promise<void> {
    const cat = await this.categories.findByIdTx(tx, companyId, categoryId);
    if (!cat) throw notFound(ASSET_ERR.REF_NOT_FOUND("loại tài sản"));
    if (!cat.isActive) {
      throw conflict(
        ASSET_ERR_CODE.CATEGORY,
        "ASSET-ERR-010: loại tài sản đang vô hiệu — bật lại trước khi tạo hồ sơ.",
        assetDetails("category-inactive", { categoryId }),
      );
    }
  }

  /** ASSET-ERR-014: `purchase_date > hôm nay` · `warranty_end_date < purchase_date`. */
  private assertDates(v: { purchaseDate?: string | null; warrantyEndDate?: string | null }): void {
    if (v.purchaseDate && v.purchaseDate > todayUtc(1)) {
      throw unprocessable(
        ASSET_ERR_CODE.DATE,
        ASSET_ERR.DATE("ngày mua không được sau hôm nay"),
        assetDetails("purchase-in-future"),
      );
    }
    if (v.purchaseDate && v.warrantyEndDate && v.warrantyEndDate < v.purchaseDate) {
      throw unprocessable(
        ASSET_ERR_CODE.DATE,
        ASSET_ERR.DATE("ngày hết bảo hành phải ≥ ngày mua"),
        assetDetails("warranty-before-purchase"),
      );
    }
  }

  /** Cho service khác đọc hàng đã KHOÁ (đường ghi) — tránh lặp `lockByIdTx` + 404 ở 3 nơi. */
  async lockOrNotFoundTx(tx: TenantTx, companyId: string, id: string): Promise<Asset> {
    const row = await this.repo.lockByIdTx(tx, companyId, id);
    if (!row) throw notFound();
    return row;
  }
}
