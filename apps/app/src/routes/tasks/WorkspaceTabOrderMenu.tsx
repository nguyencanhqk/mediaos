import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUpDown, ChevronDown, ChevronUp } from "lucide-react";
import { Button, Popover } from "@mediaos/ui";
import type { ProjectWorkspaceTab } from "./workspace-constants";

/**
 * Nút "Thứ tự tab" ở cuối thanh tab trang dự án — sắp lại thứ tự tab cho RIÊNG mình
 * (localStorage, xem `useWorkspaceTabOrder`).
 *
 * Trước đây control này nằm trong tab "Cài đặt"; nhưng tab đó ẩn với người không quản trị được dự
 * án (Viewer/Member) ⇒ đúng những người đó KHÔNG có chỗ nào để đổi thứ tự tab của chính họ. Ở đây
 * nó đi cùng thanh tab nên ai xem được dự án đều dùng được — không cần quyền, vì không có gì
 * chạm dữ liệu nghiệp vụ.
 *
 * Danh sách chỉ liệt kê `tabs` ĐANG HIỆN của người dùng: nêu tên tab họ không có quyền thấy vừa
 * rò rỉ affordance vừa tạo nút bấm-không-hiệu-lực.
 *
 * ⚠️ data-testid ở đây KHÔNG dùng tiền tố `workspace-tab-` — test dò thứ tự thanh tab bằng
 * `querySelectorAll('[data-testid^="workspace-tab-"]')`, trùng tiền tố là nút này lọt vào phép đo.
 */
export function WorkspaceTabOrderMenu({
  tabs,
  isCustomized,
  onMove,
  onReset,
}: {
  tabs: ProjectWorkspaceTab[];
  isCustomized: boolean;
  onMove: (tab: ProjectWorkspaceTab, dir: -1 | 1) => void;
  onReset: () => void;
}) {
  const { t } = useTranslation("tasks");
  const [open, setOpen] = useState(false);

  // Còn 1 tab thì không có gì để sắp — ẩn hẳn nút thay vì mở ra một danh sách chết.
  if (tabs.length < 2) return null;

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      className="w-64"
      trigger={
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-muted-foreground"
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
          aria-label={t("projects.detail.tabOrder.title")}
          title={t("projects.detail.tabOrder.title")}
          data-testid="tab-order-trigger"
        >
          <ArrowUpDown className="h-4 w-4" aria-hidden="true" />
        </Button>
      }
    >
      <div className="space-y-2" data-testid="tab-order-menu">
        <div className="space-y-1 px-1">
          <p className="text-sm font-semibold text-foreground">
            {t("projects.detail.tabOrder.title")}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("projects.detail.tabOrder.description")}
          </p>
        </div>
        <ul className="divide-y divide-border rounded-md border border-border">
          {tabs.map((key, index) => (
            <li key={key} className="flex items-center justify-between gap-2 px-2 py-1">
              <span className="truncate text-sm text-foreground">
                {t(`projects.detail.tabs.${key}`)}
              </span>
              <span className="flex shrink-0 items-center">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 px-0"
                  disabled={index === 0}
                  onClick={() => onMove(key, -1)}
                  aria-label={t("projects.detail.tabOrder.moveUp")}
                  data-testid={`tab-move-up-${key}`}
                >
                  <ChevronUp className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 px-0"
                  disabled={index === tabs.length - 1}
                  onClick={() => onMove(key, 1)}
                  aria-label={t("projects.detail.tabOrder.moveDown")}
                  data-testid={`tab-move-down-${key}`}
                >
                  <ChevronDown className="h-4 w-4" aria-hidden="true" />
                </Button>
              </span>
            </li>
          ))}
        </ul>
        {isCustomized && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            onClick={onReset}
            data-testid="tab-order-reset"
          >
            {t("projects.detail.tabOrder.reset")}
          </Button>
        )}
      </div>
    </Popover>
  );
}
