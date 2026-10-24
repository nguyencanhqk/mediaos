async (page) => {
  // S20-CHAT-DEEPLINK-1 — đo KPI trên trình duyệt THẬT với API giả lập (Playwright MCP browser_run_code, filename=).
  // Cần: (1) dev server, cwd worktree <gốc worktree> (nhánh feat/s20-chat-deeplink-1):
  //         VITE_API_URL=http://127.0.0.1:59999/api/v1 VITE_AUTH_APP_URL=http://127.0.0.1:59998 pnpm --filter @mediaos/app exec vite --port 5299 --strictPort
  //       (2) node S20-CHAT-DEEPLINK-1.mock-api.cjs S20-CHAT-DEEPLINK-1.fixtures.json   (cùng thư mục; fixture sinh +
  //           parse bằng contracts dist/cjs qua S20-CHAT-DEEPLINK-1.gen-fixtures.cjs)
  // API giả lập là tiến trình node trên 127.0.0.1:59999 (page.route/route.fulfill làm rơi kết nối MCP ở máy này).
  const APP = "http://localhost:5299";
  const CTL = "http://127.0.0.1:59999/__smoke";
  const SHOT = ".playwright-mcp/s20-kpi/";
  const ids = {
    ME: "44444444-4444-4444-8444-444444444444",
    P: "88888888-8888-4888-8888-888888888881", // Lê Bình
    Q: "88888888-8888-4888-8888-888888888882", // Phạm Chi
    R: "99999999-9999-4999-8999-999999999901", // DM tôi↔Bình — đích thông báo CHAT_DIRECT_MESSAGE
    G: "99999999-9999-4999-8999-999999999902", // nhóm «Dự án A»
    D: "99999999-9999-4999-8999-999999999903", // DM tôi↔Chi — server tạo khi «Nhắn riêng»
    X: "99999999-9999-4999-8999-9999999999ff", // uuid hợp lệ, KHÔNG có trong danh sách phòng của tôi
  };
  const DENIED = "Không mở được cuộc trò chuyện này";
  const result = { env: {}, A: {}, B: {}, C: {}, D: {}, unmocked: [], pageErrors: [], errors: [] };

  const setState = async (patch) =>
    (await page.request.post(`${CTL}/state`, { data: patch })).json();
  const getLog = async () => (await page.request.get(`${CTL}/log`)).json();
  const callsOf = async (phase) =>
    (await getLog()).log
      .filter((r) => r.phase === phase && !r.path.startsWith("/socket.io"))
      .map((r) => `${r.method} ${r.path}${r.query}`);

  // ── Bộ đếm ───────────────────────────────────────────────────────────────────────────────────
  // docs/plans/S20-WORKUX-STORIES.md «Cách đếm thao tác»: 1 click · 1 phím tắt · 1 lần nhập một trường · 1 lần bấm gửi.
  // Chuyển trang đếm riêng = pathname đổi. Kèm: số lần TẢI LẠI tài liệu (main-frame load) và history.length.
  const parseUrl = (u) => {
    const noHash = u.split("#")[0];
    const qi = noHash.indexOf("?");
    const base = qi < 0 ? noHash : noHash.slice(0, qi);
    const rest = base.indexOf("://") < 0 ? base : base.slice(base.indexOf("://") + 3);
    const si = rest.indexOf("/");
    return { pathname: si < 0 ? "/" : rest.slice(si), search: qi < 0 ? "" : noHash.slice(qi) };
  };
  const pathOf = () => parseUrl(page.url()).pathname;
  let docLoads = 0;
  page.on("load", () => {
    docLoads += 1;
  });
  page.on("pageerror", (e) =>
    result.pageErrors.push(String(e.message).split("\n")[0].slice(0, 200)),
  );
  const counter = { actions: 0, transitions: 0, steps: [], lastPath: null, docLoadsAtStart: 0 };
  const resetCounter = () => {
    counter.actions = 0;
    counter.transitions = 0;
    counter.steps = [];
    counter.lastPath = pathOf();
    counter.docLoadsAtStart = docLoads;
  };
  async function act(label, fn) {
    counter.actions += 1;
    await fn();
    await page.waitForTimeout(200);
    const p = pathOf();
    const moved = p !== counter.lastPath;
    if (moved) counter.transitions += 1;
    counter.steps.push(
      `${counter.actions}. ${label}${moved ? `  => pathname ${counter.lastPath} -> ${p}` : ""}`,
    );
    counter.lastPath = p;
  }
  const summary = () => ({
    actions: counter.actions,
    pathnameChanges: counter.transitions,
    documentReloads: docLoads - counter.docLoadsAtStart,
    steps: [...counter.steps],
  });
  const shot = (name) =>
    page
      .screenshot({ path: SHOT + name })
      .catch((e) => result.errors.push(`shot ${name}: ${e.message}`));
  const settle = async () => {
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(400);
  };
  const historyLen = () => page.evaluate(() => history.length);
  const focusInfo = () =>
    page.evaluate(() => {
      const a = document.activeElement;
      return {
        tag: a?.tagName ?? null,
        ariaLabel: a?.getAttribute("aria-label") ?? null,
        inDrawer: !!a?.closest('[data-testid="chat-drawer"]'),
      };
    });
  const bodyHas = (text) => page.evaluate((t) => document.body.innerText.includes(t), text);

  // ── Phiên ────────────────────────────────────────────────────────────────────────────────────
  await page.addInitScript(() => {
    document.cookie = "mediaos_csrf=csrf-smoke; path=/";
  });
  await page.setViewportSize({ width: 1366, height: 900 });

  const PARTS = ["A", "B", "C", "D"];
  async function run(name, fn) {
    if (!PARTS.includes(name)) return;
    try {
      await fn();
    } catch (e) {
      result.errors.push(`${name}: ${String(e.message).split("\n")[0]}`);
      await shot(`deeplink-${name}-error.png`);
    }
  }

  // ── A · KPI #1: xuất phát /tasks → chuông → thông báo CHAT_DIRECT_MESSAGE của R → gõ → gửi ──────────
  await run("A", async () => {
    await setState({ resetLog: true, resetData: true, me: "meFull", phase: "A-load" });
    await page.goto(`${APP}/tasks`);
    await page.getByRole("heading", { name: "Công việc" }).first().waitFor({ timeout: 20000 });
    await settle();
    result.env.browserTimeZone = await page.evaluate(
      () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
    result.A.bootCalls = await callsOf("A-load");
    await setState({ phase: "A-flow" });
    const urlBefore = page.url();
    const histBefore = await historyLen();
    resetCounter();
    await act("bấm chuông «Thông báo»", () =>
      page.getByRole("button", { name: "Thông báo" }).click(),
    );
    await act(
      "bấm thông báo «Lê Bình nhắn tin cho bạn» (CHAT_DIRECT_MESSAGE, target /chat/R)",
      () => page.getByText("Lê Bình nhắn tin cho bạn").first().click(),
    );
    const drawer = page.locator('[data-testid="chat-drawer"]');
    await drawer.waitFor({ timeout: 10000 });
    await drawer.getByText("Anh xem giúp em báo giá nhé").first().waitFor({ timeout: 10000 });
    await page.waitForTimeout(300);
    result.A.drawerTitle = (await drawer.innerText()).split("\n").slice(0, 2).join(" | ");
    result.A.focusAfterOpen = await focusInfo();
    result.A.urlAfterOpen = page.url();
    await shot("deeplink-A1-drawer-open.png");
    const posted = page.waitForResponse(
      (r) => r.url().includes(`/chat/rooms/${ids.R}/messages`) && r.request().method() === "POST",
      { timeout: 10000 },
    );
    // Gõ vào phần tử ĐANG focus (không bấm vào ô trước) — chứng minh focus là thật.
    await act("nhập nội dung trả lời (gõ thẳng, không bấm vào ô)", () =>
      page.keyboard.type("Dạ em xem ngay ạ"),
    );
    await act("Enter = gửi", () => page.keyboard.press("Enter"));
    const resp = await posted.catch(() => null);
    result.A.sendStatus = resp ? resp.status() : "KHÔNG có POST";
    await page.waitForTimeout(500);
    result.A.sentVisibleInDrawer = (await drawer.getByText("Dạ em xem ngay ạ").count()) > 0;
    await shot("deeplink-A2-sent.png");
    result.A.counts = summary();
    result.A.urlBefore = urlBefore;
    result.A.urlAfter = page.url();
    result.A.urlUnchanged = urlBefore === page.url();
    result.A.historyDelta = (await historyLen()) - histBefore;
    result.A.flowCalls = await callsOf("A-flow");
  });

  // ── B · KPI #2: xuất phát /chat/G (phòng nhóm) → avatar/tên Phạm Chi → «Nhắn riêng» → gõ → gửi ───────
  await run("B", async () => {
    await setState({ resetLog: true, resetData: true, me: "meFull", phase: "B-load" });
    await page.goto(`${APP}/chat/${ids.G}`);
    await page.getByText("Mọi người duyệt kế hoạch tuần nhé").last().waitFor({ timeout: 20000 });
    await settle();
    await setState({ phase: "B-flow" });
    const triggers = page.locator('[data-testid="chat-sender-menu-trigger"]');
    result.B.senderTriggers = await triggers.evaluateAll((els) =>
      els.map((e) => e.getAttribute("aria-label")),
    );
    // Đánh dấu nút DOM của danh sách phòng + gõ sẵn ô tìm phòng (KHÔNG tính thao tác — chỉ là đầu dò): sau luồng
    // còn đúng nút đó và ô tìm còn giữ chữ ⇒ trang KHÔNG dựng lại (đổi phòng = `replace` trong cùng ChatPage).
    await page.getByPlaceholder(/Tìm/).first().fill("Dự");
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      window.__smokeMark = document.querySelector('[data-testid="chat-room-list"]');
      window.__smokeSearch = document.querySelector('input[placeholder*="Tìm"]');
    });
    const urlBefore = page.url();
    const histBefore = await historyLen();
    resetCounter();
    await act("bấm avatar/tên «Phạm Chi» trên tin nhóm", () =>
      page
        .locator('[data-testid="chat-sender-menu-trigger"][aria-label="Tuỳ chọn với Phạm Chi"]')
        .first()
        .click(),
    );
    await shot("deeplink-B1-sender-menu.png");
    const directPosted = page.waitForResponse(
      (r) => r.url().endsWith("/chat/rooms/direct") && r.request().method() === "POST",
      { timeout: 10000 },
    );
    await act("chọn «Nhắn riêng»", () =>
      page.getByRole("menuitem", { name: "Nhắn riêng" }).click(),
    );
    const dr = await directPosted.catch(() => null);
    result.B.openDirect = dr
      ? { status: dr.status(), body: dr.request().postDataJSON() }
      : "KHÔNG có POST /chat/rooms/direct";
    await page.waitForURL(new RegExp(`/chat/${ids.D}`), { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(800);
    result.B.urlAfterOpen = page.url();
    result.B.focusAfterOpen = await focusInfo();
    await shot("deeplink-B2-dm-open.png");
    const focused = result.B.focusAfterOpen.tag === "TEXTAREA";
    if (!focused) {
      await act("bấm vào ô soạn (ô soạn KHÔNG tự focus)", () =>
        page.getByRole("textbox", { name: "Nhập tin nhắn…" }).click(),
      );
    }
    const posted = page.waitForResponse(
      (r) => r.url().includes(`/chat/rooms/${ids.D}/messages`) && r.request().method() === "POST",
      { timeout: 10000 },
    );
    await act("nhập nội dung (gõ thẳng vào phần tử đang focus)", () =>
      page.keyboard.type("Chi ơi, hỏi riêng chút nhé"),
    );
    await act("Enter = gửi", () => page.keyboard.press("Enter"));
    const resp = await posted.catch(() => null);
    result.B.sendStatus = resp ? resp.status() : "KHÔNG có POST";
    await page.waitForTimeout(500);
    result.B.sentVisible = await bodyHas("Chi ơi, hỏi riêng chút nhé");
    await shot("deeplink-B3-sent.png");
    result.B.counts = summary();
    result.B.urlBefore = urlBefore;
    result.B.urlAfter = page.url();
    result.B.historyDelta = (await historyLen()) - histBefore;
    result.B.samePageInstance = await page.evaluate(() => ({
      roomListSameNode: !!window.__smokeMark && window.__smokeMark.isConnected,
      roomSearchSameNode: !!window.__smokeSearch && window.__smokeSearch.isConnected,
      roomSearchValueKept: window.__smokeSearch ? window.__smokeSearch.value : null,
    }));
    result.B.flowCalls = await callsOf("B-flow");

    // Đối chứng dương: bảng thành viên của nhóm G có «Nhắn riêng» ở hàng người khác, không ở hàng của tôi.
    await page.goto(`${APP}/chat/${ids.G}`);
    await page.getByText("Mọi người duyệt kế hoạch tuần nhé").last().waitFor({ timeout: 20000 });
    await settle();
    const row = page.locator('[data-testid="chat-info-members-row"]');
    result.B.membersRowVisible = await row.isVisible().catch(() => false);
    if (result.B.membersRowVisible) {
      await row.click();
      await page.waitForTimeout(600);
      result.B.membersSheetDirectButtons = await page
        .getByRole("button", { name: /^Nhắn riêng với / })
        .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
      await shot("deeplink-B4-members-sheet.png");
      await page.keyboard.press("Escape");
    }
  });

  // ── C · thiếu cặp create:chat-room ⇒ không có «Nhắn riêng» (người gửi lẫn bảng thành viên) ────────────
  await run("C", async () => {
    await setState({ resetLog: true, resetData: true, me: "meNoCreate", phase: "C" });
    await page.goto(`${APP}/chat/${ids.G}`);
    await page.getByText("Mọi người duyệt kế hoạch tuần nhé").last().waitFor({ timeout: 20000 });
    await settle();
    result.C.senderTriggers = await page
      .locator('[data-testid="chat-sender-menu-trigger"]')
      .count();
    result.C.nhanRiengTextOnPage = await bodyHas("Nhắn riêng");
    const row = page.locator('[data-testid="chat-info-members-row"]');
    result.C.membersRowVisible = await row.isVisible().catch(() => false);
    if (result.C.membersRowVisible) {
      await row.click();
      await page.waitForTimeout(600);
      result.C.membersSheetDirectButtons = await page
        .getByRole("button", { name: /Nhắn riêng/ })
        .count();
      result.C.nhanRiengTextWithSheetOpen = await bodyHas("Nhắn riêng");
      await shot("deeplink-C1-no-create-members.png");
      await page.keyboard.press("Escape");
    }
    // Bấm avatar người gửi khi thiếu cặp: avatar không phải nút mở menu.
    result.C.directPosts = (await callsOf("C")).filter((c) =>
      c.startsWith("POST /chat/rooms/direct"),
    ).length;
  });

  // ── D · /chat/<uuid vắng> ⇒ thông điệp chung, 0 request của phòng đó; /chat/abc ⇒ replace /chat, 0 request ──
  await run("D", async () => {
    await setState({ resetLog: true, resetData: true, me: "meFull", phase: "D1" });
    await page.goto(`${APP}/chat/${ids.X}`);
    await page
      .getByText(DENIED)
      .first()
      .waitFor({ timeout: 15000 })
      .catch(() => {});
    await settle();
    await page.waitForTimeout(1500);
    const d1 = await callsOf("D1");
    result.D.X = {
      deniedMessageShown: await bodyHas(DENIED),
      urlAfter: page.url(),
      requestsWithRoomId: d1.filter((c) => c.includes(ids.X)),
      roomListCalls: d1.filter((c) => /^GET \/chat\/rooms(\?|$)/.test(c)).length,
      allChatCalls: d1.filter((c) => c.includes("/chat/")),
    };
    await shot("deeplink-D1-unlisted-room.png");

    await setState({ resetLog: true, phase: "D2-base" });
    await page.goto(`${APP}/tasks`);
    await page.getByRole("heading", { name: "Công việc" }).first().waitFor({ timeout: 20000 });
    await settle();
    const histBase = await historyLen();
    await setState({ phase: "D2" });
    await page.goto(`${APP}/chat/abc`);
    await page
      .waitForURL((u) => !String(u).includes("/chat/abc"), { timeout: 10000 })
      .catch(() => {});
    await settle();
    await page.waitForTimeout(1000);
    const d2 = await callsOf("D2");
    result.D.abc = {
      urlAfter: page.url(),
      historyDeltaFromGoto: (await historyLen()) - histBase, // 1 = chỉ goto; 2 = redirect bằng push
      requestsWithAbc: d2.filter((c) => c.includes("abc")),
      roomScopedCalls: d2.filter((c) => /\/chat\/rooms\/[^/?]+/.test(c)),
      allChatCalls: d2.filter((c) => c.includes("/chat/")),
    };
    await shot("deeplink-D2-abc.png");
  });

  result.unmocked = (await getLog()).unmocked.filter(
    (u) =>
      !u.includes("/socket.io") &&
      !u.includes("/me/avatar") &&
      !u.includes("/foundation/company/branding"),
  );
  return result;
};
