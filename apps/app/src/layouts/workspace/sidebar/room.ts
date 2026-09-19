import { type SidebarItemMeta } from "@mediaos/web-core";

// ---------------------------------------------------------------------------
// ROOM — Phòng họp (S11-ROOM-FE-1, SPEC-14 §9)
// ---------------------------------------------------------------------------
//
// Hai mục, cùng gate `access:room` + `view:room` (ĐỦ CẢ HAI — khớp gate đường tải, xem ROUTE_REGISTRY).
// «Quản trị phòng họp» KHÔNG gate bằng `manage:room`: tab «Lịch sử sử dụng» của màn đó chạy trên
// `view:room`, gate mục sidebar bằng cặp ghi sẽ giấu luôn phần đọc khỏi role chỉ có quyền xem. Nút
// tạo/sửa/xoá bên trong ẩn qua useCan("ROOM.ROOM.MANAGE").
export const ROOM_SIDEBAR: readonly SidebarItemMeta[] = [
  {
    sidebarKey: "room.calendar",
    moduleCode: "ROOM",
    label: "Lịch phòng",
    path: "/rooms",
    icon: "calendar-clock",
    group: "overview",
    order: 10,
    requiredPermissions: ["access:room", "view:room"],
  },
  {
    sidebarKey: "room.manage",
    moduleCode: "ROOM",
    label: "Quản trị phòng họp",
    path: "/rooms/manage",
    icon: "door-open",
    group: "overview",
    order: 20,
    requiredPermissions: ["access:room", "view:room"],
  },
];
