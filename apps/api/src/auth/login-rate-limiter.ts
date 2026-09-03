import { Injectable, Logger, Optional } from "@nestjs/common";
import { loadEnv } from "../config/env.schema";
import { ValkeyService } from "../permission/valkey.service";
import { rlKey } from "../common/valkey/valkey-key";

interface AttemptState {
  count: number;
  lockedUntilMs: number;
}

/** Họ bucket của một lượt thất bại — quyết định chỉ mục IP nào được nuôi (login vs forgot, §xem `ipIndexKey`). */
export type FailureFamily = "login" | "forgot";

/**
 * Bucket đang CHẶN ĐĂNG NHẬP. `forgot` cố ý KHÔNG có mặt: khoá đó chặn endpoint "quên mật khẩu", không
 * chặn login — đưa nó vào đây sẽ làm badge "đang bị khoá đăng nhập" nói sai. Nó vẫn được `clearLoginLocks`
 * xoá (gỡ khoá thì gỡ cả đường tự-chữa).
 */
export type LoginThrottleBucket = "acct" | "ip" | "2fa";

export interface LoginThrottleState {
  locked: boolean;
  /** Giây còn lại của khoá LÂU NHẤT; `null` = không khoá HOẶC không đọc được TTL (KHÔNG bao giờ là 0 giả). */
  remainingSec: number | null;
  buckets: LoginThrottleBucket[];
  /**
   * Một phép đọc KHÔNG kết luận được (Valkey bật nhưng `sMembers`/marker trả `null`) ⇒ `locked:false` ở
   * đây KHÔNG có nghĩa "không bị khoá", mà là "không biết".
   *
   * Tách khỏi `locked` chứ không gộp thành `locked:true`: gộp sẽ dựng badge "đang bị khoá" cho người
   * không hề bị khoá mỗi lần Valkey chớp. Người gọi phải xử lý tường minh — `null` nuốt thành `[]` là
   * đúng lớp lỗi làm cửa thoát biến mất đúng lúc hệ thống đang hỏng.
   */
  unknown: boolean;
}

export interface ClearLoginLocksResult {
  clearedKeys: number;
  /**
   * Valkey ĐANG BẬT nhưng một phép đọc/xoá không kết luận được ⇒ **không được báo thành công**.
   * Valkey tắt hẳn KHÔNG phải degraded (nhánh in-memory là nguồn sự thật, và nó vừa được dọn sạch).
   */
  degraded: boolean;
}

/** Định danh cho bucket bước-2 (2FA) — khoá đó mang `(companyId,userId)`, không mang email/ip. */
export interface LoginThrottleSubject {
  companyId: string;
  userId: string;
}

/**
 * Trần số IP giữ trong một chỉ mục. Có trần vì `recordFailure` XOÁ counter khi chạm ngưỡng, nên sau mỗi
 * cửa sổ 900s bucket lại nhận thêm ≤ `LOGIN_ACCOUNT_MAX_ATTEMPTS` IP mới, trong khi TTL của chỉ mục được
 * refresh ở MỖI lần ghi ⇒ tập sẽ KHÔNG BAO GIỜ hết hạn khi còn lượt sai. Không có trần thì một endpoint
 * công khai điều khiển được kích thước cấu trúc mà đường ADMIN phải đọc/xoá (khuếch đại vào Valkey dùng
 * chung 4 môi trường).
 *
 * Đánh đổi phải nói ra: vượt trần thì các IP đến SAU không gỡ được bằng chỉ mục. Ca đó bucket `acct` mới
 * là cái đang chặn (20 IP khác nhau ⇒ bucket tài khoản đã khoá từ lâu) và nó LUÔN được gỡ.
 */
const IP_INDEX_CAP = 64;

/** Trần độ dài một thành viên chỉ mục. `req.ip` sau proxy do client định cỡ; Valkey dùng chung 4 môi trường. */
const MAX_IP_MEMBER_LEN = 64;

