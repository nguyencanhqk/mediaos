/**
 * S10-CHAT-CALLSWEEP-1 (KI-063) — job gặt cuộc gọi `active` mồ côi / quá thọ, trên đường THẬT.
 *
 * ┌─ MỆNH ĐỀ TRUNG TÂM, VÀ VÌ SAO NÓ PHẢI ĐO Ở ĐÂY CHỨ KHÔNG PHẢI UNIT ─────────────────────────────┐
 * │ "Phòng bị khoá VĨNH VIỄN" không phải một câu về code — nó là một câu về **partial unique index**  │
 * │ `chat_calls_one_live_per_room_uq` trên Postgres. Chỉ DB thật chứng minh được: (a) lời mời mới     │
 * │ 409 khi hàng `active` còn đó, (b) 201 sau khi job gặt. Mock repository sẽ xanh cho cả hai chiều   │
 * │ mà không nói gì về index.                                                                         │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ **CHỐNG XANH-RỖNG.** Mỗi ca DENY (không gặt) đi kèm ca ALLOW (có gặt) trên cùng nhánh — thiếu vế
 * ALLOW thì một job **không làm gì cả** cũng làm mọi ca "không bị đụng" XANH
 * (memory `deny-cases-vacuous-without-allow-case`). Bằng chứng RED-trước-GREEN ghi ở `docs/plans/`.
 *
 * GATE CỨNG `hasDb && LANE_DB` — SKIP không phải PASS (`integration-test-lane-db-gate`).
 */

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
import { ChatCallStaleActiveSweepJobHandler } from "../../src/chat/chat-call-stale-active-sweep.job-handler";
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
const LOGIN_PW = "Passw0rd!s10sweep";

/**
 * Ngưỡng CHO CẢ FILE — đặt TRƯỚC khi `AppModule` compile: `ChatCallsService` đọc env đúng MỘT LẦN lúc
 * dựng provider, sửa sau `app.init()` KHÔNG có tác dụng (cùng bẫy đã ghi ở int-spec S7-CALL-BE-1).
 *
 * Giữ giá trị THẬT nhỏ để ca test lùi mốc bằng SQL thay vì chờ đồng hồ; ranh giới nghiệp vụ không đổi
 * (vị từ là cùng một vị từ, chỉ số giây khác).
 */
const ORPHAN_GRACE_MS = 60_000;
const ACTIVE_MAX_MS = 3_600_000;
process.env.CHAT_CALL_ORPHAN_GRACE_MS = String(ORPHAN_GRACE_MS);
process.env.CHAT_CALL_ACTIVE_MAX_MS = String(ACTIVE_MAX_MS);
// File này bắn nhiều lời mời liên tiếp — nới trần tần suất để 429 không nhuộm đỏ ca chẳng liên quan.
process.env.CHAT_CALL_INVITE_MAX_PER_MIN = "40";

type Scope = "Own" | "Team" | "Department" | "Company";
type PairGrant = [action: string, resource: string, scope: Scope, sensitive?: boolean];

const PAIRS_BASE: PairGrant[] = [
  ["view", "chat-room", "Company"],
  ["create", "chat-room", "Company"],
  ["update", "chat-room", "Company"],
  ["archive", "chat-room", "Company"],
  ["manage", "chat-member", "Company"],
  ["send", "chat-message", "Company"],
];
const PAIR_CALL: PairGrant = ["call", "chat-room", "Company"];

