import { useId, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@mediaos/ui";
import type { MentionCandidate } from "./task-mention-candidates";

/**
 * Gợi ý @ của ô bình luận (S20-TASK-QUICKENTRY-1), chọn được bằng bàn phím (S20-TASK-FEDEBT-1).
 *
 * Mẫu listbox gắn ô nhập (WAI-ARIA combobox/listbox): focus LUÔN ở ô soạn; ô mang `aria-autocomplete`,
 * `aria-controls` = listbox và `aria-activedescendant` = mục đang sáng — trình đọc màn hình đọc mục sáng
 * mà người dùng không phải rời chỗ gõ. ↓/↑ đi vòng, Enter chọn mục sáng, Esc đóng danh sách.
 * Esc được chặn nổi bọt: ô soạn nằm trong drawer việc, Esc lọt ra sẽ đóng luôn drawer.
 * Gõ tiếp (token đổi) ⇒ mục sáng về đầu danh sách đã lọc.
 */
interface MentionListboxOptions {
  /** Đang có token `@…` dở dang (danh sách đang mở, kể cả khi rỗng). */
  open: boolean;
  suggestions: readonly MentionCandidate[];
  /** Định danh token đang gõ — đổi ⇒ mục sáng về 0. */
  tokenKey: string;
  onSelect: (candidate: MentionCandidate) => void;
  onClose: () => void;
}

export interface MentionListbox {
  listId: string;
  activeIndex: number;
  /** id mục sáng cho `aria-activedescendant`; `undefined` khi không có mục nào. */
  activeId: string | undefined;
  optionId: (index: number) => string;
  /** Xử lý phím của ô soạn; `true` = phím đã dùng cho danh sách, phía gọi dừng lại. */
  handleKeyDown: (e: KeyboardEvent<HTMLElement>) => boolean;
}

export function useMentionListbox({
  open,
  suggestions,
  tokenKey,
  onSelect,
  onClose,
}: MentionListboxOptions): MentionListbox {
  const baseId = useId();
  const [active, setActive] = useState({ tokenKey, index: 0 });
  const count = suggestions.length;
  const activeIndex =
    active.tokenKey === tokenKey ? Math.min(active.index, Math.max(0, count - 1)) : 0;
  const hasActive = open && count > 0;
  const optionId = (index: number) => `${baseId}-option-${index}`;

  const handleKeyDown = (e: KeyboardEvent<HTMLElement>): boolean => {
    if (!open || e.nativeEvent.isComposing) return false;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return true;
    }
    if (!hasActive) return false;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive({ tokenKey, index: (activeIndex + step + count) % count });
      return true;
    }
    if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      e.preventDefault();
      const picked = suggestions[activeIndex];
      if (picked) onSelect(picked);
      return true;
    }
    return false;
  };

  return {
    listId: `${baseId}-listbox`,
    activeIndex,
    activeId: hasActive ? optionId(activeIndex) : undefined,
    optionId,
    handleKeyDown,
  };
}

export function MentionSuggestions({
  suggestions,
  listbox,
  onSelect,
}: {
  suggestions: readonly MentionCandidate[];
  listbox: MentionListbox;
  onSelect: (candidate: MentionCandidate) => void;
}) {
  const { t } = useTranslation("tasks");
  if (suggestions.length === 0) {
    return (
      <p className="p-2 text-xs text-muted-foreground">
        {t("tasks.detail.comments.mention.noMatch")}
      </p>
    );
  }
  return (
    <ul
      id={listbox.listId}
      role="listbox"
      aria-label={t("quickEntry.comments.mentionListLabel")}
      className="max-h-56 space-y-0.5 overflow-y-auto"
      data-testid="mention-suggestions"
    >
      {suggestions.map((candidate, index) => {
        const isActive = index === listbox.activeIndex;
        return (
          <li
            key={candidate.id}
            id={listbox.optionId(index)}
            role="option"
            aria-selected={isActive}
            // Giữ focus ở ô soạn khi bấm chuột (mục không nhận focus — mẫu activedescendant).
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onSelect(candidate)}
            className={cn(
              "w-full cursor-pointer rounded px-2 py-1.5 text-left text-sm hover:bg-muted",
              isActive && "bg-muted",
            )}
          >
            {candidate.fullName}
          </li>
        );
      })}
    </ul>
  );
}
