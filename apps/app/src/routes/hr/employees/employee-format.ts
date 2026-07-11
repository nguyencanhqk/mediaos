import {
  addMonths,
  addYears,
  differenceInDays,
  differenceInMonths,
  differenceInYears,
} from "date-fns";
import type { useTranslation } from "react-i18next";

type TF = ReturnType<typeof useTranslation<"hr">>["t"];

/** Thâm niên tính từ ngày vào làm → "1 năm 5 tháng 11 ngày". Không có/không hợp lệ → null. */
export function formatSeniority(startDate: string | null | undefined, t: TF): string | null {
  if (!startDate) return null;
  const start = new Date(startDate);
  const now = new Date();
  if (Number.isNaN(start.getTime()) || start > now) return null;

  const years = differenceInYears(now, start);
  const months = differenceInMonths(now, start) - years * 12;
  const anchor = addMonths(addYears(start, years), months);
  const days = differenceInDays(now, anchor);

  const parts: string[] = [];
  if (years > 0) parts.push(t("employees.seniority.years", { count: years }));
  if (months > 0) parts.push(t("employees.seniority.months", { count: months }));
  if (days > 0 || parts.length === 0) parts.push(t("employees.seniority.days", { count: days }));
  return parts.join(" ");
}

const GENDER_KEYS = new Set(["Male", "Female", "Other", "unknown"]);

/** Nhãn giới tính theo giá trị DB (Male/Female/Other). Giá trị lạ → trả nguyên văn. */
export function genderLabel(gender: string | null | undefined, t: TF): string | null {
  if (!gender) return null;
  return GENDER_KEYS.has(gender) ? t(`employees.gender.${gender}`) : gender;
}

const MARITAL_KEYS = new Set(["single", "married", "other"]);

/** Nhãn tình trạng hôn nhân (single/married/other). Giá trị lạ → trả nguyên văn. */
export function maritalStatusLabel(status: string | null | undefined, t: TF): string | null {
  if (!status) return null;
  return MARITAL_KEYS.has(status) ? t(`detail.maritalStatus.${status}`) : status;
}

const WORK_TYPE_KEYS = new Set(["offline", "remote", "hybrid"]);
const EMPLOYMENT_TYPE_KEYS = new Set([
  "full_time",
  "part_time",
  "freelancer",
  "intern",
  "probation",
]);
const SALARY_TYPE_KEYS = new Set(["monthly", "hourly", "project"]);

export function workTypeLabel(value: string | null | undefined, t: TF): string | null {
  if (!value) return null;
  return WORK_TYPE_KEYS.has(value) ? t(`form.workType.${value}`) : value;
}

export function employmentTypeLabel(value: string | null | undefined, t: TF): string | null {
  if (!value) return null;
  return EMPLOYMENT_TYPE_KEYS.has(value) ? t(`form.employmentType.${value}`) : value;
}

export function salaryTypeLabel(value: string | null | undefined, t: TF): string | null {
  if (!value) return null;
  return SALARY_TYPE_KEYS.has(value) ? t(`form.salaryType.${value}`) : value;
}
