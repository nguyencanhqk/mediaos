import { useParams } from "@tanstack/react-router";
import { Building2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * Trang theo-công-ty (operator chọn 1 tenant để thao tác qua withTenant(target) — ADR-0019 Tầng 1).
 * Scaffold AC-0a: chỉ hiển thị companyId đang thao tác. Module tenant (RBAC AC-3, branding AC-4,
 * modules AC-7, api-keys AC-5, webhooks AC-6) gắn vào ở lane sau.
 */
export function TenantHomePage() {
  // strict:false → không phụ thuộc route-id chính xác của pathless layout route (bền hơn cho scaffold).
  const { companyId } = useParams({ strict: false });
  const { t } = useTranslation("nav");

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("tenant")}</h1>
        <p className="text-sm text-muted-foreground">companyId: {companyId}</p>
      </header>

      <EmptyState
        icon={Building2}
        title={t("comingSoon")}
        description="RBAC · Branding · Modules · API keys · Webhooks"
      />
    </div>
  );
}
