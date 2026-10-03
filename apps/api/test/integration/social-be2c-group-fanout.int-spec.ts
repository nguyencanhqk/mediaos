/**
 * S16-SOCIAL-BE-2C · file 2/2 — tầng (e) SỰ KIỆN: `feed:post.created` của bài `audience='group'` tới ĐÚNG
 * thành viên `active` của nhóm (room `co:{c}:feedgroup:{g}`) + payload ⊆ DTO REST (plan §5 — §10 ghi đè;
 * commit B). Tầng membership đo riêng ở `social-be2c-group-rooms.int-spec.ts` (commit A).
 *
 * Luật đo (docblock `test/helpers/social-group-rooms-fixture.ts`):
 *   • Mọi ca CHỜ membership tương ứng (poll) TRƯỚC khi đăng bài.
 *   • «Nhận 0» luôn đi SAU một NEO DƯƠNG trên CHÍNH socket đó, phát SAU sự kiện nhóm: socket nhận neo ⇒
 *     mọi emit trước đó tới room chứa nó đã tới (thứ tự theo socket — M21-g; broadcast cục bộ đồng bộ
 *     kể cả dưới Valkey — M23; emit chạy TRƯỚC response 201 — M31).
 *   • Nhận diện bài nhóm theo `id`, KHÔNG theo nhãn `audience` (mutant M18 dán nhãn sai).
 *
 * ⚠️ Actor vai THƯỜNG (không super-admin). Boot `applyMainPipeline` + `setupWebSocketAdapter` +
 * `listen(0)`. GATE CỨNG `hasDb && LANE_DB`.
 */

import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import type { Namespace } from "socket.io";
import type { Socket as ClientSocket } from "socket.io-client";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { PasswordService } from "../../src/auth/password.service";
import { loadEnv } from "../../src/config/env.schema";
import { feedGroupRoomName } from "../../src/realtime/rooms";
import { setupWebSocketAdapter } from "../../src/realtime/setup-websocket-adapter";
import { applyMainPipeline } from "../helpers/bootstrap-app";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, type SeededTenant } from "../helpers/seed";
import {
  FEED_MEMBER_PAIRS,
  NO_FEED_PAIRS,
  connectReady,
  gatewayNamespace,
  isMember,
  pollUntil,
  postCount,
  seedActor,
  seedGroup,
  seedOrgUnit,
  waitForPost,
  type FeedRecorder,
} from "../helpers/social-group-rooms-fixture";

const hasLaneDb = hasDb && !!process.env.LANE_DB;
const LOGIN_PW = ["Passw0rd!", "be2c", "fanout"].join("-");

/** Khoá DTO REST mà payload WS CỐ Ý không mang (API-19 §7 · BE-1D D6 · BE-2D D7). */
const WS_OMITTED = [
  "myReaction",
  "savedByMe",
  "isMine",
  "status",
  "mentions",
  "kudos",
  "poll",
  "idea",
] as const;

interface Who {
  userId: string;
  token: string;
}

