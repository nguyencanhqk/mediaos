/**
 * S17-CHAT-UX2-FE-2 — khung trống dạng **hero** của cột giữa (SPEC-15 §14 · gap G4 của hồ sơ wave).
 *
 * Thay `EmptyState` icon-xám + 2 dòng chữ. Khung trống là màn hình ĐẦU TIÊN người dùng thấy khi mở
 * `/chat`, và một icon xám không nói họ làm gì tiếp — hero nói, kèm đúng hai lối đi có thật.
 *
 * ⚠️ Nút "Tin nhắn mới" ĐI THEO CỔNG `create:chat-room`: caller không truyền `onCreateRoom` khi thiếu
 * cặp ⇒ nút KHÔNG render. Hiện nút rồi để server trả 403 là dạy người dùng một lối đi không tồn tại
 * (SPEC-15 §14 · cùng luật đã áp cho `RoomAvatarEditor`, `RoomRowMenu.canArchive`).
 */
import { useTranslation } from "react-i18next";
import { MessageSquarePlus, MessagesSquare, Search } from "lucide-react";
import { Button } from "@mediaos/ui";

interface ChatEmptyHeroProps {
  title: string;
  description: string;
  /** `undefined` = KHÔNG có cặp `create:chat-room` (hoặc ngữ cảnh không tạo phòng được) ⇒ ẩn nút. */
  onCreateRoom?: () => void;
  /** `undefined` = ngữ cảnh không có cột tìm kiếm (drawer FE-5) ⇒ ẩn nút. */
  onOpenSearch?: () => void;
}

export function ChatEmptyHero({
  title,
  description,
  onCreateRoom,
  onOpenSearch,
}: ChatEmptyHeroProps): React.ReactElement {
  const { t } = useTranslation("chat");

  return (
    <div
      className="flex h-full flex-1 flex-col items-center justify-center gap-4 px-6 py-12 text-center"
      data-testid="chat-empty-hero"
    >
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-muted text-brand">
        <MessagesSquare className="h-8 w-8" strokeWidth={1.5} aria-hidden="true" />
      </span>

      <div className="max-w-sm space-y-1">
        <p className="text-base font-semibold text-foreground">{title}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>

      {(onCreateRoom || onOpenSearch) && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {onCreateRoom && (
            <Button size="sm" data-testid="chat-hero-create" onClick={onCreateRoom}>
              <MessageSquarePlus className="mr-1.5 h-4 w-4" aria-hidden="true" />
              {t("conversation.heroCreate")}
            </Button>
          )}
          {onOpenSearch && (
            <Button
              size="sm"
              variant="outline"
              data-testid="chat-hero-search"
              onClick={onOpenSearch}
            >
              <Search className="mr-1.5 h-4 w-4" aria-hidden="true" />
              {t("conversation.heroSearch")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
