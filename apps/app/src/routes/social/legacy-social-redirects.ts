/**
 * S16-SOCIAL-FE-2B (owner ký O2) · S16-SOCIAL-FE-3 — chuyển hướng link NOTI cũ `/social/*` sang portal
 * `/feed/*`.
 *
 * Template link của NOTI SOCIAL (migration `0581_s16socialdb2_noti_track_b.sql`) viết theo tiền tố BE:
 * `/social/posts/{post_id}` (×7), `/social/groups/{group_id}` (NOTI-034 «được duyệt vào nhóm») và
 * `/social/reports` (NOTI-036 «có báo cáo vi phạm mới»). FE không có route nào ở các đường đó —
 * `/social` là route KHỚP ĐÚNG (trang lỗi SSO của app vệ tinh fbpost, `router.tsx#socialRedirectRoute`)
 * ⇒ không chuyển hướng thì bấm thông báo là rơi vào 404 chung. `/social/reports` trỏ tới màn Kiểm duyệt
 * `/feed/moderation` (`SOC-SCREEN-010`, dựng ở `S16-SOCIAL-FE-3`).
 *
 * File CHỈ xuất dữ liệu thuần + hàm `beforeLoad`: `router.tsx` tự dựng `createRoute` từ HẰNG CÓ TÊN
 * (tự dựng ở đây phải import `rootRoute` từ `router.tsx` — import VÒNG, plan §8 M4). Mỗi mục là một
 * nhánh của union PHÂN BIỆT: ghép nhầm `path` của nhóm với `to`/`param` của bài là TS đỏ, không phải
 * một link NOTI âm thầm đưa người dùng tới `/feed/posts/` (gate LIGHT — TS M2 / React LOW-2).
 * KHÔNG vào `ROUTE_REGISTRY` (không phải màn; ca `social-wiring` «mọi route SOCIAL dưới /feed»).
 */
import { redirect } from "@tanstack/react-router";

interface LegacyGroupRedirect {
  readonly kind: "group";
  readonly path: "/social/groups/$groupId";
  readonly to: "/feed/groups/$groupId";
  readonly param: "groupId";
  readonly notiTemplate: "/social/groups/{group_id}";
}

interface LegacyPostRedirect {
  readonly kind: "post";
  readonly path: "/social/posts/$postId";
  readonly to: "/feed/posts/$postId";
  readonly param: "postId";
  readonly notiTemplate: "/social/posts/{post_id}";
}

/** NOTI-036 «có báo cáo vi phạm mới» — đường KHÔNG tham số, đích là màn Kiểm duyệt. */
interface LegacyReportsRedirect {
  readonly kind: "reports";
  readonly path: "/social/reports";
  readonly to: "/feed/moderation";
  readonly notiTemplate: "/social/reports";
}

export type LegacySocialRedirect = LegacyGroupRedirect | LegacyPostRedirect | LegacyReportsRedirect;

export const LEGACY_SOCIAL_GROUP_REDIRECT: LegacyGroupRedirect = {
  kind: "group",
  path: "/social/groups/$groupId",
  to: "/feed/groups/$groupId",
  param: "groupId",
  notiTemplate: "/social/groups/{group_id}",
};

export const LEGACY_SOCIAL_POST_REDIRECT: LegacyPostRedirect = {
  kind: "post",
  path: "/social/posts/$postId",
  to: "/feed/posts/$postId",
  param: "postId",
  notiTemplate: "/social/posts/{post_id}",
};

export const LEGACY_SOCIAL_REPORTS_REDIRECT: LegacyReportsRedirect = {
  kind: "reports",
  path: "/social/reports",
  to: "/feed/moderation",
  notiTemplate: "/social/reports",
};

export const LEGACY_SOCIAL_REDIRECTS: readonly LegacySocialRedirect[] = [
  LEGACY_SOCIAL_GROUP_REDIRECT,
  LEGACY_SOCIAL_POST_REDIRECT,
  LEGACY_SOCIAL_REPORTS_REDIRECT,
];

/**
 * `beforeLoad` của một route chuyển hướng: ném `redirect` tới đích với CÙNG tham số (nếu đường cũ có),
 * `replace` để nút Back không dội người dùng về đường cũ (rồi lại bị đẩy đi).
 *
 * Rẽ theo `kind` TRƯỚC khi đọc `param`: nhánh `reports` không có `param`, và `switch` vét cạn (`default`
 * gán `never`) làm nhánh union thứ tư mà quên xử lý là TS đỏ chứ không phải một link NOTI rơi nhầm đích.
 * Chuyển hướng KHÔNG gác quyền: người thiếu `view:feed-report` bấm NOTI-036 tới `/feed/moderation` và
 * gặp trang cấm của chính route đó.
 */
export function legacyRedirectBeforeLoad(
  entry: LegacySocialRedirect,
): (ctx: { params: Record<string, string> }) => never {
  return ({ params }) => {
    switch (entry.kind) {
      case "group":
        throw redirect({
          to: entry.to,
          params: { groupId: params[entry.param] ?? "" },
          replace: true,
        });
      case "post":
        throw redirect({
          to: entry.to,
          params: { postId: params[entry.param] ?? "" },
          replace: true,
        });
      case "reports":
        throw redirect({ to: entry.to, replace: true });
      default: {
        const exhaustive: never = entry;
        throw new Error(`[legacy-social-redirects] kind chưa xử lý: ${String(exhaustive)}`);
      }
    }
  };
}