/**
 * Giới hạn brute-force login: N lần sai liên tiếp → khoá tạm (plan G2-6). Khoá theo `key`:
 *  - per-IP   `key(companySlug,email,ip)`        — chống dò mật khẩu từ 1 nguồn (ngưỡng `LOGIN_MAX_ATTEMPTS`).
 *  - per-account `accountKey(companySlug,email)` — bắt credential-stuffing phân tán nhiều IP lên 1 account
 *    (ngưỡng cao hơn `LOGIN_ACCOUNT_MAX_ATTEMPTS`). Login orchestrate cả hai bucket; reauth chỉ dùng 1 key.
 *
 * **S10-AUTH-IPTRUST-1 — hai ngưỡng này chỉ có nghĩa khi `req.ip` là IP THẬT.** Khoá per-IP nhúng
 * `ip` vào key, nên nếu `ip` là hằng số (PROD chạy sau proxy mà `TRUST_PROXY` chưa đặt ⇒ mọi request
 * = `::1`) thì bucket "per-IP" thoái hoá thành bucket per-account với ngưỡng THẤP: trần khoá một
 * email trở thành 5 cho MỌI nguồn gộp lại, và bucket per-account 20 KHÔNG BAO GIỜ chạm tới. Sau khi
 * `TRUST_PROXY=loopback` (18/08/2026), phân vai đúng thiết kế: **trần khoá một email từ MỘT nguồn
 * giờ mới thực sự là 5** — nguồn khác vẫn đăng nhập được — còn 20 là backstop cho credential-stuffing
 * rải nhiều nguồn. Đóng đinh bởi 4 ca cuối `login-rate-limiter.spec.ts`; bối cảnh: KI-066.
 *
 * **Multi-instance:** khi `VALKEY_URL` có → đếm trên Valkey (mọi instance thấy chung). **Fail-soft:** Valkey
 * chưa cấu hình → fallback `Map` in-memory (đúng cho 1 instance + reset khi restart). KHÔNG fail-open: mất
 * Valkey thì hạ về memory chứ không bỏ rate-limit (đây là control chống brute-force, BẤT BIẾN an ninh).
 */
@Injectable()
export class LoginRateLimiter {
  private readonly logger = new Logger(LoginRateLimiter.name);
  private readonly env = loadEnv();
  private readonly attempts = new Map<string, AttemptState>();

  /**
   * S10-SEC-LOGINLOG429-1 — fallback in-memory của `claimFirstOfWindow`: `key → mốc hết hạn (ms)`.
   * TÁCH HẲN `attempts`: `reset()` xoá `attempts` sau mỗi lần đăng nhập thành công, còn cửa sổ gộp
   * phải sống trọn TTL của nó (gộp mà bị reset theo login thành công thì mỗi lượt sai lại ghi lại
   * từ đầu). Dọn hết hạn bằng `pruneDedupWindows`.
   */
  private readonly dedupWindows = new Map<string, number>();

  constructor(@Optional() private readonly valkey?: ValkeyService) {}

  /** Ngưỡng bucket tài khoản — login truyền vào `recordFailure(accountKey, …)`. */
  get accountMaxAttempts(): number {
    return this.env.LOGIN_ACCOUNT_MAX_ATTEMPTS;
  }

  /**
   * Độ dài cửa sổ khoá (giây) — nguồn sự thật DUY NHẤT cho TTL của khoá gộp nhật ký.
   *
   * ⚠️ Cửa sổ này KHÔNG được gia hạn: `recordFailure` set `:lock` ĐÚNG MỘT LẦN lúc chạm ngưỡng rồi
   * xoá counter, và đường đã-khoá `return` TRƯỚC `recordFailure` ⇒ khoá sống đúng `LOGIN_LOCKOUT_SEC`.
   * Nhờ vậy TTL khoá gộp bằng đúng giá trị này là khớp pha, không phải xấp xỉ.
   */
  get lockoutSec(): number {
    return this.env.LOGIN_LOCKOUT_SEC;
  }

  /**
   * S18-AUTH-UNLOCK429-1 — chuẩn hoá `companySlug` TRƯỚC khi ghép vào khoá. **Không phải tô điểm.**
   *
   * `companies.slug` ở DB là **citext** (`resolve_company_by_slug(p_slug citext)`, mig 0002) ⇒ `Funtime`,
   * `funtime`, `FUNTIME` đăng nhập vào CÙNG một công ty, và `loginSchema` không `.trim()/.toLowerCase()`.
   * Ghép slug THÔ vào khoá vì thế đẻ ra HAI hậu quả:
   *   1. mỗi biến thể hoa/thường là một bucket RIÊNG ⇒ trần 5-lần/IP và 20-lần/tài khoản **nhân lên**
   *      theo số biến thể — tức control chống brute-force bị pha loãng;
   *   2. đường GỠ khoá của admin dựng khoá từ slug **canonical đọc trong DB**, nên nếu người dùng bị
   *      khoá qua một client gửi slug lệch case (curl / SSO / mobile) thì nút "Gỡ khoá" **không chạm**
   *      khoá thật: 204 + audit "đã gỡ" mà người dùng vẫn 429. Và mọi test vẫn xanh vì test dùng slug
   *      canonical — đúng lớp lỗi chỉ lộ ra trên PROD.
   *
   * ⚠️ MỌI chỗ ghép slug vào khoá `rl:` phải đi qua đây, kể cả khoá GỘP nhật ký ở
   * `AuthService.claimBlockedLogSlot` — nếu chỗ đó còn dùng slug thô thì khoá gộp lại tách theo case và
   * `login_logs` (append-only, KHÔNG thu hồi được) bị bồi mỗi biến thể một hàng.
   *
   * ⛔ CHỈ `toLowerCase()`, TUYỆT ĐỐI KHÔNG `trim()`. Bản đầu của WO này có `.trim()` và nó là một lỗ
   * an ninh: citext **không** bỏ qua khoảng trắng, `loginSchema.companySlug` không `.trim()`, và
   * `resolveCompanyId` truyền slug THÔ vào `resolve_company_by_slug`. ⇒ `" acme"` là một slug KHÔNG
   * đăng nhập được, nhưng nếu ta trim ở đây thì nó ghi vào ĐÚNG bucket của `acme`: bất kỳ ai cũng khoá
   * được tài khoản người khác 900s bằng 5 request, và tệ hơn — nó chiếm luôn suất "1 hàng/cửa sổ" của
   * khoá gộp trong khi `resolveBlockedLogOwner` (dùng slug thô) cho `company_id = NULL` ⇒ admin của
   * tenant đó KHÔNG đọc được hàng nào trong chính cửa sổ đang bị dò. Chuẩn hoá ở đây phải khớp CHÍNH
   * XÁC phép so của DB, không rộng hơn một ký tự nào.
   */
  static normSlug(companySlug: string): string {
    return companySlug.toLowerCase();
  }

