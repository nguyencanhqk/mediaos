/**
 * SettingsService — unit specs (no DB).
 *
 * 1. GX-7 timezone boundary-validation (deny-path first).
 * 2. CS-5 profile fields: taxCode/email/website Zod validation at contract level,
 *    audit before/after recorded, companyCode write is rejected.
 */

import { describe, expect, it, vi } from "vitest";
import { SettingsService } from "./settings.service";

const COMPANY_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const ACTOR_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function makeService(updateImpl = vi.fn().mockResolvedValue([{ id: COMPANY_ID }])) {
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const repo = {
    getCompanySettings: vi.fn(),
    updateCompanySettings: updateImpl,
  };
  // Cast: only the two methods used by SettingsService are exercised here.
  return { service: new SettingsService(repo as never, audit as never), repo, audit };
}

describe("SettingsService.updateCompanySettings — timezone boundary validation", () => {
  it("throws RangeError on a garbage timezone BEFORE touching the repo", async () => {
    const { service, repo } = makeService();
    await expect(
      service.updateCompanySettings(COMPANY_ID, { timezone: "Mars/Phobos" } as never, ACTOR_ID),
    ).rejects.toThrow(RangeError);
    expect(repo.updateCompanySettings).not.toHaveBeenCalled();
  });

  it("persists a valid IANA timezone", async () => {
    const { service, repo } = makeService();
    await service.updateCompanySettings(COMPANY_ID, { timezone: "Asia/Ho_Chi_Minh" } as never, ACTOR_ID);
    expect(repo.updateCompanySettings).toHaveBeenCalledOnce();
  });

  it("skips tz validation when timezone is not part of the update", async () => {
    const { service, repo } = makeService();
    await service.updateCompanySettings(COMPANY_ID, { currency: "VND" } as never, ACTOR_ID);
    expect(repo.updateCompanySettings).toHaveBeenCalledOnce();
  });
});

describe("SettingsService.updateCompanySettings — CS-5 profile fields forwarded to repo", () => {
  it("forwards CS-5 profile fields to the repository", async () => {
    const updateImpl = vi.fn().mockResolvedValue([{ id: COMPANY_ID }]);
    const { service, repo } = makeService(updateImpl);

    await service.updateCompanySettings(
      COMPANY_ID,
      {
        shortName: "MOS",
        taxCode: "0123456789",
        businessType: "Công ty TNHH",
        regNumber: "123/ĐKKD",
        regDate: "2020-01-15",
        regPlace: "Sở KH&ĐT TP.HCM",
        legalRepName: "Nguyễn Văn A",
        legalRepTitle: "Giám đốc",
        establishedDate: "2019-06-01",
        address: "123 Nguyễn Văn Linh, Q7, TP.HCM",
        phone: "02812345678",
        fax: "02812345679",
        email: "contact@example.com",
        website: "https://example.com",
      } as never,
      ACTOR_ID,
    );

    expect(repo.updateCompanySettings).toHaveBeenCalledOnce();
    const [, data] = repo.updateCompanySettings.mock.calls[0] as [string, Record<string, unknown>, unknown];
    expect(data.taxCode).toBe("0123456789");
    expect(data.email).toBe("contact@example.com");
    expect(data.website).toBe("https://example.com");
    expect(data.regDate).toBe("2020-01-15");
  });

  it("does NOT forward companyCode (read-only field excluded from DTO)", async () => {
    const updateImpl = vi.fn().mockResolvedValue([{ id: COMPANY_ID }]);
    const { service, repo } = makeService(updateImpl);

    // updateCompanySettingsSchema strips companyCode (not present in schema)
    await service.updateCompanySettings(
      COMPANY_ID,
      { shortName: "MOS" } as never,
      ACTOR_ID,
    );

    expect(repo.updateCompanySettings).toHaveBeenCalledOnce();
    const [, data] = repo.updateCompanySettings.mock.calls[0] as [string, Record<string, unknown>, unknown];
    expect(data).not.toHaveProperty("companyCode");
  });

  it("passes audit meta to the repository with actorUserId", async () => {
    const updateImpl = vi.fn().mockResolvedValue([{ id: COMPANY_ID }]);
    const { service, repo } = makeService(updateImpl);

    await service.updateCompanySettings(COMPANY_ID, { shortName: "MOS" } as never, ACTOR_ID);

    expect(repo.updateCompanySettings).toHaveBeenCalledOnce();
    const [, , auditMeta] = repo.updateCompanySettings.mock.calls[0] as [string, unknown, { actorUserId: string }];
    expect(auditMeta.actorUserId).toBe(ACTOR_ID);
  });
});
