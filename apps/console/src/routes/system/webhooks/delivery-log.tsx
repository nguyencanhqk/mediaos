import { useQuery } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { Send } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { WebhookDeliveryDto } from "@mediaos/contracts";
import { Badge, DataTable, EmptyState } from "@mediaos/ui";
import { webhooksApi } from "@/lib/webhooks-api";

/** Map trạng thái → variant Badge dùng chung (@mediaos/ui: `failed` → `danger`). */
const STATUS_VARIANT: Record<WebhookDeliveryDto["status"], "secondary" | "outline" | "danger"> = {
  pending: "outline",
  success: "secondary",
  failed: "danger",
};

function fmtDate(iso: string | null, fallback: string): string {
  if (!iso) return fallback;
  return new Date(iso).toLocaleString("vi-VN");
}

interface DeliveryLogProps {
  endpointId: string;
}

/** Lịch sử giao của 1 endpoint (read-only, view:webhook). */
export function DeliveryLog({ endpointId }: DeliveryLogProps) {
  const { t } = useTranslation("webhooks");
  const query = useQuery({
    queryKey: ["webhooks", "deliveries", endpointId],
    queryFn: () => webhooksApi.listDeliveries(endpointId),
  });

  const columns: ColumnDef<WebhookDeliveryDto>[] = [
    { accessorKey: "eventType", header: t("deliveries.event") },
    {
      accessorKey: "status",
      header: t("deliveries.status"),
      cell: ({ row }) => (
        <Badge variant={STATUS_VARIANT[row.original.status]}>
          {t(`status.${row.original.status}`)}
        </Badge>
      ),
    },
    { accessorKey: "attempts", header: t("deliveries.attempts") },
    {
      accessorKey: "responseCode",
      header: t("deliveries.responseCode"),
      cell: ({ row }) => row.original.responseCode ?? "—",
    },
    {
      accessorKey: "deliveredAt",
      header: t("deliveries.deliveredAt"),
      cell: ({ row }) => fmtDate(row.original.deliveredAt, "—"),
    },
  ];

  if (query.isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {t("feedback.loadFailed")}
      </p>
    );
  }

  return (
    <DataTable
      columns={columns}
      data={query.data ?? []}
      isLoading={query.isLoading}
      emptyState={<EmptyState icon={Send} title={t("deliveries.empty")} />}
    />
  );
}
