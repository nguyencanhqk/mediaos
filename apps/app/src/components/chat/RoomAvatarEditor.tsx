/**
 * S8-CHAT-UX-FE-2 — khối đặt/gỡ ẢNH ĐẠI DIỆN PHÒNG trong `RoomInfoPanel` (SPEC-15 §9 CHAT-SCREEN-004).
 *
 * ┌─ LUẬT DUY NHẤT của file này ──────────────────────────────────────────────────────────────────────┐
 * │ SPEC-15 §9: *"chỉ hiện đúng với chủ thể được phép theo CHAT-DEC-016, **không** hiện nút rồi để     │
 * │ server trả 403"*. Bảng §11b có BỐN nhánh và mỗi nhánh hỏi một NGUỒN QUYỀN KHÁC NHAU — dùng chung   │
 * │ một luật "admin phòng" cho cả bốn là sai hai lần: phòng `department`/`project` đo được là **0      │
 * │ admin** (không service nào gán `role='admin'` cho phòng dẫn xuất), nên nút sẽ VĨNH VIỄN không hiện │
 * │ ở đúng hai loại phòng mà tính năng này sinh ra để phục vụ.                                          │
 * └───────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * | Loại phòng | Server đòi (§11b) | FE chứng minh bằng |
 * | --- | --- | --- |
 * | `direct` | **không ai** — 422 `CHAT-ERR-022` | không render nhánh nào |
 * | `group` | `update:chat-room` + `role='admin'` | `useCan` + `myRole` (khớp CHÍNH XÁC) |
 * | `department` | `update:chat-room` + `update:org_unit` **với đơn vị neo** | `useCan('update','org_unit')` — xấp xỉ trên, xem dưới |
 * | `project` | `update:chat-room` + vai trò quản lý dự án | `getProject(refId).myProjectRole ∈ {Owner, Manager}` |
 *
 * ⚠️ **Vế `department` là XẤP XỈ TRÊN — ghi ra chứ không giấu.** `data_scope` là per-(permission, role),
 * và `ChatRoomDto` **không mang `orgUnitId`** nên FE không có cả đối tượng để đối chiếu, lẫn bản đồ "đơn
 * vị mình làm trưởng". Xấp xỉ này ĐÚNG với mọi role canonical hôm nay: `update:org_unit` chỉ grant cho
 * `company-admin` (`0030:36`) và `hr-manager` (`0030:46`), cả hai ở `data_scope` mặc định `Company`
 * (`schema/permission.ts:72`) — tức nhánh "cho qua" của `assertOrgUnitWriteTx`. Một custom-role
 * `update:org_unit@Department` mới đẻ ra ca lệch, và ở ca đó ta **bắt 403 rồi hiện đúng thông điệp
 * CHAT-ERR-023**, không nuốt thành "có lỗi xảy ra". Sửa triệt để = BE trả cờ `canSetAvatar` trên
 * `GET /chat/rooms/:id` (chạm đường quyền ⇒ FULL gate) — việc kế tiếp, không phải việc của WO này.
 *
 * ⚠️ `avatarUrl` là **URL ký TTL ngắn**: sau khi đặt/gỡ, server trả `{fileId}` chứ KHÔNG trả URL ⇒ phải
 * `onChanged()` để tải lại phòng. Tuyệt đối không tự dựng URL từ `fileId`, không cache URL đã nhận.
 */
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ImagePlus, Trash2 } from "lucide-react";
import { ApiError, chatRoomAvatarApi, taskProjectApi, useCan } from "@mediaos/web-core";
import { Button } from "@mediaos/ui";
import type { ChatRoomDto, ProjectRoleDto } from "@mediaos/contracts";
import { CHAT_PAIRS } from "@/routes/chat/constants";
import { isProjectManagerOrOwner } from "@/routes/tasks/constants";
import { RoomAvatar } from "./RoomAvatar";

/** Cặp quyền của đơn vị tổ chức — LITERAL theo catalog `0030:19`, không suy từ bảng map. */
const ORG_UNIT_UPDATE_PAIR = { action: "update", resourceType: "org_unit" } as const;

/**
 * Trần cỡ ảnh ở client. KHÔNG thay lớp kiểm của server (`FileService` có trần + kiểm mime thật từ bytes)
 * — chỉ để người dùng biết ngay thay vì chờ upload xong mới ăn lỗi.
 */
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

interface RoomAvatarEditorProps {
  room: ChatRoomDto;
  /** Nhãn phòng đã dựng — nguồn chữ cái đầu khi chưa có ảnh. */
  label: string;
  myRole: "member" | "admin" | null;
  /** Tải lại phòng để lấy `avatarUrl` ký TƯƠI (server không trả URL ở đường ghi). */
  onChanged: () => void;
}

