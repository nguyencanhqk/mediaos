import { z } from "zod";
import { stepChecklistSchema, type StepChecklistItemStateDto } from "@mediaos/contracts";
import { apiFetch } from "@mediaos/web-core";

/**
 * Checklist của 1 instance step (G7-4b FE): đọc items + tick state, tick/untick.
 * Tick/untick KHÔNG có body (stepId + itemId ở path) — actor=assignee ép ở BE.
 * Submit gate được FE soi lại bằng `allRequiredChecked` (mirror ChecklistIncompleteError của BE).
 */

/** True ⇔ MỌI item required đã tick (item optional không chặn). Mirror submit gate BE.
 * Rỗng → true (step không có checklist thì nộp được). */
export function allRequiredChecked(items: readonly StepChecklistItemStateDto[]): boolean {
  return items.every((item) => !item.isRequired || item.checked);
}

/** Số item required còn chưa tick — cho hint "còn N mục bắt buộc". */
export function remainingRequired(items: readonly StepChecklistItemStateDto[]): number {
  return items.reduce((n, item) => (item.isRequired && !item.checked ? n + 1 : n), 0);
}

export const workflowChecklistApi = {
  /** GET /workflow/steps/:stepId/checklist — items + trạng thái tick hiện tại. */
  getStepChecklist: (stepId: string) =>
    apiFetch(`/workflow/steps/${stepId}/checklist`, stepChecklistSchema),

  /** POST /workflow/steps/:stepId/checklist-items/:itemId — tick (no body). */
  checkItem: (stepId: string, itemId: string) =>
    apiFetch(`/workflow/steps/${stepId}/checklist-items/${itemId}`, z.unknown(), {
      method: "POST",
    }),

  /** DELETE /workflow/steps/:stepId/checklist-items/:itemId — un-tick. */
  uncheckItem: (stepId: string, itemId: string) =>
    apiFetch(`/workflow/steps/${stepId}/checklist-items/${itemId}`, z.unknown(), {
      method: "DELETE",
    }),
};
