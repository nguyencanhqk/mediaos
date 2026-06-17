import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { EmployeeDto } from "@mediaos/contracts";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { ApiError } from "@/lib/api-client";
import { rbacApi, type RoleSummary } from "@/lib/rbac-api";

interface RevokeRoleDialogProps {
  open: boolean;
  onClose: () => void;
  user: EmployeeDto;
  roles: RoleSummary[];
  onSuccess: (message: string) => void;
}

/**
 * Thu role khỏi 1 user (DELETE /permissions/users/:id/roles/:roleId).
 *
 * ⚠️ BE KHÔNG có read-API liệt kê role hiện tại của user → operator chọn role từ danh mục
 * (BE trả 404 nếu user không giữ role đó). Gate ở BE: `assign-role:user` (isSensitive).
 */
export function RevokeRoleDialog({ open, onClose, user, roles, onSuccess }: RevokeRoleDialogProps) {
  const { t } = useTranslation("rbac");
  const queryClient = useQueryClient();
  const [roleId, setRoleId] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setRoleId("");
      setError(null);
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: () => rbacApi.revokeRole(user.id, roleId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["rbac", "users"] });
      onSuccess(t("feedback.revokeSuccess"));
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
      title={t("revokeDialog.title", { name: userName })}
      description={t("revokeDialog.description")}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            {t("common:actions.cancel")}
          </Button>
          <Button variant="destructive" onClick={onSubmit} disabled={mutation.isPending}>
            {mutation.isPending ? t("common:saving") : t("actions.revoke")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">{t("revokeDialog.roleLabel")}</span>
          <Select value={roleId} onChange={(e) => setRoleId(e.target.value)}>
            <option value="">{t("revokeDialog.rolePlaceholder")}</option>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
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
