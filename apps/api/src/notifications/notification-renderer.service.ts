import { Injectable } from "@nestjs/common";
import { PLACEHOLDER_RE } from "./notification-engine.errors";

/** Field engine cần từ event để render fallback khi thiếu template. */
export interface RenderEvent {
  eventName: string;
  description: string | null;
}

/** Field engine cần từ template (nếu có). */
export interface RenderTemplate {
  titleTemplate: string;
  bodyTemplate: string;
  shortBodyTemplate: string | null;
  targetUrlTemplate: string | null;
}

export interface RenderedNotification {
  title: string;
  body: string;
  shortBody: string | null;
  targetUrl: string | null;
  /** true = template thiếu/inactive → dùng fallback (engine ghi metadata.reason='template_fallback', loud). */
  fallback: boolean;
}

/**
 * S4-NOTI-BE-2 (L2-engine) — render template → title/body/target_url; thiếu/inactive template → FALLBACK
 * NON-SILENT (fallback=true, plan §6.3). Interpolate `{var}` từ payload; biến thiếu ⇒ GIỮ nguyên placeholder
 * (không fatal — non-silent, không nuốt). CỐ Ý KHÔNG validate target_url ở đây (engine validate loud → 422
 * để reject cả request thay vì strip im lặng — plan §3).
 */
@Injectable()
export class NotificationRendererService {
  render(
    event: RenderEvent,
    template: RenderTemplate | undefined,
    payload: Record<string, unknown>,
  ): RenderedNotification {
    if (!template) {
      // Fallback: dùng tên/ mô tả event làm nội dung, KHÔNG bịa target_url (an toàn), đánh dấu fallback.
      return {
        title: event.eventName,
        body: event.description ?? event.eventName,
        shortBody: null,
        targetUrl: null,
        fallback: true,
      };
    }
    return {
      title: this.interpolate(template.titleTemplate, payload),
      body: this.interpolate(template.bodyTemplate, payload),
      shortBody: template.shortBodyTemplate
        ? this.interpolate(template.shortBodyTemplate, payload)
        : null,
      targetUrl: template.targetUrlTemplate
        ? this.interpolate(template.targetUrlTemplate, payload)
        : null,
      fallback: false,
    };
  }

  /** Thay `{key}` bằng payload[key] (stringify). Thiếu key ⇒ giữ nguyên `{key}` (non-fatal, không nuốt). */
  private interpolate(templateText: string, payload: Record<string, unknown>): string {
    return templateText.replace(PLACEHOLDER_RE, (match, key: string) => {
      const value = payload[key];
      if (value === undefined || value === null) return match;
      return String(value);
    });
  }
}
