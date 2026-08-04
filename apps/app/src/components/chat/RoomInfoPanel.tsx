/**
 * S7-CHAT-FE-2 → mở rộng ở S7-CHAT-FE-4 — cột phải: bảng thông tin phòng (SPEC-15 §9 CHAT-SCREEN-004).
 *
 * BA tab: **Thành viên** (kèm "đã xem tới đâu", §13.2) · **Tệp** (`RoomFilesTab`, CHAT-API-017) ·
 * **Tin ghim**. Tab Tệp về sau FE-2 vì lúc đó `chatApi` chưa mirror `GET /chat/rooms/:id/files`.
 *
 * Cổng thao tác = cặp quyền **VÀ** loại phòng. Phòng `department`/`project` có thành viên DẪN XUẤT từ
 * nhân sự/dự án (§13.3) — server chặn thêm/bớt tay bằng CHAT-ERR-012, nên FE không hiện nút thay vì
 * hiện rồi để người dùng ăn lỗi.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LogOut, Pencil, Pin, Shield, Trash2, UserPlus } from "lucide-react";
import { chatApi, chatKeys, useCan } from "@mediaos/web-core";
import { Avatar, Button, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from "@mediaos/ui";
import type { ChatRoomDto, ChatRoomMemberDto } from "@mediaos/contracts";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmployeeMultiPickerDialog } from "@/components/EmployeeMultiPickerDialog";
import { useChatStore } from "@/stores/chat.store";
import { CHAT_PAIRS } from "@/routes/chat/constants";
import { formatClock } from "./chat-format";
import { RoomFilesTab } from "./RoomFilesTab";

type RoomInfoTab = "members" | "files" | "pinned";

/**
 * S7-CHAT-FE-4 — "đã xem tới đâu" của MỘT thành viên (SPEC-15 §13.2).
 *
 * Dẫn xuất từ `chat_room_members.last_read_seq` — KHÔNG có bảng "đã xem" riêng và không nên có: hai
 * nguồn cho cùng một sự thật sẽ lệch nhau đúng lúc khó tái hiện nhất.
 *
 * ⚠️ `lastReadSeq` là `.optional()` trong `chatRoomMemberSchema` (thêm ở BE-1, giữ optional để caller cũ
 * không gãy). `undefined` = **server không nói gì**, KHÁC `0` = "chưa đọc tin nào". Nhập hai cái làm một
 * sẽ bêu "Chưa xem tin nào" lên toàn bộ danh sách nếu một ngày nào đó payload bỏ trường này.
 */
function seenLabel(
  lastReadSeq: number | undefined,
  lastMessageSeq: number,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  if (lastReadSeq === undefined) return t("info.members.seenUnknown");
  if (lastReadSeq <= 0) return t("info.members.seenNone");
  if (lastReadSeq >= lastMessageSeq) return t("info.members.seenLatest");
  return t("info.members.seenBehind", { count: lastMessageSeq - lastReadSeq });
}

interface RoomInfoPanelProps {
  room: ChatRoomDto;
  members: readonly ChatRoomMemberDto[];
  myRole: "member" | "admin" | null;
  isLoading: boolean;
  loadError: boolean;
  onChanged: () => void;
  /**
   * S7-CHAT-FE-4 — nhảy tới một tin (ghim hoặc tệp) trong hội thoại.
   *
   * Chữ ký đổi từ `(messageId) => boolean` của FE-2: khi đó jump chỉ quét DOM phần ĐÃ TẢI nên phải trả
   * "không thấy". Nay caller nạp hẳn cửa sổ ngữ cảnh quanh `roomSeq`, tức luôn tới được — không còn
   * trạng thái "không tìm thấy trong phần đã tải" để mà báo.
   */
  onJumpToMessage: (messageId: string, roomSeq: number) => void;
  onRoomLeft: () => void;
}

