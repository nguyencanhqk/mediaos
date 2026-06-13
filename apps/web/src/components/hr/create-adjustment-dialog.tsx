import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createAdjustmentRequestSchema } from "@mediaos/contracts";
import { attendanceApi } from "@/lib/attendance-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";

interface FormState {
  workDate: string;
  requestedCheckInAt: string;
  requestedCheckOutAt: string;
  reason: string;
}

const emptyForm: FormState = {
  workDate: "",
  requestedCheckInAt: "",
  requestedCheckOutAt: "",
  reason: "",
};

/** Build ISO datetime from date + local time string (HH:mm). */
function toIso(date: string, time: string): string | null {
  if (!date || !time) return null;
  return new Date(`${date}T${time}:00`).toISOString();
}

export function CreateAdjustmentDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [validationError, setValidationError] = useState<string | null>(null);

  const patch = (p: Partial<FormState>) =>
    setForm((f) => ({ ...f, ...p }));

  const create = useMutation({
    mutationFn: () => {
      const payload = {
        workDate: form.workDate,
        requestedCheckInAt: toIso(form.workDate, form.requestedCheckInAt),
        requestedCheckOutAt: toIso(form.workDate, form.requestedCheckOutAt),
        reason: form.reason,
      };
      const result = createAdjustmentRequestSchema.safeParse(payload);
      if (!result.success) {
        throw new Error(result.error.errors[0]?.message ?? "Dữ liệu không hợp lệ");
      }
      return attendanceApi.createAdjustment(result.data);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["attendance", "adjustments"] });
      setForm(emptyForm);
      setValidationError(null);
      setOpen(false);
    },
    onError: (e: unknown) => {
      setValidationError(e instanceof Error ? e.message : "Lỗi tạo đơn.");
    },
  });

  const canSubmit =
    form.workDate.trim() !== "" &&
    form.reason.trim().length >= 3 &&
    (form.requestedCheckInAt !== "" || form.requestedCheckOutAt !== "");

  return (
    <>
      <Button onClick={() => setOpen(true)}>+ Tạo đơn bổ sung công</Button>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
          setValidationError(null);
        }}
        title="Tạo đơn bổ sung công"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setOpen(false);
                setValidationError(null);
              }}
            >
              Huỷ
            </Button>
            <Button
              onClick={() => create.mutate()}
              disabled={!canSubmit || create.isPending}
            >
              {create.isPending ? "Đang gửi…" : "Gửi đơn"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Ngày cần bổ sung *</label>
            <Input
              type="date"
              value={form.workDate}
              onChange={(e) => patch({ workDate: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Giờ check-in đề nghị</label>
              <Input
                type="time"
                value={form.requestedCheckInAt}
                onChange={(e) => patch({ requestedCheckInAt: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Giờ check-out đề nghị</label>
              <Input
                type="time"
                value={form.requestedCheckOutAt}
                onChange={(e) => patch({ requestedCheckOutAt: e.target.value })}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Cần điền ít nhất một trong hai mốc giờ.
          </p>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Lý do *</label>
            <textarea
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring min-h-[80px] resize-none"
              placeholder="Mô tả lý do bổ sung công (tối thiểu 3 ký tự)…"
              value={form.reason}
              onChange={(e) => patch({ reason: e.target.value })}
              maxLength={1000}
            />
          </div>
          {validationError && (
            <p className="text-sm text-destructive">{validationError}</p>
          )}
        </div>
      </Dialog>
    </>
  );
}
