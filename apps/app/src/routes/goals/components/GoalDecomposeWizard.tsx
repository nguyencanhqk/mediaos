import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import {
  ApiError,
  goalApi,
  goalDecomposeInvalidation,
  hrApi,
  hrKeys,
  taskKeys,
  taskStatesApi,
  taskTemplateApi,
  taskTemplateKeys,
  useCan,
} from "@mediaos/web-core";
import type {
  DecomposeGoalItemRequest,
  GoalDetailResponseDto,
  TaskTemplatePriorityDto,
} from "@mediaos/contracts";
import { GOAL_DECOMPOSE_MAX } from "@mediaos/contracts";
import { Button, Dialog, Input, Select } from "@mediaos/ui";
import { TASK_TEMPLATE_PRIORITY_OPTIONS, TASK_UPDATE_STATE_PAIR } from "../constants";

/** Một dòng preview — `key` cục bộ để React theo dõi dòng do người dùng THÊM (chưa có id server). */
interface PreviewRow {
  key: string;
  templateItemId?: string;
  title: string;
  priority: TaskTemplatePriorityDto;
  assigneeEmployeeId: string;
  stateId: string;
  dueAt: string;
  checklist: string[];
}

/**
 * GOAL-SCREEN-004 (S5-GOAL-TPL-1) — wizard phân rã mục tiêu từ template: chọn template → **xem trước**
 * (sửa/xoá/thêm dòng · gán người · chọn cột board · đặt hạn) → áp dụng (GOAL-API-011).
 *
 * ── NEO KHÔNG NẰM Ở CLIENT ────────────────────────────────────────────────────────────────────────
 * Dự án/phòng/nhân viên của việc sinh ra do SERVER suy từ mục tiêu (SPEC-10 §12 GOAL-ERR-008), nên
 * wizard KHÔNG có ô chọn dự án/phòng. Điều đó quyết định UI:
 *   · mục tiêu cấp `project`   → CÓ ô cột board (dự án của mục tiêu), assignee tuỳ chọn;
 *   · mục tiêu cấp `department` → KHÔNG có cột board (không có dự án); assignee NÊN chọn — người có
 *     phạm vi tạo việc hẹp (Own/Team) bị BE đòi assignee (TASK-ERR-FORBIDDEN), nên để trống là 403;
 *   · mục tiêu cấp `employee`  → KHÔNG có cả cột lẫn assignee: việc luôn về chủ thể của mục tiêu
 *     (khai người khác ⇒ 422 GOAL-ERR-008, nên đừng cho khai).
 *
 * TẤT-CẢ-HOẶC-KHÔNG: server ghi N việc trong 1 transaction — lỗi giữa lô ⇒ 0 việc được tạo, nên hộp
 * thoại giữ nguyên danh sách đã sửa để người dùng chỉnh rồi thử lại (đóng hộp thoại = mất công sửa).
 */
