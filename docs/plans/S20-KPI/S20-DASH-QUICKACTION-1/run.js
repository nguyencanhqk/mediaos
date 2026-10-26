async (page) => {
  // S20-DASH-QUICKACTION-1 — đo đích nút nhanh dashboard · badge /me · chấm công trên widget, trình duyệt thật + API giả lập
  // (Playwright MCP browser_run_code, filename=).
  // Cần: (1) dev server từ gốc cây đang đo: VITE_API_URL=http://127.0.0.1:59999/api/v1 VITE_AUTH_APP_URL=http://127.0.0.1:59998 pnpm --filter @mediaos/app exec vite --port 5299 --strictPort
  //       (2) node mock-api.cjs fixtures.json  (cùng thư mục; fixture sinh + parse bằng contracts dist/cjs qua gen-fixtures.cjs)
  const APP = "http://localhost:5299";
  const CTL = "http://127.0.0.1:59999/__smoke";
  const SHOT = ".playwright-mcp/s20-kpi/dash-quickaction-";
  // «Hôm nay» giả lập: Thứ Năm 22/10/2026 10:00 giờ VN (= 03:00 UTC).
  const NOW = "2026-10-22T03:00:00.000Z";
  const PARTS = ["D", "L", "M", "MZ", "AR", "AS", "ASB", "layout"];
  const TASK_TITLES = [
    "Nộp báo cáo tuần",
    "Gửi hợp đồng khách C",
    "Duyệt ngân sách quý",
    "Chuẩn bị họp giao ban",
    "Cập nhật kế hoạch tháng",
    "Đọc tài liệu quy trình",
  ];
  // Nhãn nút nhanh NAVIGATE của hai bộ payload (gen-fixtures.cjs: qaNew · qaLegacy).
  const LABELS_NEW = [
    "Tạo task",
    "Xem tất cả task",
    "Xem task quá hạn",
    "Xem việc sắp đến hạn",
    "Xem tất cả thông báo",
    "Duyệt đơn",
    "Danh bạ nhân sự",
  ];
  const LABELS_LEGACY = [
    "Tạo task",
    "Xem tất cả task",
    "Xem task cần chú ý",
    "Xem tất cả thông báo",
    "Duyệt đơn",
    "Danh bạ nhân sự",
  ];
  const result = {
    D: {},
    L: {},
    M: {},
    MZ: {},
    AR: {},
    AS: {},
    ASB: {},
    layout: {},
    unmocked: [],
    errors: [],
  };

  const setState = async (patch) =>
    (await page.request.post(`${CTL}/state`, { data: patch })).json();
  const getLog = async () => (await page.request.get(`${CTL}/log`)).json();
  const logOf = async (phase, filter = () => true) =>
    (await getLog()).log.filter((r) => r.phase === phase && filter(r));
  // Sandbox của browser_run_code không có `URL` ⇒ tự tách pathname + search.
  const where = () => {
    const u = page.url().split("#")[0];
    const rest = u.indexOf("://") < 0 ? u : u.slice(u.indexOf("://") + 3);
    const si = rest.indexOf("/");
    return si < 0 ? "/" : rest.slice(si);
  };
  const shot = (name, opts = {}) =>
    page
      .screenshot({ path: SHOT + name, ...opts })
      .catch((e) => result.errors.push(`shot ${name}: ${e.message}`));
  const settle = async () => {
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(400);
  };
  // Trang đích: tiêu đề h1, có chữ «không tìm thấy» không, độ dài chữ của vùng chính, phần tử đang focus.
  const pageInfo = () =>
    page.evaluate(() => {
      const main = document.querySelector("main") || document.body;
      const text = (main.innerText || "").replace(/\s+/g, " ").trim();
      const el = document.activeElement;
      return {
        h1: Array.from(document.querySelectorAll("h1"))
          .map((h) => h.innerText.trim())
          .filter(Boolean),
        notFound: /không tìm thấy|not found|404/i.test(text),
        mainTextLength: text.length,
        mainHead: text.slice(0, 160),
        focus: el ? el.getAttribute("data-testid") || el.tagName : null,
      };
    });
  const tasksShown = () =>
    page.evaluate((titles) => {
      const groups = Array.from(document.querySelectorAll("[data-testid^='my-tasks-group-']"))
        .filter((s) => s.tagName === "SECTION")
        .map((s) => ({
          group: s.getAttribute("data-group"),
          count: (
            s.querySelector(
              `[data-testid='my-tasks-group-count-${s.getAttribute("data-group")}']`,
            ) || {}
          ).textContent,
        }));
      const body = document.body.innerText;
      return { groups, titlesVisible: titles.filter((t) => body.includes(t)) };
    }, TASK_TITLES);
  const openDashboard = async () => {
    await page.goto(`${APP}/dashboard`);
    await page.getByText("Nộp báo cáo tuần").first().waitFor({ timeout: 20000 });
    await settle();
  };
  const footerLabels = (labels) =>
    page.evaluate(
      (ls) =>
        Array.from(document.querySelectorAll("button, a"))
          .map((b) => b.innerText.trim())
          .filter((t) => ls.includes(t)),
      labels,
    );

  // Cookie CSRF đặt bằng init script (page.context().addCookies làm rơi kết nối MCP ở máy đo).
  await page.addInitScript(() => {
    document.cookie = "mediaos_csrf=csrf-smoke; path=/";
  });
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.clock.setFixedTime(new Date(NOW));
  await setState({ resetLog: true, reset: true, qa: "new", overview: "three", att: "reject" });

  async function run(name, fn) {
    if (!PARTS.includes(name)) return;
    try {
      await fn();
    } catch (e) {
      result.errors.push(`${name}: ${String(e.message).split("\n")[0]}`);
      await shot(`${name}-error.png`);
    }
  }

  // ── D/L · bấm TỪNG nút nhanh trên dashboard (payload mới · payload cũ) ───────────────────────
  async function clickEach(part, qa, labels) {
    await setState({ qa, phase: `${part}-open`, reset: true });
    await openDashboard();
    result[part].labelsOnDashboard = await footerLabels(labels);
    await shot(`${part}-dashboard.png`, { fullPage: true });
    result[part].targets = [];
    for (const [i, label] of labels.entries()) {
      await setState({ phase: `${part}-${i}` });
      await openDashboard();
      const btn = page.getByRole("button", { name: label, exact: true }).first();
      if (!(await btn.count())) {
        result[part].targets.push({ label, present: false });
        continue;
      }
      await btn.click();
      await settle();
      const url = where();
      const info = await pageInfo();
      const shown = url.startsWith("/tasks/my-tasks") ? await tasksShown() : undefined;
      await shot(`${part}-${i}.png`);
      const requests = (await logOf(`${part}-${i}`))
        .filter((r) => !r.path.startsWith("/dashboard") && !r.path.startsWith("/auth"))
        .map((r) => `${r.method} ${r.path}${r.query || ""} → ${r.status}`);
      await page.goBack();
      await page.waitForTimeout(400);
      result[part].targets.push({ label, url, ...info, shown, requests, backTo: where() });
    }
  }
  await run("D", () => clickEach("D", "new", LABELS_NEW));
  await run("L", () => clickEach("L", "legacy", LABELS_LEGACY));

  // ── M · /me: badge «Quá hạn» = 3 · «Hôm nay» = 1 ⇒ mở đúng nhóm ─────────────────────────────
  const openMe = async () => {
    await page.goto(`${APP}/me`);
    await page
      .getByText(/quá hạn/i)
      .first()
      .waitFor({ timeout: 20000 });
    await settle();
  };
  const badgeInfo = () =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll("[data-testid^='me-task-']")).map((b) => ({
        testId: b.getAttribute("data-testid"),
        tag: b.tagName,
        text: b.innerText.trim(),
      })),
    );
  await run("M", async () => {
    await setState({ overview: "three", phase: "M" });
    await openMe();
    result.M.badges = await badgeInfo();
    await shot("M-me.png");
    for (const g of ["overdue", "today"]) {
      await openMe();
      await page.getByTestId(`me-task-${g}-link`).click();
      await settle();
      result.M[g] = { url: where(), ...(await pageInfo()), shown: await tasksShown() };
      await shot(`M-${g}.png`);
      await page.goBack();
      await page.waitForTimeout(400);
      result.M[g].backTo = where();
    }
  });

  // ── MZ · /me: badge 0 không bấm được ───────────────────────────────────────────────────────
  await run("MZ", async () => {
    await setState({ overview: "zero", phase: "MZ" });
    await openMe();
    result.MZ.badges = await badgeInfo();
    result.MZ.badgeTexts = await page.evaluate(() =>
      Array.from(document.querySelectorAll("div.flex.flex-wrap.gap-1\\.5 > *"))
        .map((b) => `${b.tagName}:${b.innerText.trim()}`)
        .filter((t) => /việc|quá hạn|hôm nay/i.test(t)),
    );
    const zero = page.getByText(/0 .*quá hạn|quá hạn.*0/i).first();
    const before = where();
    if (await zero.count()) {
      await zero.click();
      await page.waitForTimeout(500);
    }
    result.MZ.clickZeroOverdue = { before, after: where() };
    await shot("MZ-me.png");
    await setState({ overview: "three" });
  });

  // ── AR/AS · Check-in trên widget: server từ chối · server nhận (trễ 1500 ms) ──────────────────
  const attPanel = () =>
    page.evaluate(() => {
      const btnIn = document.querySelector("[data-testid='btn-check-in']");
      const btnOut = document.querySelector("[data-testid='btn-check-out']");
      const card = (btnIn || btnOut || document.body).closest("[class*='flex h-full flex-col']");
      const alert = card && card.querySelector("[role='alert']");
      return {
        checkIn: btnIn ? { disabled: btnIn.disabled, text: btnIn.innerText.trim() } : null,
        checkOut: btnOut ? { disabled: btnOut.disabled, text: btnOut.innerText.trim() } : null,
        alert: alert ? alert.innerText.trim() : null,
        cardText: card ? card.innerText.replace(/\s+/g, " ").trim().slice(0, 260) : null,
        // Thông báo NGOÀI widget (toast của showApiErrorToast) — đếm riêng với dòng lỗi trong widget.
        toasts: Array.from(
          document.querySelectorAll("[data-sonner-toast], [role='alert'], [role='status']"),
        )
          .filter((t) => !card || !card.contains(t))
          .map((t) => t.innerText.replace(/\s+/g, " ").trim())
          .filter(Boolean),
      };
    });
  async function checkInFlow(part, mode) {
    await setState({ qa: "new", att: mode, attDelayMs: 1500, reset: true, phase: `${part}-open` });
    await openDashboard();
    await page.getByTestId("btn-check-in").waitFor({ timeout: 15000 });
    result[part].before = await attPanel();
    await shot(`${part}-0-before.png`);
    await setState({ phase: part });
    const resp = page.waitForResponse((r) => r.url().includes("/attendance/check-in"), {
      timeout: 10000,
    });
    const clickedAt = Date.now();
    await page.getByTestId("btn-check-in").click();
    await page.waitForTimeout(400);
    result[part].during = { msAfterClick: Date.now() - clickedAt, ...(await attPanel()) };
    await shot(`${part}-1-during.png`);
    const r = await resp;
    result[part].response = { status: r.status(), msAfterClick: Date.now() - clickedAt };
    await settle();
    result[part].after = await attPanel();
    await shot(`${part}-2-after.png`);
    const log = await logOf(part);
    const ci = log.find((x) => x.path === "/attendance/check-in");
    result[part].requests = log.map(
      (x) =>
        `${x.method} ${x.path}${x.query || ""} → ${x.status} @${ci ? x.at - ci.at : "?"}ms` +
        (x === ci ? ` (trả sau ${x.repliedAt - x.at}ms)` : ""),
    );
    result[part].checkInBody = ci ? ci.body : null;
  }
  await run("AR", () => checkInFlow("AR", "reject"));
  await run("AS", () => checkInFlow("AS", "ok"));

  // ── ASB · sau check-in thành công (nối AS): rời dashboard bằng nút nhanh rồi Quay lại trong SPA ⇒ các widget
  // chỉ bị đánh dấu cũ lúc check-in có tải lại ở lần mount kế không (bản vá: refetchType none) ───────────────────
  await run("ASB", async () => {
    if (!PARTS.includes("AS")) throw new Error("ASB cần chạy ngay sau AS");
    await setState({ phase: "ASB" });
    await page.getByRole("button", { name: "Xem tất cả thông báo", exact: true }).first().click();
    await settle();
    result.ASB.away = where();
    await page.goBack();
    await page.getByTestId("btn-check-out").waitFor({ timeout: 15000 });
    await settle();
    result.ASB.backTo = where();
    result.ASB.panel = await attPanel();
    result.ASB.requests = (await logOf("ASB"))
      .filter((r) => r.path.startsWith("/dashboard") || r.path.startsWith("/attendance"))
      .map((r) => `${r.method} ${r.path}${r.query || ""} → ${r.status}`);
    await shot("ASB-back.png");
  });

  // ── layout · 390 px: dashboard có nút chấm công + nút nhanh ────────────────────────────────────
  await run("layout", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await setState({ att: "reject", reset: true, qa: "new", phase: "layout" });
    await openDashboard();
    result.layout.dashboard = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    const b = await page.getByTestId("btn-check-in").boundingBox();
    result.layout.checkInBox = b && { x: Math.round(b.x), right: Math.round(b.x + b.width) };
    await shot("layout-390.png", { fullPage: true });
    await page.setViewportSize({ width: 1366, height: 900 });
  });

  result.unmocked = (await getLog()).unmocked;
  return result;
};
