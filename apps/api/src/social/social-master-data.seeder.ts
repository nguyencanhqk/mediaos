import { Injectable } from "@nestjs/common";
import { and, eq, inArray } from "drizzle-orm";
import { feedKudosBadges } from "../db/schema/social";
import type {
  MasterDataSeedContext,
  ModuleMasterDataSeeder,
} from "../foundation/seed/master-data-seeder.types";

/**
 * S16-SOCIAL-BE-2A (nợ (a) của S16-SOCIAL-DB-2) — RUNTIME per-company seeder catalog huy hiệu vinh
 * danh (DB-17 §7.9), khuôn `att-master-data.seeder.ts`.
 *
 * 🔴 VÌ SAO CẦN, dù migration `0582` đã seed: `0582` `CROSS JOIN companies` ⇒ chỉ với tay tới công ty
 * ĐANG TỒN TẠI lúc migrate. Thứ tự cài đặt PROD là **migrate TRƯỚC, boot app SAU**, và công ty chỉ
 * sinh lúc boot (`ensure-default-company.service.ts`) hoặc fixture test ⇒ trên một cài đặt mới,
 * `0582` chạy khi `companies` rỗng và là **no-op có bảo đảm**; công ty sinh sau đó sẽ mang catalog
 * huy hiệu RỖNG, và KHÔNG có đường nào vá (migration không chạy lại). Đó là lý do chính `0582` ghi
 * nợ này lại cho module SOCIAL — xem header của file migration.
 *
 * ⚠️ TẬP MÃ PHẢI KHỚP `0582` TỪNG Ô. Hai nguồn cùng ghi một catalog: công ty CŨ nhận từ migration,
 * công ty MỚI nhận từ đây. Lệch một mã/một `position` ⇒ hai thế hệ công ty thấy hai catalog khác
 * nhau, và không cổng nào bắt được (bảng có GRANT INSERT cho tenant). Neo ở
 * `social-master-data-seeder.int.spec.ts` G2 giữ hai bên bằng nhau.
 *
 * IDEMPOTENT: `INSERT … ON CONFLICT (company_id, code) DO NOTHING` theo UNIQUE
 * `feed_kudos_badges_company_code_uq` (0580). Chạy lại KHÔNG nhân bản và KHÔNG đè tên/icon tenant đã
 * sửa (bảng có GRANT UPDATE — BE-3 cho tenant admin tự sửa catalog). `ctx.track()` payload chỉ
 * master/config data (BẤT BIẾN #3), ổn định giữa các lần ⇒ checksum không đổi ⇒ lần 2 Skipped.
 *
 * KHÔNG hard-delete, KHÔNG mở/đóng batch (runner sở hữu vòng đời), INSERT trong `ctx.tx` — tenant tx
 * đã `set_config('app.current_company_id')` (RLS+FORCE ép `company_id`, BẤT BIẾN #1).
 */

/** Một huy hiệu hệ thống — 5 mã của DB-17 §7.9, chép ĐÚNG theo migration `0582`. */
export interface SocialSystemBadge {
  readonly code: string;
  readonly name: string;
  readonly description: string;
  /** Tên icon lucide (khớp packages/ui) — mỹ quan thuần tuý, FE đổi sau bằng UPDATE. */
  readonly icon: string;
  readonly position: number;
}

/**
 * 5 huy hiệu hệ thống (DB-17 §7.9). Thứ tự = `position` 1..5, KHÔNG sắp lại và KHÔNG thêm mã thứ sáu
 * ở đây: danh sách này là bản sao có hợp đồng của `0582`, không phải nơi mở rộng catalog (tenant tự
 * thêm huy hiệu riêng qua route `manage:feed-kudos` của S16-SOCIAL-BE-3).
 */
export const SOCIAL_SYSTEM_BADGES: readonly SocialSystemBadge[] = [
  {
    code: "teamwork",
    name: "Tinh thần đồng đội",
    description: "Ghi nhận tinh thần hợp tác, hỗ trợ đồng đội",
    icon: "users-round",
    position: 1,
  },
  {
    code: "innovation",
    name: "Sáng tạo",
    description: "Ghi nhận ý tưởng hoặc cách làm mới hiệu quả",
    icon: "lightbulb",
    position: 2,
  },
  {
    code: "customer-first",
    name: "Tận tâm với khách hàng",
    description: "Ghi nhận sự tận tâm phục vụ khách hàng",
    icon: "heart-handshake",
    position: 3,
  },
  {
    code: "mentor",
    name: "Người dẫn dắt",
    description: "Ghi nhận việc kèm cặp, hướng dẫn đồng nghiệp",
    icon: "graduation-cap",
    position: 4,
  },
  {
    code: "above-beyond",
    name: "Vượt mong đợi",
    description: "Ghi nhận nỗ lực vượt xa yêu cầu công việc",
    icon: "rocket",
    position: 5,
  },
];

@Injectable()
export class SocialMasterDataSeeder implements ModuleMasterDataSeeder {
  readonly seedKey = "social.master-data";
  readonly seedVersion = "v1";

  async seed(ctx: MasterDataSeedContext): Promise<void> {
    const { companyId, tx } = ctx;

    // MỘT câu INSERT cho cả 5 hàng — `ON CONFLICT DO NOTHING` nên công ty đã có (đường `0582`) là
    // no-op, không đè dữ liệu tenant đã sửa.
    await tx
      .insert(feedKudosBadges)
      .values(
        SOCIAL_SYSTEM_BADGES.map((b) => ({
          companyId,
          code: b.code,
          name: b.name,
          description: b.description,
          icon: b.icon,
          isActive: true,
          position: b.position,
        })),
      )
      .onConflictDoNothing({ target: [feedKudosBadges.companyId, feedKudosBadges.code] });

    // Đọc lại id THẬT (hàng có thể do `0582` chèn trước đó) — một câu cho cả 5, không N+1.
    const rows = await tx
      .select({ id: feedKudosBadges.id, code: feedKudosBadges.code })
      .from(feedKudosBadges)
      .where(
        and(
          eq(feedKudosBadges.companyId, companyId),
          inArray(
            feedKudosBadges.code,
            SOCIAL_SYSTEM_BADGES.map((b) => b.code),
          ),
        ),
      );
    const idByCode = new Map(rows.map((r) => [r.code, r.id]));

    for (const b of SOCIAL_SYSTEM_BADGES) {
      await ctx.track({
        targetTable: "feed_kudos_badges",
        targetKey: b.code,
        operation: "Upsert",
        targetId: idByCode.get(b.code) ?? null,
        payload: { code: b.code, name: b.name, icon: b.icon, position: b.position, isActive: true },
      });
    }
  }
}
