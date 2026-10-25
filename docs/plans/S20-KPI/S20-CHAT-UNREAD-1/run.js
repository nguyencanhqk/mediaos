async (page) => {
  // S20-CHAT-UNREAD-1 — đo KPI #3 trên trình duyệt THẬT với API giả lập (Playwright MCP browser_run_code, filename=).
  // Cần: (1) dev server, cwd = gốc cây đang đo:
  //         VITE_API_URL=http://127.0.0.1:59999/api/v1 VITE_AUTH_APP_URL=http://127.0.0.1:59998 pnpm --filter @mediaos/app exec vite --port 5299 --strictPort
  //       (2) node mock-api.cjs fixtures.json   (cùng thư mục; fixture sinh + parse bằng contracts dist/cjs qua gen-fixtures.cjs)
  // API giả lập là tiến trình node trên 127.0.0.1:59999 (page.route/route.fulfill làm rơi kết nối MCP ở máy đo).
  const APP = "http://localhost:5299";
  const CTL = "http://127.0.0.1:59999/__smoke";
  const SHOT = ".playwright-mcp/s20-kpi/";
  const U = "99999999-9999-4999-8999-999999999911"; // «Kinh doanh» — unreadCount 25, lastMessageSeq 125
  const Z = "99999999-9999-4999-8999-999999999912"; // «Hành chính» — unreadCount 0, 40 tin
  const M = "99999999-9999-4999-8999-999999999913"; // «Kỹ thuật» — unreadCount 0, 60 tin, nhận tin realtime
  const TAG = { [U]: "0011", [Z]: "0012", [M]: "0013" };
  const msgId = (roomId, seq) =>
    `bbbbbbbb-${TAG[roomId]}-4000-8000-${String(seq).padStart(12, "0")}`;
  const READ_WAIT_MS = 1500; // MARK_READ_DEBOUNCE_MS = 400 + khe mạng
  const result = { env: {}, A: {}, B: {}, C: {}, D: {}, unmocked: [], pageErrors: [], errors: [] };

  const setState = async (patch) =>
    (await page.request.post(`${CTL}/state`, { data: patch })).json();
  const getLog = async () => (await page.request.get(`${CTL}/log`)).json();
  const callsOf = async (phase) =>
    (await getLog()).log
      .filter((r) => r.phase === phase && !r.path.startsWith("/socket.io"))
      .map((r) => `${r.method} ${r.path}${r.query}${r.body ? ` ${JSON.stringify(r.body)}` : ""}`);
  const readsOf = async (phase) =>
    (await getLog()).log
      .filter((r) => r.phase === phase && r.method === "POST" && /\/read$/.test(r.path))
      .map((r) => ({ path: r.path, seq: r.body?.seq ?? null }));

  // ── Bộ đếm (như S20-CHAT-DEEPLINK-1) ─────────────────────────────────────────────────────────
  // «Cách đếm thao tác» (S20-WORKUX-STORIES §4): 1 click · 1 phím tắt · 1 lần nhập · 1 lần gửi. Cuộn để
  // đọc KHÔNG phải thao tác. Chuyển trang đếm riêng = pathname đổi; kèm số lần TẢI LẠI tài liệu.
  const pathOf = () => {
    const u = page.url().split("#")[0].split("?")[0];
    const rest = u.slice(u.indexOf("://") + 3);
    const si = rest.indexOf("/");
    return si < 0 ? "/" : rest.slice(si);
  };
  let docLoads = 0;
  page.on("load", () => {
    docLoads += 1;
  });
  page.on("pageerror", (e) =>
    result.pageErrors.push(String(e.message).split("\n")[0].slice(0, 200)),
  );
  const counter = { actions: 0, transitions: 0, steps: [], lastPath: null, docLoadsAtStart: 0 };
  const resetCounter = () => {
    Object.assign(counter, { actions: 0, transitions: 0, steps: [], lastPath: pathOf() });
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

  // Hình học khung cuộn + vạch + tin đích, đo bằng layout THẬT.
  const geometry = (targetId) =>
    page.evaluate((tid) => {
      const el = document.querySelector('[data-testid="chat-message-scroll"]');
      if (!el) return { scroll: null };
      const sr = el.getBoundingClientRect();
      const inView = (r) => r.top >= sr.top - 1 && r.bottom <= sr.bottom + 1;
      const dividers = [...el.querySelectorAll('[data-testid="chat-unread-divider"]')];
      const div = dividers[0] ?? null;
      const dr = div?.getBoundingClientRect() ?? null;
      const bubbles = [...el.querySelectorAll('[data-testid="chat-message"]')];
      const firstAfterDivider = div
        ? bubbles.find((b) => div.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
        : null;
      const lastBeforeDivider = div
        ? [...bubbles]
            .reverse()
            .find((b) => div.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_PRECEDING)
        : null;
      const target = tid ? el.querySelector(`[data-message-id="${tid}"]`) : null;
      const tr = target?.getBoundingClientRect() ?? null;
      const jump = [...document.querySelectorAll("button")].find((b) =>
        /tin mới/.test(b.innerText),
      );
      return {
        scroll: {
          scrollTop: Math.round(el.scrollTop),
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
          distanceFromBottom: Math.round(el.scrollHeight - el.scrollTop - el.clientHeight),
        },
        dividerCount: dividers.length,
        dividerText: div ? div.innerText.replace(/\s+/g, " ").trim() : null,
        dividerInView: dr ? inView(dr) : null,
        dividerTopFromViewportTop: dr ? Math.round(dr.top - sr.top) : null,
        firstAfterDividerId: firstAfterDivider?.getAttribute("data-message-id") ?? null,
        lastBeforeDividerId: lastBeforeDivider?.getAttribute("data-message-id") ?? null,
        targetInView: tr ? inView(tr) : null,
        targetGapBelowDividerPx: tr && dr ? Math.round(tr.top - dr.bottom) : null,
        bubbles: bubbles.length,
        jumpButton: jump ? jump.innerText.replace(/\s+/g, " ").trim() : null,
        pageScrollY: window.scrollY,
      };
    }, targetId ?? null);
  const roomItemText = (name) =>
    page
      .locator('[data-testid="chat-room-item"]', { hasText: name })
      .first()
      .innerText()
      .then((t) => t.replace(/\s+/g, " ").trim())
      .catch(() => null);
  // Cuộn bằng bánh xe thật (sinh sự kiện `scroll` như người dùng), không gán scrollTop.
  async function wheelTo(dir, maxSteps = 40) {
    const box = await page.locator('[data-testid="chat-message-scroll"]').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < maxSteps; i += 1) {
      await page.mouse.wheel(0, dir === "down" ? 600 : -600);
      await page.waitForTimeout(120);
      const g = await geometry();
      if (dir === "down" && g.scroll.distanceFromBottom <= 2) return i + 1;
    }
    return maxSteps;
  }
  async function openChat(phase) {
    await setState({ resetLog: true, resetData: true, phase });
    await page.goto(`${APP}/chat`);
    await page
      .locator('[data-testid="chat-room-item"]', { hasText: "Kinh doanh" })
      .first()
      .waitFor({ timeout: 20000 });
    await settle();
  }
  // Bơm tin qua CHÍNH store của app (cùng module Vite) — y đường handler `chat:message` sau safeParse.
  const injectLive = async (roomId, seq, payload) => {
    await setState({ live: { roomId, seq } });
    return page.evaluate(
      async ({ roomId: rid, msg }) => {
        const mod = await import("/src/stores/chat.store.ts");
        const s = mod.useChatStore.getState();
        const before = (s.messagesByRoom[rid] ?? []).length;
        s.applyIncomingMessage(msg);
        const after = (mod.useChatStore.getState().messagesByRoom[rid] ?? []).length;
        return { before, after };
      },
      { roomId, msg: payload },
    );
  };
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
      await shot(`unread-${name}-error.png`);
    }
  }
  const liveMsg = (roomId, seq) => ({
    id: msgId(roomId, seq),
    companyId: "11111111-1111-4111-8111-111111111111",
    roomId,
    senderId: "88888888-8888-4888-8888-888888888881",
    senderName: "Lê Bình",
    body: `Tin realtime #${seq}`,
    messageType: "text",
    mentions: [],
    pinnedAt: null,
    pinnedBy: null,
    replyToMessageId: null,
    recalledAt: null,
    attachmentCount: 0,
    attachments: [],
    reactions: [],
    roomSeq: seq,
    createdAt: new Date(Date.parse("2026-10-25T01:00:00.000Z") + seq * 60000).toISOString(),
  });

  // ── A · KPI #3: /chat → bấm phòng 25 tin chưa đọc → khung mở tại vạch; cuộn tới đáy ⇒ read seq 125 ──
  await run("A", async () => {
    await openChat("A-load");
    result.env.browserTimeZone = await page.evaluate(
      () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
    result.A.bootReads = await readsOf("A-load");
    result.A.roomItemBefore = await roomItemText("Kinh doanh");
    await shot("unread-A0-chat-list.png");
    await setState({ phase: "A-open" });
    const histBefore = await page.evaluate(() => history.length);
    resetCounter();
    await act("bấm phòng «Kinh doanh» (25 tin chưa đọc)", () =>
      page.locator('[data-testid="chat-room-item"]', { hasText: "Kinh doanh" }).first().click(),
    );
    await page.locator(`[data-message-id="${msgId(U, 101)}"]`).waitFor({ timeout: 10000 });
    await page.waitForTimeout(READ_WAIT_MS);
    result.A.kpi = summary();
    result.A.historyDelta = (await page.evaluate(() => history.length)) - histBefore;
    result.A.url = pathOf();
    result.A.firstPaint = await geometry(msgId(U, 101));
    result.A.expected = { firstAfterDividerId: msgId(U, 101), lastBeforeDividerId: msgId(U, 100) };
    result.A.readsAfterFirstPaint = await readsOf("A-open");
    result.A.openCalls = await callsOf("A-open");
    result.A.roomItemAfterOpen = await roomItemText("Kinh doanh");
    await shot("unread-A1-open-at-divider.png");
    // Đứng yên thêm 2 s ở vạch: không được tự báo đọc.
    await page.waitForTimeout(2000);
    result.A.readsAfterIdle2s = await readsOf("A-open");
    await setState({ phase: "A-scroll" });
    result.A.wheelSteps = await wheelTo("down");
    await page.waitForTimeout(READ_WAIT_MS);
    result.A.atBottom = await geometry();
    result.A.readsAfterScroll = await readsOf("A-scroll");
    result.A.roomItemAfterScroll = await roomItemText("Kinh doanh");
    result.A.scrollCalls = await callsOf("A-scroll");
    await shot("unread-A2-scrolled-bottom.png");
    // Badge phòng chỉ về 0 qua tiếng vọng `chat:read` của server (applyReadEvent) — API giả lập không có
    // socket, nên bơm đúng sự kiện đó (con trỏ = seq vừa POST) qua store rồi đọc lại badge.
    const echoed = result.A.readsAfterScroll.at(-1)?.seq ?? null;
    if (echoed !== null) {
      await page.evaluate(
        async ({ roomId, seq }) => {
          const mod = await import("/src/stores/chat.store.ts");
          const userId = mod.useChatStore.getState().myUserId;
          mod.useChatStore.getState().applyReadEvent({ roomId, userId, lastReadSeq: seq });
        },
        { roomId: U, seq: echoed },
      );
      await page.waitForTimeout(400);
    }
    result.A.roomItemAfterReadEcho = await roomItemText("Kinh doanh");
  });

  // ── B · phòng 0 tin chưa đọc ⇒ không vạch, khung ở đáy ─────────────────────────────────────────
  await run("B", async () => {
    await openChat("B-load");
    await setState({ phase: "B-open" });
    resetCounter();
    await act("bấm phòng «Hành chính» (0 tin chưa đọc)", () =>
      page.locator('[data-testid="chat-room-item"]', { hasText: "Hành chính" }).first().click(),
    );
    await page.locator(`[data-message-id="${msgId(Z, 40)}"]`).waitFor({ timeout: 10000 });
    await page.waitForTimeout(READ_WAIT_MS);
    result.B.kpi = summary();
    result.B.firstPaint = await geometry(msgId(Z, 40));
    result.B.reads = await readsOf("B-open");
    await shot("unread-B1-no-unread-at-bottom.png");
  });

  // ── C · đang đọc giữa chừng có tin mới (tin realtime bơm vào store) ⇒ khung không bị kéo, «↓ N tin mới» ──
  await run("C", async () => {
    await openChat("C-load");
    await setState({ phase: "C-open" });
    await page.locator('[data-testid="chat-room-item"]', { hasText: "Kỹ thuật" }).first().click();
    await page.locator(`[data-message-id="${msgId(M, 60)}"]`).waitFor({ timeout: 10000 });
    await page.waitForTimeout(READ_WAIT_MS);
    result.C.openReads = await readsOf("C-open");
    result.C.openGeometry = await geometry();
    await wheelTo("up", 3);
    await page.waitForTimeout(400);
    result.C.midReading = await geometry();
    await setState({ phase: "C-live" });
    result.C.inject61 = await injectLive(M, 61, liveMsg(M, 61));
    await page.waitForTimeout(600);
    result.C.after1 = await geometry(msgId(M, 61));
    result.C.inject62 = await injectLive(M, 62, liveMsg(M, 62));
    result.C.inject63 = await injectLive(M, 63, liveMsg(M, 63));
    await page.waitForTimeout(READ_WAIT_MS);
    result.C.after3 = await geometry(msgId(M, 63));
    result.C.readsWhileMid = await readsOf("C-live");
    await shot("unread-C1-new-messages-mid-read.png");
    await setState({ phase: "C-jump" });
    const jump = page.getByRole("button", { name: /tin mới/ });
    result.C.jumpCount = await jump.count();
    if (result.C.jumpCount > 0) {
      await jump.first().click();
      await page.waitForTimeout(READ_WAIT_MS);
    }
    result.C.afterJump = await geometry(msgId(M, 63));
    result.C.readsAfterJump = await readsOf("C-jump");
    await shot("unread-C2-after-jump.png");
  });

  // ── D · mở phòng 25 tin tại vạch, rồi có tin mới (seq 126) ⇒ khung không bị kéo khỏi vạch ──────────
  await run("D", async () => {
    await openChat("D-load");
    await setState({ phase: "D-open" });
    await page.locator('[data-testid="chat-room-item"]', { hasText: "Kinh doanh" }).first().click();
    await page.locator(`[data-message-id="${msgId(U, 101)}"]`).waitFor({ timeout: 10000 });
    await page.waitForTimeout(READ_WAIT_MS);
    result.D.atDivider = await geometry(msgId(U, 101));
    result.D.inject126 = await injectLive(U, 126, liveMsg(U, 126));
    await page.waitForTimeout(READ_WAIT_MS);
    result.D.after126 = await geometry(msgId(U, 101));
    result.D.reads = await readsOf("D-open");
    await shot("unread-D1-divider-plus-live.png");
  });

  const log = await getLog();
  result.unmocked = log.unmocked;
  return JSON.stringify(result, null, 1);
};
