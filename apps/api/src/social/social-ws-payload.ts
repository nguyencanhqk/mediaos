import type {
  FeedAudienceDto,
  FeedPostDto,
  FeedPostStatusDto,
  WsFeedPostCreatedEvent,
} from "@mediaos/contracts";

/**
 * Ba cột của HÀNG DB quyết định bài có được phát không và phát vào room nào. Giữ `string` vì đó là kiểu
 * cột `text` mà repository trả (`PostRow`); các LITERAL so sánh bên dưới mới là thứ phải được trình biên
 * dịch kiểm (`satisfies` — FULL gate lượt 1, typescript-reviewer LOW): gõ nhầm `"publish"` hay đổi tên một
 * giá trị enum ở contracts là ĐỎ lúc BIÊN DỊCH, không phải một builder trả `null` cho MỌI bài trong im lặng.
 */
export interface WsPostRouteRow {
  audience: string;
  status: string;
  groupId: string | null;
}

/**
 * S16-SOCIAL-BE-2C — nguồn payload `feed:post.created` (hàm THUẦN, plan §4.7). Vế THỨ NHẤT của luật 3
 * (`packages/contracts/src/realtime.ts`); vế thứ hai là `.parse()` của emitter.
 *
 * Trả `null` (KHÔNG phát) khi: bài không `published` · `audience='org_unit'` (không có room nào — D21,
 * Q-ORG) · bài nhóm thiếu `groupId` (không có đích). Còn lại: biến thể `company` hoặc `group`.
 *
 * 🔴 **Nhãn `audience`/`groupId` lấy TỪ HÀNG DB, KHÔNG từ hằng.** Emitter định tuyến theo nhãn của payload
 * đã parse (bất biến 7). Code BE-1 đè `audience: "company"` tại nguồn — đúng khi chỉ bài company được
 * phát, nhưng giữ hằng đó cho nhánh nhóm là dán nhãn bài nhóm KÍN thành bài công ty ⇒ emitter đưa nó ra
 * room CẢ CÔNG TY (mutant M18 — ca P2 + int E0e/E1e). `orgUnitId` ép `null`: CHECK DB bảo đảm hàng
 * `company`/`group` luôn `org_unit_id IS NULL`, và schema WS chỉ nhận `null`.
 *
 * Bóc TẠI NGUỒN dù schema WS cũng bóc (hai tầng độc lập — mỗi tầng một mình đều từng bị bỏ quên):
 *   • 4 khoá projection-theo-actor (`myReaction`/`savedByMe`/`isMine`/`status`) — `dto` decorate bằng
 *     TÁC GIẢ; phát cho room là gửi cờ của người vừa đăng tới mọi người;
 *   • `mentions` (BE-1D D6) · `kudos`/`poll`/`idea` (BE-2D D7 — `poll.myVote` là của tác giả);
 *   • `url` của đính kèm — presign KÝ CHO MỘT NGƯỜI, là bearer capability (luật 2).
 */
export function buildWsPostCreatedEvent(
  row: WsPostRouteRow,
  dto: FeedPostDto,
): WsFeedPostCreatedEvent | null {
  if (row.status !== ("published" satisfies FeedPostStatusDto)) return null;
  const {
    myReaction: _mr,
    savedByMe: _sb,
    isMine: _im,
    status: _st,
    mentions: _mn,
    kudos: _kd,
    poll: _pl,
    idea: _id,
    // Ba khoá định tuyến: dựng lại từ HÀNG bên dưới — không chở giá trị của DTO qua `...rest`.
    audience: _au,
    groupId: _gi,
    orgUnitId: _ou,
    attachments,
    ...rest
  } = dto;
  const base = { ...rest, attachments: attachments.map(({ url: _u, ...a }) => a) };

  if (row.audience === ("company" satisfies FeedAudienceDto)) {
    return { ...base, audience: "company", groupId: null, orgUnitId: null };
  }
  if (row.audience === ("group" satisfies FeedAudienceDto) && row.groupId) {
    return { ...base, audience: "group", groupId: row.groupId, orgUnitId: null };
  }
  return null;
}
