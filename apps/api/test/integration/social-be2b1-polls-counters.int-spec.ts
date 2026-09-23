/**
 * S16-SOCIAL-BE-2B-1 — bộ đếm bình chọn ở mức **TỪNG LỰA CHỌN** (nợ test N6 của plan §13.5).
 *
 * ┌─ VÌ SAO Σ LÀ KHÔNG ĐỦ (`santa-A` F6 → owner O-5) ─────────────────────────────────────────────┐
 * │ Ca `C-2` của file chính đo `Σ vote_count == COUNT(*) phiếu`. Bất biến đó KHÔNG bắt được lỗi   │
 * │ **trừ sai lựa chọn**: `-1` vào B thay vì A cho `Σ` đúng, `COUNT(*)` đúng, và                   │
 * │ `chk_feed_poll_options_vote_count` (`>= 0`) không chạm tới. ⇒ `C-2` XANH trong khi kết quả     │
 * │ bình chọn đã sai NGƯỜI — thứ duy nhất tính năng này tồn tại để nói đúng.                        │
 * │ Code hiện tại ĐÚNG; đây là lỗ của **LƯỚI**, không phải của sản phẩm.                            │
 * └───────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * File riêng với `social-be2b1-polls.int-spec.ts` để cả hai ở dưới trần 800 dòng, và vì nhóm này
 * đọc DB theo **phân bố** chứ không theo tổng — một bộ trợ giúp khác hẳn.
 *
 * GATE CỨNG `hasDb && LANE_DB`.
 */

import { randomUUID } from "node:crypto";
import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../../src/auth/password.service";
import { directPool, hasDb } from "../helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedPermissionCatalog,
  seedRole,
  seedRolePermission,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

const hasLaneDb = hasDb && !!process.env.LANE_DB;
const LOGIN_PW = "Passw0rd!socialbe2b1cnt";
const BASE_PAIRS = ["view:feed", "create:feed-post", "create:feed-poll"] as const;