describe.skipIf(!hasLaneDb)(
  "S16-SOCIAL-BE-2C · room nhóm — FAN-OUT sự kiện (WS thật + DB cô lập)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let nsp: Namespace;
    let port = 0;
    let A: SeededTenant;
    let B: SeededTenant;
    const companyIds: string[] = [];
    const open: ClientSocket[] = [];

    let O: Who; // owner K (kín) + P (mở); thuộc đơn vị OU
    let M: Who;
    let M3: Who;
    let Pd: Who;
    let Pd2: Who;
    let X: Who;
    let NV: Who; // KHÔNG `view:feed`
    let M4: Who;
    let Ab: Who; // công ty B — tác giả neo
    let Bb: Who; // công ty B
    let K = "";
    let P = "";
    let OU = "";
    const sock: Record<string, FeedRecorder> = {};

    const http = () => request(app.getHttpServer());
    const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
    const get = (t: string, u: string) => http().get(u).set(auth(t));
    const post = (t: string, u: string) => http().post(u).set(auth(t));
    const patch = (t: string, u: string) => http().patch(u).set(auth(t));
    const del = (t: string, u: string) => http().delete(u).set(auth(t));

    async function actor(
      tenant: SeededTenant,
      label: string,
      hash: string,
      pairs: readonly string[] = FEED_MEMBER_PAIRS,
      orgUnitId: string | null = null,
    ): Promise<Who> {
      const { userId, email } = await seedActor(direct, tenant, label, hash, pairs, { orgUnitId });
      const res = await http()
        .post("/auth/login")
        .send({ companySlug: tenant.slug, email, password: LOGIN_PW });
      expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
      return { userId, token: res.body.data.accessToken as string };
    }

    const ready = (who: Who, tenant: SeededTenant = A) =>
      connectReady(port, nsp, who.token, tenant.companyId, who.userId, open);
    const inRoom = (room: string, rec: FeedRecorder) => isMember(nsp, room, rec);
    const inK = (rec: FeedRecorder) => inRoom(feedGroupRoomName(A.companyId, K), rec);

    /** Đăng một bài (body DUY NHẤT — `002` là `@Idempotent()`); trả id. */
    async function publish(who: Who, body: Record<string, unknown>): Promise<string> {
      const res = await post(who.token, "/social/posts").send({
        type: "share",
        body: `be2c ${randomUUID()}`,
        ...body,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      return res.body.data.id as string;
    }
    const groupPost = (groupId: string, extra: Record<string, unknown> = {}) =>
      publish(O, { audience: "group", groupId, ...extra });
    const companyPost = (who: Who = O) => publish(who, { audience: "company" });

    /** Một hàng `files` đã Uploaded+Clean thuộc `owner` — gieo tay (khuôn `social-be1-attachments`). */
    async function seedFile(owner: string): Promise<string> {
      const id = randomUUID();
      await direct.query(
        `INSERT INTO files (id, company_id, original_name, stored_name, mime_type, file_size_bytes,
                          storage_provider, storage_path, upload_status, scan_status,
                          owner_user_id, uploaded_by)
       VALUES ($1,$2,$3,$4,'image/png',2048,'MinIO',$5,'Uploaded','Clean',$6,$6)`,
        [
          id,
          A.companyId,
          `f-${id.slice(0, 6)}.png`,
          `stored-${id}`,
          `${A.companyId}/social/${id}`,
          owner,
        ],
      );
      return id;
    }

    beforeAll(async () => {
      process.env.REALTIME_ENABLED = "true";
      direct = directPool();
      A = await seedCompany(direct, "sbe2ce");
      B = await seedCompany(direct, "sbe2ceb");
      companyIds.push(A.companyId, B.companyId);

      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = applyMainPipeline(moduleRef.createNestApplication());
      await setupWebSocketAdapter(app as never, loadEnv());
      await app.listen(0);
      port = (app.getHttpServer().address() as AddressInfo).port;
      nsp = gatewayNamespace(app);

      const hash = await app.get(PasswordService).hash(LOGIN_PW);
      OU = await seedOrgUnit(direct, A.companyId, `Đơn vị ${randomUUID().slice(0, 6)}`);
      O = await actor(A, "o", hash, [...FEED_MEMBER_PAIRS, "create:feed-poll"], OU);
      M = await actor(A, "m", hash);
      M3 = await actor(A, "m3", hash);
      Pd = await actor(A, "pd", hash);
      Pd2 = await actor(A, "pd2", hash);
      X = await actor(A, "x", hash);
      NV = await actor(A, "nv", hash, NO_FEED_PAIRS);
      M4 = await actor(A, "m4", hash);
      Ab = await actor(B, "ab", hash);
      Bb = await actor(B, "bb", hash);

      K = await seedGroup(direct, A.companyId, "private", [
        { userId: O.userId, role: "owner" },
        { userId: M.userId, role: "member" },
        { userId: M3.userId, role: "member" },
        { userId: Pd.userId, role: "member", status: "pending" },
        { userId: NV.userId, role: "member", status: "pending" },
      ]);
      P = await seedGroup(direct, A.companyId, "public", [{ userId: O.userId, role: "owner" }]);

      sock.O = await ready(O);
      sock.M = await ready(M);
      sock.X = await ready(X);
      sock.Pd = await ready(Pd);
      sock.Pd2 = await ready(Pd2);
      sock.NV = await ready(NV);
      sock.Bb = await ready(Bb, B);
    }, 180_000);

    afterAll(async () => {
      while (open.length) open.pop()?.disconnect();
      if (app) await app.close();
      if (direct) {
        await cleanupTenants(direct, companyIds);
        await direct.end();
      }
    });

    it("🔒 E0e/E1e bài nhóm K tới thành viên M; người ngoài X, người `pending` Pd, tenant khác Bb nhận 0 (sau neo)", async () => {
      expect(await inK(sock.M), "tiền đề: M ở room K").toBe(true);

      const kPost = await groupPost(K);
      const ev = await waitForPost(sock.M, kPost);
      expect(ev).toMatchObject({ id: kPost, audience: "group", groupId: K, orgUnitId: null });

      const cA = await companyPost();
      const cB = await companyPost(Ab);
      await waitForPost(sock.X, cA);
      await waitForPost(sock.Pd, cA);
      await waitForPost(sock.Bb, cB);

      expect(postCount(sock.X, kPost), "X không thuộc K").toBe(0);
      expect(postCount(sock.Pd, kPost), "Pd mới pending").toBe(0);
      expect(postCount(sock.Bb, kPost), "tenant khác").toBe(0);
      expect(postCount(sock.Bb, cA), "tenant khác — bài công ty A").toBe(0);
      expect(postCount(sock.M, kPost), "đúng MỘT bản — M ở cả room công ty lẫn room nhóm").toBe(1);
    });

    it("🔒 W2 payload bài nhóm ≡ DTO REST `003` trừ khoá cố ý bóc; đính kèm = REST trừ `url`", async () => {
      const fileId = await seedFile(O.userId);
      const kPost = await groupPost(K, { attachmentIds: [fileId] });
      const ws = await waitForPost(sock.M, kPost);

      const res = await get(M.token, `/social/posts/${kPost}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const rest = res.body.data as Record<string, unknown>;

      const restKeys = Object.keys(rest).filter(
        (k) => !(WS_OMITTED as readonly string[]).includes(k),
      );
      expect(Object.keys(ws).sort()).toEqual(restKeys.sort());
      for (const k of restKeys) {
        if (k === "attachments") continue;
        if (k === "author") {
          // S16-SOCIAL-AVATARPRESIGN-1 (D3-b): WS GIỮ khoá `avatarUrl` nhưng LUÔN `null` (REST: URL ký —
          // capability TTL, không lên room nhóm). Mọi khoá khác của tác giả BẰNG REST.
          expect(ws.author, "tác giả WS = REST, `avatarUrl` ép null").toEqual({
            ...(rest.author as Record<string, unknown>),
            avatarUrl: null,
          });
          continue;
        }
        expect(ws[k], `khoá chung «${k}» phải BẰNG REST`).toEqual(rest[k]);
      }
      const restAtt = rest.attachments as Record<string, unknown>[];
      expect(restAtt, "neo dương: REST có đính kèm").toHaveLength(1);
      expect(ws.attachments).toEqual(restAtt.map(({ url: _url, ...a }) => a));
      expect(JSON.stringify(ws)).not.toContain("X-Amz-");
    });

    it("W2b bài poll trong K ⇒ payload KHÔNG mang `poll` (BE-2D D7 cho biến thể nhóm)", async () => {
      const pollPost = await groupPost(K, {
        type: "poll",
        body: `poll ${randomUUID()}`,
        poll: { question: "Nhóm chọn?", options: ["A", "B"] },
      });
      const ws = await waitForPost(sock.M, pollPost);
      expect(ws.type).toBe("poll");
      expect(ws).not.toHaveProperty("poll");
    });

    it("W4 bài `org_unit` KHÔNG phát vào đâu (D21 giữ nguyên) — M/X nhận neo công ty, 0 bài đơn vị", async () => {
      const orgPost = await publish(O, { audience: "org_unit", orgUnitId: OU });
      const anchor = await companyPost();
      await waitForPost(sock.M, anchor);
      await waitForPost(sock.X, anchor);
      expect(postCount(sock.M, orgPost)).toBe(0);
      expect(postCount(sock.X, orgPost)).toBe(0);
      expect(postCount(sock.O, orgPost), "kể cả tác giả — không có room đơn vị").toBe(0);
    });

    it("🔒 E2e duyệt NV (TRƯỢT view:feed) ⇒ NV ngoài room K và nhận 0 bài nhóm; Pd duyệt giữa phiên ⇒ nhận", async () => {
      const a1 = await patch(O.token, `/social/groups/${K}/members/${NV.userId}`).send({
        decision: "approve",
      });
      expect(a1.status, JSON.stringify(a1.body)).toBe(200);
      // RÀO THỨ TỰ (room-op dương phát SAU trên cùng kênh).
      const a2 = await patch(O.token, `/social/groups/${K}/members/${Pd.userId}`).send({
        decision: "approve",
      });
      expect(a2.status, JSON.stringify(a2.body)).toBe(200);
      await pollUntil(() => inK(sock.Pd), "E2e: Pd vào room K sau duyệt");
      expect(await inK(sock.NV), "NV trượt view:feed KHÔNG được ở room nhóm").toBe(false);

      const kPost2 = await groupPost(K);
      await waitForPost(sock.M, kPost2);
      await waitForPost(sock.Pd, kPost2);
      expect(postCount(sock.NV, kPost2)).toBe(0);
      expect(sock.NV.posts, "NV không ở room bảng tin nào").toEqual([]);
    });

    it("E3e Pd (duyệt giữa phiên, KHÔNG reconnect) nhận ĐÚNG một bản bài nhóm kế tiếp", async () => {
      const kPost = await groupPost(K);
      await waitForPost(sock.Pd, kPost);
      const anchor = await companyPost();
      await waitForPost(sock.Pd, anchor);
      expect(postCount(sock.Pd, kPost)).toBe(1);
    });

    it("E4e `035` nhóm kín ⇒ pending ⇒ 0 bài K; `035` nhóm mở ⇒ nhận bài P", async () => {
      const j1 = await post(Pd2.token, `/social/groups/${K}/join`);
      expect(j1.status, JSON.stringify(j1.body)).toBe(201);
      const j2 = await post(X.token, `/social/groups/${P}/join`);
      expect(j2.status, JSON.stringify(j2.body)).toBe(201);
      await pollUntil(() => inRoom(feedGroupRoomName(A.companyId, P), sock.X), "E4e: X vào room P");

      const kPost3 = await groupPost(K);
      const cA3 = await companyPost();
      const pPost = await groupPost(P);
      await waitForPost(sock.M, kPost3);
      await waitForPost(sock.Pd2, cA3);
      expect(postCount(sock.Pd2, kPost3)).toBe(0);
      await waitForPost(sock.X, pPost);
    });

    it("🔒 E6e `039` mời M ra ⇒ CẢ HAI thiết bị nhận 0 bài K kế tiếp (neo: bài công ty sau đó)", async () => {
      sock.M2 = await ready(M);
      expect(await inK(sock.M2)).toBe(true);

      const res = await del(O.token, `/social/groups/${K}/members/${M.userId}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      await pollUntil(
        async () => !(await inK(sock.M)) && !(await inK(sock.M2)),
        "E6e: cả hai thiết bị rời room K",
      );

      const kPost4 = await groupPost(K);
      const cA4 = await companyPost();
      await waitForPost(sock.O, kPost4); // neo phát: thành viên còn lại NHẬN
      await waitForPost(sock.M, cA4);
      await waitForPost(sock.M2, cA4);
      expect(postCount(sock.M, kPost4)).toBe(0);
      expect(postCount(sock.M2, kPost4)).toBe(0);
    });

    it("🔒 E7e `036` M3 tự rời ⇒ nhận 0 bài K kế tiếp (neo: bài công ty sau đó)", async () => {
      sock.M3 = await ready(M3);
      expect(await inK(sock.M3)).toBe(true);
      const res = await post(M3.token, `/social/groups/${K}/leave`);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      await pollUntil(async () => !(await inK(sock.M3)), "E7e: M3 rời room K");

      const kPost5 = await groupPost(K);
      const cA5 = await companyPost();
      await waitForPost(sock.O, kPost5);
      await waitForPost(sock.M3, cA5);
      expect(postCount(sock.M3, kPost5)).toBe(0);
    });

    it("E8e nhóm mới N (`031`) + người vào nhóm mở (`035`) ⇒ bài của M4 trong N tới O", async () => {
      const created = await post(O.token, "/social/groups").send({
        name: `Nhóm mở ${randomUUID().slice(0, 8)}`,
        visibility: "public",
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const N = created.body.data.id as string;
      await pollUntil(() => inRoom(feedGroupRoomName(A.companyId, N), sock.O), "E8e: O vào room N");

      sock.M4 = await ready(M4);
      const j = await post(M4.token, `/social/groups/${N}/join`);
      expect(j.status, JSON.stringify(j.body)).toBe(201);
      await pollUntil(
        () => inRoom(feedGroupRoomName(A.companyId, N), sock.M4),
        "E8e: M4 vào room N",
      );

      const nPost = await publish(M4, { audience: "group", groupId: N });
      await waitForPost(sock.O, nPost);
      const anchor = await companyPost(M4);
      await waitForPost(sock.O, anchor);
      expect(postCount(sock.O, nPost)).toBe(1);
    });
  },
);
