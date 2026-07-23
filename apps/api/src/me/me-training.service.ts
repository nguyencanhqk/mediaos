import {
  BadGatewayException,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { type MeTrainingResponse, meTrainingResponseSchema } from "@mediaos/contracts";
import {
  LmsProgressClient,
  type LmsProgressFetchResult,
} from "../integrations/lms/lms-progress-client.service";
import { ValkeyService } from "../permission/valkey.service";
import {
  ME_TRAINING_CACHE_TTL_SEC,
  ME_TRAINING_CONTRACT_MISMATCH_CODE,
  ME_TRAINING_LMS_DISABLED_CODE,
  ME_TRAINING_LMS_UNAVAILABLE_CODE,
  meTrainingCacheKey,
} from "./me.constants";

/** Actor own-scope — LUÔN từ `req.user` (JWT). KHÔNG có đường nào nhận email/id từ client (chống IDOR). */
export interface MeTrainingActor {
  id: string;
  companyId: string;
  email: string;
}

/**
 * S5-LMS-BE-3 — MeTrainingService: proxy tiến độ học own-scope (`GET /me/training`).
 *
 * PROXY THUẦN — **KHÔNG ghi DB MediaOS** (đúng B06): không bảng mới, không migration, không outbox.
 *
 * CỐ Ý KHÔNG ghi `audit_logs`: đây là hành động ĐỌC own-scope, FE poll ~60s ⇒ audit sẽ thành rác (bài học
 * S5-LMS-BE-4: chỉ ghi khi CÓ THAY ĐỔI THẬT), và 5 section `GET /me/*` hiện có cũng không audit. Đường
 * "mở LMS" có audit rồi (LmsSsoService.mintSsoLink) — đó mới là hành động cấp quyền truy cập.
 *
 * BẤT BIẾN #1 (cô lập dữ liệu): không có query DB nào, nhưng `companyId` vẫn là MỘT PHẦN cache-key ⇒ hai
 * actor không bao giờ đọc trúng entry của nhau; và company-gate `LMS_COMPANY_ID` (nếu owner đã khai) chặn
 * tenant ngoài phạm vi LMS gửi email sang hệ ngoài — mirror fail-closed isolation của auto-sync (BE-1).
 */
@Injectable()
export class MeTrainingService {
  private readonly logger = new Logger(MeTrainingService.name);

  /**
   * Company DUY NHẤT trong phạm vi LMS (LMS là hệ 1-công-ty). Chưa khai ⇒ giữ posture SSO (N=1, không gate).
   * Đọc THEO REQUEST (không cache lúc construct): env đọc-mỗi-lần rẻ, và giữ được khả năng kiểm chứng
   * fail-closed trong int-spec (bật/tắt gate quanh 1 request thật) — mirror `ALLOW_SUPERUSER_ROTATION`.
   */
  private lmsCompanyId(): string | null {
    return process.env.LMS_COMPANY_ID ?? null;
  }

  constructor(
    private readonly client: LmsProgressClient,
    private readonly valkey: ValkeyService,
  ) {}

  async getMyTraining(actor: MeTrainingActor): Promise<MeTrainingResponse> {
    this.assertLmsAvailable(actor);
    const email = this.requireActorEmail(actor);

    const key = meTrainingCacheKey(actor.companyId, actor.id);
    const cached = await this.readCache(key);
    if (cached) return cached;

    const fetched = await this.fetchFromLms(email);
    const response = this.toResponse(fetched);

    // Cache best-effort (ValkeyService fail-open): lỗi ghi KHÔNG được làm hỏng request của người dùng.
    await this.valkey.set(key, JSON.stringify(response), ME_TRAINING_CACHE_TTL_SEC);
    return response;
  }

  /**
   * Danh tính học viên = EMAIL của actor. Phiên PAT/API-key (`ApiKeyAuthGuard`) đặt `req.user` KHÔNG có
   * `email` ⇒ nếu đi tiếp sẽ nổ TypeError → 500 câm. Chặn tường minh: endpoint này là CÁ NHÂN, chỉ dùng
   * được với phiên người dùng thật. (Fail-closed: KHÔNG suy đoán email từ DB theo userId — muốn thêm thì
   * phải là quyết định thiết kế riêng, không phải fallback lặng lẽ.)
   */
  private requireActorEmail(actor: MeTrainingActor): string {
    const email = actor.email?.trim();
    if (!email) {
      throw new ForbiddenException(
        "GET /me/training chỉ dùng với phiên đăng nhập của người dùng (không hỗ trợ API key).",
      );
    }
    return email;
  }

  /** 503 khi tích hợp chưa cấu hình HOẶC company ngoài phạm vi LMS (fail-closed, KHÔNG rò email). */
  private assertLmsAvailable(actor: MeTrainingActor): void {
    const configured = this.client.isEnabled();
    const scoped = this.lmsCompanyId();
    const inScope = scoped === null || scoped === actor.companyId;
    if (configured && inScope) return;
    throw new ServiceUnavailableException({
      code: ME_TRAINING_LMS_DISABLED_CODE,
      message: `${ME_TRAINING_LMS_DISABLED_CODE}: tích hợp LMS chưa sẵn sàng cho tài khoản này.`,
    });
  }

  private async fetchFromLms(email: string): Promise<LmsProgressFetchResult> {
    try {
      return await this.client.fetchProgress(email);
    } catch (err) {
      // Client đã log lý do KHÔNG kèm PII/secret. Ở đây chỉ ghi tên lỗi + KHÔNG ném message gốc ra client
      // (message có thể chứa URL/email). 502 = "hệ ngoài không phản hồi", người dùng thử lại được.
      this.logger.warn(
        `LMS progress không khả dụng: ${err instanceof Error ? err.name : "Unknown"}`,
      );
      throw new BadGatewayException({
        code: ME_TRAINING_LMS_UNAVAILABLE_CODE,
        message: `${ME_TRAINING_LMS_UNAVAILABLE_CODE}: không lấy được dữ liệu đào tạo từ LMS.`,
      });
    }
  }

  /**
   * Biên giới "dữ liệu ngoài" — MỌI byte của LMS chỉ vượt qua bằng Zod. Parse fail (LMS bump version /
   * đổi shape) ⇒ 502 contract-mismatch, TUYỆT ĐỐI không forward object lệch (fail-safe, không render mù).
   * KHÔNG log issue của Zod: `received` của issue chứa giá trị thật (email/tên người học).
   */
  private toResponse(fetched: LmsProgressFetchResult): MeTrainingResponse {
    if (!fetched.found) return { status: "no_account", progress: null };

    const parsed = meTrainingResponseSchema.safeParse({ status: "ok", progress: fetched.body });
    if (!parsed.success) {
      this.logger.warn("LMS progress: payload lệch hợp đồng v1 — trả 502 contract-mismatch");
      throw new BadGatewayException({
        code: ME_TRAINING_CONTRACT_MISMATCH_CODE,
        message: `${ME_TRAINING_CONTRACT_MISMATCH_CODE}: dữ liệu LMS không khớp hợp đồng.`,
      });
    }
    return parsed.data;
  }

  /**
   * Đọc cache. Giá trị được RE-VALIDATE qua chính schema response: entry cũ/hỏng (đổi shape sau deploy,
   * hoặc bị ghi đè) → coi như MISS và gọi lại LMS, KHÔNG biến lỗi-cache thành 502 cho người dùng.
   */
  private async readCache(key: string): Promise<MeTrainingResponse | null> {
    const raw = await this.valkey.get(key);
    if (!raw) return null;
    try {
      const parsed = meTrainingResponseSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch {
      return null; // JSON hỏng — chỉ bỏ qua cache (KHÔNG log nội dung: cache chứa dữ liệu học của user).
    }
  }
}
