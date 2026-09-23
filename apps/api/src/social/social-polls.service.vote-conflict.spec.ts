/**
 * S16-SOCIAL-BE-2B-1 — FULL gate lượt 2, finding **F-3** (`silent-failure-hunter`).
 *
 * ┌─ VÌ SAO SPEC NÀY PHẢI TỒN TẠI RIÊNG ──────────────────────────────────────────────────────────┐
 * │ `social-poll-conflict-translate.spec.ts` đo **hàm dịch** `isUniqueViolationOf` một cách cô     │
 * │ lập ⇒ nó đóng vế «hằng bị gõ sai». Nó KHÔNG đóng vế «service dùng SAI hằng».                   │
 * │                                                                                                │
 * │ Chép-dán làm cả hai dòng `social-polls.service.ts:149-150` thành `POLL_VOTE_PK` sẽ **xoá hẳn** │
 * │ nhánh single-choice, mà: unit-spec dịch vẫn xanh (nó tự cấp tên), `N4-db` vẫn xanh (tên vẫn có │
 * │ trong `pg_class`), và toàn bộ 42 ca int-spec vẫn xanh — vì HAI nhánh 23505 **không tới được**  │
 * │ qua HTTP (điểm hội tụ H-1: `lockPollRowTx` tuần tự hoá, DELETE chạy trước INSERT). Hậu quả     │
 * │ đúng bằng thứ docblock của chính spec kia cảnh báo: **500 chưa dịch**, đúng vào ngày một thay  │
 * │ đổi schema làm nhánh ấy sống lại.                                                              │
 * │                                                                                                │
 * │ Nên lưới ở đây bơm lỗi giả vào ĐÚNG chỗ service bắt (`insertVotesTx`) và đo cái service NHẢ RA.│
 * └───────────────────────────────────────────────────────────────────────────────────────────────┘
 */

