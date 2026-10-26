import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { hrApi, hrKeys, useCan } from "@mediaos/web-core";
import { Avatar, Popover, Input, cn } from "@mediaos/ui";

/**
 * EmployeePicker — chọn một nhân viên qua popover có ô tìm kiếm, nút bấm là AVATAR (kèm tên tuỳ chọn).
 *
 * Gom từ hai bản trùng nhau (ô người phụ trách của task + ô người thực hiện của việc con): cả hai đều
 * cần "bấm avatar → tìm → chọn", chỉ khác nút bấm hiện gì và có cho gỡ hay không. Giữ hai bản là chắc
 * chắn trôi khỏi nhau (bản này thêm tìm kiếm, bản kia thì không…).
 *
 * DANH SÁCH NGƯỜI do SERVER lọc theo data-scope của `read:employee` (Own/Team/Company) — client KHÔNG
 * tự lọc thêm (CLAUDE.md §5: scope là việc của server). Chỉ tải khi popover MỞ: một panel việc con có
 * hàng chục dòng, tải sẵn cho từng dòng là lãng phí (khoá query dùng chung ⇒ dòng thứ hai là cache-hit).
 */
/** Tên + ảnh của người vừa chọn, lấy từ chính dòng trong danh sách của picker. */
export interface PickedEmployee {
  readonly fullName: string | null;
  readonly avatarUrl: string | null;
}

export function EmployeePicker({
  employeeId,
  name,
  avatarUrl,
  onSelect,
  canEdit,
  allowClear = false,
  showName = false,
  pending = false,
  testId,
  emptyLabel,
  open: openProp,
  onOpenChange,
}: {
  employeeId: string | null;
  name: string | null;
  avatarUrl: string | null | undefined;
  /**
   * `null` = gỡ người (chỉ gọi được khi `allowClear`). `employee` = tên/ảnh của người vừa chọn (đã có
   * sẵn trong danh sách) — để phía gọi vá lạc quan đúng tên thay vì đợi server trả.
   */
  onSelect: (employeeId: string | null, employee?: PickedEmployee) => void;
  canEdit: boolean;
  /**
   * Route `assign` đòi uuid (không nhận rỗng) nên ô người phụ trách của TASK không gỡ được;
   * việc con đi PATCH nên gỡ được. Khác biệt này là RÀNG BUỘC API, không phải tuỳ chọn giao diện.
   */
  allowClear?: boolean;
  /** Hiện tên cạnh avatar (ô chính) hay chỉ avatar (dòng việc con, chỗ hẹp). */
  showName?: boolean;
  pending?: boolean;
  testId: string;
  emptyLabel: string;
  /**
   * Mở/đóng do phía gọi điều khiển (tuỳ chọn) — vd «Đổi người» trên cảnh báo sau khi giao
   * (S20-TASK-ASSIGNWARN-1) mở lại đúng picker này. Không truyền ⇒ tự quản như cũ.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const { t } = useTranslation("tasks");
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = openProp ?? uncontrolledOpen;
  // Ổn định danh tính: Popover gắn lại listener tài liệu mỗi khi `onOpenChange` đổi.
  const setOpen = useCallback(
    (next: boolean) => {
      if (openProp === undefined) setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [openProp, onOpenChange],
  );
  const [search, setSearch] = useState("");
  const canReadEmployees = useCan("read", "employee");

  const { data: employeesPage, isLoading } = useQuery({
    queryKey: hrKeys.employees.list({ pageSize: 100, status: "active" }),
    queryFn: () => hrApi.listEmployees({ pageSize: 100, status: "active" }),
    enabled: open && canReadEmployees,
    staleTime: 60_000,
  });
  const employees = employeesPage?.items ?? [];
  const filtered = search.trim()
    ? employees.filter((e) =>
        (e.fullName ?? "").toLowerCase().includes(search.trim().toLowerCase()),
      )
    : employees;

  const label = name ?? emptyLabel;

  const trigger = (
    <button
      type="button"
      disabled={!canEdit || pending}
      onClick={() => setOpen(!open)}
      title={label}
      aria-label={t("tasks.picker.change", { name: label })}
      data-testid={testId}
      className={cn(
        "flex items-center gap-2 rounded-md text-left transition-colors",
        showName && "min-w-0 max-w-full px-1.5 py-1",
        canEdit && showName && "hover:bg-muted",
        canEdit && !showName && "hover:opacity-80",
        !canEdit && "cursor-default",
        pending && "opacity-50",
      )}
    >
      <Avatar size="sm" name={name} src={avatarUrl} />
      {showName && (
        <span
          className={cn("truncate text-sm", name ? "text-foreground" : "text-muted-foreground")}
        >
          {label}
        </span>
      )}
    </button>
  );

  if (!canEdit) return trigger;

  const choose = (nextId: string | null, picked?: PickedEmployee) => {
    setOpen(false);
    setSearch("");
    if (nextId === employeeId) return; // không đổi ⇒ không gọi API
    onSelect(nextId, picked);
  };

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger={trigger}
      align="start"
      className="w-64 p-2"
    >
      <p className="px-1 pb-1.5 text-xs font-medium text-muted-foreground">
        {t("tasks.picker.title")}
      </p>
      {!canReadEmployees ? (
        <p className="px-1 py-2 text-xs text-muted-foreground">
          {t("tasks.assign.employeeReadHint")}
        </p>
      ) : (
        <>
          <Input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("tasks.picker.searchPlaceholder")}
            className="h-8 text-sm"
            data-testid={`${testId}-search`}
          />
          <ul className="mt-1.5 max-h-56 overflow-y-auto">
            {allowClear && employeeId && (
              <li>
                <button
                  type="button"
                  onClick={() => choose(null)}
                  className="w-full rounded px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-muted"
                >
                  {t("tasks.picker.clear")}
                </button>
              </li>
            )}
            {isLoading ? (
              <li className="px-2 py-2">
                <div className="h-4 w-32 animate-pulse rounded bg-muted" />
              </li>
            ) : filtered.length === 0 ? (
              <li className="px-2 py-2 text-xs text-muted-foreground">
                {t("tasks.picker.noMatch")}
              </li>
            ) : (
              filtered.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() =>
                      choose(e.id, { fullName: e.fullName ?? null, avatarUrl: e.avatarUrl ?? null })
                    }
                    className={cn(
                      "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted",
                      e.id === employeeId && "bg-muted font-medium",
                    )}
                  >
                    <Avatar size="sm" name={e.fullName} src={e.avatarUrl} />
                    <span className="truncate">{e.fullName}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </>
      )}
    </Popover>
  );
}
