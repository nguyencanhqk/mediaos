import { Injectable } from "@nestjs/common";
import type {
  AssetCategoryResponseDto,
  CreateAssetCategoryDto,
  ListAssetCategoriesQueryDto,
  UpdateAssetCategoryDto,
} from "@mediaos/contracts";
import { DatabaseService, type TenantTx } from "../db/db.service";
import type { AssetCategory } from "../db/schema/assets";
import { AuditService } from "../events/audit.service";
import { SequenceService } from "../foundation/sequences/sequence.service";
import { AssetAccessService } from "./asset-access.service";
import { AssetCategoriesRepository } from "./asset-categories.repository";
import {
  ASSET_ERR,
  ASSET_ERR_CODE,
  assetDetails,
  conflict,
  notFound,
  rethrowAssetPgError,
} from "./assets.errors";
import { toAssetCategoryAuditSnapshot, toAssetCategoryDto } from "./assets.mapper";
import type { AssetRequestUser } from "./assets.types";

/** DB-15 §6.7 / SPEC-13 §13.5 — counter theo LOẠI: `sequence_key='asset_code'`, `scope_type='Custom'`, ref = category id. */
export const ASSET_CODE_SEQUENCE_KEY = "asset_code";
export const ASSET_CODE_PADDING = 4;
export const assetCodePrefixOf = (codePrefix: string): string => `TS-${codePrefix}-`;

/**
 * S11-ASSET-BE-1 — AssetCategoriesService (ASSET-API-001..004, SPEC-13 §10 FUNC-001).
 *
 *   • Tạo loại + tạo counter CÙNG tx (`ensureCounterTx` nhận tx caller) — thiếu counter lúc sinh mã là lỗi thật.
 *   • `code_prefix` KHÔNG BAO GIỜ cấp lại (unique không partial): dùng lại = `restore` loại đã xoá mềm (giữ counter).
 *   • Đổi `code_prefix` chỉ khi loại CHƯA sinh mã nào (kể cả tài sản đã xoá mềm) — ASSET-ERR-010 `prefix-locked`.
 *   • Tiền kiểm `code`/`prefix` TRƯỚC insert để trả `details` giàu (categoryId/deleted); unique index là chốt cuối
 *     (23505 → 010 qua `mapAssetPgError`). Không SELECT chẩn đoán SAU lỗi trong cùng tx (25P02).
 */
