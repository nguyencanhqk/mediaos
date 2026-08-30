import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type {
  AssetDetailResponseDto,
  AssetMaintenanceResponseDto,
  CloseMaintenanceDto,
  ListAssetMaintenancesQueryDto,
  OpenMaintenanceDto,
} from "@mediaos/contracts";
import { paginated, toPagination, type PaginatedResult } from "../common/pagination";
import { DatabaseService } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { AssetAccessService } from "./asset-access.service";
import { assertTransition, type AssetStatus } from "./asset-fsm";
import { AssetMaintenanceRepository } from "./asset-maintenance.repository";
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
  toAssetMaintenanceDto,
  toMaintenanceAuditSnapshot,
} from "./assets.mapper";
import { AssetsRepository } from "./assets.repository";
import { AssetsService, todayUtc } from "./assets.service";
import type { AssetRequestUser } from "./assets.types";

/**
 * S11-ASSET-BE-1 — AssetMaintenanceService (013/014/015, SPEC-13 §13.3).
 *
 *   • Mở: `assertNoOpenMaintenance` (ERR-004) chạy TRƯỚC `assertTransition` (§13.1) — chốt cuối
 *     `uq_asset_maintenances_open` (23505 → 004).
 *   • Đóng: trạng thái sau = DẪN XUẤT tính TRONG SQL (`CASE WHEN EXISTS(lượt Active) THEN 'Assigned' ELSE 'In Stock'`,
 *     review B5) — không SELECT-rồi-UPDATE ở JS; `next_due_date` ⇒ `assets.next_maintenance_due`.
 */
