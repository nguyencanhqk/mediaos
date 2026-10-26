import { useQuery } from "@tanstack/react-query";
import { authApi, authKeys } from "@mediaos/web-core";

/**
 * S20-TASK-QUICKADD-1 — hồ sơ nhân viên của CHÍNH TÔI cho «giao cho tôi» (tạo nhanh · form Tạo).
 *
 * Đọc `employee` của `GET /auth/me` (chỉ cần đăng nhập — KHÔNG cần `read:employee` hay `access:me`),
 * cùng khoá cache `authKeys.me()` với Hồ sơ tài khoản / bộ lọc mặc định của Mục tiêu. `employee = null`
 * ⇒ tài khoản chưa liên kết hồ sơ (operator, tài khoản mới) ⇒ phía gọi KHÔNG gửi request tạo việc.
 */
export type MyEmployeeLink =
  | { readonly status: "loading" }
  | { readonly status: "error" }
  | { readonly status: "unlinked" }
  | { readonly status: "linked"; readonly employeeId: string; readonly fullName: string | null };

const ME_STALE_TIME_MS = 300_000;

export function useMyEmployeeLink(enabled: boolean): MyEmployeeLink {
  const { data, isError } = useQuery({
    queryKey: authKeys.me(),
    queryFn: () => authApi.me(),
    enabled,
    staleTime: ME_STALE_TIME_MS,
  });
  if (isError) return { status: "error" };
  if (!data) return { status: "loading" };
  const employee = data.employee ?? null;
  return employee
    ? { status: "linked", employeeId: employee.id, fullName: employee.fullName }
    : { status: "unlinked" };
}
