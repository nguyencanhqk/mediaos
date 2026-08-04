/**
 * S7-CHAT-FE-5 🔒 — phòng ở chế độ CHỈ ĐỌC (phần thứ 3 của CHAT-SCREEN-007).
 *
 * ┌─ VÌ SAO ĐÂY LÀ COMPONENT MỚI CHỨ KHÔNG PHẢI `ConversationPanel` CÓ CỜ `readOnly` ────────────────┐
 * │ `ConversationPanel` (apps/app) mang `MessageComposer`, nút ghim, nút thu hồi, sửa thành viên. Tái │
 * │ dùng nó với một cờ boolean nghĩa là chế độ chỉ-đọc chỉ đúng chừng nào MỌI call-site sau này còn   │
 * │ nhớ truyền cờ — và mặc định của một cờ quên truyền là `false`. Ở đây chế độ chỉ đọc đến từ chỗ    │
 * │ KHÁC: `apps/console` không import được gì từ `apps/app`, và `ChatOversightRoomDetailDto` KHÔNG có │
 * │ `myRole` (`packages/contracts/src/chat.ts:544`) nên không có dữ liệu nào để bật nút quản trị.     │
 * │ Backend cũng chỉ mở 4 route GET dưới `/chat/oversight/` — không có gì để gọi kể cả khi lỡ dựng nút.│
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ Đính kèm render **metadata thuần**: `ChatOversightAttachmentDto` không có `url`/`thumbnailUrl`
 * (API-13 §5.3 ràng buộc 7 — CHAT-DEC-004 mở ranh giới MEMBERSHIP, KHÔNG mở đường tải tệp). Tuyệt đối
 * không dựng `<a href>` hay `<img src>` ở đây; test đếm số `link` trong danh sách đính kèm = 0.
 */
import { useMemo } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ArrowLeft, MessageSquareOff, Paperclip, Pin, Users } from "lucide-react";
import type { ChatOversightMessageDto, ChatOversightRoomSummaryDto } from "@mediaos/contracts";
import { Badge, Button, EmptyState } from "@mediaos/ui";
import { chatOversightApi } from "@mediaos/web-core";
import { formatBytes, formatDateTime, olderCursorOf, roomLabel } from "./chat-oversight-format";

/** Số tin mỗi lần tải. Trần server là 100 (`chatOversightMessagesQuerySchema`). */
const MESSAGE_PAGE_SIZE = 50;

interface OversightRoomViewProps {
  room: ChatOversightRoomSummaryDto;
  onBack: () => void;
}

