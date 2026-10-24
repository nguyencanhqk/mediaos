import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, UserRound } from "lucide-react";
import { meApi, meKeys } from "@mediaos/web-core";
import { Input, cn, toast } from "@mediaos/ui";
import { useSlashFocus } from "./use-slash-focus";

/**
 * Điều khiển lọc DÙNG CHUNG giữa Danh sách `/tasks` (TaskListToolbar, S20-TASK-DRAWER-1) và toolbar
 * workspace dự án (S20-TASK-PROJTOOLBARURL-1) — một nguồn cho ô tìm và chip «Của tôi».
 */

const SEARCH_DEBOUNCE_MS = 300;

/** Ô tìm: debounce 300ms rồi `onCommit` (trang ghi URL bằng replace); phím «/» ngoài ô nhập ⇒ focus. */
export function TaskSearchBox({
  value,
  onCommit,
  label,
  placeholder,
  testId = "task-list-search",
  className = "w-64",
}: {
  value: string | undefined;
  onCommit: (next: string | undefined) => void;
  label?: string;
  placeholder?: string;
  testId?: string;
  className?: string;
}) {
  const { t } = useTranslation("tasks");
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(value ?? "");

  // URL đổi từ ngoài (Back, «Xoá bộ lọc») ⇒ ô tìm theo URL. URL chỉ vừa nhận bản đã trim của chính
  // ô này ⇒ giữ nguyên chữ đang gõ (không nuốt dấu cách cuối giữa hai từ).
  useEffect(
    () => setDraft((prev) => (prev.trim() === (value ?? "") ? prev : (value ?? ""))),
    [value],
  );

  useEffect(() => {
    const trimmed = draft.trim();
    if (trimmed === (value ?? "")) return;
    const id = window.setTimeout(() => onCommit(trimmed || undefined), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [draft, value, onCommit]);

  useSlashFocus(inputRef);

  return (
    <div className="relative">
      <Search
        className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        ref={inputRef}
        type="search"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        aria-label={label ?? t("listFilters.searchLabel")}
        placeholder={placeholder ?? t("listFilters.searchPlaceholder")}
        data-testid={testId}
        className={cn(className, "pl-8")}
      />
    </div>
  );
}

/**
 * Chip «Của tôi» — employeeId của tôi lấy từ /me (tải khi bấm lần đầu, rồi dùng cache). Trang quyết
 * bộ lọc của nó «chứa tôi» nghĩa là gì (`isActive`) và bấm thì đổi gì (`onToggle(myId, active)`, với
 * `active` = trạng thái TRƯỚC khi bấm).
 */
export function MineChip({
  isActive,
  onToggle,
  testId = "task-list-chip-mine",
}: {
  isActive: (myEmployeeId: string) => boolean;
  onToggle: (myEmployeeId: string, active: boolean) => void;
  testId?: string;
}) {
  const { t } = useTranslation("tasks");
  const queryClient = useQueryClient();
  const meQuery = { queryKey: meKeys.overview(), queryFn: () => meApi.getOverview() };
  const { data: me } = useQuery({ ...meQuery, enabled: false });
  const myId = me?.identity.employee?.employeeId;
  const active = myId !== undefined && isActive(myId);

  const onClick = async () => {
    if (active) {
      onToggle(myId, true);
      return;
    }
    try {
      const overview = await queryClient.fetchQuery({ ...meQuery, staleTime: 300_000 });
      const employeeId = overview.identity.employee?.employeeId;
      if (employeeId) onToggle(employeeId, false);
      else toast.warning(t("listFilters.mineUnlinked"));
    } catch {
      toast.error(t("listFilters.mineFailed"));
    }
  };

  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => void onClick()}
      data-testid={testId}
      className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors ${
        active
          ? "border-primary bg-primary/10 text-foreground"
          : "border-border text-muted-foreground hover:text-foreground"
      }`}
    >
      <UserRound className="h-4 w-4" aria-hidden="true" />
      {t("listFilters.mine")}
    </button>
  );
}
