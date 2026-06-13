import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../../src/db/db.service";
import { AuditService } from "../../src/events/audit.service";
import { ChatRepository } from "../../src/chat/chat.repository";
import { ChatService } from "../../src/chat/chat.service";
import { MediaRepository } from "../../src/media/media.repository";
import { MediaService } from "../../src/media/media.service";
import { OrgRepository } from "../../src/org/org.repository";
import { OrgService } from "../../src/org/org.service";
import { RealtimeEmitterService } from "../../src/realtime/realtime-emitter.service";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

/**
 * G10-2 — Auto group chat theo kênh / phòng ban (CHAT-003) qua Postgres thật (RLS app role).
 *
 * Bao 5 invariant của micro-plan (rủi ro CRITICAL "rò tenant" + idempotent + best-effort):
 *   1. IDEMPOTENT channel: createChannel 2 lần (cùng tên/code) ⇒ ĐÚNG 1 chat_room roomType=channel
 *      (partial-unique chat_rooms_channel_uq + onConflictDoNothing). Lần 2 ConflictException nhưng
 *      room không bị nhân đôi (ensureChannelRoom gọi 1 lần/channel, idempotent qua check-then-insert).
 *   2. IDEMPOTENT org_unit: createOrgUnit 2 lần ⇒ 1 room qua org_unit_id unique.
 *   3. MEMBER-SET = members thực thể: kênh N channel_members ⇒ chat_room_members = N (+creator);
 *      org_unit M employee_profiles.org_unit_id ⇒ M member (+head).
 *   4. TENANT ISOLATION (deny-path BẮT BUỘC): login A KHÔNG thấy room auto của B (listRooms/getRoom
 *      0 row); isMember(B-room, A-user)=false.
 *   5. BEST-EFFORT KHÔNG rollback: ép ensureChannelRoom ném (mock repo lỗi) ⇒ channel vẫn tạo OK.
 *
 * Chạy với LANE_DB=mediaos_g10 (DB cô lập — chống shared-DB drift, CLAUDE.md §9.6). Tự skip nếu !hasDb.
 */
