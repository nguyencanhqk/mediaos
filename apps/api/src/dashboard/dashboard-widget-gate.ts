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
 * 📌 **KHÔNG truyền `isSensitive` — và ĐÓ LÀ ĐÚNG kể từ `S14-SEC-DASHGATE-WILDCARD-1`.**
 *
 * Lịch sử, vì nó là một cái bẫy đã sập một lần: bốn bản `gateOrThrow` cũ đều kèm câu «engine tự ép
 * effectivelySensitive ⇒ wildcard KHÔNG lọt». Câu đó **từng SAI**: `decideCan` đọc `is_sensitive` của
 * HÀNG GRANT KHỚP — tức hàng `*:*` (`is_sensitive=false`) — chứ không của CẶP ĐÍCH, nên actor chỉ cầm
 * `*:*` qua được gate này. Nếu bạn thấy câu khẳng định đó ở một nhánh cũ, đừng tin nó ở đó.
 *
 * Nay câu ấy ĐÚNG, nhưng vì một cơ chế KHÁC: `PermissionService` bơm `pairIsSensitive` — cờ catalog
 * của CẶP ĐÍCH — vào mọi `can()`/scope-resolve (ADR `DECISIONS-12`). Cổng không còn phụ thuộc việc
 * call-site có nhớ truyền cờ hay không, nên gate này KHÔNG cần (và không nên) tự tra catalog.
 *
 * ⚠️ Đừng "sửa cho chắc" bằng cách thêm `isSensitive: true` ở đây: `isSensitive` còn điều khiển
 * `auditRequired` và `needsObjectGrant` (xem `permission.decide.ts`), nên bật nó ở tầng gate là đổi
 * hai thứ khác ngoài cổng wildcard.
 *
 * Deny-path: `dashboard-widget-gate.spec.ts` (đơn vị, qua `PermissionService` THẬT) +
 * `test/integration/dash-wildcard-sensitive-gate.int-spec.ts` (HTTP, hai tầng).
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
