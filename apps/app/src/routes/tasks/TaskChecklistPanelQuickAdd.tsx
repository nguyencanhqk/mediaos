import { useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { Button } from "@mediaos/ui";

/**
 * Ô «Thêm mục» của checklist — S20-TASK-QUICKENTRY-1 (US-TASK-NV-10, SPEC-06 §14.16).
 *
 * Nhập liên tiếp: Enter lưu, ô trống và GIỮ focus (ô chỉ `readOnly` khi đang lưu, không `disabled` —
 * disabled làm mất focus). Shift+Enter xuống dòng. Dán văn bản nhiều dòng ⇒ mỗi dòng không rỗng là
 * MỘT mục, đúng thứ tự; quá {@link CHECKLIST_QUICK_ADD_MAX_ITEMS} dòng hoặc có dòng dài hơn
 * {@link CHECKLIST_QUICK_ADD_MAX_TITLE_LENGTH} ký tự ⇒ báo lỗi tại chỗ, KHÔNG gửi mục nào (nhóm đã có
 * thêm tuần tự — để server chặn thì các mục đứng trước đã lưu mất rồi). Dán KHÔNG tách ngay: văn bản
 * nằm trong ô kèm nhãn «Enter để thêm n mục», tách khi Enter/bấm nút.
 *
 * Lỗi khi lưu (vd. 403) ⇒ ô giữ lại phần CHƯA lưu được (`save` trả `saved` = số mục đầu đã lưu) và
 * hiện lỗi tại chỗ. Gate quyền ở CALLER (chỉ mount khi `update:task`) — component không tự gate.
 */

/** Trần số mục mỗi lần nhập/dán — khớp `items.max(50)` của createTaskChecklistSchema (contracts). */
export const CHECKLIST_QUICK_ADD_MAX_ITEMS = 50;

/**
 * Trần độ dài mỗi mục (sau trim) — khớp `items[].max(500)` của createTaskChecklistSchema và
 * `title.max(500)` của createTaskChecklistItemSchema (contracts).
 */
export const CHECKLIST_QUICK_ADD_MAX_TITLE_LENGTH = 500;

/** Số dòng hiển thị tối đa của ô trước khi cuộn. */
const MAX_VISIBLE_ROWS = 6;

export interface ChecklistSaveResult {
  /** Số mục ĐẦU danh sách đã lưu thành công. */
  saved: number;
  /** Có ⇒ lưu dở dang/thất bại; phần từ `saved` trở đi được trả lại ô nhập. */
  error?: unknown;
}

const LINE_BREAK = /\r\n|\r|\n/;

function splitItemLines(text: string): string[] {
  return text
    .split(LINE_BREAK)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Dòng đầu tiên (đánh số theo ô nhập, từ 1) dài quá trần sau trim; không có ⇒ null. */
function firstOverlongLine(text: string): { line: number; length: number } | null {
  const lengths = text.split(LINE_BREAK).map((line) => line.trim().length);
  const index = lengths.findIndex((length) => length > CHECKLIST_QUICK_ADD_MAX_TITLE_LENGTH);
  return index === -1 ? null : { line: index + 1, length: lengths[index] ?? 0 };
}

export function ChecklistQuickAdd({
  save,
  errorKeyOf,
  autoFocus = false,
}: {
  save: (titles: string[]) => Promise<ChecklistSaveResult>;
  errorKeyOf: (err: unknown) => string;
  autoFocus?: boolean;
}) {
  const { t } = useTranslation("tasks");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const lines = splitItemLines(value);
  const tooMany = lines.length > CHECKLIST_QUICK_ADD_MAX_ITEMS;
  const overlong = firstOverlongLine(value);
  const blocked = tooMany || overlong !== null;
  const rows = Math.min(Math.max(value.split(LINE_BREAK).length, 1), MAX_VISIBLE_ROWS);

  const submit = async () => {
    if (busy || lines.length === 0 || blocked) return;
    setBusy(true);
    setErrorKey(null);
    const result = await save(lines);
    setBusy(false);
    if (result.error === undefined) {
      setValue("");
      return;
    }
    setValue(lines.slice(result.saved).join("\n"));
    setErrorKey(errorKeyOf(result.error));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    void submit();
  };

  return (
    <div className="space-y-1">
      <div className="flex items-start gap-2">
        <textarea
          aria-label={t("quickEntry.checklist.inputLabel")}
          autoFocus={autoFocus}
          rows={rows}
          value={value}
          readOnly={busy}
          aria-busy={busy}
          aria-invalid={blocked}
          placeholder={t("quickEntry.checklist.placeholder")}
          onChange={(e) => {
            setValue(e.target.value);
            setErrorKey(null);
          }}
          onKeyDown={onKeyDown}
          className="flex min-h-8 w-full resize-none rounded-md border border-border bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-label={t("quickEntry.checklist.submit")}
          disabled={busy || lines.length === 0 || blocked}
          onClick={() => void submit()}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
      {tooMany ? (
        <p role="alert" className="text-xs text-destructive">
          {t("quickEntry.checklist.tooMany", {
            max: CHECKLIST_QUICK_ADD_MAX_ITEMS,
            count: lines.length,
          })}
        </p>
      ) : overlong ? (
        <p role="alert" className="text-xs text-destructive">
          {t("quickEntry.checklist.tooLong", {
            max: CHECKLIST_QUICK_ADD_MAX_TITLE_LENGTH,
            line: overlong.line,
            length: overlong.length,
          })}
        </p>
      ) : errorKey ? (
        <p role="alert" className="text-xs text-destructive">
          {t(errorKey)}
        </p>
      ) : lines.length > 1 ? (
        <p className="text-xs text-muted-foreground">
          {t("quickEntry.checklist.pendingCount", { count: lines.length })}
        </p>
      ) : null}
    </div>
  );
}
