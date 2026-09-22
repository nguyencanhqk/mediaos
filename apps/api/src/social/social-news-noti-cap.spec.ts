/**
 * `N-C8-trần` — nhánh CẮT của trần người nhận `NOTI-031`.
 *
 * ┌─ VÌ SAO CA NÀY TỒN TẠI (FULL gate 22/09) ──────────────────────────────────────────────────────┐
 * │ Bất biến «CẤM cắt câm» được tuyên bố trong 12 dòng docblock ở `enqueueNewsPublishedNoti`, nhưng │
 * │ nhánh `truncated === true` KHÔNG có một ca nào đo: int-spec chỉ chạm nhánh `toBe(false)`. Một   │
 * │ lượt "dọn dẹp" sau này đổi `>` thành `>=`, bỏ `logger.warn`, hay cắt TRƯỚC khi sắp xếp, sẽ đi   │
 * │ qua mọi cổng. Hệ quả THẬT: tin `requires_ack` ở công ty >500 người — người thứ 501+ không được  │
 * │ báo, trong khi route `022` vẫn liệt họ «chưa đọc».                                              │
 * │                                                                                                 │
 * │ Đo ở tầng UNIT với repository giả: gieo 501 user thật chỉ để chạm một nhánh `if` là đắt và chậm,│
 * │ và trần là hằng module-level (`export const`) nên không hạ được từ int-spec nếu không mock cả   │
 * │ module.                                                                                          │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 */

import { Logger } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { SocialPostsService } from "./social-posts.service";
import { SOCIAL_EVENT_NEWS_PUBLISHED, SOCIAL_NEWS_NOTI_RECIPIENT_CAP } from "./social-noti.payload";
import type { SocialActor } from "./social.types";

const COMPANY = "11111111-1111-4111-8111-111111111111";
const AUTHOR = "22222222-2222-4222-8222-222222222222";

/** `user_id` đã SẮP tăng dần — đúng hợp đồng của `audienceUserIds`. */
function sortedUserIds(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `user-${String(i).padStart(5, "0")}`);
}

/**
 * Dựng service với ĐÚNG hai cộng tác viên mà nhánh này chạm (`news` + `outbox`); phần còn lại là
 * `null` — nếu một lượt sửa sau kéo thêm phụ thuộc vào nhánh này, ca sẽ NỔ chứ không im lặng đi qua.
 */
function makeService(audience: { userIds: string[]; total: number }) {
  const enqueue = vi.fn().mockResolvedValue(undefined);
  const audienceUserIds = vi.fn().mockResolvedValue(audience);
  const service = new SocialPostsService(
    null as never, // db
    null as never, // access
    null as never, // repo
    null as never, // projections
    null as never, // attachments
    null as never, // audit
    { enqueue } as never, // outbox
    null as never, // realtime
    { audienceUserIds } as never, // news
  );
  return { service, enqueue, audienceUserIds };
}

const ACTOR = { companyId: COMPANY, actorUserId: AUTHOR } as SocialActor;
const POST = { audience: "company", orgUnitId: null };

/**
 * `tx` giả vừa đủ cho `resolveActorName` (tên tác giả đi vào `{actor_name}` của template): mọi mắt
 * xích drizzle trả về CHÍNH nó, và `then` làm cả chuỗi `await` được. Không dựng DB — nhánh đang đo
 * là số học của trần, không phải SQL.
 */
function fakeTx(): unknown {
  const rows = [{ fullName: "Người đăng tin" }];
  const chain: Record<string, unknown> = {
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(rows).then(resolve),
  };
  for (const m of ["select", "from", "where", "limit", "leftJoin", "innerJoin", "orderBy"]) {
    chain[m] = () => chain;
  }
  return chain;
}

/** `enqueueNewsPublishedNoti` là `private` — gọi qua chỉ số để KHÔNG phải nới khả kiến cho test. */
function callEnqueue(service: SocialPostsService, postId: string): Promise<void> {
  return (
    service as unknown as {
      enqueueNewsPublishedNoti: (
        tx: unknown,
        actor: SocialActor,
        postId: string,
        post: { audience: string; orgUnitId: string | null },
      ) => Promise<void>;
    }
  ).enqueueNewsPublishedNoti(fakeTx() as never, ACTOR, postId, POST);
}

