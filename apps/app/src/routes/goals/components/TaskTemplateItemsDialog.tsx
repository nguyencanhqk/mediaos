import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import {
  ApiError,
  taskTemplateApi,
  taskTemplateInvalidation,
  taskTemplateKeys,
} from "@mediaos/web-core";
import type {
  TaskTemplateItemResponseDto,
  TaskTemplatePriorityDto,
  TaskTemplateResponseDto,
} from "@mediaos/contracts";
import { Button, Dialog, Input, Select } from "@mediaos/ui";
import { TASK_TEMPLATE_PRIORITY_OPTIONS } from "../constants";

interface ItemDraft {
  title: string;
  defaultPriority: TaskTemplatePriorityDto;
  estimateHours: string;
  /** Checklist nhập bằng 1 dòng, phân tách bằng dấu `;` — mảng chuỗi ở API (DB-11 §6.4). */
  checklist: string;
}

const EMPTY_DRAFT: ItemDraft = {
  title: "",
  defaultPriority: "none",
  estimateHours: "",
  checklist: "",
};

/**
 * GOAL-SCREEN-006 (S5-GOAL-TPL-1) — quản lý VIỆC MẪU của một danh mục (GOAL-API-012 "+ items").
 *
 * Mỗi item là một endpoint riêng (POST/PATCH/DELETE `/task-templates/:id/items[/:itemId]`) — KHÔNG gửi
 * cả mảng: hai người sửa hai item khác nhau thì không ai ghi đè ai, và xoá là XOÁ MỀM ở server.
 *
 * `estimateHours` chỉ để lập kế hoạch/hiển thị: bảng `tasks` KHÔNG có cột giờ ước lượng nên phân rã
 * KHÔNG mang giá trị này sang việc (nợ ghi ở docs/plans/S5-GOAL-TPL-1.md §6) — nhãn nói rõ để người
 * dùng không tưởng nó chảy vào việc.
 */
