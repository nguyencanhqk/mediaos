/**
 * SMOKE trình duyệt cho S7-CHAT-FE-1 — DoD §5: "đúng MỘT kết nối `/ws`, không nhân đôi khi đổi route".
 *
 * ⚠️ Đường HTTP thật là **`/socket.io/`**, KHÔNG phải `/ws/`. `io("http://host:3100/ws")` hiểu `/ws` là
 * NAMESPACE của Socket.IO, còn `path` giữ mặc định `/socket.io/` (`@WebSocketGateway({namespace:'ws'})`
 * của Nest không đổi path). Đếm nhầm ở `/ws/` sẽ ra 0 và kết luận NGƯỢC.
 *
 * Cái được đo: **số lần BẮT TAY** = số request `GET /socket.io/?EIO=4&transport=polling` **không có
 * `sid`**. Mỗi Manager của socket.io bắt tay đúng một lần; các request sau đều mang `sid` của phiên đó.
 * Đây chính là "số kết nối" mà tab Network cho thấy.
 *
 * Cái KHÔNG được đo (nói trước để không ai đọc quá lời): server thật. Handshake được stub ngay trong
 * trình duyệt, nên đây không phải bằng chứng về gateway/CORS — chỗ đó đã có int-spec thật của
 * `S7-CHAT-RT-0`/`RT-1` với server Socket.IO chạy thật. Cái này đo phía CLIENT: React StrictMode
 * double-invoke, đổi route, và singleton `getAppSocket()`.
 *
 * Chạy: node ws-smoke.mjs   (cần vite dev của apps/app đang chạy ở :5273)
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * Playwright KHÔNG phải dependency của monorepo — nó chỉ được cài ở `apps/lms` (app Next.js có repo
 * riêng). Nạp từ đó thay vì thêm ~150MB devDependency vào workspace cho một smoke chạy tay.
 * Máy chưa có thì báo rõ cách khắc phục, đừng ném ERR_MODULE_NOT_FOUND trần.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require_(path.resolve(here, "../../lms/node_modules/playwright")));
} catch {
  console.error(
    "Không nạp được playwright — cài ở apps/lms, hoặc sửa đường dẫn ở đầu file này. " +
      "Smoke này CHẠY TAY, KHÔNG nằm trong CI.",
  );
  process.exit(2);
}

const APP_URL = process.env.APP_URL ?? "http://localhost:5273";
const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";

/** Bọc envelope chuẩn của API (`ResponseEnvelopeInterceptor`). */
const ok = (data) => ({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify({
    success: true,
    data,
    error: null,
    meta: { request_id: "smoke" },
  }),
});

const ME = {
  id: USER_ID,
  companyId: COMPANY_ID,
  email: "smoke@demo.local",
  fullName: "Smoke Test",
  status: "Active",
  // `view:chat-room` là cặp THẬT mà `useChatRealtime` gate — không dùng `*:*` cho khỏi che lỗi gate.
  capabilities: { "view:chat-room": true, "access:chat": true },
  mustSetupTwoFactor: false,
  mustChangePassword: false,
  company: { id: COMPANY_ID, name: "Cty Smoke", status: "Active" },
  employee: null,
  roles: [],
  scopes: {},
  modules: [],
};

let handshakes = 0;
let sidCounter = 0;
const pendingBySid = new Map();

