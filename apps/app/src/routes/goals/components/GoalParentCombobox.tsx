import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { goalApi, goalKeys } from "@mediaos/web-core";
import type { GoalCoreResponseDto, ListGoalsQueryRequest } from "@mediaos/contracts";
import { Input, cn } from "@mediaos/ui";
import { normalizeSearchText } from "@/routes/tasks/workspace-constants";
import { isLocalDate } from "../goal-list-search";

/** Cỡ trang của GET /goals cho ô chọn cha (≤ GOAL_PAGE_LIMIT_MAX của contracts). */
export const GOAL_PARENT_PAGE_SIZE = 50;

/** Định danh tối thiểu để hiện cha đang chọn (bản ghi đầy đủ hoặc breadcrumb của chi tiết). */
export interface GoalParentLabel {
  readonly id: string;
  readonly goalCode: string;
  readonly name: string;
}

export function goalParentLabel(goal: GoalParentLabel): string {
  return `${goal.goalCode} — ${goal.name}`;
}

/** Lọc trên các trang ĐÃ tải: khớp tên hoặc mã, không phân biệt hoa/thường + dấu; bỏ chính nó. */
export function filterGoalParentOptions(
  goals: readonly GoalCoreResponseDto[],
  query: string,
  excludeGoalId?: string,
): GoalCoreResponseDto[] {
  const needle = normalizeSearchText(query.trim());
  return goals.filter(
    (g) =>
      g.id !== excludeGoalId &&
      (!needle ||
        normalizeSearchText(g.name).includes(needle) ||
        normalizeSearchText(g.goalCode).includes(needle)),
  );
}

/** Bộ lọc gợi ý mặc định: cùng phòng + giao với kỳ đang chọn; mốc trống/sai/ngược chiều ⇒ bỏ mốc kỳ. */
function suggestionFilter(
  departmentId: string | null,
  periodFrom: string,
  periodTo: string,
): Partial<ListGoalsQueryRequest> {
  const periodOk = isLocalDate(periodFrom) && isLocalDate(periodTo) && periodFrom <= periodTo;
  return {
    ...(departmentId ? { departmentId } : {}),
    ...(periodOk ? { periodFrom, periodTo } : {}),
  };
}

interface GoalParentComboboxProps {
  label: string;
  hint?: string;
  /** Cha đang chọn; null = mục tiêu gốc. */
  selected: GoalParentLabel | null;
  onSelect: (goal: GoalCoreResponseDto | null) => void;
  /** Đang SỬA ⇒ bỏ chính mục tiêu này khỏi danh sách. */
  excludeGoalId?: string;
  /** Phòng của gợi ý mặc định (phòng của mình); null ⇒ không lọc phòng. */
  departmentId: string | null;
  periodFrom: string;
  periodTo: string;
  disabled?: boolean;
}

/**
 * S20-GOAL-PARENTPICKER-1 (US-GOAL-NV-12) — ô chọn mục tiêu cha có tìm kiếm (WAI-ARIA combobox +
 * listbox, focus luôn ở ô nhập, mục đang trỏ qua `aria-activedescendant`; ↑/↓/Enter/Esc).
 *
 * Nguồn: GET /goals sẵn có, tải theo trang (`limit`/`offset`), mặc định gợi ý cùng phòng + cùng kỳ (bỏ
 * dấu chọn để xem mọi mục tiêu). GET /goals KHÔNG có tham số từ khoá ⇒ lọc tên/mã trên các trang đã
 * tải; không thấy thì «Tải thêm». Phạm vi `view:goal` do SERVER lọc — danh sách là đúng tập server trả,
 * FE không thêm/bớt theo vai trò. BE vẫn validate cha (GOAL-ERR-002) khi lưu.
 */
