/**
 * S7-CHAT-FE-2 → **v2 ở S17-CHAT-UX2-FE-4** — cột phải: bảng thông tin phòng (SPEC-15 §9
 * CHAT-SCREEN-004 v2 · §22c **CHAT-DEC-025**).
 *
 * Bố cục DỌC thay cho 3 tab: avatar lớn · tên (bút nếu đủ quyền) · «Tạo bởi … · ngày» → 3 hành động
 * tròn → «Thành viên (N) ›» mở Sheet → accordion Ảnh/Video · Tệp · Liên kết · Tin ghim → cuối: Lưu trữ
 * + Rời nhóm. **Không** nhãn «mã hoá» (MediaOS không có E2E), không nhắc hẹn/huy hiệu.
 *
 * ┌─ BA luật của màn này, cả ba đều là RÀNG BUỘC chứ không phải gu thẩm mỹ ───────────────────────────┐
 * │ 1. **«Tắt thông báo» và «Ghim» KHÔNG bọc cổng quyền.** Hai thứ đó là TUỲ CHỌN CÁ NHÂN; server gate │
 * │    chúng bằng đúng cặp của đường đọc phòng (`view:chat-room`). Gate mạnh hơn ở FE đẻ ra role "đọc  │
 * │    được phòng mà không tắt nổi thông báo của chính mình"                                          │
 * │    (memory `personal-prefs-must-not-sit-behind-permission-gate`). Chỉ «Thêm thành viên» hỏi cặp.   │
 * │ 2. **Accordion đóng ⇒ KHÔNG gọi API.** Mỗi lần đọc đường tệp là một hàng `file_access_logs` — nạp  │
 * │    sẵn ở nền là ghi nhật ký truy cập cho thứ người dùng chưa mở, và bản ghi đó về sau không phân   │
 * │    biệt được với truy cập thật. `AccordionContent` unmount thân khi đóng, đó là cách luật này được │
 * │    ép chứ không phải bằng kỷ luật gọi hàm.                                                        │
 * │ 3. **`before` của prefs chụp TẠI ĐIỂM BẤM.** `mutationFn` giữ closure của lần render tạo ra nó ⇒   │
 * │    đọc `room` trong đó là đọc ảnh chụp cũ và hoàn nguyên về một giá trị đã lỗi thời                │
 * │    (memory `react-query-v5-stale-mutationfn-closure`).                                            │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Cổng thao tác QUẢN TRỊ = cặp quyền **VÀ** loại phòng. Phòng `department`/`project` có thành viên DẪN
 * XUẤT từ nhân sự/dự án (§13.3) — server chặn thêm/bớt tay bằng CHAT-ERR-012, nên FE không hiện nút
 * thay vì hiện rồi để người dùng ăn lỗi.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  BellOff,
  BellRing,
  ChevronRight,
  LogOut,
  Pencil,
  Pin,
  PinOff,
  UserPlus,
} from "lucide-react";
import { chatApi, chatKeys, useCan } from "@mediaos/web-core";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Button,
  Popover,
  cn,
} from "@mediaos/ui";
import type { ChatRoomDto, ChatRoomMemberDto } from "@mediaos/contracts";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmployeeMultiPickerDialog } from "@/components/EmployeeMultiPickerDialog";
import { useChatStore } from "@/stores/chat.store";
import { CHAT_PAIRS } from "@/routes/chat/constants";
import { MUTE_PRESETS, isRoomMuted, isRoomPinned } from "./chat-room-prefs";
import { useRoomPrefs } from "./use-room-prefs";
import { RoomAvatar } from "./RoomAvatar";
import { RoomAvatarEditor } from "./RoomAvatarEditor";
import { RoomFilesTab } from "./RoomFilesTab";
import { RoomLinksList } from "./RoomLinksList";
import { RoomMembersSheet } from "./RoomMembersSheet";
import { RoomMediaGrid } from "./room-info/RoomMediaGrid";
import { RoomPinnedList } from "./room-info/RoomPinnedList";

/** `dd/MM/yyyy` giờ ĐỊA PHƯƠNG cho dòng «Tạo bởi … · ngày». Mốc rác ⇒ chuỗi rỗng, không "Invalid Date". */
function formatCreatedDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${d.getFullYear()}`;
}

interface RoomInfoPanelProps {
  room: ChatRoomDto;
  members: readonly ChatRoomMemberDto[];
  myRole: "member" | "admin" | null;
  /**
   * S17-CHAT-UX2-BE-1 — họ tên người tạo phòng, CHỈ có ở `GET /chat/rooms/:id` (`chatRoomDetailSchema`),
   * không ở DTO danh sách. `null` = phòng do HỆ THỐNG dựng (`department`/`project`) hoặc không tra được
   * hàng `users`; `undefined` = server cũ. Cả hai ⇒ **ẩn hẳn dòng**, không bịa "Không rõ".
   */
  createdByName?: string | null;
  isLoading: boolean;
  loadError: boolean;
  onChanged: () => void;
  /**
   * S7-CHAT-FE-4 — nhảy tới một tin (ghim, tệp hoặc liên kết) trong hội thoại. Caller nạp hẳn cửa sổ
   * ngữ cảnh quanh `roomSeq`, tức luôn tới được — không còn trạng thái "không tìm thấy" để mà báo.
   */
  onJumpToMessage: (messageId: string, roomSeq: number) => void;
  onRoomLeft: () => void;
  /**
   * S17-CHAT-UX2-FE-5 — panel này đứng thành CỘT hay nằm trong một `Sheet` (CHAT-DEC-026).
   *
   *   `page`  (mặc định) cột phải của `/chat` ở mốc ≥1280: 340px + viền trái
   *   `sheet` mốc <1280: bản thân `Sheet` đã có viền, nền và bề rộng riêng ⇒ panel chiếm hết vật chứa
   *
   * Chỉ khác vỏ. Nội dung, cổng quyền, 4 nhánh tư cách của `RoomAvatarEditor` (DEC-016) giữ nguyên —
   * hai bản khác nội dung là hai bảng thông tin phải nuôi song song.
   */
  variant?: "page" | "sheet";
}

export function RoomInfoPanel({
  room,
  members,
  myRole,
  createdByName,
  isLoading,
  loadError,
  onChanged,
  onJumpToMessage,
  onRoomLeft,
  variant = "page",
}: RoomInfoPanelProps): React.ReactElement {
  const { t } = useTranslation("chat");
  const queryClient = useQueryClient();
  const removeRoomForSelf = useChatStore((s) => s.removeRoomForSelf);

  const canManageMember = useCan(
    CHAT_PAIRS.MANAGE_MEMBER.action,
    CHAT_PAIRS.MANAGE_MEMBER.resourceType,
  );
  const canUpdateRoom = useCan(CHAT_PAIRS.UPDATE_ROOM.action, CHAT_PAIRS.UPDATE_ROOM.resourceType);
  const canArchive = useCan(CHAT_PAIRS.ARCHIVE_ROOM.action, CHAT_PAIRS.ARCHIVE_ROOM.resourceType);

  const [openSections, setOpenSections] = useState<string[]>([]);
  const [isMembersOpen, setMembersOpen] = useState(false);
  const [isMuteMenuOpen, setMuteMenuOpen] = useState(false);
  const [isEditing, setEditing] = useState(false);
  const [name, setName] = useState(room.name ?? "");
  const [description, setDescription] = useState(room.description ?? "");
  const [confirm, setConfirm] = useState<null | "archive" | "leave">(null);
  const [isPickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isGroup = room.roomType === "group";
  const isRoomAdmin = myRole === "admin";
  const isArchived = room.isArchived ?? false;
  const label = room.name ?? room.roomCode;
  const pinned = isRoomPinned(room);
  const muted = isRoomMuted(room);

  /** Tuỳ chọn CÁ NHÂN (ghim/tắt thông báo) — cùng hook với menu ngữ cảnh ở danh sách phòng. */
  const prefs = useRoomPrefs(setError);
  /** Ảnh chụp giá trị TRƯỚC, gọi TẠI ĐIỂM BẤM (luật 3 ở docblock đầu file). */
  const prefsSnapshot = () => ({ pinnedAt: room.pinnedAt, mutedUntil: room.mutedUntil });

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

  const createdDate = formatCreatedDate(room.createdAt);

  return (
    <aside
      className={cn(
        "flex h-full min-h-0 flex-col",
        // 340px theo CHAT-DEC-026 (§9 SCREEN-001 v2 — 320/co giãn/340). Trước FE-5 là `w-80` (320px).
        variant === "page" ? "w-[340px] shrink-0 border-l border-border" : "w-full",
      )}
      aria-label={t("info.title")}
      data-testid="chat-room-info"
      data-variant={variant}
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col items-center gap-1.5 px-4 pt-4 pb-3 text-center">
          <RoomAvatar room={room} label={label} size="lg" className="h-16 w-16 text-lg" />
          <div className="flex items-center gap-1">
            <h2 className="text-base font-semibold break-words">{label}</h2>
            {canUpdateRoom && isGroup && !isArchived && (
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={t("info.edit.button")}
                onClick={() => setEditing(true)}
                data-testid="chat-info-edit"
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            )}
          </div>

          {/* Không có người tạo (phòng hệ thống) hoặc server cũ ⇒ ẩn HẲN dòng, không bịa "Không rõ". */}
          {createdByName !== null && createdByName !== undefined && createdByName.length > 0 && (
            <p className="text-xs text-muted-foreground" data-testid="chat-info-created-by">
              {t("info.createdBy", { name: createdByName, date: createdDate })}
            </p>
          )}

          <p className="text-xs text-muted-foreground">
            {t("info.roomCode")}: <span className="font-mono">{room.roomCode}</span>
          </p>
          {!isEditing && (
            <p className="text-xs text-muted-foreground">
              {room.description ?? t("info.descriptionEmpty")}
            </p>
          )}

          {/*
           * Đặt/gỡ ảnh đại diện — component TỰ trả `null` khi người xem không đủ tư cách theo
           * CHAT-DEC-016 (BỐN nhánh, mỗi nhánh một nguồn quyền). `showAvatar={false}`: avatar lớn đã
           * ở ngay trên, vẽ lần hai chỉ để đặt hai nút cạnh nó là nhiễu.
           */}
          <RoomAvatarEditor
            room={room}
            label={label}
            myRole={myRole}
            onChanged={onChanged}
            showAvatar={false}
          />
        </div>

        {error !== null && (
          <p
            className="border-y border-destructive/40 bg-destructive/10 px-4 py-2 text-xs text-destructive"
            role="alert"
          >
            {error}
          </p>
        )}

        {isEditing && (
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
        )}

        {/* ── 3 hành động tròn (DEC-025) ─────────────────────────────────────────────────────────── */}
        <div className="flex items-start justify-center gap-2 pb-3">
          {canManageMember && isGroup && isRoomAdmin && !isArchived && (
            <RoundAction
              icon={UserPlus}
              label={t("info.members.add")}
              onClick={() => setPickerOpen(true)}
              testId="chat-info-add-member"
            />
          )}

          {/*
           * Tắt/Bật thông báo — KHÔNG cổng quyền (luật 1). Đang tắt ⇒ bấm là BẬT LẠI ngay; đang bật ⇒
           * mở menu chọn MỐC, vì hợp đồng là `mutedUntil` (một mốc) chứ không phải cờ bật/tắt, và tự
           * chọn hộ một mốc mặc định là loại lỗi người dùng không bao giờ quy được về đây.
           */}
          {muted ? (
            <RoundAction
              icon={BellRing}
              label={t("rooms.menu.unmute")}
              disabled={prefs.isBusy}
              onClick={() => prefs.mute({ roomId: room.id, preset: null, before: prefsSnapshot() })}
              testId="chat-info-mute"
            />
          ) : (
            <Popover
              open={isMuteMenuOpen}
              onOpenChange={setMuteMenuOpen}
              align="start"
              className="min-w-[11rem] p-1"
              trigger={
                <RoundAction
                  icon={BellOff}
                  label={t("info.actions.mute")}
                  disabled={prefs.isBusy}
                  onClick={() => setMuteMenuOpen(!isMuteMenuOpen)}
                  testId="chat-info-mute"
                />
              }
            >
              <ul role="menu" aria-label={t("rooms.menu.muteHeading")} className="space-y-0.5">
                {MUTE_PRESETS.map((preset) => (
                  <li key={preset.key} role="none">
                    <button
                      type="button"
                      role="menuitem"
                      className="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                      data-testid={`chat-info-mute-${preset.key}`}
                      onClick={() => {
                        setMuteMenuOpen(false);
                        prefs.mute({
                          roomId: room.id,
                          preset: preset.key,
                          before: prefsSnapshot(),
                        });
                      }}
                    >
                      {t(`rooms.menu.mutePreset.${preset.key}`)}
                    </button>
                  </li>
                ))}
              </ul>
            </Popover>
          )}

          <RoundAction
            icon={pinned ? PinOff : Pin}
            label={pinned ? t("rooms.menu.unpin") : t("rooms.menu.pin")}
            disabled={prefs.isBusy}
            onClick={() => prefs.pin({ roomId: room.id, pin: !pinned, before: prefsSnapshot() })}
            testId="chat-info-pin"
          />
        </div>

        {/* ── Thành viên (N) › ───────────────────────────────────────────────────────────────────── */}
        <button
          type="button"
          className="flex w-full items-center justify-between border-y border-border px-4 py-2.5 text-sm hover:bg-accent"
          onClick={() => setMembersOpen(true)}
          data-testid="chat-info-members-row"
        >
          <span className="font-medium">{t("info.tabs.members")}</span>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <span className="tabular-nums">{members.length}</span>
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </span>
        </button>

        {/* ── Accordion: Ảnh/Video · Tệp · Liên kết · Tin ghim ───────────────────────────────────── */}
        <Accordion value={openSections} onValueChange={setOpenSections}>
          <AccordionItem value="media">
            <AccordionTrigger data-testid="chat-info-section-media">
              {t("info.sections.media")}
            </AccordionTrigger>
            <AccordionContent>
              <RoomMediaGrid roomId={room.id} />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="files">
            <AccordionTrigger data-testid="chat-info-section-files">
              {t("info.sections.files")}
            </AccordionTrigger>
            <AccordionContent>
              {/* `kind="file"` lọc Ở SERVER — lưới ảnh ở khối trên là truy vấn RIÊNG, không lọc lại. */}
              <RoomFilesTab roomId={room.id} kind="file" onJumpToMessage={onJumpToMessage} />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="links">
            <AccordionTrigger data-testid="chat-info-section-links">
              {t("info.sections.links")}
            </AccordionTrigger>
            <AccordionContent>
              <RoomLinksList roomId={room.id} onJumpToMessage={onJumpToMessage} />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="pinned">
            <AccordionTrigger data-testid="chat-info-section-pinned">
              {t("info.sections.pinned")}
            </AccordionTrigger>
            <AccordionContent>
              <RoomPinnedList roomId={room.id} onJumpToMessage={onJumpToMessage} />
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>

      {/* ── Cuối panel: Lưu trữ [gate] + Rời nhóm [group] ──────────────────────────────────────── */}
      <div className="space-y-1 border-t border-border p-3">
        {canArchive && !isArchived && (
          <Button
            size="sm"
            variant="outline"
            className="w-full"
            onClick={() => setConfirm("archive")}
          >
            {t("info.archive.button")}
          </Button>
        )}
        {isGroup && (
          <Button
            size="sm"
            variant="ghost"
            className="w-full gap-1 text-destructive hover:text-destructive"
            onClick={() => setConfirm("leave")}
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
            {t("info.leave.button")}
          </Button>
        )}
      </div>

      <RoomMembersSheet
        open={isMembersOpen}
        onClose={() => setMembersOpen(false)}
        room={room}
        members={members}
        myRole={myRole}
        isLoading={isLoading}
        loadError={loadError}
        onChanged={onChanged}
      />

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
    </aside>
  );
}

interface RoundActionProps {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  testId: string;
}

/** Một hành động tròn của DEC-025 — nhãn HIỆN RA dưới biểu tượng (không phải `title`, đọc được bằng SR). */
function RoundAction({
  icon: Icon,
  label,
  onClick,
  disabled = false,
  testId,
}: RoundActionProps): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className={cn(
        "flex w-20 flex-col items-center gap-1 rounded-md px-1 py-1.5 text-[11px] text-muted-foreground",
        "hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50",
      )}
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-muted/40">
        <Icon className="h-4 w-4" aria-hidden={true} />
      </span>
      <span className="line-clamp-2 leading-tight">{label}</span>
    </button>
  );
}
