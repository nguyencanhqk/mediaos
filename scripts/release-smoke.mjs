#!/usr/bin/env node
/**
 * release-smoke.mjs — S6-REL-1 (D4) · SMOKE SAU DEPLOY, chạy được (IMPLEMENTATION-09 §17.4).
 *
 * §17.4 định nghĩa 10 ca IMP09-SMOKE-001…010 dưới dạng BẢNG TRONG TÀI LIỆU. Bảng không chạy được thì
 * ở phút go-live nó là danh sách để tự trấn an, không phải bằng chứng. Script này biến đúng 10 ca đó
 * thành lệnh có exit code.
 *
 * ═══ KHÁC perf-smoke.mjs ═══ (cùng khuôn đăng nhập, khác hợp đồng thất bại)
 * `perf-smoke.mjs` đo độ trễ và cố ý SKIP-exit-0 khi không nối được server (không phá CI).
 * Smoke sau deploy thì NGƯỢC LẠI: không nối được = ĐỎ. Vừa deploy xong mà smoke "bỏ qua vì không
 * thấy server" là đúng cái tình huống phải hét lên.
 *
 * ═══ AN TOÀN TRÊN PROD ═══
 * - MẶC ĐỊNH CHỈ ĐỌC. §17.4 SMOKE-008 cho phép "smoke read-only pass" thay cho việc tạo đơn nghỉ thật.
 * - Nhánh GHI chỉ chạy khi có `--write`: tạo đơn LEAVE nháp bằng tài khoản chỉ định rồi XOÁ NGAY và
 *   verify đã xoá. Không có `--write` thì không có một byte nào được ghi vào PROD.
 * - Không log token/mật khẩu. Cred lấy từ env.
 *
 * ═══ VÌ SAO CÓ --expect-commit ═══
 * Bẫy đã xảy ra thật trên dự án này: restart service làm PID/log/env trông như đã deploy trong khi
 * `dist` vẫn là code CŨ. Smoke xanh lúc đó chỉ chứng minh "hệ thống cũ vẫn chạy tốt". Cờ này đối chiếu
 * `/health` → `data.build.commit` với sha kỳ vọng; `unknown` (build không stamp) luôn ĐỎ.
 *
 * ═══ DÙNG ═══
 *   node scripts/release-smoke.mjs                          # PROD local, chỉ đọc
 *   node scripts/release-smoke.mjs --base http://localhost:3200/api/v1     # staging/UAT
 *   node scripts/release-smoke.mjs --expect-commit c4afe351
 *   node scripts/release-smoke.mjs --write                   # bật SMOKE-008 nhánh ghi (cần tài khoản test)
 *   node scripts/release-smoke.mjs --json
 *   node scripts/release-smoke.mjs --strict                  # SKIP cũng tính là ĐỎ
 *
 * ENV: SMOKE_BASE_URL · SMOKE_WEB_URL · SMOKE_EMAIL · SMOKE_PASSWORD · SMOKE_COMPANY_SLUG
 *      SMOKE_EMPLOYEE_EMAIL · SMOKE_EMPLOYEE_PASSWORD (thiếu ⇒ SMOKE-003 SKIP, KHÔNG pass ngầm)
 *      SMOKE_TOTP_SECRET · SMOKE_EMPLOYEE_TOTP_SECRET (chỉ khi tài khoản smoke bị ép 2FA — đọc cảnh
 *      báo bảo mật ở hàm `totp` trước khi dùng)
 *      SMOKE_TIMEOUT_MS
 *
 * Exit: 0 tất cả PASS · 1 có ca ĐỎ · 2 không đăng nhập được / không với tới API · 3 sai cách dùng.
 */

import { createHmac } from "node:crypto";

const ARGV = process.argv.slice(2);
const flag = (name) => ARGV.includes(name);
function opt(name, fallback) {
  const i = ARGV.indexOf(name);
  return i >= 0 && ARGV[i + 1] && !ARGV[i + 1].startsWith("--") ? ARGV[i + 1] : fallback;
}

