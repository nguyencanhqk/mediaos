import { Injectable } from "@nestjs/common";
import { and, asc, eq, isNull } from "drizzle-orm";
import { DatabaseService } from "../db/db.service";
import { i18nOverrides, tenantBranding, uiNavigationConfig } from "../db/schema";
import { AuditService } from "../events/audit.service";

/** Vết audit khi PUT — ghi CÙNG tx với mutation (rollback-safe). KHÔNG secret (metadata công khai). */
export interface UiConfigAuditMeta {
  audit: AuditService;
  actorUserId: string;
  action: string;
}

export type BrandingRow = typeof tenantBranding.$inferSelect;
export type NavigationRow = typeof uiNavigationConfig.$inferSelect;
export type I18nOverrideRow = typeof i18nOverrides.$inferSelect;

/** Field branding mutable (logoUrl/.../companyName) — undefined = KHÔNG đổi, null = xoá giá trị. */
export interface BrandingPatch {
  logoUrl?: string | null;
  faviconUrl?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  companyName?: string | null;
}

export interface NavigationItemInput {
  key: string;
  label: string;
  route: string;
  icon: string | null;
  parentKey: string | null;
  displayOrder: number;
  moduleKey: string | null;
  isVisible: boolean;
}

export interface I18nOverrideInput {
  locale: string;
  namespace: string;
  key: string;
  value: string;
}

/**
 * UiConfigRepository — DB access cho AC-4 (branding/navigation/i18n). Mọi đường đi qua withTenant
 * (RLS scope theo company_id từ JWT). PUT ghi audit-in-tx (cùng commit/rollback — CLAUDE.md §8).
 *
 * BẤT BIẾN #2 (không hard-delete): branding upsert 1-row; navigation/i18n soft-delete deleted_at +
 *   reactivate khi key xuất hiện lại trong replace-set.
 */
@Injectable()
export class UiConfigRepository {
  constructor(private readonly db: DatabaseService) {}

  // ── Branding (1 row / tenant, upsert idempotent) ─────────────────────────────

  getBranding(companyId: string): Promise<BrandingRow | null> {
    return this.db.withTenant(companyId, async (tx) => {
      const rows = await tx
        .select()
        .from(tenantBranding)
        .where(eq(tenantBranding.companyId, companyId))
        .limit(1);
      return rows[0] ?? null;
    });
  }

  upsertBranding(
    companyId: string,
    patch: BrandingPatch,
    auditMeta: UiConfigAuditMeta,
  ): Promise<BrandingRow> {
    return this.db.withTenant(companyId, async (tx) => {
      const existing = await tx
        .select()
        .from(tenantBranding)
        .where(eq(tenantBranding.companyId, companyId))
        .limit(1);

      let row: BrandingRow;
      if (existing[0]) {
        const [updated] = await tx
          .update(tenantBranding)
          .set({ ...patch, updatedAt: new Date() })
          .where(eq(tenantBranding.companyId, companyId))
          .returning();
        row = updated;
      } else {
        // company_id lấy từ DB DEFAULT (current_setting) — withTenant đã set ngữ cảnh, WITH CHECK ép tenant.
        const [inserted] = await tx.insert(tenantBranding).values({ ...patch }).returning();
        row = inserted;
      }

      await auditMeta.audit.record(tx, {
        action: auditMeta.action,
        objectType: "tenant_branding",
        objectId: row.id,
        actorUserId: auditMeta.actorUserId,
        after: {
          logoUrl: row.logoUrl,
          faviconUrl: row.faviconUrl,
          primaryColor: row.primaryColor,
          secondaryColor: row.secondaryColor,
          companyName: row.companyName,
        },
      });
      return row;
    });
  }

  // ── Navigation (replace-set, soft-delete) ────────────────────────────────────

