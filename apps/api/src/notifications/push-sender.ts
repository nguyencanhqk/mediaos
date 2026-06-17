import { Logger } from "@nestjs/common";

/** Payload for a push notification. */
export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/** Seam for sending push notifications. Concrete impls never affect notification creation outcome. */
export interface PushSender {
  send(token: string, payload: PushPayload): Promise<void>;
}

export const PUSH_SENDER = Symbol("PUSH_SENDER");

/**
 * LogPushSender — NOOP implementation (G15-2, FCM send deferred).
 * Logs at INFO with token length only (NEVER logs token value). NEVER throws.
 */
export class LogPushSender implements PushSender {
  private readonly logger = new Logger(LogPushSender.name);

  async send(token: string, payload: PushPayload): Promise<void> {
    try {
      // DEFER: replace with real FCM send when Firebase creds available.
      this.logger.log(
        `[PUSH NOOP] title="${payload.title}" body="${payload.body}" tokenLength=${token.length}`,
      );
    } catch (err: unknown) {
      // Best-effort: log failure, never propagate.
      this.logger.error("[PUSH NOOP] Unexpected error in LogPushSender", err);
    }
  }
}
