import React from "react";
import type { HrEmployeeDetail } from "@mediaos/contracts";
import { formatDate } from "@mediaos/web-core";
import { Card, CardContent } from "@mediaos/ui";
import type { useTranslation } from "react-i18next";
import { EmployeeStatusBadge } from "../employee-status";
import {
  employmentTypeLabel,
  formatSeniority,
  genderLabel,
  maritalStatusLabel,
  salaryTypeLabel,
  workTypeLabel,
} from "./employee-format";

type TF = ReturnType<typeof useTranslation<"hr">>["t"];

/**
 * HR-PROFILE-UI-1 — section hồ sơ dùng chung cho EmployeeDetailPage (route riêng) và
 * EmployeeProfilePanel (split view). Masking là việc của SERVER: field PII null + caller
 * thiếu view-sensitive → hiện nhãn "bị ẩn do phân quyền"; có quyền mà null → "—".
 */

export function FieldRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[180px_1fr] gap-2 py-2 text-sm">
      <span className="font-medium text-muted-foreground">{label}</span>
      <span className="text-foreground">{value ?? "—"}</span>
    </div>
  );
}

export function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <h3 className="mb-1 text-sm font-semibold text-foreground">{title}</h3>
        <div className="divide-y divide-border">{children}</div>
      </CardContent>
    </Card>
  );
}

/** Giá trị PII: server mask → null. Có quyền + null = chưa khai ("—"); thiếu quyền = nhãn masked. */
function pii(value: string | null, canViewSensitive: boolean, masked: string): string {
  if (value !== null) return value;
  return canViewSensitive ? "—" : masked;
}

interface SectionProps {
  employee: HrEmployeeDetail;
  t: TF;
  canViewSensitive: boolean;
}

// ── Tab "Thông tin cơ bản" ──────────────────────────────────────────────────────

export function BasicInfoSection({ employee, t, canViewSensitive }: SectionProps) {
  const masked = t("detail.masked");
  return (
    <div className="space-y-4">
      <SectionCard title={t("detail.groups.general")}>
        <FieldRow label={t("detail.fields.code")} value={employee.employeeCode} />
        <FieldRow label={t("detail.fields.name")} value={employee.fullName} />
        <FieldRow
          label={t("detail.fields.status")}
          value={<EmployeeStatusBadge status={employee.status} />}
        />
      </SectionCard>
      <SectionCard title={t("detail.groups.personal")}>
        <FieldRow
          label={t("detail.fields.gender")}
          value={pii(genderLabel(employee.gender, t), canViewSensitive, masked)}
        />
        <FieldRow
          label={t("detail.fields.dateOfBirth")}
          value={pii(
            employee.dateOfBirth ? formatDate(new Date(employee.dateOfBirth)) : null,
            canViewSensitive,
            masked,
          )}
        />
        <FieldRow
          label={t("detail.fields.maritalStatus")}
          value={pii(maritalStatusLabel(employee.maritalStatus, t), canViewSensitive, masked)}
        />
        {/* HR-PROFILE-UI-1b — nhóm nhân khẩu (personal_extra JSONB, server mask NGUYÊN KHỐI) + MST */}
        <FieldRow
          label={t("detail.fields.placeOfBirth")}
          value={pii(employee.personalExtra?.placeOfBirth ?? null, canViewSensitive, masked)}
        />
        <FieldRow
          label={t("detail.fields.nativePlace")}
          value={pii(employee.personalExtra?.nativePlace ?? null, canViewSensitive, masked)}
        />
        <FieldRow
          label={t("detail.fields.ethnicity")}
          value={pii(employee.personalExtra?.ethnicity ?? null, canViewSensitive, masked)}
        />
        <FieldRow
          label={t("detail.fields.religion")}
          value={pii(employee.personalExtra?.religion ?? null, canViewSensitive, masked)}
        />
        <FieldRow
          label={t("detail.fields.nationality")}
          value={pii(employee.personalExtra?.nationality ?? null, canViewSensitive, masked)}
        />
        <FieldRow
          label={t("detail.fields.taxCode")}
          value={pii(employee.taxCode, canViewSensitive, masked)}
        />
      </SectionCard>
    </div>
  );
}

// ── Tab "Thông tin liên hệ" ─────────────────────────────────────────────────────