describe("NOTI-031 — trần người nhận (N-C8-trần)", () => {
  it("VƯỢT trần: cắt đúng trần · cờ `recipientsTruncated` · `totalRecipients` là tổng THẬT · WARN mang post_id", async () => {
    const total = SOCIAL_NEWS_NOTI_RECIPIENT_CAP + 37;
    const { service, enqueue } = makeService({
      userIds: sortedUserIds(SOCIAL_NEWS_NOTI_RECIPIENT_CAP),
      total,
    });
    const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);

    await callEnqueue(service, "post-cap");

    expect(enqueue).toHaveBeenCalledTimes(1);
    const { eventType, payload } = enqueue.mock.calls[0]![1] as {
      eventType: string;
      payload: {
        recipientUserIds: string[];
        recipientsTruncated: boolean;
        totalRecipients: number;
      };
    };

    expect(eventType).toBe(SOCIAL_EVENT_NEWS_PUBLISHED);
    expect(payload.recipientUserIds).toHaveLength(SOCIAL_NEWS_NOTI_RECIPIENT_CAP);
    expect(payload.recipientsTruncated, "cắt mà cờ vẫn false = payload NÓI DỐI").toBe(true);
    expect(payload.totalRecipients, "tổng THẬT trước khi cắt, không phải độ dài đã cắt").toBe(
      total,
    );

    // XÁC ĐỊNH: tập trả về là TIỀN TỐ của thứ tự `user_id` tăng dần — cắt sau khi sắp, không trước.
    expect(payload.recipientUserIds).toEqual([...payload.recipientUserIds].sort());

    const warned = warn.mock.calls.map((c) => String(c[0])).join("\n");
    expect(warned, "log WARN phải mang post_id để đối soát được sự cố").toContain("post-cap");
    expect(warned).toContain(String(total));
    warn.mockRestore();
  });

  it("ĐÚNG bằng trần: KHÔNG coi là cắt (ranh giới `>` chứ không phải `>=`)", async () => {
    const { service, enqueue } = makeService({
      userIds: sortedUserIds(SOCIAL_NEWS_NOTI_RECIPIENT_CAP),
      total: SOCIAL_NEWS_NOTI_RECIPIENT_CAP,
    });

    await callEnqueue(service, "post-exact");

    const { payload } = enqueue.mock.calls[0]![1] as {
      payload: { recipientsTruncated: boolean; totalRecipients: number };
    };
    expect(payload.recipientsTruncated).toBe(false);
    expect(payload.totalRecipients).toBe(SOCIAL_NEWS_NOTI_RECIPIENT_CAP);
  });

  it("tập RỖNG: WARN và KHÔNG enqueue (registrar ném nếu nhận payload rỗng — không nuốt)", async () => {
    const { service, enqueue } = makeService({ userIds: [], total: 0 });
    const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);

    await callEnqueue(service, "post-empty");

    expect(enqueue, "không có người nhận thì KHÔNG phát sự kiện").not.toHaveBeenCalled();
    expect(warn.mock.calls.map((c) => String(c[0])).join("\n")).toContain("post-empty");
    warn.mockRestore();
  });

  it("trần truyền XUỐNG SQL: repository được gọi với `limit` = trần và loại tác giả", async () => {
    const { service, audienceUserIds } = makeService({ userIds: sortedUserIds(10), total: 10 });

    await callEnqueue(service, "post-args");

    expect(audienceUserIds).toHaveBeenCalledTimes(1);
    const [, companyId, post, opts] = audienceUserIds.mock.calls[0]!;
    expect(companyId).toBe(COMPANY);
    expect(post).toEqual(POST);
    // Cắt ở SQL, không ở JS (`clamp-must-be-sql-not-js`): trần và tác giả phải đi XUỐNG câu truy vấn.
    expect(opts).toEqual({ excludeUserId: AUTHOR, limit: SOCIAL_NEWS_NOTI_RECIPIENT_CAP });
  });
});
