/**
 * S7-CHAT-QA-1 — hai ô nghiệm thu còn trống sau 9 WO trước (SPEC-15 §20 ca 2 · §21 nhóm "Validate").
 *
 * WO QA-1 KHÔNG viết lại 273 ca đang xanh. File này chỉ bít ĐÚNG hai lỗ đo được trên master `32ccd2a4`:
 *
 *   1. **CHAT-ERR-002 = 0 ca** trong toàn bộ int-spec CHAT (census: `src/chat/chat-error-code-census.spec.ts`).
 *      §21 nhóm "Validate" đòi 20 mã lỗi §12, mỗi mã ≥1 ca — đây là mã duy nhất thiếu.
 *
 *   2. **§20 ca 2 vế sau — "không đọc được tin MỚI của phòng cũ" — chưa có ca ở tầng HTTP.**
 *      `chat-be5-derived-rooms` ca b đã chứng minh ở tầng service (`access.assertMember` ném). Tốt,
 *      nhưng tiêu chí nghiệm thu viết bằng ngôn ngữ NGƯỜI DÙNG ("không đọc được"), nên phải có đúng
 *      một ca đi hết đường thật: đổi phòng ban qua writer THẬT → gọi HTTP → nhận 404.
 *      (`assertMember` là cửa duy nhất — `chat-be1-access` ca 14 đóng đinh — nên ca này không thừa mà
 *      là vế NGƯỜI-ĐỌC-ĐƯỢC của cùng một bất biến.)
 *
 * ⚠️ CHỦ THỂ KHÔNG PHẢI SUPER ADMIN (memory `superadmin-not-a-canonical-role`). GATE CỨNG `hasDb && LANE_DB`.
 */

import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../../src/auth/password.service";
import { ChatRoomsService } from "../../src/chat/chat-rooms.service";
import { ChatDerivedRoomsSyncService } from "../../src/chat/chat-derived-rooms-sync.service";
import { EmployeesService } from "../../src/employees/employees.service";
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
const LOGIN_PW = "Passw0rd!chatqa1";

type Scope = "Own" | "Team" | "Department" | "Company";
type PairGrant = [action: string, resource: string, scope: Scope, sensitive?: boolean];

/** 5 cặp CHAT thường — đủ để đọc/gửi/quản trị phòng, KHÔNG có cặp đọc-vượt. */
const CHAT_PAIRS: PairGrant[] = [
  ["view", "chat-room", "Company"],
  ["create", "chat-room", "Company"],
  ["manage", "chat-member", "Company"],
  ["send", "chat-message", "Company"],
  ["recall", "chat-message", "Company"],
];

/** Cặp của writer HR — cờ `sensitive` khớp catalog THẬT (xem cảnh báo ở `chat-be5-derived-rooms`). */
const HR_WRITER_PAIRS: PairGrant[] = [
  ["create", "employee", "Company"],
  ["update", "employee", "Company"],
];

