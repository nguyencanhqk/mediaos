/**
 * S7-QA-CATALOGFIXTURE-1 — chốt hồi quy cho `seedPermissionCatalog`: fixture KHÔNG được đổi
 * `is_sensitive` của một cặp permission ĐÃ CÓ trong catalog.
 *
 * VÌ SAO PHẢI CHẠY TRÊN DB THẬT, KHÔNG UNIT TEST ĐƯỢC: thứ đang được canh là hành vi của một câu SQL
 * (`ON CONFLICT … DO NOTHING` + đối chiếu) trên một bảng có UNIQUE `(action, resource_type)`. Mock pool
 * sẽ đo bản chép tay của chính bản vá — đúng loại xanh-giả mà WO này sinh ra để chống.
 *
 * BỐI CẢNH (2026-08-03). `permissions` là catalog TOÀN CỤC: không có `company_id` ⇒ `cleanupTenants()`
 * không dọn ⇒ một fixture ghi đè cờ là đóng dấu VĨNH VIỄN lên lane DB. `is_sensitive` là cổng của
 * `getCapabilities()`, nên cái giá không trả ở spec gây ra mà ở spec KHÁC: `chat-be5` khai
 * `update:project = true` (catalog chính tắc: `false`) ⇒ 3 ca `TASKCAP-P*` của
 * `auth-me-capabilities.int.spec.ts` đi ĐỎ. Đỏ đó SỐNG SÓT qua `git stash` — hỏng nằm trong DB, không
 * trong code — nên đã bị đọc nhầm một lần thành "lỗ phân quyền có sẵn trên nhánh".
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────────
 * PHẠM VI CỦA TỪNG CA — đọc trước khi tin "5 ca chốt hồi quy"
 *
 * Chỉ **G1 · G2 · G5** chết khi lật `seedPermissionCatalog` về bản cũ (`DO UPDATE SET is_sensitive =
 * EXCLUDED.is_sensitive`). **G3 và G4 VẪN XANH trên bản cũ** — cố ý: chúng đo tính idempotent và
 * "lối thoát cho cặp riêng còn mở", tức chống một hồi quy KHÁC (bản vá siết quá tay, chặn nhầm cả ca
 * hợp lệ). Ghi ra đây vì "5/5 xanh" rất dễ bị đọc thành "5 ca cùng bắt một bug"; đã đo bằng cách lật
 * ngược bản vá và chạy lại.
 *
 * ĐỌC KỸ ca G1: nó CỐ Ý không pin `update:project = false`. Pin giá trị ở đây là dựng một chỗ thứ hai
 * phải sửa mỗi khi migration đổi cờ (đúng bẫy `canonical-seed-pin-regression`). Ca này đọc giá trị
 * THẬT trong catalog rồi đòi giá trị NGƯỢC LẠI — nên nó đo đúng một thứ: helper có từ chối ghi đè hay
 * không. Việc pin giá trị chính tắc thuộc `auth-seed-canonical-roles.int-spec.ts`.
 */

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { directPool, directUrl, hasDb } from "../helpers/integration-db";
import { seedPermissionCatalog } from "../helpers/seed";

const runIsolatedDb = hasDb && !!process.env.LANE_DB;

/** Cặp SẢN PHẨM dùng làm chuột bạch — đúng cặp của sự cố thật. Giá trị đọc từ DB, KHÔNG pin. */
const VICTIM = { action: "update", resourceType: "project" } as const;

/** Cặp RIÊNG của test — lối thoát mà thông báo lỗi của helper chỉ sang. KHÔNG BAO GIỜ được commit. */
const OWN_SENSITIVE = { action: "view", resourceType: "qacatfix-probe-sensitive" } as const;

