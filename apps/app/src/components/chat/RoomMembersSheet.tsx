/**
 * S17-CHAT-UX2-FE-4 — danh sách thành viên phòng, chuyển từ TAB sang **Sheet** (SPEC-15 §9 SCREEN-004 v2
 * · CHAT-DEC-025). Nội dung giữ nguyên của S7-CHAT-FE-4/S8-CHAT-UX-FE-3, chỉ đổi vỏ chứa.
 *
 * Cổng thao tác = cặp quyền **VÀ** loại phòng **VÀ** vai trò trong phòng. Phòng `department`/`project`
 * có thành viên DẪN XUẤT từ nhân sự/dự án (§13.3) — server chặn thêm/bớt tay bằng CHAT-ERR-012, nên FE
 * không hiện nút thay vì hiện rồi để người dùng ăn lỗi.
 *
 * ⚠️ Chấm "đang online" là ẢNH CHỤP lúc nạp roster, KHÔNG phải luồng sống — `chat:presence` chỉ fan-out
 * tới peer của phòng `direct` (cố ý, xem `chat.store.ts`). Với phòng nhóm/phòng-ban/dự án, chấm chỉ mới
 * lại khi roster refetch. Ghi ra đây để không ai đọc nó như thời-gian-thực.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Shield, Trash2 } from "lucide-react";
import { chatApi, chatKeys, useCan } from "@mediaos/web-core";
import { Avatar, Button, Sheet, Skeleton } from "@mediaos/ui";
import type { ChatRoomDto, ChatRoomMemberDto } from "@mediaos/contracts";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useChatStore } from "@/stores/chat.store";
import { CHAT_PAIRS } from "@/routes/chat/constants";

/**
 * S7-CHAT-FE-4 — "đã xem tới đâu" của MỘT thành viên (SPEC-15 §13.2).
 *
 * Dẫn xuất từ `chat_room_members.last_read_seq` — KHÔNG có bảng "đã xem" riêng và không nên có: hai
 * nguồn cho cùng một sự thật sẽ lệch nhau đúng lúc khó tái hiện nhất.
 *
 * ⚠️ `lastReadSeq` là `.optional()` trong `chatRoomMemberSchema`. `undefined` = **server không nói gì**,
 * KHÁC `0` = "chưa đọc tin nào". Nhập hai cái làm một sẽ bêu "Chưa xem tin nào" lên toàn bộ danh sách
 * nếu một ngày nào đó payload bỏ trường này — một lời khẳng định sai về người thật.
 */
export function seenLabel(
  lastReadSeq: number | undefined,
  lastMessageSeq: number,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  if (lastReadSeq === undefined) return t("info.members.seenUnknown");
  if (lastReadSeq <= 0) return t("info.members.seenNone");
  if (lastReadSeq >= lastMessageSeq) return t("info.members.seenLatest");
  return t("info.members.seenBehind", { count: lastMessageSeq - lastReadSeq });
}

interface RoomMembersSheetProps {
  open: boolean;
  onClose: () => void;
  room: ChatRoomDto;
  members: readonly ChatRoomMemberDto[];
  myRole: "member" | "admin" | null;
  isLoading: boolean;
  loadError: boolean;
  onChanged: () => void;
}

export function RoomMembersSheet({
  open,
  onClose,
  room,
  members,
  myRole,
  isLoading,
  loadError,
  onChanged,
}: RoomMembersSheetProps): React.ReactElement {
  const { t } = useTranslation("chat");
  const queryClient = useQueryClient();
  const myUserId = useChatStore((s) => s.myUserId);
  /**
   * Ai đang online, đọc TỪ STORE chứ không nhận qua prop: `useRoomRoster` (mount trong
   * `ConversationPanel`, cùng phòng, cùng màn hình) đổ ảnh chụp vào, rồi `chat:presence` vá tiếp cho
   * peer DM. Đi qua store là hai nguồn đó hoà vào MỘT chỗ; kéo prop từ trang xuống sẽ tạo nguồn thứ
   * hai và hai chấm sẽ lệch nhau.
   */
  const presenceByUser = useChatStore((s) => s.presenceByUser);
  const onlineUserIds = useMemo(
    () =>
      new Set(
        Object.entries(presenceByUser)
          .filter(([, on]) => on)
          .map(([id]) => id),
      ),
    [presenceByUser],
  );

  const canManageMember = useCan(
    CHAT_PAIRS.MANAGE_MEMBER.action,
    CHAT_PAIRS.MANAGE_MEMBER.resourceType,
  );

  const [removeTarget, setRemoveTarget] = useState<ChatRoomMemberDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isGroup = room.roomType === "group";
  const isDerived = room.roomType === "department" || room.roomType === "project";
  const isRoomAdmin = myRole === "admin";

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
    <Sheet
      open={open}
      onClose={onClose}
      title={t("info.members.sheetTitle", { count: members.length })}
      className="max-w-md"
      data-testid="chat-members-sheet"
    >
      {error !== null && (
        <p
          className="mb-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
          role="alert"
        >
          {error}
        </p>
      )}

      {isLoading ? (
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : loadError ? (
        <p className="text-xs text-muted-foreground">{t("info.members.loadError")}</p>
      ) : (
        <>
          {isDerived && (
            <p className="pb-2 text-xs text-muted-foreground">
              {t("info.members.derivedNotice", { type: t(`rooms.types.${room.roomType}`) })}
            </p>
          )}
          {members.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("info.members.empty")}</p>
          ) : (
            <ul className="divide-y divide-border">
              {members.map((member) => (
                <li
                  key={member.id}
                  className="flex items-center gap-2 py-2"
                  data-testid="chat-member-row"
                >
                  <span className="relative shrink-0">
                    <Avatar name={member.userName} size="sm" />
                    {onlineUserIds.has(member.userId) && (
                      <>
                        <span
                          className="absolute right-0 bottom-0 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-background"
                          aria-hidden="true"
                          data-testid="chat-member-online-dot"
                        />
                        <span className="sr-only">{t("presence.online")}</span>
                      </>
                    )}
                  </span>
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
                  {canManageMember && isGroup && isRoomAdmin && member.userId !== myUserId && (
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
    </Sheet>
  );
}
