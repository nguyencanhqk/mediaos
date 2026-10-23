/**
 * S20-CHAT-DEEPLINK-1 (US-CHAT-NV-02) — bấm avatar/tên người gửi ⇒ menu nhỏ có «Nhắn riêng».
 *
 * Bên gọi chỉ bọc khi `useCanOpenDirect()` đúng và tin là của NGƯỜI KHÁC, chưa thu hồi, không phải tin
 * hệ thống — thành phần này không tự đoán các điều kiện đó.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { MessageCircle } from "lucide-react";
import { Popover } from "@mediaos/ui";
import { useOpenDirect } from "./use-open-direct";

interface SenderDirectMenuProps {
  peerUserId: string;
  peerName: string;
  /** Avatar hoặc tên — phần nhìn thấy của nút mở menu. */
  children: React.ReactNode;
}

export function SenderDirectMenu({
  peerUserId,
  peerName,
  children,
}: SenderDirectMenuProps): React.ReactElement {
  const { t } = useTranslation("chat");
  const [open, setOpen] = useState(false);
  const { openDirect, pendingPeerId } = useOpenDirect();

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger={
        <button
          type="button"
          className="rounded-full text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={t("direct.menuFor", { name: peerName })}
          data-testid="chat-sender-menu-trigger"
          onClick={() => setOpen((v) => !v)}
        >
          {children}
        </button>
      }
    >
      <div role="menu" aria-label={t("direct.menuFor", { name: peerName })} className="p-1">
        <button
          type="button"
          role="menuitem"
          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
          disabled={pendingPeerId === peerUserId}
          onClick={() => {
            setOpen(false);
            openDirect(peerUserId);
          }}
        >
          <MessageCircle className="h-4 w-4" aria-hidden="true" />
          {t("direct.action")}
        </button>
      </div>
    </Popover>
  );
}
