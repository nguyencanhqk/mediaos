async (page) => {
  // S20-GOAL-QUICKSTART-1 — nhóm «Đơn vị đo» ở 1366 px và 390 px: vị trí ba nút, tràn ngang, mũi tên bàn phím, vòng focus.
  // Cần mock-api + dev server như run.js. Chạy sau run.js thì đặt lại đồng hồ (phần TZ của run.js cố định 2026-09-30).
  const out = {};
  await page.clock.setFixedTime(new Date("2026-10-25T07:00:00Z")).catch(() => {});
  for (const [w, h, tag] of [
    [1366, 900, "desk"],
    [390, 844, "phone"],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto("http://localhost:5299/goals/new");
    await page.locator('input[name="name"]').waitFor({ timeout: 20000 });
    await page.waitForTimeout(600);
    await page.getByRole("group", { name: "Đơn vị đo" }).scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    await page.screenshot({ path: `.playwright-mcp/s20-kpi/QS-R2-measure-group-${tag}.png` });
    out[tag] = await page.evaluate(() => {
      const fs = [...document.querySelectorAll("fieldset")].find((f) =>
        f.querySelector('[name="measureType"]'),
      );
      const labels = [...fs.querySelectorAll("label")].map((l) => {
        const r = l.getBoundingClientRect();
        return {
          t: l.textContent.trim(),
          x: Math.round(r.x),
          y: Math.round(r.y),
          w: Math.round(r.width),
          h: Math.round(r.height),
        };
      });
      return {
        labels,
        docW: document.documentElement.scrollWidth,
        winW: window.innerWidth,
        checked: document.querySelector('[name="measureType"]:checked')?.value,
      };
    });
    await page.locator('input[name="measureType"]:checked').focus();
    await page.keyboard.press("ArrowRight");
    out[tag].afterArrow = await page.evaluate(
      () => document.querySelector('[name="measureType"]:checked')?.value,
    );
    out[tag].focusVisibleRing = await page.evaluate(() => {
      const l = document.activeElement?.closest("label");
      return l ? getComputedStyle(l).boxShadow : null;
    });
  }
  await page.setViewportSize({ width: 1366, height: 900 });
  return out;
};