describe.skipIf(!hasLaneDb)("S10-CHAT-CALLSWEEP-1 — gặt cuộc gọi `active` mồ côi (KI-063)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  const companyIds: string[] = [];

  let uCaller = "";
  let uCallee = "";
  let tCaller = "";
  let tCallee = "";

  const spareRooms: string[] = [];
  let spareIdx = 0;
  const nextRoom = (): string => {
    const r = spareRooms[spareIdx];
    spareIdx += 1;
    if (!r) throw new Error("hết phòng dự phòng — tăng số phòng gieo ở beforeAll");
    return r;
  };

  const srv = () => request(app.getHttpServer());
  const authPost = (t: string, u: string) => srv().post(u).set("Authorization", `Bearer ${t}`);

  async function grantPairs(userId: string, label: string, pairs: PairGrant[]): Promise<void> {
    const roleId = await seedRole(direct, A.companyId, `s10sweep-${label}-${userId.slice(0, 8)}`);
    for (const [action, resource, scope, sensitive] of pairs) {
      const permId = await seedPermissionCatalog(direct, action, resource, sensitive ?? false);
      await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
    }
    await seedUserRole(direct, userId, roleId, A.companyId);
  }

  async function login(email: string): Promise<string> {
    const res = await srv()
      .post("/auth/login")
      .send({ companySlug: A.slug, email, password: LOGIN_PW });
    expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
    return res.body.data.accessToken as string;
  }

  async function createGroup(name: string, members: string[]): Promise<string> {
    const res = await authPost(tCaller, "/chat/rooms").send({ name, memberUserIds: members });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data.id as string;
  }

  /** Mời rồi NHẬN ⇒ cuộc gọi ở `active` thật (qua đường REST, không chèn hàng tay). */
  async function liveCall(room: string): Promise<string> {
    const inv = await authPost(tCaller, `/chat/rooms/${room}/calls`).send({ kind: "audio" });
    expect(inv.status, JSON.stringify(inv.body)).toBe(201);
    const callId = inv.body.data.id as string;
    const acc = await authPost(tCallee, `/chat/calls/${callId}/accept`);
    expect(acc.status, JSON.stringify(acc.body)).toBe(200);
    expect((await callRow(callId)).status).toBe("active");
    return callId;
  }

  /** Lùi `started_at` để cuộc gọi "già" hơn ngưỡng — nhanh và tất định hơn chờ đồng hồ. */
  async function ageCall(callId: string, ms: number): Promise<void> {
    await direct.query(
      `UPDATE chat_calls SET started_at = now() - ($2::bigint * interval '1 millisecond') WHERE id = $1`,
      [callId, ms],
    );
  }

  /**
   * Đóng MỌI hàng participant của cuộc gọi = dựng đúng trạng thái mà `ChatCallRoomExitService` để lại
   * khi cả hai người bị gỡ khỏi phòng: phần tham gia đã đóng, `chat_calls` KHÔNG bị chạm (hàng rào R4).
   */
  async function orphanCall(callId: string): Promise<void> {
    await direct.query(
      `UPDATE chat_call_participants SET outcome = 'left', left_at = now() WHERE call_id = $1`,
      [callId],
    );
  }

  async function callRow(
    callId: string,
  ): Promise<{ status: string; accepted_at: Date | null; ended_at: Date | null }> {
    const r = await direct.query(
      "SELECT status, accepted_at, ended_at FROM chat_calls WHERE id = $1",
      [callId],
    );
    return r.rows[0];
  }

  async function participantRows(
    callId: string,
  ): Promise<{ user_id: string; outcome: string | null; left_at: Date | null }[]> {
    const r = await direct.query(
      "SELECT user_id, outcome, left_at FROM chat_call_participants WHERE call_id = $1 ORDER BY invited_at",
      [callId],
    );
    return r.rows;
  }

  async function auditRows(
    callId: string,
  ): Promise<{ action: string; actor_type: string | null; new_values: unknown }[]> {
    const r = await direct.query(
      "SELECT action, actor_type, new_values FROM audit_logs WHERE object_id = $1 ORDER BY created_at",
      [callId],
    );
    return r.rows;
  }

  const sweep = async (): Promise<{ total: number }> => {
    const handler = app.get(ChatCallStaleActiveSweepJobHandler, { strict: false });
    return handler.run({ companyId: A.companyId });
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "s10sweep");
    companyIds.push(A.companyId);

    uCaller = await seedUser(direct, A.companyId, `caller@${A.slug}.test`, hash);
    uCallee = await seedUser(direct, A.companyId, `callee@${A.slug}.test`, hash);
    await grantPairs(uCaller, "caller", [...PAIRS_BASE, PAIR_CALL]);
    await grantPairs(uCallee, "callee", [...PAIRS_BASE, PAIR_CALL]);

    tCaller = await login(`caller@${A.slug}.test`);
    tCallee = await login(`callee@${A.slug}.test`);

    // Mỗi ca cần phòng RIÊNG: partial unique chỉ cho MỘT cuộc gọi sống mỗi phòng, dùng lại phòng của ca
    // trước sẽ đo nhầm 409 thay vì thứ ca đó muốn đo.
    for (let i = 0; i < 12; i += 1) {
      spareRooms.push(await createGroup(`Phòng gọi ${i}`, [uCallee]));
    }
  }, 240_000);

  afterAll(async () => {
    await cleanupTenants(direct, companyIds);
    await direct.end();
    await app.close();
  });

  // ═══════════ nhánh (O) MỒ CÔI — kịch bản gốc của KI-063 ═══════════

  it("R1 🔴 phòng bị khoá VĨNH VIỄN bởi cuộc gọi `active` mồ côi ⇒ sau sweep mời lại được", async () => {
    const room = nextRoom();
    const stuck = await liveCall(room);
    await orphanCall(stuck);
    await ageCall(stuck, ORPHAN_GRACE_MS + 5_000);

    // Vế THỨ NHẤT của mệnh đề — đây là trạng thái KI mô tả, và nó phải THẬT trước khi bản vá chạy.
    // Không có vế này thì ca chỉ chứng minh "job đổi được status", không chứng minh nó gỡ được khoá.
    const blocked = await authPost(tCaller, `/chat/rooms/${room}/calls`).send({ kind: "audio" });
    expect(blocked.status, JSON.stringify(blocked.body)).toBe(409);
    expect(JSON.stringify(blocked.body)).toContain("CHAT-ERR-028");

    const res = await sweep();
    expect(res.total).toBeGreaterThanOrEqual(1);

    const row = await callRow(stuck);
    // `ended`, KHÔNG `missed`: cuộc gọi ĐÃ được nhận (`accepted_at` khác null) — xem plan §2.
    expect(row.status).toBe("ended");
    expect(row.accepted_at).not.toBeNull();
    expect(row.ended_at).not.toBeNull();

    // Vế THỨ HAI — phòng thật sự mở khoá.
    const ok = await authPost(tCaller, `/chat/rooms/${room}/calls`).send({ kind: "audio" });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
  });

  it("R2 🔴 cuộc gọi `active` CÒN người đang nói chuyện ⇒ sweep KHÔNG đụng (dù đã quá ân hạn)", async () => {
    const live = await liveCall(nextRoom());
    await ageCall(live, ORPHAN_GRACE_MS + 5_000);
    // KHÔNG orphanCall: `uCallee` giữ `outcome='accepted'`, `uCaller` giữ `null` ⇒ vẫn còn người trong cuộc.

    await sweep();

    expect((await callRow(live)).status).toBe("active");
  });

  it("R4 🔴 mồ côi nhưng CHƯA quá ân hạn ⇒ KHÔNG gặt (ngưỡng là ngưỡng thật, không phải quét sạch)", async () => {
    const fresh = await liveCall(nextRoom());
    await orphanCall(fresh);
    // Không lùi mốc: `started_at` vẫn là bây giờ ⇒ trẻ hơn ORPHAN_GRACE_MS.

    await sweep();

    expect((await callRow(fresh)).status).toBe("active");
  });

  // ═══════════ nhánh (D) QUÁ THỌ — lưới an toàn ═══════════

  it("R3 🔴 `active` quá trần thọ ⇒ bị gặt DÙ vẫn còn người treo (nhánh mồ côi không khớp)", async () => {
    const zombie = await liveCall(nextRoom());
    await ageCall(zombie, ACTIVE_MAX_MS + 60_000);
    // KHÔNG orphanCall — đây đúng hình dạng mà nhánh (O) bỏ sót: hàng participant còn "trong cuộc" mãi
    // (nhánh `!ok` của closeCallParticipationOnRoomExit). Không có (D) thì lỗ chỉ đổi hình dạng.

    await sweep();

    expect((await callRow(zombie)).status).toBe("ended");
    const auto = (await auditRows(zombie)).find((a) => a.action === "chat.call.auto_ended");
    expect((auto?.new_values as { reason?: string } | null)?.reason).toBe("max_duration");
  });

  // ═══════════ kết cục participant ═══════════

  it("P1 kết cục tính THEO TỪNG HÀNG: đã vào ⇒ `left` + `left_at`; chưa vào ⇒ `missed`, KHÔNG `left_at`", async () => {
    const call = await liveCall(nextRoom());
    // `uCaller` có `joined_at` (tự vào cuộc gọi của mình) và `outcome=null`; `uCallee` đã `accept`
    // ⇒ `outcome='accepted'` + `joined_at`. Ép một hàng về "được mời mà chưa vào" để đo cả hai nhánh.
    await direct.query(
      `UPDATE chat_call_participants SET joined_at = NULL, outcome = NULL WHERE call_id = $1 AND user_id = $2`,
      [call, uCallee],
    );
    await ageCall(call, ACTIVE_MAX_MS + 60_000);

    await sweep();

    const rows = await participantRows(call);
    const joined = rows.find((r) => r.user_id === uCaller);
    const never = rows.find((r) => r.user_id === uCallee);
    expect(joined?.outcome).toBe("left");
    expect(joined?.left_at).not.toBeNull();
    expect(never?.outcome).toBe("missed");
    // "Cuộc gọi nhỡ" mà có mốc rời tự nó là một sự KHÔNG NHẤT QUÁN — cùng luật ba đường kia đã viết.
    expect(never?.left_at).toBeNull();
  });

  it("P2 hàng đã HẤP THỤ (`rejected`) KHÔNG bị sweep ghi đè", async () => {
    const call = await liveCall(nextRoom());
    await direct.query(
      `UPDATE chat_call_participants SET outcome = 'rejected' WHERE call_id = $1 AND user_id = $2`,
      [call, uCallee],
    );
    await ageCall(call, ACTIVE_MAX_MS + 60_000);

    await sweep();

    const rows = await participantRows(call);
    expect(rows.find((r) => r.user_id === uCallee)?.outcome).toBe("rejected");
  });

  // ═══════════ hồi sinh · idempotent · wiring ═══════════

  it("V1 hàng `ended` do sweep KHÔNG kéo về `active` được — trigger FSM một chiều còn hiệu lực", async () => {
    const call = await liveCall(nextRoom());
    await orphanCall(call);
    await ageCall(call, ORPHAN_GRACE_MS + 5_000);
    await sweep();
    expect((await callRow(call)).status).toBe("ended");

    // Nếu hồi sinh được thì hàng đó chiếm LẠI chỗ trong partial unique và khoá phòng vĩnh viễn lần nữa —
    // CHECK không chặn nổi vì CHECK không thấy `OLD` ([[check-cannot-enforce-fsm-transitions]]).
    await expect(
      direct.query(`UPDATE chat_calls SET status = 'active' WHERE id = $1`, [call]),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("I1 chạy lại lập tức là NO-OP (idempotent theo cấu trúc, hợp đồng JobHandler)", async () => {
    const call = await liveCall(nextRoom());
    await orphanCall(call);
    await ageCall(call, ORPHAN_GRACE_MS + 5_000);

    const first = await sweep();
    const second = await sweep();

    expect(first.total).toBeGreaterThanOrEqual(1);
    expect(second.total).toBe(0);
    // Đúng MỘT dòng audit cho một lần gặt — chạy lại không được bơm thêm dòng nào.
    const autoEnded = (await auditRows(call)).filter((a) => a.action === "chat.call.auto_ended");
    expect(autoEnded).toHaveLength(1);
    expect(autoEnded[0].actor_type).toBe("Job");
  });

  it("A1 ✅ cuộc gọi `ringing` KHÔNG bị handler này chạm (đúng phân công với job ring-timeout)", async () => {
    const room = nextRoom();
    const inv = await authPost(tCaller, `/chat/rooms/${room}/calls`).send({ kind: "audio" });
    expect(inv.status).toBe(201);
    const ringing = inv.body.data.id as string;
    await ageCall(ringing, ACTIVE_MAX_MS + 60_000);

    await sweep();

    // Vẫn `ringing`: gặt nó ở đây sẽ ghi `ended` cho một cuộc gọi CHƯA AI BẮT MÁY — đúng thứ trạng thái
    // `missed` của job kia tồn tại để nói.
    expect((await callRow(ringing)).status).toBe("ringing");
  });

  it("J1 wiring: jobCode mới được scheduler gom qua DiscoveryService, và DUY NHẤT toàn hệ", async () => {
    const { DiscoveryService } = await import("@nestjs/core");
    const { SYSTEM_JOB_HANDLER } = await import("../../src/scheduler/job-handler");
    const discovery = app.get(DiscoveryService);

    const codes = discovery
      .getProviders()
      .filter(
        (w) =>
          w.metatype &&
          w.instance != null &&
          Reflect.getMetadata(SYSTEM_JOB_HANDLER, w.metatype) === true,
      )
      .map((w) => (w.instance as { jobCode?: string }).jobCode);

    expect(codes).toContain("CHAT_CALL_STALE_ACTIVE_SWEEP");
    // Trùng jobCode = hai job giành MỘT khoá `system_job_locks` ⇒ một trong hai không bao giờ chạy.
    expect(codes.filter((c) => c === "CHAT_CALL_STALE_ACTIVE_SWEEP")).toHaveLength(1);
    // Job cũ PHẢI còn nguyên: bản vá thêm một đường, không thay đường sẵn có.
    expect(codes).toContain("CHAT_CALL_RINGING_TIMEOUT");
  });
});
