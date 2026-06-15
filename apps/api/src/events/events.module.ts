import { Global, Module } from "@nestjs/common";
import { ALERT_SINK, LoggerAlertSink } from "./alert.service";
import { AuditService } from "./audit.service";
import { DeadLetterAlertMonitor } from "./dead-letter-alert.service";
import { EventBus } from "./event-bus";
import { OutboxService } from "./outbox.service";
import { OutboxWorker } from "./outbox-worker";

/**
 * EventsModule — nền audit + transactional outbox + event bus (ADR-0009). PHẢI có TRƯỚC mọi module
 * nghiệp vụ (CLAUDE §3). ALERT_SINK mặc định = LoggerAlertSink; prod override bằng kênh noti thật.
 */
@Global()
@Module({
  providers: [
    AuditService,
    DeadLetterAlertMonitor,
    OutboxService,
    EventBus,
    OutboxWorker,
    LoggerAlertSink,
    { provide: ALERT_SINK, useExisting: LoggerAlertSink },
  ],
  exports: [AuditService, DeadLetterAlertMonitor, OutboxService, EventBus, OutboxWorker],
})
export class EventsModule {}
