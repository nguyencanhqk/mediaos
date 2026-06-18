import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { EmployeeDto } from "@mediaos/contracts";
import { ApiError } from "@mediaos/web-core";
import { Button, Dialog, Input, Select } from "@mediaos/ui";
import { rbacApi, type RoleSummary } from "@/lib/rbac-api";

interface AssignRoleDialogProps {
  open: boolean;
  onClose: () => void;
  user: EmployeeDto;
  roles: RoleSummary[];
  onSuccess: (message: string) => void;
}

/** Local datetime input → ISO datetime (BE assignRoleSchema yêu cầu z.string().datetime()). */
function toIso(localValue: string): string | null {
  if (!localValue) return null;
  const date = new Date(localValue);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Gán role cho 1 user (POST /permissions/users/:id/roles). CS-2 (mirror apps/admin tenant/rbac).
 * Gate ở BE: `assign-role:user` (isSensitive). UI chỉ ẩn/hiện affordance — BE là gác cuối (fail-closed).
 * Danh mục `roles` đã được BE loại trừ role operator-audience (chống leo thang).
 */
export function AssignRoleDialog({ open, onClose, user, roles, onSuccess }: AssignRoleDialogProps) {
  const { t } = useTranslation("rbac");
  const queryClient = useQueryClient();
  const [roleId, setRoleId] = React.useState("");
  const [expiresLocal, setExpiresLocal] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setRoleId("");
      setExpiresLocal("");
      setError(null);
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: () => rbacApi.assignRole(user.id, { roleId, expiresAt: toIso(expiresLocal) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["console:rbac", "users"] });
      onSuccess(t("feedback.assignSuccess"));
      onClose();
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError && err.status === 403) {
        setError(t("feedback.forbidden"));
        return;
      }
      setError(t("feedback.actionFailed"));
    },
  });

  const onSubmit = () => {
    setError(null);
    if (!roleId) {
      setError(t("feedback.missingRole"));
      return;
    }
    mutation.mutate();
  };

  const userName = user.fullName ?? user.email;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("assignDialog.title", { name: userName })}
      description={t("assignDialog.description")}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            {t("common:actions.cancel")}
          </Button>
          <Button onClick={onSubmit} disabled={mutation.isPending}>
            {mutation.isPending ? t("common:saving") : t("actions.assign")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">{t("assignDialog.roleLabel")}</span>
          <Select value={roleId} onChange={(e) => setRoleId(e.target.value)}>
            <option value="">{t("assignDialog.rolePlaceholder")}</option>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </Select>
        </label>

        <label className="block space-y-1.5">
          <span className="text-sm font-medium">{t("assignDialog.expiresLabel")}</span>
          <Input
            type="datetime-local"
            value={expiresLocal}
            onChange={(e) => setExpiresLocal(e.target.value)}
          />
          <span className="text-xs text-muted-foreground">{t("assignDialog.expiresHint")}</span>
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
