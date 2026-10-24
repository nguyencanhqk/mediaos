// S20-CHAT-DEEPLINK-1 — dựng fixture đúng shape contracts (dist/cjs của worktree s20c) rồi parse; in JSON ra stdout.
// Chạy: node S20-CHAT-DEEPLINK-1.gen-fixtures.cjs > S20-CHAT-DEEPLINK-1.fixtures.json
const ROOT = require("node:path").resolve(__dirname, "../../../..");
const C = require(ROOT + "/packages/contracts/dist/cjs/index.js");
const CO = "11111111-1111-4111-8111-111111111111";
const DEPT = "22222222-2222-4222-8222-222222222222";
const ME = "44444444-4444-4444-8444-444444444444"; // user id của tôi
const ME_EMP = "33333333-3333-4333-8333-333333333333";
const P = "88888888-8888-4888-8888-888888888881"; // Lê Bình — người nhắn riêng tôi (phòng R)
const Q = "88888888-8888-4888-8888-888888888882"; // Phạm Chi — người gửi trong nhóm G (KPI #2)
const R = "99999999-9999-4999-8999-999999999901"; // DM tôi↔Bình (đích thông báo)
const G = "99999999-9999-4999-8999-999999999902"; // nhóm «Dự án A»
const D = "99999999-9999-4999-8999-999999999903"; // DM tôi↔Chi — server tạo khi bấm «Nhắn riêng»
const X = "99999999-9999-4999-8999-9999999999ff"; // uuid hợp lệ KHÔNG có trong danh sách phòng của tôi
const N1 = "aaaaaaaa-0000-4000-8000-000000000001";
const t0 = "2026-10-24T01:00:00.000Z";
const names = { [ME]: "Trần Tôi", [P]: "Lê Bình", [Q]: "Phạm Chi" };
const room = (id, o) =>
  C.chatRoomSchema.parse({
    id,
    companyId: CO,
    refId: null,
    roomType: "group",
    name: null,
    roomCode: `CHAT-${id.slice(-4)}`,
    description: null,
    lastMessageAt: t0,
    lastMessageSeq: 1,
    isArchived: false,
    unreadCount: 0,
    createdAt: t0,
    pinnedAt: null,
    mutedUntil: null,
    markedUnreadAt: null,
    avatarUrl: null,
    lastMessage: null,
    peer: null,
    mentionUnreadCount: 0,
    ...o,
  });
const member = (roomId, userId, role = "member") =>
  C.chatRoomMemberSchema.parse({
    id: `${roomId.slice(0, 24)}${userId.slice(-12)}`,
    roomId,
    userId,
    role,
    joinedAt: t0,
    userName: names[userId],
    lastReadSeq: 0,
    avatarUrl: null,
    isOnline: false,
    leftAt: null,
  });
const msg = (id, roomId, senderId, body, seq) =>
  C.chatMessageSchema.parse({
    id,
    companyId: CO,
    roomId,
    senderId,
    senderName: names[senderId],
    body,
    messageType: "text",
    mentions: [],
    pinnedAt: null,
    pinnedBy: null,
    replyToMessageId: null,
    recalledAt: null,
    attachmentCount: 0,
    attachments: [],
    reactions: [],
    roomSeq: seq,
    createdAt: new Date(Date.parse(t0) + seq * 60000).toISOString(),
  });
const rooms = {
  [R]: room(R, {
    roomType: "direct",
    unreadCount: 1,
    lastMessageSeq: 1,
    lastMessage: {
      senderId: P,
      senderName: names[P],
      kind: "text",
      excerpt: "Anh xem giúp em báo giá nhé",
      attachmentCount: 0,
    },
    peer: { userId: P, name: names[P], avatarUrl: null, isActive: true },
  }),
  [G]: room(G, {
    roomType: "group",
    name: "Dự án A",
    lastMessageSeq: 2,
    lastMessage: {
      senderId: Q,
      senderName: names[Q],
      kind: "text",
      excerpt: "Mọi người duyệt kế hoạch tuần nhé",
      attachmentCount: 0,
    },
  }),
};
const dRoomCreated = room(D, {
  roomType: "direct",
  lastMessageAt: null,
  lastMessageSeq: 0,
  peer: null,
});
const dRoomListed = room(D, {
  roomType: "direct",
  lastMessageAt: null,
  lastMessageSeq: 0,
  peer: { userId: Q, name: names[Q], avatarUrl: null, isActive: true },
});
const members = {
  [R]: [member(R, ME, "admin"), member(R, P, "admin")],
  [G]: [member(G, ME, "admin"), member(G, P), member(G, Q)],
  [D]: [member(D, ME, "admin"), member(D, Q, "admin")],
};
const detail = (r, myRole = "admin") =>
  C.chatRoomDetailSchema.parse({ ...r, members: members[r.id], myRole, createdByName: names[ME] });
