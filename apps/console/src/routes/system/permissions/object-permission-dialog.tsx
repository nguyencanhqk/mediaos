import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { EmployeeDto, PermissionEffect } from "@mediaos/contracts";
import { ApiError } from "@mediaos/web-core";
import { Button, Dialog, Input, Select } from "@mediaos/ui";
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

/**
 * Set/xoá object-permission override cho 1 user (subjectType="user"). CS-2 (mirror apps/admin tenant/rbac).
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
            {t("actions.remove")}
          </Button>
          <Button onClick={() => validate() && setMutation.mutate()} disabled={pending}>
            {setMutation.isPending ? t("common:saving") : t("actions.set")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">{t("objectDialog.actionLabel")}</span>
          <Input value={form.action} onChange={(e) => update("action", e.target.value)} />
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">{t("objectDialog.resourceTypeLabel")}</span>
          <Input
            value={form.resourceType}
            onChange={(e) => update("resourceType", e.target.value)}
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">{t("objectDialog.objectTypeLabel")}</span>
          <Input value={form.objectType} onChange={(e) => update("objectType", e.target.value)} />
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">{t("objectDialog.objectIdLabel")}</span>
          <Input value={form.objectId} onChange={(e) => update("objectId", e.target.value)} />
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">{t("objectDialog.effectLabel")}</span>
          <Select
            value={form.effect}
            onChange={(e) => update("effect", e.target.value as PermissionEffect)}
          >
            <option value="ALLOW">{t("objectDialog.effectAllow")}</option>
            <option value="DENY">{t("objectDialog.effectDeny")}</option>
          </Select>
        </label>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
