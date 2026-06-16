import { Suspense, lazy } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Trans, useTranslation } from "react-i18next";
import { workflowInstancesApi } from "@/lib/workflow-instances-api";
import {
  INSTANCE_STATUS_BADGE_CLASSES,
  INSTANCE_STATUS_LABELS,
  STEP_INSTANCE_STATUS_DOT_CLASSES,
  STEP_INSTANCE_STATUS_LABELS,
} from "@/components/workflows/constants";

const InstanceCanvas = lazy(() => import("@/components/workflows/canvas/instance-canvas"));

export function WorkflowInstanceDetailPage() {
  const { t } = useTranslation("workflows");
  const { instanceId } = useParams({ from: "/workflows/instances/$instanceId" });

  const { data, isLoading, isError } = useQuery({
    queryKey: ["workflow-instance", instanceId],
    queryFn: () => workflowInstancesApi.get(instanceId),
  });

  if (isLoading) return <div className="p-8 text-sm text-muted-foreground">{t("instances.detail.loading")}</div>;
  if (isError || !data)
    return <div className="p-8 text-sm text-destructive">{t("instances.detail.loadError")}</div>;

  const { instance, steps, dependencies } = data;
  const sortedSteps = [...steps].sort((a, b) => a.stepOrder - b.stepOrder);

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-8">
      <Link to="/workflows/instances" className="text-sm text-primary hover:underline">
        <span aria-hidden="true">← </span>{t("instances.detail.backLink")}
      </Link>

      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold">{instance.templateName}</h1>
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${INSTANCE_STATUS_BADGE_CLASSES[instance.status]}`}
          >
            {INSTANCE_STATUS_LABELS[instance.status]}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          {t("instances.detail.versionLine", {
            version: instance.definitionVersion,
            datetime: new Date(instance.createdAt).toLocaleString("vi-VN"),
          })}
        </p>
      </div>

      <Suspense
        fallback={
          <div className="flex h-[460px] items-center justify-center rounded-xl border border-border text-sm text-muted-foreground">
            {t("instances.detail.canvasLoadingFallback")}
          </div>
        }
      >
        <InstanceCanvas steps={steps} dependencies={dependencies} />
      </Suspense>

      {/* Danh sách trạng thái — fallback đọc-được cho canvas (a11y) */}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">{t("instances.detail.stepsHeading")}</h2>
        <ul className="space-y-2">
          {sortedSteps.map((step) => (
            <li
              key={step.id}
              className="flex items-center justify-between rounded-lg border border-border bg-background px-4 py-2.5 text-sm"
            >
              <span className="font-medium">{step.stepName}</span>
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <span
                  className={`inline-block h-2 w-2 rounded-full ${STEP_INSTANCE_STATUS_DOT_CLASSES[step.status]}`}
                  aria-hidden="true"
                />
                {STEP_INSTANCE_STATUS_LABELS[step.status]}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          <Trans
            t={t}
            i18nKey="instances.detail.parallelNote"
            components={{
              strong: <strong />,
              a: <Link to="/tasks" className="text-primary hover:underline" />,
            }}
          />
        </p>
      </section>
    </div>
  );
}
