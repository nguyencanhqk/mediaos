import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { EmployeeDto, PermissionEffect } from "@mediaos/contracts";
import { ApiError } from "@mediaos/web-core";
import { Button, Dialog, Input } from "@mediaos/ui";
import { rbacApi } from "@/lib/rbac-api";

interface ObjectPermissionDialogProps {
  open: boolean;
  onClose: () => void;
  user: EmployeeDto;
  onSuccess: (message: string) => void;
}

interface FormState {
  action: string;
  resourceType: string;
  objectType: string;
  objectId: string;
  effect: PermissionEffect;
}

const EMPTY_FORM: FormState = {
  action: "",
  resourceType: "",
  objectType: "",
  objectId: "",
  effect: "ALLOW",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const EFFECT_OPTIONS: Array<{ value: PermissionEffect; labelKey: string }> = [
  { value: "ALLOW", labelKey: "objectDialog.effectAllow" },
  { value: "DENY", labelKey: "objectDialog.effectDeny" },
];

/**
 * Set/xoá object-permission override cho 1 user (subjectType="user"). CS-2.
 * PUT/DELETE /permissions/object — gate BE `grant-object-permission:permission` (isSensitive).
 * Subject = user đã chọn; nhập action/resourceType/objectType/objectId + effect.
 */
export function ObjectPermissionDialog({
  open,
  onClose,
  user,
  onSuccess,
}: ObjectPermissionDialogProps) {
  const { t } = useTranslation("rbac");
  const queryClient = useQueryClient();
  const [form, setForm] = React.useState<FormState>(EMPTY_FORM);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setForm(EMPTY_FORM);
      setError(null);
    }
  }, [open]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleError = (err: unknown) => {
    if (err instanceof ApiError && err.status === 403) {
      setError(t("feedback.forbidden"));
      return;
    }
    setError(t("feedback.actionFailed"));
  };

  const afterMutate = (message: string) => {
    void queryClient.invalidateQueries({ queryKey: ["console:rbac", "users"] });
    onSuccess(message);
    onClose();
  };

  const setMutation = useMutation({
    mutationFn: () =>
      rbacApi.setObjectPermission({
        subjectType: "user",
        subjectId: user.id,
        action: form.action,
        resourceType: form.resourceType,
        objectType: form.objectType,
        objectId: form.objectId,
        effect: form.effect,
      }),
    onSuccess: () => afterMutate(t("feedback.setSuccess")),
    onError: handleError,
  });

  const removeMutation = useMutation({
    mutationFn: () =>
      rbacApi.removeObjectPermission({
        subjectType: "user",
        subjectId: user.id,
        action: form.action,
        resourceType: form.resourceType,
        objectType: form.objectType,
        objectId: form.objectId,
        effect: form.effect,
      }),
    onSuccess: () => afterMutate(t("feedback.removeSuccess")),
    onError: handleError,
  });

  const pending = setMutation.isPending || removeMutation.isPending;

  const validate = (): boolean => {
    setError(null);
    if (!form.action || !form.resourceType || !form.objectType || !UUID_RE.test(form.objectId)) {
      setError(t("feedback.missingFields"));
      return false;
    }
    return true;
  };

  const userName = user.fullName ?? user.email;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("objectDialog.title", { name: userName })}
      description={t("objectDialog.description")}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            {t("common:actions.cancel")}
          </Button>
          <Button
            variant="destructive"
            onClick={() => validate() && removeMutation.mutate()}
            disabled={pending}
          >
            {removeMutation.isPending ? t("common:saving") : t("actions.remove")}
          </Button>
          <Button onClick={() => validate() && setMutation.mutate()} disabled={pending}>
            {setMutation.isPending ? t("common:saving") : t("actions.set")}
          </Button>
        </>
      }
    >
      {/* Cảnh báo nhạy cảm — token trạng thái warning */}
      <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-muted px-3 py-2.5 text-sm text-warning">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
        <span>{t("objectDialog.warning")}</span>
      </div>

      <div className="space-y-4">
        {/* Hai cột: action + resourceType */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label htmlFor="obj-action" className="block text-sm font-medium">
              {t("objectDialog.actionLabel")}
            </label>
            <Input
              id="obj-action"
              value={form.action}
              onChange={(e) => update("action", e.target.value)}
              placeholder="read"
              disabled={pending}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="obj-resource-type" className="block text-sm font-medium">
              {t("objectDialog.resourceTypeLabel")}
            </label>
            <Input
              id="obj-resource-type"
              value={form.resourceType}
              onChange={(e) => update("resourceType", e.target.value)}
              placeholder="task"
              disabled={pending}
            />
          </div>
        </div>

        {/* Hai cột: objectType + objectId */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label htmlFor="obj-object-type" className="block text-sm font-medium">
              {t("objectDialog.objectTypeLabel")}
            </label>
            <Input
              id="obj-object-type"
              value={form.objectType}
              onChange={(e) => update("objectType", e.target.value)}
              placeholder="project"
              disabled={pending}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="obj-object-id" className="block text-sm font-medium">
              {t("objectDialog.objectIdLabel")}
            </label>
            <Input
              id="obj-object-id"
              value={form.objectId}
              onChange={(e) => update("objectId", e.target.value)}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              disabled={pending}
            />
          </div>
        </div>

        {/* Effect toggle */}
        <div className="space-y-1.5">
          <span className="block text-sm font-medium">{t("objectDialog.effectLabel")}</span>
          <div className="flex gap-2">
            {EFFECT_OPTIONS.map(({ value, labelKey }) => (
              <button
                key={value}
                type="button"
                disabled={pending}
                className={[
                  "flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors",
                  form.effect === value
                    ? value === "ALLOW"
                      ? "border-success/40 bg-success-muted text-success"
                      : "border-danger/40 bg-danger-muted text-danger"
                    : "border-border bg-background text-muted-foreground hover:bg-muted/60",
                ].join(" ")}
                onClick={() => update("effect", value)}
              >
                {t(labelKey)}
              </button>
            ))}
          </div>
        </div>

        {/* Hint về objectId */}
        <p className="text-xs text-muted-foreground">{t("objectDialog.objectIdHint")}</p>

        {error && (
          <p role="alert" aria-live="assertive" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