@Injectable()
export class AssetMaintenanceService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: AssetAccessService,
    private readonly assetsService: AssetsService,
    private readonly assets: AssetsRepository,
    private readonly repo: AssetMaintenanceRepository,
    private readonly audit: AuditService,
  ) {}

  /** 013 — mở lượt; → Under Maintenance. */
  async open(
    user: AssetRequestUser,
    assetId: string,
    dto: OpenMaintenanceDto,
  ): Promise<AssetDetailResponseDto> {
    await this.access.assertCan(user, "manage", "asset-maintenance");
    await this.db.withTenant(user.companyId, async (tx) => {
      const asset = await this.assetsService.lockOrNotFoundTx(tx, user.companyId, assetId);
      const open = await this.repo.findOpenByAssetTx(tx, user.companyId, assetId);
      if (open) {
        throw conflict(
          ASSET_ERR_CODE.MAINTENANCE_OPEN_EXISTS,
          ASSET_ERR.MAINTENANCE_OPEN_EXISTS,
          assetDetails("open-exists", { maintenanceId: open.id }),
        );
      }
      assertTransition(asset.status as AssetStatus, "Under Maintenance", "openMaintenance");
      const row = await this.repo
        .insertOpenTx(tx, user.companyId, {
          assetId,
          reason: dto.reason,
          vendor: dto.vendor ?? null,
          openedBy: user.id,
        })
        .catch((err: unknown) => rethrowAssetPgError(err));
      const updated = await this.assets.transitionTx(
        tx,
        user.companyId,
        assetId,
        ["In Stock", "Assigned"],
        { status: "Under Maintenance", userId: user.id },
      );
      if (!updated) {
        throw conflict(
          ASSET_ERR_CODE.TRANSITION,
          ASSET_ERR.TRANSITION(asset.status, "openMaintenance"),
        );
      }
      await this.audit.record(tx, {
        action: "AssetMaintenanceOpened",
        objectType: "asset_maintenance",
        objectId: row.id,
        actorUserId: user.id,
        before: toAssetAuditSnapshot(asset),
        after: { ...toMaintenanceAuditSnapshot(row), asset: toAssetAuditSnapshot(updated) },
      });
    });
    return this.assetsService.get(user, assetId, { afterWrite: true });
  }

  /** 014 — đóng lượt; trạng thái sau dẫn xuất trong SQL; `nextDueDate` > hôm nay (ASSET-ERR-014). */
  async close(
    user: AssetRequestUser,
    assetId: string,
    maintenanceId: string,
    dto: CloseMaintenanceDto,
  ): Promise<AssetDetailResponseDto> {
    await this.access.assertCan(user, "manage", "asset-maintenance");
    await this.db.withTenant(user.companyId, async (tx) => {
      const asset = await this.assetsService.lockOrNotFoundTx(tx, user.companyId, assetId);
      const m = await this.repo.findByIdForAssetTx(tx, user.companyId, assetId, maintenanceId);
      if (!m) {
        throw notFound(ASSET_ERR.MAINTENANCE_NOT_FOUND);
      }
      if (m.status === "Closed") {
        throw conflict(
          ASSET_ERR_CODE.MAINTENANCE_CLOSE,
          ASSET_ERR.MAINTENANCE_ALREADY_CLOSED,
          assetDetails("already-closed"),
        );
      }
      if (dto.nextDueDate && dto.nextDueDate <= todayUtc()) {
        throw unprocessable(
          ASSET_ERR_CODE.DATE,
          ASSET_ERR.DATE("hạn bảo trì kế tiếp phải sau ngày đóng"),
          assetDetails("next-due-not-after-close"),
        );
      }
      // Đích: Assigned nếu còn lượt Active, ngược lại In Stock — FSM cho phép cả hai từ Under Maintenance.
      assertTransition(asset.status as AssetStatus, "In Stock", "closeMaintenance");
      const closed = await this.repo
        .closeTx(tx, user.companyId, maintenanceId, {
          resultNote: dto.resultNote ?? null,
          cost: dto.cost == null ? null : String(dto.cost),
          nextDueDate: dto.nextDueDate ?? null,
          userId: user.id,
        })
        .catch((err: unknown) => rethrowAssetPgError(err));
      if (!closed) {
        throw conflict(
          ASSET_ERR_CODE.MAINTENANCE_CLOSE,
          ASSET_ERR.MAINTENANCE_ALREADY_CLOSED,
          assetDetails("already-closed"),
        );
      }
      const updated = await this.assets.transitionTx(
        tx,
        user.companyId,
        assetId,
        ["Under Maintenance"],
        {
          status: sql`case when exists (
            select 1 from asset_assignments aa
             where aa.company_id = ${user.companyId} and aa.asset_id = ${assetId} and aa.status = 'Active'
          ) then 'Assigned' else 'In Stock' end`,
          // Không có hạn kế ⇒ XOÁ hạn cũ (gate MEDIUM: hạn cũ trong quá khứ sẽ kẹt trong cửa sổ nhắc/summary mãi).
          nextMaintenanceDue: dto.nextDueDate ?? null,
          userId: user.id,
        },
      );
      if (!updated) {
        throw conflict(
          ASSET_ERR_CODE.TRANSITION,
          ASSET_ERR.TRANSITION(asset.status, "closeMaintenance"),
        );
      }
      await this.audit.record(tx, {
        action: "AssetMaintenanceClosed",
        objectType: "asset_maintenance",
        objectId: closed.id,
        actorUserId: user.id,
        before: { ...toMaintenanceAuditSnapshot(m), asset: toAssetAuditSnapshot(asset) },
        after: { ...toMaintenanceAuditSnapshot(closed), asset: toAssetAuditSnapshot(updated) },
      });
    });
    return this.assetsService.get(user, assetId, { afterWrite: true });
  }

  /** 015 — lịch sử bảo trì trong scope đọc; `cost` chỉ ở Company. */
  async list(
    user: AssetRequestUser,
    assetId: string,
    q: ListAssetMaintenancesQueryDto,
  ): Promise<PaginatedResult<AssetMaintenanceResponseDto[]>> {
    return this.db.withTenant(user.companyId, async (tx) => {
      const actor = await this.access.resolveActorScope(tx, user);
      const visible = await this.assets.findDetailTx(tx, user.companyId, assetId, actor);
      if (!visible) throw notFound();
      const { rows, total } = await this.repo.listByAssetTx(tx, user.companyId, assetId, {
        page: q.page,
        perPage: q.per_page,
      });
      return paginated(
        rows.map((r) => toAssetMaintenanceDto(r, actor.showFinancial)),
        toPagination(total, q.page, q.per_page),
      );
    });
  }
}