  /**
   * Marker "chỉ mục IP đã chạm trần" — TTL = `LOGIN_LOCKOUT_SEC`, cùng vòng đời với khoá nó mô tả.
   *
   * Tồn tại vì khi tràn trần, các IP đến sau KHÔNG vào chỉ mục ⇒ `clearLoginLocks` không xoá được
   * chúng **và** `loginThrottleState` cũng không thấy ⇒ hệ thống sẽ kết luận "đã gỡ xong" (204 + audit
   * `ok:true`) trong khi nạn nhân vẫn ăn 429. Gỡ bucket `acct` KHÔNG cứu ca đó: `isLoginRateLimited`
   * kiểm `acct` trước, nhưng một IP đang giữ `:lock` riêng vẫn chặn sau khi `acct` đã sạch.
   */
  static cappedMarkerKey(
    companySlug: string,
    email: string,
    family: FailureFamily = "login",
  ): string {
    const rest = `${LoginRateLimiter.normSlug(companySlug)}|${email.toLowerCase()}|capped`;
    return rlKey(family === "forgot" ? "forgot:ip-index" : "ip-index", rest);
  }

  static key(companySlug: string, email: string, ip: string): string {
    return rlKey("ip", `${LoginRateLimiter.normSlug(companySlug)}|${email.toLowerCase()}|${ip}`);
  }

  /** Bucket theo tài khoản (mọi IP). Bucket `acct` tách biệt với per-IP key. */
  static accountKey(companySlug: string, email: string): string {
    return rlKey("acct", `${LoginRateLimiter.normSlug(companySlug)}|${email.toLowerCase()}`);
  }

  /**
   * S18-AUTH-UNLOCK429-1 — chỉ mục "email này đã gõ sai từ những IP nào", TÁCH BẠCH theo họ bucket.
   * `login` nuôi khoá `ip:`, `forgot` nuôi khoá `forgot:ip:` — cố ý KHÔNG dùng chung một tập, để endpoint
   * CÔNG KHAI "quên mật khẩu" không nuôi cấu trúc dữ liệu của đường đăng nhập (đúng ranh giới mà docblock
   * `forgotKey` đã ký).
   */
  static ipIndexKey(companySlug: string, email: string, family: FailureFamily = "login"): string {
    const rest = `${LoginRateLimiter.normSlug(companySlug)}|${email.toLowerCase()}`;
    return rlKey(family === "forgot" ? "forgot:ip-index" : "ip-index", rest);
  }

  /**
   * Bucket bước-2 (TOTP) của CHÍNH luồng đăng nhập — `auth.service.ts` dựng cùng chuỗi này khi kiểm
   * challenge 2FA. Khoá theo `(companyId, userId)` lấy từ JWT, KHÔNG có `ip` và KHÔNG có email.
   *
   * Nằm ở đây vì đường gỡ khoá của admin phải xoá được nó: người bật 2FA gõ sai TOTP đủ ngưỡng cũng ăn
   * 429 **ở màn đăng nhập**, và nếu clear bỏ sót bucket này thì UI sẽ khẳng định "không bị khoá" đúng
   * lúc người dùng đang bị khoá. KHÔNG mở rộng sang `2fa-enable`/`2fa-disable`/`change-pw`/`stepup`:
   * đó là các luồng SAU đăng nhập, gỡ chúng là nới control ngoài phạm vi.
   */
  static twoFactorKey(companyId: string, userId: string): string {
    return rlKey("2fa", `${companyId}|${userId}`);
  }

