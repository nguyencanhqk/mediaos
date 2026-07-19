import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { taskStatesApi, taskKeys, useCan, ApiError } from "@mediaos/web-core";
import { Badge, Button, Dialog, Input } from "@mediaos/ui";
import type { ProjectStateDto, ProjectStateGroupDto } from "@mediaos/contracts";
import { PROJECT_STATE_PAIRS } from "./constants";

/**
 * S5-TASK-PIPELINE-1 (lane fe) — quản lý CỘT pipeline của dự án (SPEC-06 §6.8, DECISIONS-03: kỷ luật
 * quy trình nằm ở THỨ TỰ CỘT + quyền cấu hình cột). Thêm/đổi tên/màu/thứ tự — mỗi thao tác gate đúng
 * pair create/update/delete:project_state qua useCan (server vẫn là người quyết). Xoá cột còn task
 * sống ⇒ server 400 — hiển thị lỗi, không xoá mù.
 */

const STATE_GROUP_OPTIONS: ProjectStateGroupDto[] = [
  "backlog",
  "unstarted",
  "started",
  "review",
  "completed",
  "cancelled",
];

function errorKey(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 400) return "tasks.kanban.manage.errors.blocked";
    if (err.status === 403) return "tasks.kanban.errors.forbidden";
    if (err.status === 409) return "tasks.kanban.manage.errors.duplicate";
  }
  return "tasks.kanban.errors.generic";
}

function StateRow({
  state,
  canUpdate,
  canDelete,
  onError,
}: {
  state: ProjectStateDto;
  canUpdate: boolean;
  canDelete: boolean;
  onError: (key: string | null) => void;
}) {
  const { t } = useTranslation("tasks");
  const queryClient = useQueryClient();
  const [name, setName] = useState(state.name);
  const [color, setColor] = useState(state.color);
  const [sortOrder, setSortOrder] = useState(String(state.sortOrder));

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: taskKeys.states(state.projectId) });
    void queryClient.invalidateQueries({ queryKey: taskKeys.kanban(state.projectId) });
  };

  const updateMutation = useMutation({
    mutationFn: () =>
      taskStatesApi.updateState(state.id, {
        name: name.trim(),
        color,
        sortOrder: Number.parseInt(sortOrder, 10) || 0,
      }),
    onSuccess: () => {
      onError(null);
      invalidate();
    },
    onError: (err) => onError(errorKey(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: () => taskStatesApi.deleteState(state.id),
    onSuccess: () => {
      onError(null);
      invalidate();
    },
    onError: (err) => onError(errorKey(err)),
  });

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid={`state-manage-row-${state.id}`}>
      <input
        type="color"
        value={color}
        onChange={(e) => setColor(e.target.value)}
        disabled={!canUpdate}
        aria-label={t("tasks.kanban.manage.color")}
        className="h-8 w-10 shrink-0 cursor-pointer rounded border border-border bg-transparent"
      />
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        disabled={!canUpdate}
        aria-label={t("tasks.kanban.manage.name")}
        className="h-8 w-40"
      />
      <Input
        type="number"
        value={sortOrder}
        onChange={(e) => setSortOrder(e.target.value)}
        disabled={!canUpdate}
        aria-label={t("tasks.kanban.manage.sortOrder")}
        className="h-8 w-16"
      />
      <Badge variant="muted">{t(`tasks.kanban.manage.groups.${state.stateGroup}`)}</Badge>
      {state.isDefault && <Badge variant="muted">{t("tasks.kanban.manage.default")}</Badge>}
      {canUpdate && (
        <Button
          size="sm"
          variant="outline"
          disabled={updateMutation.isPending || name.trim().length === 0}
          onClick={() => updateMutation.mutate()}
        >
          {t("tasks.kanban.manage.save")}
        </Button>
      )}
      {canDelete && (
        <Button
          size="sm"
          variant="ghost"
          disabled={deleteMutation.isPending}
          onClick={() => deleteMutation.mutate()}
        >
          {t("tasks.kanban.manage.delete")}
        </Button>
      )}
    </div>
  );
}

export function TaskStateColumnsDialog({
  projectId,
  open,
  onClose,
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation("tasks");
  const queryClient = useQueryClient();
  const canCreate = useCan(
    PROJECT_STATE_PAIRS.CREATE.action,
    PROJECT_STATE_PAIRS.CREATE.resourceType,
  );
  const canUpdate = useCan(
    PROJECT_STATE_PAIRS.UPDATE.action,
    PROJECT_STATE_PAIRS.UPDATE.resourceType,
  );
  const canDelete = useCan(
    PROJECT_STATE_PAIRS.DELETE.action,
    PROJECT_STATE_PAIRS.DELETE.resourceType,
  );
  const [errorMsgKey, setErrorMsgKey] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newGroup, setNewGroup] = useState<ProjectStateGroupDto>("started");

  const { data: states } = useQuery({
    queryKey: taskKeys.states(projectId),
    queryFn: () => taskStatesApi.listStates(projectId),
    enabled: open,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      taskStatesApi.createState(projectId, { name: newName.trim(), stateGroup: newGroup }),
    onSuccess: () => {
      setErrorMsgKey(null);
      setNewName("");
      void queryClient.invalidateQueries({ queryKey: taskKeys.states(projectId) });
      void queryClient.invalidateQueries({ queryKey: taskKeys.kanban(projectId) });
    },
    onError: (err) => setErrorMsgKey(errorKey(err)),
  });

  return (
    <Dialog open={open} onClose={onClose} title={t("tasks.kanban.manage.title")}>
      <div className="space-y-3">
        {errorMsgKey && (
          <p role="alert" className="text-sm text-destructive">
            {t(errorMsgKey)}
          </p>
        )}
        <div className="space-y-2">
          {(states ?? []).map((s) => (
            <StateRow
              key={s.id}
              state={s}
              canUpdate={canUpdate}
              canDelete={canDelete}
              onError={setErrorMsgKey}
            />
          ))}
          {(states ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">{t("tasks.kanban.manage.empty")}</p>
          )}
        </div>
        {canCreate && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t("tasks.kanban.manage.namePlaceholder")}
              aria-label={t("tasks.kanban.manage.name")}
              className="h-8 w-40"
            />
            <select
              value={newGroup}
              onChange={(e) => setNewGroup(e.target.value as ProjectStateGroupDto)}
              aria-label={t("tasks.kanban.manage.group")}
              className="h-8 rounded-md border border-border bg-background px-2 text-sm"
            >
              {STATE_GROUP_OPTIONS.map((g) => (
                <option key={g} value={g}>
                  {t(`tasks.kanban.manage.groups.${g}`)}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              disabled={createMutation.isPending || newName.trim().length === 0}
              onClick={() => createMutation.mutate()}
              data-testid="state-manage-add"
            >
              {t("tasks.kanban.manage.add")}
            </Button>
          </div>
        )}
      </div>
    </Dialog>
  );
}
