/**
 * GX-7 — SettingsService timezone boundary-validation (deny-path RED first).
 *
 * Zod only enforces `timezone: string().min(1)` — a garbage IANA value ('Mars/Phobos') passes schema
 * and would be persisted, then silently corrupt every localDateOf/wallTimeToInstant for that tenant
 * (off-by-day attendance, wrong payroll period). The service MUST fail-fast at the boundary.
 */

import { describe, expect, it, vi } from "vitest";
import { SettingsService } from "./settings.service";

const COMPANY_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";

function makeService(updateImpl = vi.fn().mockResolvedValue([{ id: COMPANY_ID }])) {
  const repo = { getCompanySettings: vi.fn(), updateCompanySettings: updateImpl };
  // Cast: only the two methods used by SettingsService are exercised here.
  return { service: new SettingsService(repo as never), repo };
}

describe("SettingsService.updateCompanySettings — timezone boundary validation", () => {
  it("throws RangeError on a garbage timezone BEFORE touching the repo", async () => {
    const { service, repo } = makeService();
    await expect(
      service.updateCompanySettings(COMPANY_ID, { timezone: "Mars/Phobos" } as never),
    ).rejects.toThrow(RangeError);
    expect(repo.updateCompanySettings).not.toHaveBeenCalled();
  });

  it("persists a valid IANA timezone", async () => {
    const { service, repo } = makeService();
    await service.updateCompanySettings(COMPANY_ID, { timezone: "Asia/Ho_Chi_Minh" } as never);
    expect(repo.updateCompanySettings).toHaveBeenCalledOnce();
  });

  it("skips tz validation when timezone is not part of the update", async () => {
    const { service, repo } = makeService();
    await service.updateCompanySettings(COMPANY_ID, { currency: "VND" } as never);
    expect(repo.updateCompanySettings).toHaveBeenCalledOnce();
  });
});
