import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { EmployeeProfileDto } from "@mediaos/contracts";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { employeesApi } from "@/lib/employees-api";
import { EMPLOYEE_STATUS_VARIANT, formatSalary } from "@/lib/employee-format";
import { cn } from "@/lib/utils";

// ── Tabs ───────────────────────────────────────────────────────────────────────

type TabKey = "overview" | "work" | "team" | "task" | "kpi" | "salary";

const TAB_KEYS: TabKey[] = ["overview", "work", "team", "task", "kpi", "salary"];

interface EmployeeDetailViewProps {
  employee: EmployeeProfileDto;
}

/** Presentational — nhận sẵn DTO (đã mask), không tự fetch. Dễ test cô lập. */
export function EmployeeDetailView({ employee }: EmployeeDetailViewProps) {
  const { t } = useTranslation("org");
  const [tab, setTab] = useState<TabKey>("overview");

  const name = employee.userFullName ?? employee.userEmail ?? employee.userId;
  const statusLabel = t(`employeeDetail.statusLabels.${employee.status}`, {
    defaultValue: employee.status,
  });

  return (
    <div className="space-y-6">
      {/* Header hồ sơ */}
      <Card className="p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <Avatar name={name} src={employee.avatarUrl} size="lg" className="h-16 w-16 text-xl" />
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight text-foreground">{name}</h1>
              {employee.employeeCode && (
                <Badge variant="muted" className="font-normal">
                  {employee.employeeCode}
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {employee.positionName ?? "—"}
              {employee.orgUnitName ? ` · ${employee.orgUnitName}` : ""}
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              <Badge variant={EMPLOYEE_STATUS_VARIANT[employee.status]}>{statusLabel}</Badge>
              <span className="text-xs text-muted-foreground">
                {t(`employeeDetail.employmentType.${employee.employmentType}`, {
                  defaultValue: employee.employmentType,
                })}
              </span>
            </div>
          </div>
        </div>
      </Card>

      {/* Tab rail + panel (MISA: menu mục bên trái, nội dung bên phải) */}
      <div className="grid gap-6 lg:grid-cols-[200px_1fr]">
        <nav
          role="tablist"
          aria-orientation="vertical"
          aria-label={t("employees.title")}
          className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0"
        >
          {TAB_KEYS.map((key) => {
            const selected = tab === key;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                id={`tab-${key}`}
                aria-selected={selected}
                aria-controls={selected ? `panel-${key}` : undefined}
                onClick={() => setTab(key)}
                className={cn(
                  "shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm transition-colors lg:shrink",
                  selected
                    ? "bg-brand-muted font-medium text-brand"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {t(`employeeDetail.tabs.${key}`, { defaultValue: key })}
              </button>
            );
          })}
        </nav>

        <Card role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="p-6">
          {tab === "overview" && <OverviewTab employee={employee} t={t} />}
          {tab === "work" && <WorkTab employee={employee} t={t} />}
          {tab === "team" && <Placeholder text={t("employeeDetail.placeholders.team")} />}
          {tab === "task" && <Placeholder text={t("employeeDetail.placeholders.task")} />}
          {tab === "kpi" && <Placeholder text={t("employeeDetail.placeholders.kpi")} />}
          {tab === "salary" && <SalaryTab employee={employee} t={t} />}
        </Card>
      </div>
    </div>
  );
}

// ── Panels ─────────────────────────────────────────────────────────────────────

interface TabProps extends EmployeeDetailViewProps {
  t: TFunction<"org">;
}

function OverviewTab({ employee, t }: TabProps) {
  return (
    <FieldGrid>
      <Field label={t("employeeDetail.fields.fullName")} value={employee.userFullName ?? "—"} />
      <Field label={t("employeeDetail.fields.email")} value={employee.userEmail ?? "—"} />
      <Field label={t("employeeDetail.fields.employeeCode")} value={employee.employeeCode ?? "—"} />
      <Field label={t("employeeDetail.fields.phone")} value={employee.phone ?? "—"} />
      <Field
        label={t("employeeDetail.fields.workType")}
        value={t(`employeeDetail.workType.${employee.workType}`, { defaultValue: employee.workType })}
      />
      <Field
        label={t("employeeDetail.fields.status")}
        value={t(`employeeDetail.statusLabels.${employee.status}`, {
          defaultValue: employee.status,
        })}
      />
      {employee.notes && (
        <Field label={t("employeeDetail.fields.notes")} value={employee.notes} className="sm:col-span-2" />
      )}
    </FieldGrid>
  );
}

function WorkTab({ employee, t }: TabProps) {
  return (
    <FieldGrid>
      <Field label={t("employeeDetail.fields.orgUnit")} value={employee.orgUnitName ?? "—"} />
      <Field label={t("employeeDetail.fields.position")} value={employee.positionName ?? "—"} />
      <Field
        label={t("employeeDetail.fields.directManager")}
        value={employee.directManagerName ?? "—"}
      />
      <Field
        label={t("employeeDetail.fields.employmentType")}
        value={t(`employeeDetail.employmentType.${employee.employmentType}`, {
          defaultValue: employee.employmentType,
        })}
      />
      <Field label={t("employeeDetail.fields.contractType")} value={employee.contractType ?? "—"} />
      <Field
        label={t("employeeDetail.fields.salaryType")}
        value={t(`employeeDetail.salaryType.${employee.salaryType}`, {
          defaultValue: employee.salaryType,
        })}
      />
      <Field label={t("employeeDetail.fields.startDate")} value={employee.startDate ?? "—"} />
      <Field label={t("employeeDetail.fields.endDate")} value={employee.endDate ?? "—"} />
    </FieldGrid>
  );
}

function SalaryTab({ employee, t }: TabProps) {
  return (
    <div className="space-y-4">
      <FieldGrid>
        <Field
          label={t("employeeDetail.fields.baseSalary")}
          value={formatSalary(employee.baseSalary, t)}
        />
        <Field
          label={t("employeeDetail.fields.salaryType")}
          value={t(`employeeDetail.salaryType.${employee.salaryType}`, {
            defaultValue: employee.salaryType,
          })}
        />
      </FieldGrid>
      <p className="text-sm text-muted-foreground">
        {t("employeeDetail.placeholders.salaryHistory")}
      </p>
    </div>
  );
}

function Placeholder({ text }: { text: string }) {
  return <p className="text-sm text-muted-foreground">{text}</p>;
}

function FieldGrid({ children }: { children: React.ReactNode }) {
  return <dl className="grid grid-cols-1 gap-x-8 gap-y-5 text-sm sm:grid-cols-2">{children}</dl>;
}

function Field({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1", className)}>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="font-medium text-foreground">{value}</dd>
    </div>
  );
}

// ── Container (route /org/employees/$employeeId — đăng ký router do phiên tích hợp lo) ──

export function EmployeeDetailPage() {
  const { t } = useTranslation("org");
  // strict:false để decouple khỏi route tree (route được đăng ký ở phiên tích hợp).
  const params = useParams({ strict: false }) as { employeeId?: string };
  const employeeId = params.employeeId ?? "";

  const { data, isLoading, isError } = useQuery({
    queryKey: ["employees", employeeId],
    queryFn: () => employeesApi.getOne(employeeId),
    enabled: Boolean(employeeId),
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6 sm:p-8">
      <Link
        to="/org/employees"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        {t("employees.back")}
      </Link>

      {isLoading && <DetailSkeleton />}
      {isError && (
        <Card className="border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {t("employees.loadProfileError")}
        </Card>
      )}
      {data && <EmployeeDetailView employee={data} />}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-6">
      <Card className="flex items-center gap-4 p-6">
        <Skeleton className="h-16 w-16 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-5 w-24" />
        </div>
      </Card>
      <div className="grid gap-6 lg:grid-cols-[200px_1fr]">
        <Skeleton className="h-40 w-full" />
        <Card className="space-y-5 p-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </Card>
      </div>
    </div>
  );
}
