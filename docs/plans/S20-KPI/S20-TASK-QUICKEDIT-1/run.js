async (page) => {
  // S20-TASK-QUICKEDIT-1 — đo KPI #7 trên trình duyệt thật với API giả lập (Playwright MCP browser_run_code, filename=).
  // Cần: (1) dev server từ gốc cây đang đo: VITE_API_URL=http://127.0.0.1:59999/api/v1 VITE_AUTH_APP_URL=http://127.0.0.1:59998 pnpm --filter @mediaos/app exec vite --port 5299 --strictPort
  //       (2) node mock-api.cjs fixtures.json  (cùng thư mục; fixture sinh + parse bằng contracts dist/cjs qua gen-fixtures.cjs)
  const ids = {
    T1: "aaaaaaaa-0000-4000-8000-000000000001", // «Soạn báo giá khách hàng A» — Đang làm
    T2: "aaaaaaaa-0000-4000-8000-000000000002", // «Chuẩn bị nội dung họp tuần» — Cần làm, chưa có hạn
  };
  const T1_TITLE = "Soạn báo giá khách hàng A";
  const APP = "http://localhost:5299";
  const CTL = "http://127.0.0.1:59999/__smoke";
  const SHOT = ".playwright-mcp/s20-kpi/task-quickedit-";
  // «Hôm nay» giả lập: Thứ Năm 22/10/2026 10:00 giờ VN (= 03:00 UTC).
  const NOW = "2026-10-22T03:00:00.000Z";
  const EXPECT_FRIDAY_UTC = "2026-10-23T10:00:00.000Z"; // 23/10 17:00 giờ VN
  const result = {
    env: {},
    A: {},
    U: {},
    B: {},
    C: {},
    E: {},
    layout: {},
    TZ: {},
    unmocked: [],
    errors: [],
  };

  const setState = async (patch) =>
    (await page.request.post(`${CTL}/state`, { data: patch })).json();
  const getLog = async () => (await page.request.get(`${CTL}/log`)).json();
  const logOf = async (phase, filter = () => true) =>
    (await getLog()).log.filter((r) => r.phase === phase && filter(r));
  const short = (r) =>
    `${r.method} ${r.path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ":id")}${r.query || ""}`;
  const byEndpoint = (rows) =>
    rows.reduce((m, r) => {
      const k = short(r);
      m[k] = (m[k] || 0) + 1;
      return m;
    }, {});

  // ── Bộ đếm ─────────────────────────────────────────────────────────────────────────────────
  // 1 thao tác = 1 click · 1 lần nhập một trường · 1 lần mở dropdown · 1 lần chọn mục · 1 lần bấm lưu
  // (docs/plans/S20-WORKUX-STORIES.md «Cách đếm thao tác»). Chuyển trang = pathname đổi HOẶC tài liệu tải lại.
  // Sandbox của browser_run_code không có `URL` ⇒ tự tách pathname.
  const pathOf = () => {
    const u = page.url().split("#")[0].split("?")[0];
    const rest = u.indexOf("://") < 0 ? u : u.slice(u.indexOf("://") + 3);
    const si = rest.indexOf("/");
    return si < 0 ? "/" : rest.slice(si);
  };
  const counter = { actions: 0, transitions: 0, reloads: 0, steps: [], lastPath: null };
  const plantMarker = () =>
    page.evaluate(() => {
      window.__kpiMarker = "kept";
    });
  const markerKept = () => page.evaluate(() => window.__kpiMarker === "kept");
  const resetCounter = async () => {
    counter.actions = 0;
    counter.transitions = 0;
    counter.reloads = 0;
    counter.steps = [];
    counter.lastPath = pathOf();
    await plantMarker();
  };
  async function act(label, fn) {
    counter.actions += 1;
    await fn();
    await page.waitForTimeout(150);
    const p = pathOf();
    const moved = p !== counter.lastPath;
    const reloaded = !(await markerKept());
    if (moved) counter.transitions += 1;
    if (reloaded) {
      counter.reloads += 1;
      await plantMarker();
    }
    counter.steps.push(
      `${counter.actions}. ${label}${moved ? `  => chuyển trang ${counter.lastPath} -> ${p}` : ""}${reloaded ? "  => TẢI LẠI tài liệu" : ""}`,
    );
    counter.lastPath = p;
  }
  const shot = (name, opts = {}) =>
    page
      .screenshot({ path: SHOT + name, ...opts })
      .catch((e) => result.errors.push(`shot ${name}: ${e.message}`));
  const settle = async () => {
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(300);
  };
  const openMyTasks = async (query = "") => {
    await page.goto(`${APP}/tasks/my-tasks${query}`);
    await page.getByText(T1_TITLE).first().waitFor({ timeout: 20000 });
    await settle();
  };
  const statusTrigger = (id) => page.getByTestId(`task-row-status-${id}`);
  // Toast của @mediaos/ui: thẻ [data-slot="toast"] trong vùng role=status (polite) hoặc role=alert (lỗi).
  const toastCards = () => page.locator('[data-slot="toast"]');
  const toasts = () =>
    toastCards().evaluateAll((els) =>
      els.map((el) => {
        const region = el.closest('[role="status"],[role="alert"]');
        const msg = el.querySelector('[data-slot="toast-message"]');
        return {
          variant: el.getAttribute("data-variant"),
          region: region ? region.getAttribute("role") : null,
          message: msg ? msg.textContent.trim() : "",
          buttons: Array.from(el.querySelectorAll("button")).map(
            (b) => b.getAttribute("aria-label") || b.textContent.trim(),
          ),
        };
      }),
    );
  // Lỗi hiện DƯỚI DÒNG (role=alert ngoài toaster).
  const inlineAlerts = () =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll('[role="alert"]'))
        .filter(
          (el) => !el.querySelector('[data-slot="toast"]') && !el.closest('[data-slot="toast"]'),
        )
        .map((el) => el.textContent.trim())
        .filter(Boolean),
    );
  const pickDone = () =>
    page.getByRole("listbox").getByRole("option", { name: "Hoàn thành" }).click();
  const isChangeStatusPost = (r) =>
    r.url().includes("/change-status") && r.request().method() === "POST";

  const deadlineTrigger = (id) => page.getByTestId(`task-row-deadline-${id}`);

  // ── Thiết lập phiên ────────────────────────────────────────────────────────────────────────
  // Cookie CSRF đặt bằng init script (page.context().addCookies làm rơi kết nối MCP ở máy đo).
  await page.addInitScript(() => {
    document.cookie = "mediaos_csrf=csrf-smoke; path=/";
  });
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.clock.setFixedTime(new Date(NOW));
  await setState({ resetLog: true, resetTasks: true, me: "meFull", actionDelayMs: 0 });

  const PARTS = ["A", "U", "B", "C", "E", "layout", "TZ"];
  async function run(name, fn) {
    if (!PARTS.includes(name)) return;
    try {
      await fn();
    } catch (e) {
      result.errors.push(`${name}: ${String(e.message).split("\n")[0]}`);
      await shot(`${name}-error.png`);
    }
  }

  // ── A · KPI #7: Đang làm → Hoàn thành bằng badge trên dòng, xuất phát /tasks/my-tasks ───────
  await run("A", async () => {
    await setState({ me: "meFull", resetTasks: true, phase: "A-load" });
    await openMyTasks();
    result.env.browserTimeZone = await page.evaluate(
      () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
    result.env.browserNow = await page.evaluate(() => new Date().toISOString());
    result.env.startUrl = page.url();
    result.A.statusTriggersOnPage = await page.locator('[data-testid^="task-row-status-"]').count();
    result.A.badgeTextBefore = (await statusTrigger(ids.T1).textContent())?.trim();
    await shot("A1-start.png");
    // Phản hồi route action trễ 800 ms ⇒ đo được trạng thái LẠC QUAN trước khi server trả lời.
    await setState({ phase: "A-flow", actionDelayMs: 800 });
    await resetCounter();
    await act("bấm badge trạng thái «Đang làm» trên dòng", () => statusTrigger(ids.T1).click());
    result.A.menuOptions = (
      await page.getByRole("listbox").getByRole("option").allTextContents()
    ).map((s) => s.trim());
    await shot("A2-menu-open.png");
    const posted = page.waitForResponse(
      (r) => r.url().includes("/change-status") && r.request().method() === "POST",
    );
    await act("chọn «Hoàn thành»", () =>
      page.getByRole("listbox").getByRole("option", { name: "Hoàn thành" }).click(),
    );
    result.A.optimistic = {
      rowStillVisible: await page.getByText(T1_TITLE, { exact: true }).count(),
      triggerCount: await statusTrigger(ids.T1).count(),
      triggerText:
        (await statusTrigger(ids.T1).count()) > 0
          ? (await statusTrigger(ids.T1).textContent())?.trim()
          : null,
    };
    await shot("A3-optimistic.png");
    const resp = await posted;
    result.A.responseStatus = resp.status();
    // Bản vá 3912833f: lưu xong ⇒ toast «Đã chuyển «…» sang …» kèm «Hoàn tác».
    await toastCards()
      .first()
      .waitFor({ timeout: 5000 })
      .catch(() => {});
    result.A.toastsAfterSave = await toasts();
    await shot("A3b-toast.png");
    await settle();
    result.A.totalActions = counter.actions;
    result.A.pathnameTransitions = counter.transitions;
    result.A.documentReloads = counter.reloads;
    result.A.steps = counter.steps;
    result.A.endUrl = page.url();
    result.A.afterSettle = {
      rowVisible: await page.getByText(T1_TITLE, { exact: true }).count(),
      alerts: (await page.getByRole("alert").allTextContents()).map((s) => s.trim()),
    };
    await shot("A4-after-save.png");
    // Bật «hiện việc đã xong» bằng URL để xác nhận việc nằm ở nhóm Đã xong với badge Hoàn thành.
    await setState({ phase: "A-check" });
    await page.goto(`${APP}/tasks/my-tasks?showDone=1`);
    await page.getByText(T1_TITLE).first().waitFor({ timeout: 10000 });
    await settle();
    result.A.withShowDone = {
      triggerText: (await statusTrigger(ids.T1).textContent())?.trim(),
    };
    await shot("A5-show-done.png");
    const flow = await logOf("A-flow");
    result.A.requests = flow.map(short);
    result.A.requestsByEndpoint = byEndpoint(flow);
    result.A.changeStatusCalls = flow
      .filter((r) => r.method === "POST" && /\/change-status$/.test(r.path))
      .map((r) => ({ method: r.method, path: r.path, body: r.body }));
    result.A.patchTaskCalls = flow.filter(
      (r) => r.method === "PATCH" && /^\/tasks\/[^/]+$/.test(r.path),
    ).length;
    await setState({ actionDelayMs: 0 });
  });

  // ── U · «Hoàn tác» trên toast sau khi dòng đã rời danh sách ───────────────────────────────────
  await run("U", async () => {
    await setState({
      me: "meFull",
      resetTasks: true,
      phase: "U-load",
      actionDelayMs: 0,
      failNext: null,
    });
    await openMyTasks();
    await setState({ phase: "U-flow" });
    await resetCounter();
    await act("bấm badge «Đang làm» trên dòng", () => statusTrigger(ids.T1).click());
    const first = page.waitForResponse(isChangeStatusPost);
    await act("chọn «Hoàn thành»", pickDone);
    await first;
    const undoBtn = toastCards().getByRole("button", { name: "Hoàn tác" });
    await undoBtn.first().waitFor({ timeout: 5000 });
    result.U.rowCountBeforeUndo = await page.getByText(T1_TITLE, { exact: true }).count();
    result.U.toastsBeforeUndo = await toasts();
    await shot("U1-toast-undo.png");
    const second = page.waitForResponse(isChangeStatusPost);
    await act("bấm «Hoàn tác» trên toast", () => undoBtn.first().click());
    result.U.undoResponseStatus = (await second).status();
    await settle();
    result.U.totalActions = counter.actions;
    result.U.pathnameTransitions = counter.transitions;
    result.U.documentReloads = counter.reloads;
    result.U.steps = counter.steps;
    result.U.rowCountAfterUndo = await page.getByText(T1_TITLE, { exact: true }).count();
    result.U.badgeAfterUndo =
      (await statusTrigger(ids.T1).count()) > 0
        ? (await statusTrigger(ids.T1).textContent())?.trim()
        : null;
    result.U.toastsAfterUndo = await toasts();
    await shot("U2-after-undo.png");
    const flow = await logOf("U-flow");
    result.U.requestsByEndpoint = byEndpoint(flow);
    result.U.changeStatusCalls = flow
      .filter((r) => r.method === "POST" && /\/change-status$/.test(r.path))
      .map((r) => ({ method: r.method, path: r.path, body: r.body }));
    result.U.patchTaskCalls = flow.filter(
      (r) => r.method === "PATCH" && /^\/tasks\/[^/]+$/.test(r.path),
    ).length;
  });

  // ── E · server từ chối SAU khi dòng đã rời danh sách (checklist / mất mạng) ⇒ toast lỗi ──────────
  await run("E", async () => {
    for (const mode of ["checklist", "network"]) {
      await setState({
        me: "meFull",
        resetTasks: true,
        phase: `E-${mode}-load`,
        actionDelayMs: 800,
        failNext: null,
      });
      await openMyTasks();
      await setState({ phase: `E-${mode}`, failNext: mode });
      await statusTrigger(ids.T1).click();
      await pickDone();
      await page.waitForTimeout(200);
      const r = { rowCountOptimistic: await page.getByText(T1_TITLE, { exact: true }).count() };
      const errToast = page.locator('[data-slot="toast"][data-variant="error"]');
      await errToast
        .first()
        .waitFor({ timeout: 8000 })
        .catch(() => {});
      await page.waitForTimeout(400);
      r.toasts = await toasts();
      r.inlineAlerts = await inlineAlerts();
      r.rowCountAfterError = await page.getByText(T1_TITLE, { exact: true }).count();
      r.badgeAfterError =
        (await statusTrigger(ids.T1).count()) > 0
          ? (await statusTrigger(ids.T1).textContent())?.trim()
          : null;
      await shot(`E-${mode}.png`);
      if (mode === "network") {
        const retry = errToast.getByRole("button", { name: "Thử lại" });
        r.retryButton = await retry.count();
        if (r.retryButton > 0) {
          await setState({ actionDelayMs: 0, failNext: null });
          const p = page.waitForResponse(isChangeStatusPost);
          await retry.first().click();
          r.retryResponseStatus = (await p).status();
          await settle();
          r.afterRetry = {
            toasts: await toasts(),
            rowCount: await page.getByText(T1_TITLE, { exact: true }).count(),
          };
          await shot("E-network-retry.png");
        }
      }
      r.changeStatusCalls = (await logOf(`E-${mode}`, (x) => /\/change-status$/.test(x.path))).map(
        (x) => ({ method: x.method, path: x.path, body: x.body, injected: x.injected || null }),
      );
      result.E[mode] = r;
    }
    await setState({ actionDelayMs: 0, failNext: null });
  });

  // ── B · chip «Thứ Sáu này» khi hôm nay = Thứ Năm 22/10/2026 giờ VN ────────────────────────────
  await run("B", async () => {
    await setState({ me: "meFull", resetTasks: true, phase: "B-load" });
    await openMyTasks();
    result.B.triggerTextBefore = (await deadlineTrigger(ids.T2).textContent())?.trim();
    await setState({ phase: "B-flow" });
    await resetCounter();
    await act("bấm chip hạn «Đặt hạn» trên dòng", () => deadlineTrigger(ids.T2).click());
    const group = page.getByRole("group", { name: "Mốc hạn nhanh" });
    await group.waitFor({ timeout: 5000 });
    result.B.presetLabels = (await group.getByRole("button").allTextContents()).map((s) =>
      s.replace(/\s+/g, " ").trim(),
    );
    await shot("B1-presets.png");
    const posted = page.waitForResponse(
      (r) => r.url().includes("/change-deadline") && r.request().method() === "POST",
    );
    await act("chọn «Thứ Sáu này 17:00»", () =>
      page.getByTestId(`task-row-deadline-${ids.T2}-preset-friday`).click(),
    );
    result.B.responseStatus = (await posted).status();
    await settle();
    result.B.totalActions = counter.actions;
    result.B.pathnameTransitions = counter.transitions;
    result.B.documentReloads = counter.reloads;
    result.B.steps = counter.steps;
    result.B.triggerTextAfter = (await deadlineTrigger(ids.T2).textContent())?.trim();
    await shot("B2-after-save.png");
    const flow = await logOf("B-flow");
    result.B.requestsByEndpoint = byEndpoint(flow);
    result.B.changeDeadlineCalls = flow
      .filter((r) => r.method === "POST" && /\/change-deadline$/.test(r.path))
      .map((r) => ({ method: r.method, path: r.path, body: r.body }));
    result.B.expectedDueAtUtc = EXPECT_FRIDAY_UTC;
    result.B.dueAtMatches =
      result.B.changeDeadlineCalls.length === 1 &&
      result.B.changeDeadlineCalls[0].body?.dueAt === EXPECT_FRIDAY_UTC;
    result.B.patchTaskCalls = flow.filter(
      (r) => r.method === "PATCH" && /^\/tasks\/[^/]+$/.test(r.path),
    ).length;
  });

  // ── C · thiếu update-status:task ⇒ badge tĩnh, bấm vào không có menu ────────────────────────────
  await run("C", async () => {
    await setState({ me: "meNoStatus", resetTasks: true, phase: "C" });
    await openMyTasks();
    result.C.statusTriggers = await page.locator('[data-testid^="task-row-status-"]').count();
    result.C.statusButtonsByLabel = await page
      .getByRole("button", { name: /^Đổi trạng thái/ })
      .count();
    result.C.deadlineTriggersStillShown = await page
      .locator('[data-testid^="task-row-deadline-"]')
      .count();
    const staticBadge = page.getByText("Đang làm", { exact: true }).first();
    result.C.staticBadgeVisible = await staticBadge.isVisible();
    await staticBadge.click();
    await page.waitForTimeout(300);
    result.C.listboxAfterClick = await page.getByRole("listbox").count();
    result.C.menusAfterClick = await page.getByRole("option").count();
    result.C.changeStatusCalls = (await logOf("C", (r) => /\/change-status$/.test(r.path))).length;
    result.C.url = page.url();
    await shot("C1-no-status-pair.png");
    await setState({ me: "meFull" });
  });

  // ── Bố cục · dòng ở bề rộng điện thoại (390 px) — tràn ngang? ──────────────────────────────────
  await run("layout", async () => {
    await setState({ me: "meFull", resetTasks: true, phase: "layout" });
    await page.setViewportSize({ width: 390, height: 844 });
    await openMyTasks();
    result.layout.mobile = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    result.layout.mobileStatusTriggerBox = await page
      .getByTestId(`task-row-status-${ids.T1}`)
      .boundingBox();
    result.layout.mobileDeadlineTriggerBox = await page
      .getByTestId(`task-row-deadline-${ids.T2}`)
      .boundingBox();
    await shot("L1-mobile.png", { fullPage: true });
    await page.getByTestId(`task-row-deadline-${ids.T2}`).click();
    await page.waitForTimeout(300);
    result.layout.mobilePopoverBox = await page
      .getByRole("group", { name: "Mốc hạn nhanh" })
      .boundingBox();
    await shot("L2-mobile-popover.png");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    // Toast «Đã chuyển … sang Hoàn thành» ở 390 px: nằm trọn khung, không tràn ngang.
    await statusTrigger(ids.T1).click();
    await pickDone();
    await toastCards().first().waitFor({ timeout: 5000 });
    await page.waitForTimeout(300);
    result.layout.mobileToastBox = await toastCards().first().boundingBox();
    result.layout.mobileAfterToast = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    await shot("L3-mobile-toast.png");
    await page.setViewportSize({ width: 1366, height: 900 });
  });

  // ── TZ · máy ở múi KHÁC giờ công ty: context mới America/New_York (03:00Z 22/10 = 23:00 Thứ Tư 21/10 ở NY) ──
  // Máy đo chạy Asia/Bangkok (cùng UTC+7 với giờ công ty) nên A/B không phân biệt được giờ máy với giờ công ty.
  // Mốc theo giờ công ty ⇒ vẫn 2026-10-23T10:00Z; nếu lỡ dùng giờ máy ⇒ Thứ Sáu 23/10 17:00 NY = 21:00Z.
  // Chạy cuối: tạo context mới có thể làm rơi kết nối MCP — kết quả các phần trên đã nằm trong lượt riêng.
  await run("TZ", async () => {
    const browser = page.context().browser();
    if (!browser) {
      result.TZ = { skipped: "context bền (persistent) — không tạo được context mới" };
      return;
    }
    const ctx = await browser.newContext({
      timezoneId: "America/New_York",
      viewport: { width: 1366, height: 900 },
    });
    try {
      const p2 = await ctx.newPage();
      await p2.addInitScript(() => {
        document.cookie = "mediaos_csrf=csrf-smoke; path=/";
      });
      await p2.clock.setFixedTime(new Date(NOW));
      await setState({ me: "meFull", resetTasks: true, phase: "TZ" });
      await p2.goto(`${APP}/tasks/my-tasks`);
      await p2.getByText(T1_TITLE).first().waitFor({ timeout: 20000 });
      await p2.waitForTimeout(500);
      result.TZ = {
        machine: await p2.evaluate(() => ({
          tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
          local: new Date().toString(),
        })),
      };
      await p2.getByTestId(`task-row-deadline-${ids.T2}`).click();
      const group = p2.getByRole("group", { name: "Mốc hạn nhanh" });
      await group.waitFor({ timeout: 5000 });
      result.TZ.presetLabels = (await group.getByRole("button").allTextContents()).map((s) =>
        s.replace(/\s+/g, " ").trim(),
      );
      const posted = p2.waitForResponse(
        (r) => r.url().includes("/change-deadline") && r.request().method() === "POST",
      );
      await p2.getByTestId(`task-row-deadline-${ids.T2}-preset-friday`).click();
      await posted;
      await p2.waitForTimeout(300);
      await p2
        .screenshot({ path: SHOT + "TZ1-newyork.png" })
        .catch((e) => result.errors.push(`shot TZ1: ${e.message}`));
      const calls = await logOf("TZ", (r) => /\/change-deadline$/.test(r.path));
      result.TZ.changeDeadlineBodies = calls.map((r) => r.body);
      result.TZ.expectedDueAtUtc = EXPECT_FRIDAY_UTC;
      result.TZ.machineLocalWouldGive = "2026-10-23T21:00:00.000Z";
      result.TZ.dueAtMatches = calls.length === 1 && calls[0].body?.dueAt === EXPECT_FRIDAY_UTC;
    } finally {
      await ctx.close();
    }
  });

  result.unmocked = (await getLog()).unmocked;
  return result;
};