export function RoomInfoPanel({
  room,
  members,
  myRole,
  isLoading,
  loadError,
  onChanged,
  onJumpToMessage,
  onRoomLeft,
}: RoomInfoPanelProps): React.ReactElement {
  const { t } = useTranslation("chat");
  const queryClient = useQueryClient();
  const myUserId = useChatStore((s) => s.myUserId);
  const removeRoomForSelf = useChatStore((s) => s.removeRoomForSelf);

  const canManageMember = useCan(
    CHAT_PAIRS.MANAGE_MEMBER.action,
    CHAT_PAIRS.MANAGE_MEMBER.resourceType,
  );
  const canUpdateRoom = useCan(CHAT_PAIRS.UPDATE_ROOM.action, CHAT_PAIRS.UPDATE_ROOM.resourceType);
  const canArchive = useCan(CHAT_PAIRS.ARCHIVE_ROOM.action, CHAT_PAIRS.ARCHIVE_ROOM.resourceType);

  const [tab, setTab] = useState<RoomInfoTab>("members");
  const [isEditing, setEditing] = useState(false);
  const [name, setName] = useState(room.name ?? "");
  const [description, setDescription] = useState(room.description ?? "");
  const [confirm, setConfirm] = useState<null | "archive" | "leave">(null);
  const [removeTarget, setRemoveTarget] = useState<ChatRoomMemberDto | null>(null);
  const [isPickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isGroup = room.roomType === "group";
  const isDerived = room.roomType === "department" || room.roomType === "project";
  const isRoomAdmin = myRole === "admin";
  const isArchived = room.isArchived ?? false;

  const pinnedQuery = useQuery({
    queryKey: chatKeys.rooms.pinned(room.id),
    queryFn: () => chatApi.getPinned(room.id),
    enabled: tab === "pinned",
  });

  const updateMutation = useMutation({
    mutationFn: () =>
      chatApi.updateRoom(room.id, {
        name: name.trim(),
        description: description.trim().length > 0 ? description.trim() : null,
      }),
    onSuccess: () => {
      setEditing(false);
      setError(null);
      onChanged();
    },
    onError: () => setError(t("info.edit.failed")),
  });

  const archiveMutation = useMutation({
    mutationFn: () => chatApi.archiveRoom(room.id),
    onSuccess: () => {
      setConfirm(null);
      onChanged();
    },
    onError: () => setError(t("info.archive.failed")),
  });

  const leaveMutation = useMutation({
    mutationFn: () => chatApi.leaveRoom(room.id),
    onSuccess: () => {
      setConfirm(null);
      // Dọn NGAY tại client: `leaveRoom` trả `{left:true}` chứ không trả phòng, và sự kiện `chat:room`
      // có thể rơi đúng lúc WS đứt (Socket.IO không bật `connectionStateRecovery`). Chờ nó là để lại
      // một phòng ma bấm vào ăn 404.
      removeRoomForSelf(room.id);
      onRoomLeft();
    },
    onError: () => setError(t("info.leave.failed")),
  });

  const memberMutation = useMutation({
    // Trả `Promise<void>` TƯỜNG MINH: hai nhánh có hình dạng response KHÁC nhau (`{removed:true}` vs
    // `ChatRoomMemberDto` — xem docblock `chat-api.ts`). Không ai đọc kết quả ở đây; danh sách thành
    // viên lấy lại bằng `invalidateQueries`. Để TS suy hợp hai kiểu rồi ép về một là mở đường cho
    // `onSuccess` sau này đọc một khoá chỉ tồn tại ở một nhánh.
    mutationFn: async (
      input:
        | { kind: "remove"; userId: string }
        | { kind: "role"; userId: string; role: "member" | "admin" },
    ): Promise<void> => {
      if (input.kind === "remove") {
        await chatApi.removeMember(room.id, input.userId);
        return;
      }
      await chatApi.updateMember(room.id, input.userId, { role: input.role });
    },
    onSuccess: () => {
      setRemoveTarget(null);
      void queryClient.invalidateQueries({ queryKey: chatKeys.rooms.detail(room.id) });
      onChanged();
    },
    onError: () => setError(t("info.members.actionFailed")),
  });

  return (
    <aside
      className="flex h-full w-80 shrink-0 flex-col border-l border-border"
      aria-label={t("info.title")}
    >
      <header className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">{t("info.title")}</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("info.roomCode")}: <span className="font-mono">{room.roomCode}</span>
        </p>
        {!isEditing && (
          <p className="mt-1 text-xs text-muted-foreground">
            {room.description ?? t("info.descriptionEmpty")}
          </p>
        )}
      </header>

      {error !== null && (
        <p
          className="border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-xs text-destructive"
          role="alert"
        >
          {error}
        </p>
      )}

      {isEditing ? (
        <form
          className="space-y-2 border-b border-border p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim().length === 0) {
              setError(t("info.edit.nameRequired"));
              return;
            }
            updateMutation.mutate();
          }}
        >
          <label className="block text-xs font-medium" htmlFor="chat-room-name">
            {t("info.edit.nameLabel")}
          </label>
          <input
            id="chat-room-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("info.edit.namePlaceholder")}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          />
          <label className="block text-xs font-medium" htmlFor="chat-room-desc">
            {t("info.edit.descriptionLabel")}
          </label>
          <textarea
            id="chat-room-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("info.edit.descriptionPlaceholder")}
            rows={2}
            className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={updateMutation.isPending}>
              {t("info.edit.save")}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setEditing(false)}>
              {t("info.edit.cancel")}
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2 border-b border-border p-3">
          {canUpdateRoom && isGroup && !isArchived && (
            <Button size="sm" variant="outline" className="gap-1" onClick={() => setEditing(true)}>
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              {t("info.edit.button")}
            </Button>
          )}
          {canArchive && !isArchived && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1"
              onClick={() => setConfirm("archive")}
            >
              {t("info.archive.button")}
            </Button>
          )}
          {isGroup && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1"
              onClick={() => setConfirm("leave")}
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
              {t("info.leave.button")}
            </Button>
          )}
        </div>
      )}

      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as RoomInfoTab)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <TabsList className="px-3">
          <TabsTrigger value="members">{t("info.tabs.members")}</TabsTrigger>
          <TabsTrigger value="files">{t("info.tabs.files")}</TabsTrigger>
          <TabsTrigger value="pinned">{t("info.tabs.pinned")}</TabsTrigger>
        </TabsList>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <TabsContent value="members">
            {isLoading ? (
              <div className="space-y-2 p-3" aria-busy="true">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : loadError ? (
              <p className="p-3 text-xs text-muted-foreground">{t("info.members.loadError")}</p>
            ) : (
              <>
                {isDerived && (
                  <p className="px-3 py-2 text-xs text-muted-foreground">
                    {t("info.members.derivedNotice", { type: t(`rooms.types.${room.roomType}`) })}
                  </p>
                )}
                {canManageMember && isGroup && isRoomAdmin && !isArchived && (
                  <div className="px-3 py-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1"
                      onClick={() => setPickerOpen(true)}
                    >
                      <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
                      {t("info.members.add")}
                    </Button>
                  </div>
                )}
                {members.length === 0 ? (
                  <p className="p-3 text-xs text-muted-foreground">{t("info.members.empty")}</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {members.map((member) => (
                      <li
                        key={member.id}
                        className="flex items-center gap-2 px-3 py-2"
                        data-testid="chat-member-row"
                      >
                        <Avatar name={member.userName} size="sm" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm">
                            {member.userName ?? member.userId}
                            {member.userId === myUserId && (
                              <span className="ml-1 text-xs text-muted-foreground">
                                ({t("info.members.you")})
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {member.role === "admin"
                              ? t("info.members.roleAdmin")
                              : t("info.members.roleMember")}
                            {" · "}
                            {seenLabel(member.lastReadSeq, room.lastMessageSeq ?? 0, t)}
                          </p>
                        </div>
                        {canManageMember &&
                          isGroup &&
                          isRoomAdmin &&
                          member.userId !== myUserId && (
                            <div className="flex shrink-0 gap-0.5">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0"
                                aria-label={
                                  member.role === "admin"
                                    ? t("info.members.demote")
                                    : t("info.members.promote")
                                }
                                onClick={() =>
                                  memberMutation.mutate({
                                    kind: "role",
                                    userId: member.userId,
                                    role: member.role === "admin" ? "member" : "admin",
                                  })
                                }
                              >
                                <Shield className="h-3.5 w-3.5" aria-hidden="true" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0"
                                aria-label={t("info.members.remove")}
                                onClick={() => setRemoveTarget(member)}
                              >
                                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                              </Button>
                            </div>
                          )}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </TabsContent>

          <TabsContent value="files">
            {/*
             * `key` theo phòng + chỉ render khi tab đang mở: `RoomFilesTab` ký URL hạn ngắn (300s) và
             * ghi `file_access_logs` mỗi lần gọi. Render sẵn ở nền = ký cả kho tệp cho người chỉ mở tab
             * Thành viên, và bản ghi truy cập đó không phân biệt được với truy cập thật.
             */}
            {tab === "files" && (
              <RoomFilesTab key={room.id} roomId={room.id} onJumpToMessage={onJumpToMessage} />
            )}
          </TabsContent>

          <TabsContent value="pinned">
            {pinnedQuery.isLoading ? (
              <div className="space-y-2 p-3" aria-busy="true">
                <Skeleton className="h-8 w-full" />
              </div>
            ) : pinnedQuery.isError ? (
              <p className="p-3 text-xs text-muted-foreground">{t("info.pinned.loadError")}</p>
            ) : (pinnedQuery.data?.length ?? 0) === 0 ? (
              <p className="p-3 text-xs text-muted-foreground">{t("info.pinned.empty")}</p>
            ) : (
              <ul className="divide-y divide-border">
                {pinnedQuery.data?.map((message) => (
                  <li key={message.id} className="px-3 py-2">
                    <div className="flex items-start gap-2">
                      <Pin
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium">
                          {message.senderName ?? t("message.unknownSender")}
                          <span className="ml-2 font-normal text-muted-foreground tabular-nums">
                            {formatClock(message.createdAt)}
                          </span>
                        </p>
                        {/* Text node — `body` là chuỗi người dùng gõ, React escape (không HTML thô). */}
                        <p className="line-clamp-2 break-words text-xs text-muted-foreground">
                          {message.recalledAt !== null
                            ? t("message.recalled")
                            : (message.body ?? "")}
                        </p>
                        <Button
                          variant="link"
                          size="sm"
                          className="h-auto p-0 text-xs"
                          onClick={() => onJumpToMessage(message.id, message.roomSeq)}
                        >
                          {t("info.pinned.jump")}
                        </Button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <p className="px-3 pb-3 text-[11px] text-muted-foreground">
              {t("info.pinned.limitHint")}
            </p>
          </TabsContent>
        </div>
      </Tabs>

      {isPickerOpen && (
        <EmployeeMultiPickerDialog
          title={t("info.members.addDialogTitle")}
          description={t("info.members.addDialogDescription")}
          isRowDisabled={(employee) =>
            employee.userId === null || members.some((m) => m.userId === employee.userId)
          }
          disabledBadge={(employee) =>
            employee.userId === null ? t("create.direct.noAccount") : t("info.members.alreadyIn")
          }
          disabledRowChecked={(employee) => employee.userId !== null}
          onAddOne={(employee) => {
            if (employee.userId === null) return Promise.reject(new Error("no-user"));
            return chatApi.addMember(room.id, { userId: employee.userId, role: "member" });
          }}
          onBatchSettled={() => {
            void queryClient.invalidateQueries({ queryKey: chatKeys.rooms.detail(room.id) });
            onChanged();
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {confirm === "archive" && (
        <ConfirmDialog
          open
          title={t("info.archive.confirmTitle")}
          description={t("info.archive.confirmBody")}
          confirmLabel={t("info.archive.confirmAction")}
          cancelLabel={t("message.cancel")}
          busy={archiveMutation.isPending}
          onConfirm={() => archiveMutation.mutate()}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm === "leave" && (
        <ConfirmDialog
          open
          title={t("info.leave.confirmTitle")}
          description={t("info.leave.confirmBody")}
          confirmLabel={t("info.leave.confirmAction")}
          cancelLabel={t("message.cancel")}
          destructive
          busy={leaveMutation.isPending}
          onConfirm={() => leaveMutation.mutate()}
          onCancel={() => setConfirm(null)}
        />
      )}
      {removeTarget !== null && (
        <ConfirmDialog
          open
          title={t("info.members.removeConfirmTitle", {
            name: removeTarget.userName ?? removeTarget.userId,
          })}
          description={t("info.members.removeConfirmBody")}
          confirmLabel={t("info.members.remove")}
          cancelLabel={t("message.cancel")}
          destructive
          busy={memberMutation.isPending}
          onConfirm={() => memberMutation.mutate({ kind: "remove", userId: removeTarget.userId })}
          onCancel={() => setRemoveTarget(null)}
        />
      )}
    </aside>
  );
}
