import { useCallback, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { hrApi, hrKeys, taskKeys, taskProjectApi, useCan } from "@mediaos/web-core";
import { Input, Select } from "@mediaos/ui";
import type { TaskCorePriorityDto, TaskCoreStatusDto } from "@mediaos/contracts";
import { TASK_CORE_PRIORITY_OPTIONS, TASK_CORE_STATUS_OPTIONS } from "./constants";
import type { TaskListSearch } from "./task-list-search";
import { MineChip, TaskSearchBox } from "./TaskFilterControls";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="space-y-1">
      <span className="block text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

/** Toolbar lọc của `/tasks`. Danh mục người/dự án/phòng ban chỉ tải khi có quyền đọc tương ứng. */
export function TaskListToolbar({
  search,
  update,
}: {
  search: TaskListSearch;
  update: (patch: Partial<TaskListSearch>, replace?: boolean) => void;
}) {
  const { t } = useTranslation("tasks");
  const canReadEmployees = useCan("read", "employee");
  const canReadProjects = useCan("read", "project");
  const canReadDepartments = useCan("read", "department");

  const { data: employeesPage } = useQuery({
    queryKey: hrKeys.employees.list({ pageSize: 100, status: "active" }),
    queryFn: () => hrApi.listEmployees({ pageSize: 100, status: "active" }),
    enabled: canReadEmployees,
    staleTime: 60_000,
  });
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
  const commitSearch = useCallback(
    (next: string | undefined) => update({ search: next }, true),
    [update],
  );

  return (
    <div className="flex flex-wrap items-end gap-3">
      <TaskSearchBox value={search.search} onCommit={commitSearch} />
      <MineChip
        isActive={(myId) => search.assignee === myId}
        onToggle={(myId, active) => update({ assignee: active ? undefined : myId })}
      />
      <Field label={t("tasks.list.filters.status")}>
        <Select
          value={search.status ?? ""}
          onChange={(e) => update({ status: (e.target.value || undefined) as TaskCoreStatusDto })}
          className="w-40"
          data-testid="task-list-filter-status"
        >
          <option value="">{t("tasks.list.allStatuses")}</option>
          {TASK_CORE_STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {t(`tasks.status.${s}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("tasks.list.filters.priority")}>
        <Select
          value={search.priority ?? ""}
          onChange={(e) =>
            update({ priority: (e.target.value || undefined) as TaskCorePriorityDto })
          }
          className="w-36"
        >
          <option value="">{t("tasks.list.allPriorities")}</option>
          {TASK_CORE_PRIORITY_OPTIONS.map((p) => (
            <option key={p} value={p}>
              {t(`tasks.priority.${p}`)}
            </option>
          ))}
        </Select>
      </Field>
      {canReadEmployees && (
        <Field label={t("tasks.list.filters.assignee")}>
          <Select
            value={search.assignee ?? ""}
            onChange={(e) => update({ assignee: e.target.value || undefined })}
            className="w-44"
          >
            <option value="">{t("tasks.list.filters.allAssignees")}</option>
            {(employeesPage?.items ?? []).map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.fullName}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {canReadProjects && (
        <Field label={t("tasks.list.filters.project")}>
          <Select
            value={search.project ?? ""}
            onChange={(e) => update({ project: e.target.value || undefined })}
            className="w-44"
          >
            <option value="">{t("tasks.list.filters.allProjects")}</option>
            {(projects ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {canReadDepartments && (
        <Field label={t("listFilters.department")}>
          <Select
            value={search.department ?? ""}
            onChange={(e) => update({ department: e.target.value || undefined })}
            className="w-44"
            data-testid="task-list-filter-department"
          >
            <option value="">{t("listFilters.allDepartments")}</option>
            {(departments ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label={t("tasks.list.filters.dueFrom")}>
        <Input
          type="date"
          value={search.dueFrom ?? ""}
          onChange={(e) => update({ dueFrom: e.target.value || undefined })}
          className="w-40"
        />
      </Field>
      <Field label={t("tasks.list.filters.dueTo")}>
        <Input
          type="date"
          value={search.dueTo ?? ""}
          onChange={(e) => update({ dueTo: e.target.value || undefined })}
          className="w-40"
        />
      </Field>
      <label className="flex items-center gap-2 pb-2 text-sm text-foreground">
        <input
          type="checkbox"
          checked={search.overdue === true}
          onChange={(e) => update({ overdue: e.target.checked ? true : undefined })}
        />
        {t("tasks.list.filters.overdue")}
      </label>
    </div>
  );
}
