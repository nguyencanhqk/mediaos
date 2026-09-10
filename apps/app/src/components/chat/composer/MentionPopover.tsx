/**
 * S17-CHAT-UX2-FE-3 — danh sách gợi ý `@mention` (SPEC-15 §22c CHAT-DEC-027).
 *
 * ⚠️ Popover này **KHÔNG BAO GIỜ nhận tiêu điểm**. Người dùng vẫn đang gõ trong `<textarea>`; kéo
 * tiêu điểm sang đây là cắt mạch gõ và làm hỏng cả `selectionStart` mà `applyMention` cần. Vì vậy:
 *  - chọn bằng chuột đi qua `onMouseDown` + `preventDefault()` (mousedown xảy ra TRƯỚC blur — dùng
 *    `onClick` là textarea đã mất tiêu điểm và con trỏ đã nhảy);
 *  - điều hướng bàn phím do textarea xử lý rồi truyền `activeIndex` xuống đây;
 *  - a11y đi theo khuôn **combobox**: `aria-activedescendant` trên textarea trỏ vào `<li>` đang chọn,
 *    nên trình đọc màn hình đọc dòng đang trỏ mà tiêu điểm DOM không hề rời ô soạn.
 *
 * Vị trí `absolute` chứ không portal: ô soạn nằm NGOÀI vùng cuộn của danh sách tin, không có tổ tiên
 * `overflow` nào xén nó — không cần trả giá portal (`Popover` primitive) cho một lớp không có trigger.
 */
import { useTranslation } from "react-i18next";
import { Avatar, cn } from "@mediaos/ui";
import type { MentionCandidate } from "../use-mention-autocomplete";

interface MentionPopoverProps {
  suggestions: readonly MentionCandidate[];
  activeIndex: number;
  /** Dùng cho `aria-activedescendant` ở textarea — phải khớp `id` của `<li>`. */
  listboxId: string;
  onPick: (candidate: MentionCandidate) => void;
}

export function mentionOptionId(listboxId: string, index: number): string {
  return `${listboxId}-opt-${index}`;
}

export function MentionPopover({
  suggestions,
  activeIndex,
  listboxId,
  onPick,
}: MentionPopoverProps): React.ReactElement {
  const { t } = useTranslation("chat");

  return (
    <ul
      id={listboxId}
      role="listbox"
      aria-label={t("composer.mention.listAria")}
      data-testid="chat-mention-listbox"
      className={cn(
        "absolute bottom-full left-3 z-30 mb-1 max-h-64 w-72 overflow-y-auto",
        "rounded-md border border-border bg-popover py-1 shadow-md",
      )}
    >
      {suggestions.map((c, i) => (
        <li
          key={c.userId}
          id={mentionOptionId(listboxId, i)}
          role="option"
          aria-selected={i === activeIndex}
          // `onMouseDown` — xem docblock đầu file. `onClick` ở đây là một lỗi im lặng.
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(c);
          }}
          className={cn(
            "flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm",
            i === activeIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
          )}
        >
          <Avatar name={c.name} src={c.avatarUrl} size="sm" />
          <span className="truncate">{c.name}</span>
        </li>
      ))}
    </ul>
  );
}