export function RoomAvatarEditor({
  room,
  label,
  myRole,
  onChanged,
}: RoomAvatarEditorProps): React.ReactElement | null {
  const { t } = useTranslation("chat");
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  // Hook gọi VÔ ĐIỀU KIỆN (rules-of-hooks) rồi mới ghép vào luật từng nhánh bên dưới.
  const canUpdateRoom = useCan(CHAT_PAIRS.UPDATE_ROOM.action, CHAT_PAIRS.UPDATE_ROOM.resourceType);
  const canUpdateOrgUnit = useCan(ORG_UNIT_UPDATE_PAIR.action, ORG_UNIT_UPDATE_PAIR.resourceType);

  const isArchived = room.isArchived ?? false;
  // Phòng lưu trữ CHỈ ĐỌC — cùng luật `updateRoom`/`sendMessage`; server ném `CHAT-ERR-005` cho avatar.
  const gateOpenSoFar = canUpdateRoom && !isArchived;

  /**
   * Vai trò dự án chỉ hỏi khi THỰC SỰ cần: phòng `project`, đã qua cổng cặp, có neo `refId`.
   *
   * `read:project` có data-scope riêng — người không đọc được dự án sẽ ăn 403/404 ở đây, và đó là câu
   * trả lời hợp lệ: **fail-closed** (không có vai trò ⇒ không hiện nút), không phải lỗi để báo.
   */
  const projectQuery = useQuery({
    queryKey: ["chat", "room-avatar", "project-role", room.refId],
    queryFn: () => taskProjectApi.getProject(room.refId as string),
    enabled: gateOpenSoFar && room.roomType === "project" && room.refId !== null,
    retry: false,
    staleTime: 60_000,
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => chatRoomAvatarApi.uploadRoomAvatar(room.id, file),
    onSuccess: () => {
      setError(null);
      onChanged();
    },
    onError: (err: unknown) => setError(avatarErrorMessage(err, t)),
  });

  const removeMutation = useMutation({
    mutationFn: () => chatRoomAvatarApi.removeRoomAvatar(room.id),
    onSuccess: () => {
      setError(null);
      onChanged();
    },
    onError: (err: unknown) => setError(avatarErrorMessage(err, t)),
  });

  const canSetAvatar =
    gateOpenSoFar &&
    hasAvatarAuthority(room, myRole, canUpdateOrgUnit, projectQuery.data?.myProjectRole);

  // Không đủ tư cách ⇒ KHÔNG render gì cả (kể cả ảnh hiện tại): ảnh phòng đã có mặt trên mọi dòng danh
  // sách và trên đầu khung hội thoại — vẽ lại ở đây chỉ để nói "bạn không được đổi" là nhiễu.
  if (!canSetAvatar) return null;

  const isBusy = uploadMutation.isPending || removeMutation.isPending;

  return (
    <div
      className="flex items-center gap-3 border-b border-border p-3"
      data-testid="chat-room-avatar-editor"
    >
      <RoomAvatar room={room} label={label} size="lg" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            className="gap-1"
            disabled={isBusy}
            onClick={() => inputRef.current?.click()}
            data-testid="chat-room-avatar-pick"
          >
            <ImagePlus className="h-3.5 w-3.5" aria-hidden="true" />
            {room.avatarUrl ? t("info.avatar.change") : t("info.avatar.set")}
          </Button>
          {room.avatarUrl !== null && room.avatarUrl !== undefined && (
            <Button
              size="sm"
              variant="ghost"
              className="gap-1"
              disabled={isBusy}
              onClick={() => {
                setError(null);
                removeMutation.mutate();
              }}
              data-testid="chat-room-avatar-remove"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              {t("info.avatar.remove")}
            </Button>
          )}
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {isBusy ? t("info.avatar.uploading") : t("info.avatar.hint")}
        </p>
        {error !== null && (
          <p className="mt-1 text-xs text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        aria-label={t("info.avatar.inputAria")}
        data-testid="chat-room-avatar-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Reset NGAY: chọn lại đúng tệp vừa lỗi sẽ không phát `change` nếu giá trị input còn nguyên —
          // người dùng bấm mà "không có gì xảy ra", không lỗi, không dấu vết.
          e.target.value = "";
          if (!file) return;
          if (file.size > MAX_AVATAR_BYTES) {
            setError(
              t("info.avatar.tooLarge", { mb: Math.floor(MAX_AVATAR_BYTES / (1024 * 1024)) }),
            );
            return;
          }
          setError(null);
          uploadMutation.mutate(file);
        }}
      />
    </div>
  );
}

/**
 * Bốn nhánh CHAT-DEC-016 — `switch` VÉT CẠN trên `roomType`, `default` từ chối (fail-closed): thêm một
 * loại phòng mới mà quên nhánh phải là "không hiện nút", không phải "hiện cho mọi người".
 *
 * Đây là bản ĐỐI XỨNG của `assertAvatarAuthorityTx` phía server, không phải bản diễn giải tự do. Sửa
 * một bên mà quên bên kia là quay lại đúng cảnh "nút hứa suông" mà SPEC-15 §9 cấm.
 */
function hasAvatarAuthority(
  room: ChatRoomDto,
  myRole: "member" | "admin" | null,
  canUpdateOrgUnit: boolean,
  myProjectRole: ProjectRoleDto | null | undefined,
): boolean {
  switch (room.roomType) {
    case "direct":
      return false;
    case "group":
      return myRole === "admin";
    case "department":
      // Neo là `org_unit_id` — cột KHÔNG có trong `ChatRoomDto`; xem cảnh báo "xấp xỉ trên" ở đầu file.
      return canUpdateOrgUnit;
    case "project":
      return room.refId !== null && isProjectManagerOrOwner(myProjectRole);
    default:
      return false;
  }
}

/**
 * Mã lỗi CHAT-DEC-016 phải nói ĐÚNG chuyện gì xảy ra — cả ba đều hành động khác nhau với người dùng:
 * 403 = không đủ tư cách (đi nhờ người khác); 422 = loại phòng này không có avatar riêng; 413/415 =
 * tệp sai. Gộp hết thành "không đặt được ảnh" là bỏ đúng phần họ cần.
 */
function avatarErrorMessage(err: unknown, t: (key: string) => string): string {
  if (err instanceof ApiError) {
    if (err.status === 403) return t("info.avatar.forbidden");
    if (err.status === 422) return t("info.avatar.notSupported");
    if (err.status === 409) return t("info.avatar.archived");
    if (err.status === 413 || err.status === 415) return t("info.avatar.rejectedFile");
  }
  return t("info.avatar.failed");
}
