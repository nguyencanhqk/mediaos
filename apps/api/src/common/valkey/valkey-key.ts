import { loadEnv } from "../../config/env.schema";
import { resolveEnvScope } from "../../realtime/ws-adapter-config";

/**
 * S10-FND-VALKEYSCOPE-1 — CHỖ DỰNG KHOÁ VALKEY DUY NHẤT của apps/api.
 *
 * ─── VÌ SAO TỒN TẠI ─────────────────────────────────────────────────────────────────────────────
 * Bốn môi trường của dự án (`.env` PROD · `.env.dev` · `.env.dev-online` · `apps/api/.env` test-only)
 * đều trỏ CÙNG MỘT Valkey `redis://localhost:6379`, CÙNG db0. Đo 17/08/2026 trên máy PROD: 288 khoá
 * đang sống, trong đó `perm:cap` = 253. dev-online là bản CLONE của PROD (cùng company `funtime`, cùng
 * userId) ⇒ khoá dựng không mang danh tính môi trường sẽ TRÙNG BIT-BY-BIT giữa hai môi trường:
 *   · `perm:cap` là cache QUYẾT ĐỊNH QUYỀN — một lượt nạp ở dev-online phục vụ luôn cho PROD;
 *   · `rl:ip:*:lock` khoá đăng nhập — gõ sai ở máy dev khoá luôn người dùng PROD (đã quan sát thật);
 *   · `idem:*` — retry của môi trường này phát lại kết quả của môi trường kia.
 *
 * ─── MỘT PHÉP SUY, KHÔNG HAI ────────────────────────────────────────────────────────────────────
 * `envScope` lấy TỪ `resolveEnvScope()` của `realtime/ws-adapter-config.ts` (đã có sẵn từ
 * S8-CHAT-UX-RT-1 cho kênh Socket.IO + khoá presence). CỐ Ý import ngược tầng `common/ → realtime/`
 * thay vì move: move sinh churn lớn, và quan trọng hơn — viết phép suy THỨ HAI là mở cửa cho hai
 * không gian khoá lệch nhau rồi trôi mà không ai đo được. Nếu bạn đang định "sửa cho đúng tầng":
 * hãy MOVE hàm và cập nhật cả hai chỗ gọi, ĐỪNG chép thêm một bản.
 *
 * ─── HÌNH DẠNG KHOÁ ─────────────────────────────────────────────────────────────────────────────
 *   `{namespace}:{envScope}:{subtype}:{phần còn lại}`
 * envScope đứng SỚM để vận hành `--scan --pattern 'rl:production:mediaos:*'` đọc được môi trường bằng
 * MẮT. Với `idem:`, envScope nằm NGOÀI sha256 vì lý do đó (nhét vào material hash vẫn cô lập được
 * nhưng SCAN mất khả năng phân biệt môi trường).
 * NGOẠI LỆ đã đúng sẵn và KHÔNG đụng: `chat:presence:{envScope}:…` (scope ở đoạn 2) và
 * `socket.io:{envScope}` — cổng `isKeyScoped` neo theo SEGMENT nên nhận cả hai vị trí.
 *
 * ─── CHU KỲ CHUYỂN TIẾP — ĐÃ ĐÓNG 19/08/2026 (S10-FND-VALKEYSCOPE-2) ────────────────────────────
 * Lúc đổi hình dạng khoá, MỌI khoá cũ thành mồ côi. Phần lớn chỉ là cache và tự hết hạn (`idem:` 900s,
 * `me:training:` 60s), nhưng HAI họ thì KHÔNG vô hại: marker single-use `replay:*` (challenge bước-2
 * 2FA đã tiêu thụ claim LẠI được) và `perm:cap:*` (đường invalidate không chạm khoá cũ ⇒ rollback
 * trong TTL 300s dựng lại grant TRƯỚC-thu-hồi). Vì thế đã có đọc-kép/ghi-kép + miễn trừ cổng, đúng
 * MỘT chu kỳ deploy.
 *
 * SỐ ĐO TRƯỚC KHI GỠ (19/08/2026, Valkey của máy PROD, sau khi bản mang S10-FND-VALKEYSCOPE-1 chạy hết
 * một chu kỳ deploy): `--scan --pattern 'replay:2fa-jti:*'` → **0 dòng**; `'perm:cap:*'` → **0 dòng**
 * (hình dạng CŨ, không envScope). ⇒ ba hàm dựng khoá cũ, bảng mẫu miễn trừ và nhánh miễn trừ trong
 * `assertKeysScoped` ĐÃ XOÁ; khoá `replay:`/`perm:` chưa scoped giờ BỊ NÉM như mọi họ khác — không còn
 * cửa hẹp nào.
 *
 * ⛔ CẤM dựng lại danh sách miễn trừ để "sửa đỏ": khoá thiếu scope là LỖI LẬP TRÌNH, sửa ở chỗ dựng khoá.
 * Lịch sử + lệnh dọn tay: `docs/RELEASE/RELEASE-02_Known_Issues_MVP.md` (KI-067). CẤM FLUSHDB.
 */

/** Bucket rate-limit. Bốn cái sau vốn nằm ở namespace GỐC (`2fa|…`, không cả tiền tố `rl:`) — gom về đây. */
export type RlBucket =
  | "ip"
  | "acct"
  | "forgot:ip"
  | "forgot:acct"
  | "2fa"
  | "2fa-enable"
  | "2fa-disable"
  | "change-pw";

/** Marker single-use của ReplayGuard. */
export type ReplayMarker = "2fa-jti" | "totp-step";

/** Không gian khoá chat KHÔNG phải presence (presence đã scoped sẵn từ S8-CHAT-UX-RT-1). */
export type ChatKeySubtype = "typing" | "cooldown" | "ice-turn-reject";

