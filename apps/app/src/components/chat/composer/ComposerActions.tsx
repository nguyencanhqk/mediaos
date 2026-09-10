/**
 * S17-CHAT-UX2-FE-3 — dải nút bên trái ô nhập: 📎 đính kèm + 🙂 emoji.
 *
 * ⚠️ Cả dải này chỉ render khi ô soạn KHÔNG bị khoá — và điều kiện đó, từ `S7-CHAT-BE-8`, CHÍNH LÀ
 * "phòng chưa lưu trữ + có `send:chat-message`", vì `/chat/files/*` gate đúng cặp ấy. Hiện nút rồi để
 * server trả 403 là mẫu lỗi "UI hứa, backend không đọc"; đổi lại, hỏi thêm một cặp thứ hai (như bản
 * trước BE-8 hỏi `upload:foundation-file`) là ẩn nút của đúng những người server sẵn sàng phục vụ.
 *
 * Component này KHÔNG giữ state nào của nháp — nó chỉ chuyển tệp/emoji ngược lên `MessageComposer`.
 */
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Paperclip } from "lucide-react";
import { Button } from "@mediaos/ui";
import { EmojiPicker } from "./EmojiPicker";

interface ComposerActionsProps {
  /** Tên tệp đang tải lên (`null` = rảnh). Đang tải thì khoá cả hai nút. */
  uploading: string | null;
  onFiles: (files: FileList | null) => void;
  onInsertEmoji: (emoji: string) => void;
}

export function ComposerActions({
  uploading,
  onFiles,
  onInsertEmoji,
}: ComposerActionsProps): React.ReactElement {
  const { t } = useTranslation("chat");
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        data-testid="chat-attach-input"
        onChange={(e) => {
          onFiles(e.target.files);
          e.target.value = ""; // chọn LẠI cùng tệp phải bắn `change` lần nữa
        }}
      />
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t("composer.attachAria")}
        disabled={uploading !== null}
        onClick={() => fileInputRef.current?.click()}
      >
        <Paperclip className="h-4 w-4" aria-hidden="true" />
      </Button>
      <EmojiPicker disabled={uploading !== null} onInsert={onInsertEmoji} />
    </>
  );
}