  /**
   * S2-AUTH-HARDEN-1 — namespace RIÊNG cho forgot-password (`rl:forgot:*`), TÁCH HẲN bucket login
   * (`rl:ip:`/`rl:acct:`). Lý do: dùng chung bucket ⇒ spam forgot cho email của victim sẽ khoá luôn LOGIN
   * của victim (DoS qua endpoint công khai). Tách namespace ⇒ rate-limit forgot KHÔNG ảnh hưởng login.
   * Giữ NGUYÊN cơ chế/ngưỡng kép (per-IP `LOGIN_MAX_ATTEMPTS` + per-account `accountMaxAttempts`).
   */
  static forgotKey(companySlug: string, email: string, ip: string): string {
    return rlKey(
      "forgot:ip",
      `${LoginRateLimiter.normSlug(companySlug)}|${email.toLowerCase()}|${ip}`,
    );
  }

  static forgotAccountKey(companySlug: string, email: string): string {
    return rlKey("forgot:acct", `${LoginRateLimiter.normSlug(companySlug)}|${email.toLowerCase()}`);
  }

  async isLocked(key: string, nowMs: number = Date.now()): Promise<boolean> {
    if (this.useValkey()) {
      if ((await this.valkey!.get(this.lockKey(key))) !== null) return true;
      // Valkey trả null = CHƯA khoá HOẶC Valkey rớt (get nuốt lỗi → null). Khi rớt, recordFailure đã ghi
      // vào memory (incr null → recordFailureMem) → KHÔNG fail-open: rơi xuống kiểm luôn map in-memory.
    }
    const state = this.attempts.get(key);
    return state !== undefined && state.lockedUntilMs > nowMs;
  }

  /** Ghi nhận 1 lần sai; chạm `maxAttempts` ⇒ khoá tạm `LOGIN_LOCKOUT_SEC`. */
  async recordFailure(
    key: string,
    maxAttempts: number = this.env.LOGIN_MAX_ATTEMPTS,
    nowMs: number = Date.now(),
  ): Promise<void> {
    if (this.useValkey()) {
      const lockSec = this.env.LOGIN_LOCKOUT_SEC;
      const count = await this.valkey!.incr(this.countKey(key), lockSec);
      // incr trả null = Valkey rớt giữa chừng → fail-soft sang memory cho lần này (không bỏ đếm).
      if (count === null) {
        this.recordFailureMem(key, maxAttempts, nowMs);
        return;
      }
      if (count >= maxAttempts) {
        await this.valkey!.set(this.lockKey(key), "1", lockSec);
        await this.valkey!.del(this.countKey(key));
      }
      return;
    }
    this.recordFailureMem(key, maxAttempts, nowMs);
  }

  /** Xoá trạng thái sau login thành công (cả counter + lock). Luôn xoá map in-memory (fallback có thể đã
   *  ghi trong lúc Valkey rớt) để không khoá nhầm sau khi đã đăng nhập thành công. */
  async reset(key: string): Promise<void> {
    this.attempts.delete(key);
    if (this.useValkey()) {
      await this.valkey!.del(this.countKey(key), this.lockKey(key));
    }
  }

