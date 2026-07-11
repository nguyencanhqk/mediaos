import { type ColumnDef } from "@tanstack/react-table";
import { HR_EMPLOYEE_SORT_FIELDS, type HrEmployeeListItem } from "@mediaos/contracts";
import { formatDate } from "@mediaos/web-core";
import { Avatar } from "@mediaos/ui";
import type { useTranslation } from "react-i18next";
import { EmployeeStatusBadge } from "../employee-status";
import {
  formatSeniority,
  genderLabel,
  workTypeLabel,
  employmentTypeLabel,
} from "./employee-format";

type TF = ReturnType<typeof useTranslation<"hr">>["t"];

/**
 * HR-PROFILE-UI-1 — catalog cột của bảng hồ sơ nhân sự.
 * pii: cột chỉ có dữ liệu khi caller có view-sensitive (server mask → null); FE lọc khỏi
 * catalog khi thiếu quyền để không phơi cột toàn "—".
 * HR-PROFILE-UI-2 — groupable: cột được phép gom nhóm (đơn vị/trạng thái) trên panel Tùy chỉnh cột.
 */
export interface EmployeeColumnMeta {
  id: string;
  labelKey: string;
  defaultVisible: boolean;
  pii?: boolean;
  groupable?: boolean;
}

export const EMPLOYEE_COLUMN_CATALOG: EmployeeColumnMeta[] = [
  { id: "employeeCode", labelKey: "employees.columns.code", defaultVisible: true },
  { id: "fullName", labelKey: "employees.columns.name", defaultVisible: true },
  { id: "gender", labelKey: "employees.columns.gender", defaultVisible: true, pii: true },
  { id: "dateOfBirth", labelKey: "employees.columns.dateOfBirth", defaultVisible: true, pii: true },
  { id: "phone", labelKey: "employees.columns.phone", defaultVisible: true, pii: true },
  { id: "email", labelKey: "employees.columns.email", defaultVisible: true },
  { id: "positionName", labelKey: "employees.columns.position", defaultVisible: true },
  {
    id: "orgUnitName",
    labelKey: "employees.columns.department",
    defaultVisible: true,
    groupable: true,
  },
  { id: "startDate", labelKey: "employees.columns.startDate", defaultVisible: true },
  // HR-PROFILE-UI-1b — directory-class (mig 0489)
  { id: "officialDate", labelKey: "employees.columns.officialDate", defaultVisible: true },
  { id: "workLocation", labelKey: "employees.columns.workLocation", defaultVisible: false },
  {
    id: "contractType",
    labelKey: "employees.columns.contractType",
    defaultVisible: true,
    pii: true,
  },
  { id: "workType", labelKey: "employees.columns.workType", defaultVisible: false },
  { id: "employmentType", labelKey: "employees.columns.employmentType", defaultVisible: false },
  { id: "status", labelKey: "employees.columns.status", defaultVisible: true, groupable: true },
  { id: "seniority", labelKey: "employees.columns.seniority", defaultVisible: true },
];

/**
 * HR-PROFILE-UI-2 — cột được phép SẮP XẾP SERVER = allowlist HR_EMPLOYEE_SORT_FIELDS (contracts) — 1-1 với
 * ORDER BY allowlist ở repo (chống injection). Cột ngoài allowlist → enableSorting:false (không có header
 * click). Gom nhóm chỉ mở cho đơn vị/trạng thái.
 */
const SORTABLE_COLUMN_IDS = new Set<string>(HR_EMPLOYEE_SORT_FIELDS);
const GROUPABLE_COLUMN_IDS = new Set<string>(
  EMPLOYEE_COLUMN_CATALOG.filter((c) => c.groupable).map((c) => c.id),
);

/** Cột được phép gom nhóm (đơn vị/trạng thái) — dùng cho panel Tùy chỉnh cột. */
export const GROUPABLE_EMPLOYEE_COLUMNS = EMPLOYEE_COLUMN_CATALOG.filter((c) => c.groupable);

function dash(value: string | null | undefined): string {
  return value ?? "—";
}

/** id hiệu dụng của 1 ColumnDef (id tường minh, ngược lại suy từ accessorKey). */
function columnId(def: ColumnDef<HrEmployeeListItem>): string | undefined {
  if (def.id) return def.id;
  if ("accessorKey" in def && def.accessorKey) return String(def.accessorKey);
  return undefined;
}

