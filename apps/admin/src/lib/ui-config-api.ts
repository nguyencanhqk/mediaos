import { z } from "zod";
import {
  brandingSchema,
  i18nOverrideSchema,
  uiNavigationItemSchema,
  type BrandingDto,
  type I18nOverrideDto,
  type PutI18nOverridesRequest,
  type PutUiNavigationRequest,
  type UiNavigationItemDto,
  type UpdateBrandingRequest,
} from "@mediaos/contracts";
import { apiFetch } from "./api-client";

/**
 * AC-4 UI config API client (self-service company-admin: branding / navigation / i18n).
 *
 * companyId trên path `/tenant/:companyId/*` chỉ self-scope điều hướng UI — BE ép tenant theo token của
 * user (companyId từ JWT, KHÔNG cross-tenant). `apiFetch` tự gắn Bearer + gỡ envelope + Zod-parse.
 *
 * Hợp đồng route (ui-config.controller.ts @Controller("settings")):
 *   - GET/PUT /settings/branding        → gate view/manage:branding (is_sensitive=false).
 *   - GET/PUT /settings/ui-navigation   → gate manage:ui-navigation.
 *   - GET/PUT /settings/i18n-overrides  → gate manage:i18n-override.
 */

const navListSchema = z.array(uiNavigationItemSchema);
const i18nListSchema = z.array(i18nOverrideSchema);

export const uiConfigApi = {
  // ── Branding ──
  getBranding: (): Promise<BrandingDto> => apiFetch("/settings/branding", brandingSchema),
  updateBranding: (body: UpdateBrandingRequest): Promise<BrandingDto> =>
    apiFetch("/settings/branding", brandingSchema, {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  // ── Navigation ──
  getNavigation: (): Promise<UiNavigationItemDto[]> =>
    apiFetch("/settings/ui-navigation", navListSchema),
  updateNavigation: (body: PutUiNavigationRequest): Promise<UiNavigationItemDto[]> =>
    apiFetch("/settings/ui-navigation", navListSchema, {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  // ── i18n overrides ──
  getI18nOverrides: (): Promise<I18nOverrideDto[]> =>
    apiFetch("/settings/i18n-overrides", i18nListSchema),
  updateI18nOverrides: (body: PutI18nOverridesRequest): Promise<I18nOverrideDto[]> =>
    apiFetch("/settings/i18n-overrides", i18nListSchema, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
};
