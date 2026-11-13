import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  companyTimeZone,
  taskCoreApi,
  taskKeys,
  taskCoreInvalidation,
  parseKindError,
  useCan,
} from "@mediaos/web-core";
import type { CreateTaskCoreRequest, TaskCoreResponseDto } from "@mediaos/contracts";
import { cn } from "@mediaos/ui";
import { useGoalOfferAfterCreate } from "@/routes/goals/use-goal-suggestions-offer";
import { TASK_CORE_ENGINE_PAIRS } from "./constants";
import { DeadlineQuickPicker } from "./DeadlineQuickPicker";
import { resolveDeadlinePresets, type DeadlinePreset } from "./deadline-presets";
import { EmployeePicker, type PickedEmployee, type PreferredEmployee } from "./EmployeePicker";
import { TASK_TITLE_MAX_LENGTH } from "./task-form-schema";
import { classifyTaskCreateError } from "./task-quick-add-errors";
import { useKeyFocus } from "./use-slash-focus";

/**
 * TaskQuickAdd — S20-TASK-QUICKADD-1 (US-TASK-NV-05 · US-TASK-QL-06). Ô tạo việc MỘT DÒNG dùng chung:
 * đầu «Việc của tôi» (người phụ trách cố định = tôi) và đáy cột board (`KanbanQuickCreate` bọc thêm nút
 * «+» và cổng đôi create + update-state). Cũng là nền của tạo nhanh toàn cục (S20-X-QUICKCREATE-1).
 *
 * - Enter tạo qua `POST /tasks` sẵn có; ô xoá NGAY và giữ focus để gõ việc kế. Server là cổng thật: tự
 *   kiểm phạm vi người phụ trách (task-core.service) — FE không nới gì.
 * - Chip «Người» (chỉ khi phía gọi bật và có `assign:task`) + chip «Hạn» (chỉ khi có
 *   `update-deadline:task`, popover mốc nhanh dùng chung) GIỮ giá trị qua các lần Enter; Esc xoá chip.
 * - Tiêu đề rỗng / quá dài ⇒ không gửi, lỗi tại ô. Server từ chối ⇒ dòng lỗi + tiêu đề trả lại vào ô
 *   (nếu người dùng chưa gõ việc kế).
 * - `disabled` (vd chưa liên kết hồ sơ nhân viên) ⇒ ô khoá kèm giải thích, KHÔNG gửi request nào.
 */
export interface TaskQuickAddProps {
  /** Tiền tố data-testid: `${id}-input` · `${id}-assignee` · `${id}-due` · `${id}-message`. */
  id: string;
  /** Ghi đè data-testid của ô nhập (giữ testid cũ của board). */
  inputTestId?: string;
  projectId?: string;
  stateId?: string;
  /** Người phụ trách cố định («Việc của tôi» = chính tôi) — có thì không hiện chip Người. */
  fixedAssigneeEmployeeId?: string;
  /** Bật chip «Người» (board); vẫn cần `assign:task`. */
  withAssigneeChip?: boolean;
  /** Ứng viên đứng đầu picker của chip Người (thành viên dự án). */
  preferredAssignees?: readonly PreferredEmployee[];
  placeholder: string;
  hint: string;
  autoFocus?: boolean;
  /** Phím tắt focus ô khi không gõ ở đâu (vd «n»). */
  shortcutKey?: string;
  /** Có ⇒ Esc / rời ô khi trống thì phía gọi thu ô lại (board). */
  onClose?: () => void;
  disabled?: boolean;
  disabledReason?: string;
  /** S20-X-QUICKCREATE-1 — gọi ngay khi server ghi xong (trước khi làm mới danh sách): toast «Mở», đóng hộp. */
  onCreated?: (task: TaskCoreResponseDto) => void;
  /** Có ⇒ nút «Thêm chi tiết» chuyển tiêu đề đang gõ sang form đầy đủ (phía gọi mở form). */
  onExpand?: (draft: { title: string }) => void;
  /** Nhãn nút «Thêm chi tiết» (bắt buộc khi có `onExpand`). */
  expandLabel?: string;
  /** Mặc định true: rời ô khi trống thì gọi `onClose`. Hộp thoại (tự lo Esc/bấm ngoài/focus) đặt false. */
  closeOnBlur?: boolean;
  /** Server từ chối: phía gọi báo lỗi nổi (hộp có thể đã đóng nên dòng lỗi tại ô không còn ai thấy). */
  onCreateError?: (message: string, title: string) => void;
  /** Tắt chip Hạn (tạo nhanh toàn cục chỉ hỏi Tiêu đề). Mặc định bật. */
  withDeadlineChip?: boolean;
  /** Thay thông điệp «thiếu tiêu đề» mặc định. */
  titleRequiredMessage?: string;
  /** Lỗi 400/422 nghiệp vụ: hiện thông điệp của server (không bao giờ với 5xx/mạng). Mặc định tắt. */
  showServerReason?: boolean;
  /** Chuỗi dự phòng cho 400/422 khi server không kèm lý do (hộp gọn không có hạn/cột). */
  badRequestMessage?: string;
}

