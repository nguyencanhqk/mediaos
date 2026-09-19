import { type SidebarItemMeta } from "@mediaos/web-core";

// ---------------------------------------------------------------------------
// ME — Trung tâm cá nhân (S5-ME-FE-1, SPEC-09 §8.1)
// ---------------------------------------------------------------------------
//
// SPEC-09 §8.1 liệt kê 6 nhóm (Tổng quan/Hồ sơ của tôi/Tài khoản & bảo mật/Công việc của tôi/Thông báo/
// Cài đặt cá nhân) — WO này CHỈ build màn Tổng quan (ME-SCREEN-001, route "/me"); 5 nhóm còn lại do
// S5-ME-FE-2/FE-3 APPEND theo route thật của họ (tránh sidebar trỏ vào route chưa tồn tại = link chết).
// Gate = cặp engine THẬT `access:me` trực tiếp (mirror ROUTE_REGISTRY "me.overview" — cùng cặp, không drift).
//
// S5-ME-FE-3 — APPEND 3 nhóm "Công việc của tôi"/"Thông báo"/"Cài đặt cá nhân" (§8.1, ME-SCREEN-009..014).
// `group` dùng NGUYÊN VĂN nhãn tiếng Việt (KHÔNG phải key enum như overview/operation/…): ModuleSidebar.tsx
// (NGOÀI phạm vi lane này — chỉ sửa file registry) render `GROUP_LABELS[group] ?? group`; group lạ (không
// có trong GROUP_LABELS) fallback IN NGUYÊN chuỗi — đặt group = nhãn hiển thị THẬT nên hiện đúng chữ mà
// KHÔNG cần đụng ModuleSidebar.tsx. Thứ tự nhóm hiển thị theo thứ tự XUẤT HIỆN LẦN ĐẦU trong mảng này
// (Object.keys giữ thứ tự chèn ở ModuleSidebar.grouped).
export const ME_SIDEBAR: readonly SidebarItemMeta[] = [
  {
    sidebarKey: "me.overview",
    moduleCode: "ME",
    label: "Tổng quan",
    path: "/me",
    icon: "user-circle",
    group: "overview",
    order: 10,
    requiredAnyPermissions: ["access:me"],
  },
  {
    sidebarKey: "me.attendance",
    moduleCode: "ME",
    label: "Chấm công",
    path: "/me/attendance",
    icon: "clock",
    group: "Công việc của tôi",
    order: 20,
    requiredAnyPermissions: ["access:me"],
  },
  {
    sidebarKey: "me.leave",
    moduleCode: "ME",
    label: "Nghỉ phép",
    path: "/me/leave",
    icon: "calendar-days",
    group: "Công việc của tôi",
    order: 21,
    requiredAnyPermissions: ["access:me"],
  },
  {
    sidebarKey: "me.tasks",
    moduleCode: "ME",
    label: "Task của tôi",
    path: "/me/tasks",
    icon: "kanban-square",
    group: "Công việc của tôi",
    order: 22,
    requiredAnyPermissions: ["access:me"],
  },
  // S13-PAYROLL-FE-1 — «Phiếu lương của tôi» (PAY-SCREEN-006, GET /me/payslips).
  //
  // ⚠️ CỐ Ý **KHÔNG** theo kỹ thuật me.assets/me.roomBookings (gate bằng cặp module). Cặp đường tải là
  // `view-own-payslip:payslip` — cặp SENSITIVE mà MỌI nhân viên được cấp qua seed 0180, và ý nghĩa của
  // nó là "phiếu của chính tôi", không phải "quyền vào module tiền lương". Gate mục này bằng cặp
  // PAYROLL nào đó là dựng một cổng có thể thu hồi trước dữ liệu riêng của chính người dùng — đúng lớp
  // lỗi `personal-prefs-must-not-sit-behind-permission-gate`. Cổng THẬT vẫn là cặp đó ở BE; ai không có
  // nó thì màn hiện rỗng, không phải biến mất khỏi Personal Hub.
  {
    sidebarKey: "me.payslips",
    moduleCode: "ME",
    label: "Phiếu lương của tôi",
    path: "/me/payslips",
    icon: "wallet",
    group: "Công việc của tôi",
    order: 24,
    requiredPermissions: ["access:me"],
  },
  // S15-PAYROLL-FE-3 — «Tạm ứng của tôi» (PAY-SCREEN-017, GET /me/payroll-advances). CÙNG kỹ thuật
  // me.payslips ngay trên: gate `access:me`, KHÔNG phải cặp PAYROLL. Cặp đường tải là
  // `view-own:payroll-advance` — nghĩa của nó là «khoản tạm ứng của chính tôi», không phải «quyền vào
  // module tiền lương». Ai chưa có khoản nào thì màn hiện RỖNG (065 trả danh sách rỗng, không lỗi).
  {
    sidebarKey: "me.payrollAdvances",
    moduleCode: "ME",
    label: "Tạm ứng của tôi",
    path: "/me/payroll-advances",
    icon: "hand-coins",
    group: "Công việc của tôi",
    order: 25,
    requiredPermissions: ["access:me"],
  },
  // S11-ASSET-FE-1 — «Tài sản của tôi» (ASSET-SCREEN-006, GET /me/assets). Gate = cặp ASSET (KHÁC các
  // mục ME khác dùng access:me), cùng kỹ thuật me.lms dùng access:lms: quyền xem tài sản độc lập với
  // quyền vào Personal Hub — ai bị thu view:asset KHÔNG thấy mục này. ĐỦ CẢ HAI vì trang tải GET
  // /me/assets = view:asset (gate màn khớp gate đường tải).
  {
    sidebarKey: "me.assets",
    moduleCode: "ME",
    label: "Tài sản của tôi",
    path: "/me/assets",
    icon: "package",
    group: "Công việc của tôi",
    order: 23,
    requiredPermissions: ["access:asset", "view:asset"],
  },
  // S11-ROOM-FE-1 — «Đặt phòng của tôi» (ROOM-SCREEN-003, GET /me/room-bookings). Cùng kỹ thuật
  // me.assets: gate bằng cặp ROOM, không phải access:me.
  {
    sidebarKey: "me.roomBookings",
    moduleCode: "ME",
    label: "Đặt phòng của tôi",
    path: "/me/room-bookings",
    icon: "calendar-clock",
    group: "Công việc của tôi",
    order: 24,
    requiredPermissions: ["access:room", "view:room"],
  },
  {
    sidebarKey: "me.notifications",
    moduleCode: "ME",
    label: "Thông báo của tôi",
    path: "/me/notifications",
    icon: "bell",
    group: "Thông báo",
    order: 30,
    requiredAnyPermissions: ["access:me"],
  },
  {
    sidebarKey: "me.preferences.notifications",
    moduleCode: "ME",
    label: "Tuỳ chọn thông báo",
    path: "/me/preferences/notifications",
    icon: "sliders-horizontal",
    group: "Thông báo",
    order: 31,
    requiredAnyPermissions: ["access:me"],
  },
  {
    sidebarKey: "me.preferences.appearance",
    moduleCode: "ME",
    label: "Giao diện",
    path: "/me/preferences/appearance",
    // "palette" KHÔNG có trong DynamicIcon.ICON_MAP (file NGOÀI phạm vi lane này) — dùng "settings" (đã
    // map sẵn) để tránh fallback Circle vô nghĩa.
    icon: "settings",
    group: "Cài đặt cá nhân",
    order: 40,
    requiredAnyPermissions: ["access:me"],
  },
  // S5-ME-FE-2 — APPEND 2 nhóm "Hồ sơ của tôi"/"Tài khoản & bảo mật" (§8.1, ME-SCREEN-002..008). 5 màn
  // TÁI DÙNG page sẵn có (MyProfilePage/MyChangeRequestPage/AccountProfilePage/ChangePasswordPage/
  // AccountSessionsPage) mount trong ME workspace qua ROUTE_REGISTRY "me.profile"/…; icon CHỌN TRONG
  // DynamicIcon.ICON_MAP đã có sẵn (tránh fallback Circle, cùng ghi chú "Giao diện" ở trên) — KHÔNG
  // "file-edit" (dùng ở HR_SIDEBAR/ATT_SIDEBAR nhưng KHÔNG map trong ICON_MAP, ngoài phạm vi lane này).
  {
    sidebarKey: "me.profile",
    moduleCode: "ME",
    label: "Hồ sơ của tôi",
    path: "/me/profile",
    icon: "user",
    group: "Hồ sơ của tôi",
    order: 45,
    requiredAnyPermissions: ["access:me"],
  },
  {
    sidebarKey: "me.profile.change-requests",
    moduleCode: "ME",
    label: "Yêu cầu cập nhật hồ sơ",
    path: "/me/profile/change-requests",
    icon: "clipboard-list",
    group: "Hồ sơ của tôi",
    order: 46,
    requiredAnyPermissions: ["access:me"],
  },
  {
    sidebarKey: "me.account",
    moduleCode: "ME",
    label: "Tài khoản",
    path: "/me/account",
    icon: "user-circle",
    group: "Tài khoản & bảo mật",
    order: 47,
    requiredAnyPermissions: ["access:me"],
  },
  {
    sidebarKey: "me.security.password",
    moduleCode: "ME",
    label: "Đổi mật khẩu",
    path: "/me/security/password",
    icon: "key-round",
    group: "Tài khoản & bảo mật",
    order: 48,
    requiredAnyPermissions: ["access:me"],
  },
  {
    sidebarKey: "me.security.sessions",
    moduleCode: "ME",
    label: "Phiên đăng nhập",
    path: "/me/security/sessions",
    icon: "log-in",
    group: "Tài khoản & bảo mật",
    order: 49,
    requiredAnyPermissions: ["access:me"],
  },
  {
    sidebarKey: "me.security.activity",
    moduleCode: "ME",
    label: "Hoạt động bảo mật",
    path: "/me/security/activity",
    icon: "shield-alert",
    group: "Tài khoản & bảo mật",
    order: 50,
    requiredAnyPermissions: ["access:me"],
  },
  // S5-LMS-FE-1 — Tiến độ đào tạo (LMS chảy ngược) TRONG MediaOS: /me/training (GET /me/training proxy).
  // Cùng gate access:lms + group "Đào tạo"; đứng TRƯỚC mục "Đào tạo (LMS)" (mở LMS ngoài) — order 59.
  {
    sidebarKey: "me.training",
    moduleCode: "ME",
    label: "Tiến độ đào tạo",
    path: "/me/training",
    icon: "graduation-cap",
    group: "Đào tạo",
    order: 59,
    requiredAnyPermissions: ["access:lms"],
  },
  // Tích hợp LMS Giai đoạn A: mở LMS qua cầu SSO (/lms fetch sso-link rồi chuyển trang).
  // Gate access:lms (KHÔNG access:me) — nhất quán với card Trang chủ + endpoint BE: ai bị thu quyền
  // KHÔNG thấy link này. (mig 0508 cấp mặc định cho 4 role canonical.)
  {
    sidebarKey: "me.lms",
    moduleCode: "ME",
    label: "Đào tạo (LMS)",
    path: "/lms",
    icon: "graduation-cap",
    group: "Đào tạo",
    order: 60,
    requiredAnyPermissions: ["access:lms"],
  },
  // S7-CHAT-FE-3 — lối vào /chat (SPEC-15, đóng lời hứa "dài hạn = module CHAT nội bộ" của S5-LMS-UI-4).
  //
  // Vì sao nằm trong ME_SIDEBAR chứ không phải một CHAT_SIDEBAR riêng: `ModuleSidebar` chỉ render
  // `SIDEBAR_REGISTRY[moduleCode]` của module ĐANG mở trong `ModuleWorkspaceLayout`, mà `/chat` CỐ Ý
  // không bọc layout đó (FE-2: trang đã 3 cột, thêm sidebar là cột thứ tư). Khai `SIDEBAR_REGISTRY.CHAT`
  // sẽ là code chết — không layout nào render nó. ME là nơi duy nhất mọi nhân viên đều có, và đã có tiền
  // lệ đúng hình dạng này: `me.lms` cũng là link RỜI khỏi module ME.
  //
  // Lối vào TOÀN HỆ THỐNG thật sự là `ChatBadge` trên header (có mặt ở mọi route đã đăng nhập); mục này
  // là lối vào trong workspace. Gate cặp engine LITERAL `access:chat` (mig 0538, non-sensitive, grant
  // Company cho 4 role canonical) — `filterSidebarItems` tự ẩn khi thiếu quyền, KHÔNG hard-code role.
  {
    sidebarKey: "me.chat",
    moduleCode: "ME",
    label: "Tin nhắn",
    path: "/chat",
    icon: "messages-square",
    group: "Trao đổi",
    order: 70,
    requiredAnyPermissions: ["access:chat"],
  },
];
