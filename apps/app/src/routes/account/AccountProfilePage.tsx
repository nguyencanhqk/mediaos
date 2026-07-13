/**
 * ACCOUNT-SCREEN-PROFILE (S2-FE-AUTH-6) — /account/profile.
 *
 * Đọc-only: user + employee + roles từ GET /auth/me (authKeys.me() — CÙNG endpoint session.ts dùng lúc
 * bootstrap, KHÔNG gọi API mới). Server quyết định field nào lộ ra (masking — BẤT BIẾN #2); client CHỈ
 * render những gì response trả, không tự suy luận/hiển thị thêm.
 *
 * Link điều hướng:
 *  - "Đề nghị thay đổi hồ sơ" → /hr/me/change-request (gate hiển thị bằng useCan create:profile-change-
 *    request — cặp seed thật mig 0444, KHÔNG hard-code quyền).
 *  - "Đổi mật khẩu" → /account/change-password.
 *  - "Phiên đăng nhập" → /account/sessions.
 *
 * States: loading · error (retry) · success (không có "empty" — /auth/me luôn trả user khi đã đăng nhập).
 *
 * Card "Bảo mật" (S2-FE-ACCT-SEC-1) — đọc twoFactorApi.status() ({enabled, required}, GET /auth/2fa/
 * status — reuse-only, KHÔNG API mới) qua query RIÊNG (queryKey cục bộ `TWO_FACTOR_STATUS_KEY`) để lỗi ở
 * card này KHÔNG làm vỡ phần /auth/me: enabled=false → nút "Bật 2FA" điều hướng ACCOUNT_SETUP_2FA_PATH
 * (reuse TwoFactorSetupPage đã tồn tại). required=true → ẨN nút tắt + hiện nhãn "bắt buộc theo chính
 * sách" (server ép theo role/company, KHÔNG hard-code). enabled=true & !required → Dialog nhập mật khẩu
 * → twoFactorApi.disable(password); 409 (TWO_FACTOR_ENFORCED) → message rõ, KHÔNG đổi trạng thái.
 *
 * BẤT BIẾN #3: mật khẩu CHỈ giữ ở component state (không localStorage/sessionStorage/console) — clear
 * ngay khi đóng dialog (huỷ/thành công).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { KeyRound, ListChecks, ShieldCheck, User } from "lucide-react";
import { ApiError, authApi, authKeys, twoFactorApi, PermissionGate } from "@mediaos/web-core";
import {
  PageHeader,
  EmptyState,
  Button,
  Badge,
  Card,
  CardContent,
  Dialog,
  Input,
} from "@mediaos/ui";
import { PCR_ME_PATH, PCR_CREATE_PERMISSION } from "@/routes/hr/profile-change-requests/constants";
import { ACCOUNT_SETUP_2FA_PATH } from "./constants";

// Query key CỤC BỘ (không thêm vào authKeys dùng chung của web-core — reuse-only theo phạm vi WO này).
const TWO_FACTOR_STATUS_KEY = ["auth", "2fa", "status"] as const;

function FieldRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[160px_1fr] gap-2 py-2 text-sm">
      <span className="font-medium text-muted-foreground">{label}</span>
      <span className="text-foreground">{value ?? "—"}</span>
    </div>
  );
}

type TF = ReturnType<typeof useTranslation<"account">>["t"];

function disableTwoFactorErrorMessage(err: unknown, t: TF): string {
  if (err instanceof ApiError && err.status === 409) return t("profile.security.error.enforced");
  return t("profile.security.error.generic");
}

export function AccountProfilePage() {
  const { t } = useTranslation("account");
  const { t: tc } = useTranslation("common");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [pcrAction, pcrResourceType] = PCR_CREATE_PERMISSION.split(":");

  const [disableDialogOpen, setDisableDialogOpen] = useState(false);
  const [disablePassword, setDisablePassword] = useState("");
  const [disableError, setDisableError] = useState<string | null>(null);
  const [securityFeedback, setSecurityFeedback] = useState<string | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: authKeys.me(),
    queryFn: () => authApi.me(),
    staleTime: 30_000,
  });

  const twoFactorStatus = useQuery({
    queryKey: TWO_FACTOR_STATUS_KEY,
    queryFn: () => twoFactorApi.status(),
    staleTime: 30_000,
  });

  const disableMutation = useMutation({
    mutationFn: (password: string) => twoFactorApi.disable(password),
    onSuccess: async () => {
      setDisableDialogOpen(false);
      setDisablePassword("");
      setDisableError(null);
      await queryClient.invalidateQueries({ queryKey: TWO_FACTOR_STATUS_KEY });
      setSecurityFeedback(t("profile.security.disableSuccess"));
    },
    onError: (err) => {
      // Thất bại (vd 409 enforced) — KHÔNG giữ mật khẩu vừa nhập trong state (BẤT BIẾN #3), user gõ lại.
      setDisablePassword("");
      setDisableError(disableTwoFactorErrorMessage(err, t));
    },
  });

  const closeDisableDialog = () => {
    if (disableMutation.isPending) return;
    setDisableDialogOpen(false);
    setDisablePassword("");
    setDisableError(null);
  };

  const submitDisable = () => {
    const password = disablePassword.trim();
    if (!password) return;
    setSecurityFeedback(null);
    disableMutation.mutate(password);
  };

  // ── Loading ────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-6 p-6">
        <PageHeader title={t("profile.title")} description={t("profile.description")} icon={User} />
        <div className="h-48 max-w-2xl animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (isError || !data) {
    return (
      <div className="p-6">
        <PageHeader title={t("profile.title")} description={t("profile.description")} icon={User} />
        <div className="mt-8">
          <EmptyState
            title={t("profile.error.title")}
            description={t("profile.error.description")}
            action={
              <Button variant="outline" size="sm" onClick={() => void refetch()}>
                {tc("actions.retry")}
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6 p-6">
      <PageHeader
        title={t("profile.title")}
        description={data.fullName ?? data.email}
        icon={User}
      />

      {/* Tài khoản — trực tiếp từ /auth/me, KHÔNG suy luận thêm field server chưa trả */}
      <Card>
        <CardContent className="divide-y divide-border pt-4">
          <FieldRow label={t("profile.fields.email")} value={data.email} />
          <FieldRow label={t("profile.fields.fullName")} value={data.fullName} />
          <FieldRow label={t("profile.fields.status")} value={data.status} />
          {data.company && (
            <FieldRow label={t("profile.fields.company")} value={data.company.name} />
          )}
        </CardContent>
      </Card>

      {/* Hồ sơ nhân sự — null khi user không gắn hồ sơ (operator/super-admin) */}
      <Card>
        <CardContent className="pt-4">
          <h3 className="mb-2 text-sm font-semibold text-foreground">
            {t("profile.sections.employee")}
          </h3>
          {data.employee ? (
            <div className="divide-y divide-border">
              <FieldRow
                label={t("profile.fields.employeeCode")}
                value={data.employee.employeeCode}
              />
              <FieldRow
                label={t("profile.fields.employmentStatus")}
                value={data.employee.employmentStatus}
              />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("profile.noEmployee")}</p>
          )}
        </CardContent>
      </Card>

      {/* Vai trò — active role gán cho user (users_roles ⋈ roles) */}
      <Card>
        <CardContent className="pt-4">
          <h3 className="mb-2 text-sm font-semibold text-foreground">
            {t("profile.sections.roles")}
          </h3>
          {data.roles && data.roles.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {data.roles.map((r) => (
                <Badge key={r.id} variant="outline">
                  {r.name}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("profile.noRoles")}</p>
          )}
        </CardContent>
      </Card>

      {/* Bảo mật — trạng thái 2FA (twoFactorApi.status(), query RIÊNG khỏi /auth/me — lỗi ở đây KHÔNG
          làm vỡ phần còn lại của trang). required=true → ẨN nút tắt (server ép theo policy). */}
      <Card>
        <CardContent className="pt-4">
          <h3 className="mb-2 text-sm font-semibold text-foreground">
            {t("profile.security.title")}
          </h3>

          {twoFactorStatus.isLoading && <div className="h-16 animate-pulse rounded-md bg-muted" />}

          {!twoFactorStatus.isLoading && (twoFactorStatus.isError || !twoFactorStatus.data) && (
            <p role="alert" className="text-sm text-destructive">
              {t("profile.security.loadError")}
            </p>
          )}

          {!twoFactorStatus.isLoading && twoFactorStatus.data && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={twoFactorStatus.data.enabled ? "success" : "muted"}>
                  {twoFactorStatus.data.enabled
                    ? t("profile.security.statusEnabled")
                    : t("profile.security.statusDisabled")}
                </Badge>
                {twoFactorStatus.data.required && (
                  <span className="text-xs font-medium text-muted-foreground">
                    {t("profile.security.requiredPolicyLabel")}
                  </span>
                )}
              </div>

              {securityFeedback && (
                <p
                  role="alert"
                  aria-live="assertive"
                  className="rounded-md border border-success/40 bg-success-muted px-3 py-2 text-sm text-success"
                >
                  {securityFeedback}
                </p>
              )}

              {!twoFactorStatus.data.enabled && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void navigate({ to: ACCOUNT_SETUP_2FA_PATH as "/" })}
                >
                  <ShieldCheck className="mr-2 h-4 w-4" />
                  {t("profile.security.enableButton")}
                </Button>
              )}

              {twoFactorStatus.data.enabled && !twoFactorStatus.data.required && (
                <Button variant="outline" size="sm" onClick={() => setDisableDialogOpen(true)}>
                  <ShieldCheck className="mr-2 h-4 w-4" />
                  {t("profile.security.disableButton")}
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Liên kết self-service — useNavigate (mirror AvatarMenu) thay vì <Link to> để tránh phải cast
          kiểu route chưa đăng ký literal trong Register (mirror pattern EmployeeDetailPage onEdit). */}
      <Card>
        <CardContent className="flex flex-col gap-2 pt-4 sm:flex-row sm:flex-wrap">
          <PermissionGate action={pcrAction} resourceType={pcrResourceType}>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void navigate({ to: PCR_ME_PATH as "/" })}
            >
              <ListChecks className="mr-2 h-4 w-4" />
              {t("profile.links.changeRequest")}
            </Button>
          </PermissionGate>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void navigate({ to: "/account/change-password" as "/" })}
          >
            <KeyRound className="mr-2 h-4 w-4" />
            {t("profile.links.changePassword")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void navigate({ to: "/account/sessions" as "/" })}
          >
            <User className="mr-2 h-4 w-4" />
            {t("profile.links.sessions")}
          </Button>
        </CardContent>
      </Card>

      {/* Dialog tắt 2FA — mật khẩu CHỈ giữ ở state React, xoá ngay khi đóng/thành công (BẤT BIẾN #3). */}
      <Dialog
        open={disableDialogOpen}
        onClose={closeDisableDialog}
        title={t("profile.security.dialog.title")}
        description={t("profile.security.dialog.description")}
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              onClick={closeDisableDialog}
              disabled={disableMutation.isPending}
            >
              {t("profile.security.dialog.cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={submitDisable}
              disabled={disableMutation.isPending || disablePassword.trim().length === 0}
            >
              {disableMutation.isPending ? tc("saving") : t("profile.security.dialog.confirm")}
            </Button>
          </>
        }
      >
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="disable-2fa-password">
            {t("profile.security.dialog.passwordLabel")}
          </label>
          <Input
            id="disable-2fa-password"
            type="password"
            autoComplete="current-password"
            value={disablePassword}
            onChange={(e) => setDisablePassword(e.target.value)}
          />
        </div>
        {disableError && (
          <p role="alert" className="text-sm text-destructive">
            {disableError}
          </p>
        )}
      </Dialog>
    </div>
  );
}
