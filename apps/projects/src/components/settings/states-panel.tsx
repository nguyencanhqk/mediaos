import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, Plus, Star, Trash2 } from "lucide-react";
import { ApiError, PermissionGate, useCan } from "@mediaos/web-core";
import type {
  CreateProjectStateRequest,
  ProjectStateDto,
  ProjectStateGroupDto,
} from "@mediaos/contracts";
import { Button, Input, Select, Skeleton } from "@mediaos/ui";
import { statesApi } from "@/lib/states-api";
import { queryKeys } from "@/lib/query-keys";
import { STATE_GROUP_META, STATE_GROUP_ORDER } from "@/lib/state-group";

interface StatesPanelProps {
  projectId: string;
}

/**
 * Quản lý trạng thái dự án (project_states): liệt kê (sortOrder) · thêm · đổi tên/màu/nhóm · đặt mặc định ·
 * đổi thứ tự (up/down qua PATCH sortOrder) · xoá (xử lý 400 "đang dùng" mềm). Gated *:project_state.
 */
export function StatesPanel({ projectId }: StatesPanelProps) {
  const { t } = useTranslation("projects");
  const qc = useQueryClient();
  const canUpdate = useCan("update", "project_state");
  const canDelete = useCan("delete", "project_state");

  const states = useQuery({
    queryKey: queryKeys.states(projectId),
    queryFn: () => statesApi.listStates(projectId),
  });

  const invalidate = () => void qc.invalidateQueries({ queryKey: queryKeys.states(projectId) });

  const [newName, setNewName] = useState("");
  const [newGroup, setNewGroup] = useState<ProjectStateGroupDto>("unstarted");
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => {
      const body: CreateProjectStateRequest = {
        name: newName.trim(),
        stateGroup: newGroup,
        color: STATE_GROUP_META[newGroup].defaultColor,
      };
      return statesApi.createState(projectId, body);
    },
    onSuccess: () => {
      invalidate();
      setNewName("");
    },
  });

  const update = useMutation({
    mutationFn: ({ stateId, data }: { stateId: string; data: Parameters<typeof statesApi.updateState>[1] }) =>
      statesApi.updateState(stateId, data),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (stateId: string) => statesApi.deleteState(stateId),
    onSuccess: () => {
      setDeleteError(null);
      invalidate();
    },
    onError: (err: unknown) => {
      // 400 = state đang được work item dùng → thông báo mềm thay vì vỡ trang (silent-failure gate).
      setDeleteError(err instanceof ApiError ? err.message : t("settings.states.deleteError"));
    },
  });

  const ordered = [...(states.data ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);

  const move = (index: number, dir: -1 | 1) => {
    const target = ordered[index + dir];
    const current = ordered[index];
    if (!target || !current) return;
    // Hoán đổi sortOrder (2 PATCH). Server là sự thật; invalidate sau khi cả hai xong.
    update.mutate({ stateId: current.id, data: { sortOrder: target.sortOrder } });
    update.mutate({ stateId: target.id, data: { sortOrder: current.sortOrder } });
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-foreground">{t("settings.states.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("settings.states.description")}</p>
      </div>

      {states.isLoading ? (
        <Skeleton className="h-40 w-full rounded-xl" />
      ) : (
        <ul className="space-y-2">
          {ordered.map((state, index) => (
            <StateRow
              key={state.id}
              state={state}
              canUpdate={canUpdate}
              canDelete={canDelete}
              isFirst={index === 0}
              isLast={index === ordered.length - 1}
              onMoveUp={() => move(index, -1)}
              onMoveDown={() => move(index, 1)}
              onRename={(name) => update.mutate({ stateId: state.id, data: { name } })}
              onRecolor={(color) => update.mutate({ stateId: state.id, data: { color } })}
              onSetDefault={() => update.mutate({ stateId: state.id, data: { isDefault: true } })}
              onDelete={() => remove.mutate(state.id)}
            />
          ))}
        </ul>
      )}

      {deleteError && <p className="text-sm text-destructive">{deleteError}</p>}

      <PermissionGate action="create" resourceType="project_state">
        <div className="flex flex-wrap items-end gap-2 rounded-xl border border-dashed border-border p-3">
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">
              {t("settings.states.newName")}
            </span>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t("settings.states.newNamePlaceholder")}
              className="w-48"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">
              {t("settings.states.group")}
            </span>
            <Select
              value={newGroup}
              onChange={(e) => setNewGroup(e.target.value as ProjectStateGroupDto)}
              className="w-40"
            >
              {STATE_GROUP_ORDER.map((g) => (
                <option key={g} value={g}>
                  {t(STATE_GROUP_META[g].labelKey)}
                </option>
              ))}
            </Select>
          </label>
          <Button
            size="sm"
            onClick={() => create.mutate()}
            disabled={!newName.trim() || create.isPending}
          >
            <Plus className="h-4 w-4" />
            {t("settings.states.add")}
          </Button>
        </div>
      </PermissionGate>
    </div>
  );
}

interface StateRowProps {
  state: ProjectStateDto;
  canUpdate: boolean;
  canDelete: boolean;
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRename: (name: string) => void;
  onRecolor: (color: string) => void;
  onSetDefault: () => void;
  onDelete: () => void;
}

function StateRow({
  state,
  canUpdate,
  canDelete,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
  onRename,
  onRecolor,
  onSetDefault,
  onDelete,
}: StateRowProps) {
  const { t } = useTranslation("projects");
  const [name, setName] = useState(state.name);

  return (
    <li className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
      <input
        type="color"
        value={state.color}
        disabled={!canUpdate}
        onChange={(e) => onRecolor(e.target.value)}
        aria-label={t("settings.states.color")}
        className="h-6 w-6 shrink-0 cursor-pointer rounded border border-border bg-transparent disabled:cursor-not-allowed"
      />
      {canUpdate ? (
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            if (name.trim() && name.trim() !== state.name) onRename(name.trim());
            else setName(state.name);
          }}
          className="flex-1 rounded-md border border-transparent bg-transparent px-1 py-0.5 text-sm hover:border-border focus:border-border focus:outline-none"
        />
      ) : (
        <span className="flex-1 text-sm text-foreground">{state.name}</span>
      )}

      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {t(STATE_GROUP_META[state.stateGroup].labelKey)}
      </span>

      {state.isDefault ? (
        <span
          className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-600"
          title={t("settings.states.isDefault")}
        >
          <Star className="h-3.5 w-3.5 fill-amber-500 text-amber-500" />
        </span>
      ) : (
        canUpdate && (
          <button
            type="button"
            onClick={onSetDefault}
            title={t("settings.states.setDefault")}
            className="rounded p-1 text-muted-foreground hover:text-amber-600"
          >
            <Star className="h-3.5 w-3.5" />
          </button>
        )
      )}

      {canUpdate && (
        <div className="flex items-center">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={isFirst}
            aria-label={t("settings.states.moveUp")}
            className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={isLast}
            aria-label={t("settings.states.moveDown")}
            className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {canDelete && (
        <button
          type="button"
          onClick={onDelete}
          aria-label={t("common.delete")}
          className="rounded p-1 text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </li>
  );
}