import { ConflictException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { DatabaseService } from "../db/db.service";
import type { AuditService } from "../events/audit.service";
import type { OutboxService } from "../events/outbox.service";
import type { SocialAccessService } from "./social-access.service";
import type { SocialPollsRepository } from "./social-polls.repository";
import { SocialPollsService } from "./social-polls.service";
import { SOCIAL_CONSTRAINT, SOCIAL_ERR } from "./social.errors";

const COMPANY = "11111111-1111-1111-1111-111111111111";
const USER = "22222222-2222-2222-2222-222222222222";
const POST = "33333333-3333-3333-3333-333333333333";
const POLL = "44444444-4444-4444-4444-444444444444";
const OPTION = "55555555-5555-5555-5555-555555555555";

/** Lỗi drizzle THẬT bọc lỗi pg trong `cause`. */
function pgDup(constraint: string): Error {
  const pg = Object.assign(new Error("duplicate key value violates unique constraint"), {
    code: "23505",
    constraint,
  });
  return Object.assign(new Error("Failed query"), { cause: pg });
}

/**
 * Dựng service với repo giả, `insertVotesTx` ném `err`.
 *
 * `withTenant` gọi thẳng `fn(tx)` với một `tx` giả — mọi thứ trước `insertVotesTx` đã được stub cho
 * đi qua, nên thứ DUY NHẤT ca này đo là đường dịch lỗi.
 */
function serviceThatThrows(err: unknown) {
  // `openPollForWriteTx` gọi `getPollByPostTx` HAI lần (trước và SAU `lockPollRowTx` — đọc lại sau
  // khoá là chủ ý chống TOCTOU), nên stub phải trả hàng ĐẦY ĐỦ ở cả hai lượt.
  const openPoll = {
    id: POLL,
    postId: POST,
    question: "Q",
    status: "open" as const,
    multipleChoice: false,
    isAnonymous: false,
    closesAt: null,
    expired: false,
  };

  const repo = {
    lockPollRowTx: vi.fn(async () => undefined),
    getPollByPostTx: vi.fn(async () => openPoll),
    countOptionsOfPollTx: vi.fn(async () => 1),
    deleteVotesOfUserTx: vi.fn(async () => [] as string[]),
    insertVotesTx: vi.fn(async (): Promise<number> => {
      throw err;
    }),
    pollResultsTx: vi.fn(async () => ({ options: [], totalVoters: 0, myVote: [] })),
  };

  const service = new SocialPollsService(
    {
      // `tx.execute` chỉ cần sống cho `bumpPollOptionVotes` ở đường THÀNH CÔNG (neo dương): nó đối
      // chiếu số hàng `RETURNING` với số option yêu cầu, nên phải trả đúng một hàng cho `OPTION`.
      withTenant: (_c: string, fn: (tx: unknown) => unknown) =>
        fn({ execute: async () => ({ rows: [{ id: OPTION }] }) }),
    } as unknown as DatabaseService,
    {
      resolveActor: vi.fn(async () => ({ companyId: COMPANY, actorUserId: USER })),
      assertPostVisible: vi.fn(async () => undefined),
    } as unknown as SocialAccessService,
    repo as unknown as SocialPollsRepository,
    {} as AuditService,
    {} as OutboxService,
  );
  return { service, repo };
}

const user = { id: USER, companyId: COMPANY } as never;

describe("F-3 — `vote()` dịch 23505 của CẢ HAI chốt thành 409, không để rơi xuống 500", () => {
  const branches = [
    ["POLL_VOTE_PK (cùng option, cùng người)", SOCIAL_CONSTRAINT.POLL_VOTE_PK],
    ["POLL_VOTE_SINGLE_UQ (khác option, poll một-lựa-chọn)", SOCIAL_CONSTRAINT.POLL_VOTE_SINGLE_UQ],
  ] as const;

  it.each(branches)("nhánh %s ⇒ ConflictException đúng CHUỖI", async (_label, constraint) => {
    const { service } = serviceThatThrows(pgDup(constraint));

    // 🔴 Đo CẢ hai vế: đúng KIỂU ngoại lệ (quyết định mã HTTP) và đúng CHUỖI (quyết định thứ người
    // dùng đọc). Chỉ assert `rejects.toThrow()` thì một `Error` trần cũng xanh ⇒ vẫn là 500.
    await expect(service.vote(user, POST, [OPTION])).rejects.toBeInstanceOf(ConflictException);
    await expect(service.vote(user, POST, [OPTION])).rejects.toThrow(
      SOCIAL_ERR.POLL_VOTE_DUPLICATE,
    );
  });

  it("23505 của constraint KHÁC ⇒ ném NGUYÊN, KHÔNG nuốt thành 409", async () => {
    // Nuốt mọi `23505` thành "đã bỏ phiếu" là dịch SAI nguyên nhân rồi làm lỗi thật biến mất khỏi
    // log điều tra — đúng luật đã thành văn ở docblock `isUniqueViolationOf`.
    const { service } = serviceThatThrows(pgDup("feed_poll_options_position_uq"));
    await expect(service.vote(user, POST, [OPTION])).rejects.not.toBeInstanceOf(ConflictException);
  });

  it("lỗi KHÔNG phải 23505 ⇒ ném NGUYÊN (đường 500 vẫn phải mở cho lỗi thật)", async () => {
    const boom = new Error("mất kết nối giữa chừng");
    const { service } = serviceThatThrows(boom);
    await expect(service.vote(user, POST, [OPTION])).rejects.toThrow("mất kết nối giữa chừng");
  });

  it("NEO DƯƠNG: đường KHÔNG lỗi chạy tới `pollResultsTx` — ba ca trên đỏ vì DỊCH, không vì stub", async () => {
    const { service, repo } = serviceThatThrows(new Error("không dùng"));
    repo.insertVotesTx.mockImplementation(async () => 1);

    await expect(service.vote(user, POST, [OPTION])).resolves.toMatchObject({ totalVoters: 0 });
    expect(repo.pollResultsTx).toHaveBeenCalledTimes(1);
  });
});
