import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { taskProjectApi } from "@mediaos/web-core";
import type { TaskCoreResponseDto, TaskProjectResponseDto } from "@mediaos/contracts";
import { Dialog, cn } from "@mediaos/ui";
import { TaskQuickAdd } from "@/routes/tasks/TaskQuickAdd";
import { useMyEmployeeLink } from "@/routes/tasks/use-my-employee";
import { readRecentProjectId } from "./recent-project";

/**
 * S20-X-QUICKCREATE-1 — hộp «Tạo việc nhanh»: dùng lại `TaskQuickAdd` (chỉ Tiêu đề, giao cho TÔI, dự án
 * TRỐNG). Chip «dự án gần nhất» chỉ là gợi ý phải bấm; server vẫn là cổng thật (create:task + phạm vi
 * dự án) — FE chỉ ẩn chip khi đã biết dự án lưu trữ/đã đóng hoặc tôi không còn là thành viên.
 */
export interface QuickCreateDialogProps {
  onClose: () => void;
  onCreated: (task: TaskCoreResponseDto) => void;
  onCreateError: (message: string, title: string) => void;
  onExpand: (draft: { title: string; project: { id: string; name: string } | null }) => void;
}

/** Vai trò xem-thôi không tạo được việc ⇒ không gợi ý. */
const NON_CREATING_ROLE = "Viewer";
const RECENT_PROJECT_STALE_MS = 60_000;

export function isSuggestableProject(project: TaskProjectResponseDto): boolean {
  return (
    project.status !== "Archived" &&
    project.closedAt === null &&
    project.myProjectRole !== null &&
    project.myProjectRole !== NON_CREATING_ROLE
  );
}

function useRecentProjectSuggestion(): TaskProjectResponseDto | null {
  const [recentId] = useState(readRecentProjectId);
  const { data } = useQuery({
    queryKey: ["quick-create", "recent-project", recentId],
    queryFn: () => taskProjectApi.getProject(recentId as string),
    enabled: recentId !== null,
    retry: false,
    staleTime: RECENT_PROJECT_STALE_MS,
  });
  return data && isSuggestableProject(data) ? data : null;
}

export function QuickCreateDialog({
  onClose,
  onCreated,
  onCreateError,
  onExpand,
}: QuickCreateDialogProps) {
  const { t } = useTranslation("tasks");
  const me = useMyEmployeeLink(true);
  const suggestion = useRecentProjectSuggestion();
  const [pickedProject, setPickedProject] = useState(false);
  const project = pickedProject && suggestion ? suggestion : null;
  const reasonKey =
    me.status === "unlinked"
      ? "quickCreate.unlinked"
      : me.status === "error"
        ? "quickCreate.meFailed"
        : "quickCreate.loading";

  return (
    <Dialog open onClose={onClose} title={t("quickCreate.dialogTitle")}>
      {/* data-floating-layer: hợp đồng với Sheet (chat drawer) — hộp portal ra ngoài panel nên Sheet không
          thấy là modal con; có dấu này thì Esc chỉ đóng hộp, không đóng cả drawer bên dưới. */}
      <div className="space-y-3" data-testid="quick-create-dialog" data-floating-layer="open">
        <TaskQuickAdd
          id="quick-create"
          fixedAssigneeEmployeeId={me.status === "linked" ? me.employeeId : undefined}
          disabled={me.status !== "linked"}
          disabledReason={t(reasonKey)}
          projectId={project?.id}
          placeholder={t("quickCreate.placeholder")}
          hint={t("quickCreate.hint")}
          titleRequiredMessage={t("quickCreate.titleRequired")}
          withDeadlineChip={false}
          showServerReason
          badRequestMessage={t("quickCreate.badRequest")}
          autoFocus
          onClose={onClose}
          closeOnBlur={false}
          onCreated={onCreated}
          onCreateError={onCreateError}
          expandLabel={t("quickCreate.expand")}
          onExpand={({ title }) =>
            onExpand({ title, project: project ? { id: project.id, name: project.name } : null })
          }
        />
        {suggestion && me.status === "linked" && (
          <button
            type="button"
            aria-pressed={pickedProject}
            data-testid="quick-create-recent-project"
            onClick={() => setPickedProject((v) => !v)}
            className={cn(
              "inline-flex h-6 max-w-full items-center truncate rounded-full border px-2 text-xs transition-colors",
              pickedProject
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {t("quickCreate.recentProject", { name: suggestion.name })}
          </button>
        )}
      </div>
    </Dialog>
  );
}
