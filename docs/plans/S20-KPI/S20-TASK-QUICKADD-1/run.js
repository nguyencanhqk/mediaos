async (page) => {
  // S20-TASK-QUICKADD-1 — đo KPI #8 + #13 trên trình duyệt thật với API giả lập (Playwright MCP browser_run_code, filename=).
  // Cần: (1) dev server từ gốc cây đang đo: VITE_API_URL=http://127.0.0.1:59999/api/v1 VITE_AUTH_APP_URL=http://127.0.0.1:59998 pnpm --filter @mediaos/app exec vite --port 5299 --strictPort
  //       (2) node mock-api.cjs fixtures.json  (cùng thư mục; fixture sinh + parse bằng contracts dist/cjs qua gen-fixtures.cjs)
  const ids = {
    ME_EMP: "33333333-3333-4333-8333-333333333333",
    PROJ: "55555555-5555-4555-8555-555555555555",
    ST_TODO: "66666666-0000-4000-8000-000000000001",
    A: "88888888-0000-4000-8000-00000000000a",
    B: "88888888-0000-4000-8000-00000000000b",
    C: "88888888-0000-4000-8000-00000000000c",
    X: "88888888-0000-4000-8000-00000000000f",
  };
  const NAMES = { A: "Lê Văn An", B: "Phạm Thị Bình", C: "Hoàng Minh Châu", X: "Đỗ Ngoài Phạm Vi" };
  const APP = "http://localhost:5299";
  const CTL = "http://127.0.0.1:59999/__smoke";
  const SHOT = ".playwright-mcp/s20-kpi/task-quickadd-";
  // «Hôm nay» giả lập: Thứ Năm 22/10/2026 10:00 giờ VN (= 03:00 UTC).
  const NOW = "2026-10-22T03:00:00.000Z";
  const EXPECT_TODAY_1700_UTC = "2026-10-22T10:00:00.000Z";
  const EXPECT_FRIDAY_1700_UTC = "2026-10-23T10:00:00.000Z";
  const PARTS = ["A", "U", "B", "B2", "BD", "C", "X", "layout"];
  const result = {
    env: {},
    A: {},
    U: {},
    B: {},
    B2: {},
    C: {},
    X: {},
    layout: {},
    unmocked: [],
    errors: [],
  };

  const setState = async (patch) =>
    (await page.request.post(`${CTL}/state`, { data: patch })).json();
  const getLog = async () => (await page.request.get(`${CTL}/log`)).json();
  const logOf = async (phase, filter = () => true) =>
    (await getLog()).log.filter((r) => r.phase === phase && filter(r));
  const isCreate = (r) => r.method === "POST" && r.path === "/tasks";
  const short = (r) =>
    `${r.method} ${r.path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ":id")}${r.query || ""} → ${r.status}`;

  // ── Bộ đếm ─────────────────────────────────────────────────────────────────────────────────
  // 1 thao tác = 1 click/chạm · 1 phím tắt · 1 lần mở dropdown · 1 lần chọn mục · 1 lần bấm gửi/lưu (Enter) ·
  // mỗi trường gõ tự do = 1 «nhập» (docs/plans/S20-WORKUX-STORIES.md «Cách đếm thao tác»).
  // Chuyển trang = pathname đổi HOẶC tài liệu tải lại. Sandbox của browser_run_code không có `URL` ⇒ tự tách pathname.
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
  const snapCounter = () => ({
    actions: counter.actions,
    pathnameChanges: counter.transitions,
    documentReloads: counter.reloads,
    steps: [...counter.steps],
  });
  const shot = (name, opts = {}) =>
    page
      .screenshot({ path: SHOT + name, ...opts })
      .catch((e) => result.errors.push(`shot ${name}: ${e.message}`));
  const settle = async () => {
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(300);
  };
  const activeTestId = () =>
    page.evaluate(() => {
      const el = document.activeElement;
      return el ? el.getAttribute("data-testid") || el.tagName : null;
    });
  const createdResponse = () =>
    page.waitForResponse(
      (r) => r.url().endsWith("/api/v1/tasks") && r.request().method() === "POST",
      { timeout: 10000 },
    );
  const exactText = (t) => page.getByText(t, { exact: true });

  // ── Thiết lập phiên ────────────────────────────────────────────────────────────────────────
  // Cookie CSRF đặt bằng init script (page.context().addCookies làm rơi kết nối MCP ở máy đo).
  await page.addInitScript(() => {
    document.cookie = "mediaos_csrf=csrf-smoke; path=/";
  });
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.clock.setFixedTime(new Date(NOW));
  await setState({ resetLog: true, reset: true, me: "meNv" });

  async function run(name, fn) {
    if (!PARTS.includes(name)) return;
    try {
      await fn();
    } catch (e) {
      result.errors.push(`${name}: ${String(e.message).split("\n")[0]}`);
      await shot(`${name}-error.png`);
    }
  }

  // ── Ô tạo nhanh «Việc của tôi» ─────────────────────────────────────────────────────────────
  const MY = "my-tasks-quick-add";
  const myInput = () => page.getByTestId(`${MY}-input`);
  const openMyTasks = async () => {
    await page.goto(`${APP}/tasks/my-tasks`);
    await exactText("Soạn báo giá khách hàng A").first().waitFor({ timeout: 20000 });
    await settle();
  };

  // ── A · KPI #8: tạo việc cho mình có hạn, xuất phát /tasks/my-tasks ────────────────────────
  await run("A", async () => {
    await setState({ me: "meNv", reset: true, phase: "A-load" });
    await openMyTasks();
    result.env.browserTimeZone = await page.evaluate(
      () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
    result.env.browserNow = await page.evaluate(() => new Date().toISOString());
    result.env.startUrl = page.url();
    result.A.focusOnLoad = await activeTestId();
    result.A.inputEnabled = await myInput().isEnabled();
    result.A.assigneeChipCount = await page.getByTestId(`${MY}-assignee`).count();
    result.A.nearestChipText = (await page.getByTestId(`${MY}-due-nearest`).textContent())?.trim();
    result.A.createButton = await page
      .getByRole("button", { name: "Tạo việc", exact: true })
      .count();
    await shot("A1-start.png");
    await setState({ phase: "A-flow" });
    await resetCounter();
    const title = "Gọi lại khách hàng B";
    await act("nhập tiêu đề vào ô tạo nhanh (bấm vào ô rồi gõ)", async () => {
      await myInput().click();
      await page.keyboard.type(title);
    });
    await act("bấm chip «Hôm nay 17:00»", () => page.getByTestId(`${MY}-due-nearest`).click());
    result.A.focusAfterChip = await activeTestId();
    const resp = createdResponse();
    await act("Enter", () => page.keyboard.press("Enter"));
    result.A.createStatus = (await resp).status();
    await exactText(title).first().waitFor({ timeout: 10000 });
    await settle();
    result.A.counter = snapCounter();
    result.A.urlAfter = page.url();
    const creates = await logOf("A-flow", isCreate);
    result.A.createBodies = creates.map((r) => r.body);
    result.A.assigneeIsMe =
      creates.length === 1 && creates[0].body.assigneeEmployeeId === ids.ME_EMP;
    result.A.dueAtIsToday1700 =
      creates.length === 1 && creates[0].body.dueAt === EXPECT_TODAY_1700_UTC;
    result.A.requests = (await logOf("A-flow")).map(short);
    result.A.inputValueAfter = await myInput().inputValue();
    result.A.focusAfterEnter = await activeTestId();
    result.A.chipStillPressed = await page
      .getByTestId(`${MY}-due-nearest`)
      .getAttribute("aria-pressed");
    result.A.newRowVisible = await exactText(title).count();
    // Nhóm chứa dòng mới: tiêu đề nhóm (h2/h3) gần nhất phía trên dòng.
    result.A.newRowGroup = await exactText(title)
      .first()
      .evaluate((el) => {
        let n = el;
        while (n && n !== document.body) {
          const h = n.querySelector && n.querySelector("h2,h3");
          if (h) return h.textContent.trim().slice(0, 60);
          n = n.parentElement;
        }
        return null;
      });
    await shot("A2-created.png");
    // Chip hạn «dính»: gõ việc thứ hai + Enter ⇒ cùng dueAt.
    await setState({ phase: "A-sticky" });
    const resp2 = createdResponse();
    await page.keyboard.type("Gửi biên bản họp");
    await page.keyboard.press("Enter");
    await resp2;
    await settle();
    const c2 = await logOf("A-sticky", isCreate);
    result.A.stickyBodies = c2.map((r) => r.body);
    result.A.stickyDueKept = c2.length === 1 && c2[0].body.dueAt === EXPECT_TODAY_1700_UTC;
    await shot("A3-sticky.png");
  });

  // ── U · chưa liên kết hồ sơ nhân viên ⇒ ô khoá kèm giải thích, 0 request tạo ─────────────────
  await run("U", async () => {
    await setState({ me: "meNvUnlinked", reset: true, phase: "U" });
    await openMyTasks();
    result.U.inputEnabled = await myInput().isEnabled();
    result.U.message = (await page.getByTestId(`${MY}-message`).textContent())?.trim();
    result.U.chips = await page
      .locator(`[data-testid^="${MY}-due"],[data-testid^="${MY}-assignee"]`)
      .count();
    await page.keyboard.press("n");
    await page.keyboard.type("Thử gõ khi ô khoá");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
    result.U.createRequests = (await logOf("U", isCreate)).length;
    await shot("U1-unlinked.png");
  });

  // ── Board dự án ────────────────────────────────────────────────────────────────────────────
  const QC = `kanban-quick-create-${ids.ST_TODO}`;
  const qcInput = () => page.getByTestId(`kanban-quick-create-input-${ids.ST_TODO}`);
  const openBoard = async () => {
    await page.goto(`${APP}/tasks/projects/${ids.PROJ}?tab=board`);
    await exactText("Chốt danh sách khách mời").first().waitFor({ timeout: 20000 });
    await settle();
  };
  const pickerPanel = () =>
    page.getByTestId(`${QC}-assignee-search`).locator("xpath=ancestor::*[.//ul][1]");
  // Tên trợ năng của mục = chữ tắt avatar + họ tên («LA Lê Văn An») ⇒ lọc theo span họ tên khớp nguyên văn.
  const pickerOption = (name) =>
    pickerPanel()
      .locator("ul button")
      .filter({ has: page.getByText(name, { exact: true }) });
  const openQuickCreate = () => page.getByTestId(`kanban-quick-create-open-${ids.ST_TODO}`).click();

  // ── B · KPI #13: giao 5 việc cho 3 người bằng ô tạo nhanh, chip Người «dính» ────────────────
  await run("B", async () => {
    await setState({ me: "meQl", reset: true, phase: "B-load" });
    await openBoard();
    result.B.startUrl = page.url();
    result.B.boardCreateButton = await page.getByTestId("kanban-create-task").count();
    await shot("B1-board.png");
    await setState({ phase: "B-flow" });
    await resetCounter();
    await act("bấm «+ Thêm công việc» đáy cột «Cần làm»", openQuickCreate);
    result.B.focusAfterOpen = await activeTestId();
    const plan = [
      ["A", ["Thiết kế banner sự kiện", "Viết bài PR ra mắt"]],
      ["B", ["Đặt phòng hội nghị", "Chuẩn bị quà tặng"]],
      ["C", ["Lên kịch bản MC"]],
    ];
    result.B.pickerOptions = null;
    result.B.afterEachEnter = [];
    for (const [who, titles] of plan) {
      await act("mở chip «Người»", () => page.getByTestId(`${QC}-assignee`).click());
      if (!result.B.pickerOptions) {
        await pickerOption(NAMES.A).waitFor({ timeout: 5000 });
        result.B.pickerOptions = (await pickerPanel().locator("ul button").allTextContents()).map(
          (s) => s.trim(),
        );
        await shot("B2-picker.png");
      }
      await act(`chọn «${NAMES[who]}»`, () => pickerOption(NAMES[who]).click());
      for (const title of titles) {
        await act(`gõ «${title}»`, () => page.keyboard.type(title));
        const resp = createdResponse();
        await act("Enter", () => page.keyboard.press("Enter"));
        await resp;
        await exactText(title).first().waitFor({ timeout: 10000 });
        result.B.afterEachEnter.push({
          title,
          chip: (await page.getByTestId(`${QC}-assignee`).textContent())?.trim(),
          inputValue: await qcInput().inputValue(),
          focus: await activeTestId(),
        });
      }
    }
    await settle();
    result.B.counter = snapCounter();
    result.B.urlAfter = page.url();
    const creates = await logOf("B-flow", isCreate);
    result.B.createBodies = creates.map((r) => ({ status: r.status, ...r.body }));
    const byWho = {};
    for (const r of creates) {
      const who =
        Object.keys(NAMES).find((k) => ids[k] === r.body.assigneeEmployeeId) ||
        String(r.body.assigneeEmployeeId);
      byWho[who] = (byWho[who] || 0) + 1;
    }
    result.B.assignedCount = byWho;
    result.B.allInProjectAndColumn = creates.every(
      (r) => r.body.projectId === ids.PROJ && r.body.stateId === ids.ST_TODO,
    );
    result.B.requests = (await logOf("B-flow")).map(short);
    result.B.cardsVisible = [];
    for (const t of plan.flatMap((p) => p[1]))
      result.B.cardsVisible.push(await exactText(t).count());
    await shot("B3-after-5.png");
  });

  // ── B2 · tiêu chí 1 + 5: Người = An, Hạn = Thứ Sáu, 2 việc; rồi Esc đóng ô và xoá chip ──────
  await run("B2", async () => {
    await setState({ me: "meQl", reset: true, phase: "B2-load" });
    await openBoard();
    await setState({ phase: "B2-flow" });
    await resetCounter();
    await act("bấm «+ Thêm công việc»", openQuickCreate);
    await act("mở chip «Người»", () => page.getByTestId(`${QC}-assignee`).click());
    await act(`chọn «${NAMES.A}»`, () => pickerOption(NAMES.A).click());
    await act("mở chip «Hạn»", () => page.getByTestId(`${QC}-due`).click());
    const group = page.getByRole("group", { name: "Mốc hạn nhanh" });
    await group.waitFor({ timeout: 5000 });
    result.B2.presetLabels = (await group.getByRole("button").allTextContents()).map((s) =>
      s.replace(/\s+/g, " ").trim(),
    );
    await shot("B2-1-deadline-popover.png");
    await act("chọn «Thứ Sáu này 17:00»", () =>
      group.getByRole("button", { name: /Thứ Sáu này/ }).click(),
    );
    result.B2.chipsAfterPick = {
      assignee: (await page.getByTestId(`${QC}-assignee`).textContent())?.trim(),
      due: (await page.getByTestId(`${QC}-due`).textContent())?.trim(),
      focus: await activeTestId(),
    };
    for (const title of ["In tờ rơi", "Gửi thư mời đối tác"]) {
      await act(`gõ «${title}»`, () => page.keyboard.type(title));
      const resp = createdResponse();
      await act("Enter", () => page.keyboard.press("Enter"));
      await resp;
    }
    await settle();
    result.B2.counter = snapCounter();
    const creates = await logOf("B2-flow", isCreate);
    result.B2.createBodies = creates.map((r) => ({ status: r.status, ...r.body }));
    result.B2.bothAssignedAFriday =
      creates.length === 2 &&
      creates.every(
        (r) => r.body.assigneeEmployeeId === ids.A && r.body.dueAt === EXPECT_FRIDAY_1700_UTC,
      );
    await shot("B2-2-two-created.png");
    // Esc đóng ô + xoá chip; mở lại ⇒ chip trống.
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    result.B2.inputAfterEsc = await qcInput().count();
    await openQuickCreate();
    await page.waitForTimeout(300);
    result.B2.chipsAfterReopen = {
      assignee: (await page.getByTestId(`${QC}-assignee`).textContent())?.trim(),
      due: (await page.getByTestId(`${QC}-due`).textContent())?.trim(),
      nearestPressed: await page.getByTestId(`${QC}-due-nearest`).getAttribute("aria-pressed"),
    };
    await page.keyboard.press("Escape");
  });

  // ── BD · KPI #13 kèm Hạn «dính»: như B nhưng đặt Hạn = Thứ Sáu MỘT lần trước việc đầu ─────────
  // Story đếm 17 KHÔNG gồm Hạn; phần này đo giá thật của «có cả Hạn» và Hạn có sống qua các lần đổi Người.
  await run("BD", async () => {
    await setState({ me: "meQl", reset: true, phase: "BD-load" });
    await openBoard();
    await setState({ phase: "BD-flow" });
    await resetCounter();
    await act("bấm «+ Thêm công việc»", openQuickCreate);
    await act("mở chip «Hạn»", () => page.getByTestId(`${QC}-due`).click());
    const group = page.getByRole("group", { name: "Mốc hạn nhanh" });
    await group.waitFor({ timeout: 5000 });
    await act("chọn «Thứ Sáu này 17:00»", () =>
      group.getByRole("button", { name: /Thứ Sáu này/ }).click(),
    );
    const plan = [
      ["A", ["Thiết kế banner sự kiện", "Viết bài PR ra mắt"]],
      ["B", ["Đặt phòng hội nghị", "Chuẩn bị quà tặng"]],
      ["C", ["Lên kịch bản MC"]],
    ];
    for (const [who, titles] of plan) {
      await act("mở chip «Người»", () => page.getByTestId(`${QC}-assignee`).click());
      await act(`chọn «${NAMES[who]}»`, () => pickerOption(NAMES[who]).click());
      for (const title of titles) {
        await act(`gõ «${title}»`, () => page.keyboard.type(title));
        const resp = createdResponse();
        await act("Enter", () => page.keyboard.press("Enter"));
        await resp;
      }
    }
    await settle();
    result.BD = { counter: snapCounter() };
    const creates = await logOf("BD-flow", isCreate);
    result.BD.createBodies = creates.map((r) => ({
      status: r.status,
      assignee: Object.keys(NAMES).find((k) => ids[k] === r.body.assigneeEmployeeId) || null,
      dueAt: r.body.dueAt ?? null,
    }));
    result.BD.allFriday =
      creates.length === 5 && creates.every((r) => r.body.dueAt === EXPECT_FRIDAY_1700_UTC);
    result.BD.dueChipAtEnd = (await page.getByTestId(`${QC}-due`).textContent())?.trim();
    await shot("BD-after-5-with-deadline.png");
    await page.keyboard.press("Escape");
  });

  // ── C · thiếu assign:task ⇒ không có chip Người, việc vẫn tạo (chưa giao) ─────────────────────
  await run("C", async () => {
    await setState({ me: "meQlNoAssign", reset: true, phase: "C-load" });
    await openBoard();
    await setState({ phase: "C-flow" });
    await openQuickCreate();
    await page.waitForTimeout(300);
    result.C.assigneeChip = await page.getByTestId(`${QC}-assignee`).count();
    result.C.dueChips = await page
      .locator(`[data-testid="${QC}-due"],[data-testid="${QC}-due-nearest"]`)
      .count();
    result.C.membersRequested = (await logOf("C-flow", (r) => r.path.endsWith("/members"))).length;
    await shot("C1-no-assign.png");
    const title = "Kiểm kê vật tư";
    const resp = createdResponse();
    await page.keyboard.type(title);
    await page.keyboard.press("Enter");
    result.C.createStatus = (await resp).status();
    await exactText(title).first().waitFor({ timeout: 10000 });
    const creates = await logOf("C-flow", isCreate);
    result.C.createBodies = creates.map((r) => r.body);
    result.C.bodyHasAssignee = creates.some((r) => "assigneeEmployeeId" in (r.body || {}));
    result.C.cardVisible = await exactText(title).count();
    await shot("C2-created-unassigned.png");
    await page.keyboard.press("Escape");
  });

  // ── X · người ngoài phạm vi ⇒ server 403, dòng lỗi + tiêu đề trả lại ô ─────────────────────
  await run("X", async () => {
    await setState({ me: "meQl", reset: true, phase: "X-load" });
    await openBoard();
    await setState({ phase: "X-flow" });
    await openQuickCreate();
    await page.getByTestId(`${QC}-assignee`).click();
    await page.getByTestId(`${QC}-assignee-search`).fill("Đỗ");
    await pickerOption(NAMES.X).click();
    const title = "Việc giao nhầm người";
    const resp = createdResponse();
    await page.keyboard.type(title);
    await page.keyboard.press("Enter");
    result.X.createStatus = (await resp).status();
    await page.waitForTimeout(400);
    result.X.message = (await page.getByTestId(`${QC}-message`).textContent())?.trim();
    result.X.messageRole = await page.getByTestId(`${QC}-message`).getAttribute("role");
    result.X.inputValue = await qcInput().inputValue();
    result.X.cardCreated = await exactText(title).count();
    await shot("X1-out-of-scope.png");
    await page.keyboard.press("Escape");
  });

  // ── layout · 390 px: ô tạo nhanh ở «Việc của tôi» và trên board ─────────────────────────────
  await run("layout", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    const measure = () =>
      page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
    const boxOf = async (testId) => {
      const b = await page.getByTestId(testId).boundingBox();
      return b && { x: Math.round(b.x), right: Math.round(b.x + b.width) };
    };
    await setState({ me: "meNv", reset: true, phase: "L-my" });
    await openMyTasks();
    result.layout.myTasks = await measure();
    result.layout.myQuickAddBox = await boxOf(MY);
    await shot("L1-my-390.png");
    await setState({ me: "meQl", reset: true, phase: "L-board" });
    await openBoard();
    await openQuickCreate();
    await page.getByTestId(`${QC}-assignee`).click();
    await page.waitForTimeout(300);
    result.layout.boardWithPicker = await measure();
    result.layout.boardQuickAddBox = await boxOf(QC);
    await shot("L2-board-390-picker.png");
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 1366, height: 900 });
  });

  result.unmocked = (await getLog()).unmocked;
  return result;
};
