import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { collectFkPairs, pairKey } from "../foundation/fk-tenant-census";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";
import { RLS_TABLES } from "./rls-registry";

/**
 * G2-5 — LƯỚI AN TOÀN CẢ DỰ ÁN: test 2-tenant đối kháng, data-driven theo rls-registry.
 * Với MỌI bảng RLS đã đăng ký: tenant A không bao giờ thấy hàng của B (và ngược lại); ngoài ngữ cảnh
 * thì 0 row. Chạy lại như regression sau mỗi phase. Postgres thật (CI) — KHÔNG mock (rủi ro ảo tưởng xanh).
 *
 * ⟲ S6-QA-TENANTWRITE-1 (KI-037) — BỔ SUNG VẾ GHI. Trước đợt này cả file có ĐÚNG 3 câu SQL và cả 3 là
 * `SELECT`: ba `it` của mỗi bảng đều là vế ĐỌC ⇒ **vế `WITH CHECK` của policy chưa từng bị chạm ở
 * tầng registry**, trong khi KI-032 (tenant admin ghi được lên role hệ thống toàn cục) chính là lỗ vế
 * GHI. Đo 2026-07-29 (`node scripts/measure-tenant-write-coverage.mjs`): **119/155 bảng KHÔNG có ca
 * deny GHI chéo tenant** ở bất kỳ spec nào.
 *
 * Ràng buộc thiết kế: registry chỉ cho `table` + `idColumn` + `seedRow()` trả 1 id — harness KHÔNG
 * biết schema từng bảng. Nên 3 ca GHI dưới đây viết được CHỈ bằng bấy nhiêu thông tin (xem
 * `docs/plans/S6-QA-TENANTWRITE-1.md` §2).
 */
