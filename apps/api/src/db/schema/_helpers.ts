import { sql } from "drizzle-orm";

/**
 * DEFAULT company_id = ngữ cảnh tenant hiện tại (khớp DB DEFAULT ở migration). Gắn `.default(...)` để
 * Drizzle coi company_id là TUỲ CHỌN khi insert — app khỏi tự set, WITH CHECK vẫn chặn gán sai tenant.
 */
export const currentCompanyDefault = sql`NULLIF(current_setting('app.current_company_id', true), '')::uuid`;