  /**
   * S18-AUTH-UNLOCK429-1 — ghi nhận "lượt sai này đến từ IP nào" vào chỉ mục của `(slug,email)`.
   *
   * Gọi từ ĐÚNG hai chỗ biết đủ bộ ba: `AuthService.recordLoginFailure` (đường đăng nhập) và
   * `forgotPasswordImpl` (đường quên mật khẩu). Ở cả hai chỗ, lời gọi nằm **trước** mọi nhánh rẽ theo
   * "email có tồn tại không" ⇒ email-ma và email-thật đi qua CÙNG số round-trip, KHÔNG đẻ thêm oracle
   * enumeration.
   *
   * Fail-soft tuyệt đối: chỉ mục là tiện ích cho đường GỠ khoá, không phải control. Mất nó thì admin gỡ
   * được ít hơn, KHÔNG phải ai đó đăng nhập được nhiều hơn.
   *
   * ⚠️ GIỚI HẠN ĐÃ BIẾT, đừng tưởng là bug mới: nếu `INCR` thành công mà `SADD` hỏng riêng lẻ (Valkey rớt
   * đúng giữa hai lệnh), khoá per-IP nằm trên Valkey nhưng IP đó KHÔNG có trong chỉ mục ⇒ lượt gỡ sau
   * không thấy nó, và `loginThrottleState` cũng không (memory không có gì để hợp nhất vì `INCR` đã thành
   * công). Đây là giới hạn cấu trúc của MỌI chỉ mục, không phải của bản vá này; nó tự lành sau
   * `LOGIN_LOCKOUT_SEC`. Ca Valkey rớt HOÀN TOÀN — đường hay gặp hơn nhiều — thì đã phủ: `recordFailure`
   * rơi xuống memory và cả hai phép đọc/gỡ đều thấy.
   */
  async noteFailureSource(
    family: FailureFamily,
    companySlug: string,
    email: string,
    ip: string,
  ): Promise<void> {
    // Nhánh in-memory không cần chỉ mục — `clearLoginLocks`/`loginThrottleState` duyệt thẳng `attempts`
    // theo tiền tố (rẻ hơn, và luôn đúng).
    // KHÔNG bỏ qua `ip` rỗng: `recordFailure` vẫn dựng khoá `…|{email}|` cho nó, nên bỏ qua ở đây sẽ
    // tạo một khoá VÔ HÌNH với cả đường gỡ lẫn đường đọc — đúng bất đối xứng sinh ra 204 dối.
    // Cắt độ dài: `ip` đến từ `req.ip` dưới `TRUST_PROXY` ⇒ kích thước do client điều khiển, mà đây là
    // Valkey DÙNG CHUNG bốn môi trường.
    const member = ip.slice(0, MAX_IP_MEMBER_LEN);
    if (!this.useValkey()) return;
    const indexKey = LoginRateLimiter.ipIndexKey(companySlug, email, family);
    const size = await this.valkey!.sCard(indexKey);
    if (size !== null && size >= IP_INDEX_CAP) {
      // MARKER "đã tràn trần" — bắt buộc, không phải log cho vui. Không có nó, các IP đến sau trần
      // nằm ngoài chỉ mục ⇒ `clearLoginLocks` không xoá được VÀ `loginThrottleState` cũng không thấy
      // ⇒ hệ thống kết luận "đã gỡ xong" (204 + audit ok:true) trong khi nạn nhân vẫn ăn 429. Gỡ bucket
      // `acct` KHÔNG cứu được ca đó: `isLoginRateLimited` kiểm `acct` trước, nhưng một IP đang giữ
      // `:lock` riêng vẫn chặn sau khi `acct` đã sạch.
      await this.valkey!.set(
        LoginRateLimiter.cappedMarkerKey(companySlug, email, family),
        "1",
        this.env.LOGIN_LOCKOUT_SEC,
      );
      // WARN gộp 1 lần/cửa sổ (tái dùng đúng cơ chế đã chống bồi hàng cho `login_logs`) — chạm trần là
      // tín hiệu vận hành (rải IP), không phải sự kiện mỗi-request.
      const noisy = await this.claimFirstOfWindow(
        rlKey(
          "logdedup",
          `ip-index-cap:${family}:${LoginRateLimiter.normSlug(companySlug)}|${email.toLowerCase()}`,
        ),
        this.env.LOGIN_LOCKOUT_SEC,
      );
      if (noisy) {
        this.logger.warn(
          `Chỉ mục IP chạm trần (${IP_INDEX_CAP}) — IP đến sau sẽ không gỡ được bằng chỉ mục; bucket tài khoản vẫn gỡ được.`,
          { family, slug: LoginRateLimiter.normSlug(companySlug) },
        );
      }
      return;
    }
    await this.valkey!.sAddWithTtl(indexKey, member, this.env.LOGIN_LOCKOUT_SEC);
  }

