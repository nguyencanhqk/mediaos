// S20-CHAT-UNREAD-1 — dựng fixture đúng shape contracts (dist/cjs của cây đang đo) rồi parse; in JSON ra stdout.
// Chạy (cùng thư mục): node gen-fixtures.cjs > fixtures.json
const ROOT = require("node:path").resolve(__dirname, "../../../..");
const C = require(ROOT + "/packages/contracts/dist/cjs/index.js");
const CO = "11111111-1111-4111-8111-111111111111";
const DEPT = "22222222-2222-4222-8222-222222222222";
const ME = "44444444-4444-4444-8444-444444444444";
const ME_EMP = "33333333-3333-4333-8333-333333333333";
const P = "88888888-8888-4888-8888-888888888881"; // Lê Bình
const Q = "88888888-8888-4888-8888-888888888882"; // Phạm Chi
const U = "99999999-9999-4999-8999-999999999911"; // «Kinh doanh» — 25 tin chưa đọc (KPI #3)
const Z = "99999999-9999-4999-8999-999999999912"; // «Hành chính» — 0 tin chưa đọc
const M = "99999999-9999-4999-8999-999999999913"; // «Kỹ thuật» — 0 chưa đọc, nhận tin realtime giả lập
const t0 = "2026-10-25T01:00:00.000Z";
const names = { [ME]: "Trần Tôi", [P]: "Lê Bình", [Q]: "Phạm Chi" };
const at = (seq) => new Date(Date.parse(t0) + seq * 60000).toISOString();
const LINES = [
  "Mình cập nhật số liệu tuần này nhé",
  "Báo giá khách A đã gửi, chờ phản hồi",
  "Chiều nay họp lúc 3 giờ, mọi người nhớ mang laptop",
  "Bản kế hoạch quý mới đã có trên ổ chung, ai rảnh xem giúp phần ngân sách",
  "Ok",
  "Mình sẽ gọi lại khách B trước 5 giờ",
];
const bodyOf = (roomKey, seq) => `${roomKey} #${seq} — ${LINES[seq % LINES.length]}`;
const msgId = (roomTag, seq) => `bbbbbbbb-${roomTag}-4000-8000-${String(seq).padStart(12, "0")}`;
const msg = (roomId, roomTag, roomKey, seq, schema = C.chatMessageSchema) =>
  schema.parse({
    id: msgId(roomTag, seq),
    companyId: CO,
    roomId,
    senderId: seq % 3 === 0 ? Q : P,
    senderName: names[seq % 3 === 0 ? Q : P],
    body: bodyOf(roomKey, seq),
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
    createdAt: at(seq),
  });
const range = (n) => Array.from({ length: n }, (_, i) => i + 1);
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
const last = (roomKey, seq) => ({
  senderId: seq % 3 === 0 ? Q : P,
  senderName: names[seq % 3 === 0 ? Q : P],
  kind: "text",
  excerpt: bodyOf(roomKey, seq),
  attachmentCount: 0,
});
const SPEC = {
  [U]: { tag: "0011", key: "KD", name: "Kinh doanh", total: 125, unread: 25 },
  [Z]: { tag: "0012", key: "HC", name: "Hành chính", total: 40, unread: 0 },
  [M]: { tag: "0013", key: "KT", name: "Kỹ thuật", total: 60, unread: 0 },
};
const rooms = {};
const messages = {};
const details = {};
for (const [id, s] of Object.entries(SPEC)) {
  rooms[id] = room(id, {
    name: s.name,
    lastMessageSeq: s.total,
    lastMessageAt: at(s.total),
    unreadCount: s.unread,
    lastMessage: last(s.key, s.total),
  });
  messages[id] = range(s.total).map((seq) => msg(id, s.tag, s.key, seq));
  const members = [ME, P, Q].map((userId, i) =>
    C.chatRoomMemberSchema.parse({
      id: `${id.slice(0, 24)}${userId.slice(-12)}`,
      roomId: id,
      userId,
      role: i === 0 ? "admin" : "member",
      joinedAt: t0,
      userName: names[userId],
      lastReadSeq: userId === ME ? s.total - s.unread : s.total,
      avatarUrl: null,
      isOnline: false,
      leftAt: null,
    }),
  );
  details[id] = C.chatRoomDetailSchema.parse({
    ...rooms[id],
    members,
    myRole: "admin",
    createdByName: names[ME],
  });
}
// Tin «realtime» — cùng shape `chat:message` (wsChatMessageEventSchema), trình duyệt bơm vào store như handler WS.
const live = {
  [M]: [61, 62, 63].map((seq) => msg(M, "0013", "KT", seq, C.wsChatMessageEventSchema)),
  [U]: [126].map((seq) => msg(U, "0011", "KD", seq, C.wsChatMessageEventSchema)),
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
const meFull = C.meResponseSchema.parse({
  id: ME,
  companyId: CO,
  email: "toi@example.test",
  fullName: names[ME],
  status: "active",
  capabilities: Object.fromEntries(caps.map((k) => [k, true])),
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
  scopes: Object.fromEntries(caps.map((k) => [k, ["Company"]])),
  modules: [
    { code: "TASK", name: "Công việc" },
    { code: "CHAT", name: "Tin nhắn" },
    { code: "NOTI", name: "Thông báo" },
  ],
});
const out = {
  ids: { CO, ME, P, Q, U, Z, M },
  names,
  rooms,
  details,
  messages,
  live,
  meFull,
  dropdown: C.myNotificationDropdownResponseSchema.parse({ unread_count: 0, items: [] }),
  notiUnread: C.myNotificationUnreadCountResponseSchema.parse({
    unread_count: 0,
    high_priority_unread_count: 0,
    urgent_unread_count: 0,
    last_notification_at: null,
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
// Kiểm chéo ngay lúc sinh: mốc KPI #3 = lastMessageSeq − unreadCount + 1 = 101.
const u = rooms[U];
if (u.lastMessageSeq - u.unreadCount + 1 !== 101) throw new Error("fixture U lệch mốc 101");
process.stdout.write(JSON.stringify(out));
