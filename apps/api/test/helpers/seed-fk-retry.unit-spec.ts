import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { deleteWithFkRetry } from "./seed";

/**
 * Cổng cho vòng thử lại FK của teardown (`deleteWithFkRetry`).
 *
 * Vì sao là UNIT test chứ không phải int-spec: lỗi thật là một cuộc ĐUA giữa teardown và
 * `DeadLetterAlertMonitor.checkThresholds()` chạy trên worker của spec song song. Nó chỉ nổ dưới tải
 * (chunk 40 file) và KHÔNG tái hiện được theo yêu cầu — chạy riêng spec nạn nhân xanh 1/1, chạy chung 3
 * spec dead-letter xanh 3/3. Một bài test "chạy lại cho tới khi đỏ" sẽ là bài test flaky đi pin một lỗi
 * flaky. Thay vào đó pin ĐỊNH NGHĨA của bản vá: *mỗi lượt thử lại phải dọn ĐỦ tập bảng con được giao*.
 * Đó mới là tính chất làm vòng lặp hội tụ; số lần đua bao nhiêu là chuyện của lịch chạy.
 */

/** Pool giả: ghi lại mọi câu SQL, cho phép ép câu xoá CHA hỏng đúng N lượt đầu. */
function fakePool(failParentTimes: number, code = "23503") {
  const sqls: string[] = [];
  let parentAttempts = 0;
  const query = vi.fn(async (sql: string) => {
    sqls.push(sql);
    if (sql.includes("DELETE FROM companies")) {
      parentAttempts += 1;
      if (parentAttempts <= failParentTimes) {
        throw Object.assign(new Error("violates foreign key constraint"), { code });
      }
    }
    return { rows: [] };
  });
  return { pool: { query } as unknown as Pool, sqls, query };
}

const IDS = [["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"]];
const PARENT = "DELETE FROM companies WHERE id = ANY($1::uuid[])";

describe("deleteWithFkRetry — mỗi lượt thử lại phải dọn ĐỦ tập bảng con", () => {
  it("đua 1 lượt: lượt thử lại quét LẠI CẢ audit_logs VÀ dead_letter_alerts trước khi xoá companies", async () => {
    const { pool, sqls } = fakePool(1);

    await deleteWithFkRetry(pool, IDS, PARENT, ["audit_logs", "dead_letter_alerts"]);

    // Đây là nhánh từng hỏng: bản cũ hard-code quét lại mỗi `audit_logs`, nên hàng `dead_letter_alerts`
    // do monitor xuyên-tenant chèn vào giữa chừng KHÔNG bao giờ được gỡ ⇒ 5 lượt đều vô ích rồi ném.
    const parentIdx = sqls.lastIndexOf(PARENT);
    const before = sqls.slice(0, parentIdx);
    expect(before.filter((s) => s.includes("DELETE FROM dead_letter_alerts"))).toHaveLength(2);
    expect(before.filter((s) => s.includes("DELETE FROM audit_logs"))).toHaveLength(2);
  });

  it("thứ tự trong MỘT lượt: dọn hết bảng con RỒI mới xoá cha (không xen kẽ)", async () => {
    const { pool, sqls } = fakePool(0);

    await deleteWithFkRetry(pool, IDS, PARENT, ["audit_logs", "dead_letter_alerts"]);

    expect(sqls).toEqual([
      "DELETE FROM audit_logs WHERE company_id = ANY($1::uuid[])",
      "DELETE FROM dead_letter_alerts WHERE company_id = ANY($1::uuid[])",
      PARENT,
    ]);
  });

  it("mặc định vẫn là ['audit_logs'] — call site `users` không bị đổi hành vi", async () => {
    const { pool, sqls } = fakePool(0);

    await deleteWithFkRetry(pool, IDS, "DELETE FROM users WHERE company_id = ANY($1::uuid[])");

    expect(sqls.filter((s) => s.includes("DELETE FROM audit_logs"))).toHaveLength(1);
    expect(sqls.some((s) => s.includes("dead_letter_alerts"))).toBe(false);
  });

  it("40P01 (deadlock) cũng đi chung vòng thử lại — cùng HỌ lỗi tạm thời", async () => {
    const { pool, sqls } = fakePool(1, "40P01");

    await deleteWithFkRetry(pool, IDS, PARENT, ["audit_logs", "dead_letter_alerts"]);

    expect(sqls.filter((s) => s === PARENT)).toHaveLength(2);
  });

  it("ĐỎ THẬT không bị nuốt: mã lỗi ngoài {23503,40P01} ném NGAY, không thử lại", async () => {
    const { pool, sqls } = fakePool(1, "42P01"); // undefined_table = hỏng thật, không phải đua

    await expect(deleteWithFkRetry(pool, IDS, PARENT, ["audit_logs"])).rejects.toThrow(
      /foreign key/,
    );
    expect(sqls.filter((s) => s === PARENT)).toHaveLength(1);
  });

  it("đua DAI DẲNG vẫn có trần: ném sau 5 lượt thay vì quay vô hạn", async () => {
    const { pool, sqls } = fakePool(Number.POSITIVE_INFINITY);

    await expect(deleteWithFkRetry(pool, IDS, PARENT, ["audit_logs"])).rejects.toThrow(
      /foreign key/,
    );
    expect(sqls.filter((s) => s === PARENT)).toHaveLength(5);
  });
});
