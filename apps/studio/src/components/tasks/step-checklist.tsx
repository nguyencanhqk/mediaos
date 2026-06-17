import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { StepChecklistItemStateDto } from "@mediaos/contracts";
import { remainingRequired, workflowChecklistApi } from "@/lib/workflow-checklist-api";

/** Query key dùng chung để form submit và component checklist share cache (react-query dedupe). */
export function stepChecklistQueryKey(stepId: string): readonly [string, string, string, string] {
  return ["workflow", "step", stepId, "checklist"];
}

interface StepChecklistProps {
  stepId: string;
  /** Assignee tick được khi step đang in_progress; ngược lại read-only (chỉ xem trạng thái). */
  editable: boolean;
}

/**
 * Checklist của 1 instance step (G7-4b FE). Render items (required đánh dấu rõ), tick/untick gọi API
 * thật, có loading/error. Rỗng → không render gì (step không có checklist). a11y: mỗi checkbox có
 * <label> liên kết + aria-required; tiến độ required đọc được qua vùng aria-live.
 */
export function StepChecklist({ stepId, editable }: StepChecklistProps) {
  const { t } = useTranslation("tasks");
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: stepChecklistQueryKey(stepId),
    queryFn: () => workflowChecklistApi.getStepChecklist(stepId),
  });

  const toggle = useMutation({
    mutationFn: ({ itemId, checked }: { itemId: string; checked: boolean }) =>
      checked
        ? workflowChecklistApi.checkItem(stepId, itemId)
        : workflowChecklistApi.uncheckItem(stepId, itemId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: stepChecklistQueryKey(stepId) }),
  });

  if (isLoading) {
    return <p className="text-xs text-muted-foreground">{t("checklist.loading")}</p>;
  }
  if (isError) {
    return <p className="text-xs text-destructive">{t("checklist.error")}</p>;
  }

  const items = data?.items ?? [];
  if (items.length === 0) return null; // step không có checklist → không có gì để render

  const remaining = remainingRequired(items);

  return (
    <section
      className="space-y-2 rounded-lg border border-border p-4"
      aria-label={t("checklist.heading")}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{t("checklist.heading")}</h3>
        <span
          role="status"
          aria-live="polite"
          className={`text-xs ${remaining === 0 ? "text-green-700" : "text-muted-foreground"}`}
        >
          {remaining === 0 ? t("checklist.allDone") : t("checklist.remaining", { n: remaining })}
        </span>
      </div>
      <ul className="space-y-1.5">
        {items.map((item) => (
          <ChecklistRow
            key={item.id}
            item={item}
            editable={editable}
            pending={toggle.isPending}
            onToggle={(checked) => toggle.mutate({ itemId: item.id, checked })}
            t={t}
          />
        ))}
      </ul>
      {toggle.isError && (
        <p className="text-xs text-destructive">
          {toggle.error instanceof Error ? toggle.error.message : t("checklist.error")}
        </p>
      )}
    </section>
  );
}

interface ChecklistRowProps {
  item: StepChecklistItemStateDto;
  editable: boolean;
  pending: boolean;
  onToggle: (checked: boolean) => void;
  t: TFunction<"tasks">;
}

function ChecklistRow({ item, editable, pending, onToggle, t }: ChecklistRowProps) {
  const inputId = `checklist-item-${item.id}`;
  return (
    <li className="flex items-start gap-2">
      <input
        id={inputId}
        type="checkbox"
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-border accent-primary"
        checked={item.checked}
        disabled={!editable || pending}
        aria-required={item.isRequired}
        onChange={(e) => onToggle(e.target.checked)}
      />
      <label htmlFor={inputId} className="text-sm leading-snug">
        {item.label}
        {item.isRequired && (
          <span className="ml-1.5 rounded bg-red-100 px-1 py-0.5 text-[10px] font-medium text-red-700">
            {t("checklist.required")}
          </span>
        )}
      </label>
    </li>
  );
}
