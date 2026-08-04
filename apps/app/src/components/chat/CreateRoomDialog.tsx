/**
 * S7-CHAT-FE-2 — CHAT-SCREEN-003: mở tin nhắn riêng (DM) hoặc tạo phòng nhóm.
 *
 * Danh bạ dùng LẠI `EmployeeMultiPickerDialog` (tìm server + lọc phòng ban + phân trang) chứ không dựng
 * bảng chọn thứ ba: danh sách người do SERVER lọc theo data-scope của `read:employee`, đúng yêu cầu
 * "tôn trọng quyền xem danh bạ của HR" ở §9. Client KHÔNG tự lọc thêm.
 *
 * ⚠️ Nhân viên **chưa liên kết tài khoản** có `userId === null` (`hrEmployeeListItemSchema`). Không có
 * `userId` thì không có ai để nhắn — hàng đó bị KHOÁ kèm lý do, chứ không phải gửi `null` xuống server
 * rồi nhận 422 khó hiểu.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { chatApi } from "@mediaos/web-core";
import { Button, Dialog, Input, Tabs, TabsContent, TabsList, TabsTrigger } from "@mediaos/ui";
import type { ChatRoomDto } from "@mediaos/contracts";
import { EmployeeMultiPickerDialog } from "@/components/EmployeeMultiPickerDialog";
import { MAX_MESSAGE_LENGTH } from "@/routes/chat/constants";

interface CreateRoomDialogProps {
  onClose: () => void;
  /** Phòng vừa mở/tạo — trang mở nó ngay và cache tên đã dựng. */
  onCreated: (room: ChatRoomDto, displayName: string) => void;
}

export function CreateRoomDialog({
  onClose,
  onCreated,
}: CreateRoomDialogProps): React.ReactElement {
  const { t } = useTranslation("chat");
  const [tab, setTab] = useState<"direct" | "group">("direct");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selected, setSelected] = useState<Array<{ userId: string; fullName: string }>>([]);
  const [isPickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const directMutation = useMutation({
    mutationFn: (input: { userId: string; fullName: string }) =>
      chatApi.openDirect({ peerUserId: input.userId }).then((room) => ({ room, input })),
    // Idempotent theo `direct_key`: gọi lại cho ĐÚNG phòng cũ với 200 (không 201), nên "mở lại" và "mở
    // lần đầu" là cùng một đường — client không phải phân biệt.
    onSuccess: ({ room, input }) => onCreated(room, input.fullName),
    onError: () => setError(t("create.direct.failed")),
  });

  const groupMutation = useMutation({
    mutationFn: () =>
      chatApi.createRoom({
        name: name.trim(),
        roomType: "group",
        ...(description.trim().length > 0 ? { description: description.trim() } : {}),
        memberUserIds: selected.map((s) => s.userId),
      }),
    onSuccess: (room) => onCreated(room, room.name ?? name.trim()),
    onError: () => setError(t("create.group.failed")),
  });

  return (
    <>
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
              <Button
                type="button"
                disabled={name.trim().length === 0 || groupMutation.isPending}
                onClick={() => {
                  if (name.trim().length === 0) {
                    setError(t("create.group.nameRequired"));
                    return;
                  }
                  groupMutation.mutate();
                }}
              >
                {t("create.group.create")}
              </Button>
            )}
          </>
        }
      >
        <Tabs value={tab} onValueChange={(v) => setTab(v as "direct" | "group")}>
          <TabsList>
            <TabsTrigger value="direct">{t("create.tabs.direct")}</TabsTrigger>
            <TabsTrigger value="group">{t("create.tabs.group")}</TabsTrigger>
          </TabsList>

          <TabsContent value="direct">
            <div className="space-y-3 py-3">
              <p className="text-sm text-muted-foreground">{t("create.direct.description")}</p>
              <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
                {t("create.direct.pickerTitle")}
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="group">
            <div className="space-y-3 py-3">
              <p className="text-sm text-muted-foreground">{t("create.group.description")}</p>
              <div className="space-y-1">
                <label className="text-xs font-medium" htmlFor="chat-create-name">
                  {t("create.group.nameLabel")}
                </label>
                <Input
                  id="chat-create-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("create.group.namePlaceholder")}
                />
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
              <div className="space-y-1">
                <p className="text-xs font-medium">{t("create.group.membersLabel")}</p>
                <p className="text-xs text-muted-foreground">{t("create.group.membersHint")}</p>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
                    {t("create.group.pickMembers")}
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {t("create.group.selectedCount", { count: selected.length })}
                  </span>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        {error !== null && (
          <p className="pt-2 text-xs text-destructive" role="alert">
            {error}
          </p>
        )}
      </Dialog>

      {isPickerOpen && (
        <EmployeeMultiPickerDialog
          title={tab === "direct" ? t("create.direct.pickerTitle") : t("create.group.pickMembers")}
          selectionMode={tab === "direct" ? "single" : "multi"}
          isRowDisabled={(employee) =>
            employee.userId === null || selected.some((s) => s.userId === employee.userId)
          }
          disabledBadge={(employee) =>
            employee.userId === null ? t("create.direct.noAccount") : t("info.members.alreadyIn")
          }
          disabledRowChecked={(employee) => employee.userId !== null}
          onAddOne={(employee) => {
            if (employee.userId === null) return Promise.reject(new Error("no-user"));
            const picked = { userId: employee.userId, fullName: employee.fullName ?? "" };
            if (tab === "direct") return directMutation.mutateAsync(picked);
            setSelected((prev) =>
              prev.some((s) => s.userId === picked.userId) ? prev : [...prev, picked],
            );
            return Promise.resolve();
          }}
          onBatchSettled={() => setPickerOpen(false)}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </>
  );
}
