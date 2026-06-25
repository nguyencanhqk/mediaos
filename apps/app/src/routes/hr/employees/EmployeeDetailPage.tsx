import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Users, RefreshCw, ArrowLeft } from "lucide-react";
import type { HrEmployeeDetail } from "@mediaos/contracts";
import { hrApi, hrKeys, useCan, formatDate } from "@mediaos/web-core";
import { PageHeader, EmptyState, Button, Card, CardContent } from "@mediaos/ui";
import { HR_ENGINE_PAIRS } from "../constants";
import { EmployeeStatusBadge } from "../employee-status";

// ---------------------------------------------------------------------------
// Field row — label + value with masked fallback
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
// Tab types
// ---------------------------------------------------------------------------
type Tab = "overview" | "personal" | "work";

// ---------------------------------------------------------------------------
// Overview tab
// ---------------------------------------------------------------------------
function OverviewTab({
  employee,
  t,
  canViewSensitive,
  canViewSalary,
}: {
  employee: HrEmployeeDetail;
  t: ReturnType<typeof useTranslation<"hr">>["t"];
  canViewSensitive: boolean;
  canViewSalary: boolean;
}) {
  const masked = t("detail.masked");
  return (
    <Card>
      <CardContent className="divide-y divide-border pt-4">
        <FieldRow label={t("detail.fields.code")} value={employee.employeeCode} />
        <FieldRow label={t("detail.fields.name")} value={employee.fullName} />
        <FieldRow label={t("detail.fields.email")} value={employee.email} />
        <FieldRow label={t("detail.fields.department")} value={employee.orgUnitName} />
        <FieldRow label={t("detail.fields.position")} value={employee.positionName} />
        <FieldRow
          label={t("detail.fields.status")}
          value={<EmployeeStatusBadge status={employee.status} />}
        />
        <FieldRow
          label={t("detail.fields.startDate")}
          value={employee.startDate ? formatDate(new Date(employee.startDate)) : "—"}
        />
        {/* Sensitive: phone — server already masks; client renders what it receives */}
        <FieldRow
          label={t("detail.sensitiveFields.phone")}
          value={
            canViewSensitive
              ? (employee.phone ?? "—")
              : employee.phone !== null
                ? employee.phone
                : masked
          }
        />
        {/* Sensitive: baseSalary */}
        <FieldRow
          label={t("detail.sensitiveFields.baseSalary")}
          value={
            canViewSalary
              ? employee.baseSalary !== null
                ? `${employee.baseSalary.toLocaleString("vi-VN")} ₫`
                : "—"
              : employee.baseSalary !== null
                ? `${employee.baseSalary.toLocaleString("vi-VN")} ₫`
                : masked
          }
        />
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Personal tab
// ---------------------------------------------------------------------------
function PersonalTab({
  employee,
  t,
  canViewSensitive,
}: {
  employee: HrEmployeeDetail;
  t: ReturnType<typeof useTranslation<"hr">>["t"];
  canViewSensitive: boolean;
}) {
  const masked = t("detail.masked");
  return (
    <Card>
      <CardContent className="divide-y divide-border pt-4">
        <FieldRow label={t("detail.fields.email")} value={employee.email} />
        {/* phone — rendered exactly as server returns; null when unauthorized */}
        <FieldRow
          label={t("detail.sensitiveFields.phone")}
          value={employee.phone !== null ? employee.phone : canViewSensitive ? "—" : masked}
        />
        {/* notes */}
        <FieldRow
          label={t("detail.sensitiveFields.notes")}
          value={employee.notes !== null ? employee.notes : canViewSensitive ? "—" : masked}
        />
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Work tab
// ---------------------------------------------------------------------------
function WorkTab({
  employee,
  t,
  canViewSensitive,
}: {
  employee: HrEmployeeDetail;
  t: ReturnType<typeof useTranslation<"hr">>["t"];
  canViewSensitive: boolean;
}) {
  const masked = t("detail.masked");
  return (
    <Card>
      <CardContent className="divide-y divide-border pt-4">
        <FieldRow label={t("detail.fields.department")} value={employee.orgUnitName} />
        <FieldRow label={t("detail.fields.position")} value={employee.positionName} />
        <FieldRow label={t("detail.fields.workType")} value={employee.workType} />
        <FieldRow
          label={t("detail.fields.startDate")}
          value={employee.startDate ? formatDate(new Date(employee.startDate)) : "—"}
        />
        <FieldRow
          label={t("detail.fields.endDate")}
          value={employee.endDate ? formatDate(new Date(employee.endDate)) : "—"}
        />
        {/* contractType — sensitive */}
        <FieldRow
          label={t("detail.sensitiveFields.contractType")}
          value={
            employee.contractType !== null ? employee.contractType : canViewSensitive ? "—" : masked
          }
        />
        <FieldRow
          label={t("detail.fields.status")}
          value={<EmployeeStatusBadge status={employee.status} />}
        />
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
interface EmployeeDetailPageProps {
  employeeId: string;
  onBack?: () => void;
}

export function EmployeeDetailPage({ employeeId, onBack }: EmployeeDetailPageProps) {
  const { t } = useTranslation("hr");
  const { t: tc } = useTranslation("common");
  const [activeTab, setActiveTab] = useState<Tab>("overview");

  const canView = useCan(
    HR_ENGINE_PAIRS.READ_EMPLOYEE.action,
    HR_ENGINE_PAIRS.READ_EMPLOYEE.resourceType,
  );
  const canViewSensitive = useCan(
    HR_ENGINE_PAIRS.VIEW_SENSITIVE.action,
    HR_ENGINE_PAIRS.VIEW_SENSITIVE.resourceType,
  );
  const canViewSalary = useCan(
    HR_ENGINE_PAIRS.VIEW_SALARY.action,
    HR_ENGINE_PAIRS.VIEW_SALARY.resourceType,
  );

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: hrKeys.employees.detail(employeeId),
    queryFn: () => hrApi.getEmployee(employeeId),
    enabled: canView && !!employeeId,
    staleTime: 30_000,
    // Retry controlled by QueryClient default (retry:false in tests, 3 in prod).
    // 403/404 are definitive — caller (QueryClient config or error boundary) should not retry them.
  });

  const TABS: { key: Tab; label: string }[] = [
    { key: "overview", label: t("detail.tabs.overview") },
    { key: "personal", label: t("detail.tabs.personal") },
    { key: "work", label: t("detail.tabs.work") },
  ];

  // ── Forbidden ──────────────────────────────────────────────────────────────
  if (!canView) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("employees.forbidden.title")}
          description={t("employees.forbidden.description")}
        />
      </div>
    );
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-6 p-6">
        <PageHeader title={tc("loading")} icon={Users} />
        <div className="h-48 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }

  // ── Error / not found ──────────────────────────────────────────────────────
  if (isError || !data) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("detail.error.title")}
          description={t("detail.error.description")}
          action={
            <div className="flex gap-2">
              {onBack && (
                <Button variant="outline" size="sm" onClick={onBack}>
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  {t("detail.backToList")}
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => void refetch()}>
                <RefreshCw className="mr-2 h-4 w-4" />
                {tc("actions.retry")}
              </Button>
            </div>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={data.fullName ?? "—"}
        description={`${t("detail.fields.code")}: ${data.employeeCode ?? "—"}`}
        icon={Users}
        actions={
          onBack ? (
            <Button variant="outline" size="sm" onClick={onBack}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              {t("detail.backToList")}
            </Button>
          ) : undefined
        }
      />

      {/* Tab navigation */}
      <div className="flex gap-1 border-b border-border">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={[
              "px-4 py-2 text-sm font-medium transition-colors",
              activeTab === tab.key
                ? "border-b-2 border-brand text-brand"
                : "text-muted-foreground hover:text-foreground",
            ].join(" ")}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "overview" && (
        <OverviewTab
          employee={data}
          t={t}
          canViewSensitive={canViewSensitive}
          canViewSalary={canViewSalary}
        />
      )}
      {activeTab === "personal" && (
        <PersonalTab employee={data} t={t} canViewSensitive={canViewSensitive} />
      )}
      {activeTab === "work" && (
        <WorkTab employee={data} t={t} canViewSensitive={canViewSensitive} />
      )}
    </div>
  );
}
