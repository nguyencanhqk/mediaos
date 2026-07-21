import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { hrApi, hrKeys } from "@mediaos/web-core";
import { Avatar, Badge, Button, Dialog, Input, Select } from "@mediaos/ui";
import type { HrEmployeeListItem } from "@mediaos/contracts";

/**
 * EmployeeMultiPickerDialog — hộp thoại chọn NHIỀU nhân viên theo benchmark Base/AMIS: tìm kiếm
 * server + lọc phòng ban + phân trang + checkbox, selection SỐNG QUA các trang (Set employeeId).
 *
 * Gom từ hai chỗ cùng một bảng chọn (thêm thành viên dự án + thêm người vào phòng ban) — chỉ khác
 * tiêu đề, điều kiện khóa hàng, slot phụ (vai trò dự án) và hành động thêm-từng-người; giữ hai bản
 * là chắc chắn trôi khỏi nhau. Nhãn chung nằm ở namespace `common` (employeePicker.*), nhãn theo
 * ngữ cảnh do caller truyền.
 *
 * DANH SÁCH NGƯỜI do SERVER lọc theo data-scope của `read:employee` — client KHÔNG tự lọc thêm
 * (CLAUDE.md §5: scope là việc của server). Không có endpoint bulk — bấm xác nhận thì allSettled
 * TỪNG người qua `onAddOne`; người lỗi GIỮ LẠI trong selection để bấm thử lại, người đã vào thì
 * `onBatchSettled` cho caller invalidate hiển thị ngay.
 */
const PAGE_SIZE = 10;
const SEARCH_DEBOUNCE_MS = 300;

interface EmployeeMultiPickerDialogProps {
  title: string;
  description?: string;
  /** Hàng bị KHÓA (đã tham gia / đã ở phòng…) — hiện mờ + badge, không chọn lại được. */
  isRowDisabled: (employee: HrEmployeeListItem) => boolean;
  /** Nhãn badge cạnh tên của hàng bị khóa (vd: "Đã tham gia") — string chung hoặc theo từng hàng. */
  disabledBadge: string | ((employee: HrEmployeeListItem) => string);
  /**
   * Multi-mode: hàng khóa có hiện dấu tích không (mặc định true = "đã ở trong"). Truyền khi hàng
   * khóa vì lý do KHÁC đã-tham-gia (vd chưa liên kết tài khoản) — hàng đó không được tích.
   */
  disabledRowChecked?: (employee: HrEmployeeListItem) => boolean;
  /** Slot bên phải hàng lọc (vd: chọn Vai trò dự án). */
  headerExtra?: ReactNode;
  /**
   * Thêm/áp dụng MỘT người (nhận CẢ row để caller lấy field ngoài id, vd userId) — reject nghĩa
   * là người đó lỗi (giữ lại trong selection để thử lại).
   */
  onAddOne: (employee: HrEmployeeListItem) => Promise<unknown>;
  /** Chạy sau MỖI đợt thêm (kể cả partial) — caller invalidate cache hiển thị ngay. */
  onBatchSettled: () => Promise<unknown> | unknown;
  /** Đóng dialog — component TỰ gọi khi cả đợt thêm thành công. */
  onClose: () => void;
  /** "single" = chọn đúng MỘT người (chọn người khác thì THAY người cũ, ẩn chọn-cả-trang). */
  selectionMode?: "multi" | "single";
  /** Slot TRÁI của footer, cạnh bộ đếm (vd: nút "Gỡ trưởng đơn vị"). */
  footerExtra?: ReactNode;
  /** Đè nhãn nút xác nhận (mặc định "Thêm"/"Thêm (n)") — vd "Lưu" cho ngữ cảnh đặt trưởng đơn vị. */
  confirmLabel?: string;
  testIdPrefix?: string;
}

