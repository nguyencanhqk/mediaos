import "reflect-metadata";
import { ConflictException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { MeCurrentPersonResolver } from "./me-current-person.resolver";
import type { MeActiveEmployeeRow } from "./me.repository";

/**
 * S5-ME-BE-1 — MeCurrentPersonResolver UNIT. ĐẾM active employee → 0/1/>1 (SPEC-09 §12.1/§12.2/§12.4).
 * >1 dùng mock repo (partial-unique DB chặn 2 non-deleted ⇒ không dựng được ở int-spec) — chứng minh
 * resolver KHÔNG tự chọn: ném 409 ME-ERR-DATA-INCONSISTENT + ghi audit object_type='user'.
 *
 * BẤT BIẾN #2 (audit append-only PHẢI persist): audit anomaly đi withTenant RIÊNG (commit trước throw) —
 * unit chứng minh SỰ TÁCH tx (withTenant gọi 2 lần: đọc + ghi audit) + THỨ TỰ (audit.record resolve TRƯỚC
 * khi ConflictException ném). Bằng-chứng persist THẬT (audit_logs còn dòng sau 409) ở int-spec đường-thật.
 */

const ACTOR = { id: "u1", companyId: "c1" };

function emp(id: string): MeActiveEmployeeRow {
  return {
    employeeId: id,
    employeeCode: id,
    fullName: "A",
    departmentName: null,
    positionName: null,
  };
}

function build(rows: MeActiveEmployeeRow[]) {
  // Ghi lại tx object CHO TỪNG withTenant call (mỗi call = tx độc lập) để chứng minh audit KHÔNG dùng cùng
  // tx với query đọc — nếu chung tx thì throw 409 sẽ rollback audit (đúng defect đang sửa).
  const txs: unknown[] = [];
  const withTenant = vi.fn(async (_c: string, fn: (tx: unknown) => unknown) => {
    const tx = { txId: txs.length };
    txs.push(tx);
    return fn(tx);
  });
  const db = { withTenant };
  const repo = { findActiveEmployeesByUserIdTx: vi.fn(async () => rows) };
  const audit = {
    record: vi.fn<(tx: unknown, entry: Record<string, unknown>) => Promise<void>>(
      async () => undefined,
    ),
  };
  const resolver = new MeCurrentPersonResolver(db as never, repo as never, audit as never);
  return { resolver, audit, withTenant };
}

describe("MeCurrentPersonResolver", () => {
  it("0 active → unlinked (KHÔNG throw, KHÔNG audit, 1 withTenant đọc)", async () => {
    const { resolver, audit, withTenant } = build([]);
    const r = await resolver.resolve(ACTOR);
    expect(r).toEqual({ linkStatus: "unlinked", employee: null });
    expect(audit.record).not.toHaveBeenCalled();
    expect(withTenant).toHaveBeenCalledTimes(1); // chỉ tx đọc — không mở tx audit thừa.
  });

  it("1 active → linked + employee link tối thiểu (1 withTenant đọc)", async () => {
    const { resolver, withTenant } = build([emp("e1")]);
    const r = await resolver.resolve(ACTOR);
    expect(r.linkStatus).toBe("linked");
    expect(r.employee?.employeeId).toBe("e1");
    expect(withTenant).toHaveBeenCalledTimes(1);
  });

  it(">1 active → ghi audit ở withTenant RIÊNG (tx tách) RỒI ném 409 (KHÔNG tự chọn, audit persist trước throw)", async () => {
    const { resolver, audit, withTenant } = build([emp("e1"), emp("e2")]);
    await expect(resolver.resolve(ACTOR)).rejects.toBeInstanceOf(ConflictException);

    // TÁCH tx: 2 withTenant call (đọc + audit) — audit KHÔNG chung tx với query ⇒ throw không rollback audit.
    expect(withTenant).toHaveBeenCalledTimes(2);
    expect(audit.record).toHaveBeenCalledTimes(1);

    // audit.record nhận tx của call thứ 2 (audit), KHÁC tx call thứ 1 (đọc) — chứng minh transaction riêng.
    const [auditTx, entry] = audit.record.mock.calls[0];
    const readTx = withTenant.mock.calls[0];
    expect(auditTx).not.toBe(readTx); // khác object tx.
    expect(entry).toMatchObject({
      objectType: "user",
      action: "MeDataInconsistent",
      objectId: "u1",
    });
  });
});