async function run() {
  // `channel: "msedge"` dùng trình duyệt sẵn có của Windows thay vì tải bundle chromium riêng của
  // playwright (bản ở apps/lms đòi build mà máy có thể chưa tải). Cùng nhân Chromium — hành vi
  // socket.io/React không khác. Máy khác thì đổi sang `channel: "chrome"` hoặc bỏ hẳn `channel`.
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  const context = await browser.newContext();

  // `doRefresh()` thoát sớm nếu KHÔNG có cookie `mediaos_csrf` — không đặt thì bootstrap không bao giờ
  // chạy tới /me và app điều hướng thẳng sang apps/auth.
  await context.addCookies([
    {
      name: "mediaos_csrf",
      value: "smoke-csrf",
      domain: "localhost",
      path: "/",
    },
  ]);

  const page = await context.newPage();

  // ── stub tầng vận chuyển Socket.IO (engine.io v4, CHỈ polling) ──────────────
  // `upgrades: []` ⇒ client KHÔNG nâng cấp lên WebSocket ⇒ mọi thứ ở lại HTTP, quan sát được trọn vẹn.
  await page.route("**/socket.io/**", async (route) => {
    const url = new URL(route.request().url());
    const sid = url.searchParams.get("sid");
    const method = route.request().method();

    if (!sid) {
      handshakes += 1;
      const newSid = `smoke-sid-${++sidCounter}`;
      pendingBySid.set(newSid, false);
      return route.fulfill({
        status: 200,
        contentType: "text/plain; charset=UTF-8",
        body: `0${JSON.stringify({
          sid: newSid,
          upgrades: [],
          pingInterval: 25000,
          pingTimeout: 20000,
          maxPayload: 1000000,
        })}`,
      });
    }

    if (method === "POST") {
      // Client gửi gói CONNECT `40/ws,` — báo nhận để lượt poll kế tiếp trả ack namespace.
      pendingBySid.set(sid, true);
      return route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "ok",
      });
    }

    if (pendingBySid.get(sid)) {
      pendingBySid.set(sid, false);
      return route.fulfill({
        status: 200,
        contentType: "text/plain; charset=UTF-8",
        body: `40/ws,{"sid":"ns-${sid}"}`,
      });
    }

    // Long-poll rỗng: giữ một nhịp rồi trả ping, để client không quay vòng gọi liên tục.
    await new Promise((r) => setTimeout(r, 400));
    return route.fulfill({
      status: 200,
      contentType: "text/plain; charset=UTF-8",
      body: "2",
    });
  });

  // ── stub REST ────────────────────────────────────────────────────────────────
  await page.route("**/api/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    if (path === "/auth/refresh")
      //  BẮT BUỘC (authRefreshResponseSchema) — thiếu ⇒ safeParse fail ⇒ doRefresh trả
      // false ⇒ redirectToAuth ⇒ shell không bao giờ mount ⇒ đếm được 0 kết nối và kết luận NGƯỢC.
      return route.fulfill(ok({ accessToken: "smoke-access-token", expiresIn: 900 }));
    if (path === "/auth/me") return route.fulfill(ok(ME));
    if (path === "/me/preferences") return route.fulfill(ok({ theme: null }));
    if (path === "/chat/rooms") return route.fulfill(ok([]));
    if (path.startsWith("/foundation/company/branding")) return route.fulfill(ok({}));
    return route.fulfill(ok(null));
  });

  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  if (process.env.DEBUG_SMOKE) {
    page.on("console", (m) => console.log("   [console]", m.type(), m.text().slice(0, 200)));
    page.on("request", (r) => console.log("   [req]", r.method(), r.url().slice(0, 120)));
    page.on("framenavigated", (f) => console.log("   [nav]", f.url().slice(0, 120)));
  }

  console.log(`▸ mở ${APP_URL} …`);
  await page.goto(APP_URL, { waitUntil: "load" });
  await page.waitForTimeout(2500);
  const afterBoot = handshakes;
  console.log(`  bắt tay sau khi boot (đã qua StrictMode double-invoke): ${afterBoot}`);

  // Đổi route nhiều lần — panel nổi của FE-3 sẽ sống ở shell, nên shell KHÔNG được mở kết nối mới.
  for (const path of ["/me/account", "/home", "/me/account", "/home"]) {
    await page.goto(`${APP_URL}${path}`, { waitUntil: "load" }).catch(() => {});
    await page.waitForTimeout(600);
  }
  const afterNav = handshakes;
  console.log(`  bắt tay sau 4 lần đổi route: ${afterNav}`);

  // Điều hướng bằng router (KHÔNG reload) — đây mới là "đổi route" thật của SPA.
  await page.goto(APP_URL, { waitUntil: "load" }).catch(() => {});
  await page.waitForTimeout(1500);
  const base = handshakes;
  await page.evaluate(() => window.history.pushState({}, "", "/me/account")).catch(() => {});
  await page.waitForTimeout(1200);
  const afterSpaNav = handshakes;
  console.log(`  bắt tay do điều hướng SPA (không reload): ${afterSpaNav - base}`);

  await browser.close();

  console.log("\n──────── KẾT LUẬN ────────");
  const bootOk = afterBoot === 1;
  const spaOk = afterSpaNav - base === 0;
  console.log(
    `  boot mở ĐÚNG 1 kết nối          : ${bootOk ? "✅ ĐẠT" : `❌ TRƯỢT (${afterBoot})`}`,
  );
  console.log(
    `  điều hướng SPA KHÔNG mở thêm     : ${spaOk ? "✅ ĐẠT" : `❌ TRƯỢT (+${afterSpaNav - base})`}`,
  );
  console.log(`  (mỗi lần reload trang tất nhiên mở lại 1 — tổng sau 5 lần tải: ${afterNav})`);
  if (errors.length) console.log(`  ⚠️ lỗi JS trong trang: ${errors.slice(0, 3).join(" | ")}`);
  process.exit(bootOk && spaOk ? 0 : 1);
}

run().catch((e) => {
  console.error("SMOKE LỖI:", e);
  process.exit(2);
});