let memoEnvScope: string | null = null;

/**
 * Phạm vi môi trường của tiến trình đang chạy — `{NODE_ENV}:{db}`, `LANE_DB` thắng khi có.
 *
 * LAZY + memo: gọi `loadEnv()` ở top-level lúc import sẽ nổ trong fixture int-spec và lỗi hiện ra ở
 * file KHÁC hoàn toàn (lớp env-schema-floor-breaks-test-fixtures). Mọi builder nhận `envScope` như
 * tham số có mặc định ⇒ test tiêm bốn môi trường mà không cần đụng memo.
 */
export function currentEnvScope(): string {
  if (memoEnvScope === null) {
    memoEnvScope = resolveEnvScope(loadEnv(), process.env.LANE_DB);
  }
  return memoEnvScope;
}

/**
 * Xoá memo. CHỈ dùng trong test: vitest làm mới module registry theo FILE chứ không theo CA, nên một
 * ca lật `NODE_ENV` sẽ chạy bằng phạm vi đã mồi từ ca trước và xanh OAN nếu không reset.
 */
export function __resetEnvScopeForTests(): void {
  memoEnvScope = null;
}

export function rlKey(
  bucket: RlBucket,
  rest: string,
  envScope: string = currentEnvScope(),
): string {
  return `rl:${envScope}:${bucket}:${rest}`;
}

export function permCapKey(
  companyId: string,
  userId: string,
  envScope: string = currentEnvScope(),
): string {
  return `perm:${envScope}:cap:${companyId}:${userId}`;
}

export function permObjKey(
  companyId: string,
  userId: string,
  resourceType: string,
  resourceId: string,
  envScope: string = currentEnvScope(),
): string {
  return `perm:${envScope}:obj:${companyId}:${userId}:${resourceType}:${resourceId}`;
}

/** `hash` đã chứa companyId+userId+method+path+key (BẤT BIẾN #1 không suy giảm) — envScope ở NGOÀI. */
export function idemKey(hash: string, envScope: string = currentEnvScope()): string {
  return `idem:${envScope}:${hash}`;
}

export function replayKey(
  marker: ReplayMarker,
  rest: string,
  envScope: string = currentEnvScope(),
): string {
  return `replay:${envScope}:${marker}:${rest}`;
}

export function chatKey(
  subtype: ChatKeySubtype,
  rest: string,
  envScope: string = currentEnvScope(),
): string {
  return `chat:${envScope}:${subtype}:${rest}`;
}

export function meTrainingKey(
  companyId: string,
  userId: string,
  envScope: string = currentEnvScope(),
): string {
  return `me:${envScope}:training:${companyId}:${userId}`;
}

/**
 * Khoá có mang phạm vi môi trường không — NEO THEO SEGMENT.
 *
 * ⚠️ CẤM `key.includes(scope)` trần: `development:mediaos` là TIỀN TỐ của `development:mediaos_dev`,
 * nên khoá của dev-online sẽ LỌT cổng khi tiến trình chạy ở dev local — đúng cặp môi trường mà WO này
 * sinh ra để tách. Bọc hai đầu bằng `:` là phép neo segment rẻ nhất và KHÔNG cần escape regex (tên DB
 * có thể chứa `.`/`-`). Không neo vị trí vì `chat:presence:{envScope}:…` đặt scope ở đoạn 2.
 */
export function isKeyScoped(key: string, envScope: string = currentEnvScope()): boolean {
  return `:${key}:`.includes(`:${envScope}:`);
}

/** Lỗi LẬP TRÌNH (khoá quên scope) — KHÔNG bao giờ dùng cho lỗi runtime của Valkey. */
export class ValkeyKeyScopeError extends Error {
  constructor(op: string, key: string) {
    // Chỉ in NAMESPACE + độ dài: khoá `rl:*` nhúng EMAIL, không được rò vào log (BẤT BIẾN §2.3).
    super(
      `ValkeyService.${op}(): khoá thiếu envScope (namespace='${key.split(":")[0]}', ${key.length} ký tự). ` +
        `Dựng khoá qua apps/api/src/common/valkey/valkey-key.ts — S10-FND-VALKEYSCOPE-1.`,
    );
    this.name = "ValkeyKeyScopeError";
  }
}

/**
 * Cổng runtime — CHỈ SỐNG KHI `NODE_ENV === 'test'`.
 *
 * KHÔNG có nhánh warn ở development/production, KHÔNG sổ vi phạm, KHÔNG đổi một byte hành vi PROD.
 * Lý do: hợp đồng của `ValkeyService` là "never throws" và có ít nhất 6 call site KHÔNG bọc `try`
 * (`login-rate-limiter.ts` incr/set/del · `permission.cache.ts` invalidateUser · `replay-guard` setNx
 * · `chat-typing`), nên một khoá sót ở dev-online — môi trường CÓ người dùng thật — sẽ thành login
 * 500 thay vì fail-soft. Giữ cổng ngoài production là cách duy nhất chắc chắn không đảo chiều đó.
 *
 * ⇒ HỆ QUẢ PHẢI NÓI RA: production KHÔNG được cơ chế này bảo vệ. Cưỡng chế thật nằm ở test/CI (cổng
 * này + census tĩnh `valkey-key-census.spec.ts`). Đã ghi vào KI-067 để người sau không tưởng nhầm.
 */
export function assertKeysScoped(op: string, keys: readonly string[]): void {
  if (process.env.NODE_ENV !== "test") return;
  for (const key of keys) {
    if (isKeyScoped(key)) continue;
    throw new ValkeyKeyScopeError(op, key);
  }
}
