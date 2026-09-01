import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { payrollApi, payrollIdempotencyKey, payrollKeys, useCan } from "@mediaos/web-core";
import { Button, Dialog, Input, Select } from "@mediaos/ui";
import { PAYROLL_ENGINE_PAIRS } from "../constants";
import { parsePayrollError, payrollErrorI18nKey } from "../payroll-errors";

const PERIOD_MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * PAY-SCREEN-001 — tạo kỳ lương (PAYROLL-API-002, `manage:payroll-period`).
 *
 * ⚠️ **Kỳ công lấy qua picker 035, KHÔNG qua `GET /attendance/periods`.** Route đó gác bằng
 * `('read','attendance')` mà `payroll-officer` giữ **0 cặp ngoài PAYROLL** (SPEC-11 §9g) — dùng nó là
 * màn tạo kỳ chết với đúng vai sinh ra để dùng nó. Picker gác bằng chính cặp `manage:payroll-period`
 * của form này nên hai vế luôn mở/đóng cùng nhau.
 *
 * ⚠️ Picker lọc `status: "locked"` — chữ **THƯỜNG** (mirror `att_periods_status_check`, KHÔNG TitleCase
 * như FSM kỳ lương). Chỉ kỳ công đã khoá mới tính lương được (`PAYROLL-ERR-002`), nên đưa kỳ `open` vào
 * danh sách chọn chỉ là mời người dùng ăn 409 ở bước sau.
 *
 * ⚠️ `Idempotency-Key` SUY TỪ NỘI DUNG (`payrollIdempotencyKey`): bấm đúp «Tạo» phải ra MỘT kỳ. Khoá
 * ngẫu nhiên mỗi render thì lần bấm thứ hai là một request mới hoàn toàn và ăn `PAYROLL-ERR-008` —
 * hoặc tệ hơn, tạo được kỳ thứ hai nếu tháng khác.
 */
export function PeriodFormDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { t } = useTranslation("payroll");
  const queryClient = useQueryClient();

  const canPickAttendance = useCan(
    PAYROLL_ENGINE_PAIRS.pickerAttendancePeriods.action,
    PAYROLL_ENGINE_PAIRS.pickerAttendancePeriods.resourceType,
  );

  const [periodMonth, setPeriodMonth] = useState("");
  const [attendancePeriodId, setAttendancePeriodId] = useState("");
  const [note, setNote] = useState("");
  const [errorKey, setErrorKey] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setPeriodMonth("");
      setAttendancePeriodId("");
      setNote("");
      setErrorKey(null);
    }
  }, [open]);

  const attendanceQuery = useQuery({
    queryKey: payrollKeys.pickers.attendancePeriods({ status: "locked" }),
    queryFn: () => payrollApi.pickerAttendancePeriods({ status: "locked" }),
    enabled: open && canPickAttendance,
  });

  const monthValid = PERIOD_MONTH_RE.test(periodMonth);

  const createMutation = useMutation({
    mutationFn: () =>
      payrollApi.createPeriod(
        {
          periodMonth,
          ...(attendancePeriodId ? { attendancePeriodId } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        },
        // Khoá neo theo THÁNG + kỳ công đã chọn: cùng nội dung ⇒ cùng khoá ⇒ bấm đúp là một kỳ.
        payrollIdempotencyKey("create-period", periodMonth, attendancePeriodId || null),
      ),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: payrollKeys.periods.allOf() });
      onCreated(created.id);
    },
    onError: (error) => setErrorKey(payrollErrorI18nKey(parsePayrollError(error))),
  });

  const attendanceOptions = useMemo(() => attendanceQuery.data ?? [], [attendanceQuery.data]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("periodForm.title")}
      description={t("periodForm.description")}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={createMutation.isPending}>
            {t("actions.cancel")}
          </Button>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={!monthValid || createMutation.isPending}
          >
            {t("periodForm.submit")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t("periodForm.monthLabel")}</span>
          <Input
            value={periodMonth}
            onChange={(e) => setPeriodMonth(e.target.value)}
            placeholder="2026-09"
          />
          {periodMonth !== "" && !monthValid && (
            <span className="mt-1 block text-xs text-danger">{t("periodForm.monthInvalid")}</span>
          )}
        </label>

        {canPickAttendance && (
          <label className="block text-sm">
            <span className="mb-1 block font-medium">{t("periodForm.attendanceLabel")}</span>
            <Select
              value={attendancePeriodId}
              onChange={(e) => setAttendancePeriodId(e.target.value)}
              disabled={attendanceQuery.isLoading}
            >
              <option value="">{t("periodForm.attendanceNone")}</option>
              {attendanceOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.periodMonth}
                </option>
              ))}
            </Select>
            <span className="mt-1 block text-xs text-muted-foreground">
              {attendanceOptions.length === 0 && !attendanceQuery.isLoading
                ? t("periodForm.attendanceEmpty")
                : t("periodForm.attendanceHint")}
            </span>
          </label>
        )}

        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t("periodForm.noteLabel")}</span>
          <textarea
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            className="flex w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>

        {errorKey && <p className="text-sm text-danger">{t(errorKey)}</p>}
      </div>
    </Dialog>
  );
}