const BASE_URL = opt(
  "--base",
  process.env.SMOKE_BASE_URL ?? "http://localhost:3100/api/v1",
).replace(/\/$/, "");
const WEB_URL = opt("--web", process.env.SMOKE_WEB_URL ?? "https://funtimemediacorp.com").replace(
  /\/$/,
  "",
);
const EMAIL = process.env.SMOKE_EMAIL ?? "";
const PASSWORD = process.env.SMOKE_PASSWORD ?? "";
const COMPANY_SLUG = process.env.SMOKE_COMPANY_SLUG ?? "";
const EMP_EMAIL = process.env.SMOKE_EMPLOYEE_EMAIL ?? "";
const EMP_PASSWORD = process.env.SMOKE_EMPLOYEE_PASSWORD ?? "";
const TOTP_SECRET = process.env.SMOKE_TOTP_SECRET ?? "";
const EMP_TOTP_SECRET = process.env.SMOKE_EMPLOYEE_TOTP_SECRET ?? "";
const TIMEOUT_MS = Number.parseInt(process.env.SMOKE_TIMEOUT_MS ?? "10000", 10);
const EXPECT_COMMIT = opt("--expect-commit", null);
const JSON_OUT = flag("--json");
const STRICT = flag("--strict");
const WRITE = flag("--write");

const PASS = "PASS";
const FAIL = "FAIL";
const SKIP = "SKIP";

const results = [];
function record(id, label, status, detail) {
  results.push({ id, label, status, detail });
  if (!JSON_OUT) {
    const icon = status === PASS ? "✓" : status === SKIP ? "–" : "✗";
    process.stdout.write(`  ${icon} ${id}  ${label}\n      ${detail}\n`);
  }
}

