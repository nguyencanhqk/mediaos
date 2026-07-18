import React from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { User, RefreshCw } from "lucide-react";
import { hrApi, hrKeys, useCan, useCanExact } from "@mediaos/web-core";
import { PageHeader, EmptyState, Button, Card, CardContent } from "@mediaos/ui";
import { HR_ENGINE_PAIRS } from "../constants";
// HR-IDENTITY-READ-1 dùng chung section CCCD/CMND; S5-HR-WORKINFO-1 tái dùng WorkInfoSection để đồng bộ khối
// "Thông tin công việc" (Cấp bậc · loại HĐ · quản lý trực tiếp/gián tiếp · khối nghỉ việc) với màn chi tiết.
import { IdentitySection, WorkInfoSection } from "../employees/profile-sections";

// ---------------------------------------------------------------------------
// Shared field row
// ---------------------------------------------------------------------------
function FieldRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[160px_1fr] gap-2 py-2 text-sm">
      <span className="font-medium text-muted-foreground">{label}</span>
      <span className="text-foreground">{value ?? "—"}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function MyProfilePage() {
  const { t } = useTranslation("hr");
  const { t: tc } = useTranslation("common");

  // /hr/me/profile — own scope enforced server-side; all authenticated users may call it
  const canViewSensitive = useCan(
    HR_ENGINE_PAIRS.VIEW_SENSITIVE.action,
    HR_ENGINE_PAIRS.VIEW_SENSITIVE.resourceType,
  );
  const canViewSalary = useCan(
    HR_ENGINE_PAIRS.VIEW_SALARY.action,
    HR_ENGINE_PAIRS.VIEW_SALARY.resourceType,
  );
  // HR-IDENTITY-READ-1 — CCCD/CMND nhạy cảm HƠN view-sensitive, cặp seed riêng. useCanExact
  // (KHÔNG useCan) — sensitive pair, tránh *:* wildcard fall-through permit trong khi BE 403.
  const canViewIdentity = useCanExact(
    HR_ENGINE_PAIRS.VIEW_IDENTITY.action,
    HR_ENGINE_PAIRS.VIEW_IDENTITY.resourceType,
  );

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: hrKeys.employees.me(),
    queryFn: () => hrApi.getMyProfile(),
    // All authenticated users can call this — server enforces Own scope
    enabled: true,
    staleTime: 60_000,
    retry: (failCount, err) => {
      const status = (err as { status?: number }).status;
      // 404 = not linked; 403 = no read:employee — both are definitive
      if (status === 404 || status === 403) return false;
      return failCount < 2;
    },
  });

  const notLinked = isError && (error as { status?: number })?.status === 404;

  const masked = t("detail.masked");

  // ── Loading ────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-6 p-6">
        <PageHeader title={t("me.title")} description={t("me.description")} icon={User} />
        <div className="h-48 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }

  // ── Not linked ─────────────────────────────────────────────────────────────
  if (notLinked) {
    return (
      <div className="p-6">
        <PageHeader title={t("me.title")} description={t("me.description")} icon={User} />
        <div className="mt-8">
          <EmptyState title={t("me.notLinked.title")} description={t("me.notLinked.description")} />
        </div>
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (isError || !data) {
    return (
      <div className="p-6">
        <PageHeader title={t("me.title")} description={t("me.description")} icon={User} />
        <div className="mt-8">
          <EmptyState
            title={t("me.error.title")}
            description={t("me.error.description")}
            action={
              <Button variant="outline" size="sm" onClick={() => void refetch()}>
                <RefreshCw className="mr-2 h-4 w-4" />
                {tc("actions.retry")}
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader title={t("me.title")} description={data.fullName ?? undefined} icon={User} />

      {/* Thông tin cơ bản: mã · họ tên · email (phần định danh) */}
      <Card>
        <CardContent className="divide-y divide-border pt-4">
          <FieldRow label={t("detail.fields.code")} value={data.employeeCode} />
          <FieldRow label={t("detail.fields.name")} value={data.fullName} />
          <FieldRow label={t("detail.fields.email")} value={data.email} />
        </CardContent>
      </Card>

      {/* S5-HR-WORKINFO-1 — khối "Thông tin công việc" dùng chung với màn chi tiết (phòng ban · chức vụ ·
          cấp bậc · loại HĐ · quản lý trực tiếp/gián tiếp · mốc thời gian · khối nghỉ việc). MyProfile KHÔNG
          truyền onNavigateEmployee → tên quản lý hiện dạng text (không điều hướng sang hồ sơ người khác). */}
      <WorkInfoSection employee={data} t={t} canViewSensitive={canViewSensitive} />

      {/* Sensitive section: server masks fields to null when unauthorized.
          Client only shows what server returned; never reveals hidden data. */}
      <Card>
        <CardContent className="divide-y divide-border pt-4">
          <FieldRow
            label={t("detail.sensitiveFields.phone")}
            value={data.phone !== null ? data.phone : canViewSensitive ? "—" : masked}
          />
          <FieldRow
            label={t("detail.sensitiveFields.notes")}
            value={data.notes !== null ? data.notes : canViewSensitive ? "—" : masked}
          />
          <FieldRow
            label={t("detail.sensitiveFields.baseSalary")}
            value={
              data.baseSalary !== null
                ? `${data.baseSalary.toLocaleString("vi-VN")} ₫`
                : canViewSalary
                  ? "—"
                  : masked
            }
          />
        </CardContent>
      </Card>

      {/* HR-IDENTITY-READ-1 — chỉ mount khi có EXACT view-identity:employee (fail-closed). */}
      {canViewIdentity && (
        <IdentitySection employee={data} t={t} canViewIdentity={canViewIdentity} />
      )}
    </div>
  );
}
