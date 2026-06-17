import { ScrollText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/ui/empty-state";
import { useCan } from "@/hooks/use-can";
import { observabilityApi } from "@/lib/observability-api";
import { AuditTable } from "@/routes/operator/audit/audit-table";

/**
 * Trang TENANT self — nhật ký kiểm toán của tenant mình (`/tenant/:companyId/audit`, AC-8).
 *
 * PermissionGate `view:audit-log` (server ép qua withTenant(JWT.companyId) — KHÔNG cross-tenant; FE chỉ
 * gate UI). KHÔNG ô lọc companyId (tenant chỉ thấy tenant mình; companyId từ JWT phía server).
 */
export function TenantAuditPage() {
  const { t } = useTranslation("audit");
  const canView = useCan("view", "audit-log");

  if (!canView) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <EmptyState
          icon={ScrollText}
          title={t("noPermission.title")}
          description={t("noPermission.description")}
        />
      </div>
    );
  }

  return (
    <AuditTable
      title={t("title")}
      subtitle={t("subtitle")}
      showCompanyFilter={false}
      queryKeyBase="observability:tenant-audit"
      fetchPage={observabilityApi.listTenantAudit}
    />
  );
}