export function TaskTemplateItemsDialog({
  template,
  onClose,
}: {
  template: TaskTemplateResponseDto;
  onClose: () => void;
}) {
  const { t } = useTranslation("goals");
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<ItemDraft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);

  const itemsQuery = useQuery({
    queryKey: taskTemplateKeys.detail(template.id),
    queryFn: () => taskTemplateApi.getTemplate(template.id),
    staleTime: 30_000,
  });
  const items = itemsQuery.data?.items ?? [];

  const invalidate = async () => {
    await Promise.all(
      taskTemplateInvalidation
        .items(template.id)
        .map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    );
  };

  const toBody = (d: ItemDraft) => ({
    title: d.title.trim(),
    defaultPriority: d.defaultPriority === "none" ? null : d.defaultPriority,
    estimateHours: d.estimateHours.trim() === "" ? null : Number(d.estimateHours),
    checklist: splitChecklist(d.checklist),
  });

  /**
   * Biến của mutation dựng TẠI THỜI ĐIỂM BẤM (không đọc `draft`/`editingId` trong thân `mutationFn`) —
   * React Query v5 nạp options trong `useEffect`, closure cũ sẽ lưu giá trị CŨ mà không báo lỗi gì.
   */
  const saveMutation = useMutation({
    mutationFn: (vars: { itemId: string | null; body: ReturnType<typeof toBody> }) =>
      vars.itemId
        ? taskTemplateApi.updateItem(template.id, vars.itemId, vars.body)
        : taskTemplateApi.createItem(template.id, vars.body),
    onSuccess: async () => {
      await invalidate();
      setDraft(EMPTY_DRAFT);
      setEditingId(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (itemId: string) => taskTemplateApi.deleteItem(template.id, itemId),
    onSuccess: invalidate,
  });

  const error = saveMutation.error ?? deleteMutation.error;
  const errorMessage =
    error instanceof ApiError && error.message
      ? error.message
      : error
        ? t("templates.items.error")
        : null;

  function startEdit(item: TaskTemplateItemResponseDto) {
    setEditingId(item.id);
    setDraft({
      title: item.title,
      defaultPriority: item.defaultPriority ?? "none",
      estimateHours: item.estimateHours === null ? "" : String(item.estimateHours),
      checklist: item.checklist.join("; "),
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t("templates.items.title", { name: template.name })}
      description={t("templates.items.description")}
      footer={
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={onClose}>
            {t("templates.items.close")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="max-h-56 space-y-1 overflow-y-auto">
          {itemsQuery.isLoading ? (
            <div className="h-20 animate-pulse rounded bg-muted" />
          ) : itemsQuery.isError ? (
            <p className="py-3 text-center text-sm text-destructive" role="alert">
              {t("templates.items.loadError")}
            </p>
          ) : items.length === 0 ? (
            <p className="py-3 text-center text-sm text-muted-foreground">
              {t("templates.items.empty")}
            </p>
          ) : (
            items.map((item) => (
              <div
                key={item.id}
                data-testid={`task-template-item-${item.id}`}
                className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-muted"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-foreground">{item.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {t(`templatePriority.${item.defaultPriority ?? "none"}`)}
                    {item.estimateHours !== null
                      ? ` · ${t("templates.items.hours", { value: item.estimateHours })}`
                      : ""}
                    {item.checklist.length > 0
                      ? ` · ${t("templates.items.checklistCount", { count: item.checklist.length })}`
                      : ""}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t("templates.items.edit")}
                  onClick={() => startEdit(item)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t("templates.items.delete")}
                  data-testid={`task-template-item-delete-${item.id}`}
                  disabled={deleteMutation.isPending}
                  onClick={() => deleteMutation.mutate(item.id)}
                >
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>
            ))
          )}
        </div>

        <div className="space-y-2 rounded-md border border-border p-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground">
              {editingId ? t("templates.items.editingTitle") : t("templates.items.addTitle")}
            </p>
            {editingId && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditingId(null);
                  setDraft(EMPTY_DRAFT);
                }}
              >
                <X className="mr-1 h-3.5 w-3.5" />
                {t("templates.items.cancelEdit")}
              </Button>
            )}
          </div>
          <Input
            data-testid="task-template-item-title"
            value={draft.title}
            onChange={(e) => setDraft((prev) => ({ ...prev, title: e.target.value }))}
            placeholder={t("templates.items.titlePlaceholder")}
            aria-label={t("templates.items.titleLabel")}
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <Select
              aria-label={t("templates.items.priorityLabel")}
              value={draft.defaultPriority}
              onChange={(e) =>
                setDraft((prev) => ({
                  ...prev,
                  defaultPriority: e.target.value as TaskTemplatePriorityDto,
                }))
              }
            >
              {TASK_TEMPLATE_PRIORITY_OPTIONS.map((p) => (
                <option key={p} value={p}>
                  {t(`templatePriority.${p}`)}
                </option>
              ))}
            </Select>
            <Input
              type="number"
              min={0}
              step={0.5}
              value={draft.estimateHours}
              onChange={(e) => setDraft((prev) => ({ ...prev, estimateHours: e.target.value }))}
              placeholder={t("templates.items.estimatePlaceholder")}
              aria-label={t("templates.items.estimateLabel")}
            />
          </div>
          <Input
            value={draft.checklist}
            onChange={(e) => setDraft((prev) => ({ ...prev, checklist: e.target.value }))}
            placeholder={t("templates.items.checklistPlaceholder")}
            aria-label={t("templates.items.checklistLabel")}
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              data-testid="task-template-item-save"
              disabled={draft.title.trim() === "" || saveMutation.isPending}
              onClick={() => saveMutation.mutate({ itemId: editingId, body: toBody(draft) })}
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              {editingId ? t("templates.items.saveEdit") : t("templates.items.add")}
            </Button>
          </div>
        </div>

        {errorMessage && (
          <p
            data-testid="task-template-items-error"
            className="text-sm text-destructive"
            role="alert"
          >
            {errorMessage}
          </p>
        )}
      </div>
    </Dialog>
  );
}

/** `a; b; c` → `["a","b","c"]`. Rỗng ⇒ `[]` (server nhận mảng rỗng = không có checklist). */
function splitChecklist(raw: string): string[] {
  return raw
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}
