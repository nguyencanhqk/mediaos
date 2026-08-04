/**
 * SMOKE trình duyệt cho S7-CHAT-FE-3 — ba dòng `done_when` chỉ đo được trên trình duyệt thật.
 *
 * Anh em với `ws-connection-smoke.mjs` (FE-1) và mượn nguyên tầng stub của nó; khác ở chỗ FE-1 đo shell
 * lúc CHƯA có panel nổi, còn bài này MỞ panel ra rồi mới đo. Ba khẳng định:
 *
 *   1. Mở 3 hội thoại nổi ⇒ vẫn ĐÚNG MỘT lần bắt tay Socket.IO. Đây là vế "dùng CHUNG kết nối WS với
 *      /chat, không kết nối thứ hai" — thứ đọc code chỉ *gợi ý* được (file không import socket.io) chứ
 *      không chứng minh: một `useQuery` với `refetchInterval` hay một hook lồng sâu vẫn có thể mở thêm.
 *   2. Trần 3 cửa sổ có hiệu lực — mở phòng thứ 4 vẫn còn đúng 3.
 *   3. Container dock có `pointer-events: none` **theo computed style** (không phải theo tên class), và
 *      cửa sổ bên trong có `auto`. Test jsdom chỉ so được chuỗi className; Tailwind có biên dịch ra đúng
 *      thuộc tính hay không thì chỉ trình duyệt trả lời được.
 *
 * Cái KHÔNG đo (nói trước để không ai đọc quá lời): server thật — handshake bị stub ngay trong trình
 * duyệt. Gateway/CORS đã có int-spec riêng của `S7-CHAT-RT-0`/`RT-1`.
 *
 * Chạy:  pnpm --filter @mediaos/app dev     (cổng 5273)
 *        node apps/app/scripts/chat-dock-smoke.mjs
 * CHẠY TAY — KHÔNG nằm trong CI (cần trình duyệt + dev server).
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

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

const ok = (data) => ({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify({ success: true, data, error: null, meta: { request_id: "smoke" } }),
});

const ME = {
  id: USER_ID,
  companyId: COMPANY_ID,
  email: "smoke@demo.local",
  fullName: "Smoke Test",
  status: "Active",
  // Cặp THẬT mà FE gate — KHÔNG dùng `*:*`, vì wildcard che mất lỗi cặp sai (useCan rơi xuống `*:*`).
  capabilities: {
    "access:chat": true,
    "view:chat-room": true,
    "send:chat-message": true,
  },
  mustSetupTwoFactor: false,
  mustChangePassword: false,
  company: { id: COMPANY_ID, name: "Cty Smoke", status: "Active" },
  employee: null,
  roles: [],
  scopes: {},
  modules: [],
};

const ROOM_IDS = [
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4",
];

const rooms = ROOM_IDS.map((id, i) => ({
  id,
  companyId: COMPANY_ID,
  refId: null,
  roomType: "group",
  name: `Nhóm Smoke ${i + 1}`,
  roomCode: `CHAT-SMOKE-${i + 1}`,
  description: null,
  lastMessageAt: `2026-08-04T1${i}:00:00.000Z`,
  lastMessageSeq: 3,
  isArchived: false,
  unreadCount: i + 1,
  createdAt: "2026-08-01T00:00:00.000Z",
}));

const roomDetail = (id) => {
  const room = rooms.find((r) => r.id === id) ?? rooms[0];
  return {
    ...room,
    myRole: "member",
    members: [
      {
        userId: USER_ID,
        userName: "Smoke Test",
        role: "member",
        joinedAt: "2026-08-01T00:00:00.000Z",
        lastReadSeq: 0,
        employeeId: null,
        avatarUrl: null,
      },
    ],
  };
};

let handshakes = 0;
let sidCounter = 0;
const pendingBySid = new Map();

async function run() {
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies([
    { name: "mediaos_csrf", value: "smoke-csrf", domain: "localhost", path: "/" },
  ]);
  const page = await context.newPage();

  // ── stub tầng vận chuyển Socket.IO (engine.io v4, CHỈ polling) ───────────────
  await page.route("**/socket.io/**", async (route) => {
    const url = new URL(route.request().url());
    const sid = url.searchParams.get("sid");
    if (!sid) {
      handshakes += 1;
      const newSid = `smoke-sid-${++sidCounter}`;
      pendingBySid.set(newSid, false);
      return route.fulfill({
        status: 200,
        contentType: "text/plain; charset=UTF-8",
        body: `0${JSON.stringify({ sid: newSid, upgrades: [], pingInterval: 25000, pingTimeout: 20000, maxPayload: 1000000 })}`,
      });
    }
    if (route.request().method() === "POST") {
      pendingBySid.set(sid, true);
      return route.fulfill({ status: 200, contentType: "text/html", body: "ok" });
    }
    if (pendingBySid.get(sid)) {
      pendingBySid.set(sid, false);
      return route.fulfill({
        status: 200,
        contentType: "text/plain; charset=UTF-8",
        body: `40/ws,{"sid":"ns-${sid}"}`,
      });
    }
    await new Promise((r) => setTimeout(r, 400));
    return route.fulfill({ status: 200, contentType: "text/plain; charset=UTF-8", body: "2" });
  });

  // ── stub REST ────────────────────────────────────────────────────────────────
  await page.route("**/api/v1/**", (route) => {
    const p = new URL(route.request().url()).pathname.replace("/api/v1", "");
    if (p === "/auth/refresh")
      return route.fulfill(ok({ accessToken: "smoke-access-token", expiresIn: 900 }));
    if (p === "/auth/me") return route.fulfill(ok(ME));
    if (p === "/me/preferences") return route.fulfill(ok({ theme: null }));
    if (p === "/chat/rooms") return route.fulfill(ok(rooms));
    const messages = p.match(/^\/chat\/rooms\/([^/]+)\/messages$/);
    if (messages) return route.fulfill(ok([]));
    const detail = p.match(/^\/chat\/rooms\/([^/]+)$/);
    if (detail) return route.fulfill(ok(roomDetail(detail[1])));
    if (p.startsWith("/foundation/company/branding")) return route.fulfill(ok({}));
    return route.fulfill(ok(null));
  });

  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  if (process.env.DEBUG_SMOKE) {
    page.on("console", (m) => console.log("   [console]", m.type(), m.text().slice(0, 200)));
  }

  console.log(`▸ mở ${APP_URL}/home …`);
  await page.goto(`${APP_URL}/home`, { waitUntil: "load" });
  await page.waitForSelector('[data-testid="chat-badge"]', { timeout: 20000 });
  await page.waitForTimeout(2000);
  const afterBoot = handshakes;
  console.log(`  bắt tay sau khi boot (đã qua StrictMode double-invoke): ${afterBoot}`);

  // Badge phải hiện tổng chưa đọc = 1+2+3+4 = 10 (cộng dồn từ store, không request nào).
  const badgeText = (await page.textContent('[data-testid="chat-badge"]'))?.trim();
  console.log(`  nhãn badge tổng chưa đọc: "${badgeText}" (kỳ vọng 10)`);

  // ── mở 4 phòng qua dropdown; trần là 3 ───────────────────────────────────────
  for (let i = 0; i < 4; i += 1) {
    await page.click('[data-testid="chat-badge"]');
    await page.waitForSelector('[data-testid="chat-badge-dropdown"]', { timeout: 5000 });
    await page.click(`[data-testid="chat-badge-dropdown"] button:has-text("Nhóm Smoke ${i + 1}")`);
    await page.waitForTimeout(900);
  }
  await page.waitForTimeout(1500);

  const windowCount = await page.locator('[data-testid="chat-dock-window"]').count();
  const afterDock = handshakes;
  console.log(`  cửa sổ nổi đang mở sau khi bấm 4 phòng: ${windowCount} (trần = 3)`);
  console.log(`  bắt tay sau khi mở panel: ${afterDock}`);

  // ── pointer-events THEO COMPUTED STYLE, không theo tên class ─────────────────
  const dockPe = await page.$eval(
    '[data-testid="chat-dock"]',
    (el) => getComputedStyle(el).pointerEvents,
  );
  const winPe = await page.$eval(
    '[data-testid="chat-dock-window"]',
    (el) => getComputedStyle(el).pointerEvents,
  );
  console.log(`  computed pointer-events — container: ${dockPe} · cửa sổ: ${winPe}`);

  // ── panel KHÔNG render trên /chat (chống hai instance cùng phòng) ────────────
  await page.goto(`${APP_URL}/chat`, { waitUntil: "load" }).catch(() => {});
  await page.waitForTimeout(2500);
  const dockOnChatPage = await page.locator('[data-testid="chat-dock"]').count();
  console.log(`  container dock khi đang ở /chat: ${dockOnChatPage} (kỳ vọng 0)`);

  await browser.close();

  console.log("\n──────── KẾT LUẬN ────────");
  const checks = [
    ["boot mở ĐÚNG 1 kết nối", afterBoot === 1, afterBoot],
    ["mở panel KHÔNG mở thêm kết nối", afterDock === afterBoot, `+${afterDock - afterBoot}`],
    ["trần 3 cửa sổ có hiệu lực", windowCount === 3, windowCount],
    ["badge tổng cộng dồn đúng", badgeText === "10", badgeText],
    ["container KHÔNG nuốt chuột", dockPe === "none", dockPe],
    ["cửa sổ VẪN nhận chuột", winPe === "auto", winPe],
    ["dock ẩn trên /chat", dockOnChatPage === 0, dockOnChatPage],
  ];
  for (const [label, pass, actual] of checks) {
    console.log(`  ${label.padEnd(34)}: ${pass ? "✅ ĐẠT" : `❌ TRƯỢT (${actual})`}`);
  }
  if (errors.length) console.log(`  ⚠️ lỗi JS trong trang: ${errors.slice(0, 3).join(" | ")}`);
  process.exit(checks.every(([, pass]) => pass) ? 0 : 1);
}

run().catch((e) => {
  console.error("SMOKE LỖI:", e);
  process.exit(2);
});
