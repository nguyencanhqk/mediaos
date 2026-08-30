import { Injectable, OnModuleInit } from "@nestjs/common";
import type { EventContext } from "../events/event-bus";
import { DatabaseService } from "../db/db.service";
import { OutboxNotificationBridge } from "./outbox-notification-bridge.service";
import { RoomAudienceReader } from "./room-audience.reader";

const SOURCE_MODULE_ROOM = "ROOM";
const SOURCE_ENTITY_BOOKING = "room_booking";

/** Biến template 0555 + neo — KHÔNG forward khoá lạ (whitelist, mirror ASSET). */
const PAYLOAD_KEYS = [
  "bookingId",
  "actorUserId",
  "organizer_name",
  "actor_name",
  "room_name",
  "title",
  "time_range",
  "booking_id",
] as const;

function strField(payload: Record<string, unknown>, key: string): string | undefined {
  const v = payload[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/**
 * Khoá NEO/biến template thiếu ⇒ NÉM (gate silent-failure ASSET H1/H2): `undefined` là nhánh nuốt câm —
 * `dedupeKeyOf` undefined ⇒ fallback `ctx.eventId` ⇒ dedupe biến mất; template giữ `{placeholder}`. Ném ⇒
 * OutboxWorker retry → dead-letter (kêu to).
 */
function requireField(payload: Record<string, unknown>, key: string): string {
  const v = strField(payload, key);
  if (!v) {
    throw new Error(
      `RoomNotiBridgeRegistrar: payload outbox thiếu khoá bắt buộc '${key}' — hợp đồng room-noti.payload.ts lệch.`,
    );
  }
  return v;
}

const COMMON_TEMPLATE_KEYS = ["room_name", "title", "time_range", "booking_id"] as const;

interface RoomMapping {
  eventType: string;
  eventCode: string;
  /** Biến template riêng của event (organizer_name · actor_name). */
  ownKey: "organizer_name" | "actor_name";
}

const MAPPINGS: readonly RoomMapping[] = [
  {
    eventType: "room.booking.confirmed",
    eventCode: "ROOM_BOOKING_CONFIRMED",
    ownKey: "organizer_name",
  },
  {
    eventType: "room.booking.cancelled",
    eventCode: "ROOM_BOOKING_CANCELLED",
    ownKey: "actor_name",
  },
];

/**
 * S11-ROOM-BE-1 — RoomNotiBridgeRegistrar: 2 mapping ROOM → NOTI (SPEC-14 §17) lên `OutboxNotificationBridge`
 * ĐÃ SHIP, tại boot (mirror `AssetNotiBridgeRegistrar`). KHÔNG import `RoomsModule`.
 *
 *   room.booking.confirmed → ROOM_BOOKING_CONFIRMED · room.booking.cancelled → ROOM_BOOKING_CANCELLED
 *   người nhận = organizer ∪ attendees của lượt; engine loại `payload.actorUserId` (is_system_event=false).
 *
 * ⚠️ `dedupeKeyOf` BẮT BUỘC: catalog 0555 `dedupe_strategy='DedupeKey'`, `registerSource()` để OPTIONAL với fallback
 * `ctx.eventId` (LUÔN khác) ⇒ quên = dedupe câm lặng. Khoá thật = `${eventCode}:${bookingId}` (once-ever theo lượt).
 * `eventCode` VERBATIM khớp catalog (`registerSource` fail-loud tại boot nếu chưa enabled).
 */
@Injectable()
export class RoomNotiBridgeRegistrar implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly reader: RoomAudienceReader,
    private readonly bridge: OutboxNotificationBridge,
  ) {}

  onModuleInit(): void {
    for (const m of MAPPINGS) this.register(m);
  }

  private async participantsOf(ctx: EventContext): Promise<string[]> {
    const bookingId = requireField(ctx.payload, "bookingId");
    return this.db.withTenant(ctx.companyId, (tx) =>
      this.reader.participantsOfBooking(tx, ctx.companyId, bookingId),
    );
  }

  private register(m: RoomMapping): void {
    this.bridge.registerSource({
      eventType: m.eventType,
      eventCode: m.eventCode,
      sourceModule: SOURCE_MODULE_ROOM,
      sourceEntityType: SOURCE_ENTITY_BOOKING,
      sourceEntityIdOf: (ctx) => requireField(ctx.payload, "bookingId"),
      resolveRecipients: (ctx) => this.participantsOf(ctx),
      dedupeKeyOf: (ctx) => requireField(ctx.payload, "bookingId"),
      payloadOf: (ctx) => {
        for (const k of COMMON_TEMPLATE_KEYS) requireField(ctx.payload, k);
        requireField(ctx.payload, m.ownKey);
        return Object.fromEntries(
          PAYLOAD_KEYS.filter((k) => k in ctx.payload).map((k) => [k, ctx.payload[k]]),
        );
      },
    });
  }
}
