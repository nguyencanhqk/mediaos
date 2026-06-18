import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Plus, Trash2, UserPlus } from "lucide-react";
import { PermissionGate, useCan } from "@mediaos/web-core";
import { Avatar, Button, Select, Skeleton } from "@mediaos/ui";
import { projectsApi } from "@/lib/projects-api";
import { queryKeys } from "@/lib/query-keys";
import { useEmployeeOptions, employeeLabel, useEmployeeMap } from "@/lib/use-members";

interface MembersPanelProps {
  projectId: string;
}

/**
 * Quản lý thành viên dự án (minimal): liệt kê (từ project.members) · thêm (chọn nhân sự) · gỡ.
 * Add/remove gated update:project (server). Danh sách nhân sự cho picker reuse GET /employees.
 */
export function MembersPanel({ projectId }: MembersPanelProps) {
  const { t } = useTranslation("projects");
  const qc = useQueryClient();
  const canManage = useCan("update", "project");
  const { employees } = useEmployeeOptions();
  const { labelFor } = useEmployeeMap();

  const project = useQuery({
    queryKey: queryKeys.project(projectId),
    queryFn: () => projectsApi.getProject(projectId),
  });

  const invalidate = () => void qc.invalidateQueries({ queryKey: queryKeys.project(projectId) });

  const [newUserId, setNewUserId] = useState("");

  const add = useMutation({
    mutationFn: () => projectsApi.addProjectMember(projectId, { userId: newUserId }),
    onSuccess: () => {
      invalidate();
      setNewUserId("");
    },
  });

  const remove = useMutation({
    mutationFn: (memberId: string) => projectsApi.removeProjectMember(projectId, memberId),
    onSuccess: invalidate,
  });

  const members = project.data?.members ?? [];
  const memberUserIds = new Set(members.map((m) => m.userId));
  const addable = employees.filter((e) => !memberUserIds.has(e.userId));

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-foreground">{t("settings.members.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("settings.members.description")}</p>
      </div>

      {project.isLoading ? (
        <Skeleton className="h-32 w-full rounded-xl" />
      ) : members.length > 0 ? (
        <ul className="space-y-2">
          {members.map((m) => (
            <li
              key={m.id}
              className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2"
            >
              <Avatar name={labelFor(m.userId) ?? m.userId} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {labelFor(m.userId)}
                </p>
                {m.roleInProject && (
                  <p className="text-xs text-muted-foreground">{m.roleInProject}</p>
                )}
              </div>
              {canManage && (
                <button
                  type="button"
                  onClick={() => remove.mutate(m.id)}
                  aria-label={t("settings.members.remove")}
                  className="rounded p-1 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <UserPlus className="h-4 w-4" />
          {t("settings.members.empty")}
        </p>
      )}

      <PermissionGate action="update" resourceType="project">
        <div className="flex flex-wrap items-end gap-2 rounded-xl border border-dashed border-border p-3">
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">
              {t("settings.members.addLabel")}
            </span>
            <Select
              value={newUserId}
              onChange={(e) => setNewUserId(e.target.value)}
              className="w-64"
            >
              <option value="">{t("settings.members.selectEmployee")}</option>
              {addable.map((emp) => (
                <option key={emp.userId} value={emp.userId}>
                  {employeeLabel(emp)}
                </option>
              ))}
            </Select>
          </label>
          <Button size="sm" onClick={() => add.mutate()} disabled={!newUserId || add.isPending}>
            <Plus className="h-4 w-4" />
            {t("settings.members.add")}
          </Button>
        </div>
      </PermissionGate>

      {add.isError && <p className="text-sm text-destructive">{t("settings.members.addError")}</p>}
    </div>
  );
}
