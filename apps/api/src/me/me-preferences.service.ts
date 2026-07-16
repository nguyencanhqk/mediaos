import { BadRequestException, Injectable, UnprocessableEntityException } from "@nestjs/common";
import type {
  MePreferences,
  MePreferencesAppearancePatch,
  MePreferencesPatch,
} from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import type { UserPreference } from "../db/schema";
import { SettingService } from "../foundation/settings/setting.service";
import { assertValidTimezone } from "../common/tz.util";
import { ME_TIMEZONE_OVERRIDE_DENIED_CODE, ME_TIMEZONE_OVERRIDE_SETTING_KEY } from "./me.constants";
import {
  MePreferencesRepository,
  type MePreferencesPatchColumns,
} from "./me-preferences.repository";

interface Actor {
  id: string;
  companyId: string;
}

/** DB row → DTO (§15.2 — field vắng/NULL = chưa override, kế thừa company/system default §15.3). */
function toDto(row: UserPreference | undefined): MePreferences {
  return {
    locale: (row?.locale as MePreferences["locale"]) ?? null,
    timezone: row?.timezone ?? null,
    theme: (row?.theme as MePreferences["theme"]) ?? null,
    dateFormat: (row?.dateFormat as MePreferences["dateFormat"]) ?? null,
    timeFormat: (row?.timeFormat as MePreferences["timeFormat"]) ?? null,
    defaultLanding: row?.defaultLanding ?? null,
    density: (row?.density as MePreferences["density"]) ?? null,
    favoriteModules: row?.favoriteModules ?? null,
    meLayoutConfig: row?.meLayoutConfig ?? null,
    updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null,
  };
}

/**
 * S5-ME-BE-2 — MePreferencesService (SPEC-09 §15.2 · §10.8 · ME-DEC-008). Own-scope THUẦN: `user_preferences`
 * khoá theo `user_id` (KHÔNG theo employee) ⇒ KHÔNG cần `MeCurrentPersonResolver` (khác Avatar — employee-
 * dependent). `company_id` mọi query qua `withTenant` (BẤT BIẾN #1). KHÔNG audit (chỉ đạo WO + SPEC-09 §17
 * KHÔNG liệt kê "đổi personal preference" vào danh sách bắt buộc audit — khác notification-preference BẮT
 * BUỘC/avatar).
 */
@Injectable()
export class MePreferencesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: MePreferencesRepository,
    private readonly settings: SettingService,
  ) {}

  async getPreferences(actor: Actor): Promise<MePreferences> {
    const row = await this.db.withTenant(actor.companyId, (tx) =>
      this.repo.findByUserTx(tx, actor.companyId, actor.id),
    );
    return toDto(row);
  }

  /** PATCH /me/preferences — patch tổng hợp (mọi field DTO). */
  async patchPreferences(actor: Actor, dto: MePreferencesPatch): Promise<MePreferences> {
    return this.applyPatch(actor, dto);
  }

  /** PATCH /me/preferences/appearance — subset giao diện; cấu trúc con của patch tổng (TS structural OK). */
  async patchAppearance(actor: Actor, dto: MePreferencesAppearancePatch): Promise<MePreferences> {
    return this.applyPatch(actor, dto);
  }

  private async applyPatch(
    actor: Actor,
    dto: MePreferencesAppearancePatch | MePreferencesPatch,
  ): Promise<MePreferences> {
    await this.assertTimezonePolicy(actor, dto.timezone);
    // `assertValidTimezone` ném RangeError THÔ (Intl) — bọc thành BadRequestException (400) TRƯỚC khi
    // ghi, tránh lọt lên AllExceptionsFilter thành 500 (RangeError KHÔNG phải HttpException — mirror
    // gap ĐÃ có ở settings.service.ts, sửa CỤC BỘ ở ME thay vì đụng file ngoài path WO).
    if (dto.timezone) {
      try {
        assertValidTimezone(dto.timezone);
      } catch {
        throw new BadRequestException(
          `VALIDATION-ERR-001: timezone '${dto.timezone}' không phải IANA time zone hợp lệ.`,
        );
      }
    }

    const patch: MePreferencesPatchColumns = { ...dto };
    const row = await this.db.withTenant(actor.companyId, (tx) =>
      this.repo.upsertTx(tx, actor.companyId, actor.id, patch, actor.id),
    );
    return toDto(row);
  }

  /**
   * ME-DEC-008: `timezone` chỉ bị chặn khi client gửi giá trị THẬT khác null/undefined (một override THẬT).
   * `null` (revert-to-inherit) hoặc `undefined` (không đụng field) LUÔN được phép — không cần policy.
   * Setting `me.allow_user_timezone_override` CHƯA seed default (ngoài path WO) ⇒ `found=false` khi vắng
   * → mặc định DENY (opt-in, khớp "Có NẾU company cho phép").
   */
  private async assertTimezonePolicy(
    actor: Actor,
    timezone: string | null | undefined,
  ): Promise<void> {
    if (timezone === undefined || timezone === null) return;
    const resolved = await this.settings.resolveSetting(
      actor.companyId,
      ME_TIMEZONE_OVERRIDE_SETTING_KEY,
    );
    const allowed = resolved.found && (resolved.value === true || resolved.value === "true");
    if (!allowed) {
      throw new UnprocessableEntityException({
        code: ME_TIMEZONE_OVERRIDE_DENIED_CODE,
        message: `${ME_TIMEZONE_OVERRIDE_DENIED_CODE}: công ty chưa cho phép người dùng tự đổi múi giờ.`,
      });
    }
  }
}