describe.skipIf(!hasDb)("G2-5 tenant isolation harness", () => {
  const direct = directPool();
  const app = appPool(2);
  let A: SeededTenant;
  let B: SeededTenant;
  /** id hàng seed cho mỗi bảng, theo tenant. */
  const rowsA = new Map<string, string>();
  const rowsB = new Map<string, string>();

  beforeAll(async () => {
    A = await seedCompany(direct, "isoA");
    B = await seedCompany(direct, "isoB");
    for (const tc of RLS_TABLES) {
      rowsA.set(tc.table, await tc.seedRow(direct, A));
      rowsB.set(tc.table, await tc.seedRow(direct, B));
    }
    // Bảng nào có `company_id` — ca W3 (đẩy hàng sang tenant khác) chỉ áp dụng cho nhóm này.
    const cols = await direct.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'company_id'
          AND table_name = ANY($1)`,
      [RLS_TABLES.map((t) => t.table)],
    );
    const withCompany = new Set(cols.rows.map((r) => r.table_name));
    for (const tc of RLS_TABLES) hasCompanyId.set(tc.table, withCompany.has(tc.table));

    const idCols = await direct.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'id' AND table_name = ANY($1)`,
      [RLS_TABLES.map((t) => t.table)],
    );
    const withId = new Set(idCols.rows.map((r) => r.table_name));
    for (const tc of RLS_TABLES) hasIdColumn.set(tc.table, withId.has(tc.table));
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId, B.companyId]);
    await direct.end();
    await app.end();
  });

  async function visibleIds(
    companyId: string,
    table: string,
    idColumn = "id",
  ): Promise<Set<string>> {
    const c: PoolClient = await app.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.current_company_id', $1, true)", [companyId]);
      const r = await c.query(`SELECT ${idColumn} AS id FROM ${table}`);
      await c.query("ROLLBACK");
      return new Set(r.rows.map((x) => x.id as string));
    } catch (e) {
      // Explicit ROLLBACK prevents connection poisoning for the pool
      try {
        await c.query("ROLLBACK");
      } catch {
        /* ignore */
      }
      throw e;
    } finally {
      c.release();
    }
  }

  async function idsNoContext(table: string, idColumn = "id"): Promise<string[]> {
    const c: PoolClient = await app.connect();
    try {
      const r = await c.query(`SELECT ${idColumn} AS id FROM ${table}`);
      return r.rows.map((x) => x.id as string);
    } finally {
      c.release();
    }
  }

  // ── S6-QA-TENANTWRITE-1 — hạ tầng vế GHI ────────────────────────────────────────────────────────

  /**
   * Kết quả một lần thử GHI trong ngữ cảnh tenant. `rowCount` chỉ có nghĩa khi `rejected === false`.
   *
   * VÌ SAO phải phân biệt "0 hàng" với "bị từ chối": hai thứ này chặn bằng CƠ CHẾ KHÁC NHAU —
   * RLS `USING` cho 0 hàng, còn `WITH CHECK`/trigger/thiếu-grant thì ném lỗi. Gộp chúng làm một
   * ("miễn là không ghi được") sẽ khiến một bảng MẤT policy nhưng CÒN grant trông y hệt một bảng
   * được bảo vệ đúng. Ta cần biết mỗi bảng đang được chặn bằng gì.
   */
  interface WriteAttempt {
    rejected: boolean;
    /** Mã lỗi Postgres khi bị từ chối: 42501 = insufficient_privilege · 23514/RLS = new row violates… */
    code?: string;
    /**
     * `error.constraint` của node-postgres — TÊN constraint đã từ chối. Cần cho ca W4: mã 23503 một
     * mình không cho biết FK NÀO nổ, nên không phân biệt được "composite FK chéo tenant đang chạy"
     * với "một FK khác tình cờ chặn".
     */
    constraint?: string;
    message?: string;
    rowCount: number;
  }

  async function attemptWrite(
    companyId: string,
    sql: string,
    params: unknown[],
  ): Promise<WriteAttempt> {
    const c: PoolClient = await app.connect();
    try {
      // `BEGIN` + `set_config` nằm TRONG cùng try với `ROLLBACK` ở finally (FULL gate 2026-07-29):
      // bản đầu để chúng NGOÀI, nên nếu một trong hai ném lỗi thì connection được `release()` với
      // transaction ĐANG MỞ — pool chỉ có 2 connection và được tái dùng, nên mọi ca sau chạy trong tx
      // cũ. `visibleIds()` phía trên đã xử đúng ca này từ trước; hàm này thì chưa.
      try {
        await c.query("BEGIN");
        await c.query("SELECT set_config('app.current_company_id', $1, true)", [companyId]);
        const r = await c.query(sql, params);
        return { rejected: false, rowCount: r.rowCount ?? 0 };
      } catch (e) {
        const err = e as { code?: string; message?: string; constraint?: string };
        return {
          rejected: true,
          code: err.code,
          constraint: err.constraint,
          message: err.message,
          rowCount: 0,
        };
      } finally {
        // LUÔN rollback: ca W3 có thể THÀNH CÔNG (đó là lúc test ĐỎ) — nếu commit thì hàng của A
        // đã bị đẩy sang tenant B thật và mọi ca sau đó trên cùng bảng chạy trên dữ liệu hỏng.
        try {
          await c.query("ROLLBACK");
        } catch {
          /* ignore */
        }
      }
    } finally {
      c.release();
    }
  }

  /** Bảng nào CÓ cột company_id — quyết định ca W3/W0 có áp dụng được không. Đọc 1 lần cho cả suite. */
  const hasCompanyId = new Map<string, boolean>();
  /** Bảng nào có cột `id` — để ca W0 cấp id mới, tránh đụng PK trước khi RLS kịp phán. */
  const hasIdColumn = new Map<string, boolean>();

  /**
   * Phân loại CƠ CHẾ chặn từ thông điệp lỗi.
   *
   * ⚠️ KHÔNG dùng SQLSTATE: Postgres trả **42501 cho CẢ HAI** "permission denied for table" (app role
   * không có grant) lẫn "new row violates row-level security policy" (vế WITH CHECK làm việc). Gộp
   * chúng lại sẽ cho một bức tranh SAI theo hướng lạc quan: một bảng chỉ được che bởi việc THIẾU
   * GRANT sẽ trông như đã có RLS bảo vệ, và ngày ai đó cấp UPDATE thì tuyến phòng thủ duy nhất là
   * WITH CHECK — thứ ta chưa từng có bằng chứng là chạy.
   */
  function classify(r: WriteAttempt): string {
    if (!r.rejected) return `rowCount=${r.rowCount}`;
    const m = (r.message ?? "").toLowerCase();
    if (m.includes("row-level security")) return "RLS-WITH-CHECK";
    if (m.includes("permission denied")) return "no-grant";
    // ⚠️ THỨ TỰ QUAN TRỌNG — `trigger` PHẢI đứng TRƯỚC `CHECK-constraint` (FULL gate 2026-07-29 bắt).
    // `enforce_company_id_immutable` raise bằng ĐÚNG ERRCODE 23514, nên bản đầu (kiểm 23514 trước) đã
    // nuốt hết và biến nhánh `trigger` thành CODE CHẾT: 8 bảng bị dán nhãn "CHECK-constraint" trong khi
    // thực tế được trigger bảo vệ (mạnh hơn mô tả). Đối chiếu catalog cho thấy 8 bảng đó trùng KHÍT với
    // 8 bảng có trigger `enforce_company_id_immutable`. Đây đúng lớp lỗi mà hàm này sinh ra để chống —
    // phân loại theo THÔNG ĐIỆP, không theo mã — rồi lại rơi vào nó ở nhánh kế tiếp.
    if (m.includes("immutable") || r.code === "P0001") return "trigger";
    if (r.code === "23514" || m.includes("check constraint")) return "CHECK-constraint";
    if (r.code === "23505" || m.includes("duplicate key")) return "unique-index";
    if (r.code === "23503") return "FK";
    return `rejected(${r.code ?? "?"})`;
  }

  /**
   * Mốc sàn cho số bảng CHỨNG MINH được `WITH CHECK` chạy (đo 2026-07-29 = 148/153).
   * Hạ mốc này = tuyên bố có chủ đích, phải kèm lý do trong commit. Nâng lên khi phủ thêm.
   *
   * ⟲ S10-SEC-FKCATALOG-1 (KI-055) — HẠ 148 → 147, có chủ đích, đo A/B trên CÙNG một lane
   * (`mediaos_fkcatalog`, 2026-08-25) để không đoán nguyên nhân:
   *   • guard của mig `0547` BẬT  → 147/156 chứng minh được (chưa: +notification_templates,
   *     +seed_items, +dashboard_widget_configs, +dashboard_widget_cache)
   *   • đúng 12 trigger đó DISABLE → 151/156 (bốn bảng trên quay lại "đã chứng minh")
   * ⇒ Nguyên nhân là mig `0547`, KHÔNG phải "policy vừa bị nới".
   *
   * VÌ SAO CHẤP NHẬN. Ca W3 đẩy hàng sang tenant khác bằng `UPDATE company_id = B`. Hàng seed của 4
   * bảng trên trỏ tới hàng CHA thuộc tenant A, nên sau khi đổi chủ, con (B) ≠ cha (A) ⇒ guard lớp G
   * từ chối **TRƯỚC** khi `WITH CHECK` kịp lên tiếng. Đây là **CHE**, không phải MẤT: policy
   * `WITH CHECK` của 4 bảng đó không bị đụng tới, và chúng nay có HAI tuyến (trigger tầng DB + RLS)
   * thay vì một. Khác hẳn nhóm "chưa chứng minh vì thiếu grant" — nhóm đó chỉ an toàn nhờ chưa được
   * cấp quyền, tức tuyến phòng thủ nằm sai tầng.
   *
   * ⚠️ Chỉ hạ ĐÚNG 1 (147 = số đo hiện tại, không cộng biên): tụt thêm nữa vẫn phải ĐỎ và phải điều tra.
   *
   * ⟲ S10-CLEAN-WORKFLOWCLUSTER-2 (KI-082) — HẠ **147 → 133**, có chủ đích. Đo trên lane
   * `mediaos_wfcluster2` (head `0548`, 2026-08-28): 133 bảng chứng minh được WITH CHECK.
   * **147 − 133 = 14 = ĐÚNG số bảng bị DROP** ở mig `0548` (workflow_definitions ·
   * workflow_definition_steps · workflow_instances · workflow_steps · workflow_step_dependencies ·
   * workflow_step_checklist_states · workflow_step_instance_locks · step_transitions · checklists ·
   * checklist_items · approval_requests · approval_steps · approval_rules · defects) — mỗi bảng vốn là
   * một mục registry tự chứng minh được WITH CHECK. Khớp 1–1, KHÔNG có bảng nào "rơi" ngoài dự kiến.
   * ⇒ Đây là MẤT ĐỐI TƯỢNG ĐO, không phải policy bị nới. Vẫn giữ nguyên luật: hạ ĐÚNG số đo, 0 biên.
   */
  const PROVEN_WITH_CHECK_FLOOR = 133;

  /**
   * Mốc sàn cho ca W4 (S6-SEC-XTENANTFK-1): số cặp bị chặn ĐÚNG bằng FK chéo tenant (SQLSTATE 23503).
   *
   * Đo trên lane đã áp mig `0535` (2026-07-31): **449 cặp thử được · 267 bị chặn bằng 23503**. 182 cặp
   * còn lại vẫn BỊ TỪ CHỐI (assert chính phủ chúng) nhưng bằng cơ chế khác (unique-index/CHECK/
   * NOT NULL) nên chúng KHÔNG chứng minh gì về composite FK — đó là lý do phải pin riêng con số 23503
   * thay vì đọc màu xanh của assert chính là "đã phủ 449".
   *
   * ⟲ RE-BASELINE 2026-08-02 (mig `0538`, S7-CHAT-DB-1): **267 → 263**. KHÔNG phải mất hàng rào —
   * 4 cặp bị RÀNG BUỘC MỚI CHE, đo bằng đột biến (drop ràng buộc trong tx rồi rollback ⇒ cả 4 lật về
   * 23503):
   *   · `chat_rooms.created_by` + `.channel_id`  ← `uq_chat_rooms_company_code` (mới) chặn trước, 23505
   *   · `chat_rooms.org_unit_id` + `.ref_id`     ← `chk_chat_rooms_type_anchor` (mới) chặn trước, 23514
   *
   * ⟲ CẬP NHẬT 2026-08-05 (mig `0542`, `S7-CHAT-CLEAN-1`): **`chat_rooms.channel_id` KHÔNG CÒN** — cột
   * đã DROP ở bước contract của expand-contract. Giữ tên nó ở dòng trên vì đó là lý lẽ LỊCH SỬ giải
   * thích vì sao 267→263, không phải mô tả hiện trạng. Số đo sau `0542`: **448 cặp thử · 263 chứng minh
   * bằng 23503** — cặp biến mất vốn nằm trong nhóm "chặn bằng cơ chế khác" (23505) nên **sàn KHÔNG đổi**;
   * đã xác minh bằng lần chạy thật, không chỉ bằng lập luận. Ba cặp còn lại của khối này vẫn đúng.
   * Composite FK của cả 4 vẫn chặn 23503 khi thử bằng danh sách cột tường minh (FULL gate
   * `rls-tenant-isolation-tester` 2026-08-02, mục F-1).
   *
   * ⚠️ ĐỆM CHỈ CÒN 3 (263 vs sàn 260). Thêm một unique/CHECK nữa lên bảng đang được W4 nhân bản là ĐỎ,
   * và lối thoát rẻ nhất lúc đó là HẠ SÀN thay vì điều tra — đừng làm vậy. Cách đúng: W4 phải xáo các
   * cột mang neo unique/CHECK khi nhân bản hàng (sinh lại `room_code`, đặt nhất quán các cột neo của
   * CHECK anchor) để cặp quay về chứng minh bằng 23503.
   *
   * ⟲ S10-CLEAN-WORKFLOWCLUSTER-2 (KI-082) — HẠ **260 → 241**, có chủ đích. Đo trên lane
   * `mediaos_wfcluster2` (head `0548`, 2026-08-28): **412 cặp thử · 241 chứng minh bằng 23503**
   * (trước: 448 · 263). Hai độ lệch khớp nhau và khớp phần bị DROP:
   *   · 448 − 412 = **36 cặp FK biến mất** — cùng con số mà `FK_SINGLE_COL_PAIRS_FLOOR` đo được
   *     (459 → 423), do 14 bảng DROP + 4 cột FK gỡ (`tasks.workflow_step_id` ·
   *     `tasks.workflow_instance_id` · `evaluation_results.workflow_step_id` · `bonus_penalties.defect_id`).
   *   · 263 − 241 = **22** trong 36 cặp đó vốn thuộc nhóm "chứng minh bằng composite FK"; 14 cặp còn
   *     lại vốn nằm ở nhóm "chặn bằng cơ chế khác" nên không rút khỏi con số này.
   * ⇒ MẤT ĐỐI TƯỢNG ĐO, không phải mất hàng rào. Đối chứng: lane `mediaos_wfbase547` (mới tinh, head
   * `0547`, KHÔNG có `0548`) vẫn đo 459 cặp FK — chênh lệch giải thích được trọn vẹn.
   *
   * ⚠️ ĐỆM NAY = 0 (241 vs sàn 241), theo đúng luật của `PROVEN_WITH_CHECK_FLOOR` ở trên: hạ ĐÚNG số
   * đo, không cộng biên. Tụt thêm một cặp là ĐỎ và phải điều tra — **không được hạ sàn lần nữa** trước
   * khi chứng minh được từng cặp biến mất, bằng đo A/B hai lane như lần này.
   *
   * ⟲ S11-ROOM-DB-1 (ROOM-DEC-001) — HẠ **241 → 232**, có chủ đích, đo A/B hai lane 2026-08-29:
   *   · đối chứng `mediaos_roombase551` (head `0551`, KHÔNG có `0552+`): 412 cặp thử · **241** chứng minh.
   *   · `mediaos_roomdb1` (head `0555`): 404 cặp thử · **232** chứng minh.
   *   · 412 − 404 = **8 cặp thử biến mất** = đúng 8 FK một-cột rơi theo `DROP TABLE` ở mig `0553`
   *     (`meetings.meeting_room_id/organizer_id` · `meeting_attendees.meeting_id/user_id` ·
   *     `meeting_notes.meeting_id/author_user_id` · `meeting_tasks.meeting_id/task_id`) — cả 8 vốn được 0535
   *     phủ composite nên đều thuộc nhóm "chứng minh" ⇒ −8. Cùng con số `FK_SINGLE_COL_PAIRS_FLOOR` 423 → 415.
   *   · Cặp thứ **9**: `meeting_rooms.created_by -> users` vẫn còn nhưng ĐỔI NHÓM sang "chặn bởi cơ chế
   *     khác" = `23505/uq_meeting_rooms_company_name_active`: ca W4 chèn BẢN SAO hàng seed (cùng tên phòng)
   *     với FK trỏ sang B, và unique `lower(name)` mới của 0552 nổ TRƯỚC khi FK kịp lên tiếng — cùng lớp
   *     với `teams_company_name_active_uq` / `org_units_company_name_active_uq` đã nằm sẵn trong nhóm đó.
   *     Composite FK `meeting_rooms_created_by_company_fk` (0535) KHÔNG bị đụng (xtenant-fk-ratchet (a) vẫn
   *     xanh). ⇒ MẤT ĐỐI TƯỢNG ĐO (8) + ĐỔI NHÓM VÌ HÀNG RÀO MỚI (1), không phải mất hàng rào. Bằng chứng HÀNH VI
   *     của cặp đổi nhóm (23503 đích danh với tên phòng duy nhất, + đối chứng cùng tenant) chuyển sang
   *     `s11-room-db1-invariants.int-spec.ts` B4 — luật ở :247-250 vẫn đúng: không hạ sàn để "cho qua", mà
   *     giữ chứng minh ở lưới có neo tên riêng. Lưới W4 vẫn nên xáo cột unique khi nhân bản (nợ harness, ngoài WO).
   *   · 2 bảng mới `room_bookings`/`room_booking_attendees` chỉ có composite FK (0 FK một-cột) nên không
   *     sinh cặp thử — không bù được.
   * ⚠️ ĐỆM NAY = 0 (232 vs sàn 232). Tụt thêm một cặp là ĐỎ và phải điều tra bằng đo A/B như trên.
   *
   * Sàn: tụt sâu = composite FK bị gỡ hoặc bộ lọc co lưới. Việc bắt CHÍNH XÁC từng constraint
   * bị gỡ là của `xtenant-fk-ratchet.int-spec.ts` (a) — ca này là lưới thứ hai.
   */
  const W4_FK_BLOCKED_FLOOR = 232;

  /** Cơ chế chặn quan sát được cho từng (bảng, ca) — in ra cuối suite làm tài liệu sống. */
  const blockedBy: { table: string; testCase: string; how: string }[] = [];
  function record(table: string, testCase: string, r: WriteAttempt): void {
    blockedBy.push({ table, testCase, how: classify(r) });
    // Cửa gỡ rối: `GRID_DEBUG_TABLE=goals` in NGUYÊN thông điệp Postgres. Cần khi một ca xanh mà ta
    // chưa giải thích được VÌ SAO — màu xanh không giải thích được là màu xanh không tin được.
    if (process.env.GRID_DEBUG_TABLE === table) {
      console.log(`[grid-debug] ${table} ${testCase} →`, JSON.stringify(r));
    }
  }

  for (const tc of RLS_TABLES) {
    const col = tc.idColumn ?? "id";
    describe(tc.name, () => {
      it.skipIf(tc.skipNoContext)("ngoài ngữ cảnh tenant → 0 row", async () => {
        expect(await idsNoContext(tc.table, col)).toHaveLength(0);
      });

      it("withTenant(A) thấy hàng của A, KHÔNG thấy hàng của B", async () => {
        const seen = await visibleIds(A.companyId, tc.table, col);
        expect(seen.has(rowsA.get(tc.table)!)).toBe(true);
        expect(seen.has(rowsB.get(tc.table)!)).toBe(false);
      });

      it("withTenant(B) thấy hàng của B, KHÔNG thấy hàng của A", async () => {
        const seen = await visibleIds(B.companyId, tc.table, col);
        expect(seen.has(rowsB.get(tc.table)!)).toBe(true);
        expect(seen.has(rowsA.get(tc.table)!)).toBe(false);
      });

      // ── VẾ GHI (S6-QA-TENANTWRITE-1 / KI-037) ──────────────────────────────────────────────────

      // W0 = ca (a) của done_when #2: INSERT hàng mang company_id của B trong ngữ cảnh A.
      //
      // VÌ SAO CẦN W0 KHI ĐÃ CÓ W3: W3 (UPDATE) chỉ chạm được `WITH CHECK` ở những bảng app role CÓ
      // quyền UPDATE. Đo lần đầu: 52/155 bảng chặn W3 chỉ vì THIẾU GRANT — tức `WITH CHECK` của chúng
      // chưa từng được chứng minh là chạy. Bảng append-only thì ngược lại: KHÔNG có UPDATE nhưng CÓ
      // INSERT, nên W0 là đường DUY NHẤT chạm tới vế WITH CHECK của chúng.
      //
      // Dựng hàng GENERIC (harness không biết schema): đọc hàng của A ra jsonb, ghi đè `company_id`
      // thành B (và `id` thành uuid mới để không đụng PK TRƯỚC khi RLS kịp phán), rồi
      // `jsonb_populate_record` dựng lại record đúng kiểu bảng. Nếu vướng ràng buộc khác (FK 23503,
      // unique 23505) thì `classify()` in ra đúng mã đó — vẫn là DENY nhưng KHÔNG bị đếm nhầm thành
      // "RLS-WITH-CHECK", nên số đo không nói dối.
      it("W0 · withTenant(A): INSERT hàng mang company_id của B → PHẢI bị từ chối (WITH CHECK)", async (ctx) => {
        if (!hasCompanyId.get(tc.table)) {
          ctx.skip(`${tc.table} không có cột company_id (N/A)`);
          return;
        }
        const override: Record<string, string> = { company_id: B.companyId };
        const r = await attemptWrite(
          A.companyId,
          `INSERT INTO ${tc.table}
           SELECT (jsonb_populate_record(NULL::${tc.table},
                     to_jsonb(x) || $1::jsonb
                     ${hasIdColumn.get(tc.table) ? `|| jsonb_build_object('id', gen_random_uuid())` : ""}
                   )).*
             FROM ${tc.table} x WHERE x.${col} = $2`,
          [JSON.stringify(override), rowsA.get(tc.table)!],
        );
        record(tc.table, "W0", r);
        expect(
          r.rejected,
          `INSERT ĐƯỢC ${r.rowCount} hàng mang company_id của tenant B vào ${tc.table} từ ngữ cảnh A: ` +
            `vế WITH CHECK KHÔNG chặn. Đây đúng hình dạng KI-032.`,
        ).toBe(true);
      });

      it("W1 · withTenant(A): UPDATE hàng của B → 0 hàng (hoặc bị từ chối)", async () => {
        // `SET <id> = <id>` (gán chính nó) chạy được trên MỌI bảng — harness không biết cột nào khác
        // tồn tại. Nó vẫn đi qua trọn vẹn RLS `USING` của UPDATE, nên đủ để chứng minh vế đó.
        const r = await attemptWrite(
          A.companyId,
          `UPDATE ${tc.table} SET ${col} = ${col} WHERE ${col} = $1`,
          [rowsB.get(tc.table)!],
        );
        record(tc.table, "W1", r);
        expect(
          r.rejected || r.rowCount === 0,
          `UPDATE chạm ${r.rowCount} hàng của tenant B — RLS USING của UPDATE trên ${tc.table} không chặn`,
        ).toBe(true);
      });

      it("W2 · withTenant(A): DELETE hàng của B → 0 hàng (hoặc bị từ chối)", async () => {
        const r = await attemptWrite(A.companyId, `DELETE FROM ${tc.table} WHERE ${col} = $1`, [
          rowsB.get(tc.table)!,
        ]);
        record(tc.table, "W2", r);
        expect(
          r.rejected || r.rowCount === 0,
          `DELETE xoá ${r.rowCount} hàng của tenant B trên ${tc.table} — mất cô lập vế GHI`,
        ).toBe(true);
      });

      // W3 = ca CHÍNH của KI-037: vế `WITH CHECK`. Đây là thứ chưa lưới nào chạm, và là đúng hình
      // dạng của KI-032 (ghi được lên hàng ngoài tenant mình). Bảng không có `company_id` (vd
      // `role_permissions`) thì ca này KHÔNG áp dụng — skip CÓ LÝ DO, không skip im lặng.
      it("W3 · withTenant(A): đẩy hàng CỦA MÌNH sang tenant B → PHẢI bị từ chối (WITH CHECK)", async (ctx) => {
        if (!hasCompanyId.get(tc.table)) {
          ctx.skip(`${tc.table} không có cột company_id ⇒ không đẩy sang tenant khác được (N/A)`);
          return;
        }
        const r = await attemptWrite(
          A.companyId,
          `UPDATE ${tc.table} SET company_id = $1 WHERE ${col} = $2`,
          [B.companyId, rowsA.get(tc.table)!],
        );
        record(tc.table, "W3", r);
        expect(
          r.rejected,
          `GHI ĐƯỢC hàng mang company_id của tenant B trên ${tc.table} (chạm ${r.rowCount} hàng): ` +
            `vế WITH CHECK KHÔNG chặn. Đây đúng hình dạng KI-032.`,
        ).toBe(true);
      });
    });
  }

  // ── Hai ca CẤU TRÚC (không theo bảng) — đến từ FULL gate S6-SEC-ORGSCOPE-1, đo được chứ không đoán ──

  describe("ranh giới GHI không theo bảng", () => {
    it("(a) `mediaos_app` KHÔNG kế thừa quyền của `mediaos_readonly`", async () => {
      // Policy `users_all_tenant_read ON users FOR SELECT TO mediaos_readonly USING (true)` (mig 0346:66)
      // là read TOÀN TENANT sống thật. `mediaos_app` LÀ member của role đó nhưng `WITH INHERIT FALSE`
      // (0346:47) — nên hôm nay vô hại. Nếu ai đó `GRANT mediaos_readonly TO mediaos_app` mà quên
      // `INHERIT FALSE`, mọi đường đọc của app biến thành ĐỌC CHÉO TENANT trong im lặng, và KHÔNG ca
      // nào trong lưới theo-bảng ở trên bắt được (chúng chạy đúng dưới app role, sẽ cùng bị mù).
      const r = await direct.query<{ member: boolean; usage: boolean }>(
        `SELECT pg_has_role('mediaos_app','mediaos_readonly','MEMBER') AS member,
                pg_has_role('mediaos_app','mediaos_readonly','USAGE')  AS usage`,
      );
      expect(r.rows[0].usage, "mediaos_app kế thừa được mediaos_readonly ⇒ đọc chéo tenant").toBe(
        false,
      );
    });

    it("(b) KHÔNG chèn được `team_members` trỏ sang `team` của tenant khác", async () => {
      // FULL gate S6-SEC-ORGSCOPE-1 đo được: FK enforcement BỎ QUA RLS theo thiết kế Postgres, nên
      // thiếu composite FK (company_id, team_id) thì app role trong ngữ cảnh A gắn được thành viên
      // vào team của B (`INSERT 0 1`). Đường ĐỌC an toàn nhờ innerJoin, nhưng đây là liên kết chéo
      // tenant TỒN TẠI THẬT trong dữ liệu + `ON DELETE CASCADE` bắc cầu sang tenant khác.
      const teamB = await direct.query<{ id: string }>(
        `INSERT INTO teams (company_id, name, type) VALUES ($1, $2, 'production_team') RETURNING id`,
        [B.companyId, `xt-team-${Date.now()}`],
      );
      const userA = await seedUser(direct, A.companyId, `xtfk-${Date.now()}@a.test`);
      const r = await attemptWrite(
        A.companyId,
        `INSERT INTO team_members (company_id, team_id, user_id, role_name) VALUES ($1, $2, $3, 'member')`,
        [A.companyId, teamB.rows[0].id, userA],
      );
      expect(
        r.rejected,
        `Chèn được ${r.rowCount} hàng team_members của tenant A trỏ tới team của tenant B — ` +
          `thiếu composite FK (company_id, team_id) → teams(company_id, id)`,
      ).toBe(true);
    });

    it("(c) KHÔNG chèn được `team_members` trỏ sang `user` của tenant khác", async () => {
      // CHÂN THỨ HAI của CÙNG endpoint. Ca (b) một mình sẽ XANH VĨNH VIỄN trong khi chân này mở —
      // đúng bẫy memory `tests-can-pin-a-hole-open`. Cả security-reviewer lẫn rls-tenant-isolation-tester
      // chỉ ĐỘC LẬP vào đây khi gate PR này, và tái lập được trên lane ĐÃ vá chân `team_id`:
      //   ctx=A → INSERT (company_id=A, team_id=<team CỦA A>, user_id=<user của B>) ⇒ `INSERT 0 1`
      // `OrgService.addTeamMember` truyền thẳng `dto.userId` xuống repo, không kiểm tenant.
      const teamA = await direct.query<{ id: string }>(
        `INSERT INTO teams (company_id, name, type) VALUES ($1, $2, 'production_team') RETURNING id`,
        [A.companyId, `xtfk-own-${Date.now()}`],
      );
      const userB = await seedUser(direct, B.companyId, `xtfk-u-${Date.now()}@b.test`);
      const r = await attemptWrite(
        A.companyId,
        `INSERT INTO team_members (company_id, team_id, user_id, role_name) VALUES ($1, $2, $3, 'member')`,
        [A.companyId, teamA.rows[0].id, userB],
      );
      expect(
        r.rejected,
        `Chèn được ${r.rowCount} hàng team_members của tenant A trỏ tới USER của tenant B — ` +
          `thiếu composite FK (company_id, user_id) → users(company_id, id). ` +
          `Tác hại: users_id_fkey ON DELETE CASCADE ⇒ xoá user ở B xoá hàng mang company_id = A.`,
      ).toBe(true);
    });

    /**
     * W4 (S6-SEC-XTENANTFK-1 / KI-046) — DATA-DRIVEN thay cho hai ca (b)/(c) viết tay ở trên.
     *
     * VÌ SAO. (b)/(c) chỉ phủ `team_members`. Đo được cùng lúc: **457 cặp FK một-cột** cùng hình dạng
     * nằm nguyên — tức lưới cũ sẽ XANH VĨNH VIỄN trong khi 456 cặp còn hở (đúng bẫy memory
     * `tests-can-pin-a-hole-open`). Ca này lấy danh sách cặp THẲNG TỪ CATALOG rồi thử từng cặp, nên
     * bảng mới thêm ngày mai cũng tự nằm trong lưới mà không ai phải nhớ viết thêm `it`.
     *
     * Dựng hàng bằng đúng máy móc `jsonb_populate_record` của W0 (harness không biết schema từng
     * bảng): lấy hàng của A, ghi đè CỘT FK = id hàng của **B**, cấp `id` mới, INSERT trong ngữ cảnh A.
     *
     * ⚠️ CHỐNG XANH-GIẢ. Một INSERT bị chặn bởi unique-index/CHECK vẫn "rejected" nhưng KHÔNG chứng
     * minh gì về FK chéo tenant. Vì vậy ngoài "phải bị từ chối", ca này còn PIN số cặp bị chặn ĐÚNG
     * bằng FK (SQLSTATE 23503) — bộ lọc sai làm danh sách co về rỗng sẽ ĐỎ, không im lặng xanh.
     */
    it("W4 · data-driven: KHÔNG cặp FK nào cho phép trỏ sang bản ghi của tenant khác", async () => {
      const registry = new Map(RLS_TABLES.map((t) => [t.table, t]));
      const pairs = (await collectFkPairs(direct)).filter(
        (p) =>
          p.targetTenantOnly &&
          registry.has(p.srcTable) &&
          registry.has(p.tgtTable) &&
          // rowsB chỉ giữ giá trị của `idColumn`; FK luôn trỏ tới `id`, nên bảng đích dùng idColumn
          // khác thì id ta có trong tay KHÔNG phải thứ FK cần → bỏ qua, có lý do.
          (registry.get(p.tgtTable)!.idColumn ?? "id") === "id" &&
          hasIdColumn.get(p.srcTable) === true &&
          hasCompanyId.get(p.srcTable) === true,
      );

      const leaked: string[] = [];
      /** Cặp bị chặn ĐÚNG bởi composite FK của chính nó — bằng chứng duy nhất đáng tính. */
      const provenByCompositeFk: string[] = [];
      /** Cặp "rejected" nhưng bởi cơ chế KHÁC ⇒ KHÔNG chứng minh gì về composite FK. */
      const blockedByOther: string[] = [];
      for (const p of pairs) {
        const targetIdOfB = rowsB.get(p.tgtTable);
        const ownRowOfA = rowsA.get(p.srcTable);
        if (!targetIdOfB || !ownRowOfA) continue;
        const srcCase = registry.get(p.srcTable)!;
        const r = await attemptWrite(
          A.companyId,
          `INSERT INTO ${p.srcTable}
           SELECT (jsonb_populate_record(NULL::${p.srcTable},
                     to_jsonb(x) || $1::jsonb || jsonb_build_object('id', gen_random_uuid())
                   )).*
             FROM ${p.srcTable} x WHERE x.${srcCase.idColumn ?? "id"} = $2`,
          [JSON.stringify({ [p.srcColumn]: targetIdOfB }), ownRowOfA],
        );
        if (!r.rejected) {
          leaked.push(`${pairKey(p)} (${r.rowCount} hàng)`);
          continue;
        }
        // 23503 MỘT MÌNH chưa đủ: phải đúng constraint COMPOSITE của cặp này. Một 23503 từ FK khác
        // (hoặc từ FK một-cột cũ) vẫn là "rejected" nhưng không chứng minh composite FK đang chạy.
        if (r.code === "23503" && r.constraint && r.constraint === p.coveringConstraint) {
          provenByCompositeFk.push(pairKey(p));
        } else {
          blockedByOther.push(
            `${pairKey(p)}=${r.code ?? "?"}${r.constraint ? `/${r.constraint}` : ""}`,
          );
        }
      }

      expect(
        leaked,
        `GHI ĐƯỢC hàng của tenant A trỏ sang bản ghi của tenant B. Kiểm tra FK của Postgres BỎ QUA ` +
          `RLS ⇒ thiếu composite FK (company_id, <cột>) là lỗ KI-046. Vá bằng migration mới.`,
      ).toEqual([]);

      // Tài liệu sống: cặp nào "bị từ chối" mà KHÔNG phải nhờ composite FK. Với chúng, màu xanh của
      // assert trên KHÔNG chứng minh gì về KI-046 — in ra để không ai đọc nhầm độ phủ.
      console.log(
        `[W4] ${pairs.length} cặp thử · ${provenByCompositeFk.length} CHỨNG MINH bằng composite FK · ` +
          `${blockedByOther.length} bị chặn bởi cơ chế khác (chưa chứng minh):\n  ` +
          blockedByOther.sort().join(" · "),
      );

      expect(
        provenByCompositeFk.length,
        `Chỉ ${provenByCompositeFk.length}/${pairs.length} cặp bị chặn ĐÚNG bởi composite FK của chính ` +
          `nó (23503 + khớp tên constraint). Số này tụt = hoặc composite FK bị gỡ, hoặc bộ lọc phía ` +
          `trên vừa co lưới lại — cả hai đều phải điều tra, không được đọc màu xanh của assert trên ` +
          `là "đã phủ ${pairs.length} cặp".`,
      ).toBeGreaterThanOrEqual(W4_FK_BLOCKED_FLOOR);
    });

    it("PIN: số bảng đã CHỨNG MINH WITH CHECK không được tụt", () => {
      // Không có `expect` thì "148/153" chỉ là một dòng console.log — nó KHÔNG BAO GIỜ đỏ được khi
      // tụt (FULL gate 2026-07-29 bắt đúng điểm này). Pin để một policy bị nới trong tương lai làm
      // ĐỎ, thay vì lặng lẽ rơi khỏi bản tóm tắt.
      const proven = new Set(
        blockedBy.filter((b) => b.how === "RLS-WITH-CHECK").map((b) => b.table),
      );
      expect(
        proven.size,
        `Số bảng chứng minh được WITH CHECK tụt xuống ${proven.size}. Nếu là CHỦ ĐÍCH (bỏ bảng khỏi ` +
          `registry, đổi grant) thì hạ mốc kèm lý do; nếu KHÔNG thì có policy vừa bị nới.`,
      ).toBeGreaterThanOrEqual(PROVEN_WITH_CHECK_FLOOR);
    });
  });

  // Tài liệu sống: mỗi bảng được chặn BẰNG CƠ CHẾ GÌ. Không phải khẳng định — là số đo, để lần sau
  // ai đó thấy một bảng đổi từ `rejected(42501)` sang `rowCount=0` thì biết grant vừa đổi.
  afterAll(() => {
    if (blockedBy.length === 0) return;
    const byHow = new Map<string, number>();
    for (const b of blockedBy) {
      const k = `${b.testCase}:${b.how}`;
      byHow.set(k, (byHow.get(k) ?? 0) + 1);
    }
    // Kết luận có ích nhất KHÔNG phải "bao nhiêu bảng bị chặn" (tất cả đều bị chặn — nếu không thì
    // test đã ĐỎ), mà là **bảng nào chưa CHỨNG MINH được `WITH CHECK` của nó chạy**. Một bảng chỉ
    // được che bởi việc thiếu grant vẫn an toàn HÔM NAY, nhưng tuyến phòng thủ của nó nằm sai tầng:
    // ngày một migration cấp INSERT/UPDATE cho tính năng mới, WITH CHECK là thứ duy nhất còn lại.
    const proven = new Set(blockedBy.filter((b) => b.how === "RLS-WITH-CHECK").map((b) => b.table));
    const applicable = RLS_TABLES.filter((t) => hasCompanyId.get(t.table)).map((t) => t.table);
    const unproven = applicable.filter((t) => !proven.has(t));
    console.log(
      `[tenant-write-grid] ${RLS_TABLES.length} bảng · cơ chế chặn quan sát được:\n` +
        [...byHow.entries()]
          .sort()
          .map(([k, v]) => `  ${k} × ${v}`)
          .join("\n") +
        `\n[tenant-write-grid] WITH CHECK ĐÃ CHỨNG MINH (W0 hoặc W3): ${proven.size}/${applicable.length}` +
        `\n[tenant-write-grid] CHƯA chứng minh được (${unproven.length}): ${unproven.join(", ") || "(không có)"}` +
        // W3 bị CHE bởi cơ chế khác (unique/FK/trigger/thiếu grant) — nghĩa là với những bảng này,
        // W3 xanh KHÔNG chứng minh gì về WITH CHECK. Liệt kê ra để không ai đọc nhầm màu xanh.
        `\n[tenant-write-grid] W3 bị CHE bởi cơ chế khác (W3 xanh ≠ WITH CHECK chạy): ` +
        blockedBy
          .filter((b) => b.testCase === "W3" && b.how !== "RLS-WITH-CHECK")
          .map((b) => `${b.table}=${b.how}`)
          .sort()
          .join(" · "),
    );
  });
});
