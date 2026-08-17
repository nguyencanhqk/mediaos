/**
 * ChangeStatusDialog — S10-HR-STATUSUI-1 (HR-FUNC-006, SPEC-03 §14.6).
 *
 * BE đã ship endpoint từ S2-HR-BE-2; đây là lần đầu FE nối. Trước WO này người dùng chỉ có đường sửa
 * "Ngày kết thúc" ở form Sửa — sửa ngày KHÔNG lật `status` (đúng thiết kế, `employee-write.ts:80-82`),
 * nên hồ sơ đã nghỉ vẫn hiển thị "Đang làm việc". Nút này là đường đi hợp lệ duy nhất.
 *
 * Luật đã ép ở SERVER, FE chỉ phản ánh (không phải nguồn sự thật):
 *   - FSM `HR_EMPLOYEE_STATUS_TRANSITIONS` (@mediaos/contracts — DÙNG CHUNG với HrWriteService, không
 *     nhân bản literal): transition sai ⇒ 422.
 *   - `endDate` bắt buộc HAI CHIỀU: exit-status phải có, non-exit CẤM gửi ⇒ 400.
 *   - Tự khoá tài khoản của CHÍNH mình bị chặn ở BE (`hr-write.service.ts:510`).
 *
 * Fail-closed: `status` từ read DTO khai `z.string()` (employee-read.ts:136), KHÔNG phải enum — chuỗi
 * ngoài 4 giá trị ⇒ 0 lựa chọn ⇒ nút disabled, KHÔNG `.map()` trên undefined.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  HR_EMPLOYEE_STATUS_TRANSITIONS,
  isHrEmployeeExitStatus,
  type HrEmployeeStatus,
} from "@mediaos/contracts";
import { hrApi, hrKeys, useAuthStore } from "@mediaos/web-core";
import { Button, Checkbox, Dialog, Input, Select } from "@mediaos/ui";

const REASON_MAX_LENGTH = 500;

/** Tập chuyển hợp lệ từ trạng thái hiện tại. Chuỗi lạ (DTO là z.string()) ⇒ rỗng, không nổ. */
export function allowedTransitions(currentStatus: string): readonly HrEmployeeStatus[] {
  return HR_EMPLOYEE_STATUS_TRANSITIONS[currentStatus as HrEmployeeStatus] ?? [];
}

interface ChangeStatusDialogProps {
  employeeId: string;
  currentStatus: string;
  /** `end_date` hiện có — hiện ra để HR không bấm mù (sang terminated sẽ GHI ĐÈ giá trị này). */
  currentEndDate: string | null;
  /** User đang liên kết hồ sơ này (null = chưa liên kết) — dùng để chặn tự khoá ở FE. */
  employeeUserId: string | null;
  onClose: () => void;
}