/**
 * Toàn bộ ColumnDef — DataTable ẩn/hiện theo columnVisibility, KHÔNG cần build lại theo lựa chọn.
 * HR-PROFILE-UI-2: gắn enableSorting (allowlist sort-server) + enableGrouping (đơn vị/trạng thái) theo id.
 */
export function buildEmployeeColumns(t: TF): ColumnDef<HrEmployeeListItem>[] {
  const defs: ColumnDef<HrEmployeeListItem>[] = [
    {
      accessorKey: "employeeCode",
      header: t("employees.columns.code"),
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">
          {dash(row.original.employeeCode)}
        </span>
      ),
    },
    {
      accessorKey: "fullName",
      header: t("employees.columns.name"),
      cell: ({ row }) => (
        <span className="flex items-center gap-2">
          <Avatar size="sm" name={row.original.fullName} src={row.original.avatarUrl} />
          <span className="font-medium text-foreground">{dash(row.original.fullName)}</span>
        </span>
      ),
    },
    {
      accessorKey: "gender",
      header: t("employees.columns.gender"),
      cell: ({ row }) => (
        <span className="text-sm">{dash(genderLabel(row.original.gender, t))}</span>
      ),
    },
    {
      accessorKey: "dateOfBirth",
      header: t("employees.columns.dateOfBirth"),
      cell: ({ row }) => (
        <span className="text-sm tabular-nums">
          {row.original.dateOfBirth ? formatDate(new Date(row.original.dateOfBirth)) : "—"}
        </span>
      ),
    },
    {
      accessorKey: "phone",
      header: t("employees.columns.phone"),
      cell: ({ row }) => <span className="text-sm tabular-nums">{dash(row.original.phone)}</span>,
    },
    {
      accessorKey: "email",
      header: t("employees.columns.email"),
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">{dash(row.original.email)}</span>
      ),
    },
    {
      accessorKey: "positionName",
      header: t("employees.columns.position"),
      cell: ({ row }) => <span className="text-sm">{dash(row.original.positionName)}</span>,
    },
    {
      accessorKey: "orgUnitName",
      header: t("employees.columns.department"),
      cell: ({ row }) => <span className="text-sm">{dash(row.original.orgUnitName)}</span>,
    },
    {
      accessorKey: "startDate",
      header: t("employees.columns.startDate"),
      cell: ({ row }) => (
        <span className="text-sm tabular-nums">
          {row.original.startDate ? formatDate(new Date(row.original.startDate)) : "—"}
        </span>
      ),
    },
    {
      accessorKey: "officialDate",
      header: t("employees.columns.officialDate"),
      cell: ({ row }) => (
        <span className="text-sm tabular-nums">
          {row.original.officialDate ? formatDate(new Date(row.original.officialDate)) : "—"}
        </span>
      ),
    },
    {
      accessorKey: "workLocation",
      header: t("employees.columns.workLocation"),
      cell: ({ row }) => <span className="text-sm">{dash(row.original.workLocation)}</span>,
    },
    {
      accessorKey: "contractType",
      header: t("employees.columns.contractType"),
      cell: ({ row }) => <span className="text-sm">{dash(row.original.contractType)}</span>,
    },
    {
      accessorKey: "workType",
      header: t("employees.columns.workType"),
      cell: ({ row }) => (
        <span className="text-sm">{dash(workTypeLabel(row.original.workType, t))}</span>
      ),
    },
    {
      accessorKey: "employmentType",
      header: t("employees.columns.employmentType"),
      cell: ({ row }) => (
        <span className="text-sm">{dash(employmentTypeLabel(row.original.employmentType, t))}</span>
      ),
    },
    {
      accessorKey: "status",
      header: t("employees.columns.status"),
      cell: ({ row }) => <EmployeeStatusBadge status={row.original.status} />,
    },
    {
      id: "seniority",
      header: t("employees.columns.seniority"),
      accessorFn: (row) => formatSeniority(row.startDate, t) ?? "",
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {dash(formatSeniority(row.original.startDate, t))}
        </span>
      ),
    },
  ];

  // Gắn cờ theo allowlist: sort-server chỉ cho cột trong HR_EMPLOYEE_SORT_FIELDS; gom nhóm chỉ đơn vị/trạng thái.
  return defs.map((def) => {
    const id = columnId(def);
    return {
      ...def,
      enableSorting: id ? SORTABLE_COLUMN_IDS.has(id) : false,
      enableGrouping: id ? GROUPABLE_COLUMN_IDS.has(id) : false,
    };
  });
}
