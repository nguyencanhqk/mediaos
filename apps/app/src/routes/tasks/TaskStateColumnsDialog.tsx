import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { taskStatesApi, taskKeys, useCan, ApiError } from "@mediaos/web-core";
import { Badge, Button, Dialog, Input, Skeleton } from "@mediaos/ui";
import {
  projectStateGroupSchema,
  type ProjectRoleDto,
  type ProjectStateDto,
  type ProjectStateGroupDto,
  type UpdateProjectStateRequest,
} from "@mediaos/contracts";
import { isProjectManagerOrOwner, PROJECT_STATE_PAIRS } from "./constants";

/**
 * S5-TASK-PIPELINE-1 (lane fe) — quản lý CỘT pipeline của dự án (SPEC-06 §6.8, DECISIONS-03: kỷ luật
 * quy trình nằm ở THỨ TỰ CỘT + quyền cấu hình cột). Thêm/đổi tên/màu — mỗi thao tác gate đúng
 * pair create/update/delete:project_state qua useCan (server vẫn là người quyết). Xoá cột còn task
 * sống ⇒ server 400 — hiển thị lỗi, không xoá mù.
 *
 * Thứ tự cột sắp bằng nút LÊN/XUỐNG per-row (thay ô nhập số cũ): mỗi lần bấm đánh lại số 1..n theo
 * vị trí mới rồi PATCH những cột có sortOrder đổi. Mở từ tab Cài đặt của dự án (ProjectSettingsTab).
 */