/** Bỏ tiền tố mã slug `TASK-ERR-…: ` — chỉ giữ phần người đọc được; rỗng ⇒ null. */
function readBusinessReason(error: unknown): string | null {
  const { message } = parseKindError(error);
  const text = message.replace(/^[A-Z][A-Z0-9-]*:\s*/, "").trim();
  return text === "" || /^[A-Z][A-Z0-9-]+$/.test(text) ? null : text;
}

interface StickyAssignee {
  readonly employeeId: string;
  readonly fullName: string | null;
  readonly avatarUrl: string | null;
}

/** Thân `POST /tasks`: chỉ khoá CÓ giá trị — `createTaskCoreSchema` là `.strict()`. */
function buildCreateBody(
  title: string,
  ctx: {
    projectId?: string;
    stateId?: string;
    assigneeEmployeeId?: string;
    dueAt: string | null;
  },
): CreateTaskCoreRequest {
  return {
    title,
    ...(ctx.projectId ? { projectId: ctx.projectId } : {}),
    ...(ctx.stateId ? { stateId: ctx.stateId } : {}),
    ...(ctx.assigneeEmployeeId ? { assigneeEmployeeId: ctx.assigneeEmployeeId } : {}),
    ...(ctx.dueAt ? { dueAt: ctx.dueAt } : {}),
  };
}

/**
 * Mốc gần nhất (thường «Hôm nay 17:00», sau giờ đó là «Hôm nay 23:59») bấm thẳng một chạm — luồng «tiêu
 * đề → Hôm nay → Enter» (US-TASK-NV-05: 3 thao tác). Các mốc khác qua popover. Bấm lại ⇒ bỏ hạn.
 */
function NearestDeadlineChip({
  testId,
  nearest,
  value,
  onSelect,
}: {
  testId: string;
  nearest: DeadlinePreset;
  value: string | null;
  onSelect: (dueAt: string | null) => void;
}) {
  const { t } = useTranslation("tasks");
  const active = value === nearest.dueAt;
  return (
    <button
      type="button"
      aria-pressed={active}
      data-testid={testId}
      onClick={() => onSelect(active ? null : nearest.dueAt)}
      className={cn(
        "inline-flex h-6 items-center rounded-full border px-2 text-xs transition-colors",
        active
          ? "border-primary bg-primary/10 text-foreground"
          : "border-border text-muted-foreground hover:text-foreground",
      )}
    >
      {t(`deadlinePicker.presets.${nearest.labelKey}`, { time: nearest.time })}
    </button>
  );
}

