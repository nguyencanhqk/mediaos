/**
 * S16-SOCIAL-BE-2C · file 1/2 — tầng (m) MEMBERSHIP của room nhóm `co:{c}:feedgroup:{g}` + reader liệt kê
 * nhóm (plan `docs/plans/S16-SOCIAL-BE-2C.md` §5 — §10 ghi đè; commit A, XANH một mình).
 *
 * Đo PHÍA SERVER «socket nào đang ở room nào» (`nsp.local.in(room).fetchSockets()`), KHÔNG cần phát sự
 * kiện nào — nhờ vậy commit A (room + join/leave) chứng minh được cổng membership TRƯỚC khi sự kiện nhóm
 * đầu tiên chảy (commit B, file `social-be2c-group-fanout.int-spec.ts`).
 *
 * Khuôn đo tất định (không `settle` cố định) ở docblock `test/helpers/social-group-rooms-fixture.ts`:
 * readiness = `chatuser` · membership dương = POLL · membership âm sau route = sau RÀO THỨ TỰ.
 *
 * ⚠️ Actor là vai THƯỜNG (không super-admin — SA giữ cả catalog nên mọi cổng «đạt», test thành tautology).
 * Boot qua `applyMainPipeline` (lưới `pipeline-parity`) + `setupWebSocketAdapter` + `listen(0)` như PROD.
 * GATE CỨNG `hasDb && LANE_DB`.
 */

import "reflect-metadata";
import type { AddressInfo } from "node:net";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import type { Namespace } from "socket.io";
import type { Socket as ClientSocket } from "socket.io-client";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../../src/app.module";
import { PasswordService } from "../../src/auth/password.service";
import { loadEnv } from "../../src/config/env.schema";
import * as schema from "../../src/db/schema";
import { RealtimeEmitterService } from "../../src/realtime/realtime-emitter.service";
import { feedGroupRoomName, feedRoomName, feedUserRoomName } from "../../src/realtime/rooms";
import { setupWebSocketAdapter } from "../../src/realtime/setup-websocket-adapter";
import { applyMainPipeline } from "../helpers/bootstrap-app";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";
import {
  FEED_MEMBER_PAIRS,
  NO_FEED_PAIRS,
  becomes,
  connectReady,
  gatewayNamespace,
  isMember,
  pollUntil,
  seedActor,
  seedGroup,
  type FeedRecorder,
  type SeedScope,
} from "../helpers/social-group-rooms-fixture";

const hasLaneDb = hasDb && !!process.env.LANE_DB;
const LOGIN_PW = ["Passw0rd!", "be2c", "rooms"].join("-");

interface Who {
  userId: string;
  token: string;
}

