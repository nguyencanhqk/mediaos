import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createLeaveRequestSchema } from "@mediaos/contracts";
import { leaveApi } from "@/lib/leave-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Dialog } from "@/components/ui/dialog";

interface FormState {
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  reason: string;
}

const emptyForm: FormState = {
  leaveTypeId: "",
  startDate: "",
  endDate: "",
  reason: "",
};

export function CreateLeaveDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [validationError, setValidationError] = useState<string | null>(null);

  const patch = (p: Partial<FormState>) =>
    setForm((f) => ({ ...f, ...p }));

  const { data: leaveTypes = [] } = useQuery({
    queryKey: ["leave", "types"],
    queryFn: () => leaveApi.listTypes(),
  });

  const activeTypes = leaveTypes.filter((t) => t.status === "active");

  const create = useMutation({
    mutationFn: () => {
      const payload = {
        leaveTypeId: form.leaveTypeId,
        startDate: form.startDate,
        endDate: form.endDate,
        reason: form.reason || undefined,
      };
      const result = createLeaveRequestSchema.safeParse(payload);
      if (!result.success) {
        throw new Error(result.error.errors[0]?.message ?? "Dữ liệu không hợp lệ");
      }
      return leaveApi.createRequest(result.data);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["leave", "requests"] });
      void qc.invalidateQueries({ queryKey: ["leave", "balances"] });
      setForm(emptyForm);
      setValidationError(null);
      setOpen(false);
    },
    onError: (e: unknown) => {
      setValidationError(e instanceof Error ? e.message : "Lỗi tạo đơn nghỉ.");
    },
  });

  const canSubmit =
    form.leaveTypeId !== "" &&
    form.startDate !== "" &&
    form.endDate !== "";

  return (
    <>
      <Button onClick={() => setOpen(true)}>+ Tạo đơn nghỉ phép</Button>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
          setValidationError(null);
        }}
        title="Tạo đơn nghỉ phép"
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
            <label className="text-sm font-medium">Loại nghỉ *</label>
            <Select
              value={form.leaveTypeId}
              onChange={(e) => patch({ leaveTypeId: e.target.value })}
            >
              <option value="">— Chọn loại nghỉ —</option>
              {activeTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.annualQuota != null ? ` (${t.annualQuota} ngày/năm)` : ""}
                  {t.paid ? "" : " · Không lương"}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Ngày bắt đầu *</label>
              <Input
                type="date"
                value={form.startDate}
                onChange={(e) => patch({ startDate: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Ngày kết thúc *</label>
              <Input
                type="date"
                value={form.endDate}
                min={form.startDate || undefined}
                onChange={(e) => patch({ endDate: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Lý do</label>
            <textarea
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring min-h-[80px] resize-none"
              placeholder="Ghi rõ lý do nghỉ (không bắt buộc)…"
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
