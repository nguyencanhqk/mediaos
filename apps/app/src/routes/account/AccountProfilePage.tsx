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
 */
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { KeyRound, ListChecks, User } from "lucide-react";
import { authApi, authKeys, PermissionGate } from "@mediaos/web-core";
import { PageHeader, EmptyState, Button, Badge, Card, CardContent } from "@mediaos/ui";
import { PCR_ME_PATH, PCR_CREATE_PERMISSION } from "@/routes/hr/profile-change-requests/constants";

function FieldRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[160px_1fr] gap-2 py-2 text-sm">
      <span className="font-medium text-muted-foreground">{label}</span>
      <span className="text-foreground">{value ?? "—"}</span>
    </div>
  );
}

export function AccountProfilePage() {
  const { t } = useTranslation("account");
  const { t: tc } = useTranslation("common");
  const navigate = useNavigate();
  const [pcrAction, pcrResourceType] = PCR_CREATE_PERMISSION.split(":");

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: authKeys.me(),
    queryFn: () => authApi.me(),
    staleTime: 30_000,
  });

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
    </div>
  );
}
