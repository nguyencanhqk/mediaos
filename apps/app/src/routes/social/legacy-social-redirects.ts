/**
 * S16-SOCIAL-FE-2B (owner ký O2) — chuyển hướng link NOTI cũ `/social/*` sang portal `/feed/*`.
 *
 * Template link của NOTI SOCIAL (migration `0581_s16socialdb2_noti_track_b.sql`) viết theo tiền tố BE:
 * `/social/posts/{post_id}` (×7) và `/social/groups/{group_id}` (NOTI-034 «được duyệt vào nhóm"). FE
 * chưa từng có hai route đó — `/social` là route KHỚP ĐÚNG (trang lỗi SSO của app vệ tinh fbpost,
 * `router.tsx#socialRedirectRoute`) ⇒ bấm thông báo là rơi vào 404 chung. `'/social/reports'` (NOTI
 * báo cáo vi phạm) chờ màn kiểm duyệt của `S16-SOCIAL-FE-3`.
 *
 * File CHỈ xuất dữ liệu thuần + hàm `beforeLoad`: `router.tsx` tự dựng `createRoute` từ mảng này. Tự
 * dựng route ở đây phải import `rootRoute` từ `router.tsx` — là import VÒNG (plan §8 M4).
 * KHÔNG vào `ROUTE_REGISTRY` (không phải màn; ca `social-wiring` «mọi route SOCIAL dưới /feed»).
 */
import { redirect } from "@tanstack/react-router";

export interface LegacySocialRedirect {
  /** Đường cũ mà template NOTI sinh ra. */
  readonly path: "/social/groups/$groupId" | "/social/posts/$postId";
  /** Đích trong portal. */
  readonly to: "/feed/groups/$groupId" | "/feed/posts/$postId";
  /** Tên tham số chung của hai đường. */
  readonly param: "groupId" | "postId";
  /** Template NOTI (DB) mà mục này phục vụ — để ca test đối chiếu. */
  readonly notiTemplate: string;
}

export const LEGACY_SOCIAL_REDIRECTS: readonly LegacySocialRedirect[] = [
  {
    path: "/social/groups/$groupId",
    to: "/feed/groups/$groupId",
    param: "groupId",
    notiTemplate: "/social/groups/{group_id}",
  },
  {
    path: "/social/posts/$postId",
    to: "/feed/posts/$postId",
    param: "postId",
    notiTemplate: "/social/posts/{post_id}",
  },
];

/**
 * `beforeLoad` của một route chuyển hướng: ném `redirect` tới đích với CÙNG tham số, `replace` để nút
 * Back không dội người dùng về đường cũ (rồi lại bị đẩy đi).
 */
export function legacyRedirectBeforeLoad(
  entry: LegacySocialRedirect,
): (ctx: { params: Record<string, string> }) => never {
  return ({ params }) => {
    const value = params[entry.param] ?? "";
    throw redirect({
      to: entry.to,
      params: { [entry.param]: value } as never,
      replace: true,
    });
  };
}
