import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createPlatformAccountSchema,
  type CreatePlatformAccountRequest,
  type PlatformDto,
} from "@mediaos/contracts";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { platformAccountsApi } from "@/lib/platform-accounts-api";
import { SECURITY_LEVEL_LABELS, SECURITY_LEVEL_OPTIONS } from "./constants";

interface CreateAccountDialogProps {
  open: boolean;
  onClose: () => void;
  platforms: PlatformDto[];
}

interface FormState {
  platformId: string;
  secret: string;
  accountName: string;
  accountEmail: string;
  accountIdentifier: string;
  securityLevel: string;
  recoveryEmail: string;
  recoveryPhone: string;
  twoFactorNote: string;
}

const EMPTY: FormState = {
  platformId: "",
  secret: "",
  accountName: "",
  accountEmail: "",
  accountIdentifier: "",
  securityLevel: "",
  recoveryEmail: "",
  recoveryPhone: "",
  twoFactorNote: "",
};

/** Bỏ field rỗng → undefined (optional). Giữ secret/platformId bắt buộc. */
function toRequest(f: FormState): CreatePlatformAccountRequest {
  const opt = (v: string) => (v.trim() === "" ? undefined : v.trim());
  return {
    platformId: f.platformId,
    secret: f.secret,
    accountName: opt(f.accountName),
    accountEmail: opt(f.accountEmail),
    accountIdentifier: opt(f.accountIdentifier),
    securityLevel: opt(f.securityLevel),
    recoveryEmail: opt(f.recoveryEmail),
    recoveryPhone: opt(f.recoveryPhone),
    twoFactorNote: opt(f.twoFactorNote),
  };
}

export function CreateAccountDialog({ open, onClose, platforms }: CreateAccountDialogProps) {
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState>(EMPTY);

  // Reset form (kể cả secret plaintext nhập tay) mỗi lần đóng.
  useEffect(() => {
    if (!open) setForm(EMPTY);
  }, [open]);

  const parsed = useMemo(() => createPlatformAccountSchema.safeParse(toRequest(form)), [form]);

  const create = useMutation({
    mutationFn: () => {
      if (!parsed.success) throw new Error("Dữ liệu không hợp lệ.");
      return platformAccountsApi.create(parsed.data);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["platform-accounts"] });
      onClose();
    },
  });

  const patch = (p: Partial<FormState>) => setForm((f) => ({ ...f, ...p }));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Thêm tài khoản nền tảng"
      description="Secret được mã hoá phía máy chủ (envelope) — không lưu plaintext."
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Huỷ
          </Button>
          <Button size="sm" onClick={() => create.mutate()} disabled={!parsed.success || create.isPending}>
            {create.isPending ? "Đang tạo…" : "Tạo"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Nền tảng *">
          <Select value={form.platformId} onChange={(e) => patch({ platformId: e.target.value })}>
            <option value="" disabled>
              — Chọn nền tảng —
            </option>
            {platforms.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Secret (mật khẩu / token) *">
          <Input
            type="password"
            autoComplete="off"
            value={form.secret}
            onChange={(e) => patch({ secret: e.target.value })}
            placeholder="••••••••"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Tên tài khoản">
            <Input value={form.accountName} onChange={(e) => patch({ accountName: e.target.value })} />
          </Field>
          <Field label="Email tài khoản">
            <Input
              type="email"
              value={form.accountEmail}
              onChange={(e) => patch({ accountEmail: e.target.value })}
            />
          </Field>
          <Field label="Định danh (handle/@)">
            <Input
              value={form.accountIdentifier}
              onChange={(e) => patch({ accountIdentifier: e.target.value })}
            />
          </Field>
          <Field label="Mức bảo mật">
            <Select
              value={form.securityLevel}
              onChange={(e) => patch({ securityLevel: e.target.value })}
            >
              <option value="">— Không đặt —</option>
              {SECURITY_LEVEL_OPTIONS.map((lvl) => (
                <option key={lvl} value={lvl}>
                  {SECURITY_LEVEL_LABELS[lvl]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Email khôi phục">
            <Input
              type="email"
              value={form.recoveryEmail}
              onChange={(e) => patch({ recoveryEmail: e.target.value })}
            />
          </Field>
          <Field label="SĐT khôi phục">
            <Input
              value={form.recoveryPhone}
              onChange={(e) => patch({ recoveryPhone: e.target.value })}
            />
          </Field>
        </div>

        <Field label="Ghi chú 2FA">
          <Input
            value={form.twoFactorNote}
            onChange={(e) => patch({ twoFactorNote: e.target.value })}
            placeholder="VD: backup codes ở đâu, app authenticator nào…"
          />
        </Field>

        {create.isError && (
          <p className="text-sm text-destructive">
            Tạo thất bại:{" "}
            {create.error instanceof Error ? create.error.message : "Lỗi không xác định"}
          </p>
        )}
      </div>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
