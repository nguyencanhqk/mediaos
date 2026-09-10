/**
 * S17-CHAT-UX2-FE-3 — bảng chọn emoji của ô soạn (SPEC-15 §22c CHAT-DEC-027).
 *
 * ⚠️ Bộ dữ liệu nạp bằng `import()` **ĐỘNG** khi người dùng mở bảng lần đầu, không `import` tĩnh:
 * 122 ký tự + nhãn nhóm không đáng nằm trong chunk khởi động của `/chat`, và đây đúng là hình dạng
 * mà `console-had-zero-code-splitting` đã trả giá một lần để học.
 *
 * `onInsert` nhận MỘT ký tự và chèn tại con trỏ — chèn ở đâu là việc của `MessageComposer` (nó giữ
 * ref tới textarea và `selectionStart`); bảng này không biết gì về nháp.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Smile } from "lucide-react";
import { Button, Popover, cn } from "@mediaos/ui";
import type { EmojiGroup } from "../chat-emoji";

interface EmojiPickerProps {
  disabled: boolean;
  onInsert: (emoji: string) => void;
}

export function EmojiPicker({ disabled, onInsert }: EmojiPickerProps): React.ReactElement {
  const { t } = useTranslation("chat");
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<readonly EmojiGroup[] | null>(null);

  useEffect(() => {
    if (!open || groups !== null) return;
    let cancelled = false;
    void import("../chat-emoji").then((m) => {
      // Bảng có thể đã đóng (hoặc component đã tháo) trước khi chunk về — đừng `setState` cho cây đã
      // tháo, cùng lý do với `isMountedRef` ở `MessageComposer`.
      if (!cancelled) setGroups(m.EMOJI_GROUPS);
    });
    return () => {
      cancelled = true;
    };
  }, [open, groups]);

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="start"
      className="w-72 p-2"
      trigger={
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("composer.emoji.openAria")}
          aria-expanded={open}
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
        >
          <Smile className="h-4 w-4" aria-hidden="true" />
        </Button>
      }
    >
      {groups === null ? (
        <p className="px-1 py-2 text-xs text-muted-foreground">{t("composer.emoji.loading")}</p>
      ) : (
        <div className="max-h-64 overflow-y-auto" data-testid="chat-emoji-panel">
          {groups.map((g) => (
            <section key={g.key} className="mb-2 last:mb-0">
              <h4 className="px-1 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                {t(`composer.emoji.groups.${g.key}`)}
              </h4>
              <div className="grid grid-cols-8 gap-0.5">
                {g.emojis.map((e) => (
                  <button
                    key={e}
                    type="button"
                    aria-label={t("composer.emoji.insertAria", { emoji: e })}
                    // `onMouseDown` + `preventDefault`: giữ tiêu điểm (và `selectionStart`) ở textarea
                    // để chèn đúng vị trí con trỏ — cùng lý do với `MentionPopover`.
                    onMouseDown={(ev) => {
                      ev.preventDefault();
                      onInsert(e);
                    }}
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded text-lg",
                      "hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                    )}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </Popover>
  );
}
