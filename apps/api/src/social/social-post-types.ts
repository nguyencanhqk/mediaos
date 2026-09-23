import { UnprocessableEntityException } from "@nestjs/common";
import type { CreateFeedPostDto } from "@mediaos/contracts";
import type { TenantTx } from "../db/db.service";
import { feedPollOptions, feedPolls } from "../db/schema/social";
import { SOCIAL_ERR } from "./social.errors";

/**
 * S16-SOCIAL-BE-2B-1 — phần thân RIÊNG THEO LOẠI BÀI của `SOCIAL-API-002`.
 *
 * Tách khỏi `social-posts.service.ts` vì hai lý do, không phải vì gọn gàng:
 *  1. File đó đã **636 dòng / trần 800**; ba loại bài (poll ở đây, idea/kudos ở BE-2B-2) nhét vào
 *     trong đó sẽ vượt trần mà KHÔNG cổng nào chặn (trần 800 là luật tự-kiểm, CI không ép).
 *  2. Hàm ở đây **không gọi `resolveActor`** ⇒ không sinh "service site" cho census 2 tầng. Cổng
 *     quyền của `002` sống đúng một chỗ: `SocialAccessService.assertCreatablePostType`.
 *
 * Hàm thuần nhận `tx` — KHÔNG tự mở `withTenant`. Lồng `withTenant` trong `withTenant` là **treo im
 * lặng** trên PgBouncer transaction-mode (pool `max:20` không có `connectionTimeoutMillis`).
 */

/** Khoảng số lựa chọn hợp lệ của một bình chọn (SPEC-16 §12 `SOCIAL-ERR-018`). */
const POLL_OPTIONS_MIN = 2;
const POLL_OPTIONS_MAX = 10;

type CreatePollInput = NonNullable<CreateFeedPostDto["poll"]>;

/**
 * Tạo bình chọn cho một bài vừa INSERT.
 *
 * 🔴 **SITE DUY NHẤT trong toàn module được ghi `multipleChoice` / `isAnonymous`.**
 * `db/schema/social.ts:596-600` ra lệnh hai cờ này BẤT BIẾN sau khi tạo: đổi giữa chừng làm chốt
 * `feed_poll_votes_single_uq` sai lệch IM LẶNG (partial index không đọc được bảng khác — hàng phiếu
 * cũ đã ghi `single_choice` theo giá trị CŨ vẫn nằm đó). `social-poll-flags-structure.spec.ts` gác
 * bất biến này bằng cách quét mã nguồn, vì không request nào gọi ra được một UPDATE chưa ai viết.
 */
export async function createPollTx(
  tx: TenantTx,
  companyId: string,
  postId: string,
  input: CreatePollInput,
): Promise<string> {
  assertPollInput(input);

  const [poll] = await tx
    .insert(feedPolls)
    .values({
      companyId,
      postId,
      question: input.question,
      multipleChoice: input.multipleChoice,
      isAnonymous: input.isAnonymous,
      closesAt: input.closesAt === undefined ? null : new Date(input.closesAt),
      // `status`/`closedAt` CỐ Ý không truyền: DEFAULT `'open'` của DB là nguồn sự thật, và
      // `chk_feed_polls_closed_pair` đòi `closed_at` NULL khi còn `open`.
    })
    .returning({ id: feedPolls.id });

  await tx.insert(feedPollOptions).values(
    input.options.map((label, index) => ({
      companyId,
      pollId: poll.id,
      label,
      // `position` do SERVER sinh `0..n-1`, KHÔNG nhận từ client: `feed_poll_options_position_uq`
      // là `(company_id, poll_id, position)` nên một payload gửi trùng position sẽ ăn 23505 ⇒ 500.
      position: index,
      // `voteCount` để DEFAULT 0 — bộ đếm chỉ đi qua `bumpPollOptionVotes` (UPDATE x = x + delta).
    })),
  );

  return poll.id;
}

/**
 * Luật nhập liệu của bình chọn — ÉP Ở ĐÂY (tầng service), **KHÔNG ở Zod**.
 *
 * ┌─ VÌ SAO KHÔNG ĐẨY LÊN ZOD CHO GỌN ────────────────────────────────────────────────────────────┐
 * │ Zod từ chối ⇒ NestJS trả **400 vô danh**, và `SOCIAL-ERR-018` của SPEC-16 §12 sẽ không bao giờ │
 * │ ra tới người dùng. Ca test assert theo MÃ sẽ đỏ; ca assert theo status trần thì vẫn xanh —     │
 * │ nên lỗi này thuộc loại "sửa cho gọn" rồi mất mã lỗi mà không ai thấy. Luật viết sẵn ở          │
 * │ `packages/contracts/src/social-api.ts:309-310`.                                                │
 * │ Ngoại lệ có chủ đích: **vắng HẲN** `options` là hình dạng sai ⇒ 400 của Zod là ĐÚNG.           │
 * └───────────────────────────────────────────────────────────────────────────────────────────────┘
 */
function assertPollInput(input: CreatePollInput): void {
  if (input.options.length < POLL_OPTIONS_MIN || input.options.length > POLL_OPTIONS_MAX) {
    throw new UnprocessableEntityException(SOCIAL_ERR.POLL_OPTIONS_RANGE);
  }

  // 🔴 KHÔNG ép được ở Zod: `chk_feed_polls_closes_future` so `closes_at` với `created_at` — một
  // giá trị DB sinh lúc INSERT, chưa tồn tại lúc validate (schema `social.ts` ghi thẳng điều này).
  // Không kiểm ở đây thì một mốc quá khứ đi thẳng xuống CHECK ⇒ 23514 ⇒ **500** cho một sai sót
  // nhập liệu hoàn toàn bình thường. So với `now()` chứ không với `created_at`: hai mốc chênh nhau
  // vài mili-giây và người dùng nghĩ theo đồng hồ của họ, không theo thời điểm INSERT.
  if (input.closesAt !== undefined && new Date(input.closesAt).getTime() <= Date.now()) {
    throw new UnprocessableEntityException(SOCIAL_ERR.POLL_CLOSES_AT_PAST);
  }
}
