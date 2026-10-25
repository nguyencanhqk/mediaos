async (page) => {
  // S20-CHAT-UNREADNAV-1 — đo KPI #4 trên trình duyệt THẬT với API giả lập (Playwright MCP browser_run_code, filename=).
  // Cần: (1) dev server, cwd = gốc cây đang đo:
  //         VITE_API_URL=http://127.0.0.1:59999/api/v1 VITE_AUTH_APP_URL=http://127.0.0.1:59998 pnpm --filter @mediaos/app exec vite --port 5299 --strictPort
  //       (2) node mock-api.cjs fixtures.json   (cùng thư mục; fixture sinh + parse bằng contracts dist/cjs qua gen-fixtures.cjs)
  // API giả lập là tiến trình node trên 127.0.0.1:59999 (page.route/route.fulfill làm rơi kết nối MCP ở máy đo).
  const APP = "http://localhost:5299";
  const CTL = "http://127.0.0.1:59999/__smoke";
  const SHOT = ".playwright-mcp/s20-kpi/";
  const ID = {
    KD: "99999999-9999-4999-8999-999999999921",
    KT: "99999999-9999-4999-8999-999999999922",
    KY: "99999999-9999-4999-8999-999999999923",
    HC: "99999999-9999-4999-8999-999999999924",
    DA: "99999999-9999-4999-8999-999999999925",
    NS: "99999999-9999-4999-8999-999999999926",
    DB: "99999999-9999-4999-8999-999999999927",
    MK: "99999999-9999-4999-8999-999999999928",
  };
  const NAMES = {
    KD: "Kinh doanh",
    KT: "Kế toán",
    KY: "Kỹ thuật",
    HC: "Hành chính",
    DA: "Dự án A",
    NS: "Nhân sự",
    DB: "Dự án B",
    MK: "Marketing",
  };
  const NAME_OF = Object.fromEntries(Object.entries(NAMES).map(([k, n]) => [ID[k], n]));
  // lastMessageSeq của từng phòng (= số tin) — POST read phải mang đúng số này.
  const LAST_SEQ = { KD: 6, KT: 4, KY: 5, HC: 6, DA: 3, NS: 4, DB: 5, MK: 6 };
  const READ_WAIT_MS = 2500; // trễ giả lập 400 ms × 2 đợt (6 phòng / trần 4) + khe
  const result = { env: {}, A: {}, A2: {}, B: {}, C: {}, unmocked: [], pageErrors: [], errors: [] };

  const setState = async (patch) =>
    (await page.request.post(`${CTL}/state`, { data: patch })).json();
  const getLog = async () => (await page.request.get(`${CTL}/log`)).json();
  const readsOf = async (phase) =>
    (await getLog()).log
      .filter((r) => r.phase === phase && r.method === "POST" && /\/read$/.test(r.path))
      .map((r) => {
        const id = r.path.split("/")[3];
        return { room: NAME_OF[id] ?? id, seq: r.body?.seq ?? null, status: r.status };
      });
  const roomOfPath = (p) => NAME_OF[p.split("/")[2]] ?? null;

  // ── Bộ đếm (như S20-CHAT-DEEPLINK-1 / S20-CHAT-UNREAD-1) ─────────────────────────────────────
  // «Cách đếm thao tác» (S20-WORKUX-STORIES §4): 1 click · 1 phím tắt · 1 lần nhập · 1 lần gửi.
  // Chuyển trang đếm riêng = pathname đổi; kèm số lần TẢI LẠI tài liệu và `history.length`.
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
  const histLen = () => page.evaluate(() => history.length);
  const counter = {
    actions: 0,
    transitions: 0,
    steps: [],
    lastPath: null,
    docLoadsAtStart: 0,
    hist: 0,
  };
  const resetCounter = async () => {
    Object.assign(counter, { actions: 0, transitions: 0, steps: [], lastPath: pathOf() });
    counter.docLoadsAtStart = docLoads;
    counter.hist = await histLen();
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
  const summary = async () => ({
    actions: counter.actions,
    pathnameChanges: counter.transitions,
    documentReloads: docLoads - counter.docLoadsAtStart,
    historyLengthDelta: (await histLen()) - counter.hist,
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

  // Ảnh danh sách phòng đang hiển thị: tên · badge (aria «N tin chưa đọc») · nút «Đọc hết» · badge header.
  const listState = () =>
    page.evaluate(() => {
      const rows = [...document.querySelectorAll('[data-testid="chat-room-item"]')];
      const chip = document.querySelector('[data-testid="chat-room-chip"][aria-pressed="true"]');
      const readAll = document.querySelector('[data-testid="chat-read-all"]');
      const header = document.querySelector(
        '[data-testid="chat-badge-static"], [data-testid="chat-badge"]',
      );
      const list = document.querySelector('[data-testid="chat-room-list"]');
      return {
        chip: chip?.getAttribute("data-chip") ?? null,
        rooms: rows.map((row) => {
          const name = row.querySelector('[data-testid="chat-room-name"]')?.textContent?.trim();
          const badge = row.querySelector('[aria-label$="tin chưa đọc"]');
          return `${name}${badge ? ` [${badge.textContent.trim()}]` : ""}`;
        }),
        readAll: readAll
          ? {
              text: readAll.textContent.trim(),
              aria: readAll.getAttribute("aria-label"),
              disabled: readAll.disabled,
            }
          : null,
        headerBadge: header?.getAttribute("aria-label") ?? null,
        emptyText:
          rows.length === 0 ? (list?.innerText ?? "").replace(/\s+/g, " ").slice(-80) : null,
      };
    });
  const toasts = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('[data-slot="toast-message"]')].map((p) => {
        const item = p.parentElement;
        const buttons = [...item.querySelectorAll("button")].map(
          (b) => b.textContent.trim() || b.getAttribute("aria-label"),
        );
        const live = item.closest("[aria-live]")?.getAttribute("aria-live") ?? null;
        return { text: p.textContent.trim(), buttons, live };
      }),
    );
  const storeRooms = () =>
    page.evaluate(async (names) => {
      const mod = await import("/src/stores/chat.store.ts");
      const s = mod.useChatStore.getState();
      return Object.fromEntries(
        Object.values(s.roomsById).map((r) => [names[r.id] ?? r.id, r.unreadCount]),
      );
    }, NAME_OF);

  async function openChat(phase, scenario, failRooms = []) {
    await setState({
      resetLog: true,
      resetData: true,
      scenario,
      failRooms,
      readDelayMs: 400,
      phase,
    });
    await page.goto(`${APP}/chat`);
    await page
      .locator('[data-testid="chat-room-item"]', { hasText: "Marketing" })
      .first()
      .waitFor({ timeout: 20000 });
    await settle();
  }
  const chip = (key) => page.locator(`[data-testid="chat-room-chip"][data-chip="${key}"]`);
  const search = () => page.locator('[data-testid="chat-room-list"] input').first();
  await page.addInitScript(() => {
    document.cookie = "mediaos_csrf=csrf-smoke; path=/";
  });
  await page.setViewportSize({ width: 1366, height: 900 });

  const PARTS = ["A", "A2", "B", "C"];
  async function run(name, fn) {
    if (!PARTS.includes(name)) return;
    try {
      await fn();
    } catch (e) {
      result.errors.push(`${name}: ${String(e.message).split("\n")[0]}`);
      await shot(`unreadnav-${name}-error.png`);
    }
  }
  const checkSeqs = (reads, keys) =>
    keys.map((k) => {
      const hit = reads.filter((r) => r.room === NAMES[k]);
      return {
        room: NAMES[k],
        expectedSeq: LAST_SEQ[k],
        sent: hit.map((r) => r.seq),
        ok: hit.length === 1 && hit[0].seq === LAST_SEQ[k],
      };
    });

  // ── A · KPI #4: /chat, 6 phòng chưa đọc → chip «Chưa đọc» → «Đọc hết» ⇒ ≤ 2 thao tác, 0 chuyển trang ──
  await run("A", async () => {
    await openChat("A-load", "six");
    result.env.platform = await page.evaluate(
      () => navigator.userAgentData?.platform || navigator.platform,
    );
    result.A.start = { path: pathOf(), ...(await listState()) };
    await setState({ phase: "A" });
    await resetCounter();
    await act("bấm chip «Chưa đọc»", () => chip("unread").click());
    result.A.afterChip = await listState();
    await shot("unreadnav-A1-chip-unread.png");
    await act("bấm «Đọc hết»", () => page.locator('[data-testid="chat-read-all"]').click());
    // Lạc quan: đọc ngay khi các lời gọi còn đang bay (trễ giả lập 400 ms, 200 ms đã trôi trong act()).
    result.A.optimistic = { ...(await listState()), inFlightAtMock: (await getLog()).inFlight };
    await page.waitForTimeout(READ_WAIT_MS);
    result.A.after = await listState();
    result.A.toasts = await toasts();
    result.A.store = await storeRooms();
    result.A.counter = await summary();
    const reads = await readsOf("A");
    const log = await getLog();
    result.A.reads = {
      count: reads.length,
      maxInFlight: log.maxInFlight,
      list: reads.map((r) => `${r.room} seq=${r.seq} → ${r.status}`),
    };
    result.A.seqCheck = checkSeqs(reads, ["KD", "KY", "HC", "DA", "DB", "MK"]);
    result.A.readRoomsTouched = reads.filter(
      (r) => r.room === NAMES.KT || r.room === NAMES.NS,
    ).length;
    result.A.serverStillUnread = log.rooms
      .filter((r) => r.unreadCount > 0)
      .map((r) => NAME_OF[r.id]);
    await chip("all").click();
    await page.waitForTimeout(300);
    result.A.allChipAfter = await listState();
    await shot("unreadnav-A2-after-read-all.png");
  });

  // ── A2 · đang tìm «Dự án» trong chip «Chưa đọc» ⇒ «Đọc hết» chỉ áp cho phòng đang hiển thị ─────────
  await run("A2", async () => {
    await openChat("A2-load", "six");
    await chip("unread").click();
    await search().fill("Dự án");
    await page.waitForTimeout(300);
    result.A2.filtered = await listState();
    await setState({ phase: "A2" });
    await page.locator('[data-testid="chat-read-all"]').click();
    await page.waitForTimeout(READ_WAIT_MS);
    result.A2.reads = (await readsOf("A2")).map((r) => `${r.room} seq=${r.seq}`);
    await search().fill("");
    await page.waitForTimeout(300);
    result.A2.afterClear = await listState();
    await shot("unreadnav-A3-filtered-read-all.png");
  });

  // ── B · deny-path: «Hành chính» trả 500 ⇒ giữ badge + «Không đánh dấu được 1 phòng» có «Thử lại» ──
  await run("B", async () => {
    await openChat("B-load", "six", [ID.HC]);
    await chip("unread").click();
    await setState({ phase: "B" });
    await page.locator('[data-testid="chat-read-all"]').click();
    await page.waitForTimeout(READ_WAIT_MS);
    result.B.reads = (await readsOf("B")).map((r) => `${r.room} seq=${r.seq} → ${r.status}`);
    result.B.after = await listState();
    result.B.toasts = await toasts();
    result.B.store = await storeRooms();
    await shot("unreadnav-B1-one-failed.png");
    // Server hết lỗi ⇒ bấm «Thử lại» trên thông báo.
    await setState({ failRooms: [], phase: "B-retry" });
    await page
      .locator('[data-slot="toast-message"]', { hasText: "Không đánh dấu được" })
      .locator("xpath=..")
      .getByRole("button", { name: "Thử lại" })
      .click();
    await page.waitForTimeout(READ_WAIT_MS);
    result.B.retryReads = (await readsOf("B-retry")).map(
      (r) => `${r.room} seq=${r.seq} → ${r.status}`,
    );
    result.B.afterRetry = await listState();
    result.B.toastsAfterRetry = await toasts();
    await shot("unreadnav-B2-after-retry.png");
  });

  // ── C · Alt+Shift+↓ ×3 với 3 phòng chưa đọc (Kỹ thuật · Dự án A · Marketing) ⇒ đúng thứ tự, lần 4 «Đã đọc hết» ──
  const composer = '[data-testid="chat-composer"] textarea';
  const roomSnapshot = () =>
    page.evaluate(() => {
      const active = document.activeElement;
      const header = document.querySelector('[data-testid="chat-conversation-header"]');
      return {
        header: header?.innerText?.split("\n")[0] ?? null,
        live: document.querySelector('[data-testid="room-shortcut-live"]')?.textContent ?? null,
        focusInComposer: !!active?.closest('[data-testid="chat-composer"]'),
        focusTag: active?.tagName ?? null,
      };
    });
  const composerValue = () =>
    page
      .locator(composer)
      .first()
      .inputValue()
      .catch(() => null);
  await run("C", async () => {
    await openChat("C-load", "three");
    result.C.start = { path: pathOf(), ...(await listState()) };
    await setState({ phase: "C" });
    await page.mouse.click(900, 450);
    await resetCounter();
    result.C.presses = [];
    for (let i = 1; i <= 4; i += 1) {
      await act(`Alt+Shift+↓ lần ${i}`, () => page.keyboard.press("Alt+Shift+ArrowDown"));
      await page.waitForTimeout(1500);
      result.C.presses.push({
        n: i,
        path: pathOf(),
        room: roomOfPath(pathOf()),
        ...(await roomSnapshot()),
        toasts: (await toasts()).map((t) => t.text),
      });
      await shot(`unreadnav-C${i}-press.png`);
    }
    result.C.counter = await summary();
    result.C.reads = (await readsOf("C")).map((r) => `${r.room} seq=${r.seq}`);
    result.C.listAfter = await listState();

    // C2 · ô soạn có chữ, con trỏ ở giữa ⇒ Alt+Shift+↓ (không còn đích) không chèn ký tự, không di con trỏ.
    const box = page.locator(composer).first();
    await box.click();
    await box.fill("nháp dở");
    await box.evaluate((el) => el.setSelectionRange(3, 3));
    const sel = (el) => ({ value: el.value, start: el.selectionStart, end: el.selectionEnd });
    const before = await box.evaluate(sel);
    const pathBefore = pathOf();
    await page.keyboard.press("Alt+Shift+ArrowDown");
    await page.waitForTimeout(500);
    const after = await box.evaluate(sel);
    result.C.composerNoTarget = {
      before,
      after,
      pathUnchanged: pathOf() === pathBefore,
      toasts: (await toasts()).map((t) => t.text),
    };

    // C3 · ô soạn có chữ ⇒ Alt+↑ sang phòng trên rồi Alt+↓ về: nháp phòng cũ giữ, phòng mới không bị chèn chữ.
    await page.keyboard.press("Alt+ArrowUp");
    await page.waitForTimeout(1200);
    const up = {
      room: roomOfPath(pathOf()),
      composer: await composerValue(),
      ...(await roomSnapshot()),
    };
    await page.keyboard.press("Alt+ArrowDown");
    await page.waitForTimeout(1200);
    const down = {
      room: roomOfPath(pathOf()),
      composer: await composerValue(),
      ...(await roomSnapshot()),
    };
    result.C.draftRoundTrip = { from: roomOfPath(pathBefore), up, down };
    result.C.historyLengthDeltaTotal = (await histLen()) - counter.hist;
    result.C.documentReloadsTotal = docLoads - counter.docLoadsAtStart;
    await shot("unreadnav-C5-draft-kept.png");
  });

  const log = await getLog();
  result.unmocked = log.unmocked;
  return JSON.stringify(result, null, 1);
};