export function TaskQuickAdd({
  id,
  inputTestId,
  projectId,
  stateId,
  fixedAssigneeEmployeeId,
  withAssigneeChip = false,
  preferredAssignees,
  placeholder,
  hint,
  autoFocus = false,
  shortcutKey,
  onClose,
  disabled = false,
  disabledReason,
  onCreated,
  onExpand,
  expandLabel,
  withDeadlineChip = true,
  titleRequiredMessage,
  closeOnBlur = true,
  onCreateError,
  showServerReason = false,
  badRequestMessage,
}: TaskQuickAddProps) {
  const { t } = useTranslation("tasks");
  const queryClient = useQueryClient();
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Đang bấm chuột/chạm BÊN TRONG ô (chip, hoặc panel nổi của chip — portal nhưng vẫn là con trong cây
  // React nên sự kiện nổi tới đây) ⇒ lần rời ô kèm theo KHÔNG phải «bấm ra ngoài». Safari không focus
  // nút khi bấm (relatedTarget = null) nên không thể chỉ dựa vào relatedTarget.
  const pointerInsideRef = useRef(false);
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState<StickyAssignee | null>(null);
  const [dueAt, setDueAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const { ASSIGN, UPDATE_DEADLINE } = TASK_CORE_ENGINE_PAIRS;
  const canAssign = useCan(ASSIGN.action, ASSIGN.resourceType);
  const canSetDeadline =
    useCan(UPDATE_DEADLINE.action, UPDATE_DEADLINE.resourceType) && withDeadlineChip;
  const showAssigneeChip = withAssigneeChip && canAssign && !fixedAssigneeEmployeeId;
  useKeyFocus(shortcutKey ?? null, inputRef);
  // `autoFocus` của DOM chỉ có tác dụng lúc gắn ô; ô gắn khi còn khoá (vd «Việc của tôi» đang hỏi /auth/me)
  // thì focus khi ô vừa mở khoá — S20-DASH-QUICKACTION-1 (`?create=1`).
  useEffect(() => {
    if (autoFocus && !disabled) inputRef.current?.focus();
  }, [autoFocus, disabled]);

  const offerGoal = useGoalOfferAfterCreate();
  const createMutation = useMutation({
    mutationFn: (body: CreateTaskCoreRequest) => taskCoreApi.createTask(body),
    onSuccess: async (task) => {
      onCreated?.(task);
      // S20-GOAL-SUGGEST-1 — đúng 1 ứng viên ⇒ toast «Tính vào ‹G›?» (không tự gắn).
      offerGoal(task);
      // Board KHÔNG nằm dưới taskCoreInvalidation.list() ⇒ khoá kanban của đúng dự án phải TƯỜNG MINH.
      const keys = [
        ...taskCoreInvalidation.list(),
        ...taskCoreInvalidation.my(),
        ...(projectId ? [taskKeys.kanban(projectId)] : []),
      ];
      await Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
    },
    onError: (err, body) => {
      const kind = classifyTaskCreateError(err);
      const message =
        kind === "badRequest" && showServerReason
          ? (readBusinessReason(err) ?? badRequestMessage ?? t("quickAdd.errors.badRequest"))
          : t(`quickAdd.errors.${kind}`);
      setError(message);
      onCreateError?.(message, body.title);
      setTitle((current) => (current === "" ? body.title : current));
    },
  });

  const reset = () => {
    setTitle("");
    setAssignee(null);
    setDueAt(null);
    setError(null);
  };

  const submit = () => {
    if (disabled) return;
    const value = title.trim();
    if (!value) return setError(titleRequiredMessage ?? t("quickAdd.errors.titleRequired"));
    if (value.length > TASK_TITLE_MAX_LENGTH) {
      return setError(t("quickAdd.errors.titleTooLong", { max: TASK_TITLE_MAX_LENGTH }));
    }
    setError(null);
    // Xoá ô NGAY (không đợi server) để gõ tiếp; lỗi ⇒ tiêu đề quay lại ô (onError).
    setTitle("");
    createMutation.mutate(
      buildCreateBody(value, {
        projectId,
        stateId,
        assigneeEmployeeId:
          fixedAssigneeEmployeeId ?? (showAssigneeChip ? assignee?.employeeId : undefined),
        dueAt: canSetDeadline ? dueAt : null,
      }),
    );
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      // Đang gõ dấu bằng bộ gõ (IME) ⇒ Enter là chốt chữ, không phải tạo việc.
      if (e.nativeEvent.isComposing) return;
      e.preventDefault();
      submit();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      // Ô nằm trong board/drawer — Esc không được lọt lên đóng panel/modal bên ngoài.
      e.stopPropagation();
      reset();
      onClose?.();
    }
  };

  // Rời ô khi KHÔNG còn gì (tiêu đề trống, không chip) ⇒ phía gọi thu ô lại. Sang chip của chính ô
  // này hay picker đang mở thì giữ nguyên.
  const onBlur = (e: FocusEvent<HTMLInputElement>) => {
    const pointerInside = pointerInsideRef.current;
    pointerInsideRef.current = false;
    if (!onClose || !closeOnBlur || pickerOpen || pointerInside) return;
    const next = e.relatedTarget;
    if (next instanceof Node && containerRef.current?.contains(next)) return;
    if (!title.trim() && !assignee && !dueAt) {
      reset();
      onClose();
    }
  };

  const pickAssignee = (employeeId: string | null, picked?: PickedEmployee) => {
    setAssignee(
      employeeId
        ? {
            employeeId,
            fullName: picked?.fullName ?? null,
            avatarUrl: picked?.avatarUrl ?? null,
          }
        : null,
    );
    inputRef.current?.focus();
  };

  const pickDeadline = (next: string | null) => {
    setDueAt(next);
    inputRef.current?.focus();
  };

  const messageId = `${id}-message`;
  const showExpand = !disabled && onExpand !== undefined;
  const showChips = !disabled && (showAssigneeChip || canSetDeadline || showExpand);
  // Hạn đang chọn hiện ĐÚNG MỘT lần trên hàng chip (và hàng vừa cột board ~270 px): hạn trống hoặc trùng
  // mốc một chạm ⇒ chip lịch chỉ là biểu tượng; hạn khác ⇒ chip lịch in ngày giờ, chip một chạm ẩn.
  const nearest = canSetDeadline
    ? (resolveDeadlinePresets(new Date(), companyTimeZone())[0] ?? null)
    : null;
  const hasOtherDeadline = dueAt !== null && dueAt !== nearest?.dueAt;

  return (
    <div
      ref={containerRef}
      className="space-y-1"
      data-testid={id}
      onPointerDownCapture={(e) => {
        // Bấm vào chính ô nhập không phải «sang chip» — nếu không, cờ đọng lại và lần bấm ra ngoài sau đó
        // không thu ô.
        if (e.target !== inputRef.current) pointerInsideRef.current = true;
      }}
    >
      <input
        ref={inputRef}
        autoFocus={autoFocus}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        onFocus={() => {
          pointerInsideRef.current = false;
        }}
        maxLength={TASK_TITLE_MAX_LENGTH}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={placeholder}
        aria-invalid={error ? true : undefined}
        aria-describedby={messageId}
        data-testid={inputTestId ?? `${id}-input`}
        className="w-full rounded-md border border-border bg-card px-2.5 py-2 text-sm shadow-sm outline-none placeholder:text-muted-foreground focus:border-primary disabled:cursor-not-allowed disabled:opacity-60"
      />
      {showChips && (
        <div className="flex flex-wrap items-center gap-1.5">
          {showAssigneeChip && (
            <EmployeePicker
              employeeId={assignee?.employeeId ?? null}
              name={assignee?.fullName ?? null}
              avatarUrl={assignee?.avatarUrl ?? null}
              onSelect={pickAssignee}
              canEdit
              allowClear
              showName
              testId={`${id}-assignee`}
              emptyLabel={t("quickAdd.assigneeChip")}
              open={pickerOpen}
              onOpenChange={setPickerOpen}
              preferred={preferredAssignees}
            />
          )}
          {nearest && !hasOtherDeadline && (
            <NearestDeadlineChip
              testId={`${id}-due-nearest`}
              nearest={nearest}
              value={dueAt}
              onSelect={pickDeadline}
            />
          )}
          {showExpand && (
            <button
              type="button"
              data-testid={`${id}-expand`}
              disabled={createMutation.isPending}
              onClick={() => onExpand?.({ title })}
              className="ml-auto inline-flex h-6 items-center rounded-full border border-border px-2 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
            >
              {expandLabel}
            </button>
          )}
          {canSetDeadline && (
            <DeadlineQuickPicker
              id={`${id}-due`}
              variant={hasOtherDeadline ? "compact" : "icon"}
              value={dueAt}
              onSelect={pickDeadline}
              ariaLabel={t("quickAdd.deadlineChip")}
            />
          )}
        </div>
      )}
      <p
        id={messageId}
        role={error ? "alert" : undefined}
        data-testid={messageId}
        className={cn("px-1 text-xs", error ? "text-destructive" : "text-muted-foreground")}
      >
        {error ?? (disabled ? (disabledReason ?? hint) : hint)}
      </p>
    </div>
  );
}
