import { Link, useParams } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useCan } from "@/hooks/use-can";

/**
 * Trang theo-công-ty (operator chọn 1 tenant để thao tác qua withTenant(target) — ADR-0019 Tầng 1).
 * Module tenant gắn dần: RBAC (AC-3) đã có; branding (AC-4), modules (AC-7), api-keys (AC-5),
 * webhooks (AC-6) ở lane sau.
 */
export function TenantHomePage() {
  // strict:false → không phụ thuộc route-id chính xác của pathless layout route (bền hơn cho scaffold).
  const { companyId } = useParams({ strict: false });
  const { t } = useTranslation(["nav", "rbac"]);
  // RBAC affordance hiện khi user có 1 trong 2 quyền quản phân quyền (BE vẫn là gác cuối).
  const canRbac =
    useCan("assign-role", "user") || useCan("grant-object-permission", "permission");

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("nav:tenant")}</h1>
        <p className="text-sm text-muted-foreground">companyId: {companyId}</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        {canRbac && companyId && (
          <Link to="/tenant/$companyId/rbac" params={{ companyId }} className="block">
            <Card className="transition-colors hover:bg-muted/40">
              <CardHeader className="flex-row items-center gap-3 space-y-0">
                <ShieldCheck className="size-5 text-muted-foreground" aria-hidden="true" />
                <div className="flex-1">
                  <CardTitle className="text-base">{t("rbac:title")}</CardTitle>
                  <CardDescription>{t("rbac:subtitle")}</CardDescription>
                </div>
              </CardHeader>
            </Card>
          </Link>
        )}
      </div>
    </div>
  );
}
