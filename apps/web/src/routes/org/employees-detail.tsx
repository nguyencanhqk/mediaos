import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type { EmployeeProfileDto } from "@mediaos/contracts";
import { employeesApi } from "@/lib/employees-api";

// ── Nhãn enum (vi) ─────────────────────────────────────────────────────────────

/**
 * Định dạng lương theo quyền (mask phía SERVER — FE chỉ render gì nhận được).
 * `null` = không có quyền xem → đúng chữ theo §6/§11. number = có quyền.
 */
function formatSalary(baseSalary: number | null, t: TFunction<"org">): string {
  if (baseSalary == null) return t("employees.salaryHidden");
  return `${baseSalary.toLocaleString("vi-VN")} ₫`;
}

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

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold">
            {employee.userFullName ?? employee.userEmail ?? employee.userId}
          </h1>
          {employee.employeeCode && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
              {employee.employeeCode}
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {employee.positionName ?? "—"}
          {employee.orgUnitName ? ` · ${employee.orgUnitName}` : ""}
          {` · ${t(`employeeDetail.statusLabels.${employee.status}`, { defaultValue: employee.status })}`}
        </p>
      </header>

      <div role="tablist" className="flex flex-wrap gap-1 border-b border-border">
        {TAB_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`tab-${key}`}
            aria-selected={tab === key}
            // Chỉ panel của tab đang chọn tồn tại trong DOM → aria-controls chỉ trỏ khi active.
            aria-controls={tab === key ? `panel-${key}` : undefined}
            onClick={() => setTab(key)}
            className={
              tab === key
                ? "border-b-2 border-primary px-4 py-2 text-sm font-medium text-primary"
                : "px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
            }
          >
            {t(`employeeDetail.tabs.${key}`, { defaultValue: key })}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "overview" && <OverviewTab employee={employee} t={t} />}
        {tab === "work" && <WorkTab employee={employee} t={t} />}
        {tab === "team" && (
          <Placeholder text={t("employeeDetail.placeholders.team")} />
        )}
        {tab === "task" && (
          <Placeholder text={t("employeeDetail.placeholders.task")} />
        )}
        {tab === "kpi" && <Placeholder text={t("employeeDetail.placeholders.kpi")} />}
        {tab === "salary" && <SalaryTab employee={employee} t={t} />}
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
    <dl className="grid grid-cols-2 gap-4 text-sm">
      <Field label={t("employeeDetail.fields.fullName")} value={employee.userFullName ?? "—"} />
      <Field label={t("employeeDetail.fields.email")} value={employee.userEmail ?? "—"} />
      <Field label={t("employeeDetail.fields.employeeCode")} value={employee.employeeCode ?? "—"} />
      <Field label={t("employeeDetail.fields.phone")} value={employee.phone ?? "—"} />
      <Field label={t("employeeDetail.fields.workType")} value={t(`employeeDetail.workType.${employee.workType}`, { defaultValue: employee.workType })} />
      <Field label={t("employeeDetail.fields.status")} value={t(`employeeDetail.statusLabels.${employee.status}`, { defaultValue: employee.status })} />
      {employee.notes && <Field label={t("employeeDetail.fields.notes")} value={employee.notes} />}
    </dl>
  );
}

function WorkTab({ employee, t }: TabProps) {
  return (
    <dl className="grid grid-cols-2 gap-4 text-sm">
      <Field label={t("employeeDetail.fields.orgUnit")} value={employee.orgUnitName ?? "—"} />
      <Field label={t("employeeDetail.fields.position")} value={employee.positionName ?? "—"} />
      <Field label={t("employeeDetail.fields.directManager")} value={employee.directManagerName ?? "—"} />
      <Field
        label={t("employeeDetail.fields.employmentType")}
        value={t(`employeeDetail.employmentType.${employee.employmentType}`, { defaultValue: employee.employmentType })}
      />
      <Field label={t("employeeDetail.fields.contractType")} value={employee.contractType ?? "—"} />
      <Field label={t("employeeDetail.fields.salaryType")} value={t(`employeeDetail.salaryType.${employee.salaryType}`, { defaultValue: employee.salaryType })} />
      <Field label={t("employeeDetail.fields.startDate")} value={employee.startDate ?? "—"} />
      <Field label={t("employeeDetail.fields.endDate")} value={employee.endDate ?? "—"} />
    </dl>
  );
}

function SalaryTab({ employee, t }: TabProps) {
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-2 gap-4 text-sm">
        <Field label={t("employeeDetail.fields.baseSalary")} value={formatSalary(employee.baseSalary, t)} />
        <Field label={t("employeeDetail.fields.salaryType")} value={t(`employeeDetail.salaryType.${employee.salaryType}`, { defaultValue: employee.salaryType })} />
      </dl>
      <p className="text-sm text-muted-foreground">
        {t("employeeDetail.placeholders.salaryHistory")}
      </p>
    </div>
  );
}

function Placeholder({ text }: { text: string }) {
  return <p className="text-sm text-muted-foreground">{text}</p>;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
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
    <div className="mx-auto max-w-4xl space-y-6 p-8">
      <Link to="/org/employees" className="text-sm text-muted-foreground hover:underline">
        {t("employees.back")}
      </Link>

      {isLoading && <p className="text-sm text-muted-foreground">{t("common:loading")}</p>}
      {isError && <p className="text-sm text-destructive">{t("employees.loadProfileError")}</p>}
      {data && <EmployeeDetailView employee={data} />}
    </div>
  );
}
