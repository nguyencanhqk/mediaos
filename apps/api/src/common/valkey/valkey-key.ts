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
 * ─── ĐIỀU GÌ XẢY RA LÚC DEPLOY ──────────────────────────────────────────────────────────────────
 * Đổi hình dạng khoá ⇒ MỌI khoá cũ thành MỒ CÔI (không hàm nào trong code còn dựng ra chúng):
 *   · `perm:*` (TTL 300s) · `idem:*` (900s) · `me:training:*` (60s) — hết hạn rồi biến mất, NHƯNG xem
 *     `legacyPermCapKey` bên dưới: đường INVALIDATE phải dọn thêm khoá cũ, nếu không thu hồi quyền
 *     trong cửa sổ 300s sẽ KHÔNG chạm khoá cũ (rollback trong cửa sổ = grant trước-thu-hồi sống lại).
 *   · `rl:*:lock` — treo tới hết `LOGIN_LOCKOUT_SEC` và KHÔNG còn hàm nào xoá được ⇒ mọi lockout đang
 *     có bị VÔ HIỆU ngay lúc deploy (người đang bị brute-force chặn được cấp lại budget đầy). Đây là
 *     nới lỏng an ninh trong một cửa sổ ngắn — CÓ CHỦ Ý, đã ghi ở KI-067 kèm lệnh dọn tay.
 *   · `replay:*` — xem `legacyReplayKey`: marker single-use mồ côi = challenge 2FA đã tiêu thụ có thể
 *     claim LẠI. Vì thế có đường ĐỌC KÉP + GHI KÉP đúng một chu kỳ deploy.
 * Lệnh dọn tay + lệnh nghiệm thu: `docs/RELEASE/RELEASE-02_Known_Issues_MVP.md` (KI-067). CẤM FLUSHDB.
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

/* ─────────────────────────── HÌNH DẠNG CŨ (chuyển tiếp MỘT chu kỳ deploy) ───────────────────────
 * Ba hàm dưới dựng ĐÚNG hình dạng TRƯỚC S10-FND-VALKEYSCOPE-1. Chúng tồn tại để đóng hai cửa sổ mà
 * việc đổi tiền tố mở ra:
 *   1. `legacyReplayKey` — ReplayGuard ĐỌC KÉP (chiều tiến: marker tiêu thụ trước deploy vẫn chặn
 *      được) và GHI KÉP (chiều lùi: rollback không làm marker tiêu thụ sau deploy sống lại).
 *   2. `legacyPermCapKey`/`legacyPermObjKey` — `invalidateUser` DEL kèm khoá cũ, nếu không thì thu hồi
 *      quyền trong cửa sổ TTL 300s sau deploy KHÔNG chạm khoá cũ ⇒ rollback = grant trước-thu-hồi
 *      sống lại, IM LẶNG (không log, không exception).
 *
 * ⛔ HẠN GỠ: sau ≥1 chu kỳ deploy ổn định. Việc gỡ ĐÃ được seed thành Work Order riêng trong
 * `harness/backlog.mjs` (S10-FND-VALKEYSCOPE-2) — docblock "sẽ gỡ sau" một mình KHÔNG đủ, bài học
 * known-issue-workaround-may-never-have-run.
 * ⛔ CẤM thêm mục mới vào miễn trừ này để "sửa đỏ": mọi mục mới phải do người chốt vùng đỏ duyệt.
 */

export function legacyReplayKey(marker: ReplayMarker, rest: string): string {
  return `replay:${marker}:${rest}`;
}

export function legacyPermCapKey(companyId: string, userId: string): string {
  return `perm:cap:${companyId}:${userId}`;
}

export function legacyPermObjKey(
  companyId: string,
  userId: string,
  resourceType: string,
  resourceId: string,
): string {
  return `perm:obj:${companyId}:${userId}:${resourceType}:${resourceId}`;
}

/**
 * Hai họ khoá CŨ được phép đi qua cổng runtime trong chu kỳ chuyển tiếp.
 *
 * Neo `^` + tên marker/subtype NGAY SAU namespace: hình dạng MỚI luôn có `{envScope}` ở vị trí đó
 * (`replay:production:mediaos:2fa-jti:…`) nên KHÔNG khớp. Nếu regex này lỡ nuốt cả khoá mới thì toàn
 * bộ họ đó vĩnh viễn nằm ngoài cổng = cổng XANH RỖNG — có ca test đóng đinh điều đó.
 */
const LEGACY_UNSCOPED_PATTERNS: readonly RegExp[] = [
  /^replay:(2fa-jti|totp-step):/,
  /^perm:(cap|obj):/,
];

export function isLegacyUnscopedExempt(key: string): boolean {
  return LEGACY_UNSCOPED_PATTERNS.some((re) => re.test(key));
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
    if (isKeyScoped(key) || isLegacyUnscopedExempt(key)) continue;
    throw new ValkeyKeyScopeError(op, key);
  }
}