const messages = {
  [R]: [msg("bbbbbbbb-0000-4000-8000-000000000001", R, P, "Anh xem giúp em báo giá nhé", 1)],
  [G]: [
    msg("bbbbbbbb-0000-4000-8000-000000000011", G, P, "Chào cả nhóm", 1),
    msg("bbbbbbbb-0000-4000-8000-000000000012", G, Q, "Mọi người duyệt kế hoạch tuần nhé", 2),
  ],
  [D]: [],
};
const caps = [
  "access:chat",
  "view:chat-room",
  "create:chat-room",
  "send:chat-message",
  "read:task",
  "read:notification",
  "mark_read:notification",
  "mark_all_read:notification",
];
const me = (cs) =>
  C.meResponseSchema.parse({
    id: ME,
    companyId: CO,
    email: "toi@example.test",
    fullName: names[ME],
    status: "active",
    capabilities: Object.fromEntries(cs.map((k) => [k, true])),
    mustSetupTwoFactor: false,
    mustChangePassword: false,
    company: { id: CO, name: "Công ty Thử", status: "active" },
    employee: {
      id: ME_EMP,
      employeeCode: "NV01",
      fullName: names[ME],
      departmentId: DEPT,
      directManagerId: null,
      employmentStatus: "active",
    },
    roles: [{ id: "77777777-7777-4777-8777-777777777777", name: "employee" }],
    scopes: Object.fromEntries(cs.map((k) => [k, ["Company"]])),
    modules: [
      { code: "TASK", name: "Công việc" },
      { code: "CHAT", name: "Tin nhắn" },
      { code: "NOTI", name: "Thông báo" },
    ],
  });
const notiItem = C.myNotificationListItemSchema.parse({
  notification_id: N1,
  title: "Lê Bình nhắn tin cho bạn",
  short_content: "Anh xem giúp em báo giá nhé",
  notification_type: "CHAT_DIRECT_MESSAGE",
  priority: "Normal",
  status: "Unread",
  is_read: false,
  source_module: "CHAT",
  event_code: "CHAT_DIRECT_MESSAGE",
  target_module: "CHAT",
  target_type: "chat_room",
  target_id: R,
  target_url: `/chat/${R}`,
  created_at: t0,
  read_at: null,
});
const dropdown = C.myNotificationDropdownResponseSchema.parse({
  unread_count: 1,
  items: [
    {
      notification_id: N1,
      title: notiItem.title,
      short_content: notiItem.short_content,
      notification_type: "CHAT_DIRECT_MESSAGE",
      priority: "Normal",
      status: "Unread",
      is_read: false,
      target_url: `/chat/${R}`,
      created_at: t0,
    },
  ],
});
const out = {
  ids: { CO, ME, P, Q, R, G, D, X, N1 },
  names,
  rooms,
  dRoomCreated,
  dRoomListed,
  details: { [R]: detail(rooms[R]), [G]: detail(rooms[G]), [D]: detail(dRoomListed) },
  messages,
  meFull: me(caps),
  meNoCreate: me(caps.filter((c) => c !== "create:chat-room")),
  notiList: [notiItem],
  dropdown,
  notiUnread: C.myNotificationUnreadCountResponseSchema.parse({
    unread_count: 1,
    high_priority_unread_count: 0,
    urgent_unread_count: 0,
    last_notification_at: t0,
  }),
  markRead: C.myNotificationMarkReadResponseSchema.parse({
    notification_id: N1,
    status: "Read",
    read_at: t0,
  }),
  prefs: C.mePreferencesSchema.parse({
    locale: "vi",
    timezone: "Asia/Ho_Chi_Minh",
    theme: "light",
    dateFormat: null,
    timeFormat: null,
    defaultLanding: null,
    density: null,
    favoriteModules: null,
    meLayoutConfig: null,
    showBirthday: null,
    updatedAt: null,
  }),
  refresh: C.authRefreshResponseSchema.parse({
    accessToken: ["fake", "access", "smoke"].join("-"),
    expiresIn: 900,
  }),
};
process.stdout.write(JSON.stringify(out));
