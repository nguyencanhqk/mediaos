import { Suspense, lazy } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Activity, ArrowLeft } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import { workflowInstancesApi } from "@/lib/workflow-instances-api";
import { PageHeader } from "@mediaos/ui";
import { EmptyState } from "@mediaos/ui";
import { Skeleton } from "@mediaos/ui";
import { Badge } from "@mediaos/ui";
import {
  INSTANCE_STATUS_BADGE_VARIANT,
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

  const backLink = (
    <Link
      to="/workflows/instances"
      className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      {t("instances.detail.backLink")}
    </Link>
  );

  if (isLoading) {
    return (
      <div className="mx-auto max-w-5xl space-y-6 p-6 sm:p-8">
        {backLink}
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-4 w-80" />
        <Skeleton className="h-[460px] w-full rounded-xl" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="mx-auto max-w-5xl space-y-6 p-6 sm:p-8">
        {backLink}
        <EmptyState
          icon={Activity}
          title={t("instances.detail.loadError")}
          description={t("instances.loadHint")}
        />
      </div>
    );
  }

  const { instance, steps, dependencies } = data;
  const sortedSteps = [...steps].sort((a, b) => a.stepOrder - b.stepOrder);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6 sm:p-8">
      {backLink}

      <PageHeader
        title={instance.templateName}
        description={t("instances.detail.versionLine", {
          version: instance.definitionVersion,
          datetime: new Date(instance.createdAt).toLocaleString("vi-VN"),
        })}
        icon={Activity}
        actions={
          <Badge variant={INSTANCE_STATUS_BADGE_VARIANT[instance.status]}>
            {INSTANCE_STATUS_LABELS[instance.status]}
          </Badge>
        }
      />

      <Suspense
        fallback={
          <div className="flex h-[460px] items-center justify-center rounded-xl border border-border bg-card text-sm text-muted-foreground">
            {t("instances.detail.canvasLoadingFallback")}
          </div>
        }
      >
        <InstanceCanvas steps={steps} dependencies={dependencies} />
      </Suspense>

      {/* Danh sách trạng thái — fallback đọc-được cho canvas (a11y) */}
      <section className="space-y-3 rounded-xl border border-border bg-card p-5 shadow-sm">
        <h2 className="text-base font-semibold">{t("instances.detail.stepsHeading")}</h2>
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
