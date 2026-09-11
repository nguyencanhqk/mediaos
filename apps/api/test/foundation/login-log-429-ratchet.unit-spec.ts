import { describe, expect, it } from "vitest";
import {
  reauthFailedContexts,
  silentTooManyRequestsSites,
  reauthFailedWriterCount,
  stepUpAntiAmplificationAnchors,
  tooManyRequestsFactoryNames,
  tooManyRequestsThrowSites,
  twoFactorDenyBranchAnchors,
} from "./login-log-429-census";

/**
 * S10-SEC-LOGINLOG429-1 (KI-047) — RATCHET: không điểm ném 429 nào được im lặng.
 *
 * VÌ SAO CẦN LỚP NÀY. KI-047 mở 29/07 với "4 đường 429 không ghi log"; đo lại 24/08 ra **5** —
 * `step-up.service.ts` mọc thêm một điểm ném và không ai thấy suốt gần một tháng. Vá 5 đường là
 * việc một lần; thứ làm nợ quay lại là điểm ném **THỨ BẢY**.
 *
 * KHÔNG cần Postgres: spec TĨNH (`*.unit-spec.ts`) ⇒ chạy ở MỌI lần `pnpm test`, kể cả khi không có
 * `LANE_DB` ⇒ không rơi vào lớp "xanh vì SKIP" ([[integration-test-lane-db-gate]]).
 */

/**
 * WAIVER ĐÃ KÝ — điểm ném 429 CỐ Ý không ghi hàng nào ở chính nhánh đó.
 *
 * ⚠️ ĐÂY KHÔNG PHẢI "miễn cho qua". Cả năm dòng đều theo cùng MỘT luật, phát biểu ở
 * `docs/plans/S10-SEC-LOGINLOG429-1.md` §1:
 *
 *   > Đường DỰNG NÊN cái khoá phải để lại vết; đường ĐANG BỊ KHOÁ ghi 0 hàng.
 *
 * `N` lần sai dựng nên khoá đều có hàng ⇒ khoá vẫn suy ra được, mà trần lưu trữ mỗi cửa sổ là `N`
 * hàng chứ không phải vô hạn. Ghi ở nhánh đã-khoá là mời kẻ tấn công bồi hàng vào bảng
 * **không xoá được** — chính là KI-048, thứ WO này đang đóng ở vế kia.
 *
 * ⚠️ Mỗi waiver PHẢI có NEO DƯƠNG ở ca (3)/(4)/(5) bên dưới. Waiver không neo là dây thừa: ai đó xoá
 * lời ghi ở nhánh SAI thì nhánh khoá vẫn được miễn và ratchet vẫn xanh ([[tests-can-pin-a-hole-open]]).
 */
const WAIVERS: ReadonlyMap<string, string> = new Map<string, string>([
  [
    "StepUpService#stepUp",
    "A09 anti-amplification (FIX-1-BE-STEPUP-FLOOD nửa (a)) — neo dương ở ca (4).",
  ],
  ["AuthService#disableTwoFactor", "Ghi vết ở nhánh SAI MẬT KHẨU — neo dương ở ca (3)."],
  ["AuthService#changePassword", "Ghi vết ở nhánh SAI MẬT KHẨU — neo dương ở ca (3)."],
  ["TwoFactorService#confirmEnable", "Ghi vết ở nhánh MÃ SAI — neo dương ở ca (3)."],
  [
    "TwoFactorService#enroll",
    "S18-AUTH-490DEBT-1: trần = LOGIN_MAX_ATTEMPTS hàng `auth.2fa_enroll_denied` mỗi cửa sổ nhờ " +
      "`recordFailure` ở nhánh `account_gone` — neo dương ở ca (5). KHÔNG dùng neo ca (3): nhánh này " +
      "cố ý KHÔNG gắn nhãn `REAUTH_FAILED` (D1.d của #490 — lượt đó không phải 'nhập sai mã').",
  ],
]);

