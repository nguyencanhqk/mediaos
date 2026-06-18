import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { Search, Upload, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { EmployeeListItemDto, ImportEmployeePreviewDto } from "@mediaos/contracts";
import {
  Avatar,
  Badge,
  Button,
  DataTable,
  Dialog,
  EmptyState,
  Input,
  Select,
} from "@mediaos/ui";
import {
  EMPLOYEE_STATUS_VARIANT,
  type EmployeeStatus,
  useCan,
} from "@mediaos/web-core";
import { consoleEmployeesApi } from "@/lib/employees-api";
import { ObjectsImportPanel, type ImportStep } from "./objects-import-panel";
import { InvitesPanel } from "./invites-panel";

/**
 * CS-4 — Quản lý danh mục: Đối tượng (/system/objects).
 *
 * 2 tab: "Người dùng" (tài khoản) vs "Nhân viên" (hồ sơ).
 * Cùng dùng DataTable employees — tab "Người dùng" lọc cột tập trung vào tài khoản;
 * tab "Nhân viên" hiển thị toàn bộ hồ sơ. Dữ liệu từ cùng một /employees endpoint
 * (server-driven, RLS + withTenant).
 *
 * Tabs "Chờ duyệt" (accepted) / "Yêu cầu kích hoạt" (pending) → CS-10 (InvitesPanel).
 */

type Tab = "users" | "employees" | "pendingApproval" | "activation";

/** 2 tab CS-10 = hàng đợi lời mời (không phải bảng employees). */
const INVITE_TABS: readonly Tab[] = ["pendingApproval", "activation"];

type StatusFilter = "" | "active" | "inactive" | "resigned" | "terminated";

// ─── Create dialog form state ──────────────────────────────────────────────

interface CreateForm {
  fullName: string;
  email: string;
  phone: string;
  employeeCode: string;
}

const EMPTY_CREATE: CreateForm = { fullName: "", email: "", phone: "", employeeCode: "" };

// ─── Edit dialog form state ────────────────────────────────────────────────

interface EditForm {
  phone: string;
  employeeCode: string;
  status: StatusFilter;
}

function makeEditForm(e: EmployeeListItemDto): EditForm {
  return {
    phone: "",
    employeeCode: e.employeeCode ?? "",
    status: e.status as StatusFilter,
  };
}

// ─── Component ────────────────────────────────────────────────────────────

export function ObjectsPage() {
  const { t } = useTranslation("objects");
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  // Permissions
  const canRead = useCan("read", "employee");
  const canCreate = useCan("create", "employee");
  const canUpdate = useCan("update", "employee");
  const canDelete = useCan("delete", "employee");
  const canImport = useCan("import", "employee");

  // UI state
  const [activeTab, setActiveTab] = useState<Tab>("employees");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("");

  // Import state
  const [importStep, setImportStep] = useState<ImportStep>("idle");
  const [preview, setPreview] = useState<ImportEmployeePreviewDto | null>(null);
  const [importResult, setImportResult] = useState<{ inserted: number; failed: number } | null>(
    null,
  );

  // Create dialog state
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CreateForm>(EMPTY_CREATE);
  const [createError, setCreateError] = useState<string | null>(null);

  // Edit dialog state
  const [editTarget, setEditTarget] = useState<EmployeeListItemDto | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({ phone: "", employeeCode: "", status: "" });
  const [editError, setEditError] = useState<string | null>(null);

  // ── Data fetching ────────────────────────────────────────────────────────

  const { data: employees = [], isLoading, isError } = useQuery({
    queryKey: ["console:employees", statusFilter],
    queryFn: () =>
      consoleEmployeesApi.listEmployees(statusFilter ? { status: statusFilter } : undefined),
    enabled: canRead,
  });

  // ── Mutations ────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: () =>
      consoleEmployeesApi.createEmployee({
        fullName: createForm.fullName.trim(),
        email: createForm.email.trim(),
        phone: createForm.phone.trim() || undefined,
        employeeCode: createForm.employeeCode.trim() || undefined,
        workType: "offline",
        employmentType: "full_time",
        salaryType: "monthly",
      }),
    onSuccess: () => {
      setCreateOpen(false);
      setCreateForm(EMPTY_CREATE);
      setCreateError(null);
      void qc.invalidateQueries({ queryKey: ["console:employees"] });
    },
    onError: (err: unknown) => {
      setCreateError(
        err instanceof Error ? err.message : t("createDialog.unknownError"),
      );
    },
  });

  const updateMutation = useMutation({
    mutationFn: (id: string) =>
      consoleEmployeesApi.updateEmployee(id, {
        phone: editForm.phone.trim() || undefined,
        employeeCode: editForm.employeeCode.trim() || undefined,
        status: editForm.status || undefined,
      }),
    onSuccess: () => {
      setEditTarget(null);
      setEditError(null);
      void qc.invalidateQueries({ queryKey: ["console:employees"] });
    },
    onError: (err: unknown) => {
      setEditError(
        err instanceof Error ? err.message : t("editDialog.unknownError"),
      );
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => consoleEmployeesApi.deleteEmployee(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["console:employees"] }),
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => consoleEmployeesApi.uploadImport(file),
    onSuccess: (data) => {
      setPreview(data);
      setImportStep("preview");
    },
  });

  const confirmMutation = useMutation({
    mutationFn: (sessionId: string) => consoleEmployeesApi.confirmImport(sessionId),
    onSuccess: (result) => {
      setImportResult(result);
      setImportStep("done");
      void qc.invalidateQueries({ queryKey: ["console:employees"] });
    },
  });

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadMutation.mutate(file);
    e.target.value = "";
  };

  const resetImport = () => {
    uploadMutation.reset();
    setImportStep("idle");
    setPreview(null);
    setImportResult(null);
  };

  const openEdit = (row: EmployeeListItemDto) => {
    setEditTarget(row);
    setEditForm(makeEditForm(row));
    setEditError(null);
  };

  // ── Filtered data (client-side search across name / email / code) ────────

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter((e) => {
      const haystack = [e.userFullName, e.userEmail, e.employeeCode]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [employees, search]);

  // ── Columns ───────────────────────────────────────────────────────────────

  const employeeColumns = useMemo<ColumnDef<EmployeeListItemDto>[]>(
    () => [
      {
        id: "name",
        header: t("table.name"),
        accessorFn: (row) => `${row.userFullName ?? ""} ${row.userEmail ?? ""}`,
        cell: ({ row }) => {
          const e = row.original;
          const name = e.userFullName ?? e.userEmail ?? e.userId;
          return (
            <div className="flex items-center gap-3">
              <Avatar name={name} size="md" />
              <div className="min-w-0">
                <p className="truncate font-medium text-foreground">{name}</p>
                {e.employeeCode && (
                  <p className="text-xs text-muted-foreground">{e.employeeCode}</p>
                )}
              </div>
            </div>
          );
        },
      },
      {
        id: "personalEmail",
        header: t("table.personalEmail"),
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.userEmail ?? "—"}
          </span>
        ),
      },
      {
        id: "accountEmail",
        header: t("table.accountEmail"),
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.userEmail ?? "—"}
          </span>
        ),
      },
      {
        id: "phone",
        header: t("table.phone"),
        cell: () => <span className="text-sm text-muted-foreground">—</span>,
      },
      {
        accessorKey: "orgUnitName",
        header: t("table.department"),
        cell: ({ getValue }) => (
          <span className="text-sm text-muted-foreground">
            {(getValue() as string | null) ?? "—"}
          </span>
        ),
      },
      {
        accessorKey: "status",
        header: t("table.status"),
        cell: ({ getValue }) => {
          const status = getValue() as EmployeeStatus;
          return (
            <Badge variant={EMPLOYEE_STATUS_VARIANT[status]}>
              {t(`statusLabels.${status}`, { defaultValue: status })}
            </Badge>
          );
        },
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-2">
            {canUpdate && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => openEdit(row.original)}
              >
                {t("actions.edit")}
              </Button>
            )}
            {canDelete && (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => deleteMutation.mutate(row.original.id)}
                disabled={deleteMutation.isPending}
                aria-label={t("actions.disable")}
              >
                {t("actions.disable")}
              </Button>
            )}
          </div>
        ),
      },
    ],
    [t, canUpdate, canDelete, deleteMutation],
  );

  // "Người dùng" tab reuses same columns but without salary column
  const userColumns = useMemo<ColumnDef<EmployeeListItemDto>[]>(
    () => employeeColumns,
    [employeeColumns],
  );

  const columns = activeTab === "users" ? userColumns : employeeColumns;

  // ── Permission gate ───────────────────────────────────────────────────────

  if (!canRead) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <EmptyState
          icon={Users}
          title={t("noPermission.title")}
          description={t("noPermission.description")}
        />
      </div>
    );
  }

  const hasData = filtered.length > 0;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6 sm:p-8">
      {/* Header */}
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </header>

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg border border-border bg-muted/40 p-1 w-fit">
        {(["employees", "users", "pendingApproval", "activation"] as Tab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={[
              "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
              activeTab === tab
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            ].join(" ")}
            aria-selected={activeTab === tab}
            role="tab"
          >
            {t(`tabs.${tab}`)}
          </button>
        ))}
      </div>

      {INVITE_TABS.includes(activeTab) ? (
        <InvitesPanel kind={activeTab === "activation" ? "activation" : "approval"} />
      ) : (
        <>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("filter.search")}
            aria-label={t("filter.search")}
            className="pl-9"
          />
        </div>

        <Select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          aria-label={t("filter.status")}
          className="w-48"
        >
          <option value="">{t("filter.statusAll")}</option>
          <option value="active">{t("statusLabels.active")}</option>
          <option value="inactive">{t("statusLabels.inactive")}</option>
          <option value="resigned">{t("statusLabels.resigned")}</option>
          <option value="terminated">{t("statusLabels.terminated")}</option>
        </Select>

        <div className="ml-auto flex gap-2">
          {canImport && (
            <Button
              variant="outline"
              onClick={() => fileRef.current?.click()}
              disabled={uploadMutation.isPending || importStep === "preview"}
            >
              <Upload className="h-4 w-4" />
              {uploadMutation.isPending ? t("import.importing") : t("actions.importCsv")}
            </Button>
          )}
          {canCreate && (
            <Button onClick={() => { setCreateOpen(true); setCreateError(null); }}>
              {t("actions.create")}
            </Button>
          )}
        </div>
      </div>

      {/* Hidden file input for CSV */}
      <input
        ref={fileRef}
        type="file"
        accept=".csv"
        className="hidden"
        onChange={handleFileChange}
        aria-hidden="true"
      />

      {/* Import panel */}
      <ObjectsImportPanel
        step={importStep}
        preview={preview}
        result={importResult}
        uploadError={
          uploadMutation.isError
            ? uploadMutation.error instanceof Error
              ? uploadMutation.error.message
              : t("import.uploadError", { message: "Unknown" })
            : null
        }
        confirming={confirmMutation.isPending}
        confirmError={
          confirmMutation.isError
            ? confirmMutation.error instanceof Error
              ? confirmMutation.error.message
              : null
            : null
        }
        onConfirm={() => preview && confirmMutation.mutate(preview.sessionId)}
        onReset={resetImport}
      />

      {/* Table */}
      {isError ? (
        <div
          role="alert"
          aria-live="assertive"
          className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-center text-sm text-destructive"
        >
          {t("error.loadFailed")}
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={filtered}
          isLoading={isLoading}
          emptyState={
            <EmptyState
              icon={Users}
              title={hasData || isLoading ? t("empty.titleFiltered") : t("empty.title")}
              description={
                hasData || isLoading
                  ? t("empty.descriptionFiltered")
                  : t("empty.description")
              }
            />
          }
        />
      )}

      {/* Create dialog */}
      <Dialog
        open={createOpen}
        onClose={() => { setCreateOpen(false); setCreateForm(EMPTY_CREATE); setCreateError(null); }}
        title={t("createDialog.title")}
        description={t("createDialog.description")}
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => { setCreateOpen(false); setCreateForm(EMPTY_CREATE); setCreateError(null); }}
            >
              {t("createDialog.cancel")}
            </Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending || !createForm.fullName.trim() || !createForm.email.trim()}
            >
              {createMutation.isPending ? t("createDialog.creating") : t("createDialog.createButton")}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium text-foreground">
              {t("createDialog.fieldFullName")}
            </label>
            <Input
              value={createForm.fullName}
              onChange={(e) => setCreateForm({ ...createForm, fullName: e.target.value })}
              placeholder="Nguyễn Văn A"
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-foreground">
              {t("createDialog.fieldEmail")}
            </label>
            <Input
              type="email"
              value={createForm.email}
              onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
              placeholder="nva@company.com"
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-foreground">
              {t("createDialog.fieldPhone")}
            </label>
            <Input
              value={createForm.phone}
              onChange={(e) => setCreateForm({ ...createForm, phone: e.target.value })}
              placeholder="0901 234 567"
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-foreground">
              {t("createDialog.fieldEmployeeCode")}
            </label>
            <Input
              value={createForm.employeeCode}
              onChange={(e) => setCreateForm({ ...createForm, employeeCode: e.target.value })}
              placeholder="NV001"
            />
          </div>
          {createError && (
            <p className="text-sm text-destructive">
              {t("createDialog.createError")} {createError}
            </p>
          )}
        </div>
      </Dialog>

      {/* Edit dialog */}
      <Dialog
        open={editTarget !== null}
        onClose={() => { setEditTarget(null); setEditError(null); }}
        title={t("editDialog.title")}
        description={t("editDialog.description", {
          name: editTarget?.userFullName ?? editTarget?.userEmail ?? "",
        })}
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => { setEditTarget(null); setEditError(null); }}
            >
              {t("editDialog.cancel")}
            </Button>
            <Button
              onClick={() => editTarget && updateMutation.mutate(editTarget.id)}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? t("editDialog.saving") : t("editDialog.saveButton")}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium text-foreground">
              {t("editDialog.fieldPhone")}
            </label>
            <Input
              value={editForm.phone}
              onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
              placeholder="0901 234 567"
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-foreground">
              {t("editDialog.fieldEmployeeCode")}
            </label>
            <Input
              value={editForm.employeeCode}
              onChange={(e) => setEditForm({ ...editForm, employeeCode: e.target.value })}
              placeholder="NV001"
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-foreground">
              {t("editDialog.fieldStatus")}
            </label>
            <Select
              value={editForm.status}
              onChange={(e) => setEditForm({ ...editForm, status: e.target.value as StatusFilter })}
            >
              <option value="">{t("filter.statusAll")}</option>
              <option value="active">{t("statusLabels.active")}</option>
              <option value="inactive">{t("statusLabels.inactive")}</option>
              <option value="resigned">{t("statusLabels.resigned")}</option>
              <option value="terminated">{t("statusLabels.terminated")}</option>
            </Select>
          </div>
          {editError && (
            <p className="text-sm text-destructive">
              {t("editDialog.saveError")} {editError}
            </p>
          )}
        </div>
      </Dialog>
        </>
      )}
    </div>
  );
}
