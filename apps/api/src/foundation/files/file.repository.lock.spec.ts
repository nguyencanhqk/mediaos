/**
 * S19-SEC-FILELINKGATE-1 — `findByIdForUpdateTx` phải khoá hàng tệp (`SELECT … FOR UPDATE`).
 *
 * Spec dịch vụ (files.service.link-gate.spec.ts) chỉ ghim việc tx ghi của `link()` GỌI hàm khoá trước khi đọc lại
 * ảnh chụp liên kết; nó mock repository nên không thấy mệnh đề khoá. Ca này ghim chính chuỗi truy vấn: bỏ
 * `.for("update")` thì hai lời gắn đồng thời trên cùng tệp lại có thể cùng đọc một ảnh chụp cũ.
 */
import { describe, expect, it, vi } from "vitest";
import type { TenantTx } from "../../db/db.service";
import { FileRepository } from "./file.repository";

const COMPANY = "00000000-0000-4000-8000-000000000001";
const FILE = "00000000-0000-4000-8000-000000000002";

function chainTx(rows: unknown[]) {
  const forFn = vi.fn(async (_strength: string) => rows);
  const limit = vi.fn((_n: number) => ({ for: forFn }));
  const where = vi.fn((_cond: unknown) => ({ limit }));
  const from = vi.fn((_table: unknown) => ({ where }));
  const select = vi.fn(() => ({ from }));
  return { tx: { select } as unknown as TenantTx, forFn, limit };
}

describe("FileRepository.findByIdForUpdateTx", () => {
  it("khoá hàng bằng FOR UPDATE và trả đúng hàng đầu", async () => {
    const row = { id: FILE, companyId: COMPANY };
    const { tx, forFn, limit } = chainTx([row]);

    const got = await new FileRepository().findByIdForUpdateTx(COMPANY, FILE, tx);

    expect(limit, "đọc đúng một hàng").toHaveBeenCalledWith(1);
    expect(forFn, "phải khoá hàng tệp tới hết tx ghi").toHaveBeenCalledTimes(1);
    expect(forFn).toHaveBeenCalledWith("update");
    expect(got).toBe(row);
  });

  it("không có hàng ⇒ undefined", async () => {
    const { tx } = chainTx([]);
    await expect(
      new FileRepository().findByIdForUpdateTx(COMPANY, FILE, tx),
    ).resolves.toBeUndefined();
  });
});
