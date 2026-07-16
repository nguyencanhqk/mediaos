/**
 * MeActionBlocks — "Cần thực hiện" (task quá hạn/đến hạn) + "Chờ người khác duyệt" (đơn nghỉ đang chờ)
 * (ME-SCREEN-001, SPEC-09 §10.1). Tái dùng `MeSectionCard` cho status-envelope (KHÔNG lặp lại UI logic 5
 * trạng thái) — cùng dữ liệu section task/leave ĐÃ hiển thị ở dải stat card, chỉ đổi góc nhìn "cần làm gì".
 */
import { ListChecks, Hourglass } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Badge, Button } from "@mediaos/ui";
import type { MeTaskSection, MeLeaveSection } from "@mediaos/contracts";
import { MeSectionCard } from "./MeSectionCard";
import { ME_QUICK_ACTION_PATHS } from "../constants";

function ViewAllFooter({ path, label }: { path: string; label: string }) {
  const navigate = useNavigate();
  return (
    <div className="border-t border-border px-6 py-2.5">
      <Button variant="ghost" size="sm" onClick={() => void navigate({ to: path as "/" })}>
        {label}
      </Button>
    </div>
  );
}

interface MeActionNeededCardProps {
  isPageLoading: boolean;
  section: MeTaskSection | undefined;
}

/** Task quá hạn/đến hạn hôm nay — deep-link "Xem tất cả" sang My Tasks (§12.5). */
export function MeActionNeededCard({ isPageLoading, section }: MeActionNeededCardProps) {
  const { t } = useTranslation("me");
  return (
    <MeSectionCard
      title={t("actionNeeded.title")}
      icon={ListChecks}
      isPageLoading={isPageLoading}
      section={section}
      isEmpty={(d) => d.dueTodayCount === 0 && d.overdueCount === 0}
      emptyTitle={t("task.noneToday")}
      footer={
        <ViewAllFooter path={ME_QUICK_ACTION_PATHS.MY_TASKS} label={t("actionNeeded.viewAll")} />
      }
    >
      {(d) => (
        <div className="flex flex-wrap gap-1.5 text-sm">
          {d.overdueCount > 0 && (
            <Badge variant="danger">{t("task.overdue", { count: d.overdueCount })}</Badge>
          )}
          {d.dueTodayCount > 0 && (
            <Badge variant="warning">{t("task.dueToday", { count: d.dueTodayCount })}</Badge>
          )}
        </div>
      )}
    </MeSectionCard>
  );
}

interface MePendingApprovalCardProps {
  isPageLoading: boolean;
  section: MeLeaveSection | undefined;
}

/** Đơn nghỉ của tôi đang chờ duyệt — deep-link "Xem tất cả" sang Đơn nghỉ của tôi (§12.5). */
export function MePendingApprovalCard({ isPageLoading, section }: MePendingApprovalCardProps) {
  const { t } = useTranslation("me");
  return (
    <MeSectionCard
      title={t("pendingApproval.title")}
      icon={Hourglass}
      isPageLoading={isPageLoading}
      section={section}
      isEmpty={(d) => d.pendingRequestCount === 0}
      emptyTitle={t("leave.noPendingRequests")}
      footer={
        <ViewAllFooter
          path={ME_QUICK_ACTION_PATHS.MY_LEAVE_REQUESTS}
          label={t("pendingApproval.viewAll")}
        />
      }
    >
      {(d) => (
        <Badge variant="warning">
          {t("leave.pendingRequests", { count: d.pendingRequestCount })}
        </Badge>
      )}
    </MeSectionCard>
  );
}