  /**
   * S18-AUTH-UNLOCK429-1 — GỠ mọi khoá đăng nhập của `(slug,email)` [+ bucket bước-2 nếu biết `subject`].
   *
   * Xoá: `ip:` (từng IP trong chỉ mục) · `acct:` · `forgot:ip:` · `forgot:acct:` · `2fa:` · và chính hai
   * chỉ mục. **KHÔNG** xoá `logdedup:` — đó là khoá gộp bảo vệ `login_logs` (append-only, KHÔNG thu hồi
   * được) khỏi bị bồi hàng (KI-048); xoá nó là mở lại đúng lỗ đó cho mỗi lần bấm nút. **KHÔNG** xoá
   * `2fa-enable`/`2fa-disable`/`change-pw`/`stepup` — luồng SAU đăng nhập, ngoài phạm vi.
   *
   * Dọn `attempts` in-memory là VÔ ĐIỀU KIỆN (mirror `reset()`): khi Valkey rớt giữa chừng,
   * `recordFailure` đã fail-soft ghi khoá vào memory — bỏ qua nhánh này là gỡ hụt đúng lúc hệ thống đang
   * hỏng.
   */
  async clearLoginLocks(
    companySlug: string,
    email: string,
    subject?: LoginThrottleSubject,
  ): Promise<ClearLoginLocksResult> {
    this.purgeMemoryLocks(companySlug, email, subject);
    if (!this.useValkey()) return { clearedKeys: 0, degraded: false };

    let degraded = false;
    const keys: string[] = [];
    /**
     * Khoá `:lock` per-IP phải VERIFY LẠI SAU khi xoá — và verify ở ĐÂY, không phải bằng một lượt
     * `loginThrottleState` sau đó: lượt ấy đọc lại chỉ mục mà chính hàm này vừa DEL, nên nó **cấu trúc
     * không bao giờ** nhìn thấy bucket `ip` nữa. Không có danh sách này, cổng `ok`/503 mù đúng với
     * bucket hay chặn nhất.
     */
    const perIpLockKeys: string[] = [];
    for (const family of ["login", "forgot"] as const) {
      const indexKey = LoginRateLimiter.ipIndexKey(companySlug, email, family);
      const ips = await this.valkey!.sMembers(indexKey);
      // `null` = KHÔNG BIẾT (Valkey rớt), khác hẳn `[]` = chắc chắn không có IP nào. Coi null như rỗng
      // ở đây nghĩa là báo "đã gỡ xong" trong khi các khoá per-IP còn nguyên.
      if (ips === null) degraded = true;
      for (const ip of ips ?? []) {
        const base =
          family === "login"
            ? LoginRateLimiter.key(companySlug, email, ip)
            : LoginRateLimiter.forgotKey(companySlug, email, ip);
        keys.push(this.countKey(base), this.lockKey(base));
        if (family === "login") perIpLockKeys.push(this.lockKey(base));
      }
      // Marker "đã tràn trần": còn marker nghĩa là có IP KHÔNG nằm trong chỉ mục ⇒ ta không thể khẳng
      // định đã gỡ hết. `null` (Valkey rớt) cũng là không-khẳng-định-được. Cả hai ⇒ degraded, để service
      // trả 503 thay vì 204 dối.
      const capped = await this.valkey!.get(
        LoginRateLimiter.cappedMarkerKey(companySlug, email, family),
      );
      if (capped !== null) degraded = true;
      keys.push(indexKey, LoginRateLimiter.cappedMarkerKey(companySlug, email, family));
    }
    for (const base of [
      LoginRateLimiter.accountKey(companySlug, email),
      LoginRateLimiter.forgotAccountKey(companySlug, email),
      ...(subject ? [LoginRateLimiter.twoFactorKey(subject.companyId, subject.userId)] : []),
    ]) {
      keys.push(this.countKey(base), this.lockKey(base));
    }
    // Trần IP_INDEX_CAP giữ danh sách ≤ ~2·(2·64) + 8 khoá ⇒ một lệnh DEL là đủ, không cần chia lô.
    if (!(await this.valkey!.del(...keys))) degraded = true;
    // Verify: `del` trả `true` cả khi Valkey CHƯA cấu hình, và một DEL "thành công" vẫn có thể để sót
    // nếu instance khác vừa dựng lại khoá. Đọc lại đúng các khoá vừa xoá là bằng chứng duy nhất.
    for (const lockKey of perIpLockKeys) {
      if ((await this.valkey!.ttl(lockKey)) !== null) degraded = true;
    }
    return { clearedKeys: keys.length, degraded };
  }

  /**
   * S18-AUTH-UNLOCK429-1 — trạng thái khoá ĐĂNG NHẬP của `(slug,email)` [+ bước-2 nếu biết `subject`].
   *
   * HỢP NHẤT hai nguồn cho bucket per-IP: chỉ mục trên Valkey **∪** `attempts` in-process. Chỉ đọc Valkey
   * là sai ở đúng ca hay xảy ra nhất khi cần đọc: Valkey rớt lúc `SADD` nhưng `recordFailure` vẫn fail-soft
   * ghi khoá vào memory ⇒ chỉ mục rỗng trong khi người dùng đang bị chặn, và UI sẽ nói "không bị khoá".
   */
  async loginThrottleState(
    companySlug: string,
    email: string,
    subject?: LoginThrottleSubject,
    nowMs: number = Date.now(),
  ): Promise<LoginThrottleState> {
    const buckets: LoginThrottleBucket[] = [];
    let remainingSec: number | null = null;
    // "Không biết" phải đi RA NGOÀI, không được nuốt thành "không khoá": người gọi dựng cửa thoát cho
    // admin dựa trên đây, và mất cửa thoát đúng lúc Valkey hỏng là ca tệ nhất của WO này.
    let unknown = false;
    const takeMax = (sec: number | null): void => {
      if (sec !== null && (remainingSec === null || sec > remainingSec)) remainingSec = sec;
    };

    const acctKey = LoginRateLimiter.accountKey(companySlug, email);
    if (await this.isLocked(acctKey, nowMs)) {
      buckets.push("acct");
      takeMax(await this.remainingLockSec(acctKey, nowMs));
    }

    let ipLocked = false;
    if (this.useValkey()) {
      const ips = await this.valkey!.sMembers(
        LoginRateLimiter.ipIndexKey(companySlug, email, "login"),
      );
      if (ips === null) unknown = true;
      // Còn marker tràn trần ⇒ có IP nằm NGOÀI chỉ mục: ta không thể khẳng định "không bị khoá".
      if ((await this.valkey!.get(LoginRateLimiter.cappedMarkerKey(companySlug, email, "login"))) !== null) {
        unknown = true;
      }
      for (const ip of ips ?? []) {
        // `ttl` trên khoá `:lock` trả lời CẢ HAI câu hỏi (còn khoá không / còn bao lâu) trong MỘT
        // round-trip; dùng `get`+`ttl` sẽ nhân đôi số lệnh mà không thêm thông tin nào.
        const sec = await this.valkey!.ttl(
          this.lockKey(LoginRateLimiter.key(companySlug, email, ip)),
        );
        if (sec !== null) {
          ipLocked = true;
          takeMax(sec);
        }
      }
    }
    const ipPrefix = LoginRateLimiter.key(companySlug, email, "");
    for (const [key, state] of this.attempts) {
      if (!key.startsWith(ipPrefix)) continue;
      if (state.lockedUntilMs > nowMs) {
        ipLocked = true;
        takeMax(Math.ceil((state.lockedUntilMs - nowMs) / 1000));
      }
    }
    if (ipLocked) buckets.push("ip");

    if (subject) {
      const twoFactor = LoginRateLimiter.twoFactorKey(subject.companyId, subject.userId);
      if (await this.isLocked(twoFactor, nowMs)) {
        buckets.push("2fa");
        takeMax(await this.remainingLockSec(twoFactor, nowMs));
      }
    }
    return { locked: buckets.length > 0, remainingSec, buckets, unknown };
  }

