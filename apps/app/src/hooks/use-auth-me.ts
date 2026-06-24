/**
 * Hook: query /auth/me để lấy SessionContext đầy đủ dùng trong ProtectedShell.
 *
 * Nợ kỹ thuật từ S1-FE-REGISTRY-1 (buildSession để company=null, modules=[]):
 * hook này build SessionContext từ /auth/me response thật.
 *
 * TODO(BE): khi /auth/me bổ sung `company` + `modules` vào response payload,
 * map thẳng vào SessionContext. Hiện tại fallback an toàn: company=null, modules=[].
 * Guard sẽ cho SHOW_404 mọi route có moduleCode — đây là fallback có chủ đích,
 * KHÔNG bịa data.
 *
 * staleTime=5 phút, refetchOnWindowFocus=true để phát hiện session revoke sớm.
 */
import { useQuery } from "@tanstack/react-query";
import { authApi, type SessionContext } from "@mediaos/web-core";

/** Query key stable — dùng trong invalidate sau logout / permission change. */
export const AUTH_ME_QUERY_KEY = ["auth", "me"] as const;

export function useAuthMe() {
  return useQuery({
    queryKey: AUTH_ME_QUERY_KEY,
    queryFn: async (): Promise<SessionContext> => {
      const me = await authApi.me();

      const userStatus = ((): NonNullable<SessionContext["user"]>["status"] => {
        const s = me.status;
        if (s === "Active" || s === "Inactive" || s === "Locked" || s === "Pending Activation") {
          return s;
        }
        return "Active";
      })();

      return {
        status: "authenticated",
        user: {
          id: me.id,
          email: me.email,
          status: userStatus,
          companyId: me.companyId,
        },
        // TODO(BE): map company + modules khi BE wire đủ payload vào /auth/me
        company: null,
        modules: [],
      };
    },
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
}
