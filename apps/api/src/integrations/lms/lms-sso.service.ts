import { createHmac, randomUUID } from "node:crypto";
import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { DatabaseService } from "../../db/db.service";
import { AuditService } from "../../events/audit.service";

/**
 * Cầu SSO MediaOS → LMS (fmc-app). Phát token HMAC ngắn hạn cho CHÍNH user đang đăng nhập;
 * LMS verify bằng shared secret rồi tự tạo phiên (route /api/auth/sso phía LMS).
 *
 * Token: base64url(JSON {email, iat, exp, jti}) + "." + base64url(HMAC-SHA256(payload, secret)).
 * TTL 60s + jti một-lần (LMS ghi bảng sso_consumed_tokens) → chặn replay/chia sẻ link.
 *
 * S5-LMS-BE-2 (trả nợ audit #253): mỗi lần MINT thành công ghi 1 row audit_logs objectType='lms_sso'
 * action='sso_link_minted' objectId=jti (mig 0509). FAIL-CLOSED: audit ghi TRƯỚC, chỉ trả {url} khi
 * audit đã commit — audit vỡ → withTenant rollback + throw → request 500, token KHÔNG rò ra ngoài
 * (mint 1 credential một-lần mà không có vết audit = vô hiệu hoá chính món nợ đang trả). BẤT BIẾN #3:
 * KHÔNG token/chữ ký/secret/email vào before/after — payload audit chỉ {jti, actor}.
 *
 * Env (đều optional — thiếu thì endpoint trả 503, không chặn boot):
 *   LMS_SSO_SECRET — shared secret ≥32 ký tự, PHẢI khớp MEDIAOS_SSO_SECRET phía LMS.
 *   LMS_BASE_URL   — gốc public của LMS (vd https://lms.example.com).
 * Đọc process.env trực tiếp theo mẫu ObjectStorageService (validate ở env.schema lúc boot).
 */
const TOKEN_TTL_MS = 60 * 1000;

/** User tối thiểu để mint + audit: email (payload token) + id/companyId (actor + tenant của audit). */
export interface SsoMintUser {
  id: string;
  companyId: string;
  email: string;
}

@Injectable()
export class LmsSsoService {
  private readonly secret = process.env.LMS_SSO_SECRET ?? null;
  private readonly baseUrl = process.env.LMS_BASE_URL?.replace(/\/+$/, "") ?? null;

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  isEnabled(): boolean {
    return Boolean(this.secret && this.baseUrl);
  }

  /**
   * Token-factory THUẦN (không DB, không log, không side-effect) — dựng URL SSO + jti cho user hiện tại
   * (email lấy từ JWT, KHÔNG nhận từ input). Đường DUY NHẤT controller dùng là `mintSsoLink` (có audit);
   * method public để unit-test crypto/TTL/jti nhanh không cần DB. Thiếu env → 503.
   */
  buildSsoUrl(email: string): { url: string; jti: string } {
    if (!this.secret || !this.baseUrl) {
      throw new ServiceUnavailableException("LMS SSO chưa được cấu hình");
    }
    const now = Date.now();
    const jti = randomUUID();
    const payload = { email: email.toLowerCase(), iat: now, exp: now + TOKEN_TTL_MS, jti };
    const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const sig = createHmac("sha256", this.secret).update(payloadB64).digest("base64url");
    const token = `${payloadB64}.${sig}`;
    return { url: `${this.baseUrl}/api/auth/sso?token=${encodeURIComponent(token)}`, jti };
  }

  /**
   * Mint link SSO + ghi audit ĐỒNG THỜI (FAIL-CLOSED). Thứ tự tuyến tính, KHÔNG try/catch nuốt lỗi:
   *   1. buildSsoUrl (thiếu env → throw 503 TRƯỚC mọi DB ⇒ không audit)
   *   2. withTenant(companyId) → audit.record (tx) — vỡ CHECK/FK/enum → rollback + throw ⇒ KHÔNG trả url
   *   3. chỉ khi (2) commit mới trả { url }
   * Token nằm TRONG url trả về (response) — KHÔNG bao giờ log/đưa vào audit before/after (BẤT BIẾN #3).
   */
  async mintSsoLink(user: SsoMintUser): Promise<{ url: string }> {
    const { url, jti } = this.buildSsoUrl(user.email);
    await this.db.withTenant(user.companyId, (tx) =>
      this.audit.record(tx, {
        action: "sso_link_minted",
        objectType: "lms_sso",
        objectId: jti,
        actorUserId: user.id,
        actorType: "User",
        resultStatus: "Success",
        actionGroup: "INTEGRATION",
        permissionCode: "LMS.ACCESS",
      }),
    );
    return { url };
  }
}
