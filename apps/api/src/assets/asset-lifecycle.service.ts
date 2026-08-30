import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type {
  AssetAssignmentResponseDto,
  AssetDetailResponseDto,
  AssignAssetDto,
  DisposeAssetDto,
  ListAssetAssignmentsQueryDto,
  RecoverAssetDto,
  RevokeAssetDto,
} from "@mediaos/contracts";
import { paginated, toPagination, type PaginatedResult } from "../common/pagination";
import { DatabaseService, type TenantTx } from "../db/db.service";
import type { Asset, AssetAssignment, AssetMaintenance } from "../db/schema/assets";
import { AuditService } from "../events/audit.service";
import { OutboxService } from "../events/outbox.service";
import { AssetAccessService } from "./asset-access.service";
import { AssetAssignmentsRepository } from "./asset-assignments.repository";
import { assertTransition, type AssetStatus } from "./asset-fsm";
import { AssetMaintenanceRepository } from "./asset-maintenance.repository";
import {
  ASSET_EVENT_ASSIGNED,
  ASSET_EVENT_REVOKED,
  assetAssignmentPayload,
} from "./asset-noti.payload";
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
  toAssetAssignmentDto,
  toAssetAuditSnapshot,
  toAssignmentAuditSnapshot,
  toMaintenanceAuditSnapshot,
} from "./assets.mapper";
import { AssetsRepository } from "./assets.repository";
import { AssetsService, todayUtc } from "./assets.service";
import type { AssetRequestUser } from "./assets.types";

/**
 * S11-ASSET-BE-1 — AssetLifecycleService: cấp phát (010) · thu hồi (011) · lịch sử (012) · thanh lý/mất (016) ·
 * tìm thấy lại (017). SPEC-13 §13.1/§13.2 — MỘT tx, thứ tự:
 *
 *   1. `lockByIdTx` (`SELECT … FOR UPDATE` hàng assets) — hai request đua xếp hàng ở đây;
 *   2. guard thứ hai theo SỰ TỒN TẠI lượt Active (ASSET-ERR-008) TRƯỚC `assertTransition` cho dispose(Disposed)
 *      (review B3 — cùng khuôn ERR-004 của bảo trì);
 *   3. `assertTransition(from, to, action)` — ma trận §13.1;
 *   4. ghi SỔ (INSERT/UPDATE 1 câu đủ cột CHECK) → UPDATE `assets` `WHERE status IN (from)` (phòng thủ kép);
 *   5. audit (snapshot không tiền) + outbox (cùng tx ⇒ rollback là mất cả).
 *
 * Chốt cuối DB: `uq_asset_assignments_active` (23505 → 001 qua `mapAssetPgError`, KHÔNG 500).
 * Mọi cặp ghi @Company (plan §0) ⇒ chỉ `assertCan`, không có vế scope ghi.
 */
