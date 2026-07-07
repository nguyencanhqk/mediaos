import { describe, expect, it } from "vitest";
// 🔴 RED-first (CLAUDE §6): import các DTO settings/holidays/company-patch từ barrel foundation KHI
//    settings.ts/holidays.ts CHƯA tồn tại và patchCompanySchema CHƯA append vào company.ts → ĐỎ đúng lý
//    do (export thiếu) trước khi migrate. GREEN sau khi contracts thành nguồn sự thật DTO (CLAUDE §4).
import {
  // settings (foundation/settings.ts)
  SETTING_VALUE_TYPES,
  settingStatusEnum,
  publicQuerySchema,
  resolveBodySchema,
  resolveQuerySchema,
  patchCompanySettingSchema,
  systemSettingsQuerySchema,
  patchSystemSettingSchema,
  // holidays (foundation/holidays.ts)
  createHolidaySchema,
  updateHolidaySchema,
  holidayListQuerySchema,
  checkWorkingDayQuerySchema,
  // company-patch (append foundation/company.ts)
  patchCompanySchema,
} from "./index";

/**
 * S2-FND-CONTRACT-1 (fix-contract1-dto-migrate) — contract test cho các DTO đã migrate settings/holidays/
 * company-patch vào packages/contracts (nguồn sự thật DTO, CLAUDE §4).
 *
 * testTask#6 (BẤT BIẾN #3): bundle FE của DTO KHÔNG lộ field SERVER-ONLY (secretRef/secret_ref/
 * validationSchema/validation_schema/isEncrypted) — DTO là schema REQUEST/QUERY, z.object STRIP mọi key lạ
 * ⇒ secret pointer / validation definition / raw stored value KHÔNG bao giờ đi qua contracts ra client.
 */

/** Field CHỈ tồn tại phía server (RawSettingRow.secretRef, validation_schema định nghĩa 422, cờ mã hoá). */
const SERVER_ONLY_FIELDS = [
  "secretRef",
  "secret_ref",
  "validationSchema",
  "validation_schema",
  "isEncrypted",
  "is_encrypted",
] as const;

/** Input tối thiểu HỢP LỆ cho từng schema (positive control) — dùng cả cho denylist (inject key lạ). */
const VALID_BASE: Record<string, () => Record<string, unknown>> = {
  publicQuerySchema: () => ({}),
  resolveBodySchema: () => ({ category: "general" }),
  resolveQuerySchema: () => ({}),
  patchCompanySettingSchema: () => ({ settingValue: "x" }),
  systemSettingsQuerySchema: () => ({}),
  patchSystemSettingSchema: () => ({ settingValue: "x" }),
  createHolidaySchema: () => ({ holidayCode: "TET", name: "Tết", holidayDate: "2026-01-01" }),
  updateHolidaySchema: () => ({}),
  holidayListQuerySchema: () => ({}),
  checkWorkingDayQuerySchema: () => ({ date: "2026-01-01" }),
  patchCompanySchema: () => ({ name: "ACME" }),
};

const MIGRATED = {
  publicQuerySchema,
  resolveBodySchema,
  resolveQuerySchema,
  patchCompanySettingSchema,
  systemSettingsQuerySchema,
  patchSystemSettingSchema,
  createHolidaySchema,
  updateHolidaySchema,
  holidayListQuerySchema,
  checkWorkingDayQuerySchema,
  patchCompanySchema,
};

/** READ/QUERY (KHÔNG phải patch input) — TUYỆT ĐỐI không được echo raw settingValue ra client. */
const READ_ONLY_SCHEMAS = [
  "publicQuerySchema",
  "resolveQuerySchema",
  "systemSettingsQuerySchema",
  "holidayListQuerySchema",
  "checkWorkingDayQuerySchema",
] as const;

describe("S2-FND-CONTRACT-1 migrated foundation DTOs (settings/holidays/company-patch)", () => {
  describe("positive control — schema tồn tại & parse input hợp lệ (đã migrate, không undefined)", () => {
    for (const [name, schema] of Object.entries(MIGRATED)) {
      it(`${name} parse input hợp lệ`, () => {
        expect(schema).toBeDefined();
        expect(() => schema.parse(VALID_BASE[name]())).not.toThrow();
      });
    }

    it("SETTING_VALUE_TYPES = 6 value_type khớp CHECK mig 0431", () => {
      expect(SETTING_VALUE_TYPES).toEqual([
        "String",
        "Number",
        "Boolean",
        "JSON",
        "Array",
        "SecretRef",
      ]);
    });

    it("settingStatusEnum chỉ Active/Inactive (soft-disable, KHÔNG hard-delete)", () => {
      expect(settingStatusEnum.parse("Active")).toBe("Active");
      expect(() => settingStatusEnum.parse("Deleted")).toThrow();
    });
  });

  describe("testTask#6 — denylist SERVER-ONLY: DTO xuất FE KHÔNG chứa secretRef/validationSchema/isEncrypted", () => {
    for (const [name, schema] of Object.entries(MIGRATED)) {
      it(`${name} STRIP mọi field server-only lạ`, () => {
        const injected: Record<string, unknown> = { ...VALID_BASE[name]() };
        for (const f of SERVER_ONLY_FIELDS) injected[f] = "LEAK";
        const out = schema.parse(injected) as Record<string, unknown>;
        for (const f of SERVER_ONLY_FIELDS) {
          expect(out).not.toHaveProperty(f);
        }
      });
    }
  });

  describe("testTask#6 — raw settingValue: schema READ/QUERY KHÔNG echo settingValue ra client", () => {
    for (const name of READ_ONLY_SCHEMAS) {
      it(`${name} STRIP settingValue (chỉ patch INPUT mới nhận value mới)`, () => {
        const schema = MIGRATED[name];
        const out = schema.parse({
          ...VALID_BASE[name](),
          settingValue: "raw-secret-should-not-echo",
        }) as Record<string, unknown>;
        expect(out).not.toHaveProperty("settingValue");
      });
    }
  });
});
