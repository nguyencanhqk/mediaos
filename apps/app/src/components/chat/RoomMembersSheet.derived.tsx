/**
 * S20-CHAT-DISCUSS-1 (US-CHAT-QL-12) — lời nhắc «thành viên dẫn xuất» trong `RoomMembersSheet`, kèm liên
 * kết tới nơi quản lý thành viên thật (SPEC-15 §13.3 — phòng `department`/`project` không thêm/bớt tay).
 *
 *   project + `refId` + `read:project`        ⇒ «Quản lý thành viên ở dự án →» `/tasks/projects/{refId}?tab=members`
 *   department + `read:department`            ⇒ «Xem phòng ban ở Nhân sự →» `/hr/departments`
 *   thiếu cặp của trang đích / thiếu `refId`  ⇒ chữ thuần
 *   group / direct                            ⇒ không gọi tới đây (caller chỉ dựng cho phòng dẫn xuất)
 *
 * Cặp kiểm ở đây CHỈ để không đưa người dùng tới một trang chặn họ; quyền thật do trang đích và server ép
 * (dự án lưu trữ/xoá mềm ⇒ trang dự án tự hiện trạng thái tương ứng). Liên kết là `<a href>` thật để
 * Ctrl/⌘/chuột giữa mở tab mới; lượt bấm thường đi SPA rồi đóng Sheet (drawer sống qua đổi trang, Sheet
 * còn mở sẽ che trang vừa tới).
 */
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { useCan } from "@mediaos/web-core";
import type { ChatRoomDto } from "@mediaos/contracts";
import { TASK_ENGINE_PAIRS } from "@/routes/tasks/constants";
import { HR_ENGINE_PAIRS } from "@/routes/hr/constants";

const HR_DEPARTMENTS_PATH = "/hr/departments";

export function projectMembersHref(projectId: string): string {
  return `/tasks/projects/${encodeURIComponent(projectId)}?tab=members`;
}

function isPlainPrimaryClick(event: React.MouseEvent<HTMLAnchorElement>): boolean {
  return (
    event.button === 0 &&
    !event.defaultPrevented &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

function DerivedLink({
  href,
  label,
  onNavigated,
}: {
  href: string;
  label: string;
  onNavigated: () => void;
}): React.ReactElement {
  const navigate = useNavigate();
  return (
    <a
      href={href}
      className="ml-1 font-medium text-primary underline-offset-2 hover:underline"
      onClick={(event) => {
        if (!isPlainPrimaryClick(event)) return;
        event.preventDefault();
        void navigate({ href });
        onNavigated();
      }}
    >
      {label}
    </a>
  );
}

export function DerivedMembersNotice({
  room,
  onNavigated,
}: {
  room: ChatRoomDto;
  onNavigated: () => void;
}): React.ReactElement {
  const { t } = useTranslation("chat");
  // Gọi đủ hai hook vô điều kiện (rules-of-hooks), rồi mới chọn theo loại phòng.
  const canReadProject = useCan(
    TASK_ENGINE_PAIRS.READ_PROJECT.action,
    TASK_ENGINE_PAIRS.READ_PROJECT.resourceType,
  );
  const canReadDepartment = useCan(
    HR_ENGINE_PAIRS.READ_DEPARTMENT.action,
    HR_ENGINE_PAIRS.READ_DEPARTMENT.resourceType,
  );

  let link: { href: string; label: string } | null = null;
  if (room.roomType === "project" && room.refId !== null && canReadProject) {
    link = { href: projectMembersHref(room.refId), label: t("info.members.derivedProjectLink") };
  } else if (room.roomType === "department" && canReadDepartment) {
    link = { href: HR_DEPARTMENTS_PATH, label: t("info.members.derivedDepartmentLink") };
  }

  return (
    <p className="pb-2 text-xs text-muted-foreground">
      {t("info.members.derivedNotice", { type: t(`rooms.types.${room.roomType}`) })}
      {link !== null && (
        <DerivedLink href={link.href} label={link.label} onNavigated={onNavigated} />
      )}
    </p>
  );
}
