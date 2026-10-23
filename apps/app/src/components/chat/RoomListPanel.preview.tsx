/**
 * Dòng thứ hai của một dòng phòng: NHÁP đang soạn (S20-CHAT-DRAFT-1) hoặc preview tin cuối (S17).
 *
 * Tách khỏi `RoomListPanel.tsx` (đã quá 800 dòng) khi thêm nhánh nháp — cùng lý do `RoomRow` đã tách.
 */
import { useTranslation } from "react-i18next";
import { Paperclip } from "lucide-react";
import { cn } from "@mediaos/ui";
import type { ChatRoomDto } from "@mediaos/contracts";
import { useChatDraftStore } from "./chat-draft.store";

/**
 * S20-CHAT-DRAFT-1 — phòng có nháp CHỮ ⇒ «Nháp: …» thay preview tin cuối (US-CHAT-NV-06).
 *
 * Selector đọc ĐÚNG chuỗi của một phòng: gõ ở phòng A chỉ vẽ lại dòng của A, không vẽ lại cả danh sách.
 * Nháp chỉ có khung trả lời / chỉ có tệp bị bỏ (không chữ) ⇒ KHÔNG hiện nhãn — không có gì để đọc.
 */
export function RoomPreviewLine({
  room,
  isMine,
}: {
  room: ChatRoomDto;
  isMine: boolean;
}): React.ReactElement | null {
  const { t } = useTranslation("chat");
  const draftText = useChatDraftStore((s) => s.drafts[room.id]?.text ?? "");
  if (draftText.trim() === "") return <LastMessagePreviewLine room={room} isMine={isMine} />;

  return (
    <p className="truncate text-xs text-muted-foreground" data-testid="chat-room-draft">
      <span className="font-medium text-primary">{t("rooms.preview.draft")}: </span>
      {draftText}
    </p>
  );
}

/**
 * S17-CHAT-UX2-FE-1 — dòng preview tin cuối (CHAT-DEC-022 · SPEC-15 §14 v2).
 *
 * ⚠️ **`lastMessage === null` ⇒ trả `null`, KHÔNG phải một `<p>` rỗng.** §14: phòng chưa có tin nào thì
 * để trống hẳn — một dòng trắng có chiều cao trông y hệt "đã tải xong nhưng mất chữ".
 *
 * ⚠️ `kind === 'recalled'` PHẢI ra chữ («Tin nhắn đã được thu hồi»), không phải khoảng trắng — cũng §14.
 * `excerpt` của nhánh đó luôn `null` ở server, nên đọc `excerpt` mà không rẽ theo `kind` là mất luôn.
 */
function LastMessagePreviewLine({
  room,
  isMine,
}: {
  room: ChatRoomDto;
  isMine: boolean;
}): React.ReactElement | null {
  const { t } = useTranslation("chat");
  const last = room.lastMessage;
  if (last === null || last === undefined) return null;

  /**
   * Tiền tố người gửi (wireframe §05):
   *   · tin của tôi              ⇒ «Bạn: »
   *   · phòng nhóm/ban/dự án     ⇒ «{tên}: »
   *   · DM, tin của người kia    ⇒ KHÔNG tiền tố (chỉ có hai người, tên đã ở ngay dòng trên)
   *   · tin hệ thống             ⇒ KHÔNG tiền tố (nó không phải lời của ai)
   */
  const prefix =
    last.kind === "system"
      ? null
      : isMine
        ? t("rooms.preview.you")
        : room.roomType === "direct"
          ? null
          : (last.senderName ?? null);

  const body =
    last.kind === "recalled"
      ? t("rooms.preview.recalled")
      : last.excerpt !== null
        ? last.excerpt
        : last.attachmentCount > 0
          ? t("rooms.preview.files", { count: last.attachmentCount })
          : "";

  /**
   * ⚠️ Xét `body` MỘT MÌNH, KHÔNG `&& prefix === null`.
   *
   * `chat_messages.body` NOT NULL nhưng cho phép CHUỖI RỖNG, nên một tin rỗng-0-tệp là hàng hợp lệ ở DB.
   * Với tin như thế của CHÍNH MÌNH (hoặc trong phòng nhóm) thì `prefix` khác null, và điều kiện cũ cho
   * qua ⇒ vẽ ra «Bạn: » — một dòng chỉ có tiền tố và dấu hai chấm. Đó đúng là "dòng trắng gây hiểu nhầm
   * là lỗi" mà SPEC-15 §14 v2 cấm; tiền tố không mang thông tin nào khi không có nội dung đi kèm.
   */
  if (body === "") return null;

  return (
    <p
      className={cn(
        "truncate text-xs text-muted-foreground",
        (last.kind === "recalled" || last.kind === "system") && "italic",
      )}
      data-testid="chat-room-preview"
    >
      {prefix !== null && <span className="font-medium text-foreground/70">{prefix}: </span>}
      {body}
      {/* Kẹp giấy đi KÈM chữ, không thay chữ: `kind:'text'` vẫn có thể có tệp (API-13 §5.1d(1)), và ai
          đọc `kind === 'file'` để suy "có tệp" sẽ bỏ sót đúng ca phổ biến nhất — tin vừa có chữ vừa có ảnh.
          CẢ HAI nhánh `text` và `file` đều vẽ, đúng ký hiệu «📎 {{count}} tệp» của SPEC-15 §14 v2.
          `recalled`/`system` thì KHÔNG: `attachmentCount` của tin đã thu hồi là số liệu LỊCH SỬ vẫn > 0,
          và vẽ kẹp giấy ở đó là nói cho cả phòng biết tin vừa rút có đính kèm. */}
      {(last.kind === "text" || last.kind === "file") && last.attachmentCount > 0 && (
        <Paperclip
          className="ml-1 inline h-3 w-3 align-text-bottom"
          role="img"
          aria-label={t("rooms.preview.attachmentAria", { count: last.attachmentCount })}
          data-testid="chat-room-preview-clip"
        />
      )}
    </p>
  );
}
