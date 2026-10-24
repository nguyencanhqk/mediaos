/**
 * S20-TASK-BOARDMOVE-1 (US-TASK-NV-91) — menu ⋯ «Chuyển sang cột…» trên thẻ board: lối đổi cột cho
 * điện thoại (kéo-thả HTML5 không chạy trên cảm ứng) và cho người chỉ dùng bàn phím.
 *
 * Menu này KHÔNG tự gọi API: nó chỉ báo `move.onMove(taskId, id cột)` lên board, và board đi tiếp đúng
 * con đường của kéo-thả (cùng chốt quyền, cùng no-op khi trùng cột, cùng mutation lạc quan + rollback
 * khi server từ chối). Không đổi FSM (DECISIONS-03) — cột khác nhóm thì trạng thái do server đồng bộ.
 * Có hiện hay không do thẻ quyết theo `draggable` (= `canDrag` của board) — điều kiện DUY NHẤT.
 *
 * Panel dùng `Popover` của `@mediaos/ui`: thẻ nằm trong cột `overflow-y-auto`, panel `absolute` sẽ bị
 * xén; `Popover` portal ra `body` + toạ độ `fixed` (xem chú thích ở chính nó).
 *
 * ⚠️ Panel portal ra `body` nhưng sự kiện React vẫn nổi bọt theo CÂY REACT — tức lên tới thẻ, nơi bấm
 * và Enter/Space = mở chi tiết. Vì vậy vỏ ngoài chặn `click` và chặn keydown Enter/Space. KHÔNG chặn
 * mọi phím: `Popover` nghe Escape trên `document`, chặn hết thì Escape không còn đóng được menu.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { MoreHorizontal } from "lucide-react";
import { Popover } from "@mediaos/ui";

export interface MoveTarget {
  id: string;
  label: string;
}

/** Board truyền xuống cột → thẻ: TOÀN BỘ cột của board + một lối vào đổi cột duy nhất. */
export interface KanbanMoveProps {
  targets: readonly MoveTarget[];
  onMove: (taskId: string, targetId: string) => void;
}

const ACTIVATION_KEYS = new Set(["Enter", " "]);

function stopClick(e: React.MouseEvent) {
  e.stopPropagation();
}

function stopActivationKeys(e: React.KeyboardEvent) {
  if (ACTIVATION_KEYS.has(e.key)) e.stopPropagation();
}

