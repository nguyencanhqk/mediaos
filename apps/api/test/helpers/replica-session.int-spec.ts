import type { PoolClient } from "pg";
import { describe, expect, it } from "vitest";
import { directPool, hasDb } from "./integration-db";
import { withReplicaSession } from "./replica-session";

/**
 * `withReplicaSession` — chốt bất biến «connection ĐÃ TỪNG ở `replica` không bao giờ được tái dùng»
 * (`S18-QA-CHECKALLFLAKE-1`).
 *
 * VÌ SAO CẦN SPEC RIÊNG. Helper này tắt mọi trigger thường + FK cho một phiên. Nếu connection đó quay
 * lại pool còn ở `replica`, mọi spec mượn sau chạy trên một DB mất lưới và KHÔNG ca nào đỏ — hỏng im
 * lặng, không cổng nào khác nhìn thấy. Đo 10/10/2026 trên bản «đặt lại DEFAULT rồi trả về pool»:
 * P1 · P2 · P5 đỏ (callback để transaction mở ⇒ người mượn kế tiếp `ROLLBACK` xong đọc ra `replica`).
 *
 * Mỗi ca dùng pool RIÊNG và chỉ tạo đúng một connection ⇒ «người mượn sau» chắc chắn nhận lại
 * connection vừa trả, nếu nó còn nằm trong pool.
 */
describe.skipIf(!hasDb)(
  "withReplicaSession — connection từng ở replica KHÔNG quay lại pool",
  () => {
    interface Seen {
      roleInside: string;
      roleOfNextBorrower: string;
      nextBorrowerGotSameBackend: boolean;
      poolTotalAfter: number;
    }

    async function observe(
      body: (c: PoolClient) => Promise<unknown>,
      expectThrow: string | null,
    ): Promise<Seen> {
      const pool = directPool();
      try {
        let pidInside = -1;
        let roleInside = "";
        const run = withReplicaSession(pool, async (c) => {
          pidInside = (await c.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]
            .pid;
          roleInside = (
            await c.query<{ session_replication_role: string }>("SHOW session_replication_role")
          ).rows[0].session_replication_role;
          return body(c);
        });
        if (expectThrow) await expect(run).rejects.toThrow(expectThrow);
        else await run;
        const poolTotalAfter = pool.totalCount;

        // «Người mượn sau» làm đúng việc mọi spec vẫn làm khi gặp lỗi: ROLLBACK. Nếu connection cũ còn
        // trong pool kèm một transaction mở, chính câu này hoàn tác lệnh đặt lại và đưa phiên về `replica`.
        const next = await pool.connect();
        try {
          await next.query("ROLLBACK");
          const pid = (await next.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]
            .pid;
          const role = (
            await next.query<{ session_replication_role: string }>("SHOW session_replication_role")
          ).rows[0].session_replication_role;
          return {
            roleInside,
            roleOfNextBorrower: role,
            nextBorrowerGotSameBackend: pid === pidInside,
            poolTotalAfter,
          };
        } finally {
          next.release(true);
        }
      } finally {
        await pool.end();
      }
    }

    it("P0 ĐỐI CHỨNG DƯƠNG: trong callback phiên THỰC SỰ ở replica", async () => {
      const seen = await observe(async () => undefined, null);
      expect(seen.roleInside).toBe("replica");
    });

    it("P1 callback để transaction MỞ rồi NÉM (expect đỏ / TypeError) ⇒ người mượn sau vẫn ở origin", async () => {
      const seen = await observe(async (c) => {
        await c.query("BEGIN");
        throw new Error("replica-open-tx-throw");
      }, "replica-open-tx-throw");
      expect(
        seen.roleOfNextBorrower,
        `người mượn sau rơi vào replica · ${JSON.stringify(seen)}`,
      ).toBe("origin");
    });

    it("P2 callback để transaction MỞ rồi TRẢ VỀ (quên COMMIT) ⇒ người mượn sau vẫn ở origin", async () => {
      const seen = await observe(async (c) => {
        await c.query("BEGIN");
      }, null);
      expect(
        seen.roleOfNextBorrower,
        `người mượn sau rơi vào replica · ${JSON.stringify(seen)}`,
      ).toBe("origin");
    });

    it("P3 đối chứng: callback MỘT câu autocommit (dạng của mọi nơi gọi tính tới 10/10/2026)", async () => {
      const seen = await observe(async (c) => {
        await c.query("SELECT 1");
      }, null);
      expect(seen.roleOfNextBorrower, JSON.stringify(seen)).toBe("origin");
    });

    it("P4 đối chứng: transaction đã ABORT (lỗi SQL sau BEGIN)", async () => {
      const seen = await observe(async (c) => {
        await c.query("BEGIN");
        await c.query("SELECT 1/0");
      }, "division by zero");
      expect(seen.roleOfNextBorrower, JSON.stringify(seen)).toBe("origin");
    });

    it("P5 QUY TẮC DƯƠNG: connection từng ở replica KHÔNG nằm lại trong pool", async () => {
      const seen = await observe(async (c) => {
        await c.query("SELECT 1");
      }, null);
      expect(
        { poolTotalAfter: seen.poolTotalAfter, sameBackend: seen.nextBorrowerGotSameBackend },
        `connection từng ở replica được tái dùng · ${JSON.stringify(seen)}`,
      ).toEqual({ poolTotalAfter: 0, sameBackend: false });
    });
  },
);
