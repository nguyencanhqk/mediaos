import { Injectable } from "@nestjs/common";
import type {
  BrandingDto,
  I18nOverrideDto,
  PutI18nOverridesRequest,
  PutUiNavigationRequest,
  UiNavigationItemDto,
  UpdateBrandingRequest,
} from "@mediaos/contracts";
import { AuditService } from "../events/audit.service";
import { FeatureFlagService } from "../saas/feature-flag.service";
import {
  type BrandingRow,
  type I18nOverrideRow,
  type NavigationRow,
  UiConfigRepository,
} from "./ui-config.repository";

/** Actor đã qua JwtAuthGuard + CompanyGuard + PermissionGuard. companyId LẤY TỪ JWT (KHÔNG path param). */
export interface UiConfigActor {
  id: string;
  companyId: string;
}

/**
 * UiConfigService (AC-4) — TENANT self-service branding/navigation/i18n cho company-admin.
 * Mọi mutation chạy withTenant(actor.companyId) qua repository (RLS scope) + audit-in-tx.
 *
 * MENU ĐỘNG (BẤT BIẾN menu-gate): effective menu = ui_navigation lọc bởi (a) isVisible=true,
 *   (b) item có moduleKey → CHỈ hiện khi module BẬT (FeatureFlagService.isEnabled — AC-7/G16-3
 *   company_feature_flags). Module tắt ⇒ ẩn item (fail-closed). KHÔNG đọc bảng on/off song song.
 */
@Injectable()
export class UiConfigService {
  constructor(
    private readonly repo: UiConfigRepository,
    private readonly audit: AuditService,
    private readonly featureFlags: FeatureFlagService,
  ) {}

  // ── Branding ──────────────────────────────────────────────────────────────────

  async getBranding(actor: UiConfigActor): Promise<BrandingDto> {
    const row = await this.repo.getBranding(actor.companyId);
    return toBrandingDto(row);
  }

  async updateBranding(actor: UiConfigActor, dto: UpdateBrandingRequest): Promise<BrandingDto> {
    const row = await this.repo.upsertBranding(actor.companyId, dto, {
      audit: this.audit,
      actorUserId: actor.id,
      action: "BrandingUpdated",
    });
    return toBrandingDto(row);
  }

  // ── Navigation ──────────────────────────────────────────────────────────────────

  /** Danh sách CẤU HÌNH menu (raw — admin xem/sửa, KHÔNG gate module). */
  async getNavigationConfig(actor: UiConfigActor): Promise<UiNavigationItemDto[]> {
    const rows = await this.repo.listNavigation(actor.companyId);
    return rows.map(toNavigationDto);
  }

  /**
   * Menu HIỆU LỰC (effective) — đã lọc isVisible + module-gate. Item có moduleKey mà module TẮT ⇒ ẩn.
   * Đọc module-state DUY NHẤT từ FeatureFlagService (KHÔNG bảng song song).
   */
  async getEffectiveNavigation(actor: UiConfigActor): Promise<UiNavigationItemDto[]> {
    const rows = await this.repo.listNavigation(actor.companyId);
    return this.filterEffective(actor.companyId, rows);
  }

  async updateNavigation(
    actor: UiConfigActor,
    dto: PutUiNavigationRequest,
  ): Promise<UiNavigationItemDto[]> {
    const rows = await this.repo.replaceNavigation(actor.companyId, dto.items, {
      audit: this.audit,
      actorUserId: actor.id,
      action: "UiNavigationUpdated",
    });
    return rows.map(toNavigationDto);
  }

  /** Lọc effective: isVisible=false ẩn; moduleKey null/module-bật → hiện; module-tắt → ẩn (fail-closed). */
  private async filterEffective(
    companyId: string,
    rows: NavigationRow[],
  ): Promise<UiNavigationItemDto[]> {
    const visible = rows.filter((r) => r.isVisible);

    // Resolve trạng thái module 1 LẦN cho mỗi moduleKey duy nhất (tránh N query lặp).
    const moduleKeys = [...new Set(visible.map((r) => r.moduleKey).filter((k): k is string => !!k))];
    const moduleState = new Map<string, boolean>();
    for (const key of moduleKeys) {
      moduleState.set(key, await this.featureFlags.isEnabled(companyId, key));
    }

    return visible
      .filter((r) => r.moduleKey === null || moduleState.get(r.moduleKey) === true)
      .map(toNavigationDto);
  }

  // ── i18n overrides ──────────────────────────────────────────────────────────────

  async getI18nOverrides(actor: UiConfigActor): Promise<I18nOverrideDto[]> {
    const rows = await this.repo.listI18nOverrides(actor.companyId);
    return rows.map(toI18nDto);
  }

  async updateI18nOverrides(
    actor: UiConfigActor,
    dto: PutI18nOverridesRequest,
  ): Promise<I18nOverrideDto[]> {
    const rows = await this.repo.replaceI18nOverrides(actor.companyId, dto.overrides, {
      audit: this.audit,
      actorUserId: actor.id,
      action: "I18nOverridesUpdated",
    });
    return rows.map(toI18nDto);
  }
}

function toBrandingDto(row: BrandingRow | null): BrandingDto {
  if (!row) {
    return {
      logoUrl: null,
      faviconUrl: null,
      primaryColor: null,
      secondaryColor: null,
      companyName: null,
      updatedAt: null,
    };
  }
  return {
    logoUrl: row.logoUrl,
    faviconUrl: row.faviconUrl,
    primaryColor: row.primaryColor,
    secondaryColor: row.secondaryColor,
    companyName: row.companyName,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toNavigationDto(row: NavigationRow): UiNavigationItemDto {
  return {
    key: row.key,
    label: row.label,
    route: row.route,
    icon: row.icon,
    parentKey: row.parentKey,
    displayOrder: row.displayOrder,
    moduleKey: row.moduleKey,
    isVisible: row.isVisible,
  };
}

function toI18nDto(row: I18nOverrideRow): I18nOverrideDto {
  return {
    locale: row.locale,
    namespace: row.namespace,
    key: row.key,
    value: row.value,
  };
}
