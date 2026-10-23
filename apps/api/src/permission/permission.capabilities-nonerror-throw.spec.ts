/**
 * S14-SEC-CAPWILDCARD-1 — nhánh `catch` của `getCapabilities` / `getCapabilityScopes` (trả `{}`) và
 * `onError` của ảnh chụp catalog cặp KHÔNG được ném khi lỗi gốc KHÔNG phải `Error`.
 *
 * Vì sao: các nhánh đó gọi `serializeErrorChain` + đọc stack để log. Nếu bộ log ném (vd.
 * `String(Object.create(null))` → TypeError, getter `stack` ném) thì `/auth/me` nhận một promise bị từ chối
 * thay vì `{}` — đúng đường suy biến an toàn lại hỏng vì chính dòng chẩn đoán của nó.
 */
import { Logger } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionService } from "./permission.service";
import { CapabilityStubRepo, grant, pair } from "../../test/helpers/capability-stub-repo";

const U = "11111111-1111-4111-8111-111111111111";
const CO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errorSpy = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function stackThrowingError(): Error {
  const error = new Error("stack getter hostile");
  Object.defineProperty(error, "stack", {
    configurable: true,
    get() {
      throw new Error("stack getter boom");
    },
  });
  return error;
}

function cyclicError(): Error {
  const error = new Error("cyclic");
  error.cause = error;
  return error;
}

const HOSTILE_FAILURES: ReadonlyArray<readonly [string, () => unknown]> = [
  ["throw chuỗi", () => "pool exhausted"],
  ["throw Object.create(null)", () => Object.create(null)],
  [
    "Error có cause = Object.create(null)",
    () => new Error("outer", { cause: Object.create(null) }),
  ],
  ["Error có getter stack ném", stackThrowingError],
  ["Error có cause vòng", cyclicError],
];

describe("S14-SEC-CAPWILDCARD-1 — lỗi grant không phải Error ⇒ {} (không ném)", () => {
  for (const [label, makeFailure] of HOSTILE_FAILURES) {
    it(`${label} ⇒ getCapabilities và getCapabilityScopes trả {} + logger.error`, async () => {
      const repo = new CapabilityStubRepo().withCatalog([pair("view", "user", false)]);
      const failure = makeFailure();
      vi.spyOn(repo, "getCompanyRoleGrants").mockRejectedValue(failure);
      vi.spyOn(repo, "getCompanyRoleGrantsWithScope").mockRejectedValue(failure);
      const svc = new PermissionService(repo);

      await expect(svc.getCapabilities(U, CO)).resolves.toEqual({});
      await expect(svc.getCapabilityScopes(U, CO)).resolves.toEqual({});
      expect(errorSpy, "nhánh {} vẫn phải để lại vết").toHaveBeenCalledTimes(2);
    });
  }

  it("throw chuỗi ⇒ dòng log giữ nguyên chuỗi lỗi gốc", async () => {
    const repo = new CapabilityStubRepo();
    vi.spyOn(repo, "getCompanyRoleGrants").mockRejectedValue("pool exhausted");
    const svc = new PermissionService(repo);

    await expect(svc.getCapabilities(U, CO)).resolves.toEqual({});
    expect(errorSpy.mock.calls[0]?.[1]).toMatchObject({
      error: "pool exhausted",
      stack: undefined,
    });
  });
});

describe("S14-SEC-CAPWILDCARD-1 — catalog cặp ném giá trị không phải Error ⇒ suy biến SIẾT, không ném", () => {
  it("actor CHỈ wildcard + cold start + catalog ném Object.create(null) ⇒ caps = {} và scopes = {}", async () => {
    const repo = new CapabilityStubRepo().withGrants([grant("*", "*")]);
    vi.spyOn(repo, "getAllPermissions").mockRejectedValue(Object.create(null));
    const svc = new PermissionService(repo);

    await expect(svc.getCapabilities(U, CO)).resolves.toEqual({});
    await expect(svc.getCapabilityScopes(U, CO)).resolves.toEqual({});
    expect(errorSpy).toHaveBeenCalled();
  });
});