@Injectable()
export class AssetLifecycleService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: AssetAccessService,
    private readonly assetsService: AssetsService,
    private readonly assets: AssetsRepository,
    private readonly assignments: AssetAssignmentsRepository,
    private readonly maintenances: AssetMaintenanceRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /** 010 — cấp phát. Idempotency = `@Idempotent()` ở controller (key do FE sinh — SPEC-13 §12). */
  async assign(
    user: AssetRequestUser,
    assetId: string,
    dto: AssignAssetDto,
  ): Promise<AssetDetailResponseDto> {
    await this.access.assertCan(user, "assign", "asset");
    await this.db.withTenant(user.companyId, async (tx) => {
      const asset = await this.assetsService.lockOrNotFoundTx(tx, user.companyId, assetId);
      assertTransition(asset.status as AssetStatus, "Assigned", "assign");
      const employee = await this.access.findEmployeeByIdTx(tx, user.companyId, dto.employeeId);
      if (!employee) {
        throw notFound(ASSET_ERR.EMPLOYEE_NOT_FOUND);
      }
      if (employee.status !== "active") {
        throw unprocessable(
          ASSET_ERR_CODE.EMPLOYEE,
          ASSET_ERR.EMPLOYEE_INACTIVE,
          assetDetails("employee-inactive", { status: employee.status }),
        );
      }
      if (dto.expectedReturnDate && dto.expectedReturnDate < todayUtc()) {
        throw unprocessable(
          ASSET_ERR_CODE.DATE,
          ASSET_ERR.DATE("ngày dự kiến trả không được trước ngày cấp"),
          assetDetails("expected-return-before-issue"),
        );
      }
      // INSERT lượt TRƯỚC (23505 nổ sớm) → UPDATE assets SAU (plan §3.4).
      const assignment = await this.assignments
        .insertActiveTx(tx, user.companyId, {
          assetId,
          employeeId: dto.employeeId,
          assignedBy: user.id,
          issueCondition: dto.issueCondition ?? null,
          issueNote: dto.issueNote ?? null,
          expectedReturnDate: dto.expectedReturnDate ?? null,
        })
        .catch((err: unknown) => rethrowAssetPgError(err));
      const updated = await this.assets.transitionTx(tx, user.companyId, assetId, ["In Stock"], {
        status: "Assigned",
        userId: user.id,
      });
      if (!updated) throw this.staleTransition(asset, "assign");
      await this.audit.record(tx, {
        action: "AssetAssigned",
        objectType: "asset_assignment",
        objectId: assignment.id,
        actorUserId: user.id,
        before: toAssetAuditSnapshot(asset),
        after: { ...toAssignmentAuditSnapshot(assignment), asset: toAssetAuditSnapshot(updated) },
      });
      await this.enqueue(tx, user, ASSET_EVENT_ASSIGNED, assignment, updated);
    });
    return this.assetsService.get(user, assetId, { afterWrite: true });
  }

  /**
   * 011 — thu hồi. Câu quyết định ERR-003 là `returnActiveTx` (0 hàng). UPDATE `assets` dùng CASE (review B6):
   * `Lost` ⇒ Lost · đang Assigned ⇒ In Stock · đang Under Maintenance ⇒ giữ nguyên; `condition_note` khi Damaged;
   * `Lost` còn đóng lượt bảo trì Open (review B4).
   */
  async revoke(
    user: AssetRequestUser,
    assetId: string,
    dto: RevokeAssetDto,
  ): Promise<AssetDetailResponseDto> {
    await this.access.assertCan(user, "revoke", "asset");
    await this.db.withTenant(user.companyId, async (tx) => {
      const asset = await this.assetsService.lockOrNotFoundTx(tx, user.companyId, assetId);
      const from = asset.status as AssetStatus;
      const to: AssetStatus =
        dto.returnCondition === "Lost"
          ? "Lost"
          : from === "Under Maintenance"
            ? "Under Maintenance"
            : "In Stock";
      // FSM trước khi chạm sổ: In Stock/Disposed/Lost ⇒ 001 (không có lượt Active để mà 003).
      assertTransition(from, to, "revoke");
      const returned = await this.assignments.returnActiveTx(tx, user.companyId, assetId, {
        returnCondition: dto.returnCondition,
        returnNote: dto.returnNote ?? null,
        userId: user.id,
      });
      if (!returned) {
        throw conflict(ASSET_ERR_CODE.NO_ACTIVE_ASSIGNMENT, ASSET_ERR.NO_ACTIVE_ASSIGNMENT);
      }
      let closedMaintenance: AssetMaintenance | undefined;
      if (dto.returnCondition === "Lost") {
        closedMaintenance = await this.maintenances.closeOpenByAssetTx(
          tx,
          user.companyId,
          assetId,
          {
            resultNote: `Đóng do ghi nhận mất khi thu hồi: ${dto.returnNote ?? ""}`.trim(),
            userId: user.id,
          },
        );
      }
      const updated = await this.assets.transitionTx(
        tx,
        user.companyId,
        assetId,
        ["Assigned", "Under Maintenance"],
        {
          status:
            dto.returnCondition === "Lost"
              ? "Lost"
              : sql`case when assets.status = 'Assigned' then 'In Stock' else assets.status end`,
          statusReason:
            dto.returnCondition === "Lost" ? (dto.returnNote ?? "Mất khi thu hồi") : undefined,
          conditionNote:
            dto.returnCondition === "Damaged"
              ? (dto.returnNote ?? "Hư hỏng khi thu hồi")
              : undefined,
          userId: user.id,
        },
      );
      if (!updated) throw this.staleTransition(asset, "revoke");
      await this.audit.record(tx, {
        action: dto.returnCondition === "Lost" ? "AssetRevokedLost" : "AssetRevoked",
        objectType: "asset_assignment",
        objectId: returned.id,
        actorUserId: user.id,
        before: {
          ...toAssignmentAuditSnapshot({ ...returned, status: "Active", returnCondition: null }),
          asset: toAssetAuditSnapshot(asset),
        },
        after: {
          ...toAssignmentAuditSnapshot(returned),
          asset: toAssetAuditSnapshot(updated),
          // Lượt bảo trì bị đóng ép cũng phải có vết audit (gate silent-failure M4).
          ...(closedMaintenance
            ? { closedMaintenance: toMaintenanceAuditSnapshot(closedMaintenance) }
            : {}),
        },
      });
      await this.enqueue(tx, user, ASSET_EVENT_REVOKED, returned, updated);
    });
    return this.assetsService.get(user, assetId, { afterWrite: true });
  }

  /** 012 — lịch sử cấp phát, lọc HÀNG theo scope (Own: của caller · Department: trong đơn vị). */
  async listAssignments(
    user: AssetRequestUser,
    assetId: string,
    q: ListAssetAssignmentsQueryDto,
  ): Promise<PaginatedResult<AssetAssignmentResponseDto[]>> {
    return this.db.withTenant(user.companyId, async (tx) => {
      const actor = await this.access.resolveActorScope(tx, user);
      const visible = await this.assets.findDetailTx(tx, user.companyId, assetId, actor);
      if (!visible) throw notFound();
      const { rows, total } = await this.assignments.listByAssetTx(
        tx,
        user.companyId,
        assetId,
        { page: q.page, perPage: q.per_page },
        actor,
      );
      return paginated(rows.map(toAssetAssignmentDto), toPagination(total, q.page, q.per_page));
    });
  }

  /**
   * 016 — thanh lý (`Disposed`) / ghi nhận mất (`Lost`). `Disposed`: guard 008 theo SỰ TỒN TẠI lượt Active TRƯỚC
   * FSM; tự đóng lượt bảo trì Open. `Lost`: tự đóng lượt Active (`return_condition='Lost'`, phát ASSET_REVOKED)
   * + lượt bảo trì Open.
   */
  async dispose(
    user: AssetRequestUser,
    assetId: string,
    dto: DisposeAssetDto,
  ): Promise<AssetDetailResponseDto> {
    await this.access.assertCan(user, "dispose", "asset");
    await this.db.withTenant(user.companyId, async (tx) => {
      const asset = await this.assetsService.lockOrNotFoundTx(tx, user.companyId, assetId);
      const from = asset.status as AssetStatus;
      const active = await this.assignments.findActiveTx(tx, user.companyId, assetId);
      let closedAssignment: AssetAssignment | undefined;
      if (dto.kind === "Disposed") {
        if (active) {
          throw conflict(
            ASSET_ERR_CODE.ACTIVE_ASSIGNMENT_BLOCKS_DISPOSE,
            ASSET_ERR.ACTIVE_ASSIGNMENT_BLOCKS_DISPOSE,
            assetDetails("active-assignment", { assignmentId: active.id }),
          );
        }
        assertTransition(from, "Disposed", "dispose");
      } else {
        assertTransition(from, "Lost", "dispose");
        if (active) {
          closedAssignment = await this.assignments.returnActiveTx(tx, user.companyId, assetId, {
            returnCondition: "Lost",
            returnNote: dto.reason,
            userId: user.id,
          });
        }
      }
      const closedMaintenance = await this.maintenances.closeOpenByAssetTx(
        tx,
        user.companyId,
        assetId,
        {
          resultNote: `Đóng do ${dto.kind === "Disposed" ? "thanh lý" : "ghi nhận mất"}: ${dto.reason}`,
          userId: user.id,
        },
      );
      const updated = await this.assets.transitionTx(
        tx,
        user.companyId,
        assetId,
        ["In Stock", "Assigned", "Under Maintenance"],
        { status: dto.kind, statusReason: dto.reason, userId: user.id },
      );
      if (!updated) throw this.staleTransition(asset, "dispose");
      await this.audit.record(tx, {
        action: dto.kind === "Disposed" ? "AssetDisposed" : "AssetLost",
        objectType: "asset",
        objectId: assetId,
        actorUserId: user.id,
        before: toAssetAuditSnapshot(asset),
        after: {
          ...toAssetAuditSnapshot(updated),
          ...(closedAssignment
            ? { closedAssignment: toAssignmentAuditSnapshot(closedAssignment) }
            : {}),
          ...(closedMaintenance
            ? { closedMaintenance: toMaintenanceAuditSnapshot(closedMaintenance) }
            : {}),
        },
      });
      if (closedAssignment) {
        await this.enqueue(tx, user, ASSET_EVENT_REVOKED, closedAssignment, updated);
      }
    });
    return this.assetsService.get(user, assetId, { afterWrite: true });
  }

  /** 017 — tìm thấy lại: `Lost → In Stock`. */
  async recover(
    user: AssetRequestUser,
    assetId: string,
    dto: RecoverAssetDto,
  ): Promise<AssetDetailResponseDto> {
    await this.access.assertCan(user, "dispose", "asset");
    await this.db.withTenant(user.companyId, async (tx) => {
      const asset = await this.assetsService.lockOrNotFoundTx(tx, user.companyId, assetId);
      assertTransition(asset.status as AssetStatus, "In Stock", "recover");
      const updated = await this.assets.transitionTx(tx, user.companyId, assetId, ["Lost"], {
        status: "In Stock",
        statusReason: dto.reason,
        userId: user.id,
      });
      if (!updated) throw this.staleTransition(asset, "recover");
      await this.audit.record(tx, {
        action: "AssetRecovered",
        objectType: "asset",
        objectId: assetId,
        actorUserId: user.id,
        before: toAssetAuditSnapshot(asset),
        after: toAssetAuditSnapshot(updated),
      });
    });
    return this.assetsService.get(user, assetId, { afterWrite: true });
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /**
   * UPDATE `assets` 0 hàng dù đã FOR UPDATE + FSM qua — chỉ xảy ra khi hàng vừa bị xoá mềm/đổi ngoài luồng trong
   * cùng tx. Trả 409 001 với status đã khoá (KHÔNG SELECT lại — không nuốt lỗi, không gate ghi tiếp).
   */
  private staleTransition(asset: Asset, action: string) {
    return conflict(
      ASSET_ERR_CODE.TRANSITION,
      ASSET_ERR.TRANSITION(asset.status, action),
      assetDetails("stale", { from: asset.status, action }),
    );
  }

  private async enqueue(
    tx: TenantTx,
    user: AssetRequestUser,
    eventType: string,
    assignment: AssetAssignment,
    asset: Asset,
  ): Promise<void> {
    const actorName = await this.access.findUserDisplayNameTx(tx, user.companyId, user.id);
    await this.outbox.enqueue(tx, {
      eventType,
      payload: assetAssignmentPayload(assignment, asset, user.id, actorName),
    });
  }
}
