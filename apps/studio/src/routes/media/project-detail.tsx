import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import type { ProjectDto } from "@mediaos/contracts";
import { useTranslation } from "react-i18next";
import { projectsApi } from "@/lib/projects-api";
import { mediaApi } from "@/lib/media-api";
import { PermissionGate } from "@mediaos/web-core";
import { Button } from "@mediaos/ui";
import { Input } from "@mediaos/ui";
import { useEmployeeOptions } from "@/components/channels/use-channel-options";
import { PLATFORM_LABELS } from "@/components/channels/constants";
import { EditProjectDialog } from "@/components/projects/edit-project-dialog";
import {
  AddProjectChannelDialog,
  AddProjectMemberDialog,
  AddProjectTeamDialog,
} from "@/components/projects/link-dialogs";
import {
  LINK_STATUS_LABELS,
  PROJECT_PRIORITY_COLORS,
  PROJECT_PRIORITY_LABELS,
  PROJECT_STATUS_LABELS,
  PROJECT_TYPE_LABELS,
} from "@/components/projects/constants";

type Tab = "overview" | "channels" | "teams" | "members" | "content";

export function ProjectDetailPage() {
  const { t } = useTranslation("projects");
  const { projectId } = useParams({ from: "/projects/$projectId" });
  const [tab, setTab] = useState<Tab>("overview");

  const {
    data: project,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["projects", projectId],
    queryFn: () => projectsApi.getProject(projectId),
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-8">
      <Link to="/projects" className="text-sm text-muted-foreground hover:underline">
        {t("detail.backToList")}
      </Link>

      {isLoading && <p className="text-sm text-muted-foreground">{t("common:loading")}</p>}
      {isError && <p className="text-sm text-destructive">{t("detail.loadFailed")}</p>}

      {project && (
        <>
          <div>
            <h1 className="text-2xl font-semibold">{project.name}</h1>
            <p className="text-sm text-muted-foreground">
              {project.code ? `${project.code} · ` : ""}
              {PROJECT_STATUS_LABELS[project.status]}
            </p>
          </div>

          <div className="flex gap-1 border-b border-border">
            <TabButton active={tab === "overview"} onClick={() => setTab("overview")}>
              {t("detail.tabOverview")}
            </TabButton>
            <TabButton active={tab === "channels"} onClick={() => setTab("channels")}>
              {t("detail.tabChannels", { count: project.channels?.length ?? 0 })}
            </TabButton>
            <TabButton active={tab === "teams"} onClick={() => setTab("teams")}>
              {t("detail.tabTeams", { count: project.teams?.length ?? 0 })}
            </TabButton>
            <TabButton active={tab === "members"} onClick={() => setTab("members")}>
              {t("detail.tabMembers", { count: project.members?.length ?? 0 })}
            </TabButton>
            <TabButton active={tab === "content"} onClick={() => setTab("content")}>
              {t("detail.tabContent")}
            </TabButton>
          </div>

          {tab === "overview" && <OverviewTab project={project} />}
          {tab === "channels" && <ChannelsTab project={project} />}
          {tab === "teams" && <TeamsTab project={project} />}
          {tab === "members" && <MembersTab project={project} />}
          {tab === "content" && <ContentTab projectId={projectId} />}
        </>
      )}
    </div>
  );
}

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function TabButton({ active, onClick, children }: TabButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "border-b-2 border-primary px-4 py-2 text-sm font-medium text-primary"
          : "px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
      }
    >
      {children}
    </button>
  );
}

// ── Overview ────────────────────────────────────────────────────────────────

