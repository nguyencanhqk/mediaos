async (page) => {
  // S20-GOAL-LISTURL-1 — đo KPI trên trình duyệt thật với API giả lập (Playwright MCP browser_run_code, filename=).
  // Cần: (1) dev server, cwd worktree <gốc worktree>: VITE_API_URL=http://127.0.0.1:59999/api/v1 VITE_AUTH_APP_URL=http://127.0.0.1:59998 pnpm --filter @mediaos/app exec vite --port 5299 --strictPort
  //       (2) node S20-GOAL-LISTURL-1.mock-api.cjs S20-GOAL-LISTURL-1.fixtures.json  (cùng thư mục; fixture sinh + parse bằng contracts dist/cjs qua S20-GOAL-LISTURL-1.gen-fixtures.cjs)
  const F = {
    ids: {
      CO: "11111111-1111-4111-8111-111111111111",
      DEPT: "22222222-2222-4222-8222-222222222222",
      ME_EMP: "33333333-3333-4333-8333-333333333333",
      ME_USER: "44444444-4444-4444-8444-444444444444",
      PARENT: "55555555-5555-4555-8555-555555555555",
      emps: [
        "66666666-6666-4666-8666-666666666660",
        "66666666-6666-4666-8666-666666666661",
        "66666666-6666-4666-8666-666666666662",
        "66666666-6666-4666-8666-666666666663",
        "66666666-6666-4666-8666-666666666664",
        "66666666-6666-4666-8666-666666666665",
      ],
    },
    parentDetail: {
      id: "55555555-5555-4555-8555-555555555555",
      companyId: "11111111-1111-4111-8111-111111111111",
      goalCode: "G-0001",
      name: "Doanh số phòng Kinh doanh Q4",
      description: null,
      level: "department",
      departmentId: "22222222-2222-4222-8222-222222222222",
      projectId: null,
      employeeId: null,
      parentGoalId: null,
      ownerEmployeeId: "33333333-3333-4333-8333-333333333333",
      periodType: "quarter",
      periodStart: "2026-10-01",
      periodEnd: "2026-12-31",
      measureType: "percent",
      targetValue: 100,
      currentValue: 0,
      unit: null,
      progressMode: "manual",
      progressPercent: 0,
      weight: 1,
      status: "Active",
      finalizedAt: null,
      createdAt: "2026-10-20T03:00:00.000Z",
      updatedAt: "2026-10-20T03:00:00.000Z",
      parent: null,
      childCount: 0,
    },
    parentCore: {
      id: "55555555-5555-4555-8555-555555555555",
      companyId: "11111111-1111-4111-8111-111111111111",
      goalCode: "G-0001",
      name: "Doanh số phòng Kinh doanh Q4",
      description: null,
      level: "department",
      departmentId: "22222222-2222-4222-8222-222222222222",
      projectId: null,
      employeeId: null,
      parentGoalId: null,
      ownerEmployeeId: "33333333-3333-4333-8333-333333333333",
      periodType: "quarter",
      periodStart: "2026-10-01",
      periodEnd: "2026-12-31",
      measureType: "percent",
      targetValue: 100,
      currentValue: 0,
      unit: null,
      progressMode: "manual",
      progressPercent: 0,
      weight: 1,
      status: "Active",
      finalizedAt: null,
      createdAt: "2026-10-20T03:00:00.000Z",
      updatedAt: "2026-10-20T03:00:00.000Z",
    },
    employees: {
      items: [
        {
          id: "66666666-6666-4666-8666-666666666660",
          userId: null,
          employeeCode: "NV001",
          fullName: "Nguyễn An",
          email: null,
          orgUnitId: "22222222-2222-4222-8222-222222222222",
          orgUnitName: "Kinh doanh",
          positionId: null,
          positionName: null,
          workType: null,
          employmentType: null,
          status: "active",
          avatarUrl: null,
          startDate: null,
          officialDate: null,
          workLocation: null,
          gender: null,
          dateOfBirth: null,
          phone: null,
          contractType: null,
          baseSalary: null,
          identityNumber: null,
          identityIssueDate: null,
          identityIssuePlace: null,
        },
        {
          id: "66666666-6666-4666-8666-666666666661",
          userId: null,
          employeeCode: "NV002",
          fullName: "Nguyễn Bình",
          email: null,
          orgUnitId: "22222222-2222-4222-8222-222222222222",
          orgUnitName: "Kinh doanh",
          positionId: null,
          positionName: null,
          workType: null,
          employmentType: null,
          status: "active",
          avatarUrl: null,
          startDate: null,
          officialDate: null,
          workLocation: null,
          gender: null,
          dateOfBirth: null,
          phone: null,
          contractType: null,
          baseSalary: null,
          identityNumber: null,
          identityIssueDate: null,
          identityIssuePlace: null,
        },
        {
          id: "66666666-6666-4666-8666-666666666662",
          userId: null,
          employeeCode: "NV003",
          fullName: "Nguyễn Chi",
          email: null,
          orgUnitId: "22222222-2222-4222-8222-222222222222",
          orgUnitName: "Kinh doanh",
          positionId: null,
          positionName: null,
          workType: null,
          employmentType: null,
          status: "active",
          avatarUrl: null,
          startDate: null,
          officialDate: null,
          workLocation: null,
          gender: null,
          dateOfBirth: null,
          phone: null,
          contractType: null,
          baseSalary: null,
          identityNumber: null,
          identityIssueDate: null,
          identityIssuePlace: null,
        },
        {
          id: "66666666-6666-4666-8666-666666666663",
          userId: null,
          employeeCode: "NV004",
          fullName: "Nguyễn Dũng",
          email: null,
          orgUnitId: "22222222-2222-4222-8222-222222222222",
          orgUnitName: "Kinh doanh",
          positionId: null,
          positionName: null,
          workType: null,
          employmentType: null,
          status: "active",
          avatarUrl: null,
          startDate: null,
          officialDate: null,
          workLocation: null,
          gender: null,
          dateOfBirth: null,
          phone: null,
          contractType: null,
          baseSalary: null,
          identityNumber: null,
          identityIssueDate: null,
          identityIssuePlace: null,
        },
        {
          id: "66666666-6666-4666-8666-666666666664",
          userId: null,
          employeeCode: "NV005",
          fullName: "Nguyễn Hà",
          email: null,
          orgUnitId: "22222222-2222-4222-8222-222222222222",
          orgUnitName: "Kinh doanh",
          positionId: null,
          positionName: null,
          workType: null,
          employmentType: null,
          status: "active",
          avatarUrl: null,
          startDate: null,
          officialDate: null,
          workLocation: null,
          gender: null,
          dateOfBirth: null,
          phone: null,
          contractType: null,
          baseSalary: null,
          identityNumber: null,
          identityIssueDate: null,
          identityIssuePlace: null,
        },
        {
          id: "66666666-6666-4666-8666-666666666665",
          userId: null,
          employeeCode: "NV006",
          fullName: "Nguyễn Khánh",
          email: null,
          orgUnitId: "22222222-2222-4222-8222-222222222222",
          orgUnitName: "Kinh doanh",
          positionId: null,
          positionName: null,
          workType: null,
          employmentType: null,
          status: "active",
          avatarUrl: null,
          startDate: null,
          officialDate: null,
          workLocation: null,
          gender: null,
          dateOfBirth: null,
          phone: null,
          contractType: null,
          baseSalary: null,
          identityNumber: null,
          identityIssueDate: null,
          identityIssuePlace: null,
        },
      ],
      meta: { page: 1, pageSize: 100, total: 6, totalPages: 1, hasNext: false, hasPrev: false },
    },
    departments: [
      {
        id: "22222222-2222-4222-8222-222222222222",
        name: "Kinh doanh",
        code: "KD",
        parentId: null,
      },
    ],
    meManager: {
      id: "44444444-4444-4444-8444-444444444444",
      companyId: "11111111-1111-4111-8111-111111111111",
      email: "ql@example.test",
      fullName: "Trần Quản Lý",
      status: "active",
      capabilities: {
        "access:goal": true,
        "view:goal": true,
        "create:goal": true,
        "update:goal": true,
        "read:employee": true,
      },
      mustSetupTwoFactor: false,
      mustChangePassword: false,
      company: {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Công ty Thử",
        status: "active",
      },
      employee: {
        id: "33333333-3333-4333-8333-333333333333",
        employeeCode: "QL01",
        fullName: "Trần Quản Lý",
        departmentId: "22222222-2222-4222-8222-222222222222",
        directManagerId: null,
        employmentStatus: "active",
      },
      roles: [{ id: "77777777-7777-4777-8777-777777777777", name: "manager" }],
      scopes: {
        "access:goal": ["Department"],
        "view:goal": ["Department"],
        "create:goal": ["Department"],
        "update:goal": ["Department"],
        "read:employee": ["Department"],
      },
      modules: [{ code: "GOAL", name: "Mục tiêu" }],
    },
    meNoCreate: {
      id: "44444444-4444-4444-8444-444444444444",
      companyId: "11111111-1111-4111-8111-111111111111",
      email: "ql@example.test",
      fullName: "Trần Quản Lý",
      status: "active",
      capabilities: {
        "access:goal": true,
        "view:goal": true,
        "update:goal": true,
        "read:employee": true,
      },
      mustSetupTwoFactor: false,
      mustChangePassword: false,
      company: {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Công ty Thử",
        status: "active",
      },
      employee: {
        id: "33333333-3333-4333-8333-333333333333",
        employeeCode: "QL01",
        fullName: "Trần Quản Lý",
        departmentId: "22222222-2222-4222-8222-222222222222",
        directManagerId: null,
        employmentStatus: "active",
      },
      roles: [{ id: "77777777-7777-4777-8777-777777777777", name: "manager" }],
      scopes: {
        "access:goal": ["Department"],
        "view:goal": ["Department"],
        "update:goal": ["Department"],
        "read:employee": ["Department"],
      },
      modules: [{ code: "GOAL", name: "Mục tiêu" }],
    },
    meOwn: {
      id: "44444444-4444-4444-8444-444444444444",
      companyId: "11111111-1111-4111-8111-111111111111",
      email: "ql@example.test",
      fullName: "Trần Quản Lý",
      status: "active",
      capabilities: {
        "access:goal": true,
        "view:goal": true,
        "create:goal": true,
        "update:goal": true,
        "read:employee": true,
      },
      mustSetupTwoFactor: false,
      mustChangePassword: false,
      company: {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Công ty Thử",
        status: "active",
      },
      employee: {
        id: "33333333-3333-4333-8333-333333333333",
        employeeCode: "QL01",
        fullName: "Trần Quản Lý",
        departmentId: "22222222-2222-4222-8222-222222222222",
        directManagerId: null,
        employmentStatus: "active",
      },
      roles: [{ id: "77777777-7777-4777-8777-777777777777", name: "manager" }],
      scopes: {
        "access:goal": ["Own"],
        "view:goal": ["Own"],
        "create:goal": ["Own"],
        "update:goal": ["Own"],
        "read:employee": ["Own"],
      },
      modules: [{ code: "GOAL", name: "Mục tiêu" }],
    },
    refresh: { accessToken: "fake", expiresIn: 900 },
  };
  // ── Cấu hình ────────────────────────────────────────────────────────────────────────────────
  // API giả lập = S20-GOAL-LISTURL-1.mock-api.cjs trên 127.0.0.1:59999 (page.route làm rơi kết nối MCP ở máy này).
  const APP = "http://localhost:5299";
  const CTL = "http://127.0.0.1:59999/__smoke";
  const SHOT = ".playwright-mcp/s20-kpi/";
  const { ids } = F;
  const Q4 = "2026-10-01..2026-12-31";
  const result = {
    env: {},
    A: {},
    B: {},
    C: {},
    D: {},
    TZ: {},
    unmocked: [],
    errors: [],
  };
  const setState = async (patch) =>
    (await page.request.post(`${CTL}/state`, { data: patch })).json();
  const getLog = async () => (await page.request.get(`${CTL}/log`)).json();
  const logOf = async (phase, filter = () => true) =>
    (await getLog()).log.filter((r) => r.phase === phase && filter(r));
  const apiCalls = async (phase, filter) =>
    (await logOf(phase, filter)).map((r) => `${r.method} ${r.path}${r.query}`);
  const isGoalCall = (r) => r.path.startsWith("/goals") || r.path.startsWith("/me/goals");

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
    return {
      pathname: si < 0 ? "/" : rest.slice(si),
      search: qi < 0 ? "" : noHash.slice(qi),
    };
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
      `${counter.actions}. ${label}${moved ? `  => chuyển trang ${counter.lastPath} -> ${p}` : ""}`,
    );
    counter.lastPath = p;
  }
  const search = () => {
    const s = parseUrl(page.url()).search.slice(1);
    return Object.fromEntries(
      s
        ? s.split("&").map((p) => {
            const [k, v = ""] = p.split("=");
            return [decodeURIComponent(k), decodeURIComponent(v.split("+").join(" "))];
          })
        : [],
    );
  };
  const shot = (name) =>
    page
      .screenshot({ path: SHOT + name })
      .catch((e) => result.errors.push(`shot ${name}: ${e.message}`));
  const settle = async () => {
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(300);
  };
  const clearRemembered = () =>
    page.evaluate(() => {
      try {
        localStorage.removeItem("mediaos.goals.list.last");
      } catch {}
    });
  const heading = () =>
    page
      .getByRole("heading", { name: /Doanh số phòng Kinh doanh Q4/ })
      .first()
      .waitFor({ timeout: 20000 });

  // ── Thiết lập phiên ────────────────────────────────────────────────────────────────────────
  // Cookie CSRF đặt bằng init script (page.context().addCookies làm rơi kết nối MCP ở máy này).
  await page.addInitScript(() => {
    document.cookie = "mediaos_csrf=csrf-smoke; path=/";
  });
  await page.setViewportSize({ width: 1366, height: 900 });
  await setState({
    resetLog: true,
    resetChildren: true,
    me: "meManager",
    denyCreate: false,
    meGoalsEmpty: false,
  });

  // Chạy từng phần một lượt: bản lưu chạy đủ; bản chạy thay dòng PARTS.
  const PARTS = ["A", "B", "C", "D", "TZ"];
  async function run(name, fn) {
    if (!PARTS.includes(name)) return;
    try {
      await fn();
    } catch (e) {
      result.errors.push(`${name}: ${String(e.message).split("\n")[0]}`);
      await shot(`${name}-error.png`);
    }
  }

  // ── A · KPI #18: phân rã cho 6 NV từ /goals/{cha} ─────────────────────────────────────────
  await run("A", async () => {
    await setState({ me: "meManager", resetChildren: true, phase: "A-load" });
    await page.goto(`${APP}/goals/${ids.PARENT}`);
    await heading();
    await settle();
    result.env.browserTimeZone = await page.evaluate(
      () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
    result.env.startUrl = page.url();
    await setState({ phase: "A-flow" });
    resetCounter();
    const perChild = [];
    await act("bấm tab «Mục tiêu con»", () =>
      page.getByRole("tab", { name: /Mục tiêu con/ }).click(),
    );
    await act("bấm «+ Thêm mục tiêu con»", () =>
      page.getByRole("button", { name: /Thêm mục tiêu con/ }).click(),
    );
    await page.waitForURL(/\/goals\/new/);
    await page.locator('input[name="name"]').waitFor();
    await settle();
    result.A.prefillUrl = search();
    const readForm = () =>
      page.evaluate(() => {
        const v = (n) => document.querySelector(`[name="${n}"]`)?.value ?? null;
        return {
          name: v("name"),
          level: v("level"),
          parentGoalId: v("parentGoalId"),
          periodType: v("periodType"),
          periodStart: v("periodStart"),
          periodEnd: v("periodEnd"),
          departmentId: v("departmentId"),
          status: v("status"),
          measureType: v("measureType"),
          targetValue: v("targetValue"),
          employeeAnchor:
            document.querySelector('[data-testid="goal-employee-anchor"]')?.textContent?.trim() ??
            null,
        };
      });
    result.A.formAtOpen = await readForm();
    await shot("A1-form-prefilled.png");
    result.A.formAfterSave = [];
    result.A.toasts = [];
    for (let i = 0; i < 6; i += 1) {
      const before = counter.actions;
      const emp = F.employees.items[i];
      await act(`NV${i + 1}: nhập tên`, () =>
        page.locator('input[name="name"]').fill(`Doanh số Q4 — ${emp.fullName}`),
      );
      await act(`NV${i + 1}: mở chọn nhân viên`, () =>
        page.locator('[data-testid="goal-employee-anchor"]').click(),
      );
      await act(`NV${i + 1}: chọn ${emp.fullName}`, () =>
        page
          .locator('[data-testid="goal-employee-anchor-search"] ~ ul button', {
            hasText: emp.fullName,
          })
          .click(),
      );
      await act(`NV${i + 1}: nhập chỉ tiêu`, () =>
        page.locator('input[name="targetValue"]').fill(String(100 + i * 10)),
      );
      const last = i === 5;
      const posted = page.waitForResponse(
        (r) => r.url().endsWith("/api/v1/goals") && r.request().method() === "POST",
      );
      await act(
        last ? `NV${i + 1}: bấm «Tạo mục tiêu»` : `NV${i + 1}: bấm «Lưu và thêm tiếp»`,
        async () => {
          await page
            .getByRole("button", {
              name: last ? "Tạo mục tiêu" : "Lưu và thêm tiếp",
            })
            .click();
          await posted;
        },
      );
      perChild.push(counter.actions - before);
      if (!last) {
        await page
          .getByText(`Đã tạo mục tiêu «Doanh số Q4 — ${emp.fullName}»`)
          .first()
          .waitFor({ timeout: 5000 })
          .then(() => result.A.toasts.push(true))
          .catch(() => result.A.toasts.push(false));
        await page.waitForTimeout(200);
        result.A.formAfterSave.push(await readForm());
        if (i === 0) await shot("A2-after-save-and-next.png");
      }
    }
    await page
      .waitForURL(new RegExp(`/goals/${ids.PARENT}\\?tab=children`), {
        timeout: 8000,
      })
      .catch(() => {});
    await settle();
    if (counter.lastPath !== pathOf()) {
      counter.transitions += 1;
      counter.steps.push(`(tự động sau «Tạo») về ${page.url()}`);
    }
    result.A.endUrl = page.url();
    result.A.childrenRowsShown = await page
      .getByRole("tabpanel")
      .getByText(/Doanh số Q4 — /)
      .count();
    await shot("A3-back-on-children-tab.png");
    result.A.totalActions = counter.actions;
    result.A.totalTransitions = counter.transitions;
    result.A.actionsPerChild = perChild;
    result.A.firstChildActions = 2 + perChild[0];
    result.A.steps = counter.steps;
    const flow = await logOf("A-flow");
    result.A.postBodies = flow
      .filter((r) => r.method === "POST" && r.path === "/goals")
      .map(({ body: b }) => ({
        name: b.name,
        level: b.level,
        employeeId: b.employeeId,
        parentGoalId: b.parentGoalId,
        departmentId: b.departmentId,
        periodType: b.periodType,
        periodStart: b.periodStart,
        periodEnd: b.periodEnd,
        status: b.status,
        measureType: b.measureType,
        targetValue: b.targetValue,
      }));
    result.A.requestCount = flow.length;
    result.A.requestsByEndpoint = flow.reduce((m, r) => {
      const k = `${r.method} ${r.path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ":id")}${r.query.includes("parentGoalId") ? "?parentGoalId" : ""}`;
      m[k] = (m[k] || 0) + 1;
      return m;
    }, {});
  });

  // ── B · thiếu create:goal ⇒ không có nút; tự gõ URL ⇒ BE 403 hiện lỗi quyền ────────────────
  await run("B", async () => {
    await setState({ me: "meNoCreate", phase: "B", denyCreate: true });
    await page.goto(`${APP}/goals/${ids.PARENT}?tab=children`);
    await heading();
    await settle();
    result.B.childrenTabSelected = await page
      .getByRole("tab", { name: /Mục tiêu con/ })
      .getAttribute("aria-selected");
    result.B.addButtonCount = await page.getByRole("button", { name: /Thêm mục tiêu con/ }).count();
    await shot("B1-no-create-no-button.png");
    await page.goto(
      `${APP}/goals/new?parentGoalId=${ids.PARENT}&level=employee&departmentId=${ids.DEPT}&periodType=quarter&periodStart=2026-10-01&periodEnd=2026-12-31`,
    );
    await page.locator('input[name="name"]').waitFor({ timeout: 20000 });
    await settle();
    await page.locator('input[name="name"]').fill("Thử tự gõ URL");
    await page.locator('[data-testid="goal-employee-anchor"]').click();
    await page
      .locator('[data-testid="goal-employee-anchor-search"] ~ ul button', {
        hasText: "Nguyễn An",
      })
      .click();
    await page.getByRole("button", { name: "Tạo mục tiêu" }).click();
    await page.getByRole("alert").filter({ hasText: /quyền/ }).first().waitFor({ timeout: 5000 });
    result.B.typedUrlSaveAlert = (
      await page.getByRole("alert").filter({ hasText: /quyền/ }).first().textContent()
    )?.trim();
    result.B.stayedOnForm = pathOf();
    result.B.postStatus = (await logOf("B", (r) => r.method === "POST")).length;
    await shot("B2-typed-url-403.png");
    await setState({ denyCreate: false });
  });

  // ── C · /goals URL trống ⇒ quý hiện tại (giờ công ty) + phòng; F5; Back; rác ─────────────
  await run("C", async () => {
    await setState({ me: "meManager", resetChildren: true, phase: "C-detail" });
    await page.goto(`${APP}/goals/${ids.PARENT}`);
    await heading();
    await clearRemembered();
    await settle();
    await setState({ phase: "C-empty" });
    const link = page.locator('a[href="/goals"]').first();
    result.C.inAppLinkToGoals = (await link.count()) > 0;
    if (result.C.inAppLinkToGoals) await link.click();
    else await page.goto(`${APP}/goals`);
    await page.waitForURL(/period=/, { timeout: 10000 });
    await settle();
    result.C.emptyUrlBecame = search();
    result.C.emptyUrlRequests = await apiCalls(
      "C-empty",
      (r) => isGoalCall(r) || r.path === "/auth/me",
    );
    result.C.goalRequestsWithoutPeriod = (
      await logOf("C-empty", (r) => r.path.startsWith("/goals") && !r.query.includes("periodFrom"))
    ).length;
    await shot("C1-empty-url-defaults.png");
    await setState({ phase: "C-F5" });
    await page.reload();
    await page.waitForURL(/period=/);
    await settle();
    result.C.afterF5 = search();
    await setState({ phase: "C-chip" });
    await page.getByRole("button", { name: "Năm nay" }).click();
    await page.waitForURL(/period=2026-01-01/);
    await settle();
    result.C.afterYearChip = search();
    result.C.yearChipRequests = await apiCalls("C-chip", isGoalCall);
    await page.goBack();
    await page.waitForURL(/period=2026-10-01/, { timeout: 5000 }).catch(() => {});
    await settle();
    result.C.afterBackFromChip = search();
    await page.reload();
    await settle();
    result.C.afterBackThenF5 = search();
    await page.goBack();
    await settle();
    result.C.secondBackLandsOn = page.url();
    // Rác trên URL
    await setState({ phase: "C-junk" });
    await page.goto(
      `${APP}/goals?period=garbage&status=nope&departmentId=xyz&view=foo&mine=7&level=zzz&risk=abc`,
    );
    await page.waitForURL(/period=/, { timeout: 10000 });
    await settle();
    result.C.junkUrlBecame = search();
    result.C.junkErrorScreen = await page
      .getByText(/Không tải được|Đã có lỗi|Something went wrong/)
      .count();
    result.C.junkRequests = await apiCalls("C-junk", isGoalCall);
    await shot("C2-junk-params-defaults.png");
    // Phạm vi Own ⇒ không thêm departmentId
    await setState({ me: "meOwn", phase: "C-own-detail" });
    await page.goto(`${APP}/goals/${ids.PARENT}`);
    await heading();
    await clearRemembered();
    await setState({ phase: "C-own" });
    await page.goto(`${APP}/goals`);
    await page.waitForURL(/period=/, { timeout: 10000 });
    await settle();
    result.C.ownScopeUrlBecame = search();
    result.C.ownScopeRequests = await apiCalls(
      "C-own",
      (r) => isGoalCall(r) || r.path === "/auth/me",
    );
    await setState({ me: "meManager" });
  });

  // ── D · «Của tôi» ⇒ GET /me/goals (không ?employeeId=) ──────────────────────────────────
  await run("D", async () => {
    await setState({ me: "meManager", phase: "D-load", meGoalsEmpty: false });
    await page.goto(`${APP}/goals?period=${Q4}&departmentId=${ids.DEPT}`);
    await settle();
    await setState({ phase: "D-mine" });
    await page.getByRole("button", { name: "Của tôi" }).click();
    await page.waitForURL(/mine=1/);
    await settle();
    result.D.urlAfterMine = search();
    result.D.mineRequests = await apiCalls("D-mine", isGoalCall);
    result.D.employeeIdParamCount = (
      await logOf("D-mine", (r) => r.query.includes("employeeId"))
    ).length;
    result.D.minePressed = await page
      .getByRole("button", { name: "Của tôi" })
      .getAttribute("aria-pressed");
    await shot("D1-mine.png");
    await setState({ phase: "D-F5" });
    await page.reload();
    await settle();
    result.D.afterF5 = search();
    result.D.f5Requests = await apiCalls("D-F5", isGoalCall);
    await setState({ phase: "D-empty", meGoalsEmpty: true });
    await page.reload();
    await settle();
    result.D.emptyTitle = await page.getByText("Bạn chưa có mục tiêu trong kỳ này").count();
    result.D.emptyPrevPeriod =
      (await page.getByRole("button", { name: "Xem kỳ trước" }).count()) +
      (await page.getByRole("link", { name: "Xem kỳ trước" }).count());
    result.D.emptyCreate =
      (await page.getByRole("button", { name: /Tạo mục tiêu/ }).count()) +
      (await page.getByRole("link", { name: /Tạo mục tiêu/ }).count());
    await shot("D2-mine-empty.png");
    await setState({ meGoalsEmpty: false });
  });

  // ── TZ · mốc biên 2026-09-30T17:30Z: UTC còn 30/09 (Q3), giờ công ty HCM đã 01/10 00:30 (Q4) ──
  // (đổi múi context qua CDP có nguy cơ làm rơi kết nối MCP ⇒ chỉ cố định đồng hồ; múi máy ghi kèm.)
  await run("TZ", async () => {
    await setState({ me: "meOwn", phase: "TZ" });
    await page.clock.setFixedTime(new Date("2026-09-30T17:30:00Z"));
    await page.goto(`${APP}/goals/${ids.PARENT}`);
    await heading();
    await clearRemembered();
    await page.goto(`${APP}/goals`);
    await page.waitForURL(/period=/, { timeout: 10000 });
    await settle();
    result.TZ.machine = await page.evaluate(() => ({
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      local: new Date().toString(),
      utc: new Date().toISOString(),
    }));
    result.TZ.urlBecame = search();
    result.TZ.expectedCompanyQuarter = Q4;
    result.TZ.utcQuarterWouldBe = "2026-07-01..2026-09-30";
  });

  result.unmocked = (await getLog()).unmocked;
  return result;
};
