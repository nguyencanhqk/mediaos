/**
 * S16-SOCIAL-FE-1 — dựng `SessionContext` + `PermissionChecker` từ auth store cho tầng portal.
 *
 * ┌─ VÌ SAO COPY CHỨ KHÔNG IMPORT ────────────────────────────────────────────────────────────────┐
 * │ Hai hàm này là bản sao gần như nguyên văn của `buildPermissionCheckerFromStore` /              │
 * │ `buildSessionFromStore` đang là **private** trong `layouts/workspace/ModuleWorkspaceLayout.tsx`.│
 * │ UI-07 §34b.6 cấm tường minh việc sửa `layouts/workspace/` ở WO này, mà export chúng ra là mở    │
 * │ rộng bề mặt công khai của một file nằm ngoài phạm vi WO — đổi lấy một phụ thuộc mà người đọc   │
 * │ `ModuleWorkspaceLayout` không thấy được.                                                       │
 * │                                                                                                │
 * │ ⚠️ ĐÂY LÀ NỢ CÓ Ý THỨC, không phải sơ suất: hai bản sẽ TRÔI nếu ai đó sửa một bên. Khi WO nào  │
 * │ được phép đụng `layouts/workspace/`, hãy gộp về MỘT chỗ dùng chung (gợi ý: `layouts/shared/`)  │
 * │ và xoá file này. Cho tới lúc đó, sửa một bên thì sửa cả hai.                                   │
 * └────────────────────────────────────────────────────────────────────────────────────────────────┘
 */
import {
  createPermissionChecker,
  useAuthStore,
  type SessionContext,
  type UserPermission,
} from "@mediaos/web-core";

/**
 * `capabilities` từ `/auth/me` đã khoá theo CẶP ENGINE (`view:feed`…). `scopes: []` là đúng: phạm vi
 * dữ liệu do SERVER ép (RLS + vị từ trong SQL), FE chỉ cần biết "có cặp hay không" để ẩn/hiện.
 */
export function buildPortalPermissionChecker(): ReturnType<typeof createPermissionChecker> {
  const caps = useAuthStore.getState().capabilities;
  const userPermissions: UserPermission[] = Object.entries(caps)
    .filter(([, v]) => v)
    .map(([key]) => ({ permission: key, scopes: [] }));
  return createPermissionChecker(userPermissions);
}

/**
 * ⚠️ `modules: []` là hạn chế ĐANG CÓ của cả hệ (`/auth/me` chưa trả module), giữ y hệt
 * `ModuleWorkspaceLayout`. Hệ quả cần biết: `getVisibleApps` rơi về `app.status` của hằng
 * `APP_REGISTRY` ⇒ **bật `modules.is_active` ở DB KHÔNG tự làm ô Home đổi hành vi** — quyền mới là
 * thứ quyết định (plan M20). Đừng dựa vào cờ đó để ẩn/hiện gì ở FE.
 */
export function buildPortalSession(): SessionContext {
  const state = useAuthStore.getState();
  return {
    status: state.isAuthenticated ? "authenticated" : "unauthenticated",
    user: state.user
      ? {
          id: state.user.id,
          email: state.user.email,
          status: (state.user.status as NonNullable<SessionContext["user"]>["status"]) ?? "Active",
          companyId: state.user.companyId,
        }
      : null,
    company: null,
    modules: [],
  };
}
