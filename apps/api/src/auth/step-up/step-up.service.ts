import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from "@nestjs/common";
import type { StepUpRequest, StepUpResponse } from "@mediaos/contracts";
import { loadEnv } from "../../config/env.schema";
import { rlKey } from "../../common/valkey/valkey-key";
import { DatabaseService, type TenantTx } from "../../db/db.service";
import { AuditService } from "../../events/audit.service";
import { LoginRateLimiter } from "../login-rate-limiter";
import { SecurityEventWriter } from "../security-event-writer.service";
import { TwoFactorService } from "../two-factor.service";
import {
  REVEAL_CLASS_PAIRS_TOKEN,
  isRevealClassPair,
  type RevealClassPair,
} from "./reveal-class-pairs";
import { STEP_UP_AUDIT_ACTIONS, STEP_UP_ERROR_CODES } from "./step-up.constants";
import { StepUpWindowService, type StepUpWindowKey } from "./step-up-window.service";

/** Chủ thể LẤY TỪ JWT (`req.user`) — KHÔNG bao giờ từ body (BẤT BIẾN #1). */
export interface StepUpActor {
  id: string;
  companyId: string;
}

/** Ngữ cảnh ghi vào audit/security-event. CHỈ metadata — không mã, không secret (BẤT BIẾN #3). */
interface StepUpMetadata {
  action: string;
  resourceType: string;
  resourceId: string;
  reauthValidUntil?: string;
}

/**
 * StepUpService — LÕI `POST /api/v1/auth/step-up` (DECISIONS-09 §6 điểm 2, 3, 9, 10).
 *
 * ─── THỨ TỰ LÀ HỢP ĐỒNG (§6.9) ──────────────────────────────────────────────────────────────────
 *   Zod (ở ranh giới, `ZodValidationPipe` của controller)
 *     → `isLocked()` **ĐẦU TIÊN**  (đang khoá ⇒ 429 NGAY, KHÔNG ghi hàng nào, verify gọi 0 lần)
 *     → cặp ∈ `REVEAL_CLASS_PAIRS`  (ngoài registry ⇒ `recordFailure` + audit `Denied`)
 *     → verify TOTP THUẦN
 *     → SAI: `recordFailure` + audit `Failure` + `STEP_UP_FAILED`, KHÔNG cấp cửa sổ
 *     → ĐÚNG: `reset(key)` + cấp cửa sổ + audit `Success` + `STEP_UP_GRANTED`.
 * `isLocked()` vẫn nằm TRƯỚC verify — đảo hai bước đó là biến rate-limit thành trang trí trên đúng một
 * oracle TOTP 6 số. Vòng sửa `FIX-1-BE-STEPUP-FLOOD` siết thêm một nấc: khoá đứng trước CẢ cổng registry.
 *
 * ─── VÌ SAO KHOÁ PHẢI ĐỨNG TRƯỚC REGISTRY (A09 — bồi hàng append-only) ─────────────────────────
 * Registry hôm nay RỖNG có chủ đích (D3) ⇒ **mọi** lời gọi dừng ở cổng registry. Bản đầu đặt cổng đó
 * TRƯỚC `isLocked()` và nhánh đó ghi 1 hàng `audit_logs` + 1 hàng `user_security_events` rồi ném, mà
 * KHÔNG bồi bucket; `app.module.ts` cũng không có throttler toàn cục. Hệ quả đo được: một tài khoản đã
 * đăng nhập bất kỳ lặp `POST /auth/step-up` là bồi được VÔ HẠN hàng vào hai bảng KHÔNG XOÁ ĐƯỢC, vừa
 * phình lưu trữ vừa chôn tín hiệu `STEP_UP_FAILED` thật dưới nhiễu. Hai nửa của bản vá:
 *   (a) `isLocked()` lên đầu ⇒ khi đã khoá, request thứ N+1 trở đi ném 429 mà KHÔNG chạm DB;
 *   (b) MỌI nhánh từ chối CÓ GHI VẾT đều gọi `recordFailure(bucketKey, STEP_UP_MAX_ATTEMPTS)` ⇒ trần
 *       lưu trữ mỗi cửa sổ khoá là `STEP_UP_MAX_ATTEMPTS` hàng, không phải vô hạn.
 * Nhánh khoá ghi 0 hàng KHÔNG làm mất vết: chính `STEP_UP_MAX_ATTEMPTS` lượt dựng nên cái khoá đó đều đã
 * có hàng audit + security-event. Bucket khoá theo `(companyId|userId)` lấy từ JWT ⇒ kẻ bồi chỉ tự khoá
 * CHÍNH MÌNH, không quấy rối được ai (§6.9).
 *
 * ─── D1/D2 (§6.2) ───────────────────────────────────────────────────────────────────────────────
 * Đường verify là `TwoFactorService.verifyTotpForStepUp` — TOTP THUẦN, marker replay RIÊNG
 * (`stepup-totp`). **KHÔNG** gọi đường verify của bước-2 LOGIN (method claim marker `totp-step` trong
 * `two-factor.service.ts` — nó ĐỐT mã khôi phục khi TOTP sai) và **KHÔNG** chạm bảng
 * `user_recovery_codes`.
 *
 * ⚠️ Thư mục này CỐ Ý không chứa literal tên method login đó: cổng nghiệm thu D1 đếm
 * `grep -rn <tên method> apps/api/src/auth/step-up` và phải ra 0. Ca "0 lần gọi" trong spec dựng tên
 * bằng ghép chuỗi để vừa GIỮ được phép đo, vừa không làm cổng đỏ oan.
 *
 * ─── §6(9) RATE-LIMIT ───────────────────────────────────────────────────────────────────────────
 * Khoá `rl:{envScope}:stepup:{companyId}|{userId}` lấy TỪ JWT — hai định danh ổn định, không suy từ
 * request. CẤM nhúng địa chỉ IP của request (sau cloudflared mọi giá trị đều là `::1` — KI-066 ⇒
 * "per-IP" thoái hoá thành bucket TOÀN CÔNG TY: một người gõ sai khoá tất cả) và CẤM nhúng địa chỉ thư
 * điện tử (mở đường quấy rối victim: khoá người khác bằng cách gõ sai tên họ). Bucket `stepup` TÁCH
 * HẲN hai bucket của login.
 *
 * ─── §6(10) HAI NHÁNH ĐỀU ĐỂ LẠI VẾT, KHÔNG MIGRATION ───────────────────────────────────────────
 * Mỗi lượt (đúng và sai) ghi 1 hàng `audit_logs` + 1 hàng `user_security_events` trong CÙNG tx.
 * `objectType='auth'` đã có sẵn trong CHECK; `event_type` là `text` không CHECK ⇒ head migration giữ
 * nguyên. Metadata chỉ `action`/`resourceType`/`resourceId`(/`reauthValidUntil`).
 */