async function http(url, { token, method = "GET", body, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      signal: controller.signal,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* không phải JSON (vd trang HTML của FE) — giữ text */
    }
    return { ok: res.ok, status: res.status, json, text, headers: res.headers };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * TOTP RFC-6238 (SHA-1 · 30s · 6 số) từ secret base32.
 *
 * VÌ SAO PHẢI CÓ: PROD ép 2FA cho vai company-admin (KI-027 đóng 2026-07-28) ⇒ `POST /auth/login`
 * KHÔNG trả token nữa mà trả `{twoFactorRequired, challengeToken}`. Không xử lý bước-2 thì smoke sau
 * deploy KHÔNG chạy được trên PROD bằng tài khoản quản trị — đo được ngay lần chạy đầu của script này.
 *
 * ⚠️ BẢO MẬT: `SMOKE_TOTP_SECRET` là yếu-tố-thứ-hai nằm cạnh mật khẩu ⇒ tài khoản đó thực chất chỉ
 * còn một yếu tố. CHỈ dùng cho tài khoản smoke chuyên dụng, quyền tối thiểu, secret nằm trong env của
 * máy chạy — KHÔNG commit, KHÔNG dùng secret của người thật. Cách ưu tiên vẫn là tài khoản smoke có
 * vai KHÔNG bị `requires_two_factor`; khi đó không cần biến này.
 */
function totp(base32Secret, atMs = Date.now()) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = base32Secret.replace(/[\s=]/g, "").toUpperCase();
  let bits = "";
  for (const ch of clean) {
    const idx = alphabet.indexOf(ch);
    if (idx < 0) throw new Error("SMOKE_TOTP_SECRET không phải base32 hợp lệ");
    bits += idx.toString(2).padStart(5, "0");
  }
  const bytes = Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => Number.parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(atMs / 1000 / 30)));
  const hmac = createHmac("sha1", bytes).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  return ((hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
}

/**
 * Đăng nhập. Thất bại ở đây = exit 2: không có token thì 8/10 ca còn lại vô nghĩa, đừng báo cáo nửa vời.
 *
 * @param retriedTwoFactor nội bộ — chặn đệ quy quá 1 lượt thử lại (xem nhánh 2FA bên dưới).
 */
async function login(email, password, slug, who, totpSecret, retriedTwoFactor = false) {
  if (!email || !password) return { token: null, reason: `thiếu cred ${who}` };
  let res;
  try {
    res = await http(`${BASE_URL}/auth/login`, {
      method: "POST",
      body: { email, password, ...(slug ? { companySlug: slug } : {}) },
    });
  } catch (err) {
    return {
      token: null,
      reason: `không kết nối được (${err?.name === "AbortError" ? "timeout" : (err?.code ?? err)})`,
    };
  }
  if (res.status === 429 || res.status === 423) {
    // Đo được khi chạy smoke nhiều lượt liên tiếp: LOGIN_MAX_ATTEMPTS=5 → khoá LOGIN_LOCKOUT_SEC=900s
    // theo bucket (companySlug, email, IP). Nói thẳng nguyên nhân, đừng để người trực go-live tưởng
    // hệ thống hỏng và kích hoạt rollback nhầm.
    return {
      token: null,
      reason:
        `HTTP ${res.status} — tài khoản/IP đang bị khoá do dò mật khẩu (LOGIN_MAX_ATTEMPTS=5 → ` +
        "LOGIN_LOCKOUT_SEC≈900s). KHÔNG phải lỗi release. Chờ hết cửa sổ hoặc dùng tài khoản smoke khác",
    };
  }
  if (!res.ok) return { token: null, reason: `HTTP ${res.status}` };

  const token = res.json?.data?.accessToken;
  if (token) return { token, body: res.json };

  // ── Bước 2: tài khoản bị ép 2FA ──────────────────────────────────────────────────────────
  const challengeToken = res.json?.data?.challengeToken;
  if (res.json?.data?.twoFactorRequired && challengeToken) {
    if (!totpSecret) {
      return {
        token: null,
        reason:
          "tài khoản bị ÉP 2FA (login trả twoFactorRequired) — đặt SMOKE_TOTP_SECRET cho tài khoản " +
          "smoke, hoặc dùng tài khoản smoke có vai KHÔNG requires_two_factor",
      };
    }
    let step2;
    try {
      step2 = await http(`${BASE_URL}/auth/2fa/verify`, {
        method: "POST",
        body: { challengeToken, code: totp(totpSecret) },
      });
    } catch (err) {
      return { token: null, reason: String(err.message) };
    }

    /**
     * 401 ở bước-2 khi chạy smoke hai lượt sát nhau là **BÌNH THƯỜNG**, không phải release hỏng:
     * server chống replay TOTP theo time-step 30s (`two-factor.service.ts` — `totp-step:<user>:<step>`),
     * nên cùng cửa sổ ⇒ cùng mã ⇒ bị từ chối. Đo được thật khi kiểm exit code của script này (2026-07-30).
     *
     * Thử lại phải **ĐĂNG NHẬP LẠI TỪ ĐẦU**, không dùng lại `challengeToken`: `auth.service.ts` claim
     * `2fa-jti:<jti>` trong 600s ⇒ challenge là **DÙNG-MỘT-LẦN kể cả khi mã sai**. Retry tại chỗ với
     * challenge cũ sẽ 401 mãi (đúng lần vá đầu của tôi — sai vì bỏ qua chi tiết này).
     * Đúng MỘT lượt: mỗi lượt tốn một lần đăng nhập, mà `LOGIN_MAX_ATTEMPTS=5`.
     */
    if (step2.status === 401 && !retriedTwoFactor) {
      const waitMs = 30_000 - (Date.now() % 30_000) + 1_000;
      if (!JSON_OUT) {
        process.stdout.write(
          `      (2FA 401 — mã của cửa sổ 30s hiện tại đã dùng; chờ ${Math.ceil(waitMs / 1000)}s rồi ĐĂNG NHẬP LẠI với mã mới)\n`,
        );
      }
      await new Promise((r) => setTimeout(r, waitMs));
      return login(email, password, slug, who, totpSecret, true);
    }
    if (!step2.ok) return { token: null, reason: `2FA bước-2 → HTTP ${step2.status}` };
    const t2 = step2.json?.data?.accessToken;
    return t2
      ? { token: t2, body: step2.json }
      : { token: null, reason: "2FA bước-2 trả 200 nhưng thiếu accessToken" };
  }

  return { token: null, reason: "200 nhưng không có accessToken lẫn challengeToken 2FA" };
}

/** GET có token, PASS khi 2xx + (tuỳ chọn) hàm kiểm nội dung trả về chuỗi lý do khi hỏng. */
async function probe(id, label, path, token, check) {
  try {
    const res = await http(`${BASE_URL}${path}`, { token });
    if (!res.ok) return record(id, label, FAIL, `${path} → HTTP ${res.status}`);
    const problem = check ? check(res.json) : null;
    if (problem) return record(id, label, FAIL, `${path} → 200 nhưng ${problem}`);
    return record(id, label, PASS, `${path} → 200`);
  } catch (err) {
    record(
      id,
      label,
      FAIL,
      `${path} → ${err?.name === "AbortError" ? "timeout" : (err?.code ?? err)}`,
    );
  }
}

async function main() {
  if (!JSON_OUT) {
    process.stdout.write(`\nRELEASE SMOKE (IMPL-09 §17.4) — api=${BASE_URL}  web=${WEB_URL}\n`);
    process.stdout.write(`chế độ: ${WRITE ? "CÓ GHI (--write)" : "CHỈ ĐỌC"}\n\n`);
  }

  // ── SMOKE-010 (chạy trước vì các ca sau dựa vào việc API còn sống) + kiểm định danh build ──
  let health = null;
  try {
    const res = await http(`${BASE_URL}/health`);
    health = res.json?.data ?? null;
    const requestId = res.json?.meta?.request_id;
    if (!res.ok || health?.status !== "ok") {
      record(
        "IMP09-SMOKE-010",
        "Health + request id",
        FAIL,
        `/health → HTTP ${res.status}, status=${health?.status}`,
      );
    } else if (!requestId) {
      record(
        "IMP09-SMOKE-010",
        "Health + request id",
        FAIL,
        "/health 200 nhưng thiếu meta.request_id",
      );
    } else {
      const b = health.build ?? {};
      record(
        "IMP09-SMOKE-010",
        "Health + request id + định danh build",
        PASS,
        `/health 200 · request_id ok · build ${b.version ?? "?"} · ${b.commit ?? "?"} · ${b.migrationHead ?? "?"}`,
      );
    }
  } catch (err) {
    record("IMP09-SMOKE-010", "Health + request id", FAIL, `/health → ${err?.code ?? err}`);
    finish(2, "API không phản hồi — không chạy tiếp được");
  }

  if (EXPECT_COMMIT) {
    const actual = health?.build?.commit ?? "unknown";
    const okCommit = actual !== "unknown" && actual.startsWith(EXPECT_COMMIT);
    record(
      "RC-BUILD-MATCH",
      "Bản đang chạy đúng bản vừa deploy",
      okCommit ? PASS : FAIL,
      okCommit
        ? `build.commit=${actual} khớp --expect-commit=${EXPECT_COMMIT}`
        : `build.commit=${actual} KHÔNG khớp --expect-commit=${EXPECT_COMMIT} ⇒ service đang chạy artifact khác (restart ≠ rebuild)`,
    );
  }

  // ── SMOKE-001 — frontend load ────────────────────────────────────────────────────────────
  try {
    const res = await http(WEB_URL);
    const looksLikeApp = /<div[^>]+id="root"|<script/i.test(res.text ?? "");
    if (!res.ok)
      record("IMP09-SMOKE-001", "Mở frontend URL", FAIL, `${WEB_URL} → HTTP ${res.status}`);
    else if (!looksLikeApp)
      record(
        "IMP09-SMOKE-001",
        "Mở frontend URL",
        FAIL,
        `${WEB_URL} → 200 nhưng không giống SPA (thiếu #root/script)`,
      );
    else record("IMP09-SMOKE-001", "Mở frontend URL", PASS, `${WEB_URL} → 200, HTML SPA`);
  } catch (err) {
    record("IMP09-SMOKE-001", "Mở frontend URL", FAIL, `${WEB_URL} → ${err?.code ?? err}`);
  }

  // ── SMOKE-002 — login admin ──────────────────────────────────────────────────────────────
  const admin = await login(
    EMAIL,
    PASSWORD,
    COMPANY_SLUG,
    "admin (SMOKE_EMAIL/SMOKE_PASSWORD)",
    TOTP_SECRET,
  );
  if (!admin.token) {
    record("IMP09-SMOKE-002", "Login admin", FAIL, `đăng nhập thất bại: ${admin.reason}`);
    finish(2, "không có phiên admin — 7 ca còn lại không đo được");
  }
  record("IMP09-SMOKE-002", "Login admin", PASS, "200 + accessToken");
  const token = admin.token;

  // ── SMOKE-003 — login employee + thấy app đúng quyền ─────────────────────────────────────
  const emp = await login(
    EMP_EMAIL,
    EMP_PASSWORD,
    COMPANY_SLUG,
    "employee (SMOKE_EMPLOYEE_*)",
    EMP_TOTP_SECRET,
  );
  if (!emp.token) {
    record(
      "IMP09-SMOKE-003",
      "Login employee + my-apps",
      SKIP,
      `không chạy được: ${emp.reason} — ca này KHÔNG được coi là pass`,
    );
  } else {
    const res = await http(`${BASE_URL}/foundation/modules/my-apps`, { token: emp.token });
    const apps = res.json?.data;
    if (!res.ok)
      record("IMP09-SMOKE-003", "Login employee + my-apps", FAIL, `my-apps → HTTP ${res.status}`);
    else if (!Array.isArray(apps))
      record(
        "IMP09-SMOKE-003",
        "Login employee + my-apps",
        FAIL,
        "my-apps 200 nhưng data không phải mảng",
      );
    else
      record(
        "IMP09-SMOKE-003",
        "Login employee + my-apps",
        PASS,
        `my-apps → ${apps.length} app theo quyền`,
      );
  }

  // ── SMOKE-004…007, 009 — đường đọc chính ─────────────────────────────────────────────────
  await probe("IMP09-SMOKE-004", "GET /auth/me", "/auth/me", token, (b) =>
    b?.data?.id || b?.data?.user?.id ? null : "thiếu định danh user trong data",
  );
  await probe("IMP09-SMOKE-005", "Mở Dashboard", "/dashboard/me", token, (b) =>
    b?.data ? null : "thiếu data",
  );
  await probe(
    "IMP09-SMOKE-006",
    "Employee list + phân trang",
    "/hr/employees?page=1&pageSize=20",
    token,
    // Phân trang nằm ở `data.meta`; `meta` ngoài cùng của envelope là request_id/timestamp — KHÔNG
    // phải phân trang. Đo trên response thật; nhầm hai chỗ này đúng là bẫy ở memory
    // `apifetch-drops-pagination-bare-array`.
    (b) =>
      b?.data?.meta?.total !== undefined && Array.isArray(b?.data?.items)
        ? null
        : "thiếu data.meta.total hoặc data.items",
  );
  await probe("IMP09-SMOKE-007", "Attendance today", "/attendance/today", token, (b) =>
    b?.data !== undefined ? null : "thiếu data",
  );
  await probe(
    "IMP09-SMOKE-009",
    "Notification dropdown + unread",
    "/notifications/unread-count",
    token,
    (b) => (b?.data !== undefined ? null : "thiếu data"),
  );

  // ── SMOKE-008 — LEAVE ────────────────────────────────────────────────────────────────────
  if (!WRITE) {
    await probe(
      "IMP09-SMOKE-008",
      "LEAVE (read-only theo §17.4)",
      "/leave/requests?page=1&pageSize=5",
      token,
      (b) => (b?.data !== undefined ? null : "thiếu data"),
    );
  } else {
    await smokeLeaveWrite(token);
  }

  const failed = results.filter((r) => r.status === FAIL).length;
  const skipped = results.filter((r) => r.status === SKIP).length;
  if (failed > 0) finish(1, `${failed} ca ĐỎ`);
  if (skipped > 0 && STRICT) finish(1, `${skipped} ca SKIP (--strict coi SKIP là đỏ)`);
  finish(0, skipped > 0 ? `tất cả ca chạy được đều PASS, còn ${skipped} ca SKIP` : "tất cả PASS");
}

/**
 * Nhánh GHI của SMOKE-008: tạo đơn nghỉ rồi XOÁ. §17.4 bắt buộc "cleanup ngay sau khi verify".
 * Tạo được mà không xoá được là ĐỎ — để lại rác trong PROD nguy hiểm hơn là không chạy ca này.
 */
async function smokeLeaveWrite(token) {
  const id = "IMP09-SMOKE-008";
  const label = "LEAVE tạo đơn + cleanup (--write)";
  const types = await http(`${BASE_URL}/leave/types`, { token });
  const leaveTypeId = types.json?.data?.[0]?.id;
  if (!leaveTypeId) return record(id, label, SKIP, "không lấy được leave type để tạo đơn nháp");

  const day = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const created = await http(`${BASE_URL}/leave/requests`, {
    token,
    method: "POST",
    body: {
      leaveTypeId,
      startDate: day,
      endDate: day,
      reason: "[SMOKE] release smoke — sẽ xoá ngay",
    },
  });
  const requestId = created.json?.data?.id;
  if (!created.ok || !requestId) {
    return record(
      id,
      label,
      FAIL,
      `tạo đơn → HTTP ${created.status} ${created.json?.error?.code ?? ""}`,
    );
  }

  const removed = await http(`${BASE_URL}/leave/requests/${requestId}`, {
    token,
    method: "DELETE",
  });
  const cancelled = removed.ok
    ? removed
    : await http(`${BASE_URL}/leave/requests/${requestId}/cancel`, {
        token,
        method: "POST",
        body: { reason: "[SMOKE] cleanup" },
      });
  if (!cancelled.ok) {
    return record(
      id,
      label,
      FAIL,
      `ĐÃ TẠO ${requestId} nhưng KHÔNG dọn được (HTTP ${cancelled.status}) — dọn tay NGAY`,
    );
  }
  record(id, label, PASS, `tạo ${requestId} → dọn xong (verify HTTP ${cancelled.status})`);
}

function finish(code, summary) {
  const counts = {
    pass: results.filter((r) => r.status === PASS).length,
    fail: results.filter((r) => r.status === FAIL).length,
    skip: results.filter((r) => r.status === SKIP).length,
  };
  if (JSON_OUT) {
    process.stdout.write(
      `${JSON.stringify({ baseUrl: BASE_URL, webUrl: WEB_URL, write: WRITE, counts, summary, results }, null, 2)}\n`,
    );
  } else {
    process.stdout.write(
      `\n  ${counts.pass} PASS · ${counts.fail} FAIL · ${counts.skip} SKIP — ${summary}\n\n`,
    );
  }
  process.exit(code);
}

main().catch((err) => {
  process.stderr.write(`[smoke] lỗi ngoài dự kiến: ${err?.stack ?? err}\n`);
  process.exit(3);
});