export function ChangeStatusDialog({
  employeeId,
  currentStatus,
  currentEndDate,
  employeeUserId,
  onClose,
}: ChangeStatusDialogProps) {
  const { t } = useTranslation("hr");
  const queryClient = useQueryClient();
  const currentUserId = useAuthStore((s) => s.user?.id ?? null);

  const options = useMemo(() => allowedTransitions(currentStatus), [currentStatus]);
  const [newStatus, setNewStatus] = useState<HrEmployeeStatus | "">("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [lockUser, setLockUser] = useState(false);

  const isExit = newStatus !== "" && isHrEmployeeExitStatus(newStatus);
  // Hồ sơ của CHÍNH người đang bấm: BE từ chối khoá (chống tự khoá / last-admin DoS) ⇒ FE không được
  // hứa cái server sẽ bỏ qua.
  const isSelfProfile = employeeUserId !== null && employeeUserId === currentUserId;
  const willOverwriteEndDate = isExit && currentEndDate !== null;

  const mutation = useMutation({
    mutationFn: () =>
      hrApi.changeEmployeeStatus(employeeId, {
        newStatus: newStatus as HrEmployeeStatus,
        // Gửi endDate ĐÚNG khi và chỉ khi sang exit-status — server 400 cả hai chiều.
        ...(isExit ? { endDate } : {}),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
        lockUser: isExit && !isSelfProfile ? lockUser : false,
      }),
    onSuccess: async () => {
      // Badge trạng thái sống ở CẢ list lẫn detail ⇒ invalidate gốc `employees` cho cả hai.
      await queryClient.invalidateQueries({ queryKey: hrKeys.employees.all });
      onClose();
    },
  });

  const busy = mutation.isPending;
  const noop = () => {};
  const canSubmit = newStatus !== "" && (!isExit || endDate !== "") && !busy;

  return (
    <Dialog
      open
      onClose={busy ? noop : onClose}
      title={t("employees.changeStatus.title")}
      description={t("employees.changeStatus.description")}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {t("employees.changeStatus.cancel")}
          </Button>
          <Button
            type="button"
            onClick={() => mutation.mutate()}
            disabled={!canSubmit}
            data-testid="change-status-submit"
          >
            {busy ? t("employees.changeStatus.submitting") : t("employees.changeStatus.submit")}
          </Button>
        </>
      }
    >
      {/* Lỗi BE KHÔNG được nuốt: ChatSyncRevokeError (thu hồi phòng chat thất bại) rollback toàn bộ —
          trạng thái lúc đó CHƯA đổi, hiện "thành công" là nói dối người dùng. */}
      {mutation.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t("employees.changeStatus.error")}
        </p>
      )}

      <label className="block space-y-1">
        <span className="text-sm font-medium text-foreground">
          {t("employees.changeStatus.newStatusLabel")}
        </span>
        <Select
          value={newStatus}
          onChange={(e) => {
            const next = e.target.value as HrEmployeeStatus | "";
            setNewStatus(next);
            // Đổi lựa chọn ⇒ dọn field chỉ có nghĩa với exit-status (tránh gửi thừa ⇒ 400).
            if (next === "" || !isHrEmployeeExitStatus(next)) {
              setEndDate("");
              setLockUser(false);
            }
          }}
          disabled={busy}
          aria-label={t("employees.changeStatus.newStatusLabel")}
          data-testid="change-status-select"
        >
          <option value="">{t("employees.changeStatus.newStatusPlaceholder")}</option>
          {options.map((s) => (
            <option key={s} value={s}>
              {t(`status.${s}`, { defaultValue: s })}
            </option>
          ))}
        </Select>
      </label>

      {isExit && (
        <label className="block space-y-1">
          <span className="text-sm font-medium text-foreground">
            {t("employees.changeStatus.endDateLabel")}
          </span>
          <Input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            disabled={busy}
            required
            aria-label={t("employees.changeStatus.endDateLabel")}
            data-testid="change-status-end-date"
          />
          {willOverwriteEndDate && (
            <span className="block text-xs text-muted-foreground">
              {t("employees.changeStatus.endDateOverwrite", { date: currentEndDate })}
            </span>
          )}
        </label>
      )}

      <label className="block space-y-1">
        <span className="text-sm font-medium text-foreground">
          {t("employees.changeStatus.reasonLabel")}
        </span>
        <Input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={REASON_MAX_LENGTH}
          disabled={busy}
          placeholder={t("employees.changeStatus.reasonPlaceholder")}
          aria-label={t("employees.changeStatus.reasonLabel")}
        />
      </label>

      {/* Khoá tài khoản CHỈ có tác dụng ở resigned/terminated (BE LOCKING_STATUSES) — hiện ở chỗ khác
          là UI hứa suông. Ẩn luôn khi đây là hồ sơ của chính người bấm (BE chặn tự khoá). */}
      {isExit && !isSelfProfile && (
        <label className="flex items-center gap-2 text-sm text-foreground">
          <Checkbox
            checked={lockUser}
            onChange={(e) => setLockUser(e.target.checked)}
            disabled={busy}
            data-testid="change-status-lock-user"
          />
          {t("employees.changeStatus.lockUser")}
        </label>
      )}

      {/* resigned/terminated là MỘT CHIỀU; terminated là trạng thái CUỐI — qua API không có đường lùi. */}
      {isExit && (
        <p className="text-sm text-amber-600 dark:text-amber-500">
          {t("employees.changeStatus.oneWayWarning")}
        </p>
      )}
    </Dialog>
  );
}