describe.skipIf(!hasLaneDb)("S7-CHAT-QA-1 — nghiệm thu (DB cô lập, đường thật)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  const companyIds: string[] = [];

  let rooms: ChatRoomsService;
  let chatSync: ChatDerivedRoomsSyncService;
  let employees: EmployeesService;

  let uActor = "";
  let tActor = "";
  let uHr = "";
  let hrActor: { id: string; companyId: string };
  /** Hash của `LOGIN_PW` — dùng lại để gieo user đăng nhập được ở giữa ca test. */
  let insiderHash = "";

  const authGet = (t: string, u: string) =>
    request(app.getHttpServer()).get(u).set("Authorization", `Bearer ${t}`);
  const authPost = (t: string, u: string) =>
    request(app.getHttpServer()).post(u).set("Authorization", `Bearer ${t}`);

  async function login(slug: string, email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ companySlug: slug, email, password: LOGIN_PW });
    expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
    return res.body.data.accessToken as string;
  }

  async function grantPairs(
    companyId: string,
    userId: string,
    label: string,
    pairs: PairGrant[],
  ): Promise<void> {
    const roleId = await seedRole(direct, companyId, `qa1-${label}-${userId.slice(0, 8)}`);
    for (const [action, resource, scope, sensitive] of pairs) {
      const permId = await seedPermissionCatalog(direct, action, resource, sensitive ?? false);
      await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
    }
    await seedUserRole(direct, userId, roleId, companyId);
  }

  // ─── helper gieo (superuser, chỉ để DỰNG bối cảnh — không để assert) ───

  async function seedOrgUnit(companyId: string, name: string): Promise<string> {
    const r = await direct.query(
      `INSERT INTO org_units (company_id, name, type, status) VALUES ($1,$2,'department','active') RETURNING id`,
      [companyId, name],
    );
    return r.rows[0].id as string;
  }

  async function seedEmployee(
    companyId: string,
    opts: { userId?: string | null; orgUnitId?: string | null },
  ): Promise<string> {
    const r = await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id, org_unit_id, status, employee_code)
       VALUES ($1,$2,$3,'active',$4) RETURNING id`,
      [
        companyId,
        opts.userId ?? null,
        opts.orgUnitId ?? null,
        `E-${Math.random().toString(36).slice(2, 9)}`,
      ],
    );
    return r.rows[0].id as string;
  }

  async function countRooms(companyId: string): Promise<number> {
    const r = await direct.query(
      `SELECT count(*)::int AS n FROM chat_rooms WHERE company_id = $1`,
      [companyId],
    );
    return r.rows[0].n as number;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    rooms = app.get(ChatRoomsService);
    chatSync = app.get(ChatDerivedRoomsSyncService);
    employees = app.get(EmployeesService);

    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    insiderHash = hash;

    A = await seedCompany(direct, "chatqa1a");
    companyIds.push(A.companyId);

    uActor = await seedUser(direct, A.companyId, `actor@${A.slug}.test`, hash);
    uHr = await seedUser(direct, A.companyId, `hr@${A.slug}.test`, hash);
    await grantPairs(A.companyId, uActor, "actor", CHAT_PAIRS);
    await grantPairs(A.companyId, uHr, "hr", HR_WRITER_PAIRS);
    hrActor = { id: uHr, companyId: A.companyId };
    // Writer HR phải là nhân viên active của công ty (một số đường resolve theo employee mapping).
    await seedEmployee(A.companyId, { userId: uHr });

    tActor = await login(A.slug, `actor@${A.slug}.test`);
  }, 180_000);

  afterAll(async () => {
    await cleanupTenants(direct, companyIds);
    await direct?.end();
    await app?.close();
  });

  // ══════════════ 1. CHAT-ERR-002 — loại phòng ↔ neo không khớp ══════════════
  //
  // Luật §12 CHAT-ERR-002 được ép ở HAI tầng, và ca test phải phân biệt được chúng:
  //   biên HTTP  → Zod `roomType: z.literal("group")` ⇒ **400**
  //   tầng service → `createGroup` check lại ⇒ **422** (defense-in-depth cho job/bridge gọi thẳng)
  // Đo chỉ một tầng là để hở tầng kia: gỡ `z.literal` mà chỉ có ca service thì HTTP nhận
  // `roomType:'department'` rồi mới 422 — vẫn "đúng" nhưng đã đi sâu hơn cần thiết. Gỡ check service
  // mà chỉ có ca HTTP thì đường gọi nội bộ dựng được phòng `direct` giả. Đóng đinh CẢ HAI.

  describe("CHAT-ERR-002 — chỉ tạo được phòng `group` qua CHAT-API-002", () => {
    it.each(["direct", "department", "project", "channel"])(
      "biên HTTP: POST /chat/rooms roomType='%s' → 400 và chat_rooms +0 hàng",
      async (roomType) => {
        const before = await countRooms(A.companyId);

        const res = await authPost(tActor, "/chat/rooms").send({
          name: `Phòng lậu ${roomType}`,
          roomType,
          memberUserIds: [],
        });

        expect(res.status, JSON.stringify(res.body)).toBe(400);
        // Vế QUAN TRỌNG hơn mã lỗi: chặn ở BIÊN nghĩa là không có hàng nào ra đời rồi mới bị từ chối.
        expect(await countRooms(A.companyId), "không phòng nào được tạo").toBe(before);
      },
    );

    it("tầng service (defense-in-depth): createGroup với roomType lạ → 422 CHAT-ERR-002", async () => {
      // Gọi THẲNG service, bỏ qua Zod — mô phỏng đúng đường job/bridge nội bộ mà DTO không gác.
      await expect(
        rooms.createGroup({ id: uActor, companyId: A.companyId }, {
          name: "Phòng lậu qua service",
          roomType: "direct",
          memberUserIds: [],
        } as never),
      ).rejects.toMatchObject({ status: 422 });
    });

    it("đối chứng DƯƠNG: roomType='group' (và bỏ trống → default) vẫn tạo được", async () => {
      const withType = await authPost(tActor, "/chat/rooms").send({
        name: "Phòng nhóm khai tường minh",
        roomType: "group",
        memberUserIds: [],
      });
      expect(withType.status, JSON.stringify(withType.body)).toBe(201);

      const omitted = await authPost(tActor, "/chat/rooms").send({
        name: "Phòng nhóm dùng default",
        memberUserIds: [],
      });
      expect(omitted.status, JSON.stringify(omitted.body)).toBe(201);
      expect(omitted.body.data.roomType).toBe("group");
    });
  });

  // ══════════════ 2. §20 ca 2 — chuyển phòng ban ⇒ MẤT đường đọc, đo ở HTTP ══════════════

  describe("§20 ca 2 — đổi phòng ban: không đọc được tin MỚI của phòng cũ (đường HTTP)", () => {
    it("chuyển A→B: phòng cũ trả 404 ở CẢ /messages lẫn /search, tin MỚI của phòng cũ không rò", async () => {
      const ouA = await seedOrgUnit(A.companyId, `QA1 Dept A ${Date.now()}`);
      const ouB = await seedOrgUnit(A.companyId, `QA1 Dept B ${Date.now()}`);
      const roomA = await chatSync.ensureOrgUnitRoom(A.companyId, ouA, "QA1-A", { kind: "job" });
      const roomB = await chatSync.ensureOrgUnitRoom(A.companyId, ouB, "QA1-B", { kind: "job" });

      const empId = await seedEmployee(A.companyId, { userId: uActor, orgUnitId: ouA });
      // Đồng bộ thành viên theo đường THẬT (hook của writer HR), không gieo tay vào chat_room_members.
      await employees.updateEmployee(hrActor, empId, { orgUnitId: ouA } as never);

      // TIỀN ĐỀ — còn ở phòng A thì ĐỌC ĐƯỢC. Không có vế này, ca dưới xanh cả khi actor chưa bao giờ
      // vào phòng (404 vì lý do khác hẳn) — đúng lớp hỏng "test xanh mà không canh gì".
      const beforeRead = await authGet(tActor, `/chat/rooms/${roomA}/messages?limit=50`);
      expect(beforeRead.status, JSON.stringify(beforeRead.body)).toBe(200);

      await employees.updateEmployee(hrActor, empId, { orgUnitId: ouB } as never);

      // Tin MỚI của phòng cũ, gửi SAU khi người kia đã rời. `insider` phải ĐĂNG NHẬP ĐƯỢC — xem
      // đối chứng dương (b′) ở dưới.
      const insiderEmail = `ins-${Date.now()}@${A.slug}.test`;
      const insider = await seedUser(direct, A.companyId, insiderEmail, insiderHash);
      await grantPairs(A.companyId, insider, "insider", CHAT_PAIRS);
      await direct.query(
        `INSERT INTO chat_room_members (company_id, room_id, user_id, role)
         VALUES ($1,$2,$3,'member') ON CONFLICT DO NOTHING`,
        [A.companyId, roomA, insider],
      );
      await direct.query(
        `INSERT INTO chat_messages (company_id, room_id, sender_id, body, client_message_id, room_seq)
         VALUES ($1,$2,$3,$4,$5,
                 COALESCE((SELECT max(room_seq) FROM chat_messages WHERE room_id = $2), 0) + 1)`,
        [A.companyId, roomA, insider, "bí mật phòng ban cũ sau khi chuyển", randomUUID()],
      );

      // (a) đường đọc theo phòng — 404, KHÔNG 403 (403 xác nhận phòng tồn tại = oracle dò, §12 ERR-001).
      const after = await authGet(tActor, `/chat/rooms/${roomA}/messages?limit=50`);
      expect(after.status, JSON.stringify(after.body)).toBe(404);

      // (b) đường đọc RỘNG — tìm kiếm không được là cửa sau của phòng vừa mất quyền.
      const QUERY = "/chat/search?q=b%C3%AD%20m%E1%BA%ADt";
      const found = await authGet(tActor, QUERY);
      expect(found.status, JSON.stringify(found.body)).toBe(200);
      const rows = (found.body.data as { data: { roomId: string }[] }).data;
      expect(
        rows.filter((r) => r.roomId === roomA),
        "tin mới của phòng ban CŨ không được lọt vào kết quả tìm kiếm",
      ).toEqual([]);

      // (b′) ĐỐI CHỨNG DƯƠNG cho (b) — BẮT BUỘC. Không có nó, vế (b) vẫn xanh khi `/chat/search` hỏng
      // hoàn toàn, khi từ khoá gõ sai, hay khi tin chưa kịp vào `search_vector`: "0 kết quả" đọc thành
      // "đã chặn tốt". Người CÒN trong phòng phải TÌM RA đúng tin đó.
      const tInsider = await login(A.slug, insiderEmail);
      const insiderFound = await authGet(tInsider, QUERY);
      expect(insiderFound.status, JSON.stringify(insiderFound.body)).toBe(200);
      const insiderRows = (insiderFound.body.data as { data: { roomId: string }[] }).data;
      expect(
        insiderRows.filter((r) => r.roomId === roomA).length,
        "người CÒN trong phòng phải tìm ra tin — nếu 0 thì vế (b) không chứng minh được gì",
      ).toBeGreaterThan(0);

      // (c) đối chứng DƯƠNG — phòng MỚI đọc được ngay, không phải chờ job đối soát.
      const newRoom = await authGet(tActor, `/chat/rooms/${roomB}/messages?limit=50`);
      expect(newRoom.status, JSON.stringify(newRoom.body)).toBe(200);
    });
  });
});
