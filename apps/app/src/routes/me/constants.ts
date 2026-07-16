/**
 * Hằng module ME (SPEC-09) — S5-ME-FE-1.
 *
 * `ME_ACCESS_PAIR` mirror BE `apps/api/src/me/me.constants.ts` (mig 0495: action='access',
 * resourceType='me', non-sensitive) — dùng trong `useCan()` để page tự gate lại (defense-in-depth, mirror
 * `DASH_READ_PAIR`/`DashboardMePage`) — route-level đã gate qua ROUTE_REGISTRY['me.overview'].
 *
 * `ME_QUICK_ACTION_PATHS` — route module gốc ĐÃ build mà Tổng quan ME deep-link tới (§10.1/§12.5). Route
 * đích tự guard/permission lại — ME KHÔNG bypass. Hằng hoá để tránh magic string rải trong component.
 */
export const ME_ACCESS_PAIR = { action: "access", resourceType: "me" } as const;

export const ME_QUICK_ACTION_PATHS = {
  EDIT_PROFILE: "/hr/me",
  CHANGE_PASSWORD: "/account/change-password",
  CHECK_IN_OUT: "/attendance/today",
  CREATE_LEAVE: "/leave/me/requests/new",
  MY_LEAVE_REQUESTS: "/leave/me/requests",
  MY_TASKS: "/tasks/my-tasks",
  NOTIFICATIONS: "/notifications",
} as const;