describe.skipIf(!hasLaneDb)("S16-SOCIAL-BE-2B-1 · bộ đếm từng lựa chọn (DB cô lập)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let author = { token: "", userId: "" };
  let voter = { token: "", userId: "" };
  let voter2 = { token: "", userId: "" };

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, u: string) => http().get(u).set(auth(t));
  const post = (t: string, u: string) => http().post(u).set(auth(t));
  const put = (t: string, u: string) => http().put(u).set(auth(t));

  async function makeUser(label: string, hash: string): Promise<{ token: string; userId: string }> {
    const email = `${label}@${A.slug}.test`;
    const userId = await seedUser(direct, A.companyId, email, hash);
    await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id, org_unit_id, status, work_type, employee_code)
       VALUES ($1, $2, NULL, 'active', 'offline', $3)`,
      [A.companyId, userId, `EMP-${randomUUID().slice(0, 6)}`],
    );
    const roleId = await seedRole(direct, A.companyId, `p-${label}-${randomUUID().slice(0, 6)}`);
    for (const key of BASE_PAIRS) {
      const [action, resource] = key.split(":") as [string, string];
      const permId = await seedPermissionCatalog(direct, action, resource, false);
      await seedRolePermission(direct, roleId, permId, "ALLOW", "Company");
    }
    await seedUserRole(direct, userId, roleId, A.companyId);
    const res = await http()
      .post("/auth/login")
      .send({ companySlug: A.slug, email, password: LOGIN_PW });
    expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
    return { token: res.body.data.accessToken as string, userId };
  }

  async function createPoll(
    opts: { options: string[]; multipleChoice?: boolean; isAnonymous?: boolean } = {
      options: ["A", "B"],
    },
  ): Promise<{ postId: string; optionIds: string[] }> {
    const res = await post(author.token, "/social/posts").send({
      type: "poll",
      audience: "company",
      poll: {
        question: `Câu hỏi ${randomUUID().slice(0, 6)}`,
        options: opts.options,
        multipleChoice: opts.multipleChoice ?? false,
        isAnonymous: opts.isAnonymous ?? false,
      },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const postId = res.body.data.id as string;
    const o = await direct.query(
      `SELECT o.id FROM feed_poll_options o JOIN feed_polls p ON p.id = o.poll_id
        WHERE p.company_id = $1 AND p.post_id = $2 ORDER BY o.position`,
      [A.companyId, postId],
    );
    return { postId, optionIds: o.rows.map((r: { id: string }) => r.id) };
  }

  /**
   * 🔴 Bất biến ở mức TỪNG LỰA CHỌN, đo bằng SQL ĐỘC LẬP với API vừa ghi.
   *
   * Trả `[[vote_count, COUNT(*) phiếu thật], …]` theo `position`. Hai vế của MỖI cặp phải bằng
   * nhau — đây là thứ `Σ` không nói được.
   */
  async function perOption(postId: string): Promise<[number, number][]> {
    const r = await direct.query(
      `SELECT o.vote_count,
              (SELECT COUNT(*) FROM feed_poll_votes v
                WHERE v.company_id = o.company_id AND v.option_id = o.id)::int AS n
         FROM feed_poll_options o
         JOIN feed_polls p ON p.id = o.poll_id
        WHERE p.company_id = $1 AND p.post_id = $2
        ORDER BY o.position`,
      [A.companyId, postId],
    );
    return (r.rows as { vote_count: number; n: number }[]).map((x) => [Number(x.vote_count), x.n]);
  }

  /** Mỗi cặp phải bằng nhau — và tập phải KHÁC RỖNG (bảng rỗng thoả mọi `every`). */
  function expectAligned(pairs: [number, number][], label: string): void {
    expect(pairs.length, `${label}: không có lựa chọn nào để đo`).toBeGreaterThan(0);
    for (const [i, [counter, actual]] of pairs.entries()) {
      expect(
        counter,
        `${label}: option #${i} — vote_count=${counter} nhưng phiếu thật=${actual}`,
      ).toBe(actual);
    }
  }

  beforeAll(async () => {
    direct = directPool();
    A = await seedCompany(direct, "sb2b1cnt");
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    const hash = await app.get(PasswordService).hash(LOGIN_PW);
    author = await makeUser("cntauthor", hash);
    voter = await makeUser("cntvoter", hash);
    voter2 = await makeUser("cntvoter2", hash);
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await cleanupTenants(direct, [A?.companyId].filter(Boolean) as string[]);
    await direct?.end();
  });

  // ═══════════════════════ P-4 / O-5 · đổi phiếu, đo TỪNG option ═══════════════════════

  it("P-4/O-5 — đổi phiếu A→B: `vote_count(A)` -1 và `vote_count(B)` +1, KHÔNG chỉ Σ", async () => {
    const { postId, optionIds } = await createPoll({ options: ["A", "B", "C"] });
    expectAligned(await perOption(postId), "khởi tạo");
    expect(await perOption(postId)).toEqual([
      [0, 0],
      [0, 0],
      [0, 0],
    ]);

    expect(
      (
        await put(voter.token, `/social/posts/${postId}/poll/vote`).send({
          optionIds: [optionIds[0]],
        })
      ).status,
    ).toBe(200);
    // Neo dương: phiếu rơi ĐÚNG vào A, không phải "một chỗ nào đó" cho Σ bằng 1.
    expect(await perOption(postId), "phiếu đầu phải nằm ở A").toEqual([
      [1, 1],
      [0, 0],
      [0, 0],
    ]);

    expect(
      (
        await put(voter.token, `/social/posts/${postId}/poll/vote`).send({
          optionIds: [optionIds[1]],
        })
      ).status,
    ).toBe(200);
    // 🔴 Đây là ca mà `Σ` mù: trừ nhầm sang C cho Σ = 1 và COUNT(*) = 1, C-2 vẫn XANH.
    expect(await perOption(postId), "A phải về 0 và B lên 1 — không option nào khác đổi").toEqual([
      [0, 0],
      [1, 1],
      [0, 0],
    ]);
    expectAligned(await perOption(postId), "sau khi đổi phiếu");
  });

  it("O-5 — hai người, đa lựa chọn: phân bố theo option đúng từng ô", async () => {
    const { postId, optionIds } = await createPoll({
      options: ["A", "B", "C"],
      multipleChoice: true,
    });

    expect(
      (
        await put(voter.token, `/social/posts/${postId}/poll/vote`).send({
          optionIds: [optionIds[0], optionIds[2]],
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await put(voter2.token, `/social/posts/${postId}/poll/vote`).send({
          optionIds: [optionIds[2]],
        })
      ).status,
    ).toBe(200);

    expect(await perOption(postId), "A=1, B=0, C=2").toEqual([
      [1, 1],
      [0, 0],
      [2, 2],
    ]);
    expectAligned(await perOption(postId), "hai người, đa lựa chọn");

    // `043` phải nói ĐÚNG cùng câu chuyện với DB — một bộ đếm đúng mà API đọc sai cũng vô nghĩa.
    const results = await get(voter.token, `/social/posts/${postId}/poll/results`);
    expect(results.status).toBe(200);
    const opts = results.body.data.options as { voteCount: number }[];
    expect(opts.map((o) => o.voteCount)).toEqual([1, 0, 2]);
    expect(results.body.data.totalVoters, "hai NGƯỜI, dù có ba phiếu").toBe(2);
  });

  // ═══════════════════════ P-5b / P-5c · hai nhánh ĐUA còn lại ═══════════════════════

  it("P-5b — ĐUA cùng người, KHÁC option, poll MỘT-lựa-chọn: đúng 1 phiếu, không ai ăn 500", async () => {
    const { postId, optionIds } = await createPoll({ options: ["A", "B"] });

    const settled = await Promise.allSettled([
      put(voter.token, `/social/posts/${postId}/poll/vote`).send({ optionIds: [optionIds[0]] }),
      put(voter.token, `/social/posts/${postId}/poll/vote`).send({ optionIds: [optionIds[1]] }),
    ]);
    const statuses = settled.map((r) => (r.status === "fulfilled" ? r.value.status : 599));

    // ⚠️ **Ca này KHÔNG đo nhánh dịch `feed_poll_votes_single_uq`** — lời khai cũ đã bị FULL gate
    // lượt 2 bác bỏ (BA nguồn hội tụ). Hai nhánh 23505 **không tới được qua HTTP**: `lockPollRowTx`
    // (`FOR UPDATE`) tuần tự hoá hai lượt, rồi `deleteVotesOfUserTx` chạy TRƯỚC `insertVotesTx` nên
    // lượt sau xoá phiếu lượt trước rồi mới ghi ⇒ không bao giờ va. Đó chính là điểm hội tụ H-1, ghi
    // nguyên văn ở `src/social/social-poll-conflict-translate.spec.ts` — nơi hai nhánh ấy có lưới
    // THẬT. Giữ lời khai cũ thì lượt gate sau đọc ca này thành coverage của nhánh `catch` và lỗ đó
    // nằm mở mãi mãi.
    // Cái ca này thực sự ĐO: **bất biến TRẠNG THÁI CUỐI dưới tải song song** — đúng một phiếu, bù
    // trừ không lệch, và không lượt nào ăn 500 (dù vì bất kỳ lý do gì).
    expect(
      statuses.every((s) => s < 500),
      `statuses=${JSON.stringify(statuses)}`,
    ).toBe(true);

    const pairs = await perOption(postId);
    expectAligned(pairs, "P-5b");
    expect(
      pairs.reduce((s, [c]) => s + c, 0),
      "poll một-lựa-chọn: đúng MỘT phiếu sau đua",
    ).toBe(1);
  });

  it("P-5c — ĐUA trên poll ĐA lựa chọn (`single_uq` không áp): 2 phiếu, phân bố đúng", async () => {
    const { postId, optionIds } = await createPoll({
      options: ["A", "B"],
      multipleChoice: true,
    });

    // ⚠️ Cùng đính chính như `P-5b`: hai lượt này KHÔNG đâm `feed_poll_votes_pk` — chúng bị
    // `lockPollRowTx` tuần tự hoá, và lượt sau xoá-rồi-ghi. Cái ca này đo là: đường ĐA-lựa-chọn
    // giữ được CẢ HAI phiếu của cùng một người (tức `single_uq`, partial index chỉ áp khi
    // `single_choice`, đúng là KHÔNG áp ở đây) và phân bố từng option không lệch dưới tải song song.
    const settled = await Promise.allSettled([
      put(voter.token, `/social/posts/${postId}/poll/vote`).send({ optionIds }),
      put(voter.token, `/social/posts/${postId}/poll/vote`).send({ optionIds }),
    ]);
    const statuses = settled.map((r) => (r.status === "fulfilled" ? r.value.status : 599));
    expect(
      statuses.every((s) => s < 500),
      `statuses=${JSON.stringify(statuses)}`,
    ).toBe(true);

    expect(await perOption(postId), "mỗi option đúng 1 phiếu của cùng một người").toEqual([
      [1, 1],
      [1, 1],
    ]);
  });

  // ═══════════════════════ P-9 · poll KHÔNG ẩn danh ═══════════════════════

  it("P-9 — poll KHÔNG ẩn danh vẫn KHÔNG chở `user_id`; `myVote` đúng của CHÍNH người gọi", async () => {
    const { postId, optionIds } = await createPoll({
      options: ["A", "B"],
      isAnonymous: false,
    });
    expect(
      (
        await put(voter.token, `/social/posts/${postId}/poll/vote`).send({
          optionIds: [optionIds[1]],
        })
      ).status,
    ).toBe(200);

    const mine = await get(voter.token, `/social/posts/${postId}/poll/results`);
    expect(mine.status).toBe(200);
    // Neo dương: có dữ liệu thật để mà lộ, và `myVote` của chính mình phải đúng ô B.
    expect(mine.body.data.totalVoters).toBe(1);
    expect(mine.body.data.myVote, "`myVote` phải là phiếu của CHÍNH người gọi").toEqual([
      optionIds[1],
    ]);
    expect(mine.body.data.isAnonymous, "ca này đo nhánh KHÔNG ẩn danh").toBe(false);

    // 🔴 D14: «không ẩn danh» nghĩa là FE được phép hiện RẰNG có người bỏ phiếu, KHÔNG phải API
    // được phép trả AI. Người khác gọi cũng không thấy id cử tri, và `myVote` của họ RỖNG.
    const theirs = await get(voter2.token, `/social/posts/${postId}/poll/results`);
    expect(theirs.status).toBe(200);
    expect(
      theirs.body.data.myVote,
      "phiếu của người khác không được rơi vào `myVote` của mình",
    ).toEqual([]);
    expect(JSON.stringify(theirs.body)).not.toContain(voter.userId);
    expect(JSON.stringify(mine.body)).not.toContain(voter.userId);
  });
});
