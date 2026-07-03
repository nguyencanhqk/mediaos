import { Logger } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * S2-FND-SEED-3-FIX-2 — vá lỗ 0% coverage cho EnsureDefaultCompanyBootstrapService (zone red/crown).
 *
 * Unit thuần (KHÔNG DB): mock EnsureDefaultCompanyService (constructor-injected) + mock loadEnv (env.schema)
 * để lái onApplicationBootstrap() qua đúng 4 nhánh của nó:
 *   (a) NODE_ENV='test'        → no-op, KHÔNG gọi ensureDefaultCompany() (int-spec khác tự gọi trực tiếp).
 *   (b) company trả về         → log an toàn id/status, KHÔNG ném.
 *   (c) company null           → log warn (DB chưa cấu hình?), return, KHÔNG ném.
 *   (d) ensureDefaultCompany() ném lỗi → catch fail-safe, KHÔNG rethrow (boot không được sập).
 *
 * Trước bản vá này KHÔNG có spec/int-spec nào gọi trực tiếp onApplicationBootstrap() của lớp này — toàn bộ
 * chứng cứ đi qua đường khác (SuperAdminBootstrapService tự gọi ensureDefaultCompany() nội bộ). Nếu điều kiện
 * NODE_ENV bị đảo ngược hoặc catch bị xoá nhầm, sẽ không có test nào bắt được regression.
 */

// Default implementation phục vụ import graph phụ (ensure-default-company-bootstrap.service.ts import THẬT
// EnsureDefaultCompanyService cho DI-metadata ⇒ kéo theo ../../db/index.ts gọi loadEnv() TẠI THỜI ĐIỂM MODULE
// LOAD — TRƯỚC khi beforeEach() của bất kỳ test nào chạy. Không có default này, lệnh import ở dưới sẽ throw
// (env=undefined) trước khi bất kỳ test nào kịp set NODE_ENV mong muốn.
const { loadEnvMock } = vi.hoisted(() => ({
  loadEnvMock: vi.fn(() => ({ NODE_ENV: "development" })),
}));

vi.mock("../../config/env.schema", () => ({
  loadEnv: loadEnvMock,
}));

import { EnsureDefaultCompanyBootstrapService } from "./ensure-default-company-bootstrap.service";
import type { EnsuredCompany, EnsureDefaultCompanyService } from "./ensure-default-company.service";

/** Fake EnsureDefaultCompanyService — chỉ cần method `ensureDefaultCompany` (constructor-injected seam). */
function makeEnsureDefaultCompany(impl: () => Promise<EnsuredCompany | null>): {
  svc: EnsureDefaultCompanyService;
  ensureDefaultCompany: ReturnType<typeof vi.fn>;
} {
  const ensureDefaultCompany = vi.fn(impl);
  return {
    svc: { ensureDefaultCompany } as unknown as EnsureDefaultCompanyService,
    ensureDefaultCompany,
  };
}

describe("EnsureDefaultCompanyBootstrapService.onApplicationBootstrap", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let debugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    loadEnvMock.mockReset();
    // Silence + capture Logger.prototype (instance methods — mọi `new Logger(name)` dùng chung prototype).
    logSpy = vi.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    warnSpy = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    errorSpy = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    debugSpy = vi.spyOn(Logger.prototype, "debug").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("(a) NODE_ENV='test' ⇒ no-op, KHÔNG gọi ensureDefaultCompany", async () => {
    loadEnvMock.mockReturnValue({ NODE_ENV: "test" });
    const { svc, ensureDefaultCompany } = makeEnsureDefaultCompany(async () => ({
      id: "company-should-not-be-called",
      status: "active",
    }));
    const bootstrap = new EnsureDefaultCompanyBootstrapService(svc);

    await expect(bootstrap.onApplicationBootstrap()).resolves.toBeUndefined();

    expect(ensureDefaultCompany).not.toHaveBeenCalled();
    expect(debugSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("(b) company trả về ⇒ log AN TOÀN id/status, KHÔNG ném", async () => {
    loadEnvMock.mockReturnValue({ NODE_ENV: "production" });
    const { svc, ensureDefaultCompany } = makeEnsureDefaultCompany(async () => ({
      id: "company-42",
      status: "active",
    }));
    const bootstrap = new EnsureDefaultCompanyBootstrapService(svc);

    await expect(bootstrap.onApplicationBootstrap()).resolves.toBeUndefined();

    expect(ensureDefaultCompany).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledTimes(1);
    const [message] = logSpy.mock.calls[0] as [string];
    expect(message).toContain("company-42");
    expect(message).toContain("active");
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("(c) company null (DB chưa cấu hình) ⇒ log warn, return, KHÔNG ném", async () => {
    loadEnvMock.mockReturnValue({ NODE_ENV: "production" });
    const { svc, ensureDefaultCompany } = makeEnsureDefaultCompany(async () => null);
    const bootstrap = new EnsureDefaultCompanyBootstrapService(svc);

    await expect(bootstrap.onApplicationBootstrap()).resolves.toBeUndefined();

    expect(ensureDefaultCompany).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("(d) ensureDefaultCompany() ném lỗi ⇒ catch fail-safe, KHÔNG rethrow (boot không sập)", async () => {
    loadEnvMock.mockReturnValue({ NODE_ENV: "production" });
    const { svc, ensureDefaultCompany } = makeEnsureDefaultCompany(async () => {
      throw new Error("db down");
    });
    const bootstrap = new EnsureDefaultCompanyBootstrapService(svc);

    await expect(bootstrap.onApplicationBootstrap()).resolves.toBeUndefined();

    expect(ensureDefaultCompany).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [message] = errorSpy.mock.calls[0] as [string];
    expect(message).toContain("db down");
    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
