import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import type { EmployeeProfileDto } from "@mediaos/contracts";
import { employeesApi } from "@/lib/employees-api";

// ── Nhãn enum (vi) ─────────────────────────────────────────────────────────────

const WORK_TYPE_LABELS: Record<EmployeeProfileDto["workType"], string> = {
  offline: "Tại văn phòng",
  remote: "Từ xa",
  hybrid: "Linh hoạt",
};

const EMPLOYMENT_TYPE_LABELS: Record<EmployeeProfileDto["employmentType"], string> = {
  full_time: "Toàn thời gian",
  part_time: "Bán thời gian",
  freelancer: "Freelancer",
  intern: "Thực tập",
  probation: "Thử việc",
};

const SALARY_TYPE_LABELS: Record<EmployeeProfileDto["salaryType"], string> = {
  monthly: "Theo tháng",
  hourly: "Theo giờ",
  project: "Theo dự án",
};

const STATUS_LABELS: Record<EmployeeProfileDto["status"], string> = {
  active: "Đang làm",
  inactive: "Tạm ngưng",
  resigned: "Đã nghỉ",
  terminated: "Chấm dứt",
};

/**
 * Định dạng lương theo quyền (mask phía SERVER — FE chỉ render gì nhận được).
 * `null` = không có quyền xem → đúng chữ theo §6/§11. number = có quyền.
 */
function formatSalary(baseSalary: number | null): string {
  if (baseSalary == null) return "— (Không có quyền xem)";
  return `${baseSalary.toLocaleString("vi-VN")} ₫`;
}

// ── Tabs ───────────────────────────────────────────────────────────────────────

type TabKey = "overview" | "work" | "team" | "task" | "kpi" | "salary";

const TABS: { key: TabKey; label: string }[] = [
  { key: "overview", label: "Tổng quan" },
  { key: "work", label: "Công việc" },
  { key: "team", label: "Team/Project" },
  { key: "task", label: "Task" },
  { key: "kpi", label: "KPI" },
  { key: "salary", label: "Lương" },
];

interface EmployeeDetailViewProps {
  employee: EmployeeProfileDto;
}

/** Presentational — nhận sẵn DTO (đã mask), không tự fetch. Dễ test cô lập. */
export function EmployeeDetailView({ employee }: EmployeeDetailViewProps) {
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
          {` · ${STATUS_LABELS[employee.status]}`}
        </p>
      </header>

      <div role="tablist" className="flex flex-wrap gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            id={`tab-${t.key}`}
            aria-selected={tab === t.key}
            // Chỉ panel của tab đang chọn tồn tại trong DOM → aria-controls chỉ trỏ khi active.
            aria-controls={tab === t.key ? `panel-${t.key}` : undefined}
            onClick={() => setTab(t.key)}
            className={
              tab === t.key
                ? "border-b-2 border-primary px-4 py-2 text-sm font-medium text-primary"
                : "px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "overview" && <OverviewTab employee={employee} />}
        {tab === "work" && <WorkTab employee={employee} />}
        {tab === "team" && (
          <Placeholder text="Thông tin team / dự án sẽ hiển thị khi tích hợp module Team." />
        )}
        {tab === "task" && (
          <Placeholder text="Danh sách công việc của nhân sự sẽ hiển thị khi tích hợp module Task." />
        )}
        {tab === "kpi" && <Placeholder text="KPI — Sẽ có ở G8." />}
        {tab === "salary" && <SalaryTab employee={employee} />}
      </div>
    </div>
  );
}

// ── Panels ─────────────────────────────────────────────────────────────────────

function OverviewTab({ employee }: EmployeeDetailViewProps) {
  return (
    <dl className="grid grid-cols-2 gap-4 text-sm">
      <Field label="Họ tên" value={employee.userFullName ?? "—"} />
      <Field label="Email" value={employee.userEmail ?? "—"} />
      <Field label="Mã nhân sự" value={employee.employeeCode ?? "—"} />
      <Field label="Số điện thoại" value={employee.phone ?? "—"} />
      <Field label="Hình thức làm việc" value={WORK_TYPE_LABELS[employee.workType]} />
      <Field label="Trạng thái" value={STATUS_LABELS[employee.status]} />
      {employee.notes && <Field label="Ghi chú" value={employee.notes} />}
    </dl>
  );
}

function WorkTab({ employee }: EmployeeDetailViewProps) {
  return (
    <dl className="grid grid-cols-2 gap-4 text-sm">
      <Field label="Phòng ban" value={employee.orgUnitName ?? "—"} />
      <Field label="Chức vụ" value={employee.positionName ?? "—"} />
      <Field label="Quản lý trực tiếp" value={employee.directManagerName ?? "—"} />
      <Field
        label="Loại hợp đồng lao động"
        value={EMPLOYMENT_TYPE_LABELS[employee.employmentType]}
      />
      <Field label="Loại hợp đồng" value={employee.contractType ?? "—"} />
      <Field label="Hình thức lương" value={SALARY_TYPE_LABELS[employee.salaryType]} />
      <Field label="Ngày bắt đầu" value={employee.startDate ?? "—"} />
      <Field label="Ngày kết thúc" value={employee.endDate ?? "—"} />
    </dl>
  );
}

function SalaryTab({ employee }: EmployeeDetailViewProps) {
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-2 gap-4 text-sm">
        <Field label="Lương cơ bản" value={formatSalary(employee.baseSalary)} />
        <Field label="Hình thức lương" value={SALARY_TYPE_LABELS[employee.salaryType]} />
      </dl>
      <p className="text-sm text-muted-foreground">
        Bảng lương chi tiết &amp; lịch sử chi trả — Sẽ có ở G12.
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
        ← Danh sách nhân sự
      </Link>

      {isLoading && <p className="text-sm text-muted-foreground">Đang tải…</p>}
      {isError && <p className="text-sm text-destructive">Không tải được hồ sơ nhân sự.</p>}
      {data && <EmployeeDetailView employee={data} />}
    </div>
  );
}
