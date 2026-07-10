/**
 * S4-NOTI-BE-2 (unit) — NotificationRendererService.render (logic thuần, rẻ-tiền).
 * Bổ sung theo yêu cầu QA vòng nghiệm thu (coverage ≥80% dedupe/renderer/errors, testing.md unit+integration).
 */
import { describe, expect, it } from "vitest";
import { NotificationRendererService } from "./notification-renderer.service";

function makeService(): NotificationRendererService {
  return new NotificationRendererService();
}

describe("NotificationRendererService.render — CÓ template", () => {
  it("interpolate {var} từ payload cho title/body/shortBody/targetUrl", () => {
    const svc = makeService();
    const result = svc.render(
      { eventName: "Task assigned", description: "desc" },
      {
        titleTemplate: "Task {task_code} assigned",
        bodyTemplate: "{actor_name} assigned you {task_code}",
        shortBodyTemplate: "{task_code}",
        targetUrlTemplate: "/tasks/{task_id}",
      },
      { task_code: "T-100", actor_name: "Alice", task_id: "42" },
    );

    expect(result).toEqual({
      title: "Task T-100 assigned",
      body: "Alice assigned you T-100",
      shortBody: "T-100",
      targetUrl: "/tasks/42",
      fallback: false,
    });
  });

  it("biến thiếu trong payload → GIỮ NGUYÊN placeholder (non-fatal, không nuốt)", () => {
    const svc = makeService();
    const result = svc.render(
      { eventName: "Task assigned", description: "desc" },
      {
        titleTemplate: "Task {task_code} assigned",
        bodyTemplate: "{actor_name} assigned you {task_code}",
        shortBodyTemplate: null,
        targetUrlTemplate: null,
      },
      { task_code: "T-100" }, // actor_name thiếu
    );

    expect(result.title).toBe("Task T-100 assigned");
    expect(result.body).toBe("{actor_name} assigned you T-100");
    expect(result.fallback).toBe(false);
  });

  it("biến null trong payload → cũng GIỮ NGUYÊN placeholder (không stringify 'null')", () => {
    const svc = makeService();
    const result = svc.render(
      { eventName: "Task assigned", description: "desc" },
      {
        titleTemplate: "Hello {actor_name}",
        bodyTemplate: "body {actor_name}",
        shortBodyTemplate: null,
        targetUrlTemplate: null,
      },
      { actor_name: null },
    );

    expect(result.title).toBe("Hello {actor_name}");
  });

  it("shortBodyTemplate = null → shortBody = null (KHÔNG cố interpolate)", () => {
    const svc = makeService();
    const result = svc.render(
      { eventName: "Task assigned", description: "desc" },
      {
        titleTemplate: "Task {task_code}",
        bodyTemplate: "Body {task_code}",
        shortBodyTemplate: null,
        targetUrlTemplate: null,
      },
      { task_code: "T-1" },
    );

    expect(result.shortBody).toBeNull();
    expect(result.targetUrl).toBeNull();
    expect(result.fallback).toBe(false);
  });
});

describe("NotificationRendererService.render — KHÔNG template → fallback", () => {
  it("title=eventName, body=description (khi có description), fallback=true, targetUrl=null", () => {
    const svc = makeService();
    const result = svc.render(
      { eventName: "Task assigned", description: "Bạn được giao 1 công việc mới" },
      undefined,
      { task_code: "T-1" },
    );

    expect(result).toEqual({
      title: "Task assigned",
      body: "Bạn được giao 1 công việc mới",
      shortBody: null,
      targetUrl: null,
      fallback: true,
    });
  });

  it("description=null → body fallback về eventName", () => {
    const svc = makeService();
    const result = svc.render({ eventName: "Task assigned", description: null }, undefined, {});

    expect(result.title).toBe("Task assigned");
    expect(result.body).toBe("Task assigned");
    expect(result.fallback).toBe(true);
    expect(result.targetUrl).toBeNull();
    expect(result.shortBody).toBeNull();
  });
});
