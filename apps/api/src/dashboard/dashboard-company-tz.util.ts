/**
 * S11-OFFICE-DASH-1 — múi giờ CÔNG TY dùng chung cho lớp widget DASH.
 *
 * VÌ SAO tách ra khỏi `DashboardWidgetHandlersService`: nó vốn là private helper ở đó, nhưng widget
 * ROOM_TODAY sống ở file handler RIÊNG (`dashboard-widget-office.handlers.ts` — giữ file registry dưới
 * trần 800 dòng). Hai bản sao của cùng một phép "hôm nay theo tz công ty" là đúng thứ trôi lệch âm thầm
 * (ATTENDANCE_TODAY tính một ngày, ROOM_TODAY tính ngày khác) ⇒ MỘT hàm, hai người gọi.
 *
 * `DEFAULT_TZ` là cận cuối khi `companies.timezone` NULL — cùng giá trị mặc định của cột (mig 0469).
 */
import { sql } from "drizzle-orm";
import type { DatabaseService } from "../db/db.service";

export const DASH_DEFAULT_TZ = "Asia/Ho_Chi_Minh";

/** Múi giờ IANA của công ty; NULL/không thấy hàng ⇒ `DASH_DEFAULT_TZ`. Đọc qua withTenant (RLS sống). */
export async function resolveCompanyTz(db: DatabaseService, companyId: string): Promise<string> {
  return db.withTenant(companyId, async (tx) => {
    const r = await tx.execute(
      sql`SELECT timezone FROM companies WHERE id = ${companyId} AND deleted_at IS NULL LIMIT 1`,
    );
    const row = r.rows[0] as { timezone: string | null } | undefined;
    return row?.timezone ?? DASH_DEFAULT_TZ;
  });
}