function menuItems(menu: HTMLElement | null): HTMLElement[] {
  return Array.from(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
}

/** Vị trí kế tiếp khi đi bằng phím trong menu; `null` = phím không phải phím điều hướng. */
function nextIndex(key: string, current: number, count: number): number | null {
  if (key === "ArrowDown") return (current + 1) % count;
  if (key === "ArrowUp") return (current - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

export function KanbanCardMoveMenu({
  task,
  currentId,
  move,
}: {
  task: { id: string; title: string };
  /** Cột đang chứa thẻ — bị loại khỏi danh sách (chuyển vào chính nó là no-op). */
  currentId: string | null | undefined;
  move: KanbanMoveProps;
}) {
  const { t } = useTranslation("tasks");
  const [open, setOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const headingId = React.useId();
  const targets = move.targets.filter((target) => target.id !== currentId);

  // Mở ⇒ đưa focus vào mục đầu. Hoãn một nhịp: lượt vẽ đầu `Popover` còn ẩn panel
  // (`visibility: hidden` tới khi đo xong vị trí) mà trình duyệt không cho focus phần tử bị ẩn.
  React.useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => menuItems(menuRef.current)[0]?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  const closeToTrigger = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // Escape: `Popover` tự đóng (nghe trên document) — ở đây chỉ trả focus về nút ⋯.
    if (e.key === "Escape") {
      triggerRef.current?.focus();
      return;
    }
    // Tab rời menu ⇒ đóng (mẫu menu WAI-ARIA); panel nằm cuối `body`, Tab tiếp sẽ lạc khỏi board.
    if (e.key === "Tab") {
      e.preventDefault();
      closeToTrigger();
      return;
    }
    const list = menuItems(menuRef.current);
    const next = nextIndex(e.key, list.indexOf(e.target as HTMLElement), list.length);
    if (next === null) return;
    // Phím menu đã dùng thì không để lọt lên thẻ/board (thẻ nghe keydown để mở chi tiết).
    e.preventDefault();
    e.stopPropagation();
    list[next]?.focus();
  };

  const trigger = (
    <button
      ref={triggerRef}
      type="button"
      data-kanban-move-trigger=""
      aria-haspopup="menu"
      aria-expanded={open}
      aria-label={t("kanbanMove.trigger", { title: task.title })}
      data-testid={`kanban-card-move-trigger-${task.id}`}
      onClick={() => setOpen((v) => !v)}
      onKeyDown={(e) => {
        if (e.key !== "ArrowDown") return;
        e.preventDefault();
        setOpen(true);
      }}
      className="-m-1 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
    </button>
  );

  return (
    <div className="shrink-0" onClick={stopClick} onKeyDown={stopActivationKeys}>
      <Popover open={open} onOpenChange={setOpen} trigger={trigger} className="min-w-[12rem] p-1">
        <p id={headingId} className="px-2 pb-1 pt-1.5 text-xs font-semibold text-muted-foreground">
          {t("kanbanMove.heading")}
        </p>
        {targets.length === 0 ? (
          <p className="px-2 pb-1.5 text-sm text-muted-foreground">{t("kanbanMove.noTargets")}</p>
        ) : (
          <div ref={menuRef} role="menu" aria-labelledby={headingId} onKeyDown={onMenuKeyDown}>
            {targets.map((target) => (
              <button
                key={target.id}
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => {
                  setOpen(false);
                  move.onMove(task.id, target.id);
                }}
                className="w-full rounded px-2 py-2 text-left text-sm text-foreground hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
              >
                {target.label}
              </button>
            ))}
          </div>
        )}
      </Popover>
    </div>
  );
}

const CARD_SELECTOR = "[data-kanban-card]";

function findCard(taskId: string): HTMLElement | null {
  const cards = Array.from(document.querySelectorAll<HTMLElement>(CARD_SELECTOR));
  return cards.find((card) => card.dataset.kanbanCard === taskId) ?? null;
}

/**
 * Chỗ đặt focus trong khối thẻ: chính khối nếu nhận focus được; không thì mặt thẻ mở-được
 * (`data-kanban-card-open`, S20-TASK-FEDEBT-1 — nút không còn lồng trong mặt thẻ nên mặt thẻ là phần
 * tử CON của khối); không thì nút ⋯ (board không truyền `onOpenTask`).
 */
function focusTargetOf(card: HTMLElement): HTMLElement | null {
  if (card.tabIndex >= 0) return card;
  const face = card.querySelector<HTMLElement>("[data-kanban-card-open]");
  if (face && face.tabIndex >= 0) return face;
  return card.querySelector<HTMLElement>("[data-kanban-move-trigger]");
}

/**
 * Trả focus về thẻ sau khi đổi cột bằng menu. Thẻ đổi cột ⇒ React vẽ thẻ MỚI dưới cột đích (cha khác)
 * ⇒ focus rơi về `body` — một lần lúc lạc quan, thêm một lần nữa nếu server từ chối và thẻ về chỗ cũ.
 * Hook chạy sau MỖI lượt vẽ của board: hễ focus đang ở `body` thì đặt lại vào thẻ (mặt thẻ không nhận
 * focus vì board không truyền `onOpenTask` ⇒ vào nút ⋯ của thẻ). Người dùng focus/bấm chỗ khác ⇒ thôi ngay,
 * không bao giờ giành focus từ chỗ người dùng đang đứng.
 *
 * Hợp đồng DOM: khối thẻ mang `data-kanban-card={task.id}`, mặt thẻ mở-được mang
 * `data-kanban-card-open`, nút ⋯ mang `data-kanban-move-trigger` (cả hai nằm trong khối).
 */
export function useKanbanCardFocusReturn(): (taskId: string) => void {
  const [taskId, setTaskId] = React.useState<string | null>(null);

  // Không mảng phụ thuộc — CỐ Ý: thẻ remount vào lượt vẽ nào thì phải bắt đúng lượt đó.
  React.useEffect(() => {
    if (!taskId) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const card = findCard(taskId);
    if (!card) return;
    focusTargetOf(card)?.focus();
  });

  React.useEffect(() => {
    if (!taskId) return;
    const releaseIfElsewhere = (e: Event) => {
      const owner =
        e.target instanceof Element ? e.target.closest<HTMLElement>(CARD_SELECTOR) : null;
      if (owner?.dataset.kanbanCard !== taskId) setTaskId(null);
    };
    document.addEventListener("focusin", releaseIfElsewhere);
    document.addEventListener("pointerdown", releaseIfElsewhere);
    return () => {
      document.removeEventListener("focusin", releaseIfElsewhere);
      document.removeEventListener("pointerdown", releaseIfElsewhere);
    };
  }, [taskId]);

  return React.useCallback((id: string) => setTaskId(id), []);
}
