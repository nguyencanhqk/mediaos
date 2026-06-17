/**
 * AC-9 db-ops migration status (DB cô lập mediaos_ac9) — READ-ONLY.
 *
 * GET migration status ⇒ đọc drizzle.__drizzle_migrations (global) + đối chiếu _journal.json, trả
 * applied/pending KHÔNG chạy migration. Trên DB lane (chain 0000→0345 đã áp) ⇒ MỌI entry applied.
 */

import "reflect-metadata";
import { afterAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../../src/db/db.service";
import { MigrationStatusService } from "../../src/db-ops/migration-status.service";
import { directPool, hasDb } from "../helpers/integration-db";

describe.skipIf(!hasDb)("AC-9 db-ops migration status (read-only)", () => {
  const direct = directPool();
  const service = new MigrationStatusService(new DatabaseService());

  afterAll(async () => {
    await direct.end();
  });

  it("trả danh sách migration + applied/pending; 0345_ac9_db_ops applied trên DB lane", async () => {
    const status = await service.getStatus();
    expect(status.entries.length).toBeGreaterThan(0);
    expect(status.appliedCount + status.pendingCount).toBe(status.entries.length);

    const ac9 = status.entries.find((e) => e.tag === "0345_ac9_db_ops");
    expect(ac9).toBeDefined();
    expect(ac9?.applied).toBe(true);
    expect(ac9?.appliedAt).not.toBeNull();
  });

  it("entries sắp xếp theo when tăng dần (monotonic)", async () => {
    const status = await service.getStatus();
    for (let i = 1; i < status.entries.length; i++) {
      expect(status.entries[i].when).toBeGreaterThanOrEqual(status.entries[i - 1].when);
    }
  });

  it("KHÔNG chạy migration — chỉ đọc (idempotent: gọi 2 lần ⇒ cùng appliedCount)", async () => {
    const a = await service.getStatus();
    const b = await service.getStatus();
    expect(b.appliedCount).toBe(a.appliedCount);
  });
});
