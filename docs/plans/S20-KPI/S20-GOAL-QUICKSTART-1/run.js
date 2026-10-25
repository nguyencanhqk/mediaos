async (page) => {
  // S20-GOAL-QUICKSTART-1 — đo KPI #15 trên trình duyệt thật với API giả lập (Playwright MCP browser_run_code, filename=).
  // Cần: (1) node mock-api.cjs fixtures.json (nghe 127.0.0.1:59999)
  //      (2) dev server từ gốc cây đang đo: VITE_API_URL=http://127.0.0.1:59999/api/v1 VITE_AUTH_APP_URL=http://127.0.0.1:59998 pnpm --filter @mediaos/app exec vite --port 5299 --strictPort
  const ids = {
    ME_EMP: "33333333-3333-4333-8333-333333333333",
    DRAFT: "88888888-8888-4888-8888-888888888888",
  };
  const DRAFT_NAME = "Giảm 20% thời gian xử lý phiếu";
  const APP = "http://localhost:5299";
  const CTL = "http://127.0.0.1:59999/__smoke";
  const SHOT = ".playwright-mcp/s20-kpi/QS-";
  const result = {
    env: {},
    A: {},
    A2: {},
    B: {},
    C: {},
    C403: {},
    TZ: {},
    unmocked: [],
    errors: [],
  };

  const setState = async (patch) =>
    (await page.request.post(`${CTL}/state`, { data: patch })).json();
  const getLog = async () => (await page.request.get(`${CTL}/log`)).json();
  const logOf = async (phase, filter = () => true) =>
    (await getLog()).log.filter((r) => r.phase === phase && filter(r));
  const shortPath = (p) => p.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ":id");

  // ── Bộ đếm ─────────────────────────────────────────────────────────────────────────────────
  // 1 thao tác = 1 click · 1 lần nhập một trường · 1 lần mở dropdown · 1 lần chọn mục · 1 lần bấm lưu
  // (docs/plans/S20-WORKUX-STORIES.md «Cách đếm thao tác»). Chuyển trang = pathname đổi (đổi search ≠ chuyển trang).
  const counter = { actions: 0, transitions: 0, steps: [], lastPath: null };
  // Sandbox của browser_run_code không có `URL`/`URLSearchParams` ⇒ tự tách pathname/search.
  const parseUrl = (u) => {
    const noHash = u.split("#")[0];
    const qi = noHash.indexOf("?");
    const base = qi < 0 ? noHash : noHash.slice(0, qi);
    const rest = base.indexOf("://") < 0 ? base : base.slice(base.indexOf("://") + 3);
    const si = rest.indexOf("/");
    return { pathname: si < 0 ? "/" : rest.slice(si), search: qi < 0 ? "" : noHash.slice(qi) };
  };
  const pathOf = () => parseUrl(page.url()).pathname;
  const resetCounter = () => {
    counter.actions = 0;
    counter.transitions = 0;
    counter.steps = [];
    counter.lastPath = pathOf();
  };
  async function act(label, fn) {
    counter.actions += 1;
    await fn();
    await page.waitForTimeout(150);
    const p = pathOf();
    const moved = p !== counter.lastPath;
    if (moved) counter.transitions += 1;
    counter.steps.push(
      `${counter.actions}. ${label}${moved ? `  => chuyển trang ${shortPath(counter.lastPath)} -> ${shortPath(p)}` : ""}`,
    );
    counter.lastPath = p;
  }
  const shot = (name) =>
    page
      .screenshot({ path: SHOT + name })
      .catch((e) => result.errors.push(`shot ${name}: ${e.message}`));
  const settle = async () => {
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(300);
  };
  const readForm = () =>
    page.evaluate(() => {
      const v = (n) => document.querySelector(`[name="${n}"]`)?.value ?? null;
      return {
        levelFieldShown: Boolean(document.querySelector('[name="level"]')),
        employeeAnchorShown: Boolean(
          document.querySelector('[data-testid="goal-employee-anchor"]'),
        ),
        selfAnchoredNote: document.body.textContent.includes(
          "Mục tiêu cá nhân của bạn (cấp Nhân viên).",
        ),
        periodType: v("periodType"),
        periodStart: v("periodStart"),
        periodEnd: v("periodEnd"),
        status: v("status"),
        measureType: v("measureType"),
      };
    });
  const pickBody = (b) => ({
    name: b.name,
    level: b.level,
    employeeId: b.employeeId,
    departmentId: b.departmentId,
    projectId: b.projectId,
    periodType: b.periodType,
    periodStart: b.periodStart,
    periodEnd: b.periodEnd,
    status: b.status,
    measureType: b.measureType,
    targetValue: b.targetValue,
  });
  const checkinBtn = () => page.locator('[data-testid="goal-checkin-open"]');
  const exactCount = (text) => page.getByText(text, { exact: true }).count();
  const createEntryCount = async () =>
    (await page.getByRole("button", { name: /Tạo mục tiêu/ }).count()) +
    (await page.getByRole("link", { name: /Tạo mục tiêu/ }).count()) +
    (await page.locator('a[href^="/goals/new"]').count());
  const detailState = async () => ({
    url: shortPath(pathOf()),
    badgeDraft: await exactCount("Nháp"),
    badgeActive: await exactCount("Đang chạy"),
    activateButtons: await page.getByRole("button", { name: "Kích hoạt", exact: true }).count(),
    checkinDisabled: (await checkinBtn().count())
      ? await checkinBtn().isDisabled()
      : "không có nút",
    lockHint: await page.getByText(/Mục tiêu đang ở Nháp/).count(),
  });
  const firstText = async (re, timeout = 5000) => {
    const loc = page.getByText(re).first();
    return loc
      .waitFor({ timeout })
      .then(async () => (await loc.textContent())?.trim())
      .catch(() => null);
  };

  // ── Thiết lập phiên ────────────────────────────────────────────────────────────────────────
  // Cookie CSRF đặt bằng init script (page.context().addCookies làm rơi kết nối MCP ở máy đo).
  await page.addInitScript(() => {
    document.cookie = "mediaos_csrf=csrf-smoke; path=/";
  });
  await page.setViewportSize({ width: 1366, height: 900 });
  await setState({
    resetLog: true,
    resetGoals: true,
    me: "meOwn",
    listEmpty: false,
    meGoalsEmpty: false,
    denyPatch: false,
    patchDelayMs: 0,
  });

  // Chạy từng phần một lượt: bản lưu chạy đủ; bản chạy thay dòng PARTS.
  const PARTS = ["A", "A2", "B", "C", "C403", "TZ"];
  async function run(name, fn) {
    if (!PARTS.includes(name)) return;
    try {
      await fn();
    } catch (e) {
      result.errors.push(`${name}: ${String(e.message).split("\n")[0]}`);
      await shot(`${name}-error.png`);
    }
  }

  async function startOnGoals(phase) {
    await setState({ me: "meOwn", phase: `${phase}-load` });
    await page.goto(`${APP}/goals`);
    await page.waitForURL(/period=/, { timeout: 20000 });
    await page
      .getByRole("button", { name: /Tạo mục tiêu/ })
      .first()
      .waitFor({ timeout: 20000 });
    await settle();
    await setState({ phase: `${phase}-flow` });
    resetCounter();
  }
  async function openFormAndName(phase, name) {
    result[phase].createButtonsOnList = await page
      .getByRole("button", { name: /Tạo mục tiêu/ })
      .count();
    await act("bấm «Tạo mục tiêu» trên /goals", () =>
      page
        .getByRole("button", { name: /Tạo mục tiêu/ })
        .first()
        .click(),
    );
    await page.waitForURL(/\/goals\/new/);
    await page.locator('input[name="name"]').waitFor();
    await settle();
    result[phase].formAtOpen = await readForm();
    await act("nhập tên", () => page.locator('input[name="name"]').fill(name));
  }
  async function saveAndLand(phase) {
    const posted = page.waitForResponse(
      (r) => r.url().endsWith("/api/v1/goals") && r.request().method() === "POST",
    );
    await act("bấm «Tạo mục tiêu» (lưu)", async () => {
      await page.getByRole("button", { name: "Tạo mục tiêu", exact: true }).click();
      result[phase].postStatus = (await posted).status();
      await page
        .waitForURL(/\/goals\/[0-9a-f]{8}-[0-9a-f-]{27}$/, { timeout: 10000 })
        .catch(() => {});
    });
    await checkinBtn()
      .waitFor({ timeout: 10000 })
      .catch(() => {});
    await settle();
    result[phase].totalActions = counter.actions;
    result[phase].totalTransitions = counter.transitions;
    result[phase].steps = counter.steps;
    result[phase].landed = await detailState();
    const flow = await logOf(`${phase}-flow`);
    result[phase].postBodies = flow
      .filter((r) => r.method === "POST" && r.path === "/goals")
      .map((r) => pickBody(r.body));
    result[phase].authMeCallsInFlow = flow.filter((r) => r.path === "/auth/me").length;
    result[phase].requests = flow.map(
      (r) => `${r.method} ${shortPath(r.path)}${r.query ? "?…" : ""}`,
    );
  }

  // ── A · KPI #15: NV (create:goal@Own) tạo mục tiêu cá nhân quý, xuất phát /goals ────────────
  await run("A", async () => {
    await setState({ resetGoals: true });
    await startOnGoals("A");
    result.env.browserTimeZone = await page.evaluate(
      () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
    result.env.browserNow = await page.evaluate(() => new Date().toISOString());
    await openFormAndName("A", "Chốt 12 hợp đồng mới trong quý");
    await shot("A1-form-defaults.png");
    await act("nhập chỉ tiêu", () => page.locator('input[name="targetValue"]').fill("100"));
    await saveAndLand("A");
    await shot("A2-landed-detail.png");
  });

  // ── A2 · cùng luồng nhưng đổi «Đơn vị đo» sang Số (story: «kiểu đo nếu khác mặc định») ───────
  await run("A2", async () => {
    await startOnGoals("A2");
    await openFormAndName("A2", "Chốt 12 hợp đồng mới (đếm số)");
    await act("mở «Đơn vị đo»", () => page.locator('select[name="measureType"]').click());
    await act("chọn «Số»", () => page.locator('select[name="measureType"]').selectOption("number"));
    await act("nhập chỉ tiêu", () => page.locator('input[name="targetValue"]').fill("12"));
    await saveAndLand("A2");
  });

  // ── B · thiếu create:goal ⇒ không có lối tạo trên /goals (có dữ liệu · rỗng · «Của tôi» rỗng) ──
  await run("B", async () => {
    await setState({ me: "meNoCreate", phase: "B", resetGoals: true, listEmpty: false });
    await page.goto(`${APP}/goals`);
    await page.waitForURL(/period=/, { timeout: 20000 });
    await settle();
    result.B.withData = await createEntryCount();
    await shot("B1-no-create-with-data.png");
    await setState({ listEmpty: true, meGoalsEmpty: true });
    await page.reload();
    await settle();
    result.B.emptyList = await createEntryCount();
    await shot("B2-no-create-empty.png");
    const mine = page.getByRole("button", { name: "Của tôi" });
    if (await mine.count()) {
      await mine.click();
      await page.waitForURL(/mine=1/, { timeout: 5000 }).catch(() => {});
      await settle();
      result.B.mineEmpty = await createEntryCount();
      result.B.mineEmptyTitle = await page.getByText("Bạn chưa có mục tiêu trong kỳ này").count();
    }
    result.B.postCount = (
      await logOf("B", (r) => r.method === "POST" && r.path === "/goals")
    ).length;
    await setState({ listEmpty: false, meGoalsEmpty: false, me: "meOwn" });
  });

  // ── C · mục tiêu Nháp: «Kích hoạt» một chạm ⇒ PATCH {status:'Active'} (mock trễ 1,5 s để thấy lạc quan) ──
  async function openDraft(phase) {
    await setState({ me: "meOwn", resetGoals: true, phase: `${phase}-load` });
    await page.goto(`${APP}/goals/${ids.DRAFT}`);
    await page.getByRole("heading", { name: DRAFT_NAME }).first().waitFor({ timeout: 20000 });
    await settle();
    result[phase].before = await detailState();
    result[phase].lockHintText = await firstText(/Mục tiêu đang ở Nháp/, 2000);
    await setState({ phase: `${phase}-flow` });
    resetCounter();
    await act("bấm «Kích hoạt»", () =>
      page.getByRole("button", { name: "Kích hoạt", exact: true }).click(),
    );
    result[phase].optimistic = await detailState();
  }
  async function patchesOf(phase) {
    const flow = await logOf(`${phase}-flow`);
    result[phase].patchBodies = flow.filter((r) => r.method === "PATCH").map((r) => r.body);
    result[phase].requests = flow.map((r) => `${r.method} ${shortPath(r.path)}`);
    result[phase].totalActions = counter.actions;
    result[phase].totalTransitions = counter.transitions;
  }
  await run("C", async () => {
    await setState({ denyPatch: false, patchDelayMs: 1500 });
    await openDraft("C");
    await shot("C1-activate-optimistic.png");
    result.C.toast = await firstText(/Đã kích hoạt mục tiêu/, 6000);
    await settle();
    result.C.after = await detailState();
    await shot("C2-activated.png");
    await patchesOf("C");
  });

  // ── C403 · BE từ chối ⇒ quay về Nháp + thông báo ─────────────────────────────────────────
  await run("C403", async () => {
    await setState({ denyPatch: true, patchDelayMs: 1500 });
    await openDraft("C403");
    await shot("C3-403-optimistic.png");
    result.C403.toast = await firstText(/Bạn không có quyền sửa mục tiêu này/, 6000);
    result.C403.rightAfterError = await detailState();
    await shot("C4-403-rolled-back.png");
    await settle();
    await page.waitForTimeout(800);
    result.C403.afterRefetch = await detailState();
    await patchesOf("C403");
    await setState({ denyPatch: false, patchDelayMs: 0 });
  });

  // ── TZ · mốc biên 2026-09-30T17:30Z: UTC còn Q3, giờ công ty (Asia/Ho_Chi_Minh) đã 01/10 (Q4) ──
  await run("TZ", async () => {
    await setState({ me: "meOwn", phase: "TZ" });
    await page.clock.setFixedTime(new Date("2026-09-30T17:30:00Z"));
    await page.goto(`${APP}/goals/new`);
    await page.locator('input[name="name"]').waitFor({ timeout: 20000 });
    await settle();
    result.TZ.machine = await page.evaluate(() => ({
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      utc: new Date().toISOString(),
    }));
    result.TZ.form = await readForm();
    result.TZ.expectedCompanyQuarter = "2026-10-01..2026-12-31";
    result.TZ.utcQuarterWouldBe = "2026-07-01..2026-09-30";
  });

  result.unmocked = (await getLog()).unmocked;
  return result;
};
