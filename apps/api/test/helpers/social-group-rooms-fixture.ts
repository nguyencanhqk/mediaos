import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import type { Pool } from "pg";
import type { Namespace } from "socket.io";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { WS_EVENTS, WS_NAMESPACE } from "@mediaos/contracts";
import { RealtimeGateway } from "../../src/realtime/realtime.gateway";
import { chatUserRoomName } from "../../src/realtime/rooms";
import {
  seedPermissionCatalog,
  seedRole,
  seedRolePermission,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "./seed";

/**
 * S16-SOCIAL-BE-2C — fixture CHUNG của hai int-spec room nhóm (plan §5, Q-SLICE (a)):
 * `social-be2c-group-rooms.int-spec.ts` (tầng MEMBERSHIP, commit A) và
 * `social-be2c-group-fanout.int-spec.ts` (tầng SỰ KIỆN, commit B).
 *
 * ┌─ KHUÔN ĐO TẤT ĐỊNH — không `settle` cố định (plan §5, vá plan-review F3) ─────────────────────┐
 * │ 1. Server handle = namespace của CHÍNH `RealtimeGateway`; membership đọc bằng                   │
 * │    `nsp.local.in(room).fetchSockets()` — `.local` để adapter Valkey ở CI không hỏi node khác.   │
 * │ 2. READINESS = socket có mặt ở `chatUserRoomName`: khối CHAT chạy TUẦN TỰ SAU khối bảng tin      │
 * │    trong `handleConnection` ⇒ có `chatuser` ⇔ khối bảng tin (kể cả lần đọc lại) đã xong. Mọi    │
 * │    actor vì thế PHẢI có `view:chat-room`.                                                       │
 * │    ⚠️ Nếu ngày sau khối bảng tin chạy SONG SONG với khối CHAT, tín hiệu này HẾT ĐÚNG — đổi nó    │
 * │    cùng lúc (plan §8 điểm dừng (c)).                                                            │
 * │ 3. Membership DƯƠNG sau một route: POLL tới khi đạt — dưới Valkey `socketsJoin/Leave` đi vòng   │
 * │    pub/sub, bất đồng bộ kể cả trên cùng instance (M23).                                          │
 * │ 4. Membership ÂM sau một route: chỉ khẳng định SAU một RÀO THỨ TỰ — một room-op dương phát SAU  │
 * │    trên cùng kênh, poll tới khi nó áp (áp theo thứ tự publish).                                  │
 * │ 5. «Nhận 0 sự kiện» luôn đi SAU một NEO DƯƠNG trên chính socket đó (sự kiện phát sau).           │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ File này KHÔNG dựng request HTTP nào (đăng nhập/gọi route ở trong từng spec): census
 * `S18-QA-SUPERTESTLISTEN-1` phân tích TỪNG FILE spec và dựa vào tiền đề «không helper dùng chung nào
 * dựng request» (`sharedRequestHelpers`).
 */

/** Cặp quyền của actor bảng tin «đủ»: đọc feed · đăng bài · tạo nhóm · đọc chat (tín hiệu readiness). */
export const FEED_MEMBER_PAIRS = [
  "view:feed",
  "create:feed-post",
  "create:feed-group",
  "view:chat-room",
] as const;

/** Actor KHÔNG có `view:feed` — chỉ `view:chat-room` để có tín hiệu readiness (plan M18: NV). */
export const NO_FEED_PAIRS = ["view:chat-room"] as const;

export interface SeededActor {
  userId: string;
  email: string;
}

/** User + hồ sơ nhân sự đang hoạt động + một vai TUỲ BIẾN chứa đúng `pairs` (KHÔNG super-admin). */
export async function seedActor(
  direct: Pool,
  tenant: SeededTenant,
  label: string,
  passwordHash: string,
  pairs: readonly string[],
  opts: { orgUnitId?: string | null } = {},
): Promise<SeededActor> {
  const email = `${label}-${randomUUID().slice(0, 8)}@${tenant.slug}.test`;
  const userId = await seedUser(direct, tenant.companyId, email, passwordHash);
  await direct.query(`UPDATE users SET full_name = $2 WHERE id = $1`, [userId, `Người ${label}`]);
  await direct.query(
    `INSERT INTO employee_profiles (company_id, user_id, org_unit_id, status, work_type, employee_code)
     VALUES ($1, $2, $3, 'active', 'offline', $4)`,
    [tenant.companyId, userId, opts.orgUnitId ?? null, `EMP-${randomUUID().slice(0, 6)}`],
  );
  const roleId = await seedRole(
    direct,
    tenant.companyId,
    `be2c-${label}-${randomUUID().slice(0, 6)}`,
  );
  for (const key of pairs) {
    const [action, resource] = key.split(":") as [string, string];
    const permId = await seedPermissionCatalog(direct, action, resource, false);
    await seedRolePermission(direct, roleId, permId, "ALLOW", "Company");
  }
  await seedUserRole(direct, userId, roleId, tenant.companyId);
  return { userId, email };
}

export async function seedOrgUnit(direct: Pool, companyId: string, name: string): Promise<string> {
  const r = await direct.query(
    `INSERT INTO org_units (company_id, name, parent_id, head_user_id, status)
     VALUES ($1, $2, NULL, NULL, 'active') RETURNING id`,
    [companyId, name],
  );
  return r.rows[0].id as string;
}

export interface GroupMemberSeed {
  userId: string;
  role: "owner" | "admin" | "member";
  status?: "active" | "pending";
}

/**
 * Nhóm gieo thẳng + `member_count` khớp số hàng `active` (đường `031` có ca riêng). Gieo SQL chứ không
 * qua route: dựng cảnh nhanh, và một số trạng thái KHÔNG dựng được qua route (actor thiếu `view:feed`
 * ở hàng `pending` — M18).
 */
export async function seedGroup(
  direct: Pool,
  companyId: string,
  visibility: "public" | "private",
  members: readonly GroupMemberSeed[],
  opts: { deleted?: boolean } = {},
): Promise<string> {
  const actives = members.filter((m) => (m.status ?? "active") === "active").length;
  const g = await direct.query(
    `INSERT INTO feed_groups (company_id, name, visibility, member_count, deleted_at)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [
      companyId,
      `be2c ${randomUUID().slice(0, 8)}`,
      visibility,
      actives,
      opts.deleted ? new Date() : null,
    ],
  );
  const groupId = g.rows[0].id as string;
  for (const m of members) {
    const status = m.status ?? "active";
    await direct.query(
      `INSERT INTO feed_group_members (company_id, group_id, user_id, role, status, joined_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [companyId, groupId, m.userId, m.role, status, status === "active" ? new Date() : null],
    );
  }
  return groupId;
}

// ─── socket ─────────────────────────────────────────────────────────────────────────────────────

/** Một socket client + mọi payload `feed:post.created` nó nhận, theo thứ tự tới. */
export interface FeedRecorder {
  socket: ClientSocket;
  posts: Record<string, unknown>[];
}

/** Namespace `/ws` của CHÍNH gateway (tiền lệ `chat-s7-call-rt1-signalling.int-spec.ts`). */
export function gatewayNamespace(app: INestApplication): Namespace {
  return (app.get(RealtimeGateway) as unknown as { server: Namespace }).server;
}

/** Socket này có đang ở room `room` không — đọc PHÍA SERVER, chỉ adapter cục bộ (M22). */
export async function isMember(nsp: Namespace, room: string, rec: FeedRecorder): Promise<boolean> {
  const sockets = await nsp.local.in(room).fetchSockets();
  return sockets.some((s) => s.id === rec.socket.id);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Poll `check` 20 ms một lần tới khi đúng; hết `timeoutMs` ⇒ NÉM kèm `what` (không bao giờ xanh im lặng). */
export async function pollUntil(
  check: () => Promise<boolean>,
  what: string,
  timeoutMs = 3000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await check()) return;
    await sleep(20);
  }
  throw new Error(`hết giờ chờ: ${what}`);
}

