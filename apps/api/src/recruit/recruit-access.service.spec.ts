/**
 * S14-PERF-DASHACTOR-1 — cổng cho `RecruitAccessService.resolveActor` sau khi gộp 4 round-trip scope
 * thành MỘT `resolveManyOrNull`.
 *
 * VÌ SAO cần spec RIÊNG (không dựa vào census 2 tầng): `test/foundation/recruit-two-layer-guard-census.unit-spec.ts`
 * chỉ quét CALL-SITE `resolveActor(expr, "routeKey")` — nó KHÔNG đọc thân hàm. Xoá assert bên trong
 * `resolveActor` vẫn để census XANH. Lưới an toàn còn lại là `recruit-be1-scope.int-spec.ts` (cần
 * LANE_DB) ⇒ ở đây ghim ở tầng unit, chạy trong MỌI lượt `pnpm test`.
 */
import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { DataScope } from "@mediaos/contracts";
import { RecruitAccessService } from "./recruit-access.service";
import type { DataScopeService } from "../permission/data-scope.service";
import type { ScopeRequest } from "../permission/permission.decide";
import type { RecruitRequestUser } from "./recruit.types";

const user: RecruitRequestUser = {
  id: "u1",
  companyId: "co1",
} as unknown as RecruitRequestUser;

/**
 * Stub `DataScopeService` trả kết quả THEO CHỈ SỐ — cùng hợp đồng bản thật. `resolveManyOrNull` là
 * hàm DUY NHẤT `resolveActor` được phép gọi; nếu ai đó thêm lại một `resolveOrNull` lẻ (dựng lại
 * round-trip đã cắt), `resolveAndAssertSpy`/`resolveOrNullSpy` sẽ ghi nhận và ca cuối bắt được.
 */
function stubDataScope(results: (DataScope | null)[]) {
  const resolveManyOrNull = vi.fn(async (_u: string, _c: string, reqs: readonly ScopeRequest[]) => {
    expect(reqs).toHaveLength(results.length);
    return results;
  });
  const resolveOrNull = vi.fn(async () => null);
  const resolveAndAssert = vi.fn(async () => {
    throw new Error("resolveActor phải dùng resolveManyOrNull, không phải resolveAndAssert");
  });
  const svc = { resolveManyOrNull, resolveOrNull, resolveAndAssert } as unknown as DataScopeService;
  return { svc, resolveManyOrNull, resolveOrNull };
}

describe("RecruitAccessService.resolveActor — deny path (RED trước)", () => {
  it("cặp route KHÔNG có grant ⇒ ForbiddenException với ĐÚNG chuỗi mà resolveAndAssert vẫn ném", async () => {
    // `resolveManyOrNull` KHÔNG ném (hợp đồng của nó) ⇒ assert phải nằm trong resolveActor. Mã lỗi
    // này là hợp đồng với FE/QA — đổi chữ = đổi hành vi quan sát được, không phải "chỉ là văn bản".
    const { svc } = stubDataScope([null, null, null, null]);
    const access = new RecruitAccessService(svc);
    await expect(access.resolveActor(user, "candidateList")).rejects.toThrowError(
      "AUTH-ERR-FORBIDDEN: out of permission scope",
    );
    await expect(access.resolveActor(user, "candidateList")).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("có cặp route nhưng scope HẸP hơn sàn Company ⇒ AUTH-ERR-SCOPE-DENIED (sàn chạy SAU cặp)", async () => {
    const { svc } = stubDataScope(["Own", null, null, null]);
    const access = new RecruitAccessService(svc);
    await expect(access.resolveActor(user, "candidateList")).rejects.toThrowError(
      "AUTH-ERR-SCOPE-DENIED: cặp RECRUIT này chỉ hợp lệ ở scope Company",
    );
  });
});

describe("RecruitAccessService.resolveActor — cờ phụ fail-closed (ghim bẫy Map-miss)", () => {
  // ⚠️ Đây là ca chống chính xác cái lỗ đã bị chặn ở plan-review: nếu API batch trả `Map` và caller
  // đọc `.get(...) !== null`, một miss cho `undefined` ⇒ `!== null` là TRUE ⇒ MỞ KHOÁ PII/lương.
  it("phần tử cờ phụ = null ⇒ canSeeCandidatePii=false và canSeeSalary=false", async () => {
    const { svc } = stubDataScope(["Company", null, null, null]);
    const actor = await new RecruitAccessService(svc).resolveActor(user, "candidateList");
    expect(actor.canSeeCandidatePii).toBe(false);
    expect(actor.canSeeSalary).toBe(false);
    expect(actor.interviewViewScope).toBeNull();
  });

  it("ĐỐI CHỨNG — cờ phụ có scope ⇒ hai cờ bật (ca deny trên không xanh-RỖNG)", async () => {
    const { svc } = stubDataScope(["Company", "Own", "Company", "Company"]);
    const actor = await new RecruitAccessService(svc).resolveActor(user, "candidateList");
    expect(actor.canSeeCandidatePii).toBe(true);
    expect(actor.canSeeSalary).toBe(true);
    expect(actor.interviewViewScope).toBe("Own");
    expect(actor.routeScope).toBe("Company");
  });
});

describe("RecruitAccessService.resolveActor — hình dạng request batch", () => {
  it("hỏi ĐÚNG 4 cặp trong MỘT lời gọi, đúng thứ tự, đúng cờ isSensitive per-pair", async () => {
    const { svc, resolveManyOrNull, resolveOrNull } = stubDataScope(["Company", null, null, null]);
    await new RecruitAccessService(svc).resolveActor(user, "candidateList");

    expect(resolveManyOrNull).toHaveBeenCalledTimes(1); // 4 round-trip → 1
    expect(resolveOrNull).toHaveBeenCalledTimes(0); // không còn lời gọi lẻ nào sót lại
    const reqs = resolveManyOrNull.mock.calls[0][2];
    expect(reqs).toEqual([
      // [0] cặp route — cờ đọc từ RECRUIT_ROUTE_PAIRS, không gõ lại literal.
      { action: "view", resourceType: "candidate", isSensitive: true },
      // [1] KHÔNG khai isSensitive — giữ nguyên hành vi resolveOrNull cũ (không truyền opts).
      { action: "view", resourceType: "interview" },
      // [2] TƯỜNG MINH true — thiếu cờ thì wildcard *:* mở khoá PII.
      { action: "update", resourceType: "candidate", isSensitive: true },
      // [3] TƯỜNG MINH false — manage:offer KHÔNG sensitive (REC-DEC-004).
      { action: "manage", resourceType: "offer", isSensitive: false },
    ]);
  });

  it("cặp route và cờ mask PII CÙNG là update:candidate ⇒ vẫn là 2 ô RIÊNG (không gộp khoá)", async () => {
    // routeKey 'candidateUpdate' → cặp ('update','candidate'), trùng ô [2]. Tra theo khoá
    // `action:resourceType` sẽ đè một trong hai; mảng theo chỉ số thì không.
    const { svc, resolveManyOrNull } = stubDataScope(["Company", null, null, null]);
    await new RecruitAccessService(svc).resolveActor(user, "candidateUpdate");
    const reqs = resolveManyOrNull.mock.calls[0][2] as ScopeRequest[];
    expect(reqs).toHaveLength(4);
    expect(reqs[0]).toEqual({ action: "update", resourceType: "candidate", isSensitive: true });
    expect(reqs[2]).toEqual({ action: "update", resourceType: "candidate", isSensitive: true });
  });
});
