import { CanActivate, ExecutionContext, Injectable, Logger } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { DatabaseService } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { PermissionService } from "../permission/permission.service";
import {
  REQUIRE_PERMISSION,
  type RequirePermissionMeta,
} from "../permission/require-permission.decorator";
import { CHAT_OVERSIGHT_ENDPOINT, chatOversightAuditEntry } from "./chat-oversight.audit";
import type { ChatOversightEndpoint } from "./chat-oversight.audit";

/** Hình dạng request mà guard đọc. Mọi trường optional — guard fail-mềm khi thiếu, không bao giờ mở quyền. */
type OversightRequest = {
  params?: Record<string, string>;
  route?: { path?: string };
  path?: string;
  user?: {
    id?: string;
    companyId?: string;
    /** AC-5: request đến qua PAT (`ApiKeyAuthGuard`). */
    viaApiKey?: boolean;
    /** `action:resourceType` mà PAT được phép. */
    scopeKeys?: string[];
  };
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * S7-CHAT-BE-7 🔒 — ghi `audit_logs` cho lần đọc-vượt **BỊ TỪ CHỐI** (CHAT-ERR-019 · API-13 §5.3 ràng buộc 3).
 *
 * ┌─ VÌ SAO PHẢI LÀ MỘT GUARD RIÊNG CHẠY TRƯỚC `PermissionGuard` ────────────────────────────────────┐
 * │ Ba cách làm "tự nhiên" hơn, cả ba đều PASS review code rồi hỏng:                                  │
 * │  (a) ghi audit rồi ném 403 trong CÙNG transaction ⇒ dòng `Denied` **bị rollback mất** — đúng thứ  │
 * │      ta dựng nó để ghi lại;                                                                       │
 * │  (b) chỉ `PermissionGuard`, trông chờ ghi audit trong thân controller ⇒ thân controller **không   │
 * │      bao giờ chạy** khi bị từ chối ⇒ **0** dòng audit;                                            │
 * │  (c) bỏ `PermissionGuard` để tự quyết ⇒ `route-guard-coverage.e2e-spec` ĐỎ ("@RequirePermission   │
 * │      trang trí"), còn bỏ luôn metadata thì route rơi vào `needVerdict` và phải ký                  │
 * │      `route-verdicts.ts` — tức đưa route NGUY HIỂM NHẤT module vào rổ "không gate" của census.     │
 * │                                                                                                    │
 * │ ⇒ Chốt: giữ CẢ HAI, `@UseGuards(ChatOversightAuditGuard, PermissionGuard)` — THỨ TỰ có nghĩa.      │
 * └────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ **GUARD NÀY KHÔNG BAO GIỜ TRẢ `false`.** Nó chỉ ghi audit rồi `return true`; `PermissionGuard` phía
 * sau là bên DUY NHẤT ném 403. Nhờ vậy fail-closed vẫn là mặc định của hệ (guard audit không thể vô tình
 * mở quyền), census vẫn xanh, và dòng audit từ chối đã COMMIT trước khi 403 rời server.
 *
 * ⚠️ **Lỗi hạ tầng bên trong guard** (ghi audit hỏng, DB rớt) → `logger.error` + `return true`. KHÔNG
 * biến thành allow (không có gì để allow — nó vốn luôn trả `true`) và KHÔNG ném 503: `PermissionGuard`
 * vẫn quyết định cuối cùng, nên đường xấu nhất chỉ mất một dòng audit *từ chối*. Đường **thành công** thì
 * ngược lại — ở đó mất audit là **ROLLBACK** (`ChatOversightService.recordSuccess`), vì audit là điều
 * kiện để dữ liệu được rời server.
 */
@Injectable()
export class ChatOversightAuditGuard implements CanActivate {
  private readonly logger = new Logger(ChatOversightAuditGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly permission: PermissionService,
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    try {
      await this.recordDenialIfAny(ctx);
    } catch (err: unknown) {
      this.logger.error("ChatOversightAuditGuard — không ghi được dòng audit từ chối", {
        error: err instanceof Error ? err.message : String(err),
        handler: ctx.getHandler().name,
      });
    }
    // LUÔN `true` — xem khối cảnh báo ở jsdoc lớp.
    return true;
  }

  private async recordDenialIfAny(ctx: ExecutionContext): Promise<void> {
    // Kill-switch khẩn cấp: `PermissionGuard` fail-OPEN khi cờ này tắt (permission.guard.ts:62), nghĩa là
    // **không có gì bị từ chối**. Ghi `Denied` lúc đó là audit SAI SỰ THẬT — tệ hơn không ghi, vì nó nói
    // rằng một truy cập đã bị chặn trong khi nó được cho qua. Đọc `process.env` per-request đúng như
    // `PermissionGuard` (KI-029): cache lúc dựng sẽ làm hai guard bất đồng khi cờ bị lật lúc chạy.
    if (process.env["PERMISSION_GUARD_ENABLED"] === "false") {
      this.logger.warn(
        "PermissionGuard đang tắt (PERMISSION_GUARD_ENABLED=false) — bỏ qua audit từ chối của đường đọc-vượt",
        { handler: ctx.getHandler().name },
      );
      return;
    }

    // Cặp quyền đọc TỪ METADATA của chính route — KHÔNG hard-code lần thứ hai. Hai bản sao của cặp sẽ
    // trôi, và khi trôi thì guard này ghi "Denied" cho một cặp trong khi `PermissionGuard` cho qua ở cặp
    // khác: audit nói dối, im lặng.
    const meta = this.reflector.getAllAndOverride<RequirePermissionMeta | undefined>(
      REQUIRE_PERMISSION,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!meta) {
      // Route dưới `/chat/oversight/*` mà thiếu `@RequirePermission` là LỖI CẤU HÌNH, không phải hành vi
      // người dùng ⇒ không ghi dòng audit (nó sẽ là dòng "bị từ chối" không ứng với ai). `PermissionGuard`
      // phía sau vẫn fail-closed 403. `chat-oversight.permissions.spec.ts` ép mọi route phải khai meta.
      this.logger.error("Route đọc-vượt thiếu @RequirePermission — không ghi được audit từ chối", {
        handler: ctx.getHandler().name,
        class: ctx.getClass().name,
      });
      return;
    }

    const req = ctx.switchToHttp().getRequest<OversightRequest>();
    const user = req.user;
    // Không có ngữ cảnh tenant thì không mở nổi `withTenant` để ghi. `JwtAuthGuard`/`CompanyGuard` toàn
    // cục đã chạy trước, nên nhánh này chỉ xảy ra khi pipeline bị đổi.
    if (!user?.id || !user.companyId) return;

    const denied = await this.isDenied(user, meta);
    if (!denied) return;

    const roomId = this.roomIdOf(req);
    await this.db.withTenant(user.companyId, (tx) =>
      this.audit.record(
        tx,
        chatOversightAuditEntry({
          actorUserId: user.id as string,
          endpoint: this.endpointOf(req),
          roomId,
          resultStatus: "Denied",
          criteria: { deniedPair: `${meta.action}:${meta.resourceType}` },
        }),
      ),
    );
  }

  /**
   * "PermissionGuard sắp ném 403 hay không" — phải phủ **CẢ HAI** nhánh từ chối của nó:
   *
   * 1. PAT ngoài phạm vi (`permission.guard.ts:100-115`) — short-circuit 403 **TRƯỚC** khi gọi `can()`.
   *    Không mirror vế này thì mọi 403 đến qua PAT **không để lại dấu vết nào** — đúng loại lỗ mà WO này
   *    tồn tại để bịt. Đây là BẢN SAO thứ hai của một luật (rủi ro đã ghi ở §7 micro-plan); ca test
   *    `chat-oversight.permissions.spec.ts` khoá hành vi.
   * 2. `can()` trả `allow: false` — gồm cả lỗi hạ tầng, vì `can()` tự bắt và trả `deny-default`
   *    (fail-closed). Ta ghi `Denied` cho ca đó là ĐÚNG: người gọi thực sự nhận 403.
   */
  private async isDenied(
    user: NonNullable<OversightRequest["user"]>,
    meta: RequirePermissionMeta,
  ): Promise<boolean> {
    if (user.viaApiKey) {
      const requiredKey = `${meta.action}:${meta.resourceType}`;
      const scopeKeys = user.scopeKeys ?? [];
      const inScope =
        scopeKeys.includes(requiredKey) ||
        scopeKeys.includes(`*:${meta.resourceType}`) ||
        scopeKeys.includes(`${meta.action}:*`) ||
        scopeKeys.includes("*:*");
      if (!inScope) return true;
    }

    const decision = await this.permission.can({
      userId: user.id as string,
      companyId: user.companyId as string,
      action: meta.action,
      resourceType: meta.resourceType,
      isSensitive: meta.isSensitive,
    });
    return !decision.allow;
  }

  /**
   * `roomId` đích của dòng audit, `null` khi route không có (`018a`, `019`).
   *
   * Chỉ nhận UUID hợp lệ: `:id` chưa qua `ParseUUIDPipe` ở tầng guard (pipe chạy SAU guard), nên chuỗi
   * rác do client gửi sẽ làm INSERT nổ `22P02` ⇒ mất luôn dòng audit từ chối vì một tham số bậy.
   */
  private roomIdOf(req: OversightRequest): string | null {
    const raw = req.params?.["id"];
    return typeof raw === "string" && UUID_RE.test(raw) ? raw : null;
  }

  /**
   * Nhãn loại truy cập suy từ ĐƯỜNG DẪN đã khai của route (`req.route.path`), không từ URL thật: URL thật
   * mang giá trị `:id` của người dùng, còn ta cần khuôn `/chat/oversight/rooms/:id/messages`.
   */
  private endpointOf(req: OversightRequest): ChatOversightEndpoint {
    const path = req.route?.path ?? req.path ?? "";
    if (path.includes("/messages")) return CHAT_OVERSIGHT_ENDPOINT.ROOM_MESSAGES;
    if (path.includes("/audit")) return CHAT_OVERSIGHT_ENDPOINT.AUDIT_LOG;
    if (path.includes("/rooms/")) return CHAT_OVERSIGHT_ENDPOINT.ROOM_DETAIL;
    return CHAT_OVERSIGHT_ENDPOINT.ROOM_SEARCH;
  }
}
