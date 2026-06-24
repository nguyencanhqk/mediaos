/**
 * S1-FND-SETTING-1 — SettingService unit tests (repo/db/audit/permission mocked, no Postgres).
 *
 * Crown-jewel coverage:
 *  - precedence resolveSetting/resolveMany: company > system > default; resolveMany BATCH ≤2 query (KHÔNG N+1).
 *  - getPublic: CHỈ is_public=true AND is_sensitive=false; secret-like (encrypted/SecretRef/secret_ref) DROP.
 *  - resolve quyền-aware: user thường → chỉ public; admin → masked metadata; secret_ref KHÔNG bao giờ ra.
 *  - updateCompanySetting: value_type/validation_schema sai → 400/422 KHÔNG upsert KHÔNG audit;
 *    đúng → upsert + audit COMPANY_SETTING_UPDATED object_type='company_setting' CÙNG tx (1 lần record).
 */

import { BadRequestException, UnprocessableEntityException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { SettingService } from "./setting.service";

const COMPANY_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const ACTOR_ID = "11111111-1111-1111-1111-111111111111";
const SETTING_ID = "55555555-5555-5555-5555-555555555555";
const actor = { id: ACTOR_ID, companyId: COMPANY_ID };

function row(over: Record<string, unknown> = {}) {
  return {
    id: SETTING_ID,
    companyId: COMPANY_ID,
    settingKey: "system.default_locale",
    settingValue: "vi",
    valueType: "String",
    category: "General",
    moduleCode: "SYSTEM",
    description: null,
    isPublic: true,
    isSensitive: false,
    isEncrypted: false,
    secretRef: null,
    validationSchema: null,
    status: "Active",
    ...over,
  };
}

interface RepoOverrides {
  findCompanyByKeysTx?: ReturnType<typeof vi.fn>;
  findSystemByKeysTx?: ReturnType<typeof vi.fn>;
  findCompanyByFilterTx?: ReturnType<typeof vi.fn>;
  findSystemByFilterTx?: ReturnType<typeof vi.fn>;
  findOneCompanyTx?: ReturnType<typeof vi.fn>;
  findOneSystemTx?: ReturnType<typeof vi.fn>;
  insertCompanyTx?: ReturnType<typeof vi.fn>;
  updateCompanyTx?: ReturnType<typeof vi.fn>;
}

function makeRepo(over: RepoOverrides = {}) {
  return {
    findCompanyByKeysTx: vi.fn().mockResolvedValue([]),
    findSystemByKeysTx: vi.fn().mockResolvedValue([]),
    findCompanyByFilterTx: vi.fn().mockResolvedValue([]),
    findSystemByFilterTx: vi.fn().mockResolvedValue([]),
    findOneCompanyTx: vi.fn().mockResolvedValue([]),
    findOneSystemTx: vi.fn().mockResolvedValue([]),
    insertCompanyTx: vi.fn().mockResolvedValue([row()]),
    updateCompanyTx: vi.fn().mockResolvedValue([row()]),
    ...over,
  };
}

function makeAudit() {
  return { record: vi.fn().mockResolvedValue(undefined) };
}

function makePermission(allow: boolean) {
  return { can: vi.fn().mockResolvedValue({ allow }) };
}

function makeService(opts: {
  repo?: ReturnType<typeof makeRepo>;
  audit?: ReturnType<typeof makeAudit>;
  permission?: ReturnType<typeof makePermission>;
}) {
  const repo = opts.repo ?? makeRepo();
  const audit = opts.audit ?? makeAudit();
  const permission = opts.permission ?? makePermission(false);
  // withTenant(_c, fn) runs fn with a tx stand-in (mirror holidays.service.spec). Track call count.
  const tx = {};
  const db = {
    withTenant: vi
      .fn()
      .mockImplementation((_c: string, fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
  };
  const svc = new SettingService(db as never, repo as never, audit as never, permission as never);
  return { svc, repo, audit, permission, db };
}

describe("SettingService.resolveSetting / resolveMany (precedence)", () => {
  it("company override beats system and default", async () => {
    const { svc } = makeService({
      repo: makeRepo({
        findCompanyByKeysTx: vi.fn().mockResolvedValue([row({ settingValue: "en" })]),
        findSystemByKeysTx: vi.fn().mockResolvedValue([row({ settingValue: "system-vi" })]),
      }),
    });
    const r = await svc.resolveSetting(COMPANY_ID, "system.default_locale");
    expect(r).toMatchObject({ value: "en", scope: "company", found: true });
  });

  it("falls back to system when no company override", async () => {
    const { svc } = makeService({
      repo: makeRepo({
        findSystemByKeysTx: vi.fn().mockResolvedValue([row({ settingValue: "system-vi" })]),
      }),
    });
    const r = await svc.resolveSetting(COMPANY_ID, "system.default_locale");
    expect(r).toMatchObject({ value: "system-vi", scope: "system", found: true });
  });

  it("falls back to hard-coded default when both tables empty", async () => {
    const { svc } = makeService({ repo: makeRepo() });
    const r = await svc.resolveSetting(COMPANY_ID, "system.default_timezone");
    expect(r).toMatchObject({ value: "Asia/Ho_Chi_Minh", scope: "default", found: true });
  });

  it("found=false when no company/system/default match", async () => {
    const { svc } = makeService({ repo: makeRepo() });
    const r = await svc.resolveSetting(COMPANY_ID, "nonexistent.key");
    expect(r.found).toBe(false);
    expect(r.value).toBeUndefined();
  });

  it("resolveMany BATCH ≤2 query (1 company + 1 system) — KHÔNG N+1 for many keys", async () => {
    const { svc, repo, db } = makeService({ repo: makeRepo() });
    await svc.resolveMany(COMPANY_ID, ["a", "b", "c", "d", "e"]);
    expect(repo.findCompanyByKeysTx).toHaveBeenCalledTimes(1);
    expect(repo.findSystemByKeysTx).toHaveBeenCalledTimes(1);
    expect(db.withTenant).toHaveBeenCalledTimes(1);
  });
});

describe("SettingService.getPublic (public filter + leak guard)", () => {
  it("returns only is_public=true AND is_sensitive=false; drops sensitive + secret-like", async () => {
    const { svc } = makeService({
      repo: makeRepo({
        findSystemByFilterTx: vi.fn().mockResolvedValue([
          row({ settingKey: "pub.ok", settingValue: "v1", isPublic: true, isSensitive: false }),
          row({
            settingKey: "pub.sensitive",
            settingValue: "leak",
            isPublic: true,
            isSensitive: true,
          }),
          row({
            settingKey: "priv.nonsensitive",
            settingValue: "x",
            isPublic: false,
            isSensitive: false,
          }),
          row({
            settingKey: "pub.secretref",
            settingValue: "ref-leak",
            isPublic: true,
            isSensitive: false,
            secretRef: "vault://x",
            valueType: "SecretRef",
          }),
        ]),
      }),
    });
    const out = await svc.getPublic(COMPANY_ID, {});
    expect(Object.keys(out)).toEqual(["pub.ok"]);
    expect(JSON.stringify(out)).not.toContain("leak");
    expect(JSON.stringify(out)).not.toContain("ref-leak");
    expect(JSON.stringify(out)).not.toContain("secret_ref");
    expect(JSON.stringify(out)).not.toContain("secretRef");
  });

  it("company override beats system for same key in public map", async () => {
    const { svc } = makeService({
      repo: makeRepo({
        findSystemByFilterTx: vi
          .fn()
          .mockResolvedValue([row({ settingKey: "k", settingValue: "sys" })]),
        findCompanyByFilterTx: vi
          .fn()
          .mockResolvedValue([row({ settingKey: "k", settingValue: "co" })]),
      }),
    });
    const out = await svc.getPublic(COMPANY_ID, {});
    expect(out.k).toBe("co");
  });
});

describe("SettingService.resolve (permission-aware mask)", () => {
  it("user without update permission → only public values, no secret_ref, sensitive dropped", async () => {
    const { svc } = makeService({
      permission: makePermission(false),
      repo: makeRepo({
        findSystemByFilterTx: vi.fn().mockResolvedValue([
          row({ settingKey: "pub.ok", settingValue: "v", isPublic: true, isSensitive: false }),
          row({
            settingKey: "sens",
            settingValue: "leak",
            isPublic: false,
            isSensitive: true,
            secretRef: "vault://s",
          }),
        ]),
      }),
    });
    const out = (await svc.resolve(actor, { category: "General" })) as {
      values: Record<string, unknown>;
    };
    expect(out.values).toEqual({ "pub.ok": "v" });
    expect(JSON.stringify(out)).not.toContain("leak");
    expect(JSON.stringify(out)).not.toContain("vault");
    expect(JSON.stringify(out)).not.toContain("secretRef");
  });

  it("admin (update perm) → metadata view with sensitive value MASKED and NO secret_ref field", async () => {
    const { svc } = makeService({
      permission: makePermission(true),
      repo: makeRepo({
        findSystemByFilterTx: vi.fn().mockResolvedValue([
          row({
            settingKey: "smtp.password",
            settingValue: "super-secret-pw",
            isPublic: false,
            isSensitive: true,
            secretRef: "vault://smtp",
            valueType: "SecretRef",
          }),
        ]),
      }),
    });
    const out = (await svc.resolve(actor, { category: "Mail" })) as {
      settings: { key: string; value: unknown; masked: boolean }[];
    };
    const s = out.settings.find((x) => x.key === "smtp.password");
    expect(s?.masked).toBe(true);
    expect(s?.value).toBe("***");
    expect(JSON.stringify(out)).not.toContain("super-secret-pw");
    expect(JSON.stringify(out)).not.toContain("vault://smtp");
    expect(JSON.stringify(out)).not.toContain("secretRef");
    expect(JSON.stringify(out)).not.toContain("secret_ref");
  });
});

describe("SettingService.updateCompanySetting (validate + audit-in-tx)", () => {
  it("wrong value_type → BadRequest, NO upsert, NO audit", async () => {
    const repo = makeRepo({
      findOneSystemTx: vi.fn().mockResolvedValue([row({ valueType: "Number" })]),
    });
    const audit = makeAudit();
    const { svc } = makeService({ repo, audit });
    await expect(
      svc.updateCompanySetting(actor, "file.max_upload_size_mb", {
        settingValue: "not-a-number",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.insertCompanyTx).not.toHaveBeenCalled();
    expect(repo.updateCompanyTx).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("validation_schema mismatch (min) → UnprocessableEntity, NO upsert, NO audit", async () => {
    const repo = makeRepo({
      findOneSystemTx: vi
        .fn()
        .mockResolvedValue([row({ valueType: "Number", validationSchema: { min: 10 } })]),
    });
    const audit = makeAudit();
    const { svc } = makeService({ repo, audit });
    await expect(
      svc.updateCompanySetting(actor, "file.max_upload_size_mb", { settingValue: 5 }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(repo.insertCompanyTx).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("valid insert → upsert + exactly ONE audit COMPANY_SETTING_UPDATED company_setting in same tx", async () => {
    const inserted = row({
      settingKey: "system.default_locale",
      settingValue: "en",
      valueType: "String",
    });
    const repo = makeRepo({
      findOneCompanyTx: vi.fn().mockResolvedValue([]),
      findOneSystemTx: vi.fn().mockResolvedValue([row({ valueType: "String" })]),
      insertCompanyTx: vi.fn().mockResolvedValue([inserted]),
    });
    const audit = makeAudit();
    const { svc } = makeService({ repo, audit });
    const out = await svc.updateCompanySetting(actor, "system.default_locale", {
      settingValue: "en",
      reason: "switch to english",
    });
    expect(repo.insertCompanyTx).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledTimes(1);
    const [, entry] = audit.record.mock.calls[0];
    expect(entry).toMatchObject({
      action: "COMPANY_SETTING_UPDATED",
      objectType: "company_setting",
      actorUserId: ACTOR_ID,
    });
    expect(out.scope).toBe("company");
  });

  it("audit oldValues/newValues mask the value for a sensitive setting", async () => {
    const existing = row({
      settingKey: "smtp.password",
      settingValue: "old-pw",
      valueType: "SecretRef",
      isSensitive: true,
    });
    const updated = row({
      settingKey: "smtp.password",
      settingValue: "new-pw",
      valueType: "SecretRef",
      isSensitive: true,
    });
    const repo = makeRepo({
      findOneCompanyTx: vi.fn().mockResolvedValue([existing]),
      findOneSystemTx: vi.fn().mockResolvedValue([]),
      updateCompanyTx: vi.fn().mockResolvedValue([updated]),
    });
    const audit = makeAudit();
    const { svc } = makeService({ repo, audit });
    await svc.updateCompanySetting(actor, "smtp.password", { settingValue: "vault://new" });
    const [, entry] = audit.record.mock.calls[0];
    expect(JSON.stringify(entry.oldValues)).not.toContain("old-pw");
    expect(JSON.stringify(entry.newValues)).not.toContain("new-pw");
    expect(JSON.stringify(entry.oldValues)).toContain("***");
  });
});

/**
 * assertSchema branch coverage (crown-jewel validation_schema, CLAUDE.md §6 ≥80% branch).
 * Schema + matching valueType injected via findOneSystemTx (same pattern as 'mismatch (min)').
 * findOneCompanyTx empty so a VALID value proceeds to insert (no throw). assertValueType passes
 * first, then assertSchema runs the branch under test.
 */
describe("SettingService.updateCompanySetting (validation_schema branches)", () => {
  // Helper: system ref carrying valueType + validationSchema; company side empty (insert path).
  function repoWithSchema(valueType: string, validationSchema: unknown) {
    return makeRepo({
      findOneCompanyTx: vi.fn().mockResolvedValue([]),
      findOneSystemTx: vi.fn().mockResolvedValue([row({ valueType, validationSchema })]),
    });
  }

  it("enum: value NOT in enum → UnprocessableEntity, NO upsert, NO audit", async () => {
    const repo = repoWithSchema("String", { enum: ["vi", "en"] });
    const audit = makeAudit();
    const { svc } = makeService({ repo, audit });
    await expect(
      svc.updateCompanySetting(actor, "system.default_locale", { settingValue: "fr" }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(repo.insertCompanyTx).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("enum: value IN enum → passes, upsert + audit run", async () => {
    const repo = repoWithSchema("String", { enum: ["vi", "en"] });
    const audit = makeAudit();
    const { svc } = makeService({ repo, audit });
    await svc.updateCompanySetting(actor, "system.default_locale", { settingValue: "en" });
    expect(repo.insertCompanyTx).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledTimes(1);
  });

  it("Number max: value > max → UnprocessableEntity, NO upsert", async () => {
    const repo = repoWithSchema("Number", { max: 100 });
    const audit = makeAudit();
    const { svc } = makeService({ repo, audit });
    await expect(
      svc.updateCompanySetting(actor, "file.max_upload_size_mb", { settingValue: 999 }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(repo.insertCompanyTx).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("Number min+max: value within [min,max] → passes", async () => {
    const repo = repoWithSchema("Number", { min: 1, max: 100 });
    const { svc } = makeService({ repo });
    await svc.updateCompanySetting(actor, "file.max_upload_size_mb", { settingValue: 50 });
    expect(repo.insertCompanyTx).toHaveBeenCalledTimes(1);
  });

  it("String minLength: value too short → UnprocessableEntity, NO upsert", async () => {
    const repo = repoWithSchema("String", { minLength: 3 });
    const audit = makeAudit();
    const { svc } = makeService({ repo, audit });
    await expect(
      svc.updateCompanySetting(actor, "system.default_locale", { settingValue: "x" }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(repo.insertCompanyTx).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("String maxLength: value too long → UnprocessableEntity, NO upsert", async () => {
    const repo = repoWithSchema("String", { maxLength: 2 });
    const audit = makeAudit();
    const { svc } = makeService({ repo, audit });
    await expect(
      svc.updateCompanySetting(actor, "system.default_locale", { settingValue: "toolong" }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(repo.insertCompanyTx).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("String length within [minLength,maxLength] → passes", async () => {
    const repo = repoWithSchema("String", { minLength: 2, maxLength: 5 });
    const { svc } = makeService({ repo });
    await svc.updateCompanySetting(actor, "system.default_locale", { settingValue: "vi" });
    expect(repo.insertCompanyTx).toHaveBeenCalledTimes(1);
  });

  it("pattern matches → passes, upsert runs", async () => {
    const repo = repoWithSchema("String", { pattern: "^[a-z]{2}$" });
    const { svc } = makeService({ repo });
    await svc.updateCompanySetting(actor, "system.default_locale", { settingValue: "vi" });
    expect(repo.insertCompanyTx).toHaveBeenCalledTimes(1);
  });

  it("pattern does NOT match → UnprocessableEntity, NO upsert", async () => {
    const repo = repoWithSchema("String", { pattern: "^[a-z]{2}$" });
    const audit = makeAudit();
    const { svc } = makeService({ repo, audit });
    await expect(
      svc.updateCompanySetting(actor, "system.default_locale", { settingValue: "ABC123" }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(repo.insertCompanyTx).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("pattern is invalid regex → UnprocessableEntity (pattern không hợp lệ), NO upsert", async () => {
    // Unbalanced group → new RegExp throws → caught → fail("...không hợp lệ.").
    const repo = repoWithSchema("String", { pattern: "(" });
    const audit = makeAudit();
    const { svc } = makeService({ repo, audit });
    await expect(
      svc.updateCompanySetting(actor, "system.default_locale", { settingValue: "vi" }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(repo.insertCompanyTx).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("schema is non-object (e.g. array) → ignored, value passes", async () => {
    // raw is Array → assertSchema early-returns (covers the null/non-object/array guard branch).
    const repo = repoWithSchema("String", ["not", "a", "schema"]);
    const { svc } = makeService({ repo });
    await svc.updateCompanySetting(actor, "system.default_locale", { settingValue: "anything" });
    expect(repo.insertCompanyTx).toHaveBeenCalledTimes(1);
  });
});

/**
 * assertValueType branch coverage — every value_type's fail + pass branch (BadRequest on type mismatch).
 * valueType injected via findOneSystemTx; company empty so a VALID value reaches insert.
 */
describe("SettingService.updateCompanySetting (value_type branches)", () => {
  function repoForType(valueType: string) {
    return makeRepo({
      findOneCompanyTx: vi.fn().mockResolvedValue([]),
      findOneSystemTx: vi.fn().mockResolvedValue([row({ valueType, validationSchema: null })]),
    });
  }

  it("Boolean: non-boolean → BadRequest; boolean → passes", async () => {
    const bad = repoForType("Boolean");
    const auditBad = makeAudit();
    const svcBad = makeService({ repo: bad, audit: auditBad }).svc;
    await expect(
      svcBad.updateCompanySetting(actor, "feature.flag", { settingValue: "true" }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(bad.insertCompanyTx).not.toHaveBeenCalled();
    expect(auditBad.record).not.toHaveBeenCalled();

    const ok = repoForType("Boolean");
    const svcOk = makeService({ repo: ok }).svc;
    await svcOk.updateCompanySetting(actor, "feature.flag", { settingValue: true });
    expect(ok.insertCompanyTx).toHaveBeenCalledTimes(1);
  });

  it("Array: non-array → BadRequest; array → passes", async () => {
    const bad = repoForType("Array");
    const svcBad = makeService({ repo: bad }).svc;
    await expect(
      svcBad.updateCompanySetting(actor, "file.allowed_mime_types", { settingValue: "image/png" }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(bad.insertCompanyTx).not.toHaveBeenCalled();

    const ok = repoForType("Array");
    const svcOk = makeService({ repo: ok }).svc;
    await svcOk.updateCompanySetting(actor, "file.allowed_mime_types", {
      settingValue: ["image/png"],
    });
    expect(ok.insertCompanyTx).toHaveBeenCalledTimes(1);
  });

  it("JSON: array value → BadRequest; null → BadRequest; plain object → passes", async () => {
    const badArr = repoForType("JSON");
    const svcArr = makeService({ repo: badArr }).svc;
    await expect(
      svcArr.updateCompanySetting(actor, "cfg.json", { settingValue: [1, 2] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(badArr.insertCompanyTx).not.toHaveBeenCalled();

    const badNull = repoForType("JSON");
    const svcNull = makeService({ repo: badNull }).svc;
    await expect(
      svcNull.updateCompanySetting(actor, "cfg.json", { settingValue: null }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(badNull.insertCompanyTx).not.toHaveBeenCalled();

    const ok = repoForType("JSON");
    const svcOk = makeService({ repo: ok }).svc;
    await svcOk.updateCompanySetting(actor, "cfg.json", { settingValue: { a: 1 } });
    expect(ok.insertCompanyTx).toHaveBeenCalledTimes(1);
  });

  it("Number: NaN → BadRequest (Number.isNaN branch)", async () => {
    const repo = repoForType("Number");
    const audit = makeAudit();
    const { svc } = makeService({ repo, audit });
    await expect(
      svc.updateCompanySetting(actor, "file.max_upload_size_mb", { settingValue: Number.NaN }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.insertCompanyTx).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("SecretRef: non-string → BadRequest", async () => {
    const repo = repoForType("SecretRef");
    const { svc } = makeService({ repo });
    await expect(
      svc.updateCompanySetting(actor, "smtp.password", { settingValue: 123 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.insertCompanyTx).not.toHaveBeenCalled();
  });

  it("unsupported value_type (exhaustiveness default) → BadRequest", async () => {
    // Bogus valueType reaches the switch default (never branch) → fail(...không hỗ trợ).
    const repo = repoForType("BogusType");
    const { svc } = makeService({ repo });
    await expect(
      svc.updateCompanySetting(actor, "weird.key", { settingValue: "x" }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.insertCompanyTx).not.toHaveBeenCalled();
  });
});
