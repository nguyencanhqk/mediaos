import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { roomApi, roomKeys } from "@mediaos/web-core";
import { Button, Checkbox, Dialog, Input } from "@mediaos/ui";
import {
  ROOM_CAPACITY_MAX,
  ROOM_EQUIPMENT_ITEM_MAX_LEN,
  ROOM_EQUIPMENT_MAX_ITEMS,
  ROOM_LOCATION_MAX,
  ROOM_NAME_MAX,
  ROOM_SORT_ORDER_MAX,
  type RoomResponseDto,
} from "@mediaos/contracts";
import { parseRoomError, roomErrorI18nKey } from "../room-errors";

interface RoomFormDialogProps {
  open: boolean;
  /** `null` = tạo mới. */
  room: RoomResponseDto | null;
  onClose: () => void;
}

/**
 * S11-ROOM-FE-1 — form tạo/sửa phòng họp (trong màn 004).
 *
 * `PATCH /rooms/:id` có body `.strict()` ở BE: gửi thừa khoá là 400, không phải bị bỏ qua im lặng.
 * Vì thế form gửi ĐÚNG tập trường của `updateRoomSchema` (= `createRoomSchema.partial()` + `isActive`)
 * và không nhồi thêm gì từ DTO đọc (`id`/`createdAt`/`upcomingCount`).
 *
 * `equipment` nhập mỗi dòng một mục — mảng chuỗi ở contracts, `.max(20)` mỗi mục `.max(40)`. Cắt ở
 * client là để người dùng thấy giới hạn ngay; server vẫn là chốt.
 */
export function RoomFormDialog({ open, room, onClose }: RoomFormDialogProps) {
  const { t } = useTranslation("rooms");
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState("8");
  const [location, setLocation] = useState("");
  const [equipmentText, setEquipmentText] = useState("");
  const [description, setDescription] = useState("");
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [sortOrder, setSortOrder] = useState("0");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(room?.name ?? "");
    setCapacity(String(room?.capacity ?? 8));
    setLocation(room?.location ?? "");
    setEquipmentText((room?.equipment ?? []).join("\n"));
    setDescription(room?.description ?? "");
    setRequiresApproval(room?.requiresApproval ?? false);
    setIsActive(room?.isActive ?? true);
    setSortOrder(String(room?.sortOrder ?? 0));
    setError(null);
  }, [open, room]);

  const equipment = equipmentText
    .split("\n")
    .map((line) => line.trim().slice(0, ROOM_EQUIPMENT_ITEM_MAX_LEN))
    .filter((line) => line !== "")
    .slice(0, ROOM_EQUIPMENT_MAX_ITEMS);

  const saveMutation = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        capacity: Number.parseInt(capacity, 10),
        location: location.trim() === "" ? null : location.trim(),
        equipment,
        description: description.trim() === "" ? null : description.trim(),
        requiresApproval,
        sortOrder: Number.parseInt(sortOrder, 10) || 0,
      };
      return room === null
        ? roomApi.createRoom(body)
        : roomApi.updateRoom(room.id, { ...body, isActive });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: roomKeys.all });
      onClose();
    },
    onError: (err) => {
      const info = parseRoomError(err);
      setError(t(roomErrorI18nKey(info), { ...Object.fromEntries(info.fields) }));
    },
  });

  const capacityValue = Number.parseInt(capacity, 10);
  const canSubmit =
    name.trim() !== "" &&
    Number.isFinite(capacityValue) &&
    capacityValue >= 1 &&
    capacityValue <= ROOM_CAPACITY_MAX &&
    !saveMutation.isPending;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={room === null ? t("roomForm.createTitle") : t("roomForm.editTitle")}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t("roomForm.cancel")}
          </Button>
          <Button disabled={!canSubmit} onClick={() => saveMutation.mutate()}>
            {saveMutation.isPending ? t("states.saving") : t("roomForm.submit")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t("roomForm.name")}</span>
          <Input value={name} maxLength={ROOM_NAME_MAX} onChange={(e) => setName(e.target.value)} />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">{t("roomForm.capacity")}</span>
            <Input
              type="number"
              min={1}
              max={ROOM_CAPACITY_MAX}
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">{t("roomForm.sortOrder")}</span>
            <Input
              type="number"
              min={0}
              max={ROOM_SORT_ORDER_MAX}
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
            />
          </label>
        </div>

        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t("roomForm.location")}</span>
          <Input
            value={location}
            maxLength={ROOM_LOCATION_MAX}
            onChange={(e) => setLocation(e.target.value)}
          />
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t("roomForm.equipment")}</span>
          <textarea
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            rows={4}
            value={equipmentText}
            onChange={(e) => setEquipmentText(e.target.value)}
          />
          <span className="mt-1 block text-xs text-muted-foreground">
            {t("roomForm.equipmentHint", { max: ROOM_EQUIPMENT_MAX_ITEMS })}
          </span>
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t("roomForm.description")}</span>
          <textarea
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>

        <label className="flex items-start gap-2 text-sm">
          <Checkbox
            checked={requiresApproval}
            onChange={(e) => setRequiresApproval(e.target.checked)}
          />
          <span>
            <span className="block font-medium">{t("roomForm.requiresApproval")}</span>
            {/* ROOM-DEC-002: v1 KHÔNG có luồng duyệt — bật cờ là biến phòng thành không đặt được. Nói
                thẳng ở đây thay vì để người dùng phát hiện qua 409 `approval-not-supported`. */}
            <span className="block text-xs text-muted-foreground">
              {t("roomForm.requiresApprovalHint")}
            </span>
          </span>
        </label>

        {room !== null && (
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            <span className="font-medium">{t("roomForm.isActive")}</span>
          </label>
        )}

        {error && (
          <p
            role="alert"
            className="rounded-md border border-danger/40 bg-danger-muted px-3 py-2 text-sm text-danger"
          >
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