export function EmployeeMultiPickerDialog({
  title,
  description,
  isRowDisabled,
  disabledBadge,
  disabledRowChecked,
  headerExtra,
  onAddOne,
  onBatchSettled,
  onClose,
  selectionMode = "multi",
  footerExtra,
  confirmLabel,
  testIdPrefix = "employee-picker",
}: EmployeeMultiPickerDialogProps) {
  const { t } = useTranslation("common");
  const single = selectionMode === "single";

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [orgUnitId, setOrgUnitId] = useState("");
  const [page, setPage] = useState(1);
  // Selection giữ CẢ row (không chỉ id) để onAddOne dùng được field ngoài id kể cả khi người đó
  // được chọn ở TRANG KHÁC trang đang hiển thị.
  const [selected, setSelected] = useState<ReadonlyMap<string, HrEmployeeListItem>>(new Map());
  const [failedCount, setFailedCount] = useState(0);

  // Tìm kiếm là SERVER-side (search của GET /hr/employees) — debounce cho đỡ dội API; đổi từ
  // khóa thì về trang 1.
  useEffect(() => {
    const handle = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchInput]);

  const listParams = {
    page,
    pageSize: PAGE_SIZE,
    status: "active" as const,
    ...(search ? { search } : {}),
    ...(orgUnitId ? { orgUnitId } : {}),
  };
  const employeesQuery = useQuery({
    queryKey: hrKeys.employees.list(listParams),
    queryFn: () => hrApi.listEmployees(listParams),
    staleTime: 30_000,
  });
  const departmentsQuery = useQuery({
    queryKey: hrKeys.departments.list(),
    queryFn: () => hrApi.listDepartments(),
    staleTime: 300_000,
  });

  const items = employeesQuery.data?.items ?? [];
  const meta = employeesQuery.data?.meta ?? null;
  const selectableOnPage = items.filter((e) => !isRowDisabled(e));
  const allPageSelected =
    selectableOnPage.length > 0 && selectableOnPage.every((e) => selected.has(e.id));

  const toggleOne = (employee: HrEmployeeListItem) =>
    setSelected((prev) => {
      if (single) {
        // Chọn-một: bấm người khác THAY người cũ; bấm lại chính người đó thì bỏ chọn.
        return prev.has(employee.id) ? new Map() : new Map([[employee.id, employee]]);
      }
      const next = new Map(prev);
      if (next.has(employee.id)) next.delete(employee.id);
      else next.set(employee.id, employee);
      return next;
    });
  const togglePage = () =>
    setSelected((prev) => {
      const next = new Map(prev);
      for (const e of selectableOnPage) {
        if (allPageSelected) next.delete(e.id);
        else next.set(e.id, e);
      }
      return next;
    });

  const mutation = useMutation({
    mutationFn: async () => {
      const entries = Array.from(selected.values());
      const results = await Promise.allSettled(entries.map((employee) => onAddOne(employee)));
      return entries.filter((_, i) => results[i].status === "rejected");
    },
    onSuccess: async (failedEmployees) => {
      await onBatchSettled();
      if (failedEmployees.length === 0) {
        onClose();
        return;
      }
      setSelected(new Map(failedEmployees.map((e) => [e.id, e])));
      setFailedCount(failedEmployees.length);
    },
  });

  const busy = mutation.isPending;
  const noop = () => {};

  return (
    <Dialog
      open
      onClose={busy ? noop : onClose}
      title={title}
      description={description}
      className="max-w-3xl"
      footer={
        <>
          <span className="mr-auto flex items-center gap-3">
            <span
              className="self-center text-sm text-muted-foreground"
              data-testid={`${testIdPrefix}-selected-count`}
            >
              {t("employeePicker.selectedCount", { count: selected.size })}
            </span>
            {footerExtra}
          </span>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("employeePicker.cancel")}
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={busy || selected.size === 0}
            data-testid={`${testIdPrefix}-confirm`}
          >
            {confirmLabel ??
              (selected.size > 0
                ? t("employeePicker.confirmCount", { count: selected.size })
                : t("employeePicker.confirm"))}
          </Button>
        </>
      }
    >
      {failedCount > 0 && !busy && (
        <p role="alert" className="text-sm text-destructive">
          {t("employeePicker.partialError", { count: failedCount })}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder={t("employeePicker.searchPlaceholder")}
          aria-label={t("employeePicker.searchPlaceholder")}
          className="h-9 min-w-44 flex-1"
          data-testid={`${testIdPrefix}-search`}
        />
        <Select
          value={orgUnitId}
          onChange={(e) => {
            setOrgUnitId(e.target.value);
            setPage(1);
          }}
          aria-label={t("employeePicker.departmentFilter")}
          className="h-9 w-44"
          data-testid={`${testIdPrefix}-department`}
        >
          <option value="">{t("employeePicker.allDepartments")}</option>
          {(departmentsQuery.data ?? []).map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
        {headerExtra}
      </div>

      {employeesQuery.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {t("employeePicker.loadError")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="w-10 px-3 py-2">
                  {!single && (
                    <input
                      type="checkbox"
                      checked={allPageSelected}
                      disabled={busy || selectableOnPage.length === 0}
                      onChange={togglePage}
                      aria-label={t("employeePicker.selectAllPage")}
                      data-testid={`${testIdPrefix}-select-page`}
                    />
                  )}
                </th>
                <th className="px-3 py-2 font-medium">{t("employeePicker.columns.name")}</th>
                <th className="px-3 py-2 font-medium">{t("employeePicker.columns.position")}</th>
                <th className="px-3 py-2 font-medium">{t("employeePicker.columns.email")}</th>
                <th className="px-3 py-2 font-medium">{t("employeePicker.columns.department")}</th>
              </tr>
            </thead>
            <tbody>
              {employeesQuery.isLoading &&
                Array.from({ length: 3 }, (_, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    <td colSpan={5} className="px-3 py-2">
                      <div className="h-6 animate-pulse rounded bg-muted" />
                    </td>
                  </tr>
                ))}
              {!employeesQuery.isLoading &&
                items.map((e) => {
                  const disabled = isRowDisabled(e);
                  const checked = selected.has(e.id);
                  const disabledChecked = disabled && (disabledRowChecked?.(e) ?? true);
                  return (
                    <tr
                      key={e.id}
                      className={
                        disabled
                          ? "border-b border-border opacity-60 last:border-0"
                          : "cursor-pointer border-b border-border last:border-0 hover:bg-muted/40"
                      }
                      onClick={() => {
                        if (!disabled && !busy) toggleOne(e);
                      }}
                      data-testid={`${testIdPrefix}-row-${e.id}`}
                    >
                      <td className="px-3 py-2" onClick={(ev) => ev.stopPropagation()}>
                        <input
                          type={single ? "radio" : "checkbox"}
                          // Multi: hàng khóa mặc định = "đã ở trong" → hiện dấu tích (caller đè
                          // qua disabledRowChecked). Single: hàng khóa KHÔNG phải lựa chọn hiện
                          // tại → không tích.
                          checked={single ? checked : disabled ? disabledChecked : checked}
                          disabled={disabled || busy}
                          onChange={() => toggleOne(e)}
                          aria-label={e.fullName ?? e.employeeCode ?? e.id}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <span className="flex items-center gap-2">
                          <Avatar name={e.fullName} src={e.avatarUrl} size="sm" />
                          <span className="font-medium text-foreground">{e.fullName ?? "—"}</span>
                          {disabled && (
                            <Badge variant="muted">
                              {typeof disabledBadge === "function"
                                ? disabledBadge(e)
                                : disabledBadge}
                            </Badge>
                          )}
                        </span>
                      </td>
                      <td className="px-3 py-2">{e.positionName ?? "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{e.email ?? "—"}</td>
                      <td className="px-3 py-2">{e.orgUnitName ?? "—"}</td>
                    </tr>
                  );
                })}
              {!employeesQuery.isLoading && items.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-sm text-muted-foreground">
                    {t("employeePicker.empty")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {meta && meta.total > 0 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span data-testid={`${testIdPrefix}-total`}>
            {t("employeePicker.totalCount", { count: meta.total })}
          </span>
          <span className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 px-0"
              disabled={!meta.hasPrev || busy}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              aria-label={t("employeePicker.prevPage")}
              data-testid={`${testIdPrefix}-prev`}
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </Button>
            <span>
              {meta.page}/{Math.max(1, meta.totalPages)}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 px-0"
              disabled={!meta.hasNext || busy}
              onClick={() => setPage((p) => p + 1)}
              aria-label={t("employeePicker.nextPage")}
              data-testid={`${testIdPrefix}-next`}
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </span>
        </div>
      )}
    </Dialog>
  );
}