  /**
   * Giây còn lại của khoá trên MỘT bucket đã biết tên (`key` là khoá GỐC, không kèm hậu tố `:lock` —
   * cùng quy ước với `isLocked`/`recordFailure`/`reset`). `null` khi không khoá hoặc không đọc được TTL.
   *
   * Tách riêng khỏi `loginThrottleState` vì `S18-AUTH-RETRYAFTER-1` cần đúng phép đo này ở nhánh 429 của
   * login — nơi chỉ có MỘT khoá đã biết và mọi round-trip thừa đều rơi vào sàn thời gian đồng nhất.
   */
  async remainingLockSec(key: string, nowMs: number = Date.now()): Promise<number | null> {
    if (this.useValkey()) {
      const sec = await this.valkey!.ttl(this.lockKey(key));
      if (sec !== null) return sec;
    }
    const state = this.attempts.get(key);
    if (state !== undefined && state.lockedUntilMs > nowMs) {
      return Math.ceil((state.lockedUntilMs - nowMs) / 1000);
    }
    return null;
  }

  /**
   * ⟲ S18-AUTH-RETRYAFTER-1 — bản AN TOÀN của `remainingLockSec` dành cho ĐƯỜNG NÉM 429.
   *
   * VÌ SAO Ở ĐÂY chứ không phải một wrapper `private` trong từng service: con số này chỉ để HIỂN THỊ,
   * và hợp đồng "trục trặc đọc TTL KHÔNG được biến 429 thành 500" phải có ĐÚNG MỘT hình dạng gọi. Hai
   * bản sao private ở hai service sẽ lệch câm, và chỗ ném 429 thứ sáu sẽ gọi thẳng `remainingLockSec`
   * rồi mở lại lỗ 429→500 mà không ca test nào đỏ (bài học `wrapper-escape-hatch-needs-its-own-case`).
   *
   * FAIL-SOFT NHƯNG KHÔNG CÂM: lỗi → `null` (429 mất phần số giây, FE rơi về chuỗi cũ) + LOG. Nuốt câm
   * nghĩa là tiện ích chết trong im lặng và không ai biết cho tới khi có người hỏi.
   * KHÔNG nội suy `key` vào log — khoá chứa slug + email của người dùng (BẤT BIẾN #3).
   */
  async remainingLockSecOrNull(key: string): Promise<number | null> {
    try {
      return await this.remainingLockSec(key);
    } catch (err) {
      this.logger.warn(
        `Đọc TTL khoá rate-limit thất bại — 429 sẽ KHÔNG mang retryAfterSec (người dùng thấy câu chữ ` +
          `vô định thay vì đếm ngược): ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  /**
   * Dọn khoá in-memory theo TIỀN TỐ dựng qua chính builder khoá (`key(slug,email,"")` → `…|{email}|`),
   * KHÔNG nối chuỗi tay: nối tay là thứ `valkey-key-census.spec.ts` cấm, và sẽ lệch câm khi `envScope` đổi.
   *
   * Đây là duyệt `Map` trong tiến trình — KHÔNG phải `SCAN` Valkey (lệnh bị cấm vì bốn môi trường dùng
   * chung một db0). Chi phí O(số bucket đang sống trong process).
   */
  private purgeMemoryLocks(
    companySlug: string,
    email: string,
    subject?: LoginThrottleSubject,
  ): void {
    const prefixes = [
      LoginRateLimiter.key(companySlug, email, ""),
      LoginRateLimiter.forgotKey(companySlug, email, ""),
    ];
    const exact = new Set([
      LoginRateLimiter.accountKey(companySlug, email),
      LoginRateLimiter.forgotAccountKey(companySlug, email),
      ...(subject ? [LoginRateLimiter.twoFactorKey(subject.companyId, subject.userId)] : []),
    ]);
    for (const key of [...this.attempts.keys()]) {
      if (exact.has(key) || prefixes.some((p) => key.startsWith(p))) this.attempts.delete(key);
    }
  }

  /**
   * S10-SEC-LOGINLOG429-1 (KI-048) — "tôi có phải NGƯỜI ĐẦU TIÊN của cửa sổ này không?"
   *
   * Trả `true` ĐÚNG MỘT LẦN cho mỗi `key` trong mỗi `ttlSec`; các lượt sau trả `false`. Người gọi
   * dùng nó để ghi hàng nhật ký ĐẦU cửa sổ rồi thôi — thay vì bồi một hàng cho MỖI request bị chặn
   * vào bảng append-only KHÔNG THU HỒI ĐƯỢC (`login_logs` ∈ PROTECTED_TABLES).
   *
   * ⚠️ GỘP = KHÔNG GHI THÊM, tuyệt đối KHÔNG phải UPDATE hàng cũ: `login_logs` bị REVOKE
   * UPDATE/DELETE ở DB (mig 0443, BẤT BIẾN #2). Thiết kế nào cần UPDATE là đã phá bất biến.
   *
   * ⚠️ FAIL-**OPEN**, NGƯỢC CHIỀU `ReplayGuardService`. Đó là control an ninh nên nghi ngờ ⇒ TỪ CHỐI;
   * đây là nhật ký nên nghi ngờ ⇒ **GHI**. Mất một chút gộp còn hơn mất dấu vết. Vì thế KHÔNG tái
   * dùng `ReplayGuardService` cho việc này dù hình dạng `setNx` giống hệt.
   *
   * ⚠️ VÌ SAO PHẢI CÓ FALLBACK MEMORY, không phải "fail-open thuần trên setNx". `ValkeyService.setNx`
   * trả `null` khi Valkey **CHƯA CẤU HÌNH**, không chỉ khi rớt — và `VALKEY_URL` thường VẮNG trong
   * test. Fail-open thuần ⇒ trong mọi int-spec khoá gộp không bao giờ giữ ⇒ cơ chế gộp lên PROD mà
   * chưa từng có một ca nào chứng minh nó chạy. Memory-fallback (mirror `recordFailureMem` ngay dưới)
   * làm nó ĐO ĐƯỢC; fail-open thật chỉ còn khi cả hai đường hỏng.
   */
  async claimFirstOfWindow(
    key: string,
    ttlSec: number,
    nowMs: number = Date.now(),
  ): Promise<boolean> {
    if (this.useValkey()) {
      const res = await this.valkey!.setNx(key, "1", ttlSec);
      // BA giá trị, không hai: `null` = chưa cấu hình HOẶC rớt ⇒ KHÔNG kết luận, rơi xuống memory.
      if (res !== null) return res;
    }
    return this.claimFirstOfWindowMem(key, ttlSec, nowMs);
  }

  private claimFirstOfWindowMem(key: string, ttlSec: number, nowMs: number): boolean {
    const expiresAtMs = this.dedupWindows.get(key);
    if (expiresAtMs !== undefined && expiresAtMs > nowMs) return false;
    this.dedupWindows.set(key, nowMs + ttlSec * 1000);
    this.pruneDedupWindows(nowMs);
    return true;
  }

  /**
   * Dọn marker hết hạn — BẮT BUỘC, không phải tối ưu. Khoá gộp của nhánh replay-jti mang chính `jti`
   * ⇒ số khoá phân biệt tăng theo số TOKEN đã thấy, không bị chặn bởi số bucket như `attempts`.
   * Không dọn thì đây là chỗ rò bộ nhớ tuyến tính theo lưu lượng. Mirror `ReplayGuardService.pruneExpired`.
   */
  private pruneDedupWindows(nowMs: number): void {
    for (const [k, expiresAtMs] of this.dedupWindows) {
      if (expiresAtMs <= nowMs) this.dedupWindows.delete(k);
    }
  }

  private recordFailureMem(key: string, maxAttempts: number, nowMs: number): void {
    const state = this.attempts.get(key) ?? { count: 0, lockedUntilMs: 0 };
    state.count += 1;
    if (state.count >= maxAttempts) {
      state.lockedUntilMs = nowMs + this.env.LOGIN_LOCKOUT_SEC * 1000;
      state.count = 0;
    }
    this.attempts.set(key, state);
  }

  private useValkey(): boolean {
    return this.valkey?.isEnabled() === true;
  }

  private countKey(key: string): string {
    return `${key}:cnt`;
  }

  private lockKey(key: string): string {
    return `${key}:lock`;
  }
}