@Injectable()
export class AssetCategoriesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: AssetAccessService,
    private readonly repo: AssetCategoriesRepository,
    private readonly sequence: SequenceService,
    private readonly audit: AuditService,
  ) {}

  /** 001 — `includeDeleted` chỉ honour khi có `('manage','asset-category')`, ngược lại BỎ QUA (không 403). */
  async list(
    user: AssetRequestUser,
    q: ListAssetCategoriesQueryDto,
  ): Promise<AssetCategoryResponseDto[]> {
    await this.access.assertCan(user, "view", "asset");
    const includeDeleted =
      q.includeDeleted === true && (await this.access.canManageCategories(user));
    return this.db.withTenant(user.companyId, async (tx) => {
      const rows = await this.repo.listTx(tx, user.companyId, {
        includeInactive: q.includeInactive === true,
        includeDeleted,
      });
      return rows.map((r) => toAssetCategoryDto(r, { includeDeleted }));
    });
  }

  /** 002 — tạo loại + counter cùng tx + audit. */
  async create(
    user: AssetRequestUser,
    dto: CreateAssetCategoryDto,
  ): Promise<AssetCategoryResponseDto> {
    await this.access.assertCan(user, "manage", "asset-category");
    return this.db.withTenant(user.companyId, async (tx) => {
      await this.assertCodeFree(tx, user.companyId, dto.code);
      await this.assertPrefixFree(tx, user.companyId, dto.codePrefix);
      const row = await this.repo
        .insertTx(tx, user.companyId, {
          code: dto.code,
          name: dto.name,
          codePrefix: dto.codePrefix,
          description: dto.description ?? null,
          defaultMaintenanceIntervalDays: dto.defaultMaintenanceIntervalDays ?? null,
          sortOrder: dto.sortOrder ?? 0,
          createdBy: user.id,
        })
        .catch((err: unknown) =>
          rethrowAssetPgError(err, { code: dto.code, codePrefix: dto.codePrefix }),
        );
      await this.sequence.ensureCounterTx(
        tx,
        user.companyId,
        { sequenceKey: ASSET_CODE_SEQUENCE_KEY, scopeType: "Custom", scopeReferenceId: row.id },
        {
          sequenceKey: ASSET_CODE_SEQUENCE_KEY,
          scopeType: "Custom",
          scopeReferenceId: row.id,
          moduleCode: "ASSET",
          prefix: assetCodePrefixOf(dto.codePrefix),
          paddingLength: ASSET_CODE_PADDING,
          resetPolicy: "Never",
          status: "Active",
          actorUserId: user.id,
        },
      );
      await this.audit.record(tx, {
        action: "AssetCategoryCreated",
        objectType: "asset_category",
        objectId: row.id,
        actorUserId: user.id,
        after: toAssetCategoryAuditSnapshot(row),
      });
      return toAssetCategoryDto(row);
    });
  }

  /** 003 — sửa / vô hiệu / `restore`. `{id}` của loại đã xoá mềm CHỈ được nhận ở đây khi `restore: true`. */
  async update(
    user: AssetRequestUser,
    id: string,
    dto: UpdateAssetCategoryDto,
  ): Promise<AssetCategoryResponseDto> {
    await this.access.assertCan(user, "manage", "asset-category");
    return this.db.withTenant(user.companyId, async (tx) => {
      const current = await this.repo.findByIdTx(tx, user.companyId, id, {
        includeDeleted: dto.restore === true,
      });
      if (!current) throw notFound(ASSET_ERR.REF_NOT_FOUND("loại tài sản"));

      if (dto.codePrefix !== undefined && dto.codePrefix !== current.codePrefix) {
        const generated = await this.repo.countAssetsTx(tx, user.companyId, id, {
          liveOnly: false,
        });
        if (generated > 0) {
          throw conflict(
            ASSET_ERR_CODE.CATEGORY,
            ASSET_ERR.CATEGORY_PREFIX_LOCKED,
            assetDetails("prefix-locked"),
          );
        }
        await this.assertPrefixFree(tx, user.companyId, dto.codePrefix);
      }
      if (dto.isActive === false && current.isActive) {
        await this.assertNoLiveAssets(tx, user.companyId, id);
      }

      const updated = await this.repo
        .updateTx(
          tx,
          user.companyId,
          id,
          {
            name: dto.name,
            codePrefix: dto.codePrefix,
            description: dto.description,
            defaultMaintenanceIntervalDays: dto.defaultMaintenanceIntervalDays,
            sortOrder: dto.sortOrder,
            isActive: dto.isActive,
            updatedBy: user.id,
          },
          { restore: dto.restore === true },
        )
        .catch((err: unknown) => rethrowAssetPgError(err, { codePrefix: dto.codePrefix }));
      if (!updated) throw notFound(ASSET_ERR.REF_NOT_FOUND("loại tài sản"));

      // Counter theo loại: prefix đổi (chỉ khi 0 mã) ⇒ đồng bộ; giữ nguyên current_value.
      if (dto.codePrefix !== undefined && dto.codePrefix !== current.codePrefix) {
        await this.sequence.syncCounterConfigTx(
          tx,
          user.companyId,
          { sequenceKey: ASSET_CODE_SEQUENCE_KEY, scopeType: "Custom", scopeReferenceId: id },
          {
            moduleCode: "ASSET",
            prefix: assetCodePrefixOf(dto.codePrefix),
            paddingLength: ASSET_CODE_PADDING,
            status: "Active",
          },
        );
      }

      await this.audit.record(tx, {
        action: dto.restore === true ? "AssetCategoryRestored" : "AssetCategoryUpdated",
        objectType: "asset_category",
        objectId: id,
        actorUserId: user.id,
        before: toAssetCategoryAuditSnapshot(current),
        after: toAssetCategoryAuditSnapshot(updated),
      });
      return toAssetCategoryDto(updated);
    });
  }

  /** 004 — xoá MỀM; chặn khi còn tài sản chưa Disposed/Lost (ASSET-ERR-010 `has-assets`). */
  async remove(user: AssetRequestUser, id: string): Promise<void> {
    await this.access.assertCan(user, "manage", "asset-category");
    await this.db.withTenant(user.companyId, async (tx) => {
      const current = await this.repo.findByIdTx(tx, user.companyId, id);
      if (!current) throw notFound(ASSET_ERR.REF_NOT_FOUND("loại tài sản"));
      await this.assertNoLiveAssets(tx, user.companyId, id);
      const deleted = await this.repo.softDeleteTx(tx, user.companyId, id, user.id);
      if (!deleted) throw notFound(ASSET_ERR.REF_NOT_FOUND("loại tài sản"));
      await this.audit.record(tx, {
        action: "AssetCategoryDeleted",
        objectType: "asset_category",
        objectId: id,
        actorUserId: user.id,
        before: toAssetCategoryAuditSnapshot(current),
        after: toAssetCategoryAuditSnapshot(deleted),
      });
    });
  }

  // ── Guards ─────────────────────────────────────────────────────────────────

  private async assertCodeFree(tx: TenantTx, companyId: string, code: string): Promise<void> {
    const live = await this.repo.findLiveByCodeTx(tx, companyId, code);
    if (live) {
      throw conflict(
        ASSET_ERR_CODE.CATEGORY,
        ASSET_ERR.CATEGORY_CODE_TAKEN(code),
        assetDetails("code-taken", { categoryId: live.id }),
      );
    }
  }

  /** `prefix-taken` trả thêm `categoryId` + `deleted` để FE gợi ý «Khôi phục loại» (SPEC-13 §12). */
  private async assertPrefixFree(
    tx: TenantTx,
    companyId: string,
    codePrefix: string,
  ): Promise<void> {
    const holder: AssetCategory | undefined = await this.repo.findByPrefixTx(
      tx,
      companyId,
      codePrefix,
    );
    if (holder) {
      throw conflict(
        ASSET_ERR_CODE.CATEGORY,
        ASSET_ERR.CATEGORY_PREFIX_TAKEN(codePrefix),
        assetDetails("prefix-taken", { categoryId: holder.id, deleted: holder.deletedAt !== null }),
      );
    }
  }

  private async assertNoLiveAssets(
    tx: TenantTx,
    companyId: string,
    categoryId: string,
  ): Promise<void> {
    const live = await this.repo.countAssetsTx(tx, companyId, categoryId, { liveOnly: true });
    if (live > 0) {
      throw conflict(
        ASSET_ERR_CODE.CATEGORY,
        ASSET_ERR.CATEGORY_HAS_ASSETS,
        assetDetails("has-assets", { count: String(live) }),
      );
    }
  }
}