export function ContactSection({ employee, t, canViewSensitive }: SectionProps) {
  const masked = t("detail.masked");
  return (
    <div className="space-y-4">
      <SectionCard title={t("detail.groups.contact")}>
        <FieldRow label={t("detail.fields.email")} value={employee.email} />
        <FieldRow
          label={t("detail.fields.personalEmail")}
          value={pii(employee.personalEmail, canViewSensitive, masked)}
        />
        <FieldRow
          label={t("detail.sensitiveFields.phone")}
          value={pii(employee.phone, canViewSensitive, masked)}
        />
      </SectionCard>
      <SectionCard title={t("detail.groups.address")}>
        <FieldRow
          label={t("detail.fields.currentAddress")}
          value={pii(employee.currentAddress, canViewSensitive, masked)}
        />
        <FieldRow
          label={t("detail.fields.permanentAddress")}
          value={pii(employee.permanentAddress, canViewSensitive, masked)}
        />
      </SectionCard>
      <SectionCard title={t("detail.groups.emergency")}>
        <FieldRow
          label={t("detail.fields.emergencyContactName")}
          value={pii(employee.emergencyContactName, canViewSensitive, masked)}
        />
        <FieldRow
          label={t("detail.fields.emergencyContactPhone")}
          value={pii(employee.emergencyContactPhone, canViewSensitive, masked)}
        />
        <FieldRow
          label={t("detail.sensitiveFields.notes")}
          value={pii(employee.notes, canViewSensitive, masked)}
        />
      </SectionCard>
    </div>
  );
}

// ── Tab "Công việc" ─────────────────────────────────────────────────────────────

export function WorkInfoSection({ employee, t, canViewSensitive }: SectionProps) {
  const masked = t("detail.masked");
  return (
    <div className="space-y-4">
      <SectionCard title={t("detail.groups.job")}>
        <FieldRow label={t("detail.fields.department")} value={employee.orgUnitName} />
        <FieldRow label={t("detail.fields.position")} value={employee.positionName} />
        <FieldRow label={t("detail.fields.workType")} value={workTypeLabel(employee.workType, t)} />
        <FieldRow
          label={t("detail.fields.employmentType")}
          value={employmentTypeLabel(employee.employmentType, t)}
        />
        <FieldRow
          label={t("detail.fields.startDate")}
          value={employee.startDate ? formatDate(new Date(employee.startDate)) : "—"}
        />
        {/* HR-PROFILE-UI-1b — mốc thử việc/chính thức + nơi làm việc (directory-class) */}
        <FieldRow
          label={t("detail.fields.probationEndDate")}
          value={employee.probationEndDate ? formatDate(new Date(employee.probationEndDate)) : "—"}
        />
        <FieldRow
          label={t("detail.fields.officialDate")}
          value={employee.officialDate ? formatDate(new Date(employee.officialDate)) : "—"}
        />
        <FieldRow label={t("detail.fields.workLocation")} value={employee.workLocation} />
        <FieldRow
          label={t("detail.fields.endDate")}
          value={employee.endDate ? formatDate(new Date(employee.endDate)) : "—"}
        />
        <FieldRow
          label={t("detail.fields.seniority")}
          value={formatSeniority(employee.startDate, t)}
        />
        <FieldRow
          label={t("detail.sensitiveFields.contractType")}
          value={pii(employee.contractType, canViewSensitive, masked)}
        />
        <FieldRow
          label={t("detail.fields.status")}
          value={<EmployeeStatusBadge status={employee.status} />}
        />
      </SectionCard>
    </div>
  );
}

// ── Tab "Lương" (salary-class — view-salary) ────────────────────────────────────

export function CompSection({
  employee,
  t,
  canViewSalary,
}: {
  employee: HrEmployeeDetail;
  t: TF;
  canViewSalary: boolean;
}) {
  const masked = t("detail.masked");
  return (
    <SectionCard title={t("detail.groups.salary")}>
      <FieldRow
        label={t("detail.sensitiveFields.baseSalary")}
        value={
          employee.baseSalary !== null
            ? `${employee.baseSalary.toLocaleString("vi-VN")} ₫`
            : canViewSalary
              ? "—"
              : masked
        }
      />
      <FieldRow
        label={t("detail.fields.salaryType")}
        value={
          employee.salaryType !== null
            ? salaryTypeLabel(employee.salaryType, t)
            : canViewSalary
              ? "—"
              : masked
        }
      />
    </SectionCard>
  );
}