function OverviewTab({ project }: { project: ProjectDto }) {
  const { t } = useTranslation("projects");
  const [editing, setEditing] = useState(false);
  const employees = useEmployeeOptions();

  const nameOf = (userId: string | null): string => {
    if (!userId) return "—";
    const e = employees.find((x) => x.userId === userId);
    return e?.userFullName ?? e?.userEmail ?? userId;
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <PermissionGate action="update" resourceType="project">
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            {t("detail.editButton")}
          </Button>
        </PermissionGate>
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-xl border border-border p-5 text-sm">
        <Detail label={t("detail.detailCode")} value={project.code ?? "—"} />
        <Detail
          label={t("detail.detailType")}
          value={project.projectType ? PROJECT_TYPE_LABELS[project.projectType] : "—"}
        />
        <div className="col-span-2">
          <Detail label={t("detail.detailDescription")} value={project.description ?? "—"} />
        </div>
        <Detail label={t("detail.detailOwner")} value={nameOf(project.ownerUserId)} />
        <Detail label={t("detail.detailPM")} value={nameOf(project.projectManagerId)} />
        <Detail label={t("detail.detailStartDate")} value={project.startDate ?? "—"} />
        <Detail label={t("detail.detailEndDate")} value={project.endDate ?? "—"} />
        <Detail
          label={t("detail.detailPriority")}
          value={
            project.priority ? (
              <span className={PROJECT_PRIORITY_COLORS[project.priority]}>
                {PROJECT_PRIORITY_LABELS[project.priority]}
              </span>
            ) : (
              "—"
            )
          }
        />
        <Detail
          label={t("detail.detailBudget")}
          value={project.budget != null ? `${Number(project.budget).toLocaleString("vi-VN")} ₫` : "—"}
        />
        <Detail label={t("detail.detailStatus")} value={PROJECT_STATUS_LABELS[project.status]} />
      </dl>

      <EditProjectDialog project={project} open={editing} onClose={() => setEditing(false)} />
    </div>
  );
}

interface DetailProps {
  label: string;
  value: React.ReactNode;
}

function Detail({ label, value }: DetailProps) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

// ── Channels ────────────────────────────────────────────────────────────────

function ChannelsTab({ project }: { project: ProjectDto }) {
  const { t } = useTranslation("projects");
  const [adding, setAdding] = useState(false);
  const channels = project.channels ?? [];
  const remove = useRemoveLink((channelId: string) =>
    projectsApi.removeProjectChannel(project.id, channelId),
    project.id,
  );

  return (
    <div className="space-y-4">
      <LinkHeader
        title={t("detail.channels.sectionTitle", { count: channels.length })}
        onAdd={() => setAdding(true)}
        addLabel={t("detail.channels.addButton")}
      />
      {channels.length === 0 ? (
        <Empty>{t("detail.channels.empty")}</Empty>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {channels.map((c) => (
            <li key={c.id} className="flex items-center justify-between px-4 py-3 text-sm">
              <div>
                <span className="font-medium">{c.name}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {PLATFORM_LABELS[c.platform]}
                  {c.roleInProject ? ` · ${c.roleInProject}` : ""} · {LINK_STATUS_LABELS[c.status]}
                </span>
              </div>
              <RemoveButton onClick={() => remove.mutate(c.channelId)} pending={remove.isPending} />
            </li>
          ))}
        </ul>
      )}
      <AddProjectChannelDialog
        projectId={project.id}
        open={adding}
        onClose={() => setAdding(false)}
        excludeIds={channels.map((c) => c.channelId)}
      />
    </div>
  );
}

// ── Teams ─────────────────────────────────────────────────────────────────────

function TeamsTab({ project }: { project: ProjectDto }) {
  const { t } = useTranslation("projects");
  const [adding, setAdding] = useState(false);
  const teams = project.teams ?? [];
  const remove = useRemoveLink((teamId: string) =>
    projectsApi.removeProjectTeam(project.id, teamId),
    project.id,
  );

  return (
    <div className="space-y-4">
      <LinkHeader
        title={t("detail.teams.sectionTitle", { count: teams.length })}
        onAdd={() => setAdding(true)}
        addLabel={t("detail.teams.addButton")}
      />
      {teams.length === 0 ? (
        <Empty>{t("detail.teams.empty")}</Empty>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {teams.map((team) => (
            <li key={team.id} className="flex items-center justify-between px-4 py-3 text-sm">
              <div>
                <span className="font-medium">{team.name}</span>
                {team.roleInProject && (
                  <span className="ml-2 text-xs text-muted-foreground">{team.roleInProject}</span>
                )}
              </div>
              <RemoveButton onClick={() => remove.mutate(team.teamId)} pending={remove.isPending} />
            </li>
          ))}
        </ul>
      )}
      <AddProjectTeamDialog
        projectId={project.id}
        open={adding}
        onClose={() => setAdding(false)}
        excludeIds={teams.map((team) => team.teamId)}
      />
    </div>
  );
}

