import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

/**
 * S7-CHAT-DB-1 (mig 0538) — CHỐT HỒI QUY cho nền dữ liệu CHAT v1.
 *
 * VÌ SAO FILE NÀY TỒN TẠI. Migration tự verify bằng khối DO/RAISE EXCEPTION, nhưng verify đó chỉ chạy
 * ĐÚNG MỘT LẦN lúc migrate. Sau khi merge, một WO sau `GRANT UPDATE ON chat_messages TO mediaos_app`
 * cấp bảng, hoặc trả lại `GRANT DELETE` trên `chat_room_members`, hoặc grant cặp đọc-vượt cho
 * company-admin — thì KHÔNG có gì đỏ: `tenant-isolation`/`rls-registry` không phủ column-GRANT,
 * `xtenant-fk-ratchet` chỉ phủ HÌNH DẠNG FK chứ không phủ hành vi 23503.
 * (FULL gate 2026-08-02 H-2; memory `reviewers-pass-real-bugs` + `tests-can-pin-a-hole-open`.)
 *
 * NƠI CHẠY: gate `hasDb`, **KHÔNG** gate `LANE_DB` — mirror `xtenant-fk-ratchet.int-spec.ts`. CI set
 * DATABASE_URL + DATABASE_DIRECT_URL ở cấp job ⇒ file này chạy THẬT trên CI, không nằm trong nhóm
 * ~68 int-spec bị skip (memory `ci-skips-most-integration-specs`).
 *
 * QUY TẮC: mọi ca ÂM assert `err.code`/`err.constraint` ĐÍCH DANH + có ĐỐI CHỨNG DƯƠNG. Assert kiểu
 * "có lỗi là được" sẽ xanh nhờ một constraint KHÁC và không chứng minh gì (bài học vòng plan-review B4:
 * ca "department + sync_source sai" từng xanh nhờ CHECK anchor chứ không phải CHECK sync_source).
 */
