/**
 * S7-CHAT-FE-2 → **S20-CHAT-NEWROOM-1** — CHAT-SCREEN-003: mở tin nhắn riêng (DM) hoặc tạo phòng nhóm.
 *
 * S20 (US-CHAT-NV-12 · NV-91): bỏ dialog chọn người thứ hai. Ô tìm NHÚNG thẳng ở cả hai tab; tab «Nhóm»
 * thêm dải chip «Gần đây» (người đối thoại của các DM đã nạp sẵn ở `chat.store` — không gọi API nào) và
 * tên nhóm tự gợi ý «Lan, Minh, Hà +1» khi người dùng chưa gõ. Dùng chung cho `/chat` và drawer chat.
 *
 * Danh sách người do SERVER lọc theo data-scope của `read:employee` (§9 "tôn trọng quyền xem danh bạ của
 * HR") — xem docblock `CreateRoomDialog.people.tsx`.
 *
 * ⚠️ Server từ chối (CHAT-ERR-003 — tài khoản không còn dùng được) ⇒ dialog GIỮ NGUYÊN lựa chọn và nói
 * ai không thêm được. Server cố ý KHÔNG echo `userId` trong lỗi, nên client nêu người nó BIẾT là ngừng
 * hoạt động (peer `isActive=false`, danh sách phòng được xin lại ngay khi lỗi); không biết thì nêu cả
 * nhóm ứng viên — không bao giờ đoán một cái tên.
 */
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError, chatApi, chatKeys } from "@mediaos/web-core";
import { Button, Dialog, Input, Tabs, TabsContent, TabsList, TabsTrigger } from "@mediaos/ui";
import type { ChatRoomDto } from "@mediaos/contracts";
import { MAX_MESSAGE_LENGTH } from "@/routes/chat/constants";
import { useChatStore } from "@/stores/chat.store";
import { PeopleSearch, RecentPeerChips, SelectedPeople } from "./CreateRoomDialog.people";
import {
  MAX_GROUP_NAME_LENGTH,
  deriveRecentPeers,
  suggestGroupName,
  type PersonPick,
} from "./create-room-people";

type CreateTab = "direct" | "group";

/** Tab nhắn riêng không có «đã chọn» — lựa chọn của tab nhóm không được tô lên kết quả ở đây. */
const NO_SELECTION: ReadonlySet<string> = new Set();

/** Lỗi gần nhất — giữ LOẠI chứ không giữ chuỗi, để thông điệp tính lại theo lựa chọn hiện tại. */
type Failure =
  | { kind: "direct"; name: string }
  | { kind: "groupRejected" }
  | { kind: "groupFailed" };

interface CreateRoomDialogProps {
  onClose: () => void;
  /** Phòng vừa mở/tạo — caller mở nó ngay (trang `/chat` hoặc drawer). */
  onCreated: (room: ChatRoomDto, displayName: string) => void;
  /** Tab mở đầu — lối «Thêm người» ở bảng thông tin DM mở thẳng tab nhóm. */
  initialTab?: CreateTab;
  /** Người chọn sẵn cho tab nhóm (người đối thoại của DM). */
  initialMembers?: readonly PersonPick[];
  /** `drawer` ⇒ không có kết quả tìm thì kèm gợi ý «Nhắn riêng từ một phòng chung». */
  variant?: "page" | "drawer";
}

