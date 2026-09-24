import { UnprocessableEntityException } from "@nestjs/common";
import type { CreateFeedPostDto } from "@mediaos/contracts";
import type { TenantTx } from "../db/db.service";
import {
  feedIdeas,
  feedKudos,
  feedKudosRecipients,
  feedPollOptions,
  feedPolls,
} from "../db/schema/social";
import { assertActiveBadgeTx, assertRecipientsTx } from "./social-kudos.repository";
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

// ══════════════════════════════════════════════════════════════════════════════════════════════
//  S16-SOCIAL-BE-2B-2 — SÁNG KIẾN (`type='idea'`) · VINH DANH (`type='kudos'`)
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** Khoảng số người được vinh danh hợp lệ. Trần 10 do owner chốt (S3, 23/09/2026) — SPEC-16 §13. */
export const KUDOS_RECIPIENT_MIN = 1;
export const KUDOS_RECIPIENT_MAX = 10;

type CreateKudosInput = NonNullable<CreateFeedPostDto["kudos"]>;

/**
 * Tạo hàng `feed_ideas` cho một bài `type='idea'` vừa INSERT. Trả về `feed_ideas.id`.
 *
 * 🔴 **`status: "submitted"` ghi TƯỜNG MINH.** Cột `feed_ideas.status` là `varchar(16) NOT NULL`
 * **KHÔNG CÓ DEFAULT** (`0580:263-301`) — khác `feed_polls.status` vốn `DEFAULT 'open'`. Bỏ trường này
 * cho "DB tự lo" như `createPollTx` làm là `23502` (not-null violation) ⇒ **500** cho một đường tạo bài
 * hoàn toàn bình thường. Đây là chỗ hai loại bài KHÔNG đối xứng, và đối xứng hoá cho gọn là một lỗi.
 *
 * `reviewed_by`/`reviewed_at`/`review_note` CỐ Ý không truyền: `chk_feed_ideas_reviewed_pair` cho
 * chúng NULL đúng khi `status IN ('submitted','under_review')`, và chúng là vết của `046`.
 *
 * Không có gì để validate ở đây — sáng kiến không có trường riêng nào trong payload `002` (API-19
 * §5.1b: cột "Trường body riêng" của `idea` là «—»). `body` bắt buộc đã ép ở `superRefine`.
 */
export async function createIdeaTx(
  tx: TenantTx,
  companyId: string,
  postId: string,
): Promise<string> {
  const [idea] = await tx
    .insert(feedIdeas)
    .values({ companyId, postId, status: "submitted" })
    .returning({ id: feedIdeas.id });
  return idea.id;
}

/**
 * Tạo hàng `feed_kudos` + `feed_kudos_recipients` cho một bài `type='kudos'` vừa INSERT.
 *
 * Trả về `{ kudosId, recipientEmployeeIds }` — caller cần tập id ĐÃ CHUẨN HOÁ để map sang `user_id`
 * cho NOTI-033 (KHÔNG đọc lại từ DTO: DTO có thể chứa trùng lặp và khác HOA/thường).
 *
 * ┌─ THỨ TỰ BỐN LUẬT LÀ MỘT QUYẾT ĐỊNH, KHÔNG PHẢI TÌNH CỜ ────────────────────────────────────────┐
 * │ Khi một payload vi phạm NHIỀU luật cùng lúc, mã lỗi trả về là mã của luật chạy TRƯỚC. Thứ tự ở   │
 * │ đây đi từ RẺ và ÍT RÒ RỈ tới ĐẮT:                                                               │
 * │   1. **K2** số lượng (thuần bộ nhớ) — 11 người thì không cần hỏi DB câu nào;                    │
 * │   2. **K1** tự vinh danh (thuần bộ nhớ);                                                        │
 * │   3. **`ERR-022`** huy hiệu (một câu, KHÔNG rò gì về nhân sự);                                   │
 * │   4. **D12a** người nhận (một câu trên `employee_profiles`).                                    │
 * │ Đảo 3↔4 thì một payload vừa sai huy hiệu vừa có `employee_id` dò-thử sẽ trả mã người-nhận —      │
 * │ tức biến cổng huy hiệu thành oracle dò nhân sự. Giữ nguyên thứ tự này.                          │
 * └────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ Cổng `isOfficial` (cặp `manage:feed-kudos` ⇒ 403) KHÔNG ở đây mà ở `social-posts.service.ts`
 * **TRƯỚC khi mở tx**: nó là câu hỏi QUYỀN, không phải luật dữ liệu, và chạy nó trước tx là cách duy
 * nhất bảo đảm `COUNT(*) feed_kudos = 0` mà không dựa vào rollback (ca `K-3` đếm đúng điều đó).
 *
 * ⚠️ `authorEmployeeId` có thể `null` — tác giả không có hồ sơ nhân sự (`employee_profiles.user_id`
 * nullable, và một `users` có thể chưa được gán hồ sơ). Lúc đó K1 đúng là KHÔNG chặn gì: không có
 * `employee_id` nào của tác giả để trùng. Fail-open ở đây là ĐÚNG NGHĨA, không phải lỗ.
 */
export async function createKudosTx(
  tx: TenantTx,
  companyId: string,
  postId: string,
  authorEmployeeId: string | null,
  input: CreateKudosInput,
): Promise<{ kudosId: string; recipientEmployeeIds: string[] }> {
  // (1) K2 — trần + sàn, MỘT mã cho cả hai đầu. Mảng rỗng là "vinh danh không ai": hình dạng hợp lệ,
  // nghiệp vụ vô nghĩa ⇒ 422 có mã, không phải 400 vô danh của Zod.
  const distinct = [...new Set(input.recipientEmployeeIds.map((id) => id.toLowerCase()))];
  if (distinct.length < KUDOS_RECIPIENT_MIN || distinct.length > KUDOS_RECIPIENT_MAX) {
    throw new UnprocessableEntityException(SOCIAL_ERR.KUDOS_RECIPIENT_LIMIT);
  }

  // (2) K1 — tự vinh danh. So SAU khi chuẩn hoá HOA/thường: `Set` so chuỗi, Postgres so `uuid`, nên
  // một `employee_id` gửi bằng chữ HOA sẽ lọt qua phép so trần rồi ghi được vào DB.
  if (authorEmployeeId != null && distinct.includes(authorEmployeeId.toLowerCase())) {
    throw new UnprocessableEntityException(SOCIAL_ERR.KUDOS_SELF_RECIPIENT);
  }

  // (3) ERR-022 — huy hiệu tồn tại VÀ đang bật. (4) D12a — người nhận là nhân sự còn tồn tại.
  await assertActiveBadgeTx(tx, companyId, input.badgeId);
  const recipientEmployeeIds = await assertRecipientsTx(tx, companyId, distinct);

  const [kudos] = await tx
    .insert(feedKudos)
    .values({
      companyId,
      postId,
      badgeId: input.badgeId ?? null,
      message: input.message,
      isOfficial: input.isOfficial,
    })
    .returning({ id: feedKudos.id });

  await tx.insert(feedKudosRecipients).values(
    recipientEmployeeIds.map((employeeId) => ({
      companyId,
      kudosId: kudos.id,
      employeeId,
    })),
  );

  return { kudosId: kudos.id, recipientEmployeeIds };
}