describe.skipIf(!hasDb)("S7-CHAT-DB-1 · bất biến nền dữ liệu CHAT (mig 0538)", () => {
  const direct = directPool();
  const app = appPool(2);

  let tenantA: SeededTenant;
  let tenantB: SeededTenant;
  let userA: string;
  /** Dùng cho ca ghi CHÉO tenant ở mục C — phải sống ngoài `beforeAll`. */
  let userB: string;
  let roomA: string;
  let msgA: string;
  let msgB: string;

  /** Chạy `fn` bằng ROLE mediaos_app trong ngữ cảnh tenant, luôn ROLLBACK (không để lại rác). */
  async function asApp<T>(companyId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await app.connect();
    let restored = true;
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.current_company_id', $1, true)", [companyId]);
      return await fn(c);
    } finally {
      try {
        await c.query("ROLLBACK");
      } catch {
        restored = false;
      }
      // release(true) huỷ connection nếu ROLLBACK hỏng — trả connection bẩn về pool là xanh-giả hàng loạt.
      c.release(restored ? undefined : true);
    }
  }

  /** Thử một câu lệnh, trả về mã lỗi Postgres (hoặc null nếu THÀNH CÔNG). */
  async function attempt(
    companyId: string,
    sql: string,
    params: unknown[] = [],
  ): Promise<{ code: string | null; constraint?: string; message?: string }> {
    return asApp(companyId, async (c) => {
      try {
        await c.query(sql, params);
        return { code: null };
      } catch (e) {
        const err = e as { code?: string; constraint?: string; message?: string };
        return { code: err.code ?? "UNKNOWN", constraint: err.constraint, message: err.message };
      }
    });
  }

  beforeAll(async () => {
    tenantA = await seedCompany(direct, "chatA");
    tenantB = await seedCompany(direct, "chatB");
    userA = await seedUser(direct, tenantA.companyId, `chat-a-${tenantA.slug}@x.test`);
    userB = await seedUser(direct, tenantB.companyId, `chat-b-${tenantB.slug}@x.test`);

    const mkRoom = async (companyId: string, code: string) =>
      (
        await direct.query(
          `INSERT INTO chat_rooms (company_id, room_type, sync_source, name, room_code)
           VALUES ($1, 'group', 'manual', $2, $3) RETURNING id`,
          [companyId, `room-${code}`, code],
        )
      ).rows[0].id as string;

    roomA = await mkRoom(tenantA.companyId, "CHKA-0001");
    const roomB = await mkRoom(tenantB.companyId, "CHKB-0001");

    const mkMsg = async (companyId: string, roomId: string, sender: string, body: string) =>
      (
        await direct.query(
          // room_seq NOT NULL từ mig 0539 — cấp qua bộ đếm của phòng, đúng đường ghi thật.
          `INSERT INTO chat_messages (company_id, room_id, sender_id, body, room_seq)
           VALUES ($1, $2, $3, $4,
                   (SELECT COALESCE(max(room_seq), 0) + 1 FROM chat_messages
                     WHERE company_id = $1 AND room_id = $2)) RETURNING id`,
          [companyId, roomId, sender, body],
        )
      ).rows[0].id as string;

    msgA = await mkMsg(tenantA.companyId, roomA, userA, "Báo cáo tuần này đã xong");
    msgB = await mkMsg(tenantB.companyId, roomB, userB, "tin của tenant B");
  }, 60_000);

  afterAll(async () => {
    await cleanupTenants(
      direct,
      [tenantA?.companyId, tenantB?.companyId].filter(Boolean) as string[],
    );
    await direct.end();
    await app.end();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // A. BẤT BIẾN #2 — append-only, ép ở TẦNG DB bằng GRANT (reviewer đọc code service KHÔNG thấy được)
  // ─────────────────────────────────────────────────────────────────────────────
  describe("A. append-only chat_messages (column-level GRANT)", () => {
    it("app role KHÔNG sửa được body — 42501", async () => {
      const r = await attempt(
        tenantA.companyId,
        `UPDATE chat_messages SET body = 'sua trom' WHERE id = $1`,
        [msgA],
      );
      expect(r.code, `kỳ vọng 42501 insufficient_privilege, nhận ${r.code}: ${r.message}`).toBe(
        "42501",
      );
    });

    it("app role KHÔNG xoá được tin nhắn — 42501", async () => {
      const r = await attempt(tenantA.companyId, `DELETE FROM chat_messages WHERE id = $1`, [msgA]);
      expect(r.code).toBe("42501");
    });

    it("app role KHÔNG sửa được attachment_count — 42501 (phải đặt trong câu INSERT)", async () => {
      // Cột này CỐ Ý không có trong GRANT: BE-3 phải set = fileIds.length ngay lúc INSERT.
      // "Cùng transaction" KHÔNG cấp quyền — bản DB-12 01/08 viết sai điều này.
      const r = await attempt(
        tenantA.companyId,
        `UPDATE chat_messages SET attachment_count = 1 WHERE id = $1`,
        [msgA],
      );
      expect(r.code).toBe("42501");
    });

    it("ĐỐI CHỨNG DƯƠNG: app role SỬA ĐƯỢC recalled_at/recalled_by (thu hồi ≠ xoá)", async () => {
      const r = await attempt(
        tenantA.companyId,
        `UPDATE chat_messages SET recalled_at = now(), recalled_by = $2 WHERE id = $1`,
        [msgA, userA],
      );
      expect(r.code, `kỳ vọng thành công, nhận ${r.code}: ${r.message}`).toBeNull();
    });

    it("GRANT trên chat_messages đúng: bảng = SELECT,INSERT · cột UPDATE = đúng 4", async () => {
      const tbl = await direct.query<{ privilege_type: string }>(
        `SELECT privilege_type FROM information_schema.table_privileges
          WHERE grantee = 'mediaos_app' AND table_name = 'chat_messages'`,
      );
      expect(tbl.rows.map((r) => r.privilege_type).sort()).toEqual(["INSERT", "SELECT"]);

      const cols = await direct.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.column_privileges
          WHERE grantee = 'mediaos_app' AND privilege_type = 'UPDATE' AND table_name = 'chat_messages'`,
      );
      expect(cols.rows.map((r) => r.column_name).sort()).toEqual([
        "pinned_at",
        "pinned_by",
        "recalled_at",
        "recalled_by",
      ]);
    });
  });

  describe("B. REVOKE DELETE (0538) — soft delete ép ở tầng DB, không phải kỷ luật service", () => {
    it("app role KHÔNG xoá được chat_room_members (rời phòng = SET left_at)", async () => {
      const r = await attempt(
        tenantA.companyId,
        `DELETE FROM chat_room_members WHERE room_id = $1`,
        [roomA],
      );
      expect(r.code).toBe("42501");
    });

    it("app role KHÔNG xoá được chat_rooms (xoá phòng = soft delete)", async () => {
      // Quan trọng hơn vẻ ngoài: chat_messages.room_id là ON DELETE CASCADE, nên DELETE trên chat_rooms
      // sẽ xoá cứng lịch sử tin nhắn qua RI (chạy quyền owner) DÙ app role không có DELETE trên messages.
      const r = await attempt(tenantA.companyId, `DELETE FROM chat_rooms WHERE id = $1`, [roomA]);
      expect(r.code).toBe("42501");
    });

    it("ĐỐI CHỨNG DƯƠNG: sửa được last_read_seq, KHÔNG sửa được joined_at", async () => {
      await direct.query(
        `INSERT INTO chat_room_members (company_id, room_id, user_id) VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [tenantA.companyId, roomA, userA],
      );
      const ok = await attempt(
        tenantA.companyId,
        `UPDATE chat_room_members SET last_read_seq = 5 WHERE room_id = $1`,
        [roomA],
      );
      expect(ok.code, `last_read_seq phải sửa được, nhận ${ok.code}`).toBeNull();

      const denied = await attempt(
        tenantA.companyId,
        `UPDATE chat_room_members SET joined_at = now() WHERE room_id = $1`,
        [roomA],
      );
      expect(denied.code).toBe("42501");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // C. COMPOSITE TENANT FK — chốt B1 của vòng plan-review (lớp lỗ KI-046)
  // ─────────────────────────────────────────────────────────────────────────────
  describe("C. composite tenant FK chặn ghi chéo tenant", () => {
    it("tin của tenant A KHÔNG trả lời được tin của tenant B — 23503", async () => {
      // Kiểm tra FK của Postgres BỎ QUA RLS theo thiết kế ⇒ FK MỘT CỘT sẽ cho ghi chéo.
      // Đây là ca chứng minh composite FK thật sự có răng, không phải chỉ tồn tại trong pg_constraint.
      let code: string | null = null;
      let constraint: string | undefined;
      try {
        await direct.query(
          // room_seq phải cấp: thiếu thì 23502 (NOT NULL) bắn TRƯỚC khi Postgres kiểm FK ⇒ ca này
          // sẽ "đỏ vì lý do khác" hoặc, nếu assert lỏng, xanh-giả mà không chứng minh composite FK.
          `INSERT INTO chat_messages (company_id, room_id, sender_id, body, reply_to_message_id, room_seq)
           VALUES ($1, $2, $3, 'reply cross-tenant', $4, (SELECT COALESCE(max(room_seq), 0) + 1 FROM chat_messages WHERE company_id = $1 AND room_id = $2))`,
          [tenantA.companyId, roomA, userA, msgB],
        );
      } catch (e) {
        const err = e as { code?: string; constraint?: string };
        code = err.code ?? null;
        constraint = err.constraint;
      }
      expect(code, "ghi chéo tenant qua reply_to_message_id PHẢI bị chặn").toBe("23503");
      expect(constraint).toBe("chat_messages_reply_to_tenant_fk");
    });

    it("ĐỐI CHỨNG DƯƠNG: trả lời tin CÙNG tenant thì được", async () => {
      const r = await direct.query(
        `INSERT INTO chat_messages (company_id, room_id, sender_id, body, reply_to_message_id, room_seq)
         VALUES ($1, $2, $3, 'reply cung tenant', $4, (SELECT COALESCE(max(room_seq), 0) + 1 FROM chat_messages WHERE company_id = $1 AND room_id = $2)) RETURNING id`,
        [tenantA.companyId, roomA, userA, msgA],
      );
      expect(r.rows).toHaveLength(1);
    });

    /**
     * S7-CHAT-CLEAN-2 — ĐO cái mà một comment trong `chat-rooms.repository.ts` từng khẳng định ngược lại.
     *
     * Comment ở `findUsableUserIds` viết rằng FK `chat_room_members.user_id → users.id` là FK MỘT CỘT nên
     * KHÔNG chặn được userId của tenant khác. Điều đó ĐÚNG cho tới `0535` (S6-SEC-XTENANTFK-1), nơi cặp
     * `('chat_room_members','user_id','users')` được composite hoá. Đo trên DB thật:
     *     chat_room_members_user_id_company_fk
     *       FOREIGN KEY (company_id, user_id) REFERENCES users(company_id, id) ON DELETE RESTRICT
     * và CẢ HAI cột đều NOT NULL ⇒ MATCH SIMPLE không có lối lách. Ca này ghim hành vi (23503), để lần sau
     * comment và hiện trạng có chỗ đối chiếu — chứ không phải chỗ này tin chỗ kia (memory
     * `wo-plans-built-on-code-comments` · `grant-in-old-migration-is-not-current-state`).
     */
    it("thành viên của tenant A KHÔNG trỏ được tới user của tenant B — 23503", async () => {
      let code: string | null = null;
      let constraint: string | undefined;
      try {
        await direct.query(
          `INSERT INTO chat_room_members (company_id, room_id, user_id, role)
           VALUES ($1, $2, $3, 'member')`,
          [tenantA.companyId, roomA, userB],
        );
      } catch (e) {
        const err = e as { code?: string; constraint?: string };
        code = err.code ?? null;
        constraint = err.constraint;
      }
      expect(code, "gán user tenant B vào phòng tenant A PHẢI bị chặn ở tầng DB").toBe("23503");
      expect(constraint).toBe("chat_room_members_user_id_company_fk");
    });

    it("ĐỐI CHỨNG DƯƠNG: gán user CÙNG tenant thì được", async () => {
      // Không có ca này thì ca trên xanh kể cả khi INSERT hỏng vì lý do khác (cột thiếu, CHECK role…).
      const r = await direct.query(
        `INSERT INTO chat_room_members (company_id, room_id, user_id, role)
         VALUES ($1, $2, $3, 'member')
         ON CONFLICT (room_id, user_id) DO UPDATE SET left_at = NULL RETURNING id`,
        [tenantA.companyId, roomA, userA],
      );
      expect(r.rows).toHaveLength(1);
    });

    it("6 FK mới đều COMPOSITE 2 cột, và SET NULL chỉ null cột FK (không null company_id)", async () => {
      const fks = await direct.query<{ conname: string; ncols: number; def: string }>(
        `SELECT conname, array_length(conkey, 1) AS ncols, pg_get_constraintdef(oid) AS def
           FROM pg_constraint
          WHERE contype = 'f' AND conname LIKE '%tenant_fk'
            AND conrelid IN ('chat_rooms'::regclass, 'chat_room_members'::regclass, 'chat_messages'::regclass)
          ORDER BY conname`,
      );
      expect(fks.rows.map((r) => r.conname)).toEqual([
        "chat_messages_recalled_by_tenant_fk",
        "chat_messages_reply_to_tenant_fk",
        "chat_room_members_added_by_tenant_fk",
        "chat_rooms_archived_by_tenant_fk",
        "chat_rooms_deleted_by_tenant_fk",
        "chat_rooms_updated_by_tenant_fk",
      ]);
      for (const f of fks.rows) {
        expect(f.ncols, `${f.conname} phải là composite 2 cột`).toBe(2);
        // `SET NULL` TRẦN sẽ null luôn company_id — phải có danh sách cột (ratchet ca (f), 0535:681).
        expect(f.def, `${f.conname} phải SET NULL có danh sách cột`).toMatch(
          /SET NULL \([a-z_]+\)/,
        );
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // D. RÀNG BUỘC HÌNH DẠNG PHÒNG / TIN
  // ─────────────────────────────────────────────────────────────────────────────
  describe("D. CHECK + unique", () => {
    it("gửi lại cùng client_message_id → 23505 (nền DB của CHAT-ERR-014 idempotent)", async () => {
      const cid = "11111111-2222-3333-4444-555555555555";
      const ins = `INSERT INTO chat_messages (company_id, room_id, sender_id, body, client_message_id, room_seq)
                   VALUES ($1, $2, $3, 'idem', $4, (SELECT COALESCE(max(room_seq), 0) + 1 FROM chat_messages WHERE company_id = $1 AND room_id = $2))`;
      const r = await asApp(tenantA.companyId, async (c) => {
        await c.query(ins, [tenantA.companyId, roomA, userA, cid]);
        try {
          await c.query(ins, [tenantA.companyId, roomA, userA, cid]);
          return { code: null as string | null, constraint: undefined as string | undefined };
        } catch (e) {
          const err = e as { code?: string; constraint?: string };
          return { code: err.code ?? null, constraint: err.constraint };
        }
      });
      expect(r.code).toBe("23505");
      expect(r.constraint).toBe("uq_chat_messages_client_id");
    });

    it("room_type='channel' đã khai tử → vi phạm ĐÚNG chat_rooms_room_type_chk", async () => {
      const r = await attempt(
        tenantA.companyId,
        `INSERT INTO chat_rooms (company_id, room_type, sync_source, name, room_code)
         VALUES ($1, 'channel', 'manual', 'x', 'CHK-DEAD')`,
        [tenantA.companyId],
      );
      expect(r.code).toBe("23514");
      // Neo TÊN: 'channel' rơi ngoài cả 4 nhánh anchor nên hai constraint cùng vi phạm — không neo thì
      // ca này xanh nhờ constraint khác và KHÔNG chứng minh 'channel' đã bị loại.
      expect(r.constraint).toBe("chat_rooms_room_type_chk");
    });

    it("phòng department (CÓ org_unit_id) mà sync_source='manual' → ĐÚNG chk_chat_rooms_sync_source", async () => {
      const ou = await direct.query<{ id: string }>(
        `INSERT INTO org_units (company_id, name, code) VALUES ($1, 'OU chat', $2) RETURNING id`,
        [tenantA.companyId, `ouchat-${tenantA.slug}`],
      );
      // CÓ org_unit_id là cố ý: thiếu nó thì lỗi bật ra là chk_chat_rooms_type_anchor ⇒ ca xanh-giả.
      const r = await attempt(
        tenantA.companyId,
        `INSERT INTO chat_rooms (company_id, room_type, sync_source, org_unit_id, name, room_code)
         VALUES ($1, 'department', 'manual', $2, 'phong ban', 'CHK-DEPT')`,
        [tenantA.companyId, ou.rows[0].id],
      );
      expect(r.code).toBe("23514");
      expect(r.constraint).toBe("chk_chat_rooms_sync_source");
    });

    it("room_code là NOT NULL — 23502", async () => {
      const r = await attempt(
        tenantA.companyId,
        `INSERT INTO chat_rooms (company_id, room_type, sync_source, name)
         VALUES ($1, 'group', 'manual', 'thieu ma')`,
        [tenantA.companyId],
      );
      expect(r.code).toBe("23502");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // E. TÌM KIẾM TIẾNG VIỆT
  // ─────────────────────────────────────────────────────────────────────────────
  describe("E. unaccent + search_vector", () => {
    it("f_unaccent bỏ dấu và là IMMUTABLE (bắt buộc cho cột generated)", async () => {
      const v = await direct.query<{ v: string }>(`SELECT public.f_unaccent('Báo cáo tuần') AS v`);
      expect(v.rows[0].v).toBe("Bao cao tuan");

      const p = await direct.query<{ provolatile: string }>(
        `SELECT provolatile FROM pg_proc WHERE proname = 'f_unaccent' AND pronamespace = 'public'::regnamespace`,
      );
      // 'i' = IMMUTABLE. unaccent() gốc chỉ STABLE ⇒ dùng thẳng trong cột generated là migration ĐỎ.
      expect(p.rows[0]?.provolatile).toBe("i");
    });

    it("gõ KHÔNG dấu ra tin CÓ dấu, và truy vấn không liên quan thì KHÔNG khớp", async () => {
      const hit = await direct.query<{ n: string }>(
        `SELECT count(*) AS n FROM chat_messages
          WHERE company_id = $1
            AND search_vector @@ websearch_to_tsquery('simple', public.f_unaccent('bao cao'))`,
        [tenantA.companyId],
      );
      expect(Number(hit.rows[0].n)).toBeGreaterThan(0);

      const miss = await direct.query<{ n: string }>(
        `SELECT count(*) AS n FROM chat_messages
          WHERE company_id = $1
            AND search_vector @@ websearch_to_tsquery('simple', public.f_unaccent('khong he ton tai'))`,
        [tenantA.companyId],
      );
      expect(Number(miss.rows[0].n)).toBe(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // E2. room_seq PER-ROOM (mig 0539) — chốt công thức đếm chưa đọc
  // ─────────────────────────────────────────────────────────────────────────────
  describe("E2. room_seq per-room (mig 0539)", () => {
    it("phép trừ đếm chưa đọc KHÔNG bị tin của phòng khác làm sai", async () => {
      // Kịch bản ĐÃ BẮT ĐƯỢC LỖI: phòng A 1 tin → đọc hết → phòng B 50 tin → phòng A thêm 1 tin.
      // Trên hệ `seq` toàn cục (trước 0539) badge ra 51; đúng phải là 1. Ca này ĐỎ nếu ai đó quay lại
      // dùng `seq` cho phép trừ. Phải có ≥2 phòng — ca 1 phòng không bao giờ bắt được.
      const mk = async (code: string) =>
        (
          await direct.query<{ id: string }>(
            `INSERT INTO chat_rooms (company_id, room_type, sync_source, name, room_code)
             VALUES ($1, 'group', 'manual', $2, $3) RETURNING id`,
            [tenantA.companyId, `rs ${code}`, code],
          )
        ).rows[0].id;

      // Đường ghi THẬT của BE-2: khoá hàng phòng để cấp số rồi INSERT với số đó.
      const send = async (roomId: string) => {
        const b = await direct.query<{ last_message_seq: string }>(
          `UPDATE chat_rooms SET last_message_seq = COALESCE(last_message_seq, 0) + 1
            WHERE id = $1 AND company_id = $2 RETURNING last_message_seq`,
          [roomId, tenantA.companyId],
        );
        const rs = b.rows[0].last_message_seq;
        await direct.query(
          `INSERT INTO chat_messages (company_id, room_id, sender_id, body, room_seq)
           VALUES ($1, $2, $3, 'x', $4)`,
          [tenantA.companyId, roomId, userA, rs],
        );
        return Number(rs);
      };

      const rA = await mk(`RSA-${Date.now() % 100000}`);
      const rB = await mk(`RSB-${Date.now() % 100000}`);
      await send(rA);
      await direct.query(
        `INSERT INTO chat_room_members (company_id, room_id, user_id, last_read_seq)
         VALUES ($1, $2, $3, 1)`,
        [tenantA.companyId, rA, userA],
      );
      for (let i = 0; i < 50; i++) await send(rB);
      await send(rA);

      const row = (
        await direct.query<{ lms: number; lrs: number; n: number }>(
          `SELECT r.last_message_seq::int AS lms, m.last_read_seq::int AS lrs,
                  (SELECT count(*)::int FROM chat_messages x WHERE x.room_id = r.id) AS n
             FROM chat_rooms r JOIN chat_room_members m ON m.room_id = r.id AND m.user_id = $2
            WHERE r.id = $1`,
          [rA, userA],
        )
      ).rows[0];
      expect(row.n, "phòng A phải có đúng 2 tin").toBe(2);
      expect(row.lms - row.lrs, "unread phòng A phải = 1 (hệ seq toàn cục cho 51)").toBe(1);
    });

    it("room_seq liên tục từ 1 trong TỪNG phòng, và trùng số → 23505", async () => {
      // ⚠️ BÓ THEO TENANT CỦA CHÍNH FILE NÀY (S7-CHAT-CLEAN-2). Bản đầu quét TOÀN BẢNG: nó khẳng định
      // `room_seq` liên tục cho MỌI phòng của MỌI tenant đang có trong lane DB — kể cả phòng do spec khác
      // đang chạy SONG SONG gieo, và những spec đó có quyền gieo `room_seq` thưa/lệch cho ca test của
      // riêng chúng. Hỏng theo kiểu tệ nhất: ĐỎ OAN, không tái hiện được khi chạy cô lập, và lối sửa rẻ
      // nhất lúc 2 giờ sáng là XOÁ luôn ca này — mất một bất biến thật (memory
      // `parallel-int-specs-share-one-outbox` · `test-fixture-stamps-global-permission-catalog`).
      const bad = await direct.query<{ room_id: string }>(
        `SELECT room_id FROM chat_messages
          WHERE company_id = ANY($1::uuid[])
          GROUP BY company_id, room_id
         HAVING min(room_seq) <> 1 OR max(room_seq) <> count(*)`,
        [[tenantA.companyId, tenantB.companyId]],
      );
      expect(bad.rows, "room_seq phải liên tục từ 1 trong mỗi phòng").toEqual([]);

      const r = await attempt(
        tenantA.companyId,
        `INSERT INTO chat_messages (company_id, room_id, sender_id, body, room_seq)
         VALUES ($1, $2, $3, 'dup', 1)`,
        [tenantA.companyId, roomA, userA],
      );
      // roomA đã có msgA ở room_seq=1 ⇒ trùng phải bị đai thứ hai chặn, không lặng lẽ trùng số.
      expect(r.code).toBe("23505");
      expect(r.constraint).toBe("uq_chat_messages_room_seq");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // F. SEED QUYỀN — trục CHAT-DEC-004
  // ─────────────────────────────────────────────────────────────────────────────
  describe("F. catalog quyền CHAT + CHAT-DEC-004", () => {
    const CHAT_PAIRS: readonly (readonly [string, string])[] = [
      ["access", "chat"],
      ["view", "chat-room"],
      ["create", "chat-room"],
      ["update", "chat-room"],
      ["archive", "chat-room"],
      ["manage", "chat-member"],
      ["send", "chat-message"],
      ["recall", "chat-message"],
      ["pin", "chat-message"],
    ];

    it("catalog có đủ 9 cặp thường (is_sensitive=false) + cặp đọc-vượt (is_sensitive=TRUE)", async () => {
      for (const [action, resource] of CHAT_PAIRS) {
        const r = await direct.query<{ is_sensitive: boolean }>(
          `SELECT is_sensitive FROM permissions WHERE action = $1 AND resource_type = $2`,
          [action, resource],
        );
        expect(r.rows, `thiếu cặp ${action}:${resource}`).toHaveLength(1);
        expect(r.rows[0].is_sensitive, `${action}:${resource} phải KHÔNG nhạy cảm`).toBe(false);
      }

      const ov = await direct.query<{ is_sensitive: boolean }>(
        `SELECT is_sensitive FROM permissions
          WHERE action = 'view' AND resource_type = 'chat-oversight'`,
      );
      expect(ov.rows, "thiếu cặp đọc-vượt").toHaveLength(1);
      expect(ov.rows[0].is_sensitive, "đọc-vượt PHẢI is_sensitive=true").toBe(true);
    });

    it("9 cặp thường grant đúng 36 hàng ALLOW@Company cho 4 role canonical", async () => {
      const r = await direct.query<{ n: string }>(
        `SELECT count(*) AS n
           FROM role_permissions rp
           JOIN permissions p ON p.id = rp.permission_id
           JOIN roles r ON r.id = rp.role_id
          WHERE p.resource_type IN ('chat', 'chat-room', 'chat-member', 'chat-message')
            AND r.company_id IS NULL AND r.deleted_at IS NULL
            AND rp.effect = 'ALLOW' AND rp.data_scope = 'Company'`,
      );
      expect(Number(r.rows[0].n), "9 cặp × 4 role canonical = 36; lệch = over/under-grant").toBe(
        36,
      );
    });

    it("role giữ TOÀN BỘ catalog-ngoài-CHAT thì PHẢI giữ đủ 10 cặp CHAT (khối F′ mig 0538)", async () => {
      // Trên PROD, role quản trị thật (`SA`, company-scoped, 10 user) giữ toàn bộ catalog nhưng KHÔNG
      // được bootstrap giữ đồng bộ (PLATFORM_SUPERADMIN_* vắng ⇒ no-op) ⇒ mọi cặp MỚI của mọi migration
      // âm thầm không tới nó. Khối (F′) cấp theo LUẬT THUỘC TÍNH, không hard-code tên 'SA'.
      // Ca này pin KẾT QUẢ (bất biến), không pin cơ chế — nên vẫn đúng nếu sau này đổi cách cấp.
      // ⚠️ Tập có thể RỖNG trên DB dựng-từ-rỗng (lane/cài mới) vì role quản trị chưa được dựng — đó là
      // hợp lệ, và console.log dưới đây nói ra để không ai đọc màu xanh này thành "đã phủ".
      const CHAT_RT = "('chat','chat-room','chat-member','chat-message','chat-oversight')";
      const rows = await direct.query<{ name: string; chat_pairs: string }>(
        `SELECT r2.name,
                (SELECT count(DISTINCT rp.permission_id) FROM role_permissions rp
                   JOIN permissions p ON p.id = rp.permission_id
                  WHERE rp.role_id = r2.id AND rp.effect = 'ALLOW'
                    AND p.resource_type IN ${CHAT_RT})::text AS chat_pairs
           FROM roles r2
          WHERE r2.deleted_at IS NULL
            AND (SELECT count(DISTINCT rp.permission_id) FROM role_permissions rp
                   JOIN permissions p ON p.id = rp.permission_id
                  WHERE rp.role_id = r2.id AND rp.effect = 'ALLOW'
                    AND p.resource_type NOT IN ${CHAT_RT})
                = (SELECT count(*) FROM permissions WHERE resource_type NOT IN ${CHAT_RT})`,
      );
      console.log(
        `[s7-chat-db1] role giữ toàn bộ catalog-ngoài-CHAT: ${rows.rows.length} ` +
          `(0 là hợp lệ trên DB dựng-từ-rỗng)`,
      );
      for (const r of rows.rows) {
        expect(Number(r.chat_pairs), `role '${r.name}' giữ toàn catalog nhưng thiếu cặp CHAT`).toBe(
          10,
        );
      }
    });

    it("CHAT-DEC-004: KHÔNG role canonical nào giữ view:chat-oversight", async () => {
      // Chốt HỒI QUY, không phải chốt-một-lần. Verify trong migration chỉ sống lúc migrate; ca này
      // chặn một migration/seed SAU cấp cặp đọc-vượt-mọi-phòng cho company-admin
      // (lớp `blanket-grant-migration-role-drift`).
      const r = await direct.query<{ role: string }>(
        `SELECT r.name AS role
           FROM role_permissions rp
           JOIN permissions p ON p.id = rp.permission_id
           JOIN roles r ON r.id = rp.role_id
          WHERE p.action = 'view' AND p.resource_type = 'chat-oversight'
            AND r.company_id IS NULL AND r.deleted_at IS NULL`,
      );
      expect(
        r.rows.map((x) => x.role),
        "role canonical KHÔNG được giữ cặp đọc-vượt",
      ).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // G. COUNTER + NOTI — hai chỗ "thành công im lặng" đắt nhất
  // ─────────────────────────────────────────────────────────────────────────────
  describe("G. sequence_counter + NOTI catalog", () => {
    it("MỌI counter chat_room đang tồn tại đều ĐÚNG CONTRACT khoá cho BE-1", async () => {
      // Không kiểm "mọi company đều có counter": migration chỉ seed cho company TỒN TẠI LÚC MIGRATE
      // (verify (6) của 0538 lo vế đó). Company tạo SAU migration KHÔNG có counter — và không seeder
      // runtime nào cấp (`sequence_counters` không có trong master-data-seeder.registry). Lỗ này CÓ SẴN,
      // `task` (mig 0498) cũng vậy; bị che vì PROD chỉ 1 company. Ghi nợ ở done_when của S7-CHAT-BE-1.
      //
      // Cái PHẢI pin ở đây là CONTRACT: ON CONFLICT DO NOTHING sẽ giữ nguyên cấu hình CŨ nếu counter đã
      // tồn tại với prefix/padding khác ⇒ mã backfill và mã runtime lệch hình dạng mà không ai báo.
      const bad = await direct.query<{ company_id: string; why: string }>(
        `SELECT sc.company_id,
                sc.scope_type || ' / ' || sc.module_code || ' / ' || sc.reset_policy || ' / ' ||
                coalesce(sc.prefix, '(null)') || ' / ' || sc.padding_length::text || ' / ' || sc.status AS why
           FROM sequence_counters sc
          WHERE sc.sequence_key = 'chat_room' AND sc.deleted_at IS NULL
            AND (sc.scope_type <> 'Company' OR sc.module_code <> 'CHAT' OR sc.reset_policy <> 'Never'
                 OR sc.prefix <> 'ROOM-' OR sc.padding_length <> 4 OR sc.status <> 'Active')`,
      );
      expect(bad.rows, `counter lệch contract: ${JSON.stringify(bad.rows)}`).toEqual([]);

      // ⚠️ TẬP CÓ THỂ RỖNG, và điều đó ĐÚNG — nói ra để không ai đọc màu xanh này thành "đã phủ".
      // `INSERT ... SELECT FROM companies` của 0538 chạy 0 hàng trên DB dựng-từ-rỗng (lane/cài mới),
      // nên verify (6) của migration ("0 company thiếu counter") PASS RỖNG ở đó. Ca này pin HÌNH DẠNG
      // của counter, không pin sự tồn tại — sự tồn tại phụ thuộc thời điểm company được tạo.
      const n = await direct.query<{ n: string }>(
        `SELECT count(*) AS n FROM sequence_counters WHERE sequence_key = 'chat_room' AND deleted_at IS NULL`,
      );
      console.log(
        `[s7-chat-db1] counter chat_room đang có: ${n.rows[0].n} (0 là hợp lệ trên DB dựng-từ-rỗng)`,
      );
    });

    it("counter KHÔNG bao giờ thấp hơn số phòng đã cấp mã (chống 23505 ở phòng kế tiếp)", async () => {
      const bad = await direct.query<{ company_id: string; cur: string; rooms: string }>(
        `SELECT sc.company_id, sc.current_value::text AS cur, count(cr.id)::text AS rooms
           FROM sequence_counters sc
           LEFT JOIN chat_rooms cr ON cr.company_id = sc.company_id AND cr.room_code IS NOT NULL
          WHERE sc.sequence_key = 'chat_room' AND sc.deleted_at IS NULL
          GROUP BY sc.company_id, sc.current_value
         HAVING sc.current_value < count(cr.id)`,
      );
      expect(bad.rows, "current_value < số mã đã cấp ⇒ nextCode sẽ đụng mã cũ").toEqual([]);
    });

    it("2 event NOTI CHAT bật + dedupe_strategy đúng + có template", async () => {
      const ev = await direct.query<{
        event_code: string;
        dedupe_strategy: string;
        templates: string;
      }>(
        `SELECT e.event_code, e.dedupe_strategy,
                (SELECT count(*) FROM notification_templates t
                  WHERE t.event_id = e.id AND t.company_id IS NULL AND t.deleted_at IS NULL)::text AS templates
           FROM notification_events e
          WHERE e.event_code IN ('CHAT_MENTIONED', 'CHAT_DIRECT_MESSAGE')
            AND e.company_id IS NULL AND e.deleted_at IS NULL AND e.is_enabled
          ORDER BY e.event_code`,
      );
      expect(ev.rows.map((r) => r.event_code)).toEqual(["CHAT_DIRECT_MESSAGE", "CHAT_MENTIONED"]);
      // DedupeKey là điều kiện để BE-6 gộp lô 15 phút; để 'None' thì BE-6 phải đẻ migration thứ hai.
      expect(ev.rows[0].dedupe_strategy, "CHAT_DIRECT_MESSAGE phải DedupeKey").toBe("DedupeKey");
      expect(ev.rows[1].dedupe_strategy, "CHAT_MENTIONED gửi ngay ⇒ None").toBe("None");
      for (const r of ev.rows) {
        expect(Number(r.templates), `${r.event_code} phải có template`).toBeGreaterThanOrEqual(1);
      }
    });

    it("CHECK NOTI nới trên CẢ HAI bảng, và `notifications` GIỮ nhánh IS NULL OR", async () => {
      // Quên vế `notifications` = mọi thông báo CHAT vỡ lúc INSERT — lỗi ĐÃ SHIP THẬT với GOAL ở 0507.
      const rows = await direct.query<{ conname: string; def: string }>(
        `SELECT conname, pg_get_constraintdef(oid) AS def
           FROM pg_constraint
          WHERE conname IN ('chk_notification_events_module_code', 'chk_notification_events_type',
                            'chk_notifications_module_code', 'chk_notifications_notification_type')`,
      );
      expect(rows.rows).toHaveLength(4);
      for (const r of rows.rows) {
        const want = r.conname.includes("module_code") ? "'CHAT'" : "'Chat'";
        expect(r.def, `${r.conname} thiếu ${want}`).toContain(want);
        if (r.conname.startsWith("chk_notifications_")) {
          expect(r.def, `${r.conname} phải giữ nhánh IS NULL OR cho hàng legacy`).toContain(
            "IS NULL",
          );
        }
      }
    });

    it("module CHAT tồn tại và CỐ Ý chưa bật (chưa có endpoint/màn hình nào)", async () => {
      const r = await direct.query<{ is_active: boolean }>(
        `SELECT is_active FROM modules WHERE module_code = 'CHAT' AND deleted_at IS NULL`,
      );
      expect(r.rows).toHaveLength(1);
      // Bật module khi backend chưa có gì = hứa suông với người dùng (lớp `ui-promises-backend-never-reads`).
      // Việc bật thuộc WO CUỐI của wave S7-CHAT.
      expect(r.rows[0].is_active).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // G. S7-CHAT-DB-3 (mig 0540) — LEAST-PRIVILEGE: gỡ quyền không ai dùng, chặn CASCADE xoá append-only
  //
  // Ba lỗ mục này pin, tất cả đã ĐO trên lane trước khi vá (docs/plans/S7-CHAT-DB-3.md §0):
  //   L1 `chat_rooms` có UPDATE CẤP BẢNG ⇒ app role sửa được cả company_id/id/room_type — 4 writer thật
  //      chỉ chạm 11/22 cột.
  //   L2 `visible_from_seq` là column-GRANT CHẾT — 0 writer trong src, CHAT-DEC-008 chỉ được gác bằng
  //      một comment.
  //   L3 FK `users` → chat là ON DELETE CASCADE ⇒ hard-delete user XOÁ CỨNG `chat_messages`
  //      (append-only, bất biến #2) qua RI chạy quyền owner — bỏ qua mọi GRANT.
  // ─────────────────────────────────────────────────────────────────────────────
  describe("H. least-privilege bề mặt CHAT (mig 0540)", () => {
    /** Tập cột UPDATE-được, pin THEO TÊN. "count > 0" hay "≤" đều PASS oan khi ai đó cấp thêm cột. */
    const GRANTED_UPDATE_COLUMNS: Record<string, string[]> = {
      chat_messages: ["pinned_at", "pinned_by", "recalled_at", "recalled_by"],
      chat_room_members: ["last_read_at", "last_read_seq", "left_at", "muted_until", "role"],
      chat_rooms: [
        "archived_at",
        "archived_by",
        "deleted_at",
        "deleted_by",
        "description",
        "is_archived",
        "last_message_at",
        "last_message_seq",
        "name",
        "updated_at",
        "updated_by",
      ],
    };

    it("app role KHÔNG sửa được visible_from_seq — CHAT-DEC-008 ép ở tầng DB, không phải bằng comment", async () => {
      const r = await attempt(
        tenantA.companyId,
        `UPDATE chat_room_members SET visible_from_seq = 5 WHERE room_id = $1`,
        [roomA],
      );
      expect(r.code, `kỳ vọng 42501, nhận ${r.code}: ${r.message}`).toBe("42501");
    });

    it("app role KHÔNG sửa được cột định danh/neo của chat_rooms — company_id · org_unit_id · room_type", async () => {
      // company_id là ca NẶNG nhất: UPDATE cấp bảng cho phép chuyển hàng sang tenant khác. RLS `WITH CHECK`
      // có thể chặn, nhưng chặn bằng policy là lớp KHÁC — bất biến #1 đòi quyền ghi không tồn tại ngay từ ACL.
      const moved = await attempt(
        tenantA.companyId,
        `UPDATE chat_rooms SET company_id = $2 WHERE id = $1`,
        [roomA, tenantB.companyId],
      );
      expect(moved.code, `company_id: kỳ vọng 42501, nhận ${moved.code}: ${moved.message}`).toBe(
        "42501",
      );

      const anchor = await attempt(
        tenantA.companyId,
        `UPDATE chat_rooms SET org_unit_id = NULL WHERE id = $1`,
        [roomA],
      );
      expect(anchor.code, `org_unit_id: kỳ vọng 42501, nhận ${anchor.code}`).toBe("42501");

      const kind = await attempt(
        tenantA.companyId,
        `UPDATE chat_rooms SET room_type = 'direct' WHERE id = $1`,
        [roomA],
      );
      expect(kind.code, `room_type: kỳ vọng 42501, nhận ${kind.code}`).toBe("42501");
    });

    it("ĐỐI CHỨNG DƯƠNG: 4 writer thật của chat_rooms VẪN ghi được (revoke không được đẻ cửa sổ 500)", async () => {
      // Mỗi câu dưới đây là đúng tập cột của một writer trong repository — bỏ sót cột nào ở GRANT là
      // 42501 lúc chạy, tức HTTP 500 trên đường ghi đã ship. Đây là lưới duy nhất bắt được việc đó.
      const bump = await attempt(
        tenantA.companyId,
        `UPDATE chat_rooms SET last_message_seq = COALESCE(last_message_seq, 0) + 1, last_message_at = now() WHERE id = $1`,
        [roomA],
      );
      expect(bump.code, `bumpRoomSeq phải ghi được, nhận ${bump.code}: ${bump.message}`).toBeNull();

      const restore = await attempt(
        tenantA.companyId,
        `UPDATE chat_rooms SET deleted_at = NULL, deleted_by = NULL WHERE id = $1`,
        [roomA],
      );
      expect(restore.code, `restoreRoom phải ghi được, nhận ${restore.code}`).toBeNull();

      const update = await attempt(
        tenantA.companyId,
        `UPDATE chat_rooms SET name = 'đổi tên', description = 'mô tả', updated_at = now(), updated_by = $2 WHERE id = $1`,
        [roomA, userA],
      );
      expect(update.code, `updateRoom phải ghi được, nhận ${update.code}`).toBeNull();

      const archive = await attempt(
        tenantA.companyId,
        `UPDATE chat_rooms SET is_archived = true, archived_at = now(), archived_by = $2, updated_at = now() WHERE id = $1`,
        [roomA, userA],
      );
      expect(archive.code, `archiveRoom phải ghi được, nhận ${archive.code}`).toBeNull();
    });

    it("hard-delete user KHÔNG xoá được tin nhắn — 23503, và tin nhắn còn NGUYÊN", async () => {
      // CHẠY BẰNG `direct` (owner), KHÔNG phải asApp: app role vốn đã không có DELETE trên `users`
      // (mig 0467 thu hồi), nên chạy bằng nó chỉ được 42501 — ca sẽ xanh mà chẳng chứng minh gì.
      // Lỗ THẬT nằm ở tầng owner: CASCADE của RI bỏ qua GRANT.
      const victim = await seedUser(
        direct,
        tenantA.companyId,
        `chat-cascade-${tenantA.slug}@x.test`,
      );
      await direct.query(
        `INSERT INTO chat_messages (company_id, room_id, sender_id, body, room_seq)
         VALUES ($1, $2, $3, 'tin của người sắp bị xoá',
                 (SELECT COALESCE(max(room_seq), 0) + 1 FROM chat_messages
                   WHERE company_id = $1 AND room_id = $2))`,
        [tenantA.companyId, roomA, victim],
      );

      let code: string | null = null;
      try {
        await direct.query(`DELETE FROM users WHERE id = $1`, [victim]);
      } catch (e) {
        code = (e as { code?: string }).code ?? "UNKNOWN";
      }
      expect(code, "xoá user còn tin nhắn phải vướng FK RESTRICT (23503)").toBe("23503");

      const left = await direct.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM chat_messages WHERE sender_id = $1`,
        [victim],
      );
      expect(left.rows[0].n, "tin nhắn của user bị xoá phải CÒN NGUYÊN").toBe(1);

      // Dọn theo đúng thứ tự mà cleanupTenants dùng (chat trước, users sau) — nếu không, afterAll đỏ.
      await direct.query(`DELETE FROM chat_messages WHERE sender_id = $1`, [victim]);
      await direct.query(`DELETE FROM users WHERE id = $1`, [victim]);
    });

    it("4 FK users→chat đều RESTRICT (cả một-cột lẫn composite) — lệch một cái là CASCADE vẫn chạy", async () => {
      const rows = await direct.query<{ conname: string; confdeltype: string }>(
        `SELECT con.conname, con.confdeltype
           FROM pg_constraint con
           JOIN pg_class c ON c.oid = con.conrelid
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE con.contype = 'f' AND n.nspname = 'public'
            AND con.confrelid = 'public.users'::regclass
            AND c.relname IN ('chat_messages', 'chat_room_members')
            AND con.conkey @> ARRAY[(
              SELECT attnum FROM pg_attribute
               WHERE attrelid = c.oid
                 AND attname = CASE c.relname WHEN 'chat_messages' THEN 'sender_id' ELSE 'user_id' END
            )]
          ORDER BY con.conname`,
      );
      expect(rows.rows.map((r) => r.conname)).toEqual([
        "chat_messages_sender_id_company_fk",
        "chat_messages_sender_id_fkey",
        "chat_room_members_user_id_company_fk",
        "chat_room_members_user_id_fkey",
      ]);
      for (const r of rows.rows) {
        // 'r' = RESTRICT. 'c' = CASCADE (dạng cũ), 'a' = NO ACTION — NO ACTION hoãn kiểm tới cuối câu
        // lệnh nên vẫn chặn, nhưng ta pin RESTRICT để lệch dạng là đỏ, không im lặng trôi.
        expect(r.confdeltype, `${r.conname} phải ON DELETE RESTRICT`).toBe("r");
      }
    });

    it("tập cột UPDATE-được của 3 bảng chat khớp ĐÚNG pin (không thừa, không thiếu)", async () => {
      for (const [table, expected] of Object.entries(GRANTED_UPDATE_COLUMNS)) {
        // aclexplode(attacl) đọc THẲNG ACL cấp cột — `information_schema.column_privileges` phụ thuộc
        // vai trò hiện tại là grantor/grantee nên có thể trả thiếu tuỳ connection.
        const cols = await direct.query<{ column_name: string }>(
          `SELECT a.attname AS column_name
             FROM pg_class c
             JOIN pg_namespace n ON n.oid = c.relnamespace
             JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
             CROSS JOIN LATERAL aclexplode(a.attacl) acl
            WHERE n.nspname = 'public' AND c.relname = $1
              AND acl.grantee = 'mediaos_app'::regrole AND acl.privilege_type = 'UPDATE'
            ORDER BY 1`,
          [table],
        );
        expect(
          cols.rows.map((r) => r.column_name),
          `column-GRANT UPDATE của ${table}`,
        ).toEqual(expected);

        // Và KHÔNG bảng nào trong ba bảng này còn UPDATE/DELETE cấp BẢNG — column-GRANT chỉ có nghĩa
        // khi vế cấp bảng đã tắt, ngược lại nó chỉ là trang trí.
        const tbl = await direct.query<{ upd: boolean; del: boolean }>(
          `SELECT has_table_privilege('mediaos_app', $1, 'UPDATE') AS upd,
                  has_table_privilege('mediaos_app', $1, 'DELETE') AS del`,
          [`public.${table}`],
        );
        expect(tbl.rows[0].upd, `${table} KHÔNG được có UPDATE cấp bảng`).toBe(false);
        expect(tbl.rows[0].del, `${table} KHÔNG được có DELETE cấp bảng`).toBe(false);
      }
    });

    it("RLS + FORCE còn bật trên cả 3 bảng chat", async () => {
      const rows = await direct.query<{ relname: string; rls: boolean; force: boolean }>(
        `SELECT c.relname, c.relrowsecurity AS rls, c.relforcerowsecurity AS force
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public'
            AND c.relname IN ('chat_messages', 'chat_room_members', 'chat_rooms')
          ORDER BY 1`,
      );
      expect(rows.rows).toHaveLength(3);
      for (const r of rows.rows) {
        expect(r.rls, `${r.relname} phải bật RLS`).toBe(true);
        expect(r.force, `${r.relname} phải FORCE RLS (owner cũng không được vượt)`).toBe(true);
      }
    });

    /**
     * S7-CHAT-CLEAN-2 (mig 0541) — ĐIỂM DANH index của `chat_messages`, cả hai chiều.
     *
     * Khối VERIFY của `0541` chỉ chạy ĐÚNG MỘT LẦN lúc migrate. Hai đường trôi sau đó, cả hai đều IM:
     *  · khai lại `index("chat_messages_room_id_idx")` trong `communication.ts` ⇒ `db:generate` dựng lại
     *    ở migration sau, hai index tiền tố trùng quay về;
     *  · "dọn tiếp theo `idx_scan = 0`" ⇒ gỡ nhầm một UNIQUE (phép kiểm unique lúc INSERT KHÔNG được
     *    đếm vào `idx_scan`) hay gỡ GIN search (bảng test nhỏ nên planner luôn seq-scan).
     * Danh sách dưới đây là HỢP ĐỒNG: sửa một dòng phải có lý do viết kèm, y như sửa SPEC.
     */
    it("index chat_messages: 9 cái phải-giữ còn nguyên, 2 cái tiền-tố-trùng đã gỡ (mig 0541)", async () => {
      const rows = await direct.query<{ indexrelname: string; isunique: boolean }>(
        // ⚠️ Kéo theo `indisunique`: điểm danh bằng TÊN THÔI thì `DROP INDEX uq_x; CREATE INDEX uq_x ON
        // chat_messages(room_id)` lọt cổng — tên còn, ràng buộc duy nhất thì mất. Ca vế-âm 23505 ở mục
        // D/E là đai thứ hai, nhưng đai thứ nhất không nên hở sẵn.
        `SELECT i.indexrelname, x.indisunique AS isunique
           FROM pg_stat_user_indexes i JOIN pg_index x ON x.indexrelid = i.indexrelid
          WHERE i.relname = 'chat_messages' ORDER BY 1`,
      );
      const have = new Set(rows.rows.map((r) => r.indexrelname));
      const unique = new Set(rows.rows.filter((r) => r.isunique).map((r) => r.indexrelname));

      const PHAI_GIU = [
        "chat_messages_company_id_id_uq", // unique đỡ composite tenant FK reply_to (KI-046)
        "chat_messages_pinned_idx",
        "chat_messages_pkey",
        "chat_messages_room_seq_idx", // đường vào theo room_id còn lại sau khi gỡ room_id_idx
        "idx_chat_messages_reply",
        "idx_chat_messages_room_seq", // đường đọc chính + tiền tố RI (company_id, room_id)
        "idx_chat_messages_search", // GIN — idx_scan=0 trên bảng test là BÌNH THƯỜNG
        "uq_chat_messages_client_id", // chống gửi trùng (CHAT-ERR-014)
        "uq_chat_messages_room_seq", // đai thứ hai của room_seq (0539)
      ];
      expect(
        PHAI_GIU.filter((n) => !have.has(n)),
        "index phải-giữ bị gỡ mất",
      ).toEqual([]);

      const DA_GO = ["chat_messages_company_id_idx", "chat_messages_room_id_idx"];
      expect(
        DA_GO.filter((n) => have.has(n)),
        "index tiền-tố-trùng đã quay lại — kiểm `communication.ts` có khai lại không",
      ).toEqual([]);

      // Vế thứ hai của ratchet: 4 cái này phải còn DUY NHẤT, không chỉ còn TÊN. `DROP INDEX uq_x;
      // CREATE INDEX uq_x ON chat_messages(room_id)` giữ nguyên tên nhưng mất ràng buộc — điểm danh
      // theo tên sẽ cho qua, và lỗ chỉ lộ ra khi có hai tin trùng `room_seq` trên PROD.
      expect([...unique].sort(), "tập index UNIQUE của chat_messages").toEqual([
        "chat_messages_company_id_id_uq",
        "chat_messages_pkey",
        "uq_chat_messages_client_id",
        "uq_chat_messages_room_seq",
      ]);
    });
  });
});
