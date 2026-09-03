/**
 * S14-PERF-DASHACTOR-1 — MỘT bản `gateOrThrow` cho MỌI nhóm handler widget.
 *
 * Trước WO này có 4 bản byte-giống-nhau (`dashboard-widget-handlers.service.ts:127` ·
 * `-office.handlers.ts:50` · `-recruit.handlers.ts:44` · `-payroll.handlers.ts:55`), mỗi bản ghi
 * comment «mirror <bản liền trước>» — một chuỗi mirror-của-mirror trong đó KHÔNG bản nào chứng nhận
 * bản gốc. Bốn bản = bốn chỗ phải sửa khi ngữ nghĩa gate đổi, và ba chỗ có thể quên.
 *
 * ⚠️ **Gộp CODE gate, KHÔNG gộp HẰNG SÀN.** `DASH_WIDGET_MIN_DATA_SCOPE` của ASSET_SUMMARY /
 * RECRUIT_FUNNEL / PAYROLL_COST tình cờ cùng giá trị nhưng KHÁC LÝ DO (ASSET: nhân viên thường giữ
 * `view:asset@Own` · RECRUIT: `summaryTx` đếm TOÀN company · PAYROLL: `latestSummaryTx` SUM toàn
 * company). Sàn ở lại từng handler; một ngày ba lý do đó rẽ nhánh thì ba sàn phải rẽ theo.
 *
 * ⚠️ **`gate ⊥ fetch`** (`dashboard-widget-handlers.service.ts:77`): hàm này CHỈ được gọi từ
 * `gateAndResolve` — chạy MỌI lần serve kể cả cache hit. Gọi nó từ `fetch` (chỉ chạy khi cache miss)
 * là dựng lại lỗ `widget-cache-hit-skips-audit-trail`. Cũng vì thế: KHÔNG chuyền `scope`/`pair` đã
 * resolve ở `gateAndResolve` sang `fetch` để "tiết kiệm round-trip".
 */
import { ForbiddenException } from "@nestjs/common";
import type { PermissionService } from "../permission/permission.service";
import { gatePairFor } from "./dashboard-widget-data.const";
import { DASH_ERR } from "./dashboard-resolver.errors";
import type { EnginePair } from "./dashboard-widget-catalog.const";
import type { WidgetRequestUser } from "./dashboard-widget-data.types";

/**
 * Gate quyền của widget bằng cặp của MODULE NGUỒN. Deny ⇒ 403 fail-closed (runner KHÔNG nuốt
 * `ForbiddenException` thành Degraded). Thiếu entry cặp gate ⇒ cũng 403, KHÔNG "cho qua vì không
 * biết gác gì".
 *
 * 📌 **KHÔNG truyền `isSensitive` — GIỮ NGUYÊN hành vi 4 bản cũ.** Bốn bản cũ đều kèm câu «engine tự
 * ép effectivelySensitive = input OR grant.isSensitive ⇒ cặp nguồn is_sensitive=true vẫn exact-match,
 * wildcard KHÔNG lọt». **Câu đó SAI một nửa**: `permission.decide.ts` tính
 * `effectivelySensitive = isSensitive || companyAllows.some(g => g.isSensitive)`, trong đó
 * `companyAllows` là các HÀNG GRANT KHỚP — nên `is_sensitive` được đọc là của hàng `*:*`
 * (`is_sensitive=false`), KHÔNG phải của cặp đích. Actor chỉ cầm `*:*` VẪN qua được gate này.
 *
 * Hôm nay chưa nổ: mig `0565` §6.7 census fail-closed khẳng định không role SEED nào giữ wildcard,
 * 2 role tuỳ biến PROD đã thu hồi ở `S14-PROD-PAYROLLGRANT-1`, và tầng-2 (service nguồn — vd
 * `PayrollAccessService`/`RecruitAccessService`) truyền cờ TƯỜNG MINH nên đường DỮ LIỆU vẫn kín.
 * Hở là đường METADATA `/dashboard/me` + gọi thẳng slug.
 *
 * Siết ở đây = đổi hành vi quyền THẬT (403 cho mọi actor cầm wildcard trên RECRUIT_FUNNEL /
 * PAYROLL_COST), cần deny-path riêng ⇒ tách WO `S14-SEC-DASHGATE-WILDCARD-1`. WO perf này chỉ GHIM
 * hành vi hiện tại bằng test để nó không đổi ngầm theo chiều nào cả.
 */
export async function gateWidgetOrThrow(
  permission: PermissionService,
  user: WidgetRequestUser,
  widgetCode: string,
): Promise<EnginePair> {
  const pair = gatePairFor(widgetCode);
  if (!pair) {
    throw new ForbiddenException(`${DASH_ERR.VALIDATION}: widget thiếu cặp gate (${widgetCode})`);
  }
  const decision = await permission.can({
    userId: user.id,
    companyId: user.companyId,
    action: pair.action,
    resourceType: pair.resourceType,
  });
  if (!decision.allow) {
    throw new ForbiddenException(
      `AUTH-ERR-FORBIDDEN: thiếu quyền ${pair.action}:${pair.resourceType}`,
    );
  }
  return pair;
}
