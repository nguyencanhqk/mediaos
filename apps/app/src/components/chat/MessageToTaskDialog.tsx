/**
 * S20-CHAT-MSGTOTASK-1 (US-CHAT-NV-10 · gộp US-CHAT-QL-07, US-X-10) — tạo việc từ MỘT tin, ngay trong phòng.
 *
 * KHÔNG phải form thứ hai: bọc `TaskFormDrawer` (chế độ TẠO) với `initialValues` điền từ tin. Guard rời
 * trang, lỗi `submitErrorKey`, lỗi tại ô người phụ trách và invalidation board đều là của form đó.
 *
 * - Chưa gọi API nào tới khi bấm Lưu (điền sẵn = giá trị MẶC ĐỊNH, form «chưa sửa»).
 * - Lưu xong: đóng hộp, VẪN ở phòng, toast «Đã tạo việc · Mở» — «Mở» mở drawer việc chồng trên trang hiện
 *   tại (`?task=`), không chuyển trang.
 * - Phòng không phải dự án ⇒ dự án trống + cảnh báo: nội dung một cuộc trò chuyện kín sắp thành mô tả việc
 *   mà người ngoài phòng xem được.
 * - Chỉ chép VĂN BẢN của tin (xem docblock `message-to-task.ts`).
 * - Không gửi gì vào phòng trừ khi bật «Gửi link việc vào phòng» (mặc định TẮT); bật ⇒ chỉ gửi URL việc.
 *
 * Cổng `create:task` nằm ở `MessageActions` (caller). Thiếu quyền mà gọi API thẳng ⇒ server 403, form hiện
 * lỗi như luồng thường.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";
import { toast } from "@mediaos/ui";
import type { ChatRoomDto, TaskCoreResponseDto } from "@mediaos/contracts";
import type { StoredChatMessage } from "@/stores/chat.store";
import { TaskFormDrawer } from "@/routes/tasks/TaskFormDrawer";
import { useTaskDrawer } from "@/routes/tasks/task-drawer-nav";
import { formatDateTimeShort } from "./chat-format";
import {
  chatMessageUrl,
  descriptionFromMessageBody,
  taskUrl,
  titleFromMessageBody,
} from "./message-to-task";

export interface MessageToTaskDialogProps {
  room: Pick<ChatRoomDto, "id" | "roomType" | "refId" | "name">;
  message: Pick<StoredChatMessage, "id" | "body" | "createdAt">;
  /** Tên người gửi đã tra (tin → roster); `null` ⇒ «Người dùng không xác định». */
  senderName: string | null;
  /**
   * Tin nguồn vừa bị THU HỒI (cha đọc từ store, hộp KHÔNG bị gỡ ngang). Chưa gửi ⇒ hộp tự đóng + báo thu
   * hồi. Đang gửi ⇒ chờ kết quả: thành công ⇒ không gửi link vào phòng, báo «đã tạo nhưng tin gốc vừa bị
   * thu hồi»; lỗi ⇒ đóng + báo thu hồi.
   */
  sourceRecalled?: boolean;
  onClose: () => void;
  /** Gửi MỘT tin chỉ chứa URL việc vào phòng. Bỏ trống (vd phòng lưu trữ) ⇒ không có tuỳ chọn. */
  onSendTaskLink?: (url: string) => void;
}

export function MessageToTaskDialog({
  room,
  message,
  senderName,
  sourceRecalled = false,
  onClose,
  onSendTaskLink,
}: MessageToTaskDialogProps): React.ReactElement {
  const { t } = useTranslation("chat");
  const { openTask } = useTaskDrawer();
  const [sendLink, setSendLink] = useState(false);
  const sendLinkId = useId();
  const warningId = useId();
  const origin = window.location.origin;

  const project =
    room.roomType === "project" && room.refId !== null
      ? { id: room.refId, name: room.name }
      : undefined;

  // Điền MỘT LẦN lúc mở — form chỉ đọc giá trị mặc định ở lượt render đầu.
  const initialValues = useMemo(
    () => ({
      title: titleFromMessageBody(message.body),
      description: descriptionFromMessageBody(
        message.body,
        t("toTask.sourceLine", {
          name: senderName ?? t("message.unknownSender"),
          time: formatDateTimeShort(message.createdAt),
        }),
        chatMessageUrl(origin, room.id, message.id),
      ),
    }),
    [message.body, message.createdAt, message.id, origin, room.id, senderName, t],
  );

  const [isBusy, setBusy] = useState(false);
  // Ref chứ không đọc prop trong closure: `onSuccess` của mutation có thể chạy trên closure của lượt render
  // lúc bấm Lưu — trước khi thu hồi tới. `isDoneRef` chặn báo lần hai sau khi hộp đã tự kết thúc.
  const isRecalledRef = useRef(sourceRecalled);
  isRecalledRef.current = sourceRecalled;
  const isDoneRef = useRef(false);

  // Thu hồi lúc KHÔNG gửi (chưa bấm Lưu, hoặc lần gửi vừa lỗi) ⇒ đóng hộp, không tạo việc từ tin đã gỡ.
  useEffect(() => {
    if (!sourceRecalled || isBusy || isDoneRef.current) return;
    isDoneRef.current = true;
    toast.warning(t("toTask.sourceGone"));
    onClose();
  }, [sourceRecalled, isBusy, onClose, t]);

  const handleSuccess = (task: TaskCoreResponseDto) => {
    isDoneRef.current = true;
    const openAction = { label: t("toTask.open"), onClick: () => openTask(task.id) };
    if (isRecalledRef.current) {
      // Server đã ghi việc với nội dung cũ — nói đúng sự thật, KHÔNG phát thêm link vào phòng.
      toast.warning(t("toTask.createdSourceRecalled"), { action: openAction });
    } else {
      if (sendLink && onSendTaskLink) onSendTaskLink(taskUrl(origin, task.id));
      toast.success(t("toTask.created"), { action: openAction });
    }
    onClose();
  };

  return (
    <TaskFormDrawer
      mode="create"
      onClose={onClose}
      onSuccess={handleSuccess}
      defaultProject={project}
      initialValues={initialValues}
      defaultAssigneeMe
      onBusyChange={setBusy}
      describedById={project === undefined ? warningId : undefined}
      beforeFields={
        project === undefined ? (
          <div
            id={warningId}
            role="note"
            data-testid="message-to-task-visibility-warning"
            className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning-muted px-3 py-2 text-sm font-medium text-foreground"
          >
            <AlertTriangle
              className="mt-0.5 h-4 w-4 shrink-0 text-warning"
              aria-hidden="true"
            />
            <span>{t("toTask.visibilityWarning")}</span>
          </div>
        ) : null
      }
      afterFields={
        onSendTaskLink ? (
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <input
                id={sendLinkId}
                type="checkbox"
                className="h-4 w-4 rounded border-border"
                checked={sendLink}
                onChange={(e) => setSendLink(e.target.checked)}
              />
              <label htmlFor={sendLinkId} className="text-sm text-foreground">
                {t("toTask.sendLinkToRoom")}
              </label>
            </div>
            <p className="pl-6 text-xs text-muted-foreground">{t("toTask.sendLinkHint")}</p>
          </div>
        ) : null
      }
    />
  );
}
