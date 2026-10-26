import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { taskKeys, taskProjectApi, useCan } from "@mediaos/web-core";
import { TASK_CORE_ENGINE_PAIRS } from "./constants";
import type { PreferredEmployee } from "./EmployeePicker";
import { TaskQuickAdd } from "./TaskQuickAdd";

/**
 * KanbanQuickCreate — S5-TASK-BOARD-UX-1. Nút "+" đáy cột pipeline: bấm → ô nhập ngay TRONG cột,
 * gõ tiêu đề, Enter là tạo việc THẲNG vào đúng cột đó (benchmark UX MISA AMIS — nhập hàng loạt
 * không phải mở form).
 *
 * Backend đã dựng sẵn cho đúng luồng này: `createTaskCoreSchema` nhận `stateId` tường minh và
 * task-core.service.ts §3c ghi rõ đây là nút "+ Thêm công việc" đáy cột board — server tự suy
 * `task_status` từ NHÓM của cột (không hardcode 'Todo'), nên FE KHÔNG gửi status.
 *
 * QUYỀN: cần CẢ HAI `create:task` và `update-state:task` — server đòi thêm update-state khi có
 * `stateId` tường minh (403 TRƯỚC khi tạo). Thiếu một trong hai ⇒ ẩn hẳn nút, không hiện-rồi-403.
 *
 * CHỈ dùng cho cột chế độ pipeline (columnMode:'state'). Cột chế độ status cũ KHÔNG có nút này:
 * server từ chối `stateId` ở chế độ đó nên việc tạo ra sẽ rơi vào cột mặc định — sai cột người dùng
 * vừa bấm, tệ hơn là không có nút. Board chế độ status tạo việc qua «Tạo công việc» của board.
 *
 * Sau khi tạo: ô nhập TỰ XOÁ và GIỮ focus để gõ tiếp việc sau (nhập liên tiếp), Esc để đóng.
 *
 * S20-TASK-QUICKADD-1 (US-TASK-QL-06) — ô nhập là `TaskQuickAdd` dùng chung, thêm chip «Người» (cần
 * `assign:task`; thành viên dự án đứng đầu picker) + «Hạn» (cần `update-deadline:task`), giữ qua các
 * lần Enter; Esc đóng ô và xoá chip. Server tự kiểm người phụ trách (thành viên dự án / phạm vi).
 */
const MEMBERS_STALE_TIME_MS = 60_000;

export function KanbanQuickCreate({ projectId, stateId }: { projectId: string; stateId: string }) {
  const { t } = useTranslation("tasks");
  const [open, setOpen] = useState(false);

  const { CREATE, UPDATE_STATE, ASSIGN } = TASK_CORE_ENGINE_PAIRS;
  const canCreate = useCan(CREATE.action, CREATE.resourceType);
  const canSetState = useCan(UPDATE_STATE.action, UPDATE_STATE.resourceType);
  const canAssign = useCan(ASSIGN.action, ASSIGN.resourceType);
  const canReadProject = useCan("read", "project");

  // Thành viên dự án cho chip Người — chỉ tải khi ô MỞ (mỗi cột có một ô; khoá chung ⇒ cache-hit).
  const { data: members } = useQuery({
    queryKey: taskKeys.projects.members(projectId),
    queryFn: () => taskProjectApi.listMembers(projectId),
    enabled: open && canAssign && canReadProject,
    staleTime: MEMBERS_STALE_TIME_MS,
  });
  const preferred = useMemo<readonly PreferredEmployee[]>(
    () =>
      (members ?? []).flatMap((m) =>
        m.employeeId && m.status === "Active" && !m.removedAt
          ? [{ id: m.employeeId, fullName: m.employeeName, avatarUrl: null }]
          : [],
      ),
    [members],
  );

  if (!canCreate || !canSetState) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid={`kanban-quick-create-open-${stateId}`}
        className="flex items-center gap-1.5 rounded-md px-1 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        {t("tasks.kanban.quickCreate.button")}
      </button>
    );
  }

  return (
    <TaskQuickAdd
      id={`kanban-quick-create-${stateId}`}
      inputTestId={`kanban-quick-create-input-${stateId}`}
      projectId={projectId}
      stateId={stateId}
      withAssigneeChip
      preferredAssignees={preferred}
      placeholder={t("tasks.kanban.quickCreate.placeholder")}
      hint={t("tasks.kanban.quickCreate.hint")}
      autoFocus
      onClose={() => setOpen(false)}
    />
  );
}
