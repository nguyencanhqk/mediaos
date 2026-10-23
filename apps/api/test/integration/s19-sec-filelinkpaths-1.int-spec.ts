/**
 * S19-SEC-FILELINKPATHS-1 — các đường gắn tệp ngoài lõi (đính kèm tin CHAT · ảnh phòng CHAT · ảnh đại diện
 * NV do HR đặt) chỉ tạo liên kết khi người gắn xem được tệp theo cùng quyết định với
 * `GET /foundation/files/:id` (plan `docs/plans/S19-SEC-FILELINKPATHS-1.md` §3 D-4…D-7 · §6).
 *
 * Bất biến đo ở đây:
 *   (1) tệp «đã từng gắn, 0 liên kết sống» ⇒ từ chối, kể cả chủ tệp;
 *   (2) tệp có liên kết sống mà người gắn không xem được ⇒ từ chối;
 *   (3) từ chối ⇒ 0 liên kết mới, thực thể đích không đổi; một tệp từ chối trong lô ⇒ cả lô không gắn;
 *   (4) thứ tự lỗi cũ giữ nguyên (ngoài phòng ⇒ lỗi thành viên trước lỗi tệp) và gửi lại cùng
 *       `clientMessageId` trả lại tin cũ;
 *   (5) mỗi ca TỪ CHỐI có ca CHO PHÉP đứng cạnh trên cùng route.
 *
 * Fixture «0 liên kết sống» dựng bằng đường thật gỡ liên kết (gỡ / thay ảnh), đo trước khi dùng.
 * Tệp gieo bằng pool `direct` (không PUT storage).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PasswordService } from "../../src/auth/password.service";
import { hasDb } from "../helpers/integration-db";
import {
  seedPermissionCatalog,
  seedRole,
  seedRolePermission,
  seedUser,
  seedUserRole,
} from "../helpers/seed";
import { bootQa1World, type Json, type Qa1World } from "../helpers/social-qa1-kit";

const hasLaneDb = hasDb && !!process.env.LANE_DB;
const BOOT_TIMEOUT_MS = 180_000;
const LOGIN_PW = ["Passw0rd", "flp19"].join("!");

type PairGrant = readonly [string, string];
const CHAT_PAIRS: readonly PairGrant[] = [
  ["view", "chat-room"],
  ["create", "chat-room"],
  ["update", "chat-room"],
  ["send", "chat-message"],
  ["recall", "chat-message"],
  ["manage", "chat-member"],
];
const HR_PAIRS: readonly PairGrant[] = [["update", "employee"]];

const CHAT_FILE_INVALID = "CHAT-ERR-015";
const HR_FILE_FORBIDDEN = "AUTH-ERR-FORBIDDEN";

const dataOf = (body: unknown): Json => ((body as { data?: unknown }).data ?? {}) as Json;
type Res = { status: number; body: unknown };
const is2xx = (res: Res): boolean => res.status >= 200 && res.status < 300;

describe.skipIf(!hasLaneDb)(
  "S19-SEC-FILELINKPATHS-1 · đường gắn tệp ngoài lõi theo cùng quyết định xem từng tệp",
  () => {
    let w: Qa1World;
    const ids = new Map<string, string>();
    const tokens = new Map<string, string>();
    const f: Record<string, string> = {};
    let roomA = "";
    let roomB = "";
    let emp1 = "";
    let emp2 = "";
    let p1a1Payload: Json = {};
    let p1a4Payload: Json = {};
    let p1a4MessageId = "";

    // ─── Fixture ──────────────────────────────────────────────────────────────

    async function makeUser(label: string, pairs: readonly PairGrant[]): Promise<void> {
      const hash = await new PasswordService().hash(LOGIN_PW);
      const userId = await seedUser(w.direct, w.A.companyId, `${label}@${w.A.slug}.test`, hash);
      const roleId = await seedRole(w.direct, w.A.companyId, `flp-${label}-${userId.slice(0, 8)}`);
      for (const [action, resource] of pairs) {
        const permId = await seedPermissionCatalog(w.direct, action, resource, false);
        await seedRolePermission(w.direct, roleId, permId, "ALLOW", "Company");
      }
      await seedUserRole(w.direct, userId, roleId, w.A.companyId);
      ids.set(label, userId);
      const res = await w
        .post(null, "/auth/login")
        .send({ companySlug: w.A.slug, email: `${label}@${w.A.slug}.test`, password: LOGIN_PW });
      expect(res.status, `login ${label}: ${JSON.stringify(res.body)}`).toBe(200);
      tokens.set(label, dataOf(res.body).accessToken as string);
    }

    const tok = (label: string): string => tokens.get(label)!;
    const uid = (label: string): string => ids.get(label)!;

    /** Ảnh Uploaded + Clean, chủ = `ownerId`, chưa từng gắn. */
    async function seedImage(ownerId: string): Promise<string> {
      const id = randomUUID();
      await w.direct.query(
        `INSERT INTO files (id, company_id, original_name, stored_name, mime_type, file_extension,
                            file_size_bytes, storage_provider, storage_path, upload_status, scan_status,
                            owner_user_id, uploaded_by, uploaded_at)
         VALUES ($1,$2,$3,$4,'image/png','png',2048,'MinIO',$5,'Uploaded','Clean',$6,$6,now())`,
        [
          id,
          w.A.companyId,
          `flp-${id.slice(0, 8)}.png`,
          `stored-${id}`,
          `${w.A.companyId}/files/${id}`,
          ownerId,
        ],
      );
      return id;
    }

    async function seedEmployeeRow(): Promise<string> {
      const r = await w.direct.query<{ id: string }>(
        `INSERT INTO employee_profiles (company_id, user_id, status, employee_code)
         VALUES ($1, NULL, 'active', $2) RETURNING id`,
        [w.A.companyId, `FLP-${randomUUID().slice(0, 8)}`],
      );
      return r.rows[0]!.id;
    }

    async function count(sql: string, params: unknown[]): Promise<number> {
      const r = await w.direct.query<{ n: number }>(sql, params);
      return r.rows[0]!.n;
    }
    const allLinks = (fileId: string) =>
      count(`SELECT count(*)::int AS n FROM file_links WHERE file_id = $1`, [fileId]);
    const liveLinks = (fileId: string) =>
      count(`SELECT count(*)::int AS n FROM file_links WHERE file_id = $1 AND deleted_at IS NULL`, [
        fileId,
      ]);
    const roomMessages = (roomId: string) =>
      count(`SELECT count(*)::int AS n FROM chat_messages WHERE room_id = $1`, [roomId]);
    const roomSeq = async (roomId: string): Promise<number | null> => {
      const r = await w.direct.query<{ s: string | null }>(
        `SELECT last_message_seq::text AS s FROM chat_rooms WHERE id = $1`,
        [roomId],
      );
      return r.rows[0]?.s === null || r.rows[0]?.s === undefined ? null : Number(r.rows[0].s);
    };
    const roomAvatar = async (roomId: string): Promise<string | null> => {
      const r = await w.direct.query<{ v: string | null }>(
        `SELECT avatar_file_id AS v FROM chat_rooms WHERE id = $1`,
        [roomId],
      );
      return r.rows[0]?.v ?? null;
    };
    const empAvatar = async (employeeId: string): Promise<string | null> => {
      const r = await w.direct.query<{ v: string | null }>(
        `SELECT avatar_url AS v FROM employee_profiles WHERE id = $1`,
        [employeeId],
      );
      return r.rows[0]?.v ?? null;
    };

    /** Fixture «đã từng gắn, 0 liên kết sống» — đo trước khi dùng. */
    async function expectRevokedFixture(fileId: string, what: string): Promise<void> {
      expect(await allLinks(fileId), `${what}: fixture phải có ≥ 1 hàng liên kết`).toBeGreaterThan(
        0,
      );
      expect(await liveLinks(fileId), `${what}: fixture phải có 0 liên kết sống`).toBe(0);
    }

    const send = (label: string, roomId: string, payload: Json) =>
      w.post(tok(label), `/chat/rooms/${roomId}/messages`).send(payload);
    const sendFiles = (label: string, roomId: string, fileIds: string[]) =>
      send(label, roomId, { body: "flp", clientMessageId: randomUUID(), fileIds });
    const setRoomAvatar = (label: string, roomId: string, fileId: string) =>
      w.post(tok(label), `/chat/rooms/${roomId}/avatar`).send({ fileId });
    const setEmpAvatar = (employeeId: string, fileId: string) =>
      w.post(tok("hr"), `/hr/employees/${employeeId}/avatar`).send({ fileId });

    function expectOk(res: Res, what: string): void {
      expect(is2xx(res), `${what}: phải 2xx — ${res.status} ${JSON.stringify(res.body)}`).toBe(
        true,
      );
    }

    function expectDenied(res: Res, code: string, what: string): void {
      expect(res.status, `${what}: phải 403 — ${JSON.stringify(res.body)}`).toBe(403);
      expect(JSON.stringify(res.body), `${what}: mang mã ${code}`).toContain(code);
    }

    beforeAll(async () => {
      w = await bootQa1World("flp");
      await makeUser("u", CHAT_PAIRS);
      await makeUser("v", CHAT_PAIRS);
      await makeUser("o", CHAT_PAIRS);
      await makeUser("hr", HR_PAIRS);
      const U = uid("u");

      const a = await w
        .post(tok("u"), "/chat/rooms")
        .send({ name: "flp-A", memberUserIds: [uid("v")] });
      expect(a.status, JSON.stringify(a.body)).toBe(201);
      roomA = dataOf(a.body).id as string;
      const b = await w.post(tok("v"), "/chat/rooms").send({ name: "flp-B", memberUserIds: [U] });
      expect(b.status, JSON.stringify(b.body)).toBe(201);
      roomB = dataOf(b.body).id as string;

      for (const k of ["x", "x2", "b1", "b2", "rec", "new1", "new3", "a2", "a4", "img"]) {
        f[k] = await seedImage(U);
      }

      // x, x2: từng là ảnh phòng A rồi gỡ (thay x bằng x2, rồi gỡ ảnh phòng).
      expectOk(await setRoomAvatar("u", roomA, f.x!), "fixture ảnh phòng x");
      expectOk(await setRoomAvatar("u", roomA, f.x2!), "fixture ảnh phòng x2");
      const del = await w.del(tok("u"), `/chat/rooms/${roomA}/avatar`);
      expect(del.status, JSON.stringify(del.body)).toBe(204);

      // b1, b2: sống ở tin phòng B, rồi U rời B.
      expectOk(await sendFiles("u", roomB, [f.b1!, f.b2!]), "fixture tin phòng B");
      const leave = await w.post(tok("u"), `/chat/rooms/${roomB}/leave`).send({});
      expectOk(leave, "fixture rời phòng B");

      // rec: sống ở tin phòng A đã thu hồi.
      const recMsg = await sendFiles("u", roomA, [f.rec!]);
      expectOk(recMsg, "fixture tin rec");
      const recall = await w.post(tok("u"), `/chat/messages/${dataOf(recMsg.body).id}/recall`);
      expectOk(recall, "fixture thu hồi rec");

      // a2: sống ở tin phòng A (U còn là thành viên).
      expectOk(await sendFiles("u", roomA, [f.a2!]), "fixture tin a2");

      // a4: tin gốc gửi với clientMessageId cố định rồi thu hồi.
      p1a4Payload = { body: "flp-a4", clientMessageId: randomUUID(), fileIds: [f.a4!] };
      const a4 = await send("u", roomA, p1a4Payload);
      expectOk(a4, "fixture tin a4");
      p1a4MessageId = dataOf(a4.body).id as string;
      expectOk(await w.post(tok("u"), `/chat/messages/${p1a4MessageId}/recall`), "thu hồi a4");

      // HR: y từng là ảnh NV1 rồi bị thay bằng z (z đang sống).
      emp1 = await seedEmployeeRow();
      emp2 = await seedEmployeeRow();
      for (const k of ["y", "z", "wnew"]) f[k] = await seedImage(uid("hr"));
      expectOk(await setEmpAvatar(emp1, f.y!), "fixture avatar NV1 = y");
      expectOk(await setEmpAvatar(emp1, f.z!), "fixture avatar NV1 = z");
    }, BOOT_TIMEOUT_MS);

    afterAll(async () => {
      await w?.close();
    });

    // ─── L1 · đính kèm tin CHAT ───────────────────────────────────────────────

    it("P1-D1 tệp của chính người gửi, đã từng gắn, 0 liên kết sống ⇒ 403, không tin mới, seq giữ", async () => {
      await expectRevokedFixture(f.x!, "P1-D1");
      const [links, msgs, seq] = [
        await allLinks(f.x!),
        await roomMessages(roomA),
        await roomSeq(roomA),
      ];
      const res = await sendFiles("u", roomA, [f.x!]);
      expectDenied(res, CHAT_FILE_INVALID, "P1-D1");
      expect(await allLinks(f.x!), "P1-D1: Δ liên kết 0").toBe(links);
      expect(await roomMessages(roomA), "P1-D1: 0 tin mới").toBe(msgs);
      expect(await roomSeq(roomA), "P1-D1: seq phòng giữ").toBe(seq);
    });

    it("P1-D2 tệp sống ở tin phòng người gửi đã rời ⇒ 403, Δ0", async () => {
      expect(await liveLinks(f.b1!), "P1-D2: fixture có liên kết sống").toBeGreaterThan(0);
      const before = await allLinks(f.b1!);
      expectDenied(await sendFiles("u", roomA, [f.b1!]), CHAT_FILE_INVALID, "P1-D2");
      expect(await allLinks(f.b1!)).toBe(before);
    });

    it("P1-D3 lô trộn [tệp mới, tệp đã từng gắn] ⇒ 403, Δ0 cho cả hai tệp (không gửi một phần)", async () => {
      const [n3, nx] = [await allLinks(f.new3!), await allLinks(f.x!)];
      expectDenied(await sendFiles("u", roomA, [f.new3!, f.x!]), CHAT_FILE_INVALID, "P1-D3");
      expect(await allLinks(f.new3!), "P1-D3: tệp mới không được gắn").toBe(n3);
      expect(await allLinks(f.x!)).toBe(nx);
    });

    it("P1-D4 tệp có liên kết sống tới tin đã thu hồi (người gửi không xem được) ⇒ 403, Δ0", async () => {
      expect(await liveLinks(f.rec!), "P1-D4: thu hồi giữ liên kết sống").toBeGreaterThan(0);
      const before = await allLinks(f.rec!);
      expectDenied(await sendFiles("u", roomA, [f.rec!]), CHAT_FILE_INVALID, "P1-D4");
      expect(await allLinks(f.rec!)).toBe(before);
    });

    it("P1-O người ngoài phòng ⇒ lỗi thành viên (404) đứng trước lỗi tệp", async () => {
      const res = await sendFiles("o", roomA, [f.x!]);
      expect(res.status, JSON.stringify(res.body)).toBe(404);
      expect(JSON.stringify(res.body)).toContain("CHAT-ERR-001");
    });

    it("P1-A1 neo ALLOW: tệp mới tải, chưa gắn ⇒ 2xx, +1 liên kết", async () => {
      p1a1Payload = { body: "flp-a1", clientMessageId: randomUUID(), fileIds: [f.new1!] };
      const res = await send("u", roomA, p1a1Payload);
      expectOk(res, "P1-A1");
      expect(await liveLinks(f.new1!)).toBe(1);
    });

    it("P1-A2 neo ALLOW: tệp sống ở tin phòng A, người gửi còn là thành viên ⇒ 2xx, +1", async () => {
      const before = await liveLinks(f.a2!);
      expectOk(await sendFiles("u", roomA, [f.a2!]), "P1-A2");
      expect(await liveLinks(f.a2!)).toBe(before + 1);
    });

    it("P1-A3 gửi lại cùng clientMessageId ⇒ cùng tin, tổng liên kết không đổi", async () => {
      const before = await allLinks(f.new1!);
      const res = await send("u", roomA, p1a1Payload);
      expectOk(res, "P1-A3");
      expect(await allLinks(f.new1!)).toBe(before);
    });

    it("P1-A4 gửi lại cùng clientMessageId của tin đã thu hồi ⇒ trả lại tin cũ (không 403), Δ0", async () => {
      const before = await allLinks(f.a4!);
      const res = await send("u", roomA, p1a4Payload);
      expectOk(res, "P1-A4");
      expect(dataOf(res.body).id, "P1-A4: cùng tin").toBe(p1a4MessageId);
      expect(await allLinks(f.a4!)).toBe(before);
    });

    // ─── L2 · ảnh phòng CHAT ─────────────────────────────────────────────────

    it("P2-D1 ảnh của người đặt, từng là ảnh phòng rồi gỡ ⇒ 403 CHAT-ERR-015, Δ0, cột giữ", async () => {
      await expectRevokedFixture(f.x2!, "P2-D1");
      const [before, col] = [await allLinks(f.x2!), await roomAvatar(roomA)];
      expectDenied(await setRoomAvatar("u", roomA, f.x2!), CHAT_FILE_INVALID, "P2-D1");
      expect(await allLinks(f.x2!)).toBe(before);
      expect(await roomAvatar(roomA), "P2-D1: avatar_file_id giữ").toBe(col);
    });

    it("P2-D2 ảnh sống ở tin phòng người đặt đã rời ⇒ 403, Δ0", async () => {
      const [before, col] = [await allLinks(f.b2!), await roomAvatar(roomA)];
      expectDenied(await setRoomAvatar("u", roomA, f.b2!), CHAT_FILE_INVALID, "P2-D2");
      expect(await allLinks(f.b2!)).toBe(before);
      expect(await roomAvatar(roomA)).toBe(col);
    });

    it("P2-A1/A2 neo ALLOW: ảnh mới ⇒ 2xx; đặt lại đúng ảnh đang dùng ⇒ 2xx; ảnh phòng = 1 liên kết sống", async () => {
      expectOk(await setRoomAvatar("u", roomA, f.img!), "P2-A1");
      expect(await roomAvatar(roomA)).toBe(f.img);
      expect(await liveLinks(f.img!)).toBe(1);
      expectOk(await setRoomAvatar("u", roomA, f.img!), "P2-A2");
      expect(await liveLinks(f.img!)).toBe(1);
    });

    // ─── L3 · ảnh đại diện NV do HR đặt ──────────────────────────────────────

    it("P3-D1 ảnh của HR đang là ảnh sống của NV1, đặt cho NV2 ⇒ 403, Δ0, NV2 giữ, NV1 giữ", async () => {
      expect(await liveLinks(f.z!), "P3-D1: fixture z sống ở NV1").toBe(1);
      const [before, col2] = [await allLinks(f.z!), await empAvatar(emp2)];
      expectDenied(await setEmpAvatar(emp2, f.z!), HR_FILE_FORBIDDEN, "P3-D1");
      expect(await allLinks(f.z!)).toBe(before);
      expect(await empAvatar(emp2), "P3-D1: cột NV2 giữ").toBe(col2);
      expect(await liveLinks(f.z!), "P3-D1: liên kết NV1 còn sống").toBe(1);
    });

    it("P3-D2 ảnh của HR từng là ảnh NV1 rồi bị thay ⇒ 403, Δ0", async () => {
      await expectRevokedFixture(f.y!, "P3-D2");
      const [before, col1] = [await allLinks(f.y!), await empAvatar(emp1)];
      expectDenied(await setEmpAvatar(emp1, f.y!), HR_FILE_FORBIDDEN, "P3-D2");
      expect(await allLinks(f.y!)).toBe(before);
      expect(await empAvatar(emp1)).toBe(col1);
    });

    it("P3-R HR đặt lại đúng ảnh đang là ảnh sống của NV1 ⇒ 403, liên kết cũ giữ sống (D-7)", async () => {
      const before = await allLinks(f.z!);
      expectDenied(await setEmpAvatar(emp1, f.z!), HR_FILE_FORBIDDEN, "P3-R");
      expect(await allLinks(f.z!)).toBe(before);
      expect(await liveLinks(f.z!)).toBe(1);
      expect(await empAvatar(emp1)).toBe(f.z);
    });

    it("P3-A1 neo ALLOW: ảnh mới ⇒ 2xx, liên kết mới sống, liên kết cũ gỡ", async () => {
      expectOk(await setEmpAvatar(emp1, f.wnew!), "P3-A1");
      expect(await liveLinks(f.wnew!)).toBe(1);
      expect(await liveLinks(f.z!), "P3-A1: ảnh cũ bị thay").toBe(0);
      expect(await empAvatar(emp1)).toBe(f.wnew);
    });
  },
);