// ── Members ─────────────────────────────────────────────────────────────────

function MembersTab({ project }: { project: ProjectDto }) {
  const { t } = useTranslation("projects");
  const [adding, setAdding] = useState(false);
  const members = project.members ?? [];
  const employees = useEmployeeOptions();
  const remove = useRemoveLink((memberId: string) =>
    projectsApi.removeProjectMember(project.id, memberId),
    project.id,
  );

  const nameOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of employees) map.set(e.userId, e.userFullName ?? e.userEmail ?? e.userId);
    return map;
  }, [employees]);

  return (
    <div className="space-y-4">
      <LinkHeader
        title={t("detail.members.sectionTitle", { count: members.length })}
        onAdd={() => setAdding(true)}
        addLabel={t("detail.members.addButton")}
      />
      {members.length === 0 ? (
        <Empty>{t("detail.members.empty")}</Empty>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {members.map((m) => (
            <li key={m.id} className="flex items-center justify-between px-4 py-3 text-sm">
              <div>
                <span className="font-medium">{nameOf.get(m.userId) ?? m.userId}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {m.roleInProject ?? "—"}
                  {m.workloadPercent != null ? ` · ${m.workloadPercent}%` : ""} ·{" "}
                  {LINK_STATUS_LABELS[m.status]}
                </span>
              </div>
              <RemoveButton onClick={() => remove.mutate(m.id)} pending={remove.isPending} />
            </li>
          ))}
        </ul>
      )}
      <AddProjectMemberDialog
        projectId={project.id}
        open={adding}
        onClose={() => setAdding(false)}
        excludeIds={members.map((m) => m.userId)}
      />
    </div>
  );
}

// ── Content (legacy G4-2, retrofit guard ở G6-4) ──────────────────────────────

function ContentTab({ projectId }: { projectId: string }) {
  const { t } = useTranslation("projects");
  const qc = useQueryClient();
  const [title, setTitle] = useState("");

  const {
    data: content = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["projects", projectId, "content"],
    queryFn: () => mediaApi.listContent(projectId),
  });

  const create = useMutation({
    mutationFn: () => mediaApi.createContent(projectId, { title }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["projects", projectId, "content"] });
      setTitle("");
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Input
          placeholder={t("detail.content.titlePlaceholder")}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="max-w-sm"
        />
        <Button onClick={() => create.mutate()} disabled={!title.trim() || create.isPending}>
          {t("detail.content.createButton")}
        </Button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">{t("common:loading")}</p>}
      {isError && <p className="text-sm text-destructive">{t("detail.content.loadFailed")}</p>}
      {!isLoading && !isError && content.length === 0 && <Empty>{t("detail.content.empty")}</Empty>}

      {content.length > 0 && (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {content.map((item) => (
            <li key={item.id} className="flex items-center justify-between px-4 py-3 text-sm">
              <div>
                <p className="font-medium">{item.title}</p>
                <p className="text-xs text-muted-foreground">{item.productionStatus ?? "—"}</p>
              </div>
              <span className="text-xs text-muted-foreground">
                {t(`detail.content.status.${item.status}`, { defaultValue: item.status })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Shared link UI ────────────────────────────────────────────────────────────

function useRemoveLink(fn: (id: string) => Promise<unknown>, projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["projects", projectId] }),
  });
}

function LinkHeader({
  title,
  onAdd,
  addLabel,
}: {
  title: string;
  onAdd: () => void;
  addLabel: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="text-sm font-medium">{title}</h2>
      <PermissionGate action="update" resourceType="project">
        <Button size="sm" onClick={onAdd}>
          {addLabel}
        </Button>
      </PermissionGate>
    </div>
  );
}

function RemoveButton({ onClick, pending }: { onClick: () => void; pending: boolean }) {
  const { t } = useTranslation("projects");
  return (
    <PermissionGate action="update" resourceType="project">
      <Button
        variant="ghost"
        size="sm"
        className="text-destructive hover:text-destructive"
        onClick={onClick}
        disabled={pending}
      >
        {t("detail.channels.removeButton")}
      </Button>
    </PermissionGate>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}
