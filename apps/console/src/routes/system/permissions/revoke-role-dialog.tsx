import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ShieldOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { EmployeeDto } from "@mediaos/contracts";
import { ApiError } from "@mediaos/web-core";
import { Button, Dialog, Input } from "@mediaos/ui";
import { rbacApi, type RoleSummary } from "@/lib/rbac-api";

interface RevokeRoleDialogProps {
  open: boolean;
  onClose: () => void;
  user: EmployeeDto;
  roles: RoleSummary[];
  onSuccess: (message: string) => void;
}

/**
 * Thu role khỏi 1 user (DELETE /permissions/users/:id/roles/:roleId). CS-2.
 *
 * ⚠️ BE KHÔNG có read-API liệt kê role hiện tại của user → chọn role từ danh mục
 * (BE trả 404 nếu user không giữ role đó). Gate ở BE: `assign-role:user` (isSensitive).
 */
export function RevokeRoleDialog({ open, onClose, user, roles, onSuccess }: RevokeRoleDialogProps) {
  const { t } = useTranslation("rbac");
  const queryClient = useQueryClient();
  const [roleId, setRoleId] = React.useState("");
  const [roleSearch, setRoleSearch] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setRoleId("");
      setRoleSearch("");
      setError(null);
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: () => rbacApi.revokeRole(user.id, roleId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["console:rbac", "users"] });
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

  const filteredRoles = roleSearch.trim()
    ? roles.filter((r) => r.name.toLowerCase().includes(roleSearch.toLowerCase()))
    : roles;

  const selectedRole = roles.find((r) => r.id === roleId);

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
          <Button variant="destructive" onClick={onSubmit} disabled={mutation.isPending || !roleId}>
            {mutation.isPending ? t("common:saving") : t("actions.revoke")}
          </Button>
        </>
      }
    >
      {/* Cảnh báo destructive — token trạng thái danger (đọc được cả light/dark) */}
      <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-muted px-3 py-2.5 text-sm text-danger">
        <ShieldOff className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
        <span>{t("revokeDialog.warning")}</span>
      </div>

      <div className="space-y-4">
        {/* Role search + select */}
        <div className="space-y-1.5">
          <label htmlFor="revoke-role-search" className="block text-sm font-medium">
            {t("revokeDialog.roleLabel")}
          </label>

          {roles.length > 5 && (
            <Input
              id="revoke-role-search"
              type="search"
              placeholder={t("revokeDialog.roleSearchPlaceholder")}
              value={roleSearch}
              onChange={(e) => setRoleSearch(e.target.value)}
              className="mb-1"
            />
          )}

          <div className="max-h-40 overflow-y-auto rounded-md border border-border">
            {filteredRoles.length === 0 ? (
              <p className="px-3 py-2 text-sm text-muted-foreground">
                {t("revokeDialog.noRolesFound")}
              </p>
            ) : (
              filteredRoles.map((role) => (
                <button
                  key={role.id}
                  type="button"
                  className={[
                    "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors",
                    roleId === role.id
                      ? "bg-danger-muted text-danger font-medium"
                      : "hover:bg-muted/60",
                  ].join(" ")}
                  onClick={() => setRoleId(role.id)}
                >
                  <span
                    className={[
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                      roleId === role.id ? "border-destructive bg-destructive" : "border-border",
                    ].join(" ")}
                  >
                    {roleId === role.id && (
                      // Chấm bên trong vòng tròn destructive — dùng foreground-token (đảo màu đúng
                      // theo theme: trắng ở light/đỏ-đậm nền, gần-đen ở dark/đỏ-sáng nền).
                      <span className="h-1.5 w-1.5 rounded-full bg-destructive-foreground" />
                    )}
                  </span>
                  {role.name}
                </button>
              ))
            )}
          </div>

          {selectedRole && (
            <p className="text-xs text-muted-foreground">
              {t("revokeDialog.selectedRole", { name: selectedRole.name })}
            </p>
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