/**
 * Ngữ cảnh `REAUTH_FAILED` phải tồn tại — MỘT dòng cho MỖI waiver post-auth.
 *
 * Neo theo ĐỊNH NGHĨA chứ không theo tên hàm: `changePassword` đã có `securityEvents.record`
 * (`PASSWORD_CHANGED`) ở nhánh THÀNH CÔNG từ trước, nên mọi phép đo ở mức HÀM đều xanh sẵn và
 * không chứng minh được gì ([[index-ratchet-must-pin-definition-not-name]]).
 */
const REQUIRED_REAUTH_CONTEXTS = ["2fa_disable", "2fa_enable", "change_password"];

describe("S10-SEC-LOGINLOG429-1 — ratchet: điểm ném 429 phải để lại vết", () => {
  it("(1) KHÔNG điểm ném 429 nào im lặng trong chính nhánh của nó (trừ waiver đã ký)", () => {
    const offenders = silentTooManyRequestsSites().filter((s) => !WAIVERS.has(s.key));
    const detail = offenders.map((s) => `  ${s.key}  (auth/${s.file}:${s.line})`).join("\n");
    expect(
      offenders.length,
      offenders.length === 0
        ? ""
        : [
            "",
            `Có ${offenders.length} điểm ném 429 KHÔNG ghi một dòng nào trong nhánh của nó —`,
            "đó là hình dạng của KI-047:",
            detail,
            "",
            "Vá: gọi `recordLoginAttempt` (đường LOGIN → login_logs) hoặc `securityEvents.record`",
            "(đường POST-AUTH → user_security_events) TRONG CHÍNH nhánh đó.",
            "",
            "Nếu im lặng là CÓ CHỦ Ý, thêm một dòng vào WAIVERS ở đầu file NÀY — kèm neo dương ở",
            "ca (3)/(4). Waiver không neo sẽ bị coi là nợ, không phải quyết định.",
            "Xem `docs/plans/S10-SEC-LOGINLOG429-1.md` §1 + §5.",
          ].join("\n"),
    ).toBe(0);
  });

  it("(1b) CHIỀU NGƯỢC LẠI: mọi waiver phải CÒN im lặng — chống 'vá cho đủ'", () => {
    // Ca (1) chỉ ghim MỘT CHIỀU. Nếu ai đó THÊM lời ghi vào nhánh 429 của changePassword/
    // disableTwoFactor/confirmEnable ("vá cho đủ cho đẹp"), site đó biến khỏi
    // silentTooManyRequestsSites() ⇒ offenders vẫn rỗng ⇒ ca (1) XANH, trong khi quyết định
    // CHỐNG KHUẾCH ĐẠI (§1.1: đường đang bị khoá ghi 0 hàng) vừa bị đảo trong im lặng.
    //
    // Đó không phải chuyện thẩm mỹ: ba đường này post-auth, lặp MIỄN PHÍ bằng access token ⇒ ghi ở
    // nhánh đã-khoá là cho phép bồi vô hạn hàng vào bảng append-only — đúng KI-048 ở dạng mới.
    const silent = new Set(silentTooManyRequestsSites().map((s) => s.key));
    const noLongerSilent = [...WAIVERS.keys()].filter((k) => !silent.has(k));
    expect(
      noLongerSilent,
      "waiver này nay ĐÃ ghi ở nhánh khoá — hoặc gỡ nó khỏi WAIVERS (nếu ghi là có chủ ý và có mô " +
        "hình chi phí như §1.3a), hoặc bỏ lời ghi đi. Đừng để bảng waiver nói một đằng, code một nẻo.",
    ).toEqual([]);
  });

  it("(2) census KHÔNG rỗng và bộ dò nhánh CHẠY THẬT — chống xanh-rỗng", () => {
    // Nếu scanner hỏng (đổi cây thư mục, đổi tên `HttpStatus`, parse lỗi) thì ca (1) xanh vì KHÔNG
    // TÌM THẤY GÌ, không phải vì sạch. Hai neo dưới là điều kiện để tin ca (1)
    // ([[test-noise-anchor-hides-a-branch]]).
    const sites = tooManyRequestsThrowSites();
    expect(
      sites.length,
      "scanner không thấy điểm ném 429 nào trong apps/api/src/auth — nó đang hỏng",
    ).toBeGreaterThanOrEqual(6);

    // Neo DƯƠNG cho chính bộ dò: `login()` là đường DUY NHẤT đã đúng từ trước (S6-SEC-LOGINLOG-2),
    // và nó có hình dạng khó nhất — `throw` là ANH EM của `try` chứa lời ghi. Nếu ca này đỏ thì
    // luật "hậu duệ của block trong cùng nhất" đã bị viết lỏng thành "cùng try"/"anh em trực tiếp",
    // và ca (1) đang báo vi phạm OAN.
    const login = sites.find((s) => s.key === "AuthService#login");
    expect(login, "không tìm thấy điểm ném 429 của AuthService#login").toBeDefined();
    expect(
      login?.logsInBranch,
      "bộ dò không thấy recordLoginAttempt trong nhánh 429 của login() — luật đang quá chặt",
    ).toBe(true);
  });

  it("(2b) HÌNH `throw tooManyRequests(...)` cũng bị đếm — neo cho nhánh dò mới", () => {
    // VÌ SAO CÓ CA NÀY. S18-AUTH-RETRYAFTER-1 gom 5/6 điểm ném về một nhà máy chung
    // (`throw tooManyRequests(...)`, `src/common/filters/retry-after.ts`). Bộ dò lúc đó chỉ biết
    // hình `HttpStatus.TOO_MANY_REQUESTS` NẰM TRONG biểu thức `throw` ⇒ census tụt 6 → 1: một
    // refactor sạch, hợp lệ, vô hiệu hoá cổng an ninh này. Ca (2) bắt được vì có SÀN — nhưng nó chỉ
    // nói "scanner đang hỏng". Ca này nói hỏng Ở ĐÂU.
    //
    // ⚠️ Sàn ở đây KHÔNG được hạ để "cho qua": hạ sàn là bịt miệng cổng, đúng cái bẫy WO trên suýt
    // rơi vào. Nếu một điểm ném biến mất THẬT (hàm bị xoá), sửa số ở ĐÂY và ghi vì sao.
    const factories = tooManyRequestsFactoryNames();
    expect(
      factories.size,
      "không tìm thấy hàm nào TRẢ VỀ 429 trong src/auth + src/common — bộ dò nhà máy đang hỏng, " +
        "hoặc nhà máy đã dọn sang thư mục khác (sửa COMMON_SRC trong census, ĐỪNG hạ sàn ca (2))",
    ).toBeGreaterThan(0);
    expect(
      [...factories],
      "hợp đồng 429 của S18-AUTH-RETRYAFTER-1 không còn hàm `tooManyRequests` — nếu đổi tên là có " +
        "chủ ý thì sửa neo này; nếu hàm không còn trả 429 thì cổng đang mù, phải đo lại",
    ).toContain("tooManyRequests");

    // Neo DƯƠNG cho chính nhánh `factory`: nếu phép khớp tên nhà máy chết trong im lặng, ca này đỏ
    // TRƯỚC khi ai đó kịp nghĩ tới việc hạ sàn của ca (2) ([[deny-cases-vacuous-without-allow-case]]).
    const byFactory = tooManyRequestsThrowSites().filter((s) => s.via === "factory");
    expect(
      byFactory.length,
      "không điểm ném nào được nhận ra qua hình `throw tooManyRequests(...)` — nhánh dò mới đang chết",
    ).toBeGreaterThanOrEqual(5);
  });

  it("(3) NEO DƯƠNG cho 3 waiver post-auth: nhánh SAI vẫn ghi REAUTH_FAILED", () => {
    // Waiver của disableTwoFactor/changePassword/confirmEnable đứng được CHỈ KHI nhánh sai còn ghi.
    // Xoá một lời ghi ⇒ mất một context ⇒ ca này ĐỎ ⇒ waiver mất cơ sở.
    expect([...reauthFailedContexts()].sort()).toEqual(REQUIRED_REAUTH_CONTEXTS);

    // Vế THỨ HAI của neo: chứng minh `recordReauthFailure` thật sự ghi `REAUTH_FAILED`, không phải
    // một hàm cùng tên làm việc khác. Hai writer (auth.service + two-factor.service) ⇒ ≥2.
    expect(
      reauthFailedWriterCount(),
      "không có lời gọi securityEvents.record nào mang eventType REAUTH_FAILED",
    ).toBeGreaterThanOrEqual(2);
  });

  it("(4) NEO DƯƠNG cho waiver stepUp: nửa (b) của A09 còn nguyên", () => {
    // Waiver của stepUp dựa vào "mọi nhánh từ chối CÓ ghi vết đều recordFailure ⇒ trần lưu trữ mỗi
    // cửa sổ là STEP_UP_MAX_ATTEMPTS hàng". Xoá nửa (b) ⇒ trần quay lại VÔ HẠN ⇒ waiver sai ⇒ ĐỎ.
    const a = stepUpAntiAmplificationAnchors();
    expect(
      a.recordFailure,
      "step-up.service.ts không còn recordFailure ở nhánh từ chối — nửa (b) của A09 đã mất",
    ).toBeGreaterThanOrEqual(1);
    expect(
      a.writeOutcome,
      "step-up.service.ts không còn writeOutcome — nhánh từ chối không để lại vết nữa",
    ).toBeGreaterThanOrEqual(1);
  });

  it("(5) NEO DƯƠNG cho waiver enroll: CẢ HAI nhánh account_gone của 2FA còn bồi bộ đếm", () => {
    // S18-AUTH-490DEBT-1 (nợ §8.2 của #490). Waiver `TwoFactorService#enroll` dựa vào: nhánh từ chối
    // bồi `recordFailure` ⇒ trần lưu trữ mỗi cửa sổ là LOGIN_MAX_ATTEMPTS hàng `audit_logs`, không
    // phải vô hạn. Xoá lời gọi đó ⇒ trần quay lại vô hạn ⇒ waiver mất cơ sở ⇒ ca này ĐỎ.
    //
    // ⚠️ ĐẲNG THỨC THEO KHOÁ, KHÔNG PHẢI TỔNG ĐẾM. Một sàn kiểu `withRecordFailure >= 2` sẽ xanh khi
    // ai đó DỜI `recordFailure` từ `enroll` sang `disable` — tổng vẫn 2 trong khi lỗ mở lại. Đây đúng
    // là điểm mù của `stepUpAntiAmplificationAnchors()` ở ca (4), cố ý không lặp lại
    // ([[index-ratchet-must-pin-definition-not-name]]).
    //
    // ⚠️ `TwoFactorService#disable` là `false` CÓ CHỦ Ý, không phải bỏ sót. Nhánh `account_gone` của
    // `disable()` chỉ tới được sau khi re-auth mật khẩu ĐÚNG và chỉ khi một lượt xoá mềm chen vào
    // giữa hai tx ⇒ không phải đường lặp-được-miễn-phí. Đường lặp-được của nó đã bị đếm ở TẦNG TRÊN:
    // `AuthService.disableTwoFactor` ghi `auth.2fa_disable_denied` rồi rơi xuống nhánh `!ok` ⇒
    // `recordFailure` trên bucket `2fa-disable`. Vế `false` vì thế ghim CẢ CHIỀU CẤM: thêm
    // `recordFailure` vào `disable` cũng làm ca này đỏ, và người thêm phải nói ra lý do.
    const a = twoFactorDenyBranchAnchors();
    expect(
      a.branches.map((b) => `${b.key}:${b.withRecordFailure}`).sort(),
      "hình dạng nhánh `account_gone` của two-factor.service.ts đã đổi — đọc plan " +
        "docs/plans/S18-AUTH-490DEBT-1.md §4 D5 trước khi sửa con số ở đây",
    ).toEqual([
      "TwoFactorService#confirmEnable:true",
      "TwoFactorService#disable:false",
      "TwoFactorService#enroll:true",
    ]);

    expect(
      a.badCodeHasBoth,
      "nhánh `bad_code` của confirmEnable mất `recordFailure` hoặc `recordReauthFailure` — ranh giới " +
        "ĐẾM ↔ NHÃN (D1.d của #490) đang mờ đi, và neo ca (3) mất một chân",
    ).toBe(true);
  });
});
