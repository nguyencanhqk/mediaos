/**
 * S17-CHAT-UX2-FE-2 — «Đã xem» dưới tin CỦA TÔI, dạng **dãy avatar** (CHAT-DEC-024 · SPEC-15 §14).
 *
 * Thay dòng chữ "Đã xem: An, Bình" của S7. Lý do đổi: ở phòng 12 người, dòng chữ dài hơn chính tin nhắn
 * và đẩy bong bóng kế tiếp xuống — thứ người dùng muốn biết chỉ là "ai đã đọc", trả lời được bằng ảnh.
 *
 * ⚠️ **Dãy avatar KHÔNG nói gì với trình đọc màn hình.** Ảnh ở đây là trang trí thuần (mỗi `<img>` bên
 * trong `Avatar` mang `alt` là tên, nhưng 5 cái liền nhau đọc lên là một tràng tên không có ngữ cảnh).
 * Nên cả dãy gói trong MỘT phần tử có `aria-label` = đúng câu cũ ("Đã xem: An, Bình") và các avatar bị
 * `aria-hidden`. Bỏ vế này là **mất thông tin** với người dùng bàn phím/đọc màn hình so với bản S7 —
 * một bước lùi trợ năng đội lốt nâng cấp giao diện.
 *
 * S20-CHAT-SEENBY-1 (US-CHAT-QL-03) — phần tử đó giờ là NÚT mở bảng «Đã xem · Chưa xem» (`SeenByPanel`):
 * `Popover` khi có chuột, `Sheet` khi cảm ứng (rê chuột không tồn tại trên điện thoại — `title` cũ không
 * bao giờ hiện ở đó). Nhãn trợ năng giữ NGUYÊN câu «Đã xem: …». Chưa ai xem ⇒ nhãn «Chưa ai xem» vẫn
 * bấm được; roster chưa tải/lỗi ⇒ biểu tượng trạng thái, bảng báo tải/lỗi, không tên nào.
 *
 * Nguồn ảnh là **roster phòng** (`avatarByUser`, CHAT-DEC-019) — KHÔNG ký lẻ theo từng người ở đây.
 */
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Eye, EyeOff } from "lucide-react";
import { Avatar, Popover, Sheet, cn } from "@mediaos/ui";
import { SeenByPanel } from "./SeenByPopover";
import type { SeenByRosterStatus } from "./seen-by-status";

/** Số avatar hiện tối đa; phần dư gộp vào «+N». 3 vừa một hàng dưới bong bóng hẹp nhất. */
const MAX_FACES = 3;

/** Tham chiếu ổn định cho mặc định — tránh mảng mới mỗi lượt vẽ. */
const NO_VIEWERS: readonly SeenByViewer[] = [];

export interface SeenByViewer {
  userId: string;
  /** Tên hiển thị. `null` = roster chưa về / người đã bị xoá ⇒ `Avatar` rơi về "?". */
  name: string | null;
  /** URL ký từ roster. `null` ⇒ chữ cái đầu. */
  avatarUrl: string | null;
}

interface SeenByAvatarsProps {
  /** Người nhận ĐÃ đọc tới tin (đã trừ tôi, người vào sau, người đã rời — `seenByStatusOf`). */
  viewers: readonly SeenByViewer[];
  /** S20-CHAT-SEENBY-1 — người nhận CHƯA đọc. Mặc định rỗng (nơi gọi cũ). */
  unseen?: readonly SeenByViewer[];
  /** S20-CHAT-SEENBY-1 — trạng thái roster. Khác `ready` ⇒ không vẽ danh sách nào. */
  status?: SeenByRosterStatus;
}

type SeenByLayer = "popover" | "sheet";

/** Con trỏ THÔ (ngón tay) ⇒ sheet. Trình duyệt thiếu `matchMedia` / ném lỗi ⇒ coi là chuột. */
function prefersSheet(lastPointerType: string | null): boolean {
  if (lastPointerType === "touch") return true;
  try {
    return (
      typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches
    );
  } catch {
    return false;
  }
}