/** Nối `/ws` bằng client thật; resolve khi client nhận `connect` (CHƯA chắc server xong `handleConnection`). */
export async function connectFeedSocket(
  port: number,
  token: string,
  open: ClientSocket[],
): Promise<FeedRecorder> {
  const socket = ioClient(`http://127.0.0.1:${port}/${WS_NAMESPACE}`, {
    auth: { token },
    transports: ["websocket"],
    reconnection: false,
    forceNew: true,
  });
  open.push(socket);
  const posts: Record<string, unknown>[] = [];
  socket.on(WS_EVENTS.FEED_POST_CREATED, (payload: Record<string, unknown>) => posts.push(payload));
  await new Promise<void>((resolve, reject) => {
    socket.on("connect", () => resolve());
    socket.on("connect_error", reject);
  });
  return { socket, posts };
}

/**
 * Nối + chờ READINESS (socket có mặt ở `chatuser` ⇒ khối bảng tin của `handleConnection` đã xong — xem
 * docblock đầu file). Membership lúc connect đọc ngay sau đây là tất định: `client.join/leave` của
 * gateway là thao tác adapter CỤC BỘ, đồng bộ (M23).
 */
export async function connectReady(
  port: number,
  nsp: Namespace,
  token: string,
  companyId: string,
  userId: string,
  open: ClientSocket[],
): Promise<FeedRecorder> {
  const rec = await connectFeedSocket(port, token, open);
  await pollUntil(
    () => isMember(nsp, chatUserRoomName(companyId, userId), rec),
    `readiness (chatuser) của user ${userId}`,
  );
  return rec;
}

/** Số sự kiện `feed:post.created` có `id === postId` mà socket đã nhận. */
export const postCount = (rec: FeedRecorder, postId: string): number =>
  rec.posts.filter((p) => p.id === postId).length;

/** Chờ tới khi socket nhận sự kiện bài `postId`; hết giờ ⇒ NÉM kèm danh sách id đã nhận. */
export async function waitForPost(
  rec: FeedRecorder,
  postId: string,
  timeoutMs = 3000,
): Promise<Record<string, unknown>> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const hit = rec.posts.find((p) => p.id === postId);
    if (hit) return hit;
    await sleep(20);
  }
  throw new Error(
    `hết giờ chờ sự kiện ${WS_EVENTS.FEED_POST_CREATED} id=${postId}; đã nhận: ${
      rec.posts.map((p) => String(p.id)).join(",") || "(không gì)"
    }`,
  );
}
