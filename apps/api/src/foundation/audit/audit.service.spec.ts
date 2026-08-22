/**
 * S10-SEC-AUDITLOGROW-2 (KI-072) — unit của tầng chặn TẬP HÀNG ở `AuditQueryService`.
 *
 * HAI nhánh, và nhánh ALLOW KHÔNG phải "cho đủ":
 *
 *   DENY  — `resolveOrNull` trả `null` sau khi guard đã cho qua ⇒ **403 fail-closed** ở CẢ list lẫn
 *           detail. Đây là bất đồng guard↔scope (K1 kill-switch · K2 cửa sổ cache · K3 `data_scope`
 *           không chuẩn hoá được), không phải deny bình thường ⇒ không được im lặng.
 *
 *   ALLOW — vị từ phải dựng trên **`auditLogs.actorUserId`**, KHÔNG phải `auditLogs.companyId`.
 *           `rowScopeSql()` chỉ assert TÊN BẢNG, mà hai cột này **cùng thuộc `audit_logs`** ⇒ nhầm
 *           `idCol` đi LỌT cổng đó và biến vị từ `Own` thành `company_id = <uuid người dùng>` — 0
 *           hàng, HTTP 200, im lặng tuyệt đối. Int-spec A2/A3 cũng bắt được, nhưng chỉ khi có
 *           Postgres; ca này là lớp bắt DUY NHẤT trên máy dev không DB
 *           (`deny-cases-vacuous-without-allow-case` — đếm NHÁNH, không đếm ca).
 */

import "reflect-metadata";
import { ForbiddenException } from "@nestjs/common";
import { getTableName } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { auditLogs } from "../../db/schema";
import { basisOf } from "../../permission/identity-projection";
import type { DataScopeService } from "../../permission/data-scope.service";
import type { DatabaseService } from "../../db/db.service";
import type { AuditMaskerService } from "../../events/audit-masker.service";
import { AuditQueryService } from "./audit.service";
import type { AuditRepository } from "./audit.repository";

const ACTOR = {
  id: "11111111-1111-1111-1111-111111111111",
  companyId: "c0000000-0000-0000-0000-000000000001",
};
const QUERY = { limit: 50, offset: 0 } as never;

/**
 * `withTenant` chạy callback với một `tx` giả. Repo được stub nên `tx` không bao giờ bị dùng thật —
 * cố ý KHÔNG dựng một tx giả "đầy đủ": nó sẽ là một lời hứa mà test không kiểm được.
 */
function makeDb(): DatabaseService {
  return {
    withTenant: vi.fn(async (_companyId: string, fn: (tx: never) => unknown) =>
      fn(undefined as never),
    ),
  } as unknown as DatabaseService;
}

function makeMasker(): AuditMaskerService {
  return { mask: (v: unknown) => v } as unknown as AuditMaskerService;
}

