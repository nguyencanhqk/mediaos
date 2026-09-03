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
 * Nguồn ảnh là **roster phòng** (`avatarByUser`, CHAT-DEC-019) — KHÔNG ký lẻ theo từng người ở đây.
 */
import { useTranslation } from "react-i18next";
import { Avatar } from "@mediaos/ui";

/** Số avatar hiện tối đa; phần dư gộp vào «+N». 3 vừa một hàng dưới bong bóng hẹp nhất. */
const MAX_FACES = 3;

export interface SeenByViewer {
  userId: string;
  /** Tên hiển thị. `null` = roster chưa về / người đã bị xoá ⇒ `Avatar` rơi về "?". */
  name: string | null;
  /** URL ký từ roster. `null` ⇒ chữ cái đầu. */
  avatarUrl: string | null;
}

interface SeenByAvatarsProps {
  viewers: readonly SeenByViewer[];
}

export function SeenByAvatars({ viewers }: SeenByAvatarsProps): React.ReactElement | null {
  const { t } = useTranslation("chat");

  // Chưa ai đọc ⇒ KHÔNG vẽ gì (không phải một hàng rỗng cao 16px làm mọi tin dãn thêm một khoảng).
  if (viewers.length === 0) return null;

  const faces = viewers.slice(0, MAX_FACES);
  const overflow = viewers.length - faces.length;
  // Nhãn liệt kê ĐỦ tên, kể cả phần bị gộp vào «+N» — đây là chỗ duy nhất còn mang thông tin đó.
  const names = viewers.map((v) => v.name ?? t("message.unknownSender")).join(", ");
  const label = t("message.seenBy", { names });

  return (
    <div
      className="mt-1 flex items-center gap-1"
      data-testid="chat-seen-by"
      // `title` cho chuột, `aria-label` cho trình đọc màn hình — hai kênh khác nhau, cần cả hai.
      title={label}
      aria-label={label}
      role="img"
    >
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
    </div>
  );
}