export function OversightRoomView({ room, onBack }: OversightRoomViewProps) {
  const { t } = useTranslation("chat-oversight");

  // 018b — chi tiết + thành viên. `refetchOnWindowFocus: false` ở CẢ HAI query: mỗi lần gọi lại là một
  // dòng audit `Success` mới, và một dòng audit phải tương ứng với một hành động của người dùng, không
  // phải với việc họ chuyển sang cửa sổ khác rồi quay lại.
  const detail = useQuery({
    queryKey: ["console:chat-oversight:room", room.id],
    queryFn: () => chatOversightApi.getRoom(room.id),
    refetchOnWindowFocus: false,
    retry: false,
  });

  // 018c — cuộn NGƯỢC theo `beforeSeq` (loại trừ). Server luôn trả TĂNG DẦN theo `roomSeq`, nên trang
  // sau là trang CŨ HƠN ⇒ thứ tự hiển thị = đảo danh sách trang rồi nối.
  //
  // ⚠️ Suy "hết lịch sử" từ `length < limit` chỉ ĐÚNG ở endpoint này: truy vấn là LIMIT thuần trên dải
  // `roomSeq`, không có `trimToMessageBoundary` như đường `/chat/rooms/:id/files` (ở đó trang ngắn hơn
  // `limit` KHÔNG chứng minh gì cả). Nhờ vậy nút "Tải thêm" không đốt thêm một dòng audit chỉ để phát
  // hiện ra là đã hết.
  const messages = useInfiniteQuery({
    queryKey: ["console:chat-oversight:messages", room.id],
    initialPageParam: null as number | null,
    queryFn: ({ pageParam }) =>
      chatOversightApi.listMessages(room.id, {
        limit: MESSAGE_PAGE_SIZE,
        ...(pageParam === null ? {} : { beforeSeq: pageParam }),
      }),
    getNextPageParam: (lastPage) =>
      lastPage.length < MESSAGE_PAGE_SIZE ? undefined : olderCursorOf(lastPage),
    refetchOnWindowFocus: false,
    retry: false,
  });

  const orderedMessages = useMemo<ChatOversightMessageDto[]>(
    () => [...(messages.data?.pages ?? [])].reverse().flat(),
    [messages.data],
  );

  const members = detail.data?.members ?? [];
  const description = detail.data?.description ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="outline" size="sm" onClick={onBack}>
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          {t("room.back")}
        </Button>
        <Badge variant="destructive">{t("room.readOnlyBadge")}</Badge>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        {/* ── Dòng tin (chỉ đọc) ────────────────────────────────────────────────────────────── */}
        <section
          aria-label={t("room.messagesLabel")}
          className="min-w-0 rounded-lg border border-border bg-card"
        >
          <header className="border-b border-border px-4 py-3">
            <h2 className="truncate font-medium text-foreground">{roomLabel(room)}</h2>
            <p className="text-xs text-muted-foreground">
              {room.roomCode} · {t(`roomType.${room.roomType}`)}
            </p>
          </header>

          <div className="space-y-3 p-4">
            {messages.hasNextPage && (
              <div className="flex justify-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void messages.fetchNextPage()}
                  disabled={messages.isFetchingNextPage}
                >
                  {messages.isFetchingNextPage ? t("common.loading") : t("room.loadOlder")}
                </Button>
              </div>
            )}

            {messages.isPending && (
              <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
            )}

            {messages.isError && (
              <p role="alert" aria-live="assertive" className="text-sm text-destructive">
                {t("room.messagesError")}
              </p>
            )}

            {!messages.isPending && !messages.isError && orderedMessages.length === 0 && (
              <EmptyState
                icon={MessageSquareOff}
                title={t("room.emptyTitle")}
                description={t("room.emptyDescription")}
              />
            )}

            {orderedMessages.map((message) => (
              <OversightMessageRow key={message.id} message={message} />
            ))}
          </div>
        </section>

        {/* ── Thông tin phòng + thành viên ──────────────────────────────────────────────────── */}
        <aside
          aria-label={t("room.infoLabel")}
          className="h-fit space-y-4 rounded-lg border border-border bg-card p-4"
        >
          <div className="space-y-1">
            <h3 className="text-sm font-medium text-foreground">{t("room.infoLabel")}</h3>
            {detail.isPending && (
              <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
            )}
            {detail.isError && (
              <p role="alert" aria-live="assertive" className="text-sm text-destructive">
                {t("room.detailError")}
              </p>
            )}
            {description !== null && <p className="text-sm text-muted-foreground">{description}</p>}
            {room.isArchived && <Badge variant="secondary">{t("room.archived")}</Badge>}
          </div>

          <div className="space-y-2">
            <h3 className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              <Users className="h-4 w-4" />
              {t("room.members", { count: members.length })}
            </h3>
            <ul className="space-y-1">
              {members.map((member) => (
                <li
                  key={member.id}
                  className="flex items-center justify-between gap-2 text-sm text-muted-foreground"
                >
                  <span className="truncate">{member.userName ?? member.userId}</span>
                  {member.role === "admin" && (
                    <Badge variant="outline">{t("room.roleAdmin")}</Badge>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}

/** Một dòng tin ở chế độ chỉ đọc — KHÔNG có nút hành động nào. */
function OversightMessageRow({ message }: { message: ChatOversightMessageDto }) {
  const { t } = useTranslation("chat-oversight");
  const isRecalled = message.recalledAt !== null;

  return (
    <article className="rounded-md border border-border/60 bg-background/60 p-3">
      <header className="flex flex-wrap items-baseline gap-2">
        <span className="text-sm font-medium text-foreground">
          {message.senderName ?? t("room.unknownSender")}
        </span>
        <time className="text-xs text-muted-foreground">{formatDateTime(message.createdAt)}</time>
        <span className="text-xs text-muted-foreground">#{message.roomSeq}</span>
        {message.pinnedAt !== null && (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Pin className="h-3 w-3" />
            {t("room.pinned")}
          </span>
        )}
      </header>

      {/* `body === null` = tin đã thu hồi. Đường đọc-vượt KHÔNG nới lớp masking (SPEC-15 §13.6):
          CHAT-DEC-004 mở ranh giới membership, không mở nội dung đã bị thu hồi. */}
      {isRecalled || message.body === null ? (
        <p className="mt-1 text-sm italic text-muted-foreground">{t("room.recalled")}</p>
      ) : (
        <p className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground">
          {message.body}
        </p>
      )}

      {message.attachments.length > 0 && (
        <ul className="mt-2 space-y-1" aria-label={t("room.attachments")}>
          {message.attachments.map((file) => (
            // KHÔNG phải link: DTO không mang URL ký, và không được mang. Đây là DÒNG CHỮ mô tả tệp.
            <li key={file.fileId} className="flex items-center gap-2 text-xs text-muted-foreground">
              <Paperclip className="h-3 w-3 shrink-0" />
              <span className="truncate">{file.name}</span>
              <span className="shrink-0">{formatBytes(file.sizeBytes)}</span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
