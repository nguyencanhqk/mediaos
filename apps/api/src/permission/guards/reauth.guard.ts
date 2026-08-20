import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  forwardRef,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { StepUpWindowService } from "../../auth/step-up/step-up-window.service";
import { isReauthValid } from "../permission.decide";
import { IS_PUBLIC } from "../public.decorator";
import { REQUIRE_PERMISSION, type RequirePermissionMeta } from "../require-permission.decorator";

/**
 * Hình dạng request guard được phép chạm — cố ý HẸP.
 *
 * `permission.guard.ts` khai một type gần giống (`ReauthAwareRequest`) cho phía ĐỌC. Ở đây khai lại thay
 * vì import chung: file kia nằm trong vùng CẤM SỬA của WO này (DECISIONS-09 §6 điểm 11.1 — `git diff`
 * của nó phải RỖNG), nên mọi thứ guard mới cần phải tự mang theo.
 */
type ReauthWritableRequest = {
  params?: Record<string, string>;
  user?: { id?: string; companyId?: string };
  reauthContext?: { reauthValidUntil: Date | null };
};

/**
 * ReauthGuard — **NƠI DUY NHẤT** trong `apps/api/src` gán ngữ cảnh re-auth lên request
 * (DECISIONS-09 §6 điểm 1 và điểm 11.2). Chạy TRƯỚC `PermissionGuard`:
 * `@UseGuards(ReauthGuard, PermissionGuard)` — cùng một tầng, đúng thứ tự (§6 điểm 8).
 *
 * ─── GUARD NÀY KHÔNG BAO GIỜ DENY ───────────────────────────────────────────────────────────────
 * Mọi nhánh trả `true`. Quyết định cho/chặn nằm TRỌN ở `permission.decide.ts`: guard chỉ nạp dữ kiện.
 * Thêm một `throw` vào đây sẽ đẻ đường deny THỨ HAI song song với engine — hai nguồn sự thật cho cùng
 * một câu hỏi là cách chắc chắn nhất để về sau chúng lệch nhau.
 *
 * ─── BA TRONG BỐN NHÁNH KHÔNG GHI GÌ (và đó là điểm chính) ──────────────────────────────────────
 *   1. KHÔNG phải reveal-class (`isSensitive && requiresReauth`) ⇒ thoát NGAY, không hỏi store.
 *      Hôm nay `REVEAL_CLASS_PAIRS` rỗng và không route sản phẩm nào khai `requiresReauth` ⇒ nhánh này
 *      là **100% lưu lượng** ⇒ WO này có 0 thay đổi hành vi cho mọi route đang chạy.
 *   2. `req.params.id` vắng ⇒ không tra. Đọc ĐÚNG chỗ `permission.guard.ts:122` đọc (`req.params?.id`):
 *      hai bên tra hai `resourceId` khác nhau thì cửa sổ đúng vẫn deny.
 *   3. store không trả cửa sổ còn hạn ⇒ không ghi ⇒ `deny-reauth-required` (fail-closed).
 *
 * ─── 🚩PLAN-BLOCK#1 — VÌ SAO CÓ ASSERT KIỂU TRONG CHÍNH GUARD ───────────────────────────────────
 * Consumer là `isReauthValid()` (permission.decide.ts:145-149) và nó loại thẳng mọi thứ không phải
 * `Date`: `if (!(x instanceof Date) || isNaN(...)) return false`. Một chuỗi ISO lọt xuống KHÔNG ném,
 * KHÔNG log, chỉ trả `false` ⇒ route 403 **VĨNH VIỄN mà không để lại bằng chứng ở đâu** (đúng hình
 * dạng KI-065). Vì thế giá trị đọc từ store được nhận vào `unknown` và phải qua `instanceof Date` +
 * chính `isReauthValid()` — dùng lại PHÉP KIỂM CỦA CONSUMER, không viết lại một phép tương đương — rồi
 * mới được ghi. Store phá hợp đồng ⇒ log ERROR (nhìn thấy được), không ghi.
 *
 * ─── CẤM TỰ TÍNH TTL ────────────────────────────────────────────────────────────────────────────
 * Mốc hết hạn CHỈ đến từ store. Một `new Date(Date.now() + ttl)` ở đây sẽ cấp cửa sổ hợp lệ cho bộ-5
 * **chưa từng được mint** — tức là gỡ sạch bước xác thực lại mà vẫn xanh mọi test hình thức.
 */
