import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import { Badge, PageHeader } from "@mediaos/ui";
import { projectsApi } from "@/lib/projects-api";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import { StatesPanel } from "@/components/settings/states-panel";
import { LabelsPanel } from "@/components/settings/labels-panel";
import { MembersPanel } from "@/components/settings/members-panel";

type Tab = "states" | "labels" | "members";

/** Trang cài đặt dự án — tabs States / Labels / Members. */
export function ProjectSettingsPage() {
  const { t } = useTranslation("projects");
  const { projectId } = useParams({ from: "/projects/$projectId/settings" });
  const [tab, setTab] = useState<Tab>("states");

  const project = useQuery({
    queryKey: queryKeys.project(projectId),
    queryFn: () => projectsApi.getProject(projectId),
  });

  const tabs: { id: Tab; labelKey: string }[] = [
    { id: "states", labelKey: "settings.tabs.states" },
    { id: "labels", labelKey: "settings.tabs.labels" },
    { id: "members", labelKey: "settings.tabs.members" },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <Link
        to="/projects/$projectId"
        params={{ projectId }}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        {t("settings.backToProject")}
      </Link>

      <PageHeader
        title={t("settings.pageTitle")}
        description={project.data?.name ?? ""}
        actions={
          project.data?.identifier ? (
            <Badge variant="brand" className="font-mono">
              {project.data.identifier}
            </Badge>
          ) : undefined
        }
      />

      <div className="flex gap-1 border-b border-border">
        {tabs.map((tabItem) => (
          <button
            key={tabItem.id}
            type="button"
            onClick={() => setTab(tabItem.id)}
            className={cn(
              "-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors",
              tab === tabItem.id
                ? "border-brand text-brand"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t(tabItem.labelKey)}
          </button>
        ))}
      </div>

      <div>
        {tab === "states" && <StatesPanel projectId={projectId} />}
        {tab === "labels" && <LabelsPanel projectId={projectId} />}
        {tab === "members" && <MembersPanel projectId={projectId} />}
      </div>
    </div>
  );
}
