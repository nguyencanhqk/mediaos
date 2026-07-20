import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  taskCoreApi,
  taskProjectApi,
  taskStatesApi,
  taskKeys,
  taskCoreInvalidation,
  useCan,
  ApiError,
} from "@mediaos/web-core";
import { Dialog, Button, Select } from "@mediaos/ui";
import type { TaskCoreResponseDto } from "@mediaos/contracts";

/**
 * TaskMoveProjectDialog — S5-TASK-MOVEPROJ-1. ĐƯỜNG DUY NHẤT để đổi dự án của một công việc.
 *
 * VÌ SAO PHẢI CÓ RIÊNG, không nhét vào form Sửa: đổi dự án KHÔNG phải đổi một trường. Task còn mang
 * `state_id` — cột trên board — và cột thuộc về ĐÚNG MỘT dự án. Form Sửa cũ gửi mỗi `projectId`;
 * server đổi `project_id` nhưng không đụng `state_id` (nhánh ghi project không gọi applyStateChangeTx)
 * ⇒ task nằm ở dự án mới trong khi cột trỏ dự án CŨ. Board dự án mới không khớp cột nào nên thả thẻ
 * vào cột mặc định, còn DB mang tham chiếu chéo dự án tới lần kéo-thả kế tiếp. Im lặng, không lỗi.
 * Ở đây người dùng BẮT BUỘC chọn cột đích, và cả hai đi trong CÙNG một PATCH.
 *
 * QUYỀN: cần `update:task` (đổi trường) VÀ `update-state:task` (gửi kèm stateId — server đòi thêm,
 * 403 TRƯỚC khi ghi). Thiếu một trong hai ⇒ không mở được (nút bị ẩn ở nơi gọi).
 *
 * D-36a — CHỈ task GỐC KHÔNG CÓ việc con mới đổi được dự án (dự án của cả CÂY là bất biến; server trả
 * 400 SUBTASK_*_PROJECT_LOCKED). Chặn ngay ở đây kèm giải thích, thay vì để người dùng bấm rồi ăn lỗi.
 */
function moveErrorKey(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 400) return "tasks.moveProject.errors.badRequest";
    if (err.status === 403) return "tasks.moveProject.errors.forbidden";
    if (err.status === 404) return "tasks.moveProject.errors.notFound";
    if (err.status >= 500) return "tasks.moveProject.errors.server";
  }
  return "tasks.moveProject.errors.generic";
}