describe.skipIf(!hasDb)("G10-2 auto group chat — channel / org_unit", () => {
  const direct = directPool();
  let A: SeededTenant;
  let B: SeededTenant;
  let userA: string;
  let userB: string;
  let db: DatabaseService;
  let chatRepo: ChatRepository;
  let chat: ChatService;
  let media: MediaService;
  let org: OrgService;

  /** Seed 1 channel_members thô (direct pool — bypass RLS) để member-set test phản ánh đúng thực thể. */
  async function seedChannelMember(companyId: string, channelId: string, userId: string) {
    await direct.query(
      `INSERT INTO channel_members (company_id, channel_id, user_id, status) VALUES ($1, $2, $3, 'active')`,
      [companyId, channelId, userId],
    );
  }

  /** Seed 1 employee_profile gắn org_unit (direct pool) để member-set org test đúng thực thể. */
  async function seedEmployeeInOrgUnit(companyId: string, userId: string, orgUnitId: string) {
    await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id, org_unit_id) VALUES ($1, $2, $3)`,
      [companyId, userId, orgUnitId],
    );
  }

  /** Đếm chat_room theo (company, channel|org_unit) qua direct pool — kiểm idempotent thật ở DB. */
  async function countRoomsByChannel(companyId: string, channelId: string): Promise<number> {
    const r = await direct.query(
      `SELECT count(*)::int AS n FROM chat_rooms WHERE company_id = $1 AND channel_id = $2`,
      [companyId, channelId],
    );
    return r.rows[0].n as number;
  }
  async function countRoomsByOrgUnit(companyId: string, orgUnitId: string): Promise<number> {
    const r = await direct.query(
      `SELECT count(*)::int AS n FROM chat_rooms WHERE company_id = $1 AND org_unit_id = $2`,
      [companyId, orgUnitId],
    );
    return r.rows[0].n as number;
  }
  async function countMembers(companyId: string, roomId: string): Promise<number> {
    const r = await direct.query(
      `SELECT count(*)::int AS n FROM chat_room_members WHERE company_id = $1 AND room_id = $2`,
      [companyId, roomId],
    );
    return r.rows[0].n as number;
  }

  beforeAll(async () => {
    A = await seedCompany(direct, "g10a");
    B = await seedCompany(direct, "g10b");
    userA = await seedUser(direct, A.companyId, `g10-${randomUUID().slice(0, 8)}@a.test`);
    userB = await seedUser(direct, B.companyId, `g10-${randomUUID().slice(0, 8)}@b.test`);

    db = new DatabaseService();
    chatRepo = new ChatRepository(db);
    chat = new ChatService(chatRepo, new RealtimeEmitterService());
    media = new MediaService(new MediaRepository(db), db, new AuditService(), chat);
    org = new OrgService(new OrgRepository(db), chat);
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId, B.companyId]);
    await direct.end();
  });

  // ─── 1. Idempotent channel ─────────────────────────────────────────────────────

  it("tạo channel → auto-tạo chat_room roomType=channel idempotent (2 lần ⇒ 1 room)", async () => {
    const name = `g10-ch-${randomUUID().slice(0, 8)}`;
    const code = `c-${randomUUID().slice(0, 6)}`;
    const ch = await media.createChannel(
      { id: userA, companyId: A.companyId },
      { name, platform: "youtube", code },
    );

    expect(await countRoomsByChannel(A.companyId, ch.id)).toBe(1);
    const room1 = (await chatRepo.findRoomByChannel(A.companyId, ch.id))[0];
    expect(room1.roomType).toBe("channel");

    // Lần 2: cùng tên/code → ConflictException ở channel, NHƯNG room không được nhân đôi.
    await expect(
      media.createChannel(
        { id: userA, companyId: A.companyId },
        { name, platform: "youtube", code },
      ),
    ).rejects.toThrow();
    expect(await countRoomsByChannel(A.companyId, ch.id)).toBe(1);

    // Gọi ensureChannelRoom trực tiếp lần nữa cũng idempotent (check-then-insert).
    await chat.ensureChannelRoom(A.companyId, ch.id, name, userA, []);
    expect(await countRoomsByChannel(A.companyId, ch.id)).toBe(1);
  });

  // ─── 2. Idempotent org_unit ────────────────────────────────────────────────────

  it("tạo org_unit → auto-tạo chat_room roomType=department idempotent (2 lần ⇒ 1 room)", async () => {
    const unit = await org.createOrgUnit(A.companyId, {
      name: `g10-dept-${randomUUID().slice(0, 8)}`,
      type: "department",
    });

    expect(await countRoomsByOrgUnit(A.companyId, unit.id)).toBe(1);
    const room = (await chatRepo.findRoomByOrgUnit(A.companyId, unit.id))[0];
    expect(room.roomType).toBe("department");

    // ensureOrgUnitRoom lần nữa → idempotent.
    await chat.ensureOrgUnitRoom(A.companyId, unit.id, unit.name, []);
    expect(await countRoomsByOrgUnit(A.companyId, unit.id)).toBe(1);
  });

  // ─── 3. Member-set = members của thực thể ───────────────────────────────────────

  it("thành viên phòng channel = channel_members hiện tại + creator (member-set qua ensureChannelRoom)", async () => {
    // SCOPE G10-2: auto-create LÚC TẠO; member-set = members thực thể TẠI THỜI ĐIỂM đó. Kênh mới
    // chưa có channel_members ⇒ ở đây ta tạo kênh, seed 2 channel_members, rồi gọi ensureChannelRoom
    // (1 lần, room CHƯA tồn tại với id này) với member-set thực thể để xác minh N member + creator.
    const name = `g10-chm-${randomUUID().slice(0, 8)}`;
    const m1 = await seedUser(direct, A.companyId, `g10-m1-${randomUUID().slice(0, 8)}@a.test`);
    const m2 = await seedUser(direct, A.companyId, `g10-m2-${randomUUID().slice(0, 8)}@a.test`);

    // Tạo channel qua direct pool (KHÔNG qua media.createChannel → tránh auto-tạo room trước) để
    // ta kiểm soát chính xác lần ensureChannelRoom DUY NHẤT mang đủ member-set.
    const platformId = (
      await direct.query(`SELECT id FROM platforms WHERE code = 'tiktok' LIMIT 1`)
    ).rows[0].id;
    const chId = (
      await direct.query(
        `INSERT INTO channels (company_id, name, platform, platform_id) VALUES ($1, $2, 'tiktok', $3) RETURNING id`,
        [A.companyId, name, platformId],
      )
    ).rows[0].id;
    await seedChannelMember(A.companyId, chId, m1);
    await seedChannelMember(A.companyId, chId, m2);

    const memberRows = await media["repo"].listChannelMembers(A.companyId, chId);
    await chat.ensureChannelRoom(
      A.companyId,
      chId,
      name,
      userA,
      memberRows.map((r) => r.userId),
    );

    const room = (await chatRepo.findRoomByChannel(A.companyId, chId))[0];
    // creator(userA) + m1 + m2 = 3 (không nhân đôi creator).
    expect(await countMembers(A.companyId, room.id)).toBe(3);
  });

  it("thành viên phòng department = head + employee_profiles.org_unit_id (member-set lúc tạo)", async () => {
    const head = await seedUser(direct, A.companyId, `g10-head-${randomUUID().slice(0, 8)}@a.test`);
    const emp1 = await seedUser(direct, A.companyId, `g10-e1-${randomUUID().slice(0, 8)}@a.test`);
    const emp2 = await seedUser(direct, A.companyId, `g10-e2-${randomUUID().slice(0, 8)}@a.test`);

    // Tạo org_unit qua direct pool TRƯỚC (chưa room), seed 2 nhân sự thuộc unit, rồi gọi
    // ensureOrgUnitRoom DUY NHẤT với member-set = head + nhân sự thực thể.
    const uName = `g10-deptm-${randomUUID().slice(0, 8)}`;
    const ouId = (
      await direct.query(
        `INSERT INTO org_units (company_id, name, type, head_user_id) VALUES ($1, $2, 'department', $3) RETURNING id`,
        [A.companyId, uName, head],
      )
    ).rows[0].id;
    await seedEmployeeInOrgUnit(A.companyId, emp1, ouId);
    await seedEmployeeInOrgUnit(A.companyId, emp2, ouId);

    const memberIds = await org["repo"].listOrgUnitMemberUserIds(A.companyId, ouId);
    await chat.ensureOrgUnitRoom(A.companyId, ouId, uName, [head, ...memberIds]);

    const room = (await chatRepo.findRoomByOrgUnit(A.companyId, ouId))[0];
    expect(await countMembers(A.companyId, room.id)).toBe(3); // head + emp1 + emp2 (dedupe)
  });

  it("ensureOrgUnitRoom LÚC TẠO (chưa nhân sự) ⇒ room chỉ có head (ngữ nghĩa member-set tại thời điểm tạo)", async () => {
    const head = await seedUser(direct, A.companyId, `g10-h2-${randomUUID().slice(0, 8)}@a.test`);
    const unit = await org.createOrgUnit(A.companyId, {
      name: `g10-deptH-${randomUUID().slice(0, 8)}`,
      type: "department",
      headUserId: head,
    });
    const room = (await chatRepo.findRoomByOrgUnit(A.companyId, unit.id))[0];
    expect(await countMembers(A.companyId, room.id)).toBe(1); // chỉ head
  });

  // ─── 4. Tenant isolation (deny-path) ────────────────────────────────────────────

  it("TENANT ISOLATION: login A KHÔNG thấy room auto của B; isMember chéo = false", async () => {
    // B tạo channel → room của B + member userB.
    const chB = await media.createChannel(
      { id: userB, companyId: B.companyId },
      { name: `g10-chB-${randomUUID().slice(0, 8)}`, platform: "youtube" },
    );
    const roomB = (await chatRepo.findRoomByChannel(B.companyId, chB.id))[0];
    expect(roomB).toBeTruthy();

    // login A: listRooms KHÔNG chứa room B; getRoom(roomB) bằng tenant A ⇒ NotFound (RLS 0 row).
    const roomsA = await chat.listRooms(A.companyId, userA);
    expect(roomsA.some((r) => r.id === roomB.id)).toBe(false);
    await expect(chat.getRoom(A.companyId, roomB.id, userA)).rejects.toThrow();

    // isMember(B-room, A-user) qua tenant A = false (RLS không lộ membership của B).
    expect(await chatRepo.isMember(A.companyId, roomB.id, userA)).toBe(false);

    // findRoomByChannel của A trên channel B = 0 row (channel B không thuộc tenant A).
    expect((await chatRepo.findRoomByChannel(A.companyId, chB.id)).length).toBe(0);
  });

  // ─── 5. Best-effort: lỗi auto-room KHÔNG rollback entity ─────────────────────────

  it("best-effort: lỗi auto-room KHÔNG rollback create channel (channel vẫn commit)", async () => {
    // Mock ChatService.ensureChannelRoom THROW (lỗi hạ tầng room). Vì createChannel gọi room SAU khi
    // tx channel đã COMMIT (parity ProjectsService dòng 104-105), channel phải tồn tại trong DB dù
    // lời gọi room ném — chứng minh room là non-critical, không kéo theo rollback entity.
    const failingChat = {
      ensureChannelRoom: () => Promise.reject(new Error("forced room failure")),
    } as unknown as ChatService;
    const mediaFail = new MediaService(
      new MediaRepository(db),
      db,
      new AuditService(),
      failingChat,
    );

    const name = `g10-chfail-${randomUUID().slice(0, 8)}`;
    await expect(
      mediaFail.createChannel(
        { id: userA, companyId: A.companyId },
        { name, platform: "facebook" },
      ),
    ).rejects.toThrow("forced room failure");

    // Channel ĐÃ commit (tx đóng trước khi gọi room) ⇒ tồn tại trong DB (direct pool, bypass RLS).
    const found = await direct.query(
      `SELECT id FROM channels WHERE company_id = $1 AND name = $2 AND deleted_at IS NULL`,
      [A.companyId, name],
    );
    expect(found.rows.length).toBe(1);
  });
});
