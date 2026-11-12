import { useState } from "react";
import { useTranslation } from "react-i18next";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { RefreshCw, Users } from "lucide-react";
import { hrApi, hrKeys, taskCoreApi, taskKeys, taskProjectApi, useCan } from "@mediaos/web-core";
import { Button, EmptyState, PageHeader, Select } from "@mediaos/ui";
import {
  TASK_WORKLOAD_MAX_ROWS,
  type TaskWorkloadCounts,
  type TaskWorkloadQuery,
  type TaskWorkloadRow,
} from "@mediaos/contracts";
import { TASK_CORE_ENGINE_PAIRS } from "./constants";

/**
 * TeamWorkloadPage — «Đội của tôi» (`/tasks/team`, S20-TASK-WORKLOAD-1 · US-TASK-QL-04).
 *
 * Dữ liệu = `GET /tasks/workload`: PHẠM VI do SERVER quyết (NV @Own chỉ thấy dòng của mình) — FE không biết
 * data_scope nên mục menu gate `TASK.TASK.VIEW`. Thứ tự = thứ tự server (quá hạn giảm dần); «Chưa giao» ghim
 * cuối, KHÔNG có liên kết (danh sách chưa có bộ lọc «chưa giao»). Chỉ hai số có liên kết khớp tuyệt đối với
 * `GET /tasks`: «Quá hạn» → `?overdue=true`, «Chờ duyệt» → `?status=In Review`.
 */
interface LinkFilters {
  project?: string;
  department?: string;
}

function CountLink({
  count,
  label,
  assignee,
  personName,
  filters,
  extra,
  testId,
}: {
  count: number;
  label: string;
  assignee: string;
  personName: string;
  filters: LinkFilters;
  extra: { overdue: true } | { status: "In Review" };
  testId: string;
}) {
  const { t } = useTranslation("tasks");
  if (count === 0) return <span className="text-muted-foreground">{label}</span>;
  return (
    <Link
      to="/tasks"
      search={{ assignee, ...extra, ...filters }}
      className="font-medium text-primary underline-offset-2 hover:underline"
      data-testid={testId}
      aria-label={t("teamWorkload.overdueLinkFor", { label, name: personName })}
    >
      {label}
    </Link>
  );
}

function PersonRow({ row, filters }: { row: TaskWorkloadRow; filters: LinkFilters }) {
  const { t } = useTranslation("tasks");
  const personName = row.displayName ?? t("teamWorkload.unknownName");
  return (
    <tr className="border-t" data-testid={`team-row-${row.employeeId}`}>
      <th scope="row" className="px-3 py-2 text-left font-medium">
        {personName}
      </th>
      <td className="px-3 py-2 tabular-nums">{row.activeCount}</td>
      <td className="px-3 py-2 tabular-nums">
        <CountLink
          count={row.overdueCount}
          label={t("teamWorkload.overdueLink", { count: row.overdueCount })}
          assignee={row.employeeId}
          personName={personName}
          filters={filters}
          extra={{ overdue: true }}
          testId={`team-overdue-${row.employeeId}`}
        />
      </td>
      <td className="px-3 py-2 tabular-nums">{row.dueSoon7dCount}</td>
      <td className="px-3 py-2 tabular-nums">
        <CountLink
          count={row.inReviewCount}
          label={t("teamWorkload.reviewLink", { count: row.inReviewCount })}
          assignee={row.employeeId}
          personName={personName}
          filters={filters}
          extra={{ status: "In Review" }}
          testId={`team-review-${row.employeeId}`}
        />
      </td>
      <td className="px-3 py-2 tabular-nums">
        {row.maxOverdueDays === null ? "—" : t("teamWorkload.days", { count: row.maxOverdueDays })}
      </td>
    </tr>
  );
}

function UnassignedRow({ counts }: { counts: TaskWorkloadCounts }) {
  const { t } = useTranslation("tasks");
  return (
    <tr className="border-t bg-muted/30" data-testid="team-row-unassigned">
      <th scope="row" className="px-3 py-2 text-left font-medium">
        {t("teamWorkload.unassigned")}
      </th>
      <td className="px-3 py-2 tabular-nums">{counts.activeCount}</td>
      <td className="px-3 py-2 tabular-nums">
        {t("teamWorkload.overdueLink", { count: counts.overdueCount })}
      </td>
      <td className="px-3 py-2 tabular-nums">{counts.dueSoon7dCount}</td>
      <td className="px-3 py-2 tabular-nums">
        {t("teamWorkload.reviewLink", { count: counts.inReviewCount })}
      </td>
      <td className="px-3 py-2 tabular-nums">
        {counts.maxOverdueDays === null
          ? "—"
          : t("teamWorkload.days", { count: counts.maxOverdueDays })}
      </td>
    </tr>
  );
}

