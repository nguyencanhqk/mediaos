/**
 * S8-CHAT-UX-FE-3 — dải "đang gõ" của một phòng (CHAT-DEC-017).
 *
 * ══ VÌ SAO MỘT `setInterval` DUY NHẤT, KHÔNG PHẢI MỘT `setTimeout` MỖI SỰ KIỆN ══
 * Bản năng đầu tiên là: nhận ping của người X ⇒ đặt `setTimeout(5s)` để xoá X. Với một phòng 20 người
 * đang gõ và mỗi người ping 3 s/lần, cách đó dựng ~7 timer/giây và mỗi timer lại phải bị huỷ khi ping kế
 * tiếp của cùng người tới — một sổ timer phải tự quản lý, rò rỉ ngay khi có một nhánh return sớm quên
 * `clearTimeout`. Ở đây trạng thái là **mốc hết hạn** trong store; component chỉ cần một nhịp 1 s gọi
 * `pruneTyping()`, và `pruneTyping` trả CHÍNH state cũ khi không có gì hết hạn nên nhịp rỗng không
 * re-render gì.
 *
 * Nhịp chỉ chạy khi phòng THẬT SỰ có người đang gõ — không có ai thì không có timer nào sống.
 */
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useChatStore } from "@/stores/chat.store";

/** Nhịp dọn. 1 s: đủ mịn để chỉ báo tắt "đúng lúc" với mắt người, đủ thưa để không tốn gì. */
const PRUNE_INTERVAL_MS = 1000;

/** Quá số này thì đổi sang "N người đang gõ…" — liệt kê 8 cái tên là một dòng chữ không ai đọc. */
const MAX_NAMES_SHOWN = 2;

interface TypingIndicatorProps {
  roomId: string;
  /** `userId → tên hiển thị` từ roster. Thiếu tên ⇒ người đó vẫn được ĐẾM, chỉ không được nêu tên. */
  nameByUser: ReadonlyMap<string, string>;
}

export function TypingIndicator({
  roomId,
  nameByUser,
}: TypingIndicatorProps): React.ReactElement | null {
  const { t } = useTranslation("chat");
  const typing = useChatStore((s) => s.typingByRoom[roomId]);
  const pruneTyping = useChatStore((s) => s.pruneTyping);

  const userIds = typing ? Object.keys(typing) : [];
  const hasTyping = userIds.length > 0;

  useEffect(() => {
    if (!hasTyping) return;
    const id = setInterval(() => pruneTyping(), PRUNE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [hasTyping, pruneTyping]);

  if (!hasTyping) return null;

  const names = userIds.map((id) => nameByUser.get(id)).filter((n): n is string => Boolean(n));

  // Có người gõ nhưng CHƯA tra được tên nào (roster chưa về): vẫn phải nói có người đang gõ. Trả `null` ở
  // đây làm chỉ báo im lặng biến mất đúng vào lúc phòng vừa mở — trạng thái không phân biệt được với hỏng.
  const label =
    names.length === 0
      ? t("typing.someone", { count: userIds.length })
      : names.length <= MAX_NAMES_SHOWN
        ? t("typing.names", { names: names.join(", ") })
        : t("typing.many", { count: userIds.length });

  return (
    <p
      className="px-4 py-1 text-xs italic text-muted-foreground"
      // `role="status"` + `aria-live="polite"`: chỉ báo này đổi liên tục, "polite" để trình đọc màn hình
      // đọc nốt câu đang đọc thay vì cắt ngang mỗi lần ai đó gõ thêm một phím.
      role="status"
      aria-live="polite"
      data-testid="chat-typing-indicator"
    >
      {label}
    </p>
  );
}
