import { createHmac, randomUUID } from "node:crypto";
import { ForbiddenException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { DatabaseService } from "../../db/db.service";
import { AuditService } from "../../events/audit.service";

/**
 * Cầu SSO MediaOS → fbpost (app vệ tinh SOCIAL — đăng bài Facebook Page).
 *
 * Sao khuôn `LmsSsoService` (S5-LMS-BE-2) và CỐ Ý giữ giống: token HMAC ngắn hạn phát cho CHÍNH
 * user đang đăng nhập, fbpost verify bằng shared secret rồi tự tạo phiên (`/api/auth/sso` phía kia).
 *
 * Token: base64url(JSON {sub, email, name, iat, exp, jti}) + "." + base64url(HMAC-SHA256(payload, secret)).
 * TTL 60s + `jti` dùng-một-lần (fbpost ghi bảng `sso_consumed_tokens`) → chặn phát lại / chia sẻ link.
 *
 * FAIL-CLOSED (giữ nguyên bài học của S5-LMS-BE-2): audit ghi TRƯỚC, chỉ trả `{url}` khi audit đã
 * commit. Mint một credential dùng-một-lần mà không có vết audit thì bằng không mint.
 *
 * ── CỔNG CÔNG TY (khác LmsSsoService — đọc kỹ) ──
 * `DECISIONS-08 SOCIAL-DEC-002`: fbpost chạy SQLite, KHÔNG có `company_id`, không có RLS. Cách giữ
 * BẤT BIẾN #1 ở đây KHÔNG phải lọc ở bảng mà là CHẶN Ở CẦU: chỉ công ty có id khớp
 * `SOCIAL_COMPANY_ID` mới mint được token. Công ty khác không bao giờ nhận được phiên, nên không có
 * gì để lọc. Nếu bỏ cổng này thì mọi tenant dùng chung một kho token Facebook — vỡ bất biến #1 theo
 * cách im lặng nhất.
 *
 * Env (đều optional — thiếu thì endpoint trả 503, KHÔNG chặn boot API):
 *   SOCIAL_SSO_SECRET  — shared secret ≥32 ký tự, PHẢI khớp MEDIAOS_SSO_SECRET phía fbpost.
 *   SOCIAL_BASE_URL    — gốc public của fbpost (vd https://social.example.com).
 *   SOCIAL_COMPANY_ID  — uuid công ty DUY NHẤT được dùng fbpost.
 */
const TOKEN_TTL_MS = 60 * 1000;

/** User tối thiểu để mint + audit: email/name (payload token) + id/companyId (actor + tenant của audit). */
export interface SocialSsoMintUser {
  id: string;
  companyId: string;
  email: string;
  fullName?: string | null;
}

@Injectable()
export class SocialSsoService {
  private readonly secret = process.env.SOCIAL_SSO_SECRET ?? null;
  private readonly baseUrl = process.env.SOCIAL_BASE_URL?.replace(/\/+$/, "") ?? null;
  private readonly companyId = process.env.SOCIAL_COMPANY_ID ?? null;

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  isEnabled(): boolean {
    return Boolean(this.secret && this.baseUrl && this.companyId);
  }

  /**
   * Token-factory THUẦN (không DB, không log, không side-effect) — dựng URL SSO + jti. Public để
   * unit-test crypto/TTL/jti/cổng-công-ty nhanh mà không cần DB; đường DUY NHẤT controller dùng là
   * `mintSsoLink` (có audit).
   *
   * `email`/`companyId` lấy từ JWT của phiên hiện tại, KHÔNG nhận từ input request.
   */
  buildSsoUrl(user: SocialSsoMintUser, nowMs: number = Date.now()): { url: string; jti: string } {
    if (!this.secret || !this.baseUrl || !this.companyId) {
      throw new ServiceUnavailableException("Cầu SSO sang ứng dụng Đăng bài chưa được cấu hình");
    }
    // Cổng công ty — kiểm TRƯỚC khi sinh bất kỳ chất liệu token nào.
    if (user.companyId !== this.companyId) {
      throw new ForbiddenException("Công ty này chưa được bật ứng dụng Đăng bài");
    }

    const jti = randomUUID();
    const payload = {
      sub: user.id,
      email: user.email.toLowerCase(),
      // Tên hiển thị để fbpost khỏi phải gọi ngược lại hỏi. KHÔNG phải secret.
      name: user.fullName ?? "",
      iat: nowMs,
      exp: nowMs + TOKEN_TTL_MS,
      jti,
    };
    const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const sig = createHmac("sha256", this.secret).update(payloadB64).digest("base64url");
    const token = `${payloadB64}.${sig}`;
    return { url: `${this.baseUrl}/api/auth/sso?token=${encodeURIComponent(token)}`, jti };
  }

  /**
   * Mint link SSO + ghi audit ĐỒNG THỜI (FAIL-CLOSED). Thứ tự tuyến tính, KHÔNG try/catch nuốt lỗi:
   *   1. buildSsoUrl — thiếu env → 503, sai công ty → 403, cả hai xảy ra TRƯỚC mọi thao tác DB
   *   2. withTenant(companyId) → audit.record (trong tx) — vỡ CHECK/FK → rollback + throw ⇒ KHÔNG trả url
   *   3. chỉ khi (2) commit mới trả { url }
   * Token nằm TRONG url trả về — KHÔNG bao giờ log hay đưa vào audit before/after (BẤT BIẾN #3):
   * payload audit chỉ có `jti` (đã là định danh, không mở khoá được gì).
   */
  async mintSsoLink(user: SocialSsoMintUser): Promise<{ url: string }> {
    const { url, jti } = this.buildSsoUrl(user);
    await this.db.withTenant(user.companyId, (tx) =>
      this.audit.record(tx, {
        action: "sso_link_minted",
        objectType: "social_sso",
        objectId: jti,
        actorUserId: user.id,
        actorType: "User",
        resultStatus: "Success",
        actionGroup: "INTEGRATION",
        permissionCode: "SOCIAL.POST.VIEW",
      }),
    );
    return { url };
  }
}