  listNavigation(companyId: string): Promise<NavigationRow[]> {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .select()
        .from(uiNavigationConfig)
        .where(
          and(eq(uiNavigationConfig.companyId, companyId), isNull(uiNavigationConfig.deletedAt)),
        )
        .orderBy(asc(uiNavigationConfig.displayOrder), asc(uiNavigationConfig.key)),
    );
  }

  /** Thay TOÀN BỘ menu của tenant (replace-set idempotent): soft-delete mọi item đang sống TRƯỚC, rồi
   *  upsert item trong set (onConflict đặt deletedAt=null ⇒ reactivate). Item không còn trong set ở lại
   *  soft-deleted (BẤT BIẾN #2 — không hard-delete). Audit-in-tx. */
  replaceNavigation(
    companyId: string,
    items: NavigationItemInput[],
    auditMeta: UiConfigAuditMeta,
  ): Promise<NavigationRow[]> {
    return this.db.withTenant(companyId, async (tx) => {
      const now = new Date();
      const keepKeys = items.map((i) => i.key);

      // (1) Soft-delete mọi item đang sống của tenant TRƯỚC (BẤT BIẾN #2). Item còn trong set sẽ được
      //     reactivate ở bước (2) qua onConflictDoUpdate (deletedAt=null). RLS ép company_id.
      await tx
        .update(uiNavigationConfig)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          and(eq(uiNavigationConfig.companyId, companyId), isNull(uiNavigationConfig.deletedAt)),
        );

      // (2) Upsert item trong set → reactivate (deletedAt=null) + cập nhật field.
      for (const item of items) {
        await tx
          .insert(uiNavigationConfig)
          .values({
            key: item.key,
            label: item.label,
            route: item.route,
            icon: item.icon,
            parentKey: item.parentKey,
            displayOrder: item.displayOrder,
            moduleKey: item.moduleKey,
            isVisible: item.isVisible,
          })
          .onConflictDoUpdate({
            target: [uiNavigationConfig.companyId, uiNavigationConfig.key],
            set: {
              label: item.label,
              route: item.route,
              icon: item.icon,
              parentKey: item.parentKey,
              displayOrder: item.displayOrder,
              moduleKey: item.moduleKey,
              isVisible: item.isVisible,
              deletedAt: null, // reactivate
              updatedAt: now,
            },
          });
      }

      await auditMeta.audit.record(tx, {
        action: auditMeta.action,
        objectType: "ui_navigation",
        actorUserId: auditMeta.actorUserId,
        after: { itemCount: items.length, keys: keepKeys },
      });

      return tx
        .select()
        .from(uiNavigationConfig)
        .where(
          and(eq(uiNavigationConfig.companyId, companyId), isNull(uiNavigationConfig.deletedAt)),
        )
        .orderBy(asc(uiNavigationConfig.displayOrder), asc(uiNavigationConfig.key));
    });
  }

  // ── i18n overrides (replace-set, soft-delete) ────────────────────────────────

  listI18nOverrides(companyId: string): Promise<I18nOverrideRow[]> {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .select()
        .from(i18nOverrides)
        .where(and(eq(i18nOverrides.companyId, companyId), isNull(i18nOverrides.deletedAt)))
        .orderBy(asc(i18nOverrides.locale), asc(i18nOverrides.namespace), asc(i18nOverrides.key)),
    );
  }

  replaceI18nOverrides(
    companyId: string,
    overrides: I18nOverrideInput[],
    auditMeta: UiConfigAuditMeta,
  ): Promise<I18nOverrideRow[]> {
    return this.db.withTenant(companyId, async (tx) => {
      const now = new Date();

      // (1) Soft-delete moi override dang song TRUOC (BAT BIEN #2). Bo khoa con trong set reactivate o (2).
      await tx
        .update(i18nOverrides)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(eq(i18nOverrides.companyId, companyId), isNull(i18nOverrides.deletedAt)));

      // (2) Upsert override trong set -> reactivate (deletedAt=null) + cap nhat value.
      for (const o of overrides) {
        await tx
          .insert(i18nOverrides)
          .values({ locale: o.locale, namespace: o.namespace, key: o.key, value: o.value })
          .onConflictDoUpdate({
            target: [
              i18nOverrides.companyId,
              i18nOverrides.locale,
              i18nOverrides.namespace,
              i18nOverrides.key,
            ],
            set: { value: o.value, deletedAt: null, updatedAt: now },
          });
      }

      await auditMeta.audit.record(tx, {
        action: auditMeta.action,
        objectType: "i18n_override",
        actorUserId: auditMeta.actorUserId,
        after: { overrideCount: overrides.length },
      });

      return tx
        .select()
        .from(i18nOverrides)
        .where(and(eq(i18nOverrides.companyId, companyId), isNull(i18nOverrides.deletedAt)))
        .orderBy(asc(i18nOverrides.locale), asc(i18nOverrides.namespace), asc(i18nOverrides.key));
    });
  }
}
