import { ScrollText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/ui/empty-state";
import { useCan } from "@/hooks/use-can";
import { observabilityApi } from "@/lib/observability-api";
import { AuditTable } from "./audit-table";

/**
 * Trang Operator — nhật ký kiểm toán CHÉO TENANT (`/operator/audit`, AC-8).
 *
 * PermissionGate `view:platform-audit` (server ép + step-up; FE chỉ gate UI). Operator phải step-up trước
 * (re-auth keyed sentinel platform-audit) — server 403 nếu thiếu cửa sổ. Cross-tenant: optional ?companyId.
 */
export function OperatorAuditPage() {
  const { t } = useTranslation("audit");
  const canView = useCan("view", "platform-audit");

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
      title={t("platformTitle")}
      subtitle={t("platformSubtitle")}
      showCompanyFilter
      queryKeyBase="observability:platform-audit"
      fetchPage={observabilityApi.listPlatformAudit}
    />
  );
}