@Injectable()
export class ReauthGuard implements CanActivate {
  private readonly logger = new Logger(ReauthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    // 🚩PLAN-BLOCK#4 — `forwardRef` vì vòng module CÓ THẬT: `permission.module.ts` imports
    // `forwardRef(() => AuthModule)` và `auth.module.ts` imports `forwardRef(() => PermissionModule)`.
    // KHÔNG `@Optional()`: thiếu provider phải là CRASH lúc boot, không phải một guard câm ghi `undefined`.
    @Inject(forwardRef(() => StepUpWindowService))
    private readonly windows: StepUpWindowService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    // WS không có HTTP request — `switchToHttp().getRequest()` trả undefined rồi nổ. Auth của WS ép ở
    // handshake (`RealtimeGateway`), y như lý do `JwtAuthGuard` trả true cho ngữ cảnh non-http.
    if (ctx.getType() !== "http") return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const meta = this.reflector.getAllAndOverride<RequirePermissionMeta | undefined>(
      REQUIRE_PERMISSION,
      [ctx.getHandler(), ctx.getClass()],
    );
    // Nhánh 1 — KHÔNG phải reveal-class. Đọc CÙNG một biểu thức mà `permission.guard.ts:121` dùng
    // (`!!isSensitive && !!requiresReauth`): lệch định nghĩa "reveal-class" giữa hai guard = guard này
    // nạp ngữ cảnh cho route mà engine không đòi, hoặc tệ hơn, không nạp cho route engine có đòi.
    if (!meta?.isSensitive || !meta.requiresReauth) return true;

    const req = ctx.switchToHttp().getRequest<ReauthWritableRequest>();

    // Bộ-5 lấy TỪ JWT (`req.user` do JwtAuthGuard đặt) — KHÔNG từ body/query/params do client gửi.
    const userId = req.user?.id;
    const companyId = req.user?.companyId;
    if (!userId || !companyId) return true;

    // Nhánh 2 — không có `:id` ⇒ không có đối tượng để mở ⇒ PermissionGuard tự deny-object-required.
    const resourceId = req.params?.id ?? null;
    if (resourceId === null) return true;

    let stored: unknown;
    try {
      stored = await this.windows.getValidWindow({
        companyId,
        userId,
        action: meta.action,
        resourceType: meta.resourceType,
        resourceId,
      });
    } catch (err) {
      // Store hỏng (Valkey outage lúc ĐỌC) ⇒ không ghi ⇒ deny ở PermissionGuard. Fail-closed: mất tiện,
      // KHÔNG mất an toàn. Log ERROR để sự cố hạ tầng không núp dưới dạng "user gõ sai mã".
      this.logger.error("Không đọc được cửa sổ step-up — coi như KHÔNG có cửa sổ (fail-closed)", {
        action: meta.action,
        resourceType: meta.resourceType,
        error: err instanceof Error ? err.message : String(err),
      });
      return true;
    }

    // Nhánh 3 — không có cửa sổ. `null`/`undefined` là câu trả lời BÌNH THƯỜNG (chưa step-up), không log.
    if (stored === null || stored === undefined) return true;

    // 🚩PLAN-BLOCK#1 — hợp đồng codec. Không phải `Date` = lỗi lập trình ở đường lưu, phải NHÌN THẤY được.
    if (!(stored instanceof Date)) {
      this.logger.error(
        "StepUpWindowService trả giá trị KHÔNG phải Date — bỏ qua cửa sổ (chuỗi lọt xuống " +
          "isReauthValid sẽ deny vĩnh viễn mà không có lỗi nào được ném)",
        { action: meta.action, resourceType: meta.resourceType, received: typeof stored },
      );
      return true;
    }

    // Dùng lại ĐÚNG phép kiểm của consumer: cái gì `isReauthValid` không nhận thì không đáng ghi.
    if (!isReauthValid(stored, new Date())) return true;

    // ── WRITER DUY NHẤT (§6 điểm 11.2) ────────────────────────────────────────────────────────────
    req.reauthContext = { reauthValidUntil: stored };
    return true;
  }
}