// Derive từ schema contracts — thêm nhóm thứ 7 sau này không trôi (finding LIGHT gate, DRY).
const STATE_GROUP_OPTIONS: readonly ProjectStateGroupDto[] = projectStateGroupSchema.options;

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
  canMoveUp,
  canMoveDown,
  reordering,
  onMove,
  onError,
}: {
  state: ProjectStateDto;
  canUpdate: boolean;
  canDelete: boolean;
  /** Sắp thứ tự bằng nút lên/xuống — dialog (biết hàng xóm) quyết, row chỉ phát tín hiệu. */
  canMoveUp: boolean;
  canMoveDown: boolean;
  reordering: boolean;
  onMove: (dir: -1 | 1) => void;
  onError: (key: string | null) => void;
}) {
  const { t } = useTranslation("tasks");
  const queryClient = useQueryClient();
  const [name, setName] = useState(state.name);
  const [color, setColor] = useState(state.color);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: taskKeys.states(state.projectId) });
    void queryClient.invalidateQueries({ queryKey: taskKeys.kanban(state.projectId) });
  };

  // Chỉ gửi field DIRTY (PATCH partial — finding LIGHT gate: gửi đủ bộ sẽ last-write-wins đè
  // rename của người khác đang mở dialog song song một cách câm lặng).
  const dirtyPatch: UpdateProjectStateRequest = {};
  if (name.trim() !== state.name) dirtyPatch.name = name.trim();
  if (color !== state.color) dirtyPatch.color = color;
  const hasDirty = Object.keys(dirtyPatch).length > 0;

  const updateMutation = useMutation({
    mutationFn: () => taskStatesApi.updateState(state.id, dirtyPatch),
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
      {canUpdate && (
        <div className="flex shrink-0 items-center">
          <Button
            size="sm"
            variant="ghost"
            className="h-8 w-7 px-0"
            disabled={!canMoveUp || reordering}
            onClick={() => onMove(-1)}
            aria-label={t("tasks.kanban.manage.moveUp")}
            data-testid={`state-move-up-${state.id}`}
          >
            <ChevronUp className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 w-7 px-0"
            disabled={!canMoveDown || reordering}
            onClick={() => onMove(1)}
            aria-label={t("tasks.kanban.manage.moveDown")}
            data-testid={`state-move-down-${state.id}`}
          >
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      )}
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
      <Badge variant="muted">{t(`tasks.kanban.manage.groups.${state.stateGroup}`)}</Badge>
      {state.isDefault && <Badge variant="muted">{t("tasks.kanban.manage.default")}</Badge>}
      {canUpdate && (
        <Button
          size="sm"
          variant="outline"
          disabled={updateMutation.isPending || name.trim().length === 0 || !hasDirty}
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
  myProjectRole = null,
  open,
  onClose,
}: {
  projectId: string;
  /** Vai trò của CHÍNH actor trong dự án — S5-TASK-PROJROLE-1, D-24 (Owner/Manager quản cột). */
  myProjectRole?: ProjectRoleDto | null;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation("tasks");
  const queryClient = useQueryClient();
  const roleAllows = isProjectManagerOrOwner(myProjectRole);
  const canCreate =
    useCan(PROJECT_STATE_PAIRS.CREATE.action, PROJECT_STATE_PAIRS.CREATE.resourceType) ||
    roleAllows;
  const canUpdate =
    useCan(PROJECT_STATE_PAIRS.UPDATE.action, PROJECT_STATE_PAIRS.UPDATE.resourceType) ||
    roleAllows;
  const canDelete =
    useCan(PROJECT_STATE_PAIRS.DELETE.action, PROJECT_STATE_PAIRS.DELETE.resourceType) ||
    roleAllows;
  const [errorMsgKey, setErrorMsgKey] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newGroup, setNewGroup] = useState<ProjectStateGroupDto>("started");

  // Mở lại dialog = phiên mới: xoá lỗi cũ + draft tên cột (finding LIGHT gate — state sống ở
  // wrapper luôn-mounted nên không tự reset).
  useEffect(() => {
    if (open) {
      setErrorMsgKey(null);
      setNewName("");
    }
  }, [open]);

  const {
    data: states,
    isLoading,
    isError,
  } = useQuery({
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

  // Hiển thị THEO sortOrder (tie-break tên) — cùng thứ tự board vẽ cột; là nền cho nút lên/xuống.
  const sortedStates = useMemo(
    () =>
      [...(states ?? [])].sort(
        (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "vi"),
      ),
    [states],
  );

  // Sắp thứ tự bằng nút lên/xuống: đánh lại số 1..n theo vị trí MỚI rồi PATCH những cột có
  // sortOrder đổi (bình thường 2 cột; lần đầu có thể nhiều hơn nếu dữ liệu cũ trùng/thủng số —
  // tự lành). Lỗi giữa chừng ⇒ một phần PATCH có thể đã ăn: refetch từ server thay vì tin cache.
  const reorderMutation = useMutation({
    mutationFn: (patches: Array<{ id: string; sortOrder: number }>) =>
      Promise.all(patches.map((p) => taskStatesApi.updateState(p.id, { sortOrder: p.sortOrder }))),
    onSuccess: () => setErrorMsgKey(null),
    onError: (err) => setErrorMsgKey(errorKey(err)),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: taskKeys.states(projectId) });
      void queryClient.invalidateQueries({ queryKey: taskKeys.kanban(projectId) });
    },
  });

  const moveState = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= sortedStates.length || reorderMutation.isPending) return;
    const next = [...sortedStates];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    const patches = next
      .map((s, i) => ({ id: s.id, from: s.sortOrder, sortOrder: i + 1 }))
      .filter((p) => p.from !== p.sortOrder)
      .map(({ id, sortOrder }) => ({ id, sortOrder }));
    if (patches.length > 0) reorderMutation.mutate(patches);
  };

  return (
    <Dialog open={open} onClose={onClose} title={t("tasks.kanban.manage.title")}>
      <div className="space-y-3">
        {errorMsgKey && (
          <p role="alert" className="text-sm text-destructive">
            {t(errorMsgKey)}
          </p>
        )}
        <div className="space-y-2">
          {isLoading && <Skeleton className="h-24 w-full" />}
          {isError && (
            <p role="alert" className="text-sm text-destructive">
              {t("tasks.kanban.error.title")}
            </p>
          )}
          {!isLoading &&
            !isError &&
            sortedStates.map((s, index) => (
              <StateRow
                // key kèm updatedAt: server đổi (người khác sửa song song) ⇒ row REMOUNT, draft
                // resync theo dữ liệu mới (finding LIGHT gate — chống draft cũ đè rename).
                key={`${s.id}-${s.updatedAt}`}
                state={s}
                canUpdate={canUpdate}
                canDelete={canDelete}
                canMoveUp={index > 0}
                canMoveDown={index < sortedStates.length - 1}
                reordering={reorderMutation.isPending}
                onMove={(dir) => moveState(index, dir)}
                onError={setErrorMsgKey}
              />
            ))}
          {!isLoading && !isError && sortedStates.length === 0 && (
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