describe.skipIf(!hasLaneDb)(
  "S16-SOCIAL-BE-2C · room nhóm — MEMBERSHIP (WS thật + DB cô lập)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let nsp: Namespace;
    let port = 0;
    let A: SeededTenant;
    let B: SeededTenant;
    let R: SeededTenant;
    const companyIds: string[] = [];
    const open: ClientSocket[] = [];

    // Công ty A — O sở hữu K (kín) + P (mở). Pd/NV `pending` ở K. X/Pd2/M4 không thuộc nhóm nào.
    let O: Who;
    let M: Who;
    let M3: Who;
    let Pd: Who;
    let Pd2: Who;
    let X: Who;
    let NV: Who; // vai KHÔNG có `view:feed` — thành viên `active` của K sau khi O duyệt (M18)
    let M4: Who;
    let Bb: Who; // công ty B
    // FULL gate lượt 1 — Dm: `view:feed` @Department (REST 403 SCOPE-DENIED), thành viên active của KS ·
    // Mu/Mv: thành viên active của KU, bị gỡ bằng route có id CHỮ HOA.
    let Dm: Who;
    let Mu: Who;
    let Mv: Who;
    let K = "";
    let P = "";
    let KS = "";
    let KU = "";
    /** Socket sống qua nhiều ca (thứ tự ca CÓ ý nghĩa — file chạy tuần tự). */
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
      scopes?: Readonly<Record<string, SeedScope>>,
    ): Promise<Who> {
      const { userId, email } = await seedActor(direct, tenant, label, hash, pairs, { scopes });
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

    /** Lời gọi room-op đúng `(company, group, user, action)` đã ghi lại bởi spy. */
    const syncCalls = (
      spy: { mock: { calls: unknown[][] } },
      groupId: string,
      userId: string,
      action: "join" | "leave",
    ) =>
      spy.mock.calls.filter(
        (c) => c[0] === A.companyId && c[1] === groupId && c[2] === userId && c[3] === action,
      );

    beforeAll(async () => {
      process.env.REALTIME_ENABLED = "true";
      direct = directPool();
      A = await seedCompany(direct, "sbe2cm");
      B = await seedCompany(direct, "sbe2cmb");
      R = await seedCompany(direct, "sbe2cmr");
      companyIds.push(A.companyId, B.companyId, R.companyId);

      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = applyMainPipeline(moduleRef.createNestApplication());
      // ĐÚNG lời gọi của `main.ts` — WS đi qua adapter production (in-memory local · Valkey ở CI).
      await setupWebSocketAdapter(app as never, loadEnv());
      await app.listen(0);
      port = (app.getHttpServer().address() as AddressInfo).port;
      nsp = gatewayNamespace(app);

      const hash = await app.get(PasswordService).hash(LOGIN_PW);
      O = await actor(A, "o", hash);
      M = await actor(A, "m", hash);
      M3 = await actor(A, "m3", hash);
      Pd = await actor(A, "pd", hash);
      Pd2 = await actor(A, "pd2", hash);
      X = await actor(A, "x", hash);
      NV = await actor(A, "nv", hash, NO_FEED_PAIRS);
      M4 = await actor(A, "m4", hash);
      Bb = await actor(B, "bb", hash);
      Dm = await actor(A, "dm", hash, FEED_MEMBER_PAIRS, { "view:feed": "Department" });
      Mu = await actor(A, "mu", hash);
      Mv = await actor(A, "mv", hash);

      K = await seedGroup(direct, A.companyId, "private", [
        { userId: O.userId, role: "owner" },
        { userId: M.userId, role: "member" },
        { userId: M3.userId, role: "member" },
        { userId: Pd.userId, role: "member", status: "pending" },
        // NV không gọi được `035` (thiếu `view:feed`) ⇒ hàng pending gieo SQL, rồi O duyệt qua `038`.
        { userId: NV.userId, role: "member", status: "pending" },
      ]);
      P = await seedGroup(direct, A.companyId, "public", [{ userId: O.userId, role: "owner" }]);
      // Dm có thể đã vào KS TRƯỚC khi vai bị hạ scope (hoặc qua `031`/`038`) — gieo thẳng `active`.
      KS = await seedGroup(direct, A.companyId, "private", [
        { userId: O.userId, role: "owner" },
        { userId: Dm.userId, role: "member" },
      ]);
      KU = await seedGroup(direct, A.companyId, "private", [
        { userId: O.userId, role: "owner" },
        { userId: Mu.userId, role: "member" },
        { userId: Mv.userId, role: "member" },
      ]);
    }, 180_000);

    afterAll(async () => {
      while (open.length) open.pop()?.disconnect();
      if (app) await app.close();
      if (direct) {
        await cleanupTenants(direct, companyIds);
        await direct.end();
      }
    });

    // ═══════════════ R1–R5 — reader liệt kê nhóm, trực tiếp trên lane DB ═══════════════
    describe("reader `listActiveGroupIds` (vị từ TẬP NGƯỜI `activeGroupMemberExists`, M7/M28)", () => {
      /**
       * Import LƯỜI có chủ ý: reader là module MỚI của WO; import tĩnh làm cả file không nạp được khi nó
       * vắng ⇒ các ca E* bên dưới không đo được hành vi trên code cũ (RED phải là hành vi, plan §8 T1).
       */
      async function reader(): Promise<{
        listActiveGroupIds(companyId: string, userId: string): Promise<string[]>;
      }> {
        const mod = await import("../../src/social/social-group-rooms.reader");
        return app.get(mod.SocialGroupRoomsReader);
      }

      let U = "";
      let Vp = "";
      let W = "";
      let Z = "";
      let KR = "";
      let PR = "";
      let QR = "";
      let Ub = "";
      let KB = "";

      beforeAll(async () => {
        U = await seedUser(direct, R.companyId, `u@${R.slug}.test`);
        // Neo dương ở TENANT B (FULL gate lượt 1, database-reviewer LOW): «tenant khác ⇒ []» chỉ có nghĩa
        // khi reader CHẠY ĐƯỢC ở tenant đó cho một thành viên thật của nó.
        Ub = await seedUser(direct, B.companyId, `ub-${Date.now()}@${B.slug}.test`);
        KB = await seedGroup(direct, B.companyId, "private", [{ userId: Ub, role: "owner" }]);
        Vp = await seedUser(direct, R.companyId, `v@${R.slug}.test`);
        W = await seedUser(direct, R.companyId, `w@${R.slug}.test`);
        Z = await seedUser(direct, R.companyId, `z@${R.slug}.test`);
        KR = await seedGroup(direct, R.companyId, "private", [{ userId: U, role: "owner" }]);
        // P (mở, U KHÔNG thuộc) + Q (kín, U `pending`) cùng công ty: hai nhóm sống mà U KHÔNG active —
        // thứ làm R5 CHỊU LỰC trước mutant M19 (bỏ alias `g` ⇒ trả MỌI nhóm sống của công ty).
        PR = await seedGroup(direct, R.companyId, "public", [{ userId: W, role: "owner" }]);
        QR = await seedGroup(direct, R.companyId, "private", [
          { userId: Z, role: "owner" },
          { userId: U, role: "member", status: "pending" },
          { userId: Vp, role: "member", status: "pending" },
        ]);
        // Nhóm đã xoá mềm mà Z vẫn còn hàng `active` (034 không chạm hàng thành viên — M8).
        await seedGroup(direct, R.companyId, "private", [{ userId: Z, role: "owner" }], {
          deleted: true,
        });
        // Z là owner sống của QR — để R4 đo ĐÚNG nhóm xoá mềm, Z phải ra khỏi QR.
        await direct.query(
          `DELETE FROM feed_group_members WHERE company_id = $1 AND group_id = $2 AND user_id = $3`,
          [R.companyId, QR, Z],
        );
      });

      it("R1 thành viên `active` của nhóm sống ⇒ có nhóm đó", async () => {
        expect(await (await reader()).listActiveGroupIds(R.companyId, U)).toContain(KR);
      });

      it("R2 chỉ `pending` ⇒ [] (yêu cầu chờ duyệt KHÔNG phải thành viên)", async () => {
        expect(await (await reader()).listActiveGroupIds(R.companyId, Vp)).toEqual([]);
      });

      it("R3 nhóm `public` mà không là thành viên ⇒ [] (vị từ ĐỌC ≠ vị từ TẬP NGƯỜI)", async () => {
        // W là owner của PR ⇒ dùng một user KHÁC W: người ngoài hoàn toàn.
        const outsider = await seedUser(direct, R.companyId, `out-${Date.now()}@${R.slug}.test`);
        expect(await (await reader()).listActiveGroupIds(R.companyId, outsider)).toEqual([]);
        // Neo dương: W (owner, active) THẤY nhóm public của mình.
        expect(await (await reader()).listActiveGroupIds(R.companyId, W)).toEqual([PR]);
      });

      it("R4 nhóm đã xoá mềm ⇒ [] dù hàng thành viên còn `active` (D13)", async () => {
        expect(await (await reader()).listActiveGroupIds(R.companyId, Z)).toEqual([]);
      });

      it("🔒 R5 CHỊU LỰC: đúng CHÍNH XÁC [K] — không P (mở, không thuộc), không Q (pending); tenant khác ⇒ [] (RLS FORCE), neo dương tenant B ⇒ [KB]", async () => {
        const r = await reader();
        expect(await r.listActiveGroupIds(R.companyId, U)).toEqual([KR]);
        // Vế này do RLS + FORCE của `withTenant(B)` gác (hàng của U ở tenant R vô hình trong tx của B) —
        // KHÔNG đo vế `company_id` tường minh của reader; vế đó đo ở R5b dưới phiên bỏ qua RLS.
        expect(await r.listActiveGroupIds(B.companyId, U)).toEqual([]);
        expect(await r.listActiveGroupIds(B.companyId, Ub)).toEqual([KB]);
      });

      it("🔒 R5b vế `company_id` TƯỜNG MINH của reader (bất biến 1) — đo dưới phiên superuser BỎ QUA RLS", async () => {
        // FULL gate lượt 1 (database-reviewer LOW): ca tenant-B ở R5 chỉ đỏ nếu FORCE RLS vỡ. Ở đây RLS
        // KHÔNG lọc gì (superuser) ⇒ chỉ còn `eq(feed_groups.company_id)` + `gm.company_id` của vị từ
        // chặn được hàng tenant R khi hỏi bằng companyId B. Bỏ CẢ HAI ⇒ trả [KR] (đỏ).
        const { listActiveFeedGroupIdsTx } =
          await import("../../src/social/social-group-rooms.reader");
        const superDb = drizzle(direct, { schema });
        // Neo dương: cùng phiên, đúng công ty ⇒ thấy nhóm (câu chạy thật, không rỗng vì lỗi).
        expect(await listActiveFeedGroupIdsTx(superDb as never, R.companyId, U)).toEqual([KR]);
        expect(await listActiveFeedGroupIdsTx(superDb as never, B.companyId, U)).toEqual([]);
      });
    });

    // ═══════════════ E — membership phía server qua WS thật ═══════════════
    it("E0m thành viên `active` của K: lúc connect ở room K, KHÔNG ở room P (không thuộc P — giết M19)", async () => {
      sock.M = await ready(M);
      expect(await inK(sock.M)).toBe(true);
      expect(await inRoom(feedGroupRoomName(A.companyId, P), sock.M)).toBe(false);
    });

    it("🔒 E1m người ngoài / `pending` / tenant khác KHÔNG ở room K; người ngoài KHÔNG ở room nhóm MỞ P", async () => {
      sock.X = await ready(X);
      sock.Pd = await ready(Pd);
      sock.Bb = await ready(Bb, B);

      // Neo dương: cả hai ĐÃ qua cổng `view:feed` (room đánh dấu có mặt) — «không ở K» là vì membership.
      expect(await inRoom(feedUserRoomName(A.companyId, X.userId), sock.X)).toBe(true);
      expect(await inRoom(feedUserRoomName(A.companyId, Pd.userId), sock.Pd)).toBe(true);

      expect(await inK(sock.X)).toBe(false);
      expect(await inK(sock.Pd)).toBe(false); // pending ≠ thành viên (giết M6)
      expect(await inK(sock.Bb)).toBe(false);
      // `view:feed` + nhóm public KHÔNG đủ để vào room (vị từ đọc ≠ vị từ tập người — giết M5).
      expect(await inRoom(feedGroupRoomName(A.companyId, P), sock.X)).toBe(false);
    });

    it("🔒 E2m/E3m `038` duyệt NV (TRƯỢT view:feed) ⇒ NV KHÔNG vào room K; duyệt Pd ⇒ Pd vào K KHÔNG cần reconnect", async () => {
      sock.NV = await ready(NV);
      const spy = vi.spyOn(app.get(RealtimeEmitterService), "syncFeedGroupMembership");
      try {
        const a1 = await patch(O.token, `/social/groups/${K}/members/${NV.userId}`).send({
          decision: "approve",
        });
        expect(a1.status, JSON.stringify(a1.body)).toBe(200);
        // RÀO THỨ TỰ: room-op của Pd phát SAU room-op của NV trên cùng kênh — khi Pd đã vào K thì lệnh
        // của NV chắc chắn đã áp (M23: áp theo thứ tự publish; in-memory: đồng bộ).
        const a2 = await patch(O.token, `/social/groups/${K}/members/${Pd.userId}`).send({
          decision: "approve",
        });
        expect(a2.status, JSON.stringify(a2.body)).toBe(200);
        await pollUntil(
          () => inK(sock.Pd),
          "E3m: Pd vào room K sau khi được duyệt (không reconnect)",
        );

        // Neo: lời gọi join CHO NV CÓ xảy ra — nó chỉ không kéo được socket nào (bộ chọn = feeduser).
        expect(syncCalls(spy, K, NV.userId, "join")).toHaveLength(1);
        expect(await inK(sock.NV), "NV trượt view:feed KHÔNG được ở room nhóm").toBe(false);
      } finally {
        spy.mockRestore();
      }
    });

    it("E4m `035` nhóm KÍN ⇒ pending ⇒ KHÔNG vào room K (rào: X vào nhóm MỞ P)", async () => {
      sock.Pd2 = await ready(Pd2);
      const spy = vi.spyOn(app.get(RealtimeEmitterService), "syncFeedGroupMembership");
      try {
        const j1 = await post(Pd2.token, `/social/groups/${K}/join`);
        expect(j1.status, JSON.stringify(j1.body)).toBe(201);
        expect(j1.body.data.myStatus).toBe("pending");
        // RÀO: X vào nhóm MỞ sau đó ⇒ một room-op dương trên cùng kênh.
        const j2 = await post(X.token, `/social/groups/${P}/join`);
        expect(j2.status, JSON.stringify(j2.body)).toBe(201);
        expect(j2.body.data.myStatus).toBe("active");
        await pollUntil(
          () => inRoom(feedGroupRoomName(A.companyId, P), sock.X),
          "E4m: X vào room P sau 035 nhóm mở",
        );

        expect(await inK(sock.Pd2)).toBe(false);
        expect(syncCalls(spy, K, Pd2.userId, "join")).toHaveLength(0);
      } finally {
        spy.mockRestore();
      }
    });

    it("🔒 E6m `039` mời M ra ⇒ CẢ HAI thiết bị rời room K; leave ĐÚNG 2 lần (trong tx + sau commit)", async () => {
      sock.M2 = await ready(M);
      expect(await inK(sock.M)).toBe(true);
      expect(await inK(sock.M2)).toBe(true);

      const spy = vi.spyOn(app.get(RealtimeEmitterService), "syncFeedGroupMembership");
      try {
        const res = await del(O.token, `/social/groups/${K}/members/${M.userId}`);
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        await pollUntil(
          async () => !(await inK(sock.M)) && !(await inK(sock.M2)),
          "E6m: cả hai thiết bị của M rời room K",
        );
        expect(syncCalls(spy, K, M.userId, "leave")).toHaveLength(2);
        expect(syncCalls(spy, K, M.userId, "join")).toHaveLength(0);
      } finally {
        spy.mockRestore();
      }
    });

    it("🔒 E7m `036` M3 tự rời ⇒ rời room K; leave ĐÚNG 2 lần", async () => {
      sock.M3 = await ready(M3);
      expect(await inK(sock.M3)).toBe(true);

      const spy = vi.spyOn(app.get(RealtimeEmitterService), "syncFeedGroupMembership");
      try {
        const res = await post(M3.token, `/social/groups/${K}/leave`);
        expect(res.status, JSON.stringify(res.body)).toBe(201);
        await pollUntil(async () => !(await inK(sock.M3)), "E7m: M3 rời room K");
        expect(syncCalls(spy, K, M3.userId, "leave")).toHaveLength(2);
      } finally {
        spy.mockRestore();
      }
    });

    it("E8m `031` tạo nhóm ⇒ người tạo vào room ngay; `035` nhóm mở ⇒ người xin vào room ngay", async () => {
      sock.O = await ready(O);
      const created = await post(O.token, "/social/groups").send({
        name: `Nhóm mở ${Date.now()}`,
        visibility: "public",
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const N = created.body.data.id as string;
      await pollUntil(
        () => inRoom(feedGroupRoomName(A.companyId, N), sock.O),
        "E8m: O vào room N sau 031",
      );

      sock.M4 = await ready(M4);
      expect(await inRoom(feedGroupRoomName(A.companyId, N), sock.M4)).toBe(false);
      const j = await post(M4.token, `/social/groups/${N}/join`);
      expect(j.status, JSON.stringify(j.body)).toBe(201);
      await pollUntil(
        () => inRoom(feedGroupRoomName(A.companyId, N), sock.M4),
        "E8m: M4 vào room N sau 035",
      );
    });

    it("E9m `034` xoá K ⇒ socket MỚI của thành viên còn active KHÔNG vào room K; đăng vào K ⇒ 404 ERR-012", async () => {
      // Pd còn `active` ở K (được duyệt ở E2m/E3m) — M đã bị mời ra ở E6m nên M ở đây là xanh-rỗng.
      const pdFresh = await ready(Pd);
      expect(await inK(pdFresh), "neo: TRƯỚC 034, thành viên active vào room K lúc connect").toBe(
        true,
      );

      const res = await del(O.token, `/social/groups/${K}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);

      const afterDelete = await ready(Pd);
      expect(await inK(afterDelete)).toBe(false);

      const write = await post(O.token, "/social/posts").send({
        type: "share",
        audience: "group",
        groupId: K,
        body: `sau khi xoá ${Date.now()}`,
      });
      expect(write.status, JSON.stringify(write.body)).toBe(404);
      expect(write.body.error?.code).toBe("SOCIAL-ERR-012");
    });

    // ═══════════════ FULL gate lượt 1 ═══════════════
    it("🔒 E10m `view:feed` @Department (REST 403 SCOPE-DENIED) ⇒ KHÔNG room bảng tin nào dù là thành viên active của nhóm kín", async () => {
      // HIGH (security-reviewer + typescript-reviewer): cổng cũ `can()` mù `data_scope` ⇒ Dm vào `feed`,
      // `feeduser` và room nhóm kín, nhận trọn payload bài trong khi MỌI route SOCIAL trả 403 cho Dm.
      const rest = await get(Dm.token, `/social/groups/${KS}`);
      expect(rest.status, JSON.stringify(rest.body)).toBe(403);
      expect(JSON.stringify(rest.body)).toContain("AUTH-ERR-SCOPE-DENIED");
      // Neo dương: thành viên @Company của CÙNG nhóm vào room KS lúc connect (reader/room chạy thật).
      const oFresh = await ready(O);
      expect(await inRoom(feedGroupRoomName(A.companyId, KS), oFresh)).toBe(true);

      // Readiness (`chatuser`) ⇒ khối bảng tin của `handleConnection` đã xong — membership âm là tất định.
      const dm = await ready(Dm);
      expect(
        await inRoom(feedUserRoomName(A.companyId, Dm.userId), dm),
        "Dm @Department KHÔNG được ở room đánh dấu feeduser (038 về sau sẽ kéo vào nhóm qua nó)",
      ).toBe(false);
      expect(await inRoom(feedRoomName(A.companyId), dm), "Dm KHÔNG ở room công ty").toBe(false);
      expect(
        await inRoom(feedGroupRoomName(A.companyId, KS), dm),
        "Dm KHÔNG ở room nhóm kín KS",
      ).toBe(false);
    });

    it("🔒 E11m `039` với id CHỮ HOA (ParseUUIDPipe nhận /i, trả nguyên văn) ⇒ người bị mời ra VẪN rời room nhóm", async () => {
      // HIGH (database-reviewer): Postgres so uuid không phân biệt hoa thường ⇒ xoá hàng thành công (200),
      // nhưng tên room là CHUỖI ⇒ leave cũ khớp `co:A:user:{MU-HOA}` thay vì room thật ⇒ Mu ở lại KU.
      const mu = await ready(Mu);
      expect(await inRoom(feedGroupRoomName(A.companyId, KU), mu), "neo: Mu ở KU trước 039").toBe(
        true,
      );

      const res = await del(
        O.token,
        `/social/groups/${KU.toUpperCase()}/members/${Mu.userId.toUpperCase()}`,
      );
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(
        await becomes(async () => !(await inRoom(feedGroupRoomName(A.companyId, KU), mu))),
        "E11m: Mu PHẢI rời room KU sau 039 với id CHỮ HOA",
      ).toBe(true);
    });

    it("🔒 E12m `036` với id nhóm CHỮ HOA ⇒ người tự rời VẪN rời room nhóm", async () => {
      const mv = await ready(Mv);
      expect(await inRoom(feedGroupRoomName(A.companyId, KU), mv), "neo: Mv ở KU trước 036").toBe(
        true,
      );

      const res = await post(Mv.token, `/social/groups/${KU.toUpperCase()}/leave`);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(
        await becomes(async () => !(await inRoom(feedGroupRoomName(A.companyId, KU), mv))),
        "E12m: Mv PHẢI rời room KU sau 036 với id nhóm CHỮ HOA",
      ).toBe(true);
    });
  },
);