export function TaskMoveProjectDialog({
  task,
  onClose,
}: {
  task: TaskCoreResponseDto;
  onClose: () => void;
}) {
  const { t } = useTranslation("tasks");
  const queryClient = useQueryClient();
  const canReadProjects = useCan("read", "project");

  const [projectId, setProjectId] = useState(task.projectId ?? "");
  const [stateId, setStateId] = useState("");

  // D-36a — cây (cha có con / chính nó là con) khoá dự án. Kiểm ở đây CHỈ để giải thích sớm;
  // server vẫn là người quyết cuối.
  const isSubtask = task.parentTaskId !== null;
  const hasChildren = (task.subtaskTotal ?? 0) > 0;
  const treeLocked = isSubtask || hasChildren;

  const { data: projectsPage } = useQuery({
    queryKey: taskKeys.projects.list({ limit: 100 }),
    queryFn: () => taskProjectApi.listProjects({ limit: 100 }),
    enabled: canReadProjects && !treeLocked,
    staleTime: 60_000,
  });
  // listProjects trả MẢNG TRẦN (không bọc {data,meta}) — xem task-project-api.
  const projects = projectsPage ?? [];

  // Cột của dự án ĐANG CHỌN (không phải dự án hiện tại của task) — đổi dự án là đổi luôn danh sách cột.
  const {
    data: states,
    isLoading: statesLoading,
    isError: statesError,
  } = useQuery({
    queryKey: taskKeys.states(projectId),
    queryFn: () => taskStatesApi.listStates(projectId),
    enabled: !treeLocked && projectId !== "",
    staleTime: 60_000,
  });
  const columns = states ?? [];
  const projectChanged = projectId !== (task.projectId ?? "");

  const mutation = useMutation({
    // projectId + stateId đi CÙNG một PATCH, cả hai LUÔN có giá trị — `canSubmit` bên dưới là thứ bảo
    // đảm điều đó. KHÔNG gửi có điều kiện (`...(stateId ? {stateId} : {})`): server chỉ gọi
    // applyStateChangeTx khi `dto.stateId !== undefined` (task-core.service.ts:663), nên PATCH thiếu
    // stateId ⇒ đổi project_id mà GIỮ NGUYÊN state_id trỏ cột dự án CŨ = đúng bug WO này đi vá.
    mutationFn: () => taskCoreApi.updateTask(task.id, { projectId, stateId }),
    onSuccess: async () => {
      // Chạm CẢ HAI board: dự án cũ mất thẻ, dự án mới có thêm thẻ.
      const keys = [
        ...taskCoreInvalidation.detail(task.id),
        ...(task.projectId ? [taskKeys.kanban(task.projectId)] : []),
        ...(projectId ? [taskKeys.kanban(projectId)] : []),
      ];
      await Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
      onClose();
    },
  });

  // ĐỔI DỰ ÁN LUÔN PHẢI KÈM CỘT ĐÍCH — không có ngoại lệ nào "cho đi tiếp". Contract KHÔNG cho gửi
  // `stateId: null` (updateTaskCoreSchema.stateId = z.string().uuid(), không nullable) và server
  // KHÔNG BAO GIỜ tự xoá state_id khi project đổi ⇒ mọi đường submit thiếu stateId đều để lại
  // state_id trỏ cột dự án CŨ. Ba cửa từng lọt, nay đóng cả ba:
  //   (a) chọn "Không thuộc dự án" — ĐÃ GỠ khỏi danh sách (xem <Select> bên dưới): không diễn đạt
  //       được bằng contract hiện tại nên không được phép bấm ra dữ liệu hỏng;
  //   (b) dự án đích 0 cột pipeline — chặn kèm giải thích, KHÔNG cho đi tiếp;
  //   (c) đua tải cột / API cột lỗi — `states ?? []` cho columns rỗng trông y hệt "dự án không có
  //       cột", nên phải đòi tải xong VÀ không lỗi trước khi cho bấm.
  const columnsReady = projectId !== "" && !statesLoading && !statesError && columns.length > 0;
  const canSubmit =
    !treeLocked && projectChanged && !mutation.isPending && columnsReady && stateId !== "";
  const needsColumn = columnsReady && projectChanged;

  return (
    <Dialog
      open
      onClose={onClose}
      title={t("tasks.moveProject.title")}
      description={t("tasks.moveProject.description")}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>
            {t("tasks.moveProject.cancel")}
          </Button>
          <Button
            size="sm"
            disabled={!canSubmit}
            onClick={() => mutation.mutate()}
            data-testid="move-project-submit"
          >
            {mutation.isPending ? t("tasks.moveProject.saving") : t("tasks.moveProject.confirm")}
          </Button>
        </>
      }
    >
      {treeLocked ? (
        <p role="alert" className="text-sm text-muted-foreground" data-testid="move-project-locked">
          {isSubtask ? t("tasks.moveProject.lockedChild") : t("tasks.moveProject.lockedParent")}
        </p>
      ) : (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="move-project-select"
              className="text-xs font-medium text-muted-foreground"
            >
              {t("tasks.moveProject.projectLabel")}
            </label>
            <Select
              id="move-project-select"
              value={projectId}
              disabled={mutation.isPending}
              onChange={(e) => {
                setProjectId(e.target.value);
                // Đổi dự án ⇒ cột cũ vô nghĩa (thuộc dự án khác). Xoá để buộc chọn lại.
                setStateId("");
              }}
            >
              {/* CỐ Ý KHÔNG có option "Không thuộc dự án": gỡ task khỏi dự án đòi xoá luôn state_id,
                  mà contract không cho gửi `stateId: null` và server không tự dọn ⇒ chọn được nó là
                  đẻ ra task project_id=NULL còn state_id trỏ cột dự án cũ. Cần thao tác này thì phải
                  mở đường ở BE trước (WO riêng, vùng đỏ) — xem docblock canSubmit. */}
              {task.projectId === null && (
                <option value="">{t("tasks.moveProject.pickProject")}</option>
              )}
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>

          {projectId !== "" && (
            <div className="space-y-1.5">
              <label
                htmlFor="move-project-state"
                className="text-xs font-medium text-muted-foreground"
              >
                {t("tasks.moveProject.columnLabel")}
              </label>
              {statesLoading ? (
                <div className="h-10 animate-pulse rounded bg-muted" />
              ) : statesError ? (
                // Tách BẠCH khỏi "dự án không có cột": cả hai đều cho `columns` rỗng nên nếu gộp
                // chung một thông báo, lỗi mạng sẽ đội lốt "dự án này chưa có cột" — người dùng đi
                // tạo cột cho một dự án vốn đã có đủ cột.
                <p className="text-xs text-destructive">{t("tasks.moveProject.columnsError")}</p>
              ) : columns.length === 0 ? (
                <p className="text-xs text-destructive">{t("tasks.moveProject.noColumns")}</p>
              ) : (
                <Select
                  id="move-project-state"
                  value={stateId}
                  disabled={mutation.isPending}
                  onChange={(e) => setStateId(e.target.value)}
                >
                  <option value="">{t("tasks.moveProject.pickColumn")}</option>
                  {columns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              )}
              {needsColumn && stateId === "" && (
                <p className="text-xs text-muted-foreground">
                  {t("tasks.moveProject.columnRequiredHint")}
                </p>
              )}
            </div>
          )}

          {mutation.isError && (
            <p role="alert" className="text-sm text-destructive">
              {t(moveErrorKey(mutation.error))}
            </p>
          )}
        </div>
      )}
    </Dialog>
  );
}
