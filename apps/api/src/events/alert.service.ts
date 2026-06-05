import { Injectable, Logger } from "@nestjs/common";

/** Thông tin 1 dead-letter cần cảnh báo (KHÔNG đưa payload nhạy cảm vào kênh ngoài — chỉ id/loại). */
export interface DeadLetterAlert {
  deadLetterId: string;
  eventId: string;
  companyId: string;
  eventType: string;
  consumerName: string;
  error: string;
}

/**
 * Sink cảnh báo — trừu tượng để cắm kênh noti thật (Slack/email/Valkey pubsub) sau. G2-4 chốt:
 * KHÔNG để alert rỗng (rủi ro "nuốt lỗi"). Mặc định log ở mức error (luôn có 1 kênh).
 */
export interface AlertSink {
  deadLetter(alert: DeadLetterAlert): Promise<void>;
}

/** Sink mặc định: log error có cấu trúc. Luôn được wire (alert không bao giờ rỗng). */
@Injectable()
export class LoggerAlertSink implements AlertSink {
  private readonly logger = new Logger("DeadLetterAlert");

  async deadLetter(alert: DeadLetterAlert): Promise<void> {
    // Mức error → lọt mọi pipeline log/monitor. Chỉ id + loại, KHÔNG payload (tránh lộ dữ liệu).
    this.logger.error(
      `DEAD-LETTER event=${alert.eventId} type=${alert.eventType} ` +
        `consumer=${alert.consumerName} company=${alert.companyId} dl=${alert.deadLetterId}: ${alert.error}`,
    );
  }
}

/** Token DI cho sink (cho phép override bằng kênh noti thật ở môi trường prod). */
export const ALERT_SINK = Symbol("ALERT_SINK");