export function GoalDecomposeWizard({
  goal,
  onClose,
}: {
  goal: GoalDetailResponseDto;
  onClose: () => void;
}) {
  const { t } = useTranslation("goals");
  const queryClient = useQueryClient();
  const canPickState = useCan(TASK_UPDATE_STATE_PAIR.action, TASK_UPDATE_STATE_PAIR.resourceType);

  const [templateId, setTemplateId] = useState("");
  const [rows, setRows] = useState<PreviewRow[]>([]);
  /** Đã nạp item của template nào rồi — chống nạp lại đè mất phần người dùng vừa sửa. */
  const [loadedFrom, setLoadedFrom] = useState("");

  const showState = goal.level === "project" && Boolean(goal.projectId) && canPickState;
  const showAssignee = goal.level !== "employee";

  const templatesQuery = useQuery({
    queryKey: taskTemplateKeys.list({ isActive: true }),
    queryFn: () => taskTemplateApi.listTemplates({ isActive: true }),
    staleTime: 60_000,
  });

  const detailQuery = useQuery({
    queryKey: taskTemplateKeys.detail(templateId),
    queryFn: () => taskTemplateApi.getTemplate(templateId),
    enabled: templateId !== "",
    staleTime: 60_000,
  });

  // Cột board của ĐÚNG dự án neo mục tiêu (không có dự án ⇒ không query).
  const statesQuery = useQuery({
    queryKey: taskKeys.states(goal.projectId ?? ""),
    queryFn: () => taskStatesApi.listStates(goal.projectId as string),
    enabled: showState,
    staleTime: 300_000,
  });

  // Danh sách người để gán — reference lookup, fail-soft (không có quyền ⇒ không có option, vẫn phân rã
  // được nếu người dùng có phạm vi tạo việc rộng).
  const canReadEmployees = useCan("read", "employee");
  const employeesQuery = useQuery({
    queryKey: hrKeys.employees.list({ pageSize: 100, status: "active" }),
    queryFn: () => hrApi.listEmployees({ pageSize: 100, status: "active" }),
    enabled: showAssignee && canReadEmployees,
    staleTime: 60_000,
  });

  // Nạp item của template vào preview MỘT LẦN cho mỗi lần chọn template.
  useEffect(() => {
    if (!detailQuery.data || loadedFrom === detailQuery.data.id) return;
    setRows(
      detailQuery.data.items.map((item, index) => ({
        key: `tpl-${item.id}-${index}`,
        templateItemId: item.id,
        title: item.title,
        priority: item.defaultPriority ?? "none",
        assigneeEmployeeId: "",
        stateId: "",
        dueAt: "",
        checklist: item.checklist,
      })),
    );
    setLoadedFrom(detailQuery.data.id);
  }, [detailQuery.data, loadedFrom]);

  /** Dòng hợp lệ = có tiêu đề. Nguồn DUY NHẤT cho cả số trên nút lẫn payload gửi lên. */
  const validRows = useMemo(() => rows.filter((row) => row.title.trim().length > 0), [rows]);

  const mutation = useMutation({
    mutationFn: () =>
      goalApi.decompose(goal.id, {
        templateId,
        // CHỈ dòng có tiêu đề (`validRows`) — đúng con số hiện trên nút. Gửi cả dòng trống (người dùng
        // bấm "Thêm việc" rồi chưa điền) là để server 400 vì `title` rỗng: lỗi CỦA UI, đội lốt lỗi
        // nhập liệu, và vì lô là tất-cả-hoặc-không nên MỌI việc còn lại cũng không được tạo.
        items: validRows.map(
          (row): DecomposeGoalItemRequest => ({
            ...(row.templateItemId ? { templateItemId: row.templateItemId } : {}),
            title: row.title.trim(),
            ...(row.priority !== "none" ? { priority: row.priority } : {}),
            ...(showAssignee && row.assigneeEmployeeId
              ? { assigneeEmployeeId: row.assigneeEmployeeId }
              : {}),
            ...(showState && row.stateId ? { stateId: row.stateId } : {}),
            // <input type="date"> cho ngày; server nhận ISO có offset ⇒ ghim cuối ngày UTC.
            ...(row.dueAt ? { dueAt: `${row.dueAt}T23:59:59.000Z` } : {}),
            ...(row.checklist.length > 0 ? { checklist: row.checklist } : {}),
          }),
        ),
      }),
    onSuccess: async () => {
      // Hai phía: tiến độ mục tiêu (mode 'tasks'/'project') VÀ danh sách/board TASK — việc vừa tạo phải
      // hiện ở cả hai chỗ mà không cần F5.
      await Promise.all(
        goalDecomposeInvalidation({ goalId: goal.id, projectId: goal.projectId }).map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      );
      onClose();
    },
  });

  const overLimit = validRows.length > GOAL_DECOMPOSE_MAX;
  const errorMessage =
    mutation.error instanceof ApiError && mutation.error.message
      ? mutation.error.message
      : mutation.isError
        ? t("decompose.error")
        : null;

  function patchRow(key: string, patch: Partial<PreviewRow>) {
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function addRow() {
    setRows((prev) => [
      ...prev,
      {
        key: `new-${prev.length}-${prev.length ? prev[prev.length - 1]!.key : "first"}`,
        title: "",
        priority: "none",
        assigneeEmployeeId: "",
        stateId: "",
        dueAt: "",
        checklist: [],
      },
    ]);
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t("decompose.title")}
      description={t("decompose.description")}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            {t("actions.cancel", { ns: "common" })}
          </Button>
          <Button
            size="sm"
            data-testid="goal-decompose-submit"
            disabled={
              templateId === "" || validRows.length === 0 || overLimit || mutation.isPending
            }
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending
              ? t("decompose.submitting")
              : t("decompose.submit", { count: validRows.length })}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <label
            htmlFor="goal-decompose-template"
            className="text-xs font-medium text-muted-foreground"
          >
            {t("decompose.templateLabel")}
          </label>
          <Select
            id="goal-decompose-template"
            data-testid="goal-decompose-template"
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
          >
            <option value="">{t("decompose.templatePlaceholder")}</option>
            {(templatesQuery.data ?? []).map((tpl) => (
              <option key={tpl.id} value={tpl.id}>
                {tpl.name} ({t("decompose.itemCount", { count: tpl.itemCount })})
              </option>
            ))}
          </Select>
          {templatesQuery.isError && (
            <p className="text-xs text-destructive" role="alert">
              {t("decompose.templatesError")}
            </p>
          )}
          {!templatesQuery.isLoading && (templatesQuery.data ?? []).length === 0 && (
            <p className="text-xs text-muted-foreground">{t("decompose.noTemplates")}</p>
          )}
        </div>

        {templateId !== "" && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">
                {t("decompose.previewLabel")}
              </p>
              <Button variant="outline" size="sm" data-testid="goal-decompose-add" onClick={addRow}>
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                {t("decompose.addRow")}
              </Button>
            </div>

            {detailQuery.isLoading ? (
              <div className="h-24 animate-pulse rounded bg-muted" />
            ) : detailQuery.isError ? (
              <p className="text-sm text-destructive" role="alert">
                {t("decompose.detailError")}
              </p>
            ) : rows.length === 0 ? (
              <p className="py-3 text-center text-sm text-muted-foreground">
                {t("decompose.emptyTemplate")}
              </p>
            ) : (
              <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                {rows.map((row, index) => (
                  <div
                    key={row.key}
                    data-testid="goal-decompose-row"
                    className="space-y-2 rounded-md border border-border p-2"
                  >
                    <div className="flex items-center gap-2">
                      <Input
                        aria-label={t("decompose.fields.title", { index: index + 1 })}
                        value={row.title}
                        onChange={(e) => patchRow(row.key, { title: e.target.value })}
                        placeholder={t("decompose.fields.titlePlaceholder")}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={t("decompose.removeRow")}
                        data-testid={`goal-decompose-remove-${index}`}
                        onClick={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-3">
                      <Select
                        aria-label={t("decompose.fields.priority")}
                        value={row.priority}
                        onChange={(e) =>
                          patchRow(row.key, {
                            priority: e.target.value as TaskTemplatePriorityDto,
                          })
                        }
                      >
                        {TASK_TEMPLATE_PRIORITY_OPTIONS.map((p) => (
                          <option key={p} value={p}>
                            {t(`templatePriority.${p}`)}
                          </option>
                        ))}
                      </Select>
                      {showAssignee && (
                        <Select
                          aria-label={t("decompose.fields.assignee")}
                          value={row.assigneeEmployeeId}
                          onChange={(e) =>
                            patchRow(row.key, { assigneeEmployeeId: e.target.value })
                          }
                        >
                          <option value="">{t("decompose.fields.assigneePlaceholder")}</option>
                          {(employeesQuery.data?.items ?? []).map((emp) => (
                            <option key={emp.id} value={emp.id}>
                              {emp.fullName}
                            </option>
                          ))}
                        </Select>
                      )}
                      {showState && (
                        <Select
                          aria-label={t("decompose.fields.state")}
                          value={row.stateId}
                          onChange={(e) => patchRow(row.key, { stateId: e.target.value })}
                        >
                          <option value="">{t("decompose.fields.statePlaceholder")}</option>
                          {(statesQuery.data ?? []).map((state) => (
                            <option key={state.id} value={state.id}>
                              {state.name}
                            </option>
                          ))}
                        </Select>
                      )}
                      <Input
                        type="date"
                        aria-label={t("decompose.fields.dueAt")}
                        value={row.dueAt}
                        onChange={(e) => patchRow(row.key, { dueAt: e.target.value })}
                      />
                    </div>
                    {row.checklist.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {t("decompose.checklistPreview", {
                          count: row.checklist.length,
                          items: row.checklist.join(" · "),
                        })}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}

            {goal.level === "employee" && (
              <p className="text-xs text-muted-foreground">{t("decompose.employeeNote")}</p>
            )}
            {goal.level === "department" && (
              <p className="text-xs text-muted-foreground">{t("decompose.departmentNote")}</p>
            )}
            {overLimit && (
              <p className="text-sm text-destructive" role="alert">
                {t("decompose.overLimit", { max: GOAL_DECOMPOSE_MAX })}
              </p>
            )}
          </div>
        )}

        {errorMessage && (
          <p data-testid="goal-decompose-error" className="text-sm text-destructive" role="alert">
            {errorMessage}
          </p>
        )}
      </div>
    </Dialog>
  );
}
