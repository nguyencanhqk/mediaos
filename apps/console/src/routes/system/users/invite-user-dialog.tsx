import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { CreateUserInviteRequest } from "@mediaos/contracts";
import { Button, Dialog } from "@mediaos/ui";

interface InviteUserDialogProps {
  open: boolean;
  pending: boolean;
  error: string | null;
  onConfirm: (data: CreateUserInviteRequest) => void;
  onClose: () => void;
}

interface FormState {
  email: string;
  fullName: string;
}

interface FormErrors {
  email?: string;
  fullName?: string;
}

const EMPTY_FORM: FormState = { email: "", fullName: "" };

/**
 * Dialog mời user mới — yêu cầu invite:user (is_sensitive).
 * Gửi email + fullName; companyId do server lấy từ JWT.
 * Validation phía client trước khi gọi server (email hợp lệ, fullName bắt buộc).
 */
export function InviteUserDialog({
  open,
  pending,
  error,
  onConfirm,
  onClose,
}: InviteUserDialogProps) {
  const { t } = useTranslation("users");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [touched, setTouched] = useState<Record<keyof FormState, boolean>>({
    email: false,
    fullName: false,
  });

  function validate(data: FormState): FormErrors {
    const errors: FormErrors = {};
    if (!data.email.trim()) {
      errors.email = t("invite.emailRequired");
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email.trim())) {
      errors.email = t("invite.emailInvalid");
    }
    if (!data.fullName.trim()) {
      errors.fullName = t("invite.fullNameRequired");
    }
    return errors;
  }

  const errors = validate(form);
  const isValid = Object.keys(errors).length === 0;

  function handleChange(field: keyof FormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function handleBlur(field: keyof FormState) {
    setTouched((prev) => ({ ...prev, [field]: true }));
  }

  function handleSubmit() {
    setTouched({ email: true, fullName: true });
    if (!isValid) return;
    onConfirm({ email: form.email.trim(), fullName: form.fullName.trim() });
  }

  function handleClose() {
    setForm(EMPTY_FORM);
    setTouched({ email: false, fullName: false });
    onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title={t("invite.title")}
      description={t("invite.description")}
      footer={
        <>
          <Button variant="outline" onClick={handleClose} disabled={pending}>
            {t("invite.cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={pending || !isValid}>
            {pending ? t("invite.submitting") : t("invite.submit")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1">
          <label htmlFor="invite-email" className="text-sm font-medium">
            {t("invite.emailLabel")} <span aria-hidden="true" className="text-destructive">*</span>
          </label>
          <input
            id="invite-email"
            type="email"
            className="w-full rounded border border-border px-3 py-2 text-sm"
            placeholder={t("invite.emailPlaceholder")}
            value={form.email}
            onChange={(e) => handleChange("email", e.target.value)}
            onBlur={() => handleBlur("email")}
            disabled={pending}
            maxLength={320}
            autoComplete="off"
          />
          {touched.email && errors.email && (
            <p className="text-xs text-destructive">{errors.email}</p>
          )}
        </div>

        <div className="space-y-1">
          <label htmlFor="invite-fullName" className="text-sm font-medium">
            {t("invite.fullNameLabel")} <span aria-hidden="true" className="text-destructive">*</span>
          </label>
          <input
            id="invite-fullName"
            type="text"
            className="w-full rounded border border-border px-3 py-2 text-sm"
            placeholder={t("invite.fullNamePlaceholder")}
            value={form.fullName}
            onChange={(e) => handleChange("fullName", e.target.value)}
            onBlur={() => handleBlur("fullName")}
            disabled={pending}
            maxLength={255}
          />
          {touched.fullName && errors.fullName && (
            <p className="text-xs text-destructive">{errors.fullName}</p>
          )}
        </div>

        {error && (
          <p role="alert" aria-live="assertive" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