/**
 * Chạy `fn` trong MỘT transaction rồi ROLLBACK — cặp probe không bao giờ hiện ra với session khác.
 *
 * ⚠️ ĐỪNG "đơn giản hoá" thành insert-rồi-DELETE-ở-afterAll. Bản đầu của spec này làm đúng thế, kèm
 * lập luận "xoá được vì cặp này không được grant cho role nào" — **lập luận đó SAI**, và FULL gate đã
 * tái hiện được hậu quả:
 *   • `SuperAdminBootstrapService` (`src/permission/super-admin-bootstrap.repository.ts`) grant TOÀN
 *     BỘ catalog hiện có cho role super-admin. Suite chạy song song trên CÙNG lane DB (CI:
 *     `LANE_DB: mediaos`), nên nếu boot rơi vào lúc cặp probe đang tồn tại thì nó ĐƯỢC grant;
 *   • `role_permissions.permission_id` là `ON DELETE CASCADE` (`src/db/schema/permissions.ts`), nên
 *     `DELETE` cặp probe **âm thầm xoá luôn grant đó** ⇒ `super-admin-bootstrap.int-spec.ts` đỏ với
 *     `expected 386 to be 387` — một spec KHÁC, vì một bảng KHÁC. Đúng họ lỗi mà WO này đang vá.
 *   • Ngoài ra `task-permissions-seed.int.spec.ts` và `s7-chat-db1-invariants.int-spec.ts` đều so
 *     `count(*)` trên `permissions`; một hàng nhấp nháy giữa chừng làm chúng đỏ oan (hoặc XANH RỖNG).
 *
 * Không commit ⇒ hết cả ba va chạm, hết cả rác-sót-khi-worker-crash, và không cần cờ "cặp này có phải
 * của mình không". `max: 1` là điều kiện CỨNG: helper chạy 2 câu liên tiếp và cả hai PHẢI đi qua cùng
 * một connection thì mới thấy hàng chưa commit của chính transaction này.
 */
async function withRolledBackTx<T>(fn: (tx: Pool) => Promise<T>): Promise<T> {
  const tx = new Pool({ connectionString: directUrl, max: 1 });
  try {
    await tx.query("BEGIN");
    return await fn(tx);
  } finally {
    // `end()` một mình đã đủ để Postgres huỷ transaction (mất connection ⇒ server rollback), nên
    // ROLLBACK ở đây là để ý đồ hiện rõ, và lỗi của nó KHÔNG được che lỗi thật của `fn`.
    await tx.query("ROLLBACK").catch(() => undefined);
    await tx.end();
  }
}