function WorkloadFilters({
  project,
  department,
  onChange,
}: {
  project: string;
  department: string;
  onChange: (patch: { project?: string; department?: string }) => void;
}) {
  const { t } = useTranslation("tasks");
  const canReadProjects = useCan("read", "project");
  const canReadDepartments = useCan("read", "department");
  const { data: projects } = useQuery({
    queryKey: taskKeys.projects.list({ limit: 100 }),
    queryFn: () => taskProjectApi.listProjects({ limit: 100 }),
    enabled: canReadProjects,
    staleTime: 60_000,
  });
  const { data: departments } = useQuery({
    queryKey: hrKeys.departments.lookup(),
    queryFn: () => hrApi.listDepartments(),
    enabled: canReadDepartments,
    staleTime: 300_000,
  });
  return (
    <div className="flex flex-wrap items-end gap-3">
      {canReadProjects && (
        <label className="space-y-1">
          <span className="block text-xs text-muted-foreground">
            {t("teamWorkload.filters.project")}
          </span>
          <Select
            value={project}
            onChange={(e) => onChange({ project: e.target.value })}
            className="w-52"
            data-testid="team-filter-project"
          >
            <option value="">{t("teamWorkload.filters.allProjects")}</option>
            {(projects ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </label>
      )}
      {canReadDepartments && (
        <label className="space-y-1">
          <span className="block text-xs text-muted-foreground">{t("listFilters.department")}</span>
          <Select
            value={department}
            onChange={(e) => onChange({ department: e.target.value })}
            className="w-52"
            data-testid="team-filter-department"
          >
            <option value="">{t("listFilters.allDepartments")}</option>
            {(departments ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </label>
      )}
    </div>
  );
}

export function TeamWorkloadPage() {
  const { t } = useTranslation("tasks");
  const canView = useCan(
    TASK_CORE_ENGINE_PAIRS.READ.action,
    TASK_CORE_ENGINE_PAIRS.READ.resourceType,
  );
  const [project, setProject] = useState("");
  const [department, setDepartment] = useState("");
  const query: TaskWorkloadQuery = {
    projectId: project || undefined,
    departmentId: department || undefined,
  };
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: taskKeys.workload({ ...query }),
    queryFn: () => taskCoreApi.getWorkload(query),
    enabled: canView,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });

  if (!canView) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("teamWorkload.forbidden.title")}
          description={t("teamWorkload.forbidden.description")}
        />
      </div>
    );
  }

  // Chỉ khoá CÓ giá trị — không để `project: undefined` lọt vào URL.
  const linkFilters: LinkFilters = {
    ...(project ? { project } : {}),
    ...(department ? { department } : {}),
  };
  const isEmpty = data !== undefined && data.items.length === 0 && data.unassigned === null;

  return (
    <div className="space-y-4 p-6">
      <PageHeader
        title={t("teamWorkload.title")}
        description={t("teamWorkload.description")}
        icon={Users}
      />
      <WorkloadFilters
        project={project}
        department={department}
        onChange={(patch) => {
          if (patch.project !== undefined) setProject(patch.project);
          if (patch.department !== undefined) setDepartment(patch.department);
        }}
      />
      {isError ? (
        <EmptyState
          title={t("teamWorkload.error.title")}
          description={t("teamWorkload.error.description")}
          action={
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {t("actions.retry", { ns: "common" })}
            </Button>
          }
        />
      ) : isLoading || data === undefined ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t("teamWorkload.loading")}
        </p>
      ) : isEmpty ? (
        <EmptyState
          title={t("teamWorkload.empty.title")}
          description={t("teamWorkload.empty.description")}
        />
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm" data-testid="team-workload-table">
            <caption className="sr-only">{t("teamWorkload.tableLabel")}</caption>
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2">{t("teamWorkload.columns.person")}</th>
                <th scope="col" className="px-3 py-2">{t("teamWorkload.columns.active")}</th>
                <th scope="col" className="px-3 py-2">{t("teamWorkload.columns.overdue")}</th>
                <th scope="col" className="px-3 py-2">{t("teamWorkload.columns.dueSoon")}</th>
                <th scope="col" className="px-3 py-2">{t("teamWorkload.columns.review")}</th>
                <th scope="col" className="px-3 py-2">{t("teamWorkload.columns.maxOverdueDays")}</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((row) => (
                <PersonRow key={row.employeeId} row={row} filters={linkFilters} />
              ))}
              {data.unassigned && <UnassignedRow counts={data.unassigned} />}
            </tbody>
          </table>
        </div>
      )}
      {data?.truncated && (
        <p className="text-sm text-muted-foreground" data-testid="team-truncated">
          {t("teamWorkload.truncated", { max: TASK_WORKLOAD_MAX_ROWS })}
        </p>
      )}
    </div>
  );
}