describe("AuditQueryService — KI-072 vị từ chặn TẬP HÀNG (đường COMPANY)", () => {
  describe("DENY — guard cho qua nhưng scope không phân giải được", () => {
    function makeService() {
      const resolveOrNull = vi.fn(async () => null);
      const repo = {
        findManyForActorTx: vi.fn(),
        countForActorTx: vi.fn(),
        findByIdForActorTx: vi.fn(),
      } as unknown as AuditRepository;
      const dataScope = {
        resolveOrNull,
        buildUserScopeConditionOn: vi.fn(),
      } as unknown as DataScopeService;
      const svc = new AuditQueryService(makeDb(), repo, makeMasker(), dataScope);
      return { svc, repo, resolveOrNull };
    }

    it("listCompany ⇒ ForbiddenException, và KHÔNG chạm DB", async () => {
      const { svc, repo } = makeService();
      await expect(svc.listCompany(ACTOR, QUERY)).rejects.toBeInstanceOf(ForbiddenException);
      // Ném TRƯỚC khi chạm DB — nếu truy vấn đã chạy thì vị từ chưa tồn tại lúc nó chạy.
      expect(repo.findManyForActorTx).not.toHaveBeenCalled();
      expect(repo.countForActorTx).not.toHaveBeenCalled();
    });

    it("getCompanyDetail ⇒ ForbiddenException (chiều thứ hai, ca list không chứng minh hộ)", async () => {
      const { svc, repo } = makeService();
      await expect(
        svc.getCompanyDetail(ACTOR, "a0000000-0000-0000-0000-000000000009"),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.findByIdForActorTx).not.toHaveBeenCalled();
    });

    it("resolve ĐÚNG cặp `view:audit-log` với cờ SENSITIVE (không phải cặp danh bạ, không bỏ cờ)", async () => {
      const { svc, resolveOrNull } = makeService();
      await expect(svc.listCompany(ACTOR, QUERY)).rejects.toBeInstanceOf(ForbiddenException);
      // Bỏ `{isSensitive:true}` thì hôm nay vẫn đúng — nhờ DỮ LIỆU (catalog), không nhờ code. Ca này
      // ghim nó vào CODE: lật cờ catalog không được biến route thành wildcard-inheritable.
      expect(resolveOrNull).toHaveBeenCalledWith(ACTOR.id, ACTOR.companyId, "view", "audit-log", {
        isSensitive: true,
      });
    });
  });

  describe("ALLOW — grant dựng trên CỘT NGƯỜI của bảng, không phải cột tenant", () => {
    function makeService() {
      const captured: {
        target?: { idCol: PgColumn; companyIdCol: PgColumn };
        ctx?: { userId: string; companyId: string };
      } = {};
      const dataScope = {
        resolveOrNull: vi.fn(async () => "Own"),
        buildUserScopeConditionOn: vi.fn(
          (
            _scope: unknown,
            ctx: { userId: string; companyId: string },
            target: { idCol: PgColumn; companyIdCol: PgColumn },
          ) => {
            captured.ctx = ctx;
            captured.target = target;
            return sql`true`;
          },
        ),
      } as unknown as DataScopeService;
      const repo = {
        findManyForActorTx: vi.fn(async () => []),
        countForActorTx: vi.fn(async () => 0),
        findByIdForActorTx: vi.fn(async () => undefined),
      } as unknown as AuditRepository;
      const svc = new AuditQueryService(makeDb(), repo, makeMasker(), dataScope);
      return { svc, repo, captured };
    }

    it("vị từ dựng trên `audit_logs.actor_user_id` — nhầm sang `company_id` sẽ đi LỌT `rowScopeSql`", async () => {
      const { svc, captured } = makeService();
      await svc.listCompany(ACTOR, QUERY);
      expect(captured.target).toBeDefined();
      // So bằng CHÍNH object cột (neo ĐỊNH NGHĨA, không neo tên —
      // `index-ratchet-must-pin-definition-not-name`).
      expect(captured.target?.idCol).toBe(auditLogs.actorUserId);
      expect(captured.target?.companyIdCol).toBe(auditLogs.companyId);
      expect(getTableName(captured.target!.idCol.table)).toBe("audit_logs");
    });

    it("`ctx` mang `actor.id` — KHÔNG phải `actor.companyId` (đột biến này lọt nếu chỉ soi `target`)", async () => {
      // ⟲FULL gate: bản đầu của ca ALLOW chỉ bắt tham số THỨ BA (`target`). Đột biến truyền
      // `{ userId: actor.companyId, ... }` biến vị từ `Own` thành `actor_user_id = <uuid company>`
      // ⇒ 0 hàng, HTTP 200, im lặng — CÙNG lớp hỏng mà ca này tồn tại để bắt trên máy không Postgres,
      // chỉ khác tham số. Hai cột đều là `uuid` nên TypeScript không nói gì.
      const { svc, captured } = makeService();
      await svc.listCompany(ACTOR, QUERY);
      expect(captured.ctx?.userId).toBe(ACTOR.id);
      expect(captured.ctx?.companyId).toBe(ACTOR.companyId);
      // Phát biểu chặt hơn "bằng ACTOR.id": hai giá trị phải KHÁC nhau, nếu không ca này xanh cả khi
      // đột biến đúng vì fixture vô tình cho id === companyId.
      expect(captured.ctx?.userId).not.toBe(captured.ctx?.companyId);
    });

    it("CÙNG một grant đi vào cả `findManyForActorTx` VÀ `countForActorTx` (vế `pagination.total`)", async () => {
      const { svc, repo } = makeService();
      await svc.listCompany(ACTOR, QUERY);
      const listGrant = vi.mocked(repo.findManyForActorTx).mock.calls[0][1];
      const countGrant = vi.mocked(repo.countForActorTx).mock.calls[0][1];
      // Đọc `mock.calls` TRƯỚC bất kỳ restore nào (`mockrestore-wipes-mock-calls`).
      expect(basisOf(listGrant)).toBe("scoped-predicate");
      expect(listGrant.table).toBe("audit_logs");
      // Không chỉ "cả hai đều có grant" — phải là CÙNG grant: hai vị từ khác nhau giữa data và count
      // là đúng hình dạng oracle đếm-được mà V3 của KI-072 mô tả.
      expect(countGrant).toBe(listGrant);
    });

    it("`getCompanyDetail` cũng nhận grant `scoped-predicate` của `audit_logs`", async () => {
      const { svc, repo } = makeService();
      await expect(
        svc.getCompanyDetail(ACTOR, "a0000000-0000-0000-0000-000000000009"),
      ).rejects.toThrow(); // 404 — repo stub trả undefined
      const grant = vi.mocked(repo.findByIdForActorTx).mock.calls[0][1];
      expect(basisOf(grant)).toBe("scoped-predicate");
      expect(grant.table).toBe("audit_logs");
    });
  });
});