describe.skipIf(!runIsolatedDb)(
  "S7-QA-CATALOGFIXTURE-1 — seedPermissionCatalog là INSERT-ONLY với is_sensitive (DB cô lập)",
  () => {
    let direct: Pool;
    let victimFlag: boolean;

    beforeAll(async () => {
      direct = directPool();
      const res = await direct.query<{ is_sensitive: boolean }>(
        `SELECT is_sensitive FROM permissions WHERE action = $1 AND resource_type = $2`,
        [VICTIM.action, VICTIM.resourceType],
      );
      expect(
        res.rows.length,
        `cặp (${VICTIM.action}:${VICTIM.resourceType}) phải có sẵn trong catalog sau migration`,
      ).toBe(1);
      victimFlag = res.rows[0].is_sensitive;
    });

    afterAll(async () => {
      await direct.end();
    });

    it("G1 — đòi ĐỔI cờ của cặp đã có ⇒ NÉM, và hàng trong DB KHÔNG đổi", async () => {
      await expect(
        seedPermissionCatalog(direct, VICTIM.action, VICTIM.resourceType, !victimFlag),
      ).rejects.toThrow(/is_sensitive/);

      const after = await direct.query<{ is_sensitive: boolean }>(
        `SELECT is_sensitive FROM permissions WHERE action = $1 AND resource_type = $2`,
        [VICTIM.action, VICTIM.resourceType],
      );
      // Assert này KHÔNG phải thứ bắt bản-cũ (bản cũ không ném ⇒ ca chết ngay ở dòng `rejects` trên).
      // Nó bắt một biến thể KHÁC, tinh vi hơn và rất dễ viết ra: bản vá "ném SAU KHI đã ghi đè" —
      // trông như đã sửa, nhưng lane DB vẫn bẩn y hệt. Phòng thủ sâu, giữ nguyên.
      expect(
        after.rows[0].is_sensitive,
        "helper ném thì cũng TUYỆT ĐỐI không được ghi gì vào catalog",
      ).toBe(victimFlag);
    });

    it("G2 — thông điệp lỗi nêu ĐỦ tên cặp + giá trị catalog + giá trị fixture đòi", async () => {
      // Người đọc log phải sửa được ngay mà không cần mở DB. Đây là điểm khác biệt duy nhất giữa
      // "test đỏ ở đâu đó" và "test đỏ, đây là cặp, đây là hai giá trị, sửa thế này".
      const err = await seedPermissionCatalog(
        direct,
        VICTIM.action,
        VICTIM.resourceType,
        !victimFlag,
      ).then(
        () => null,
        (e: unknown) => e as Error,
      );
      expect(err, "phải ném").not.toBeNull();
      const msg = err!.message;
      expect(msg).toContain(`${VICTIM.action}:${VICTIM.resourceType}`);
      expect(msg).toContain(`is_sensitive = ${victimFlag}`);
      expect(msg).toContain(`is_sensitive = ${!victimFlag}`);
    });

    it("G3 — gọi ĐÚNG giá trị catalog ⇒ đi qua, idempotent, trả cùng một id", async () => {
      const id1 = await seedPermissionCatalog(
        direct,
        VICTIM.action,
        VICTIM.resourceType,
        victimFlag,
      );
      const id2 = await seedPermissionCatalog(
        direct,
        VICTIM.action,
        VICTIM.resourceType,
        victimFlag,
      );
      expect(id1).toBe(id2);
      expect(id1).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("G4 — cặp RIÊNG của test vẫn tạo được với is_sensitive=true (lối thoát còn mở)", async () => {
      await withRolledBackTx(async (tx) => {
        const id = await seedPermissionCatalog(
          tx,
          OWN_SENSITIVE.action,
          OWN_SENSITIVE.resourceType,
          true,
        );
        const res = await tx.query<{ is_sensitive: boolean }>(
          `SELECT is_sensitive FROM permissions WHERE id = $1`,
          [id],
        );
        expect(res.rows[0].is_sensitive).toBe(true);
      });
    });

    it("G5 — luật áp cho MỌI cặp, không riêng cặp sản phẩm: đổi cờ cặp tự chế cũng NÉM", async () => {
      // Ô nhiễm giữa spec-với-spec cũng xảy ra trên cặp do test tự chế (hai spec cùng đặt tên).
      // Nếu chốt chỉ canh "cặp chính tắc" thì lớp này lọt — và nó không hề hiếm hơn.
      await withRolledBackTx(async (tx) => {
        await seedPermissionCatalog(tx, OWN_SENSITIVE.action, OWN_SENSITIVE.resourceType, true);
        await expect(
          seedPermissionCatalog(tx, OWN_SENSITIVE.action, OWN_SENSITIVE.resourceType, false),
        ).rejects.toThrow(/is_sensitive/);
      });
    });

    it("G6 — cặp probe KHÔNG được rò ra ngoài transaction (chốt cho chính withRolledBackTx)", async () => {
      // Nếu rollback hỏng thì G4/G5 âm thầm quay lại làm bẩn catalog toàn cục — đúng thứ vừa gây ra
      // đỏ chéo ở super-admin-bootstrap. Đo bằng một connection KHÁC, sau khi G4/G5 đã chạy.
      const leaked = await direct.query(
        `SELECT 1 FROM permissions WHERE action = $1 AND resource_type = $2`,
        [OWN_SENSITIVE.action, OWN_SENSITIVE.resourceType],
      );
      expect(
        leaked.rows.length,
        "cặp probe của G4/G5 phải bị ROLLBACK, không bao giờ hiện ra với session khác",
      ).toBe(0);
    });
  },
);
