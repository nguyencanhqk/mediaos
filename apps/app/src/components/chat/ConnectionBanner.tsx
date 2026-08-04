/**
 * S7-CHAT-FE-2 — dải "mất kết nối" (SPEC-15 §14).
 *
 * HAI chữ khác nhau cho HAI trạng thái, và đó không phải chi tiết thẩm mỹ:
 *   • `disconnected`      → mạng/proxy trục trặc, `socket.io-client` đang tự thử lại ⇒ "đang kết nối lại".
 *   • `polling-fallback`  → server TẮT realtime theo chủ đích (`REALTIME_ENABLED=false`), auto-reconnect
 *                           đã bị tắt ⇒ nói đúng sự thật là "đang cập nhật lại mỗi 10 giây". Bảo người
 *                           dùng "đang kết nối lại" trong khi không có lần thử nào là nói dối, và họ sẽ
 *                           ngồi chờ một việc không bao giờ xảy ra.
 *
 * `connecting` KHÔNG hiện dải: lần bắt tay đầu chỉ mất vài trăm mili-giây, nhấp nháy một dải cảnh báo ở
 * mỗi lần vào phòng làm người dùng tưởng hệ thống hỏng.
 */
import { useTranslation } from "react-i18next";
import { WifiOff } from "lucide-react";
import { useChatStore } from "@/stores/chat.store";

export function ConnectionBanner(): React.ReactElement | null {
  const { t } = useTranslation("chat");
  const status = useChatStore((s) => s.connectionStatus);

  if (status === "connected" || status === "connecting") return null;

  return (
    <p
      className="flex items-center gap-2 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs text-amber-700 dark:text-amber-300"
      role="status"
      data-testid="chat-connection-banner"
    >
      <WifiOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {status === "polling-fallback"
        ? t("connection.pollingFallback")
        : t("connection.reconnecting")}
    </p>
  );
}