@Injectable()
export class StepUpService {
  private readonly env = loadEnv();

  constructor(
    private readonly dbsvc: DatabaseService,
    private readonly twoFactor: TwoFactorService,
    private readonly windows: StepUpWindowService,
    private readonly rateLimiter: LoginRateLimiter,
    private readonly audit: AuditService,
    private readonly securityEvents: SecurityEventWriter,
    @Inject(REVEAL_CLASS_PAIRS_TOKEN) private readonly pairs: readonly RevealClassPair[],
  ) {}

  async stepUp(actor: StepUpActor, input: StepUpRequest): Promise<StepUpResponse> {
    const bucketKey = rlKey("stepup", `${actor.companyId}|${actor.id}`);
    const windowKey: StepUpWindowKey = {
      companyId: actor.companyId,
      userId: actor.id,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
    };
    const metadata: StepUpMetadata = {
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
    };

    // (1) Bucket đang khoá ⇒ TỪ CHỐI NGAY: không verify (không cho brute-force chạy tiếp dưới khoá) và
    //     KHÔNG ghi hàng append-only nào (không cho lời gọi lặp bồi lưu trữ — A09, xem docblock).
    if (await this.rateLimiter.isLocked(bucketKey)) {
      // 429 dùng mã nền `SYSTEM-ERR-RATE-LIMIT` (httpStatusToCode) — KHÔNG đẻ mã mới cho 429.
      throw new HttpException(
        "Bạn đã thử quá nhiều lần. Vui lòng đợi rồi thử lại.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // (2) Cặp ∈ registry. Hôm nay registry RỖNG ⇒ mọi cặp dừng ở đây — trạng thái ĐÚNG, xem D3.
    if (!isRevealClassPair(this.pairs, input.action, input.resourceType)) {
      await this.denyAndCount(actor, bucketKey, metadata);
      throw new BadRequestException({
        code: STEP_UP_ERROR_CODES.PAIR_NOT_ALLOWED,
        message: "Hành động này không hỗ trợ xác thực lại.",
      });
    }

    // (3) Verify TOTP thuần.
    const outcome = await this.twoFactor.verifyTotpForStepUp(actor.id, actor.companyId, input.code);

    if (outcome === "not-enrolled") {
      await this.denyAndCount(actor, bucketKey, metadata);
      throw new ConflictException({
        code: STEP_UP_ERROR_CODES.TWO_FACTOR_REQUIRED,
        message: "Bạn cần bật xác thực 2 bước (2FA) trước khi xác thực lại.",
      });
    }

    if (outcome !== "ok") {
      await this.rateLimiter.recordFailure(bucketKey, this.env.STEP_UP_MAX_ATTEMPTS);
      await this.writeOutcome(actor, STEP_UP_AUDIT_ACTIONS.FAILED, "Failure", metadata);
      throw new BadRequestException({
        code: STEP_UP_ERROR_CODES.INVALID_CODE,
        message: "Mã xác thực không đúng.",
      });
    }

    // (4) Thành công: xoá trạng thái rate-limit rồi cấp cửa sổ + ghi vết.
    await this.rateLimiter.reset(bucketKey);
    const reauthValidUntil = await this.dbsvc.withTenant(actor.companyId, async (tx) => {
      // THỨ TỰ CÓ Ý: cấp cửa sổ TRƯỚC, ghi audit SAU, cả hai trong một tx. `grant()` ném 503 (Valkey
      // outage) ⇒ tx rollback ⇒ KHÔNG để lại hàng audit "granted" nói dối về một cửa sổ chưa từng tồn
      // tại. Chiều ngược lại (audit trước) không làm được vì `reauthValidUntil` phải là mốc ĐÃ ghi được.
      const until = await this.windows.grant(windowKey);
      const granted: StepUpMetadata = { ...metadata, reauthValidUntil: until.toISOString() };
      await this.write(tx, actor, STEP_UP_AUDIT_ACTIONS.GRANTED, "Success", granted);
      return until;
    });

    return { reauthValidUntil: reauthValidUntil.toISOString() };
  }

  /**
   * Nhánh TỪ CHỐI có ghi vết (`registry` và `not-enrolled`): bồi bucket TRƯỚC rồi mới ghi.
   *
   * Bồi trước có chủ đích — nếu `writeOutcome` ném (DB rớt) thì bộ đếm ĐÃ tăng, nên một kẻ lặp lời gọi
   * không tận dụng được lỗi hạ tầng để chạy vô hạn. Đây là nửa (b) của bản vá A09: nhánh nào ghi hàng
   * append-only thì nhánh đó PHẢI trả giá bằng một lần bồi bucket.
   */
  private async denyAndCount(
    actor: StepUpActor,
    bucketKey: string,
    metadata: StepUpMetadata,
  ): Promise<void> {
    await this.rateLimiter.recordFailure(bucketKey, this.env.STEP_UP_MAX_ATTEMPTS);
    await this.writeOutcome(actor, STEP_UP_AUDIT_ACTIONS.DENIED, "Denied", metadata);
  }

  /** Nhánh TỪ CHỐI/THẤT BẠI: ghi vết rồi TRẢ VỀ — caller ném NGOÀI tx (ném trong tx sẽ rollback vết). */
  private async writeOutcome(
    actor: StepUpActor,
    action: string,
    resultStatus: "Denied" | "Failure",
    metadata: StepUpMetadata,
  ): Promise<void> {
    await this.dbsvc.withTenant(actor.companyId, async (tx) => {
      await this.write(tx, actor, action, resultStatus, metadata);
    });
  }

  /** Dual-write audit + timeline bảo mật trong CÙNG tx (mẫu 2FA — §6.10). */
  private async write(
    tx: TenantTx,
    actor: StepUpActor,
    action: string,
    resultStatus: "Success" | "Denied" | "Failure",
    metadata: StepUpMetadata,
  ): Promise<void> {
    await this.audit.record(tx, {
      action,
      objectType: "auth",
      objectId: metadata.resourceId,
      actorUserId: actor.id,
      resultStatus,
      metadata,
    });
    await this.securityEvents.record(tx, {
      eventType: resultStatus === "Success" ? "STEP_UP_GRANTED" : "STEP_UP_FAILED",
      userId: actor.id,
      actorUserId: actor.id,
      payload: metadata,
    });
  }
}