export function CreateRoomDialog({
  onClose,
  onCreated,
  initialTab = "direct",
  initialMembers = [],
  variant = "page",
}: CreateRoomDialogProps): React.ReactElement {
  const { t } = useTranslation("chat");
  const queryClient = useQueryClient();
  const roomOrder = useChatStore((s) => s.roomOrder);
  const roomsById = useChatStore((s) => s.roomsById);
  const myUserId = useChatStore((s) => s.myUserId);

  const [tab, setTab] = useState<CreateTab>(initialTab);
  const [selected, setSelected] = useState<readonly PersonPick[]>(initialMembers);
  /** `null` = CHƯA gõ ⇒ ô tên hiện tên gợi ý (đổi theo người chọn). Gõ rồi thì là chữ của người dùng. */
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [isSubmitAttempted, setSubmitAttempted] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const recentPeers = useMemo(
    () => deriveRecentPeers(roomOrder, roomsById, myUserId),
    [roomOrder, roomsById, myUserId],
  );
  const inactiveIds = useMemo(
    () => new Set(recentPeers.filter((p) => !p.isActive).map((p) => p.userId)),
    [recentPeers],
  );
  const selectedIds = useMemo(() => new Set(selected.map((p) => p.userId)), [selected]);

  const groupName = (nameDraft ?? suggestGroupName(selected)).trim();
  const showNameError = groupName.length === 0 && (nameDraft !== null || isSubmitAttempted);

  const directMutation = useMutation({
    mutationFn: (person: PersonPick) =>
      chatApi.openDirect({ peerUserId: person.userId }).then((room) => ({ room, person })),
    // Idempotent theo `direct_key`: mở lại DM cũ và mở lần đầu là cùng một đường.
    onSuccess: ({ room, person }) => onCreated(room, person.fullName),
    onError: (_err, person) => setFailure({ kind: "direct", name: person.fullName }),
  });

  const groupMutation = useMutation({
    mutationFn: (input: { name: string; description: string; memberUserIds: string[] }) =>
      chatApi.createRoom({
        name: input.name,
        roomType: "group",
        ...(input.description.length > 0 ? { description: input.description } : {}),
        memberUserIds: input.memberUserIds,
      }),
    onSuccess: (room, input) => onCreated(room, room.name ?? input.name),
    onError: (err, input) => {
      const isRejected =
        err instanceof ApiError && err.status === 422 && input.memberUserIds.length > 0;
      setFailure({ kind: isRejected ? "groupRejected" : "groupFailed" });
      // Xin lại danh sách phòng (endpoint ĐÃ dùng) để `peer.isActive` mới nhất khoá đúng chip người
      // vừa bị từ chối — không phải một lời gọi «tìm hộ».
      if (isRejected) void queryClient.invalidateQueries({ queryKey: chatKeys.rooms.list() });
    },
  });

  const isBusy = directMutation.isPending || groupMutation.isPending;
  const failureText = failure === null ? null : failureMessage(failure, selected, inactiveIds);

  const toggleMember = (person: PersonPick): void => {
    const isIn = selectedIds.has(person.userId);
    if (!isIn && inactiveIds.has(person.userId)) return;
    setSelected((prev) =>
      isIn ? prev.filter((p) => p.userId !== person.userId) : [...prev, person],
    );
    setFailure(null);
  };

  const submitGroup = (): void => {
    if (groupName.length === 0) {
      // Không gửi request: `createChatRoomSchema.name.min(1)` sẽ trả 400 cho đúng thứ ta biết trước.
      setSubmitAttempted(true);
      nameInputRef.current?.focus();
      return;
    }
    // Chụp giá trị TẠI ĐIỂM BẤM vào `input` — `mutationFn` không đọc state qua closure.
    groupMutation.mutate({
      name: groupName,
      description: description.trim(),
      memberUserIds: selected.map((p) => p.userId),
    });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t("create.title")}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            {t("create.cancel")}
          </Button>
          {tab === "group" && (
            <Button type="button" disabled={isBusy} onClick={submitGroup}>
              {t("create.group.create")}
            </Button>
          )}
        </>
      }
    >
      <Tabs
        value={tab}
        onValueChange={(v) => {
          setTab(v as CreateTab);
          setFailure(null);
        }}
      >
        <TabsList>
          <TabsTrigger value="direct">{t("create.tabs.direct")}</TabsTrigger>
          <TabsTrigger value="group">{t("create.tabs.group")}</TabsTrigger>
        </TabsList>

        <TabsContent value="direct">
          <div className="space-y-3 py-3">
            <p className="text-sm text-muted-foreground">{t("create.direct.description")}</p>
            <PeopleSearch
              mode="direct"
              selectedIds={NO_SELECTION}
              myUserId={myUserId}
              disabled={isBusy}
              showSharedRoomHint={variant === "drawer"}
              onPick={(person) => {
                setFailure(null);
                directMutation.mutate(person);
              }}
            />
          </div>
        </TabsContent>

        <TabsContent value="group">
          <div className="space-y-3 py-3">
            <p className="text-sm text-muted-foreground">{t("create.group.description")}</p>
            <RecentPeerChips
              peers={recentPeers}
              selectedIds={selectedIds}
              disabled={isBusy}
              onToggle={toggleMember}
            />
            <PeopleSearch
              mode="group"
              selectedIds={selectedIds}
              myUserId={myUserId}
              disabled={isBusy}
              showSharedRoomHint={variant === "drawer"}
              onPick={toggleMember}
            />
            <SelectedPeople people={selected} disabled={isBusy} onRemove={toggleMember} />
            <div className="space-y-1">
              <label className="text-xs font-medium" htmlFor="chat-create-name">
                {t("create.group.nameLabel")}
              </label>
              <Input
                ref={nameInputRef}
                id="chat-create-name"
                value={nameDraft ?? suggestGroupName(selected)}
                onChange={(e) => setNameDraft(e.target.value)}
                placeholder={t("create.group.namePlaceholder")}
                maxLength={MAX_GROUP_NAME_LENGTH}
                aria-invalid={showNameError}
                aria-describedby="chat-create-name-hint"
              />
              <p
                id="chat-create-name-hint"
                aria-live="polite"
                className={
                  showNameError ? "text-xs text-destructive" : "text-xs text-muted-foreground"
                }
              >
                {showNameError
                  ? t("create.group.nameRequired")
                  : nameDraft === null && selected.length > 0
                    ? t("create.group.nameSuggestedHint")
                    : t("create.group.membersHint")}
              </p>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium" htmlFor="chat-create-desc">
                {t("create.group.descriptionLabel")}
              </label>
              <textarea
                id="chat-create-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t("create.group.descriptionPlaceholder")}
                rows={2}
                maxLength={MAX_MESSAGE_LENGTH}
                className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {failureText !== null && (
        <p className="pt-2 text-xs text-destructive" role="alert">
          {t(failureText.key, failureText.options)}
        </p>
      )}
    </Dialog>
  );
}

/** Khoá i18n + tham số của thông điệp lỗi — tính lại theo lựa chọn HIỆN TẠI mỗi lần render. */
function failureMessage(
  failure: Failure,
  selected: readonly PersonPick[],
  inactiveIds: ReadonlySet<string>,
): { key: string; options?: Record<string, string> } {
  if (failure.kind === "direct") {
    return { key: "create.direct.failedWith", options: { name: failure.name } };
  }
  if (failure.kind === "groupFailed" || selected.length === 0)
    return { key: "create.group.failed" };
  const known = selected.filter((p) => inactiveIds.has(p.userId));
  const suspects = known.length > 0 ? known : selected;
  if (suspects.length === 1) {
    return { key: "create.group.rejectedOne", options: { name: suspects[0].fullName } };
  }
  return {
    key: "create.group.rejectedSome",
    options: { names: suspects.map((p) => p.fullName).join(", ") },
  };
}
