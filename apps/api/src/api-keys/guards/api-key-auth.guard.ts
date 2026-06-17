import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { API_KEY_TOKEN_PREFIX } from "@mediaos/contracts";
import { TokenService } from "../../auth/token.service";

/** 1 PAT đã resolve theo token_hash (auth-path). KHÔNG chứa token plaintext (chỉ hash để so sánh). */
export interface ApiKeyAuthRecord {
  id: string;
  userId: string;
  companyId: string;
  /** SHA-256 hex — so với hash của token client gửi (KHÔNG phải secret khôi phục được). */
  tokenHash: string;
  scopePermissionIds: string[];
  expiresAt: Date | null;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
}

/**
 * Port resolve PAT cho auth-path. Repository hiện thực. findByTokenHash tra theo HASH (collision-free,
 * KHÔNG dựa prefix có thể trùng giữa tenant) chạy NGOÀI tenant context (token không mang company_id) qua
 * SECURITY DEFINER function. recordUsage/touchLastUsed chạy withTenant(company của key). resolveScopeKeys
 * map scope_permission_ids → "action:resourceType".
 */
export interface ApiKeyAuthLookup {
  /** Tra PAT theo SHA-256 hash của token (token_hash là duy nhất → không lệ thuộc prefix-uniqueness). */
  findByTokenHash(tokenHash: string): Promise<ApiKeyAuthRecord | null>;
  recordUsage(record: ApiKeyAuthRecord, route: string | null, ip: string | null): Promise<void>;
  touchLastUsed(record: ApiKeyAuthRecord): Promise<void>;
  /** Optional: map scope ids → "action:resourceType" keys (PermissionGuard đọc req.user.scopeKeys). */
  resolveScopeKeys?(permissionIds: string[]): Promise<string[]>;
}

/** req.user khi PAT auth (mở rộng AuthenticatedUser). viaApiKey=true bật nhánh scope∩grant ở PermissionGuard. */
export interface ApiKeyUser {
  id: string;
  companyId: string;
  viaApiKey: true;
  apiKeyId: string;
  scopePermissionIds: string[];
  /** "action:resourceType" mà key được phép (resolve từ scope ids) — PermissionGuard so khớp. */
  scopeKeys: string[];
  aud: "tenant";
}

type ApiKeyRequest = Request & { user?: unknown };

/**
 * ApiKeyAuthGuard (AC-5) — chạy TRƯỚC JwtAuthGuard trong pipeline GLOBAL.
 *
 * PASS-THROUGH (return true, KHÔNG set req.user): non-http (WS), header vắng, hoặc token KHÔNG bắt đầu
 *   `mok_` (JWT thường) → để JwtAuthGuard xử lý. ĐÂY là rào chống "guard nuốt nhầm JWT".
 *
 * mok_ token: hash token → resolve theo token_hash → check expires_at>now & revoked_at IS NULL (fail-closed,
 *   401 nếu sai). Set req.user{viaApiKey, scopePermissionIds, scopeKeys, companyId, aud:'tenant'}. Ghi
 *   api_key_usages + debounced touch best-effort (lỗi ghi KHÔNG chặn request). MỌI data-access sau đó chạy
 *   withTenant(company của key) → RLS scope đúng tenant.
 */
@Injectable()
export class ApiKeyAuthGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyAuthGuard.name);

  constructor(
    private readonly tokens: TokenService,
    private readonly lookup: ApiKeyAuthLookup,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    // WS / non-http: APP_GUARD toàn cục cũng chạy cho gateway handler → pass-through (mirror JwtAuthGuard).
    if (ctx.getType() !== "http") return true;

    const req = ctx.switchToHttp().getRequest<ApiKeyRequest>();
    const authHeader = req.headers["authorization"];
    // Header vắng hoặc không Bearer → pass-through (JwtAuthGuard ném 401 nếu route cần auth).
    if (!authHeader || !authHeader.startsWith("Bearer ")) return true;

    const token = authHeader.slice(7);
    // KHÔNG phải PAT (JWT thường) → pass-through. Phân biệt bằng prefix mok_.
    if (!token.startsWith(API_KEY_TOKEN_PREFIX)) return true;

    // Từ đây: token LÀ PAT → fail-closed mọi lỗi (401). Tra theo HASH (collision-free): hash token client
    // rồi tìm đúng hàng theo token_hash (KHÔNG dựa prefix có thể trùng giữa tenant → tránh chọn nhầm hàng).
    const candidateHash = this.tokens.hashToken(token);
    let record: ApiKeyAuthRecord | null;
    try {
      record = await this.lookup.findByTokenHash(candidateHash);
    } catch (err) {
      this.logger.error("ApiKeyAuthGuard lookup error — fail-closed 401", {
        error: err instanceof Error ? err.message : String(err),
      });
      throw new UnauthorizedException("API key xác thực thất bại");
    }

    if (!record) {
      throw new UnauthorizedException("API key không hợp lệ");
    }

    const now = Date.now();
    if (record.revokedAt) {
      throw new UnauthorizedException("API key đã bị thu hồi");
    }
    if (record.expiresAt && record.expiresAt.getTime() <= now) {
      throw new UnauthorizedException("API key đã hết hạn");
    }

    // Resolve scope ids → "action:resourceType" keys (PermissionGuard so khớp). Lỗi resolve → fail-closed 401
    // (KHÔNG để scope rỗng lọt thành "bypass" — scopeKeys rỗng ở PermissionGuard = deny mọi route).
    let scopeKeys: string[] = [];
    if (this.lookup.resolveScopeKeys) {
      try {
        scopeKeys = await this.lookup.resolveScopeKeys(record.scopePermissionIds);
      } catch (err) {
        this.logger.error("ApiKeyAuthGuard scope resolve error — fail-closed 401", {
          error: err instanceof Error ? err.message : String(err),
        });
        throw new UnauthorizedException("API key scope không hợp lệ");
      }
    }

    const user: ApiKeyUser = {
      id: record.userId,
      companyId: record.companyId,
      viaApiKey: true,
      apiKeyId: record.id,
      scopePermissionIds: record.scopePermissionIds,
      scopeKeys,
      aud: "tenant",
    };
    req.user = user;

    // Best-effort: ghi usage append-only + debounced touch. KHÔNG chặn request nếu ghi lỗi (rủi ro #6:
    // tránh UPDATE storm; touch đã debounce). Lỗi ghi log ở mức warn — không nuốt câm (silent-failure).
    const route = req.originalUrl ?? req.url ?? null;
    const ip = req.ip ?? null;
    void this.lookup.recordUsage(record, route, ip).catch((err: unknown) =>
      this.logger.warn("api_key_usages insert failed (best-effort)", {
        apiKeyId: record.id,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    void this.lookup.touchLastUsed(record).catch((err: unknown) =>
      this.logger.warn("api_keys.last_used_at touch failed (best-effort)", {
        apiKeyId: record.id,
        error: err instanceof Error ? err.message : String(err),
      }),
    );

    return true;
  }
}