export function GoalParentCombobox({
  label,
  hint,
  selected,
  onSelect,
  excludeGoalId,
  departmentId,
  periodFrom,
  periodTo,
  disabled,
}: GoalParentComboboxProps) {
  const { t } = useTranslation("goals");
  const baseId = useId();
  const inputId = `${baseId}-input`;
  const listboxId = `${baseId}-listbox`;
  const optionId = (index: number) => `${baseId}-opt-${index}`;
  const wrapperRef = useRef<HTMLDivElement>(null);

  const [open, setOpen] = useState(false);
  /** null = không gõ ⇒ ô hiện nhãn cha đang chọn. */
  const [query, setQuery] = useState<string | null>(null);
  /** Mục đang trỏ; -1 = chưa trỏ mục nào (Enter chỉ đóng, KHÔNG đổi cha). */
  const [activeIndex, setActiveIndex] = useState(-1);
  const [suggestOnly, setSuggestOnly] = useState(true);

  const suggestion = suggestionFilter(departmentId, periodFrom, periodTo);
  const canSuggest = Object.keys(suggestion).length > 0;
  const filter = suggestOnly ? suggestion : {};

  const goalsQuery = useInfiniteQuery({
    queryKey: goalKeys.list({ scope: "parent-picker", ...filter }),
    queryFn: ({ pageParam }) =>
      goalApi.listGoals({ ...filter, limit: GOAL_PARENT_PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length < GOAL_PARENT_PAGE_SIZE ? undefined : allPages.length * GOAL_PARENT_PAGE_SIZE,
    enabled: open,
    staleTime: 30_000,
  });

  const matches = useMemo(
    () => filterGoalParentOptions(goalsQuery.data?.pages.flat() ?? [], query ?? "", excludeGoalId),
    [goalsQuery.data, query, excludeGoalId],
  );
  /** Mục 0 luôn là «Không có» (bỏ chọn cha); sau đó là các mục khớp. */
  const options: (GoalCoreResponseDto | null)[] = useMemo(() => [null, ...matches], [matches]);
  /** -1 khi cha đang chọn không nằm trong các trang đã tải (vd. ngoài bộ lọc gợi ý). */
  const selectedIndex = options.findIndex((g) => (g?.id ?? null) === (selected?.id ?? null));
  const typing = Boolean(query?.trim());

  const openList = () => {
    if (disabled || open) return;
    setOpen(true);
    // Cha đang chọn chưa có trong các trang đã tải (đang tải / ngoài gợi ý) ⇒ -1: Enter ngay sau khi mở
    // không được rơi vào «Không có» mà xoá cha.
    setActiveIndex(selectedIndex);
  };
  const close = () => {
    setOpen(false);
    setQuery(null);
  };
  const choose = (goal: GoalCoreResponseDto | null) => {
    onSelect(goal);
    close();
  };

  // Danh sách đổi độ dài (lọc/tải trang): mục trỏ không vượt cuối; đang gõ ⇒ trỏ mục KHỚP đầu tiên
  // thay vì «Không có» (Enter ngay sau khi gõ không được vô tình bỏ cha đang chọn).
  useEffect(() => {
    setActiveIndex((i) =>
      typing && i === 0 && options.length > 1 ? 1 : Math.min(i, options.length - 1),
    );
  }, [typing, options.length]);

  // Cha đang chọn tới muộn (trang đầu vừa tải) và người dùng chưa trỏ mục nào ⇒ trỏ vào nó.
  useEffect(() => {
    if (open && !typing && selectedIndex >= 0) setActiveIndex((i) => (i < 0 ? selectedIndex : i));
  }, [open, typing, selectedIndex]);

  useEffect(() => {
    if (!open) return;
    document.getElementById(`${baseId}-opt-${activeIndex}`)?.scrollIntoView?.({ block: "nearest" });
  }, [open, activeIndex, baseId]);

  // Bấm ra ngoài ⇒ đóng (Tab có thể đưa focus tới nút «Tải thêm»/ô đánh dấu trong panel nên không dựa
  // riêng vào blur).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (wrapperRef.current?.contains(e.target as Node)) return;
      setOpen(false);
      setQuery(null);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) return openList();
      setActiveIndex((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (open) setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && open) {
      // Chặn submit form: Enter ở đây là CHỌN mục đang trỏ.
      e.preventDefault();
      if (activeIndex < 0) close();
      else choose(options[activeIndex] ?? null);
    } else if (e.key === "Escape" && open) {
      // Chỉ đóng danh sách — không để Esc lan ra lớp bao (Sheet/Dialog).
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };

  const displayValue = query ?? (selected ? goalParentLabel(selected) : "");
  const noMatch = !goalsQuery.isLoading && !goalsQuery.isError && matches.length === 0;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-medium text-foreground">
        {label}
      </label>
      <div
        ref={wrapperRef}
        className="relative"
        onBlur={(e) => {
          if (open && !wrapperRef.current?.contains(e.relatedTarget as Node | null)) close();
        }}
      >
        <Input
          id={inputId}
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
          autoComplete="off"
          value={displayValue}
          placeholder={t("form.parentPicker.placeholder")}
          disabled={disabled}
          className={selected && !disabled ? "pr-9" : undefined}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(e.target.value.trim() ? 1 : 0);
            if (!open && !disabled) setOpen(true);
          }}
          onClick={openList}
          onKeyDown={onKeyDown}
        />
        {selected && !disabled && (
          <button
            type="button"
            aria-label={t("form.parentPicker.clear")}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => choose(null)}
          >
            <X className="h-4 w-4" />
          </button>
        )}
        {open && (
          <div
            className="absolute left-0 right-0 top-full z-30 mt-1 rounded-md border border-border bg-card p-1 shadow-lg"
            // Giữ focus ở ô nhập khi bấm BẤT KỲ đâu trong panel (mục, thanh cuộn, dòng trạng thái, nút):
            // aria-activedescendant cần focus ở đó, và blur với relatedTarget null sẽ đóng danh sách.
            onMouseDown={(e) => e.preventDefault()}
          >
            <ul
              id={listboxId}
              role="listbox"
              aria-label={label}
              className="max-h-64 overflow-y-auto"
            >
              {options.map((goal, index) => (
                <li
                  key={goal?.id ?? "none"}
                  id={optionId(index)}
                  role="option"
                  aria-selected={index === selectedIndex}
                  data-active={index === activeIndex || undefined}
                  className={cn(
                    "cursor-pointer rounded px-2 py-1.5 text-sm text-foreground",
                    index === activeIndex && "bg-muted",
                    index === selectedIndex && "font-medium text-primary",
                  )}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => choose(goal)}
                >
                  {goal ? goalParentLabel(goal) : t("form.parentPicker.none")}
                </li>
              ))}
            </ul>
            <div role="status" className="px-2 text-xs text-muted-foreground empty:hidden">
              {goalsQuery.isLoading && t("form.parentPicker.loading")}
              {noMatch && t("form.parentPicker.noResults")}
            </div>
            {goalsQuery.isError && (
              <p className="px-2 py-1 text-xs text-destructive">
                {t("form.parentPicker.loadError")}
              </p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-2 pt-1.5 text-xs empty:hidden">
              {canSuggest && (
                <label className="flex items-center gap-1.5 text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={suggestOnly}
                    onChange={(e) => setSuggestOnly(e.target.checked)}
                  />
                  {t("form.parentPicker.suggestOnly")}
                </label>
              )}
              {goalsQuery.hasNextPage && (
                <button
                  type="button"
                  className="rounded px-2 py-1 font-medium text-primary hover:bg-muted disabled:opacity-50"
                  disabled={goalsQuery.isFetchingNextPage}
                  onClick={() => void goalsQuery.fetchNextPage()}
                >
                  {goalsQuery.isFetchingNextPage
                    ? t("form.parentPicker.loading")
                    : t("form.parentPicker.loadMore")}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}
