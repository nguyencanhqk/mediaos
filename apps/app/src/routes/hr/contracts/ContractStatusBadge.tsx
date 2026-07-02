import { useTranslation } from "react-i18next";
import type { EmployeeContractDto } from "@mediaos/contracts";
import { Badge } from "@mediaos/ui";

const STATUS_VARIANT: Record<
  EmployeeContractDto["status"],
  "default" | "success" | "warning" | "danger" | "secondary"
> = {
  Draft: "secondary",
  Active: "success",
  Expired: "warning",
  Terminated: "danger",
  Cancelled: "danger",
};

/** Badge trạng thái hợp đồng (DB-03 §7.7) — dùng chung /hr/contracts + /hr/employees/:id/contracts. */
export function ContractStatusBadge({ status }: { status: EmployeeContractDto["status"] }) {
  const { t } = useTranslation("hr");
  return (
    <Badge variant={STATUS_VARIANT[status] ?? "secondary"}>
      {t(`contracts.status.${status}`, { defaultValue: status })}
    </Badge>
  );
}