export function SeenByAvatars({
  viewers,
  unseen = NO_VIEWERS,
  status = "ready",
}: SeenByAvatarsProps): React.ReactElement | null {
  const { t } = useTranslation("chat");
  const [layer, setLayer] = useState<SeenByLayer | null>(null);
  const lastPointerType = useRef<string | null>(null);

  // Không còn ai để xem (phòng chỉ còn tôi) ⇒ KHÔNG vẽ gì (không để lại hàng rỗng làm mọi tin dãn ra).
  if (status === "ready" && viewers.length === 0 && unseen.length === 0) return null;

  // Nhãn liệt kê ĐỦ tên, kể cả phần bị gộp vào «+N» — đây là chỗ duy nhất còn mang thông tin đó.
  const label =
    status === "loading"
      ? t("seenBy.loadingLabel")
      : status === "error"
        ? t("seenBy.errorLabel")
        : viewers.length === 0
          ? t("seenBy.nobody")
          : t("message.seenBy", {
              names: viewers.map((v) => v.name ?? t("message.unknownSender")).join(", "),
            });

  const close = (): void => setLayer(null);
  const panel = (
    <SeenByPanel seen={viewers} unseen={unseen} status={status} onRequestClose={close} />
  );

  const trigger = (
    <button
      type="button"
      className="mt-1 flex items-center gap-1 rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      data-testid="chat-seen-by"
      // `title` cho chuột, `aria-label` cho trình đọc màn hình — hai kênh khác nhau, cần cả hai.
      title={label}
      aria-label={label}
      aria-haspopup="dialog"
      aria-expanded={layer !== null}
      onPointerDown={(e) => {
        lastPointerType.current = e.pointerType || null;
      }}
      onClick={() =>
        setLayer((prev) =>
          prev !== null ? null : prefersSheet(lastPointerType.current) ? "sheet" : "popover",
        )
      }
    >
      <TriggerFace viewers={viewers} status={status} />
    </button>
  );

  return (
    <>
      <Popover
        open={layer === "popover"}
        onOpenChange={(open) => {
          if (!open) close();
        }}
        trigger={trigger}
        className="min-w-0 p-2"
      >
        {panel}
      </Popover>
      {layer === "sheet" && (
        <Sheet
          open
          onClose={close}
          title={t("seenBy.title")}
          className="max-w-sm"
          data-testid="chat-seen-sheet"
        >
          {panel}
        </Sheet>
      )}
    </>
  );
}

function TriggerFace({
  viewers,
  status,
}: {
  viewers: readonly SeenByViewer[];
  status: SeenByRosterStatus;
}): React.ReactElement {
  const { t } = useTranslation("chat");
  if (status !== "ready") {
    const Icon = status === "error" ? EyeOff : Eye;
    return (
      <Icon
        aria-hidden="true"
        className={cn("h-3.5 w-3.5 text-muted-foreground", status === "loading" && "animate-pulse")}
      />
    );
  }
  if (viewers.length === 0) {
    return (
      <span className="text-[11px] leading-none text-muted-foreground" aria-hidden="true">
        {t("seenBy.nobody")}
      </span>
    );
  }
  const faces = viewers.slice(0, MAX_FACES);
  const overflow = viewers.length - faces.length;
  return (
    <>
      {faces.map((v) => (
        <Avatar
          key={v.userId}
          name={v.name}
          src={v.avatarUrl}
          size="sm"
          aria-hidden="true"
          data-testid="chat-seen-avatar"
          // 16px: đủ nhận ra mặt người quen, không cạnh tranh với avatar 28px của người gửi.
          className="h-4 w-4 border border-background text-[8px]"
        />
      ))}
      {overflow > 0 && (
        <span
          className="text-[10px] leading-none text-muted-foreground tabular-nums"
          aria-hidden="true"
          data-testid="chat-seen-overflow"
        >
          {t("message.seenByMore", { count: overflow })}
        </span>
      )}
    </>
  );
}
