import { Injectable, OnModuleInit } from "@nestjs/common";
import type { EventContext } from "../events/event-bus";
import { DatabaseService } from "../db/db.service";
import { OutboxNotificationBridge } from "./outbox-notification-bridge.service";
import { AssetAudienceReader } from "./asset-audience.reader";

const SOURCE_MODULE_ASSET = "ASSET";
const SOURCE_ENTITY_ASSIGNMENT = "asset_assignment";

/** Biến template 0551 + neo — KHÔNG forward khoá lạ (whitelist, mirror S4-INT-5 `payloadOf`). */
const PAYLOAD_KEYS = [
  "assignmentId",
  "assetId",
  "employeeId",
  "actorUserId",
  "actor_name",
  "asset_name",
  "asset_code",
] as const;

function strField(payload: Record<string, unknown>, key: string): string | undefined {
  const v = payload[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/**
 * Khoá NEO/biến template thiếu ⇒ NÉM (gate silent-failure H1/H2): trả `undefined`/`[]` là nhánh nuốt câm —
 * recipient rỗng ⇒ engine `recordSkip("no_recipient")` không log, `dedupeKeyOf` undefined ⇒ fallback `ctx.eventId`
 * ⇒ dedupe biến mất, template giữ nguyên `{placeholder}`. Ném ⇒ OutboxWorker retry → dead-letter (kêu to),
 * đúng tiền lệ CHAT (`chat-noti-e2e` ca 14).
 */
function requireField(payload: Record<string, unknown>, key: string): string {
  const v = strField(payload, key);
  if (!v) {
    throw new Error(
      `AssetNotiBridgeRegistrar: payload outbox thiếu khoá bắt buộc '${key}' — hợp đồng asset-noti.payload.ts lệch.`,
    );
  }
  return v;
}

const TEMPLATE_KEYS = ["actor_name", "asset_name", "asset_code"] as const;

/**
 * S11-ASSET-BE-1 — AssetNotiBridgeRegistrar: 2 mapping ASSET → NOTI (SPEC-13 §17) lên `OutboxNotificationBridge`
 * ĐÃ SHIP, tại boot (mirror `GoalNotiBridgeRegistrar`). KHÔNG import `AssetsModule`.
 *
 *   asset.assigned → ASSET_ASSIGNED · asset.revoked → ASSET_REVOKED — người nhận = user của nhân viên trong lượt.
 *
 * ⚠️ `dedupeKeyOf` BẮT BUỘC (plan §0/§11 — bug-class MỚI so với GOAL): catalog 0551 chốt `dedupe_strategy=
 * 'DedupeKey'`, còn `registerSource()` để `dedupeKeyOf` OPTIONAL với fallback `ctx.eventId` (LUÔN khác nhau) ⇒
 * quên dòng này là dedupe biến mất câm lặng. Khoá thật = `${eventCode}:${assignmentId}` (once-ever theo lượt).
 *
 * `eventCode` phải VERBATIM khớp catalog (`registerSource` fail-loud tại boot nếu chưa enabled).
 */
@Injectable()
export class AssetNotiBridgeRegistrar implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly reader: AssetAudienceReader,
    private readonly bridge: OutboxNotificationBridge,
  ) {}

  onModuleInit(): void {
    this.register("asset.assigned", "ASSET_ASSIGNED");
    this.register("asset.revoked", "ASSET_REVOKED");
  }

  private async holderOf(ctx: EventContext): Promise<string[]> {
    const assignmentId = requireField(ctx.payload, "assignmentId");
    const userId = await this.db.withTenant(ctx.companyId, (tx) =>
      this.reader.holderUserIdOfAssignment(tx, ctx.companyId, assignmentId),
    );
    return userId ? [userId] : [];
  }

  private register(eventType: string, eventCode: string): void {
    this.bridge.registerSource({
      eventType,
      eventCode,
      sourceModule: SOURCE_MODULE_ASSET,
      sourceEntityType: SOURCE_ENTITY_ASSIGNMENT,
      sourceEntityIdOf: (ctx) => requireField(ctx.payload, "assignmentId"),
      resolveRecipients: (ctx) => this.holderOf(ctx),
      dedupeKeyOf: (ctx) => requireField(ctx.payload, "assignmentId"),
      payloadOf: (ctx) => {
        for (const k of TEMPLATE_KEYS) requireField(ctx.payload, k); // thiếu biến template ⇒ ném, không render `{x}`
        return Object.fromEntries(
          PAYLOAD_KEYS.filter((k) => k in ctx.payload).map((k) => [k, ctx.payload[k]]),
        );
      },
    });
  }
}
