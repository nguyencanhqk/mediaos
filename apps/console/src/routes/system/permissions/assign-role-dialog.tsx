import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { EmployeeDto } from "@mediaos/contracts";
import { ApiError } from "@mediaos/web-core";
import { Button, Dialog, Input } from "@mediaos/ui";
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
 * Gán role cho 1 user (POST /permissions/users/:id/roles). CS-2.
 * Gate ở BE: `assign-role:user` (isSensitive). UI chỉ ẩn/hiện affordance — BE là gác cuối (fail-closed).
 * Danh mục `roles` đã được BE loại trừ role operator-audience (chống leo thang).
 */
export function AssignRoleDialog({ open, onClose, user, roles, onSuccess }: AssignRoleDialogProps) {
  const { t } = useTranslation("rbac");
  const queryClient = useQueryClient();
  const [roleId, setRoleId] = React.useState("");
  const [roleSearch, setRoleSearch] = React.useState("");
  const [expiresLocal, setExpiresLocal] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setRoleId("");
      setRoleSearch("");
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

  const filteredRoles = roleSearch.trim()
    ? roles.filter((r) => r.name.toLowerCase().includes(roleSearch.toLowerCase()))
    : roles;

  const selectedRole = roles.find((r) => r.id === roleId);

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
          <Button onClick={onSubmit} disabled={mutation.isPending || !roleId}>
            {mutation.isPending ? t("common:saving") : t("actions.assign")}
          </Button>
        </>
      }
    >
      {/* Cảnh báo nhạy cảm — token trạng thái warning */}
      <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-muted px-3 py-2.5 text-sm text-warning">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
        <span>{t("assignDialog.warning")}</span>
      </div>

      <div className="space-y-4">
        {/* Role search + select */}
        <div className="space-y-1.5">
          <label htmlFor="assign-role-search" className="block text-sm font-medium">
            {t("assignDialog.roleLabel")}
          </label>

          {roles.length > 5 && (
            <Input
              id="assign-role-search"
              type="search"
              placeholder={t("assignDialog.roleSearchPlaceholder")}
              value={roleSearch}
              onChange={(e) => setRoleSearch(e.target.value)}
              className="mb-1"
            />
          )}

          <div className="max-h-40 overflow-y-auto rounded-md border border-border">
            {filteredRoles.length === 0 ? (
              <p className="px-3 py-2 text-sm text-muted-foreground">
                {t("assignDialog.noRolesFound")}
              </p>
            ) : (
              filteredRoles.map((role) => (
                <button
                  key={role.id}
                  type="button"
                  className={[
                    "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors",
                    roleId === role.id
                      ? "bg-brand-muted text-brand font-medium"
                      : "hover:bg-muted/60",
                  ].join(" ")}
                  onClick={() => setRoleId(role.id)}
                >
                  <span
                    className={[
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                      roleId === role.id ? "border-brand bg-brand" : "border-border",
                    ].join(" ")}
                  >
                    {roleId === role.id && (
                      // brand-foreground = trắng cả 2 theme, nhưng dùng token để nhất quán ngữ nghĩa.
                      <span className="h-1.5 w-1.5 rounded-full bg-brand-foreground" />
                    )}
                  </span>
                  {role.name}
                </button>
              ))
            )}
          </div>

          {selectedRole && (
            <p className="text-xs text-muted-foreground">
              {t("assignDialog.selectedRole", { name: selectedRole.name })}
            </p>
          )}
        </div>

        {/* Hết hạn */}
        <div className="space-y-1.5">
          <label htmlFor="assign-expires" className="block text-sm font-medium">
            {t("assignDialog.expiresLabel")}
          </label>
          <Input
            id="assign-expires"
            type="datetime-local"
            value={expiresLocal}
            onChange={(e) => setExpiresLocal(e.target.value)}
            disabled={mutation.isPending}
          />
          <p className="text-xs text-muted-foreground">{t("assignDialog.expiresHint")}</p>
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
