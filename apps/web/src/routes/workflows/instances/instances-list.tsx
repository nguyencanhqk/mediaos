import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { workflowInstancesApi } from "@/lib/workflow-instances-api";
import {
  INSTANCE_STATUS_BADGE_CLASSES,
  INSTANCE_STATUS_LABELS,
} from "@/components/workflows/constants";

export function WorkflowInstancesPage() {
  const { t } = useTranslation("workflows");
  const { data: instances = [], isLoading, isError } = useQuery({
    queryKey: ["workflow-instances"],
    queryFn: () => workflowInstancesApi.list(),
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold">{t("instances.pageTitle")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("instances.pageSubtitle")}
        </p>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">{t("instances.loading")}</p>}
      {isError && <p className="text-sm text-destructive">{t("instances.loadError")}</p>}
      {!isLoading && !isError && instances.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("instances.empty")}</p>
      )}

      {instances.length > 0 && (
        <ul className="space-y-2">
          {instances.map((inst) => (
            <li key={inst.id}>
              <Link
                to="/workflows/instances/$instanceId"
                params={{ instanceId: inst.id }}
                className="flex items-center justify-between rounded-lg border border-border bg-background px-4 py-3 hover:bg-muted/30"
              >
                <div>
                  <p className="font-medium text-primary">{inst.templateName}</p>
                  <p className="text-xs text-muted-foreground">
                    {t("instances.startedAt", { date: new Date(inst.createdAt).toLocaleDateString("vi-VN") })}
                  </p>
                </div>
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${INSTANCE_STATUS_BADGE_CLASSES[inst.status]}`}
                >
                  {INSTANCE_STATUS_LABELS[inst.status]}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
