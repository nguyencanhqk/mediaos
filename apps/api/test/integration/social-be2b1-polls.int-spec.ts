/**
 * S16-SOCIAL-BE-2B-1 — BÌNH CHỌN ở tầng HTTP (`002/poll` · `040..044` · system-job).
 *
 * ┌─ VÌ SAO Ở TẦNG HTTP, VÀ VÌ SAO ĐẾM BẰNG SQL TRỰC TIẾP ────────────────────────────────────────┐
 * │ Bất biến đắt nhất của cụm này không phải "hàm có từ chối không" mà là **`Σ vote_count ==       │
 * │ COUNT(*) phiếu`** sau MỌI thao tác. Nó chỉ đo được khi đi qua đúng đường HTTP thật (cổng +     │
 * │ transaction + bộ đếm) rồi đọc lại bằng SQL ĐỘC LẬP — không qua chính API vừa ghi, vì một API   │
 * │ tính sai cả hai vế sẽ tự xác nhận mình đúng.                                                   │
 * │                                                                                                │
 * │ `vote_count` lệch DƯƠNG không ném gì cả: không lỗi, không log, chỉ là kết quả bình chọn sai.   │
 * │ Lệch ÂM mới chạm CHECK ⇒ 500. Nghĩa là **nhánh dễ phát hiện lại là nhánh ít xảy ra hơn** —     │
 * │ nên lưới phải là bất biến ĐẾM ĐƯỢC, không phải "route trả 200".                                │
 * └────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Luật §5 của plan: **mỗi DENY có ALLOW đối chứng**, neo dương đặt TRƯỚC mọi assert phủ định.
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
import { SocialPollCloseExpiredJobHandler } from "../../src/social/social-poll-close.job-handler";
import { SOCIAL_ERR } from "../../src/social/social.errors";
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
const LOGIN_PW = "Passw0rd!socialbe2b1polls";
const BASE_PAIRS = ["view:feed", "create:feed-post", "create:feed-poll"] as const;

describe.skipIf(!hasLaneDb)("S16-SOCIAL-BE-2B-1 · bình chọn (DB cô lập)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;

  let author = { token: "", userId: "" };
  let voter = { token: "", userId: "" };
  let other = { token: "", userId: "" };
  /** Giữ `manage:feed-post` — nhánh thoát của `044`. */
  let manager = { token: "", userId: "" };

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, u: string) => http().get(u).set(auth(t));
  const post = (t: string, u: string) => http().post(u).set(auth(t));
  const put = (t: string, u: string) => http().put(u).set(auth(t));
  const del = (t: string, u: string) => http().delete(u).set(auth(t));

  async function makeUser(
    label: string,
    hash: string,
    pairs: readonly string[] = BASE_PAIRS,
  ): Promise<{ token: string; userId: string }> {
    const email = `${label}@${A.slug}.test`;
    const userId = await seedUser(direct, A.companyId, email, hash);
    await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id, org_unit_id, status, work_type, employee_code)
       VALUES ($1, $2, NULL, 'active', 'offline', $3)`,
      [A.companyId, userId, `EMP-${randomUUID().slice(0, 6)}`],
    );
    const roleId = await seedRole(direct, A.companyId, `p-${label}-${randomUUID().slice(0, 6)}`);
    for (const key of pairs) {
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

  /** Tạo bài bình chọn qua ĐÚNG route `002`. Trả `{postId, optionIds}`. */
  async function createPoll(
    token: string,
    opts: {
      options: string[];
      multipleChoice?: boolean;
      isAnonymous?: boolean;
      closesAt?: string;
    },
  ): Promise<{ postId: string; optionIds: string[]; status: number; body: unknown }> {
    const res = await post(token, "/social/posts").send({
      type: "poll",
      audience: "company",
      poll: {
        question: `Câu hỏi ${randomUUID().slice(0, 6)}`,
        options: opts.options,
        multipleChoice: opts.multipleChoice ?? false,
        isAnonymous: opts.isAnonymous ?? false,
        ...(opts.closesAt ? { closesAt: opts.closesAt } : {}),
      },
    });
    if (res.status !== 201)
      return { postId: "", optionIds: [], status: res.status, body: res.body };

    const postId = res.body.data.id as string;
    const o = await direct.query(
      `SELECT o.id FROM feed_poll_options o
         JOIN feed_polls p ON p.id = o.poll_id
        WHERE p.company_id = $1 AND p.post_id = $2 ORDER BY o.position`,
      [A.companyId, postId],
    );
    return {
      postId,
      optionIds: o.rows.map((r: { id: string }) => r.id),
      status: res.status,
      body: res.body,
    };
  }

  /**
   * 🔴 Bất biến trung tâm, đo bằng SQL ĐỘC LẬP với API vừa ghi.
   *
   * Trả `[Σ vote_count, COUNT(*) phiếu]`. Hai con số này phải BẰNG NHAU sau mọi thao tác — và ca
   * gọi nó còn phải assert GIÁ TRỊ TUYỆT ĐỐI, vì `0 === 0` cũng thoả (deny vacuous).
   */
  async function counters(postId: string): Promise<[number, number]> {
    const r = await direct.query(
      `SELECT COALESCE((SELECT SUM(o.vote_count) FROM feed_poll_options o
                          JOIN feed_polls p ON p.id = o.poll_id
                         WHERE p.company_id = $1 AND p.post_id = $2), 0) AS sum_counts,
              COALESCE((SELECT COUNT(*) FROM feed_poll_votes v
                          JOIN feed_polls p ON p.id = v.poll_id
                         WHERE p.company_id = $1 AND p.post_id = $2), 0) AS n_votes`,
      [A.companyId, postId],
    );
    return [Number(r.rows[0].sum_counts), Number(r.rows[0].n_votes)];
  }


  /**
   * Đẩy một bình chọn vào trạng thái **quá hạn mà hàng vẫn `open`** — trạng thái có thật giữa hai
   * nhịp job.
   *
   * 🔴 Phải lùi CẢ `created_at`, không chỉ `closes_at`. `chk_feed_polls_closes_future`
   * (`closes_at IS NULL OR closes_at > created_at`) là CHECK cấp hàng nên nó phủ **cả UPDATE**, chứ
   * không chỉ INSERT: một câu chỉ kéo `closes_at` về quá khứ sẽ vỡ CHECK và fixture chết bằng một
   * lỗi trông y hệt lỗi sản phẩm. Đây cũng là lý do trạng thái này KHÔNG dựng được bằng cách sửa
   * mỗi hạn — trong đời thật nó sinh ra do thời gian trôi.
   */
  async function expirePoll(postId: string): Promise<void> {
    await direct.query(
      `UPDATE feed_polls
          SET created_at = now() - interval '2 hours',
              closes_at  = now() - interval '1 minute'
        WHERE company_id = $1 AND post_id = $2`,
      [A.companyId, postId],
    );
  }

  async function auditCloseRows(postId: string): Promise<number> {
    const r = await direct.query(
      `SELECT COUNT(*)::int AS n FROM audit_logs
        WHERE company_id = $1 AND object_type = 'feed_post' AND object_id = $2
          AND action = 'social.poll.close'`,
      [A.companyId, postId],
    );
    return r.rows[0].n as number;
  }

  async function pollRow(postId: string): Promise<{ status: string; closed_at: string | null }> {
    const r = await direct.query(
      `SELECT status, closed_at FROM feed_polls WHERE company_id = $1 AND post_id = $2`,
      [A.companyId, postId],
    );
    return r.rows[0];
  }

  beforeAll(async () => {
    direct = directPool();
    A = await seedCompany(direct, "sb2b1poll");

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    const hash = await app.get(PasswordService).hash(LOGIN_PW);
    author = await makeUser("author", hash);
    voter = await makeUser("voter", hash);
    other = await makeUser("other", hash);
    manager = await makeUser("manager", hash, [...BASE_PAIRS, "manage:feed-post"]);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await cleanupTenants(direct, [A?.companyId].filter(Boolean) as string[]);
    await direct?.end();
  });

  // ─────────────────────────── C-2 · bất biến bộ đếm ───────────────────────────

  it("C-2 — Σ vote_count == COUNT(*) phiếu sau MỖI bước, với giá trị TUYỆT ĐỐI", async () => {
    const { postId, optionIds } = await createPoll(author.token, {
      options: ["A", "B", "C"],
      multipleChoice: true,
    });
    expect(postId, "neo dương: tạo được bài bình chọn").not.toBe("");
    expect(await counters(postId)).toEqual([0, 0]);

    // 1 phiếu
    expect(
      (
        await put(voter.token, `/social/posts/${postId}/poll/vote`).send({
          optionIds: [optionIds[0]],
        })
      ).status,
    ).toBe(200);
    expect(await counters(postId)).toEqual([1, 1]);

    // ĐỔI phiếu A → B. Đây là chỗ vế `-1` bị quên sẽ lệch NGAY, không cần đua.
    expect(
      (
        await put(voter.token, `/social/posts/${postId}/poll/vote`).send({
          optionIds: [optionIds[1]],
        })
      ).status,
    ).toBe(200);
    expect(await counters(postId), "đổi phiếu: -1 option cũ, +1 option mới").toEqual([1, 1]);

    // Đa lựa chọn: 2 phiếu cùng lúc.
    expect(
      (
        await put(voter.token, `/social/posts/${postId}/poll/vote`).send({
          optionIds: [optionIds[1], optionIds[2]],
        })
      ).status,
    ).toBe(200);
    expect(await counters(postId)).toEqual([2, 2]);

    // Người thứ hai.
    expect(
      (
        await put(other.token, `/social/posts/${postId}/poll/vote`).send({
          optionIds: [optionIds[0]],
        })
      ).status,
    ).toBe(200);
    expect(await counters(postId)).toEqual([3, 3]);

    // Rút phiếu của `voter` (2 phiếu) — còn lại đúng phiếu của `other`.
    expect((await del(voter.token, `/social/posts/${postId}/poll/vote`)).status).toBe(200);
    expect(await counters(postId)).toEqual([1, 1]);
  });

  // ─────────────────────────── Nợ (e) · option chéo poll ───────────────────────────

  it("P-e — optionId của bình chọn KHÁC ⇒ 404, và bộ đếm bình chọn kia KHÔNG đổi", async () => {
    const mine = await createPoll(author.token, { options: ["A", "B"] });
    const foreign = await createPoll(author.token, { options: ["X", "Y"] });

    // Neo dương TRƯỚC: đường hợp lệ phải chạy được, nếu không ca phủ định vô nghĩa.
    expect(
      (
        await put(voter.token, `/social/posts/${foreign.postId}/poll/vote`).send({
          optionIds: [foreign.optionIds[0]],
        })
      ).status,
    ).toBe(200);
    const before = await counters(foreign.postId);
    expect(before).toEqual([1, 1]);

    const crossed = await put(voter.token, `/social/posts/${mine.postId}/poll/vote`).send({
      optionIds: [foreign.optionIds[1]],
    });
    expect(crossed.status, "hai FK RỜI không ràng option thuộc poll — service phải chặn").toBe(404);
    expect(JSON.stringify(crossed.body)).toContain(SOCIAL_ERR.POLL_OPTION_NOT_FOUND);

    expect(await counters(foreign.postId), "bình chọn KHÁC không được đụng tới").toEqual(before);
    expect(await counters(mine.postId)).toEqual([0, 0]);
  });

  // ─────────────────────────── Cổng «còn nhận phiếu» ───────────────────────────

  it("P-1 — bình chọn đã ĐÓNG ⇒ 409 SOCIAL-ERR-016", async () => {
    const { postId, optionIds } = await createPoll(author.token, { options: ["A", "B"] });
    expect((await post(author.token, `/social/posts/${postId}/poll/close`)).status).toBe(201);

    const late = await put(voter.token, `/social/posts/${postId}/poll/vote`).send({
      optionIds: [optionIds[0]],
    });
    expect(late.status).toBe(409);
    expect(JSON.stringify(late.body)).toContain(SOCIAL_ERR.POLL_CLOSED);
    expect(await counters(postId)).toEqual([0, 0]);
  });

  it("P-2 — QUÁ HẠN mà hàng vẫn `open` (job chưa chạy tới) ⇒ 409 — nhánh RIÊNG với P-1", async () => {
    const { postId, optionIds } = await createPoll(author.token, {
      options: ["A", "B"],
      closesAt: new Date(Date.now() + 60_000).toISOString(),
    });
    // Neo dương: khi chưa quá hạn thì bỏ phiếu được.
    expect(
      (
        await put(voter.token, `/social/posts/${postId}/poll/vote`).send({
          optionIds: [optionIds[0]],
        })
      ).status,
    ).toBe(200);

    // Đẩy hạn về quá khứ NHƯNG giữ `status='open'` — đúng trạng thái giữa hai nhịp job.
    await expirePoll(postId);
    expect((await pollRow(postId)).status, "vẫn `open` — đây là điểm của ca này").toBe("open");

    const late = await put(other.token, `/social/posts/${postId}/poll/vote`).send({
      optionIds: [optionIds[0]],
    });
    expect(late.status).toBe(409);
    expect(JSON.stringify(late.body)).toContain(SOCIAL_ERR.POLL_CLOSED);
  });

  // ─────────────────────────── Phiếu đôi ───────────────────────────

  it("P-3 — bình chọn MỘT lựa chọn, gửi 2 optionId ⇒ 409 ERR-017 và KHÔNG ghi phiếu nào", async () => {
    const single = await createPoll(author.token, { options: ["A", "B"] });
    const multi = await createPoll(author.token, { options: ["A", "B"], multipleChoice: true });

    // Neo dương: bình chọn ĐA lựa chọn nhận được 2 phiếu.
    expect(
      (
        await put(voter.token, `/social/posts/${multi.postId}/poll/vote`).send({
          optionIds: multi.optionIds,
        })
      ).status,
    ).toBe(200);
    expect(await counters(multi.postId)).toEqual([2, 2]);

    const dup = await put(voter.token, `/social/posts/${single.postId}/poll/vote`).send({
      optionIds: single.optionIds,
    });
    expect(dup.status).toBe(409);
    expect(JSON.stringify(dup.body)).toContain(SOCIAL_ERR.POLL_VOTE_DUPLICATE);
    expect(await counters(single.postId)).toEqual([0, 0]);
  });

  it("P-5a — ĐUA hai lượt CÙNG option: đúng 1 phiếu, Σ khớp, và KHÔNG lượt nào trả 500", async () => {
    const { postId, optionIds } = await createPoll(author.token, { options: ["A", "B"] });

    const results = await Promise.allSettled([
      put(voter.token, `/social/posts/${postId}/poll/vote`).send({ optionIds: [optionIds[0]] }),
      put(voter.token, `/social/posts/${postId}/poll/vote`).send({ optionIds: [optionIds[0]] }),
    ]);
    const statuses = results.map((r) => (r.status === "fulfilled" ? r.value.status : 599));

    // 🔴 Vế này là điểm của ca. Hai lượt CÙNG option đâm `feed_poll_votes_pk`, KHÔNG đâm
    // `…_single_uq`. Nếu đường dịch chỉ bắt `single_uq` thì lượt thua trả **500 chưa dịch** — mà
    // hai assert trạng thái bên dưới VẪN XANH (trạng thái cuối vẫn đúng). Không có dòng này thì ca
    // đua "pass với mọi hành vi", đúng thứ plan §5 cấm.
    expect(
      statuses.every((s) => s < 500),
      `statuses=${JSON.stringify(statuses)}`,
    ).toBe(true);

    const [sum, n] = await counters(postId);
    expect(n, "đúng MỘT phiếu sau đua").toBe(1);
    expect(sum).toBe(1);
  });

  // ─────────────────────────── Ẩn danh ───────────────────────────

  it("P-8 — kết quả bình chọn ẩn danh KHÔNG lộ user_id, kể cả với manage:feed-post", async () => {
    const { postId, optionIds } = await createPoll(author.token, {
      options: ["A", "B"],
      isAnonymous: true,
    });
    expect(
      (
        await put(voter.token, `/social/posts/${postId}/poll/vote`).send({
          optionIds: [optionIds[0]],
        })
      ).status,
    ).toBe(200);

    for (const who of [manager, author, voter]) {
      const res = await get(who.token, `/social/posts/${postId}/poll/results`);
      expect(res.status).toBe(200);
      // Neo dương TRƯỚC: có dữ liệu thật để mà lộ.
      expect(res.body.data.totalVoters, "neo dương: có người đã bỏ phiếu").toBe(1);
      expect(
        JSON.stringify(res.body),
        `route 043 lộ user_id của cử tri cho ${JSON.stringify(who.userId)}`,
      ).not.toContain(voter.userId);
    }
  });

  it("P-8b — 040 và 041/042 cũng không chở user_id của cử tri", async () => {
    const { postId, optionIds } = await createPoll(author.token, { options: ["A", "B"] });
    const voted = await put(voter.token, `/social/posts/${postId}/poll/vote`).send({
      optionIds: [optionIds[0]],
    });
    expect(voted.status).toBe(200);
    expect(JSON.stringify(voted.body)).not.toContain(voter.userId);

    const list = await get(manager.token, "/social/polls");
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body.data) && list.body.data.length, "neo dương").toBeGreaterThan(0);
    expect(JSON.stringify(list.body)).not.toContain(voter.userId);

    const withdrawn = await del(voter.token, `/social/posts/${postId}/poll/vote`);
    expect(withdrawn.status).toBe(200);
    expect(JSON.stringify(withdrawn.body)).not.toContain(voter.userId);
  });

  // ─────────────────────────── 044 · đóng tay ───────────────────────────

  it("P-10 — người KHÔNG phải chủ bài và không có manage ⇒ 403, bình chọn vẫn `open`", async () => {
    const { postId } = await createPoll(author.token, { options: ["A", "B"] });

    const denied = await post(other.token, `/social/posts/${postId}/poll/close`);
    expect(denied.status).toBe(403);
    expect((await pollRow(postId)).status).toBe("open");

    // ALLOW đối chứng: `manage:feed-post` đóng được, và audit ghi ĐÚNG MỘT dòng.
    expect((await post(manager.token, `/social/posts/${postId}/poll/close`)).status).toBe(201);
    expect((await pollRow(postId)).status).toBe("closed");
    expect(await auditCloseRows(postId)).toBe(1);
  });

  it("P-11 — đóng một bình chọn ĐÃ đóng ⇒ 409, closed_at KHÔNG đổi, audit KHÔNG thêm dòng", async () => {
    const { postId } = await createPoll(author.token, { options: ["A", "B"] });
    expect((await post(author.token, `/social/posts/${postId}/poll/close`)).status).toBe(201);
    const first = await pollRow(postId);
    expect(await auditCloseRows(postId)).toBe(1);

    const again = await post(author.token, `/social/posts/${postId}/poll/close`);
    expect(again.status).toBe(409);
    expect(JSON.stringify(again.body)).toContain(SOCIAL_ERR.POLL_CLOSED);

    expect((await pollRow(postId)).closed_at, "không ghi đè mốc đóng cũ").toEqual(first.closed_at);
    // 🔴 `audit_logs` là append-only: một dòng thừa ở đây KHÔNG gỡ lại được. Đây là lý do audit
    // phải nằm SAU vế `RETURNING` rỗng, trong cùng tx.
    expect(await auditCloseRows(postId), "audit KHÔNG được ghi cho lượt đóng thất bại").toBe(1);
  });

  // ─────────────────────────── Hành vi biên ───────────────────────────

  it("P-7 — số lựa chọn ngoài 2..10 ⇒ 422 ĐÚNG MÃ ERR-018; vắng hẳn `options` ⇒ 400", async () => {
    const one = await createPoll(author.token, { options: ["A"] });
    expect(one.status).toBe(422);
    expect(JSON.stringify(one.body)).toContain(SOCIAL_ERR.POLL_OPTIONS_RANGE);

    const eleven = await createPoll(author.token, {
      options: Array.from({ length: 11 }, (_, i) => `O${i}`),
    });
    expect(eleven.status).toBe(422);
    expect(JSON.stringify(eleven.body)).toContain(SOCIAL_ERR.POLL_OPTIONS_RANGE);

    // Vắng HẲN `options` là hình dạng sai ⇒ 400 của Zod là ĐÚNG, không phải 422.
    const missing = await post(author.token, "/social/posts").send({
      type: "poll",
      audience: "company",
      poll: { question: "Thiếu options" },
    });
    expect(missing.status).toBe(400);

    // ALLOW đối chứng ở cả hai biên.
    expect((await createPoll(author.token, { options: ["A", "B"] })).status).toBe(201);
    expect(
      (await createPoll(author.token, { options: Array.from({ length: 10 }, (_, i) => `O${i}`) }))
        .status,
    ).toBe(201);
  });

  it("closesAt trong QUÁ KHỨ ⇒ 422 có nghĩa, KHÔNG để vỡ CHECK thành 500", async () => {
    const past = await createPoll(author.token, {
      options: ["A", "B"],
      closesAt: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(past.status, "chk_feed_polls_closes_future sẽ trả 500 nếu service không chặn").toBe(422);
    expect(JSON.stringify(past.body)).toContain(SOCIAL_ERR.POLL_CLOSES_AT_PAST);
  });

  it("P-13/P-14 — bài KHÔNG mang bình chọn ⇒ 404; rút phiếu khi chưa bỏ ⇒ 200 no-op", async () => {
    const share = await post(author.token, "/social/posts").send({
      type: "share",
      audience: "company",
      body: "Bài thường, không có bình chọn",
    });
    expect(share.status).toBe(201);
    const plainPostId = share.body.data.id as string;

    for (const res of [
      await get(voter.token, `/social/posts/${plainPostId}/poll/results`),
      await post(author.token, `/social/posts/${plainPostId}/poll/close`),
    ]) {
      expect(res.status, "không 500, không 422 — cùng chuỗi 404 với «không thấy bài»").toBe(404);
      expect(JSON.stringify(res.body)).toContain(SOCIAL_ERR.POST_NOT_FOUND);
    }

    const { postId } = await createPoll(author.token, { options: ["A", "B"] });
    const noop = await del(other.token, `/social/posts/${postId}/poll/vote`);
    expect(noop.status, "DELETE là idempotent theo bản chất").toBe(200);
    expect(await counters(postId)).toEqual([0, 0]);
  });

  // ─────────────────────────── Job đóng theo hạn ───────────────────────────

  it("J-1/J-2 — job đóng ĐÚNG poll quá hạn, chạy lại không đổi gì và KHÔNG phát NOTI lần hai", async () => {
    const expired = await createPoll(author.token, {
      options: ["A", "B"],
      closesAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const future = await createPoll(author.token, {
      options: ["A", "B"],
      closesAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    const noDeadline = await createPoll(author.token, { options: ["A", "B"] });

    await expirePoll(expired.postId);

    const job = app.get(SocialPollCloseExpiredJobHandler);

    // ⚠️ KHÔNG assert `total === 1`. Mọi ca trong file dùng CHUNG một tenant, và ca `P-2` cố ý để
    // lại một bình chọn quá-hạn-mà-vẫn-`open` — nên một con số tuyệt đối ở đây phụ thuộc THỨ TỰ
    // CHẠY, và sẽ đỏ/xanh tuỳ lúc. Bất biến đúng là: job đóng ĐÚNG tập hàng thoả vị từ, không hơn
    // không kém. Đếm trước, so sau.
    const expectedTotal = await expiredOpenCount();
    expect(expectedTotal, "neo dương: có ít nhất một bình chọn quá hạn để đóng").toBeGreaterThan(0);

    const first = await job.run({ companyId: A.companyId });
    expect(first.total, "job đóng ĐÚNG tập hàng thoả vị từ").toBe(expectedTotal);
    expect((await pollRow(expired.postId)).status).toBe("closed");
    expect((await pollRow(future.postId)).status, "chưa tới hạn — không đụng").toBe("open");
    expect((await pollRow(noDeadline.postId)).status, "không có hạn — không đụng").toBe("open");

    const closedAt = (await pollRow(expired.postId)).closed_at;
    const outboxAfterFirst = await outboxCount(expired.postId);
    expect(outboxAfterFirst, "neo dương: NOTI-035 ĐÃ được phát").toBe(1);

    const second = await job.run({ companyId: A.companyId });
    expect(second.total, "idempotent: nhịp sau không còn gì để đóng").toBe(0);
    expect((await pollRow(expired.postId)).closed_at).toEqual(closedAt);
    expect(await outboxCount(expired.postId), "KHÔNG phát NOTI lần hai").toBe(1);
  });


  /** Số bình chọn đang ở trạng thái «quá hạn mà vẫn `open`» — tập mà job PHẢI gặt đúng bằng. */
  async function expiredOpenCount(): Promise<number> {
    const r = await direct.query(
      `SELECT COUNT(*)::int AS n FROM feed_polls
        WHERE company_id = $1 AND status = 'open'
          AND closes_at IS NOT NULL AND closes_at <= now()`,
      [A.companyId],
    );
    return r.rows[0].n as number;
  }

  async function outboxCount(postId: string): Promise<number> {
    const r = await direct.query(
      `SELECT COUNT(*)::int AS n FROM outbox_events
        WHERE company_id = $1 AND event_type = 'social.poll_closed'
          AND payload->>'post_id' = $2`,
      [A.companyId, postId],
    );
    return r.rows[0].n as number;
  }
});
