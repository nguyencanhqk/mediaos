// S20-CHAT-UNREADNAV-1 — dựng fixture đúng shape contracts (dist/cjs của cây đang đo) rồi parse; in JSON ra stdout.
// Chạy (cùng thư mục): node gen-fixtures.cjs > fixtures.json
// Tám phòng nhóm, thứ tự hiển thị = `lastMessageAt` giảm dần (chỉ số 0 mới nhất). Hai kịch bản:
//   six   — 6 phòng chưa đọc + 2 phòng đã đọc (KPI #4 «Đọc hết», deny-path)
//   three — 3 phòng chưa đọc xen giữa phòng đã đọc (phím Alt+Shift+↓)
const ROOT = require("node:path").resolve(__dirname, "../../../..");
const C = require(ROOT + "/packages/contracts/dist/cjs/index.js");
const CO = "11111111-1111-4111-8111-111111111111";
const DEPT = "22222222-2222-4222-8222-222222222222";
const ME = "44444444-4444-4444-8444-444444444444";
const ME_EMP = "33333333-3333-4333-8333-333333333333";
const P = "88888888-8888-4888-8888-888888888881"; // Lê Bình
const Q = "88888888-8888-4888-8888-888888888882"; // Phạm Chi
const names = { [ME]: "Trần Tôi", [P]: "Lê Bình", [Q]: "Phạm Chi" };
const T_END = Date.parse("2026-10-25T03:00:00.000Z");
// key · tên · tổng tin (= lastMessageSeq) · chưa đọc theo kịch bản
const ROOMS = [
  { key: "KD", name: "Kinh doanh", total: 6, six: 4, three: 0 },
  { key: "KT", name: "Kế toán", total: 4, six: 0, three: 0 },
  { key: "KY", name: "Kỹ thuật", total: 5, six: 2, three: 2 },
  { key: "HC", name: "Hành chính", total: 6, six: 6, three: 0 },
  { key: "DA", name: "Dự án A", total: 3, six: 1, three: 1 },
  { key: "NS", name: "Nhân sự", total: 4, six: 0, three: 0 },
  { key: "DB", name: "Dự án B", total: 5, six: 3, three: 0 },
  { key: "MK", name: "Marketing", total: 6, six: 5, three: 5 },
];
const ids = {};
ROOMS.forEach((r, i) => {
  ids[r.key] = `99999999-9999-4999-8999-9999999999${String(21 + i)}`;
});
const roomLast = (i) => T_END - i * 10 * 60000;
const at = (i, total, seq) => new Date(roomLast(i) - (total - seq) * 60000).toISOString();
const LINES = [
  "Mình cập nhật số liệu tuần này nhé",
  "Báo giá khách A đã gửi, chờ phản hồi",
  "Chiều nay họp lúc 3 giờ",
  "Ok",
  "Mình sẽ gọi lại khách B trước 5 giờ",
  "Đã xong phần việc của mình",
];
const bodyOf = (key, seq) => `${key} #${seq} — ${LINES[seq % LINES.length]}`;
const sender = (seq) => (seq % 2 === 0 ? Q : P);
const msg = (i, r, seq) =>
  C.chatMessageSchema.parse({
    id: `bbbbbbbb-00${String(21 + i)}-4000-8000-${String(seq).padStart(12, "0")}`,
    companyId: CO,
    roomId: ids[r.key],
    senderId: sender(seq),
    senderName: names[sender(seq)],
    body: bodyOf(r.key, seq),
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
    createdAt: at(i, r.total, seq),
  });
const room = (i, r, unread) =>
  C.chatRoomSchema.parse({
    id: ids[r.key],
    companyId: CO,
    refId: null,
    roomType: "group",
    name: r.name,
    roomCode: `CHAT-${r.key}`,
    description: null,
    lastMessageAt: at(i, r.total, r.total),
    lastMessageSeq: r.total,
    isArchived: false,
    unreadCount: unread,
    createdAt: new Date(T_END - 86400000).toISOString(),
    pinnedAt: null,
    mutedUntil: null,
    markedUnreadAt: null,
    avatarUrl: null,
    lastMessage: {
      senderId: sender(r.total),
      senderName: names[sender(r.total)],
      kind: "text",
      excerpt: bodyOf(r.key, r.total),
      attachmentCount: 0,
    },
    peer: null,
    mentionUnreadCount: 0,
  });
const detail = (i, r, unread) =>
  C.chatRoomDetailSchema.parse({
    ...room(i, r, unread),
    members: [ME, P, Q].map((userId, k) =>
      C.chatRoomMemberSchema.parse({
        id: `${ids[r.key].slice(0, 24)}${userId.slice(-12)}`,
        roomId: ids[r.key],
        userId,
        role: k === 0 ? "admin" : "member",
        joinedAt: new Date(T_END - 86400000).toISOString(),
        userName: names[userId],
        lastReadSeq: userId === ME ? r.total - unread : r.total,
        avatarUrl: null,
        isOnline: false,
        leftAt: null,
      }),
    ),
    myRole: "admin",
    createdByName: names[ME],
  });
const scenarios = {};
for (const sc of ["six", "three"]) {
  scenarios[sc] = { rooms: {}, details: {} };
  ROOMS.forEach((r, i) => {
    scenarios[sc].rooms[ids[r.key]] = room(i, r, r[sc]);
    scenarios[sc].details[ids[r.key]] = detail(i, r, r[sc]);
  });
}
const messages = {};
ROOMS.forEach((r, i) => {
  messages[ids[r.key]] = Array.from({ length: r.total }, (_, k) => msg(i, r, k + 1));
});
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
  ids,
  rooms: ROOMS,
  scenarios,
  messages,
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
// Kiểm chéo ngay lúc sinh: kịch bản six đúng 6 phòng chưa đọc, three đúng 3.
const unreadOf = (sc) => Object.values(scenarios[sc].rooms).filter((r) => r.unreadCount > 0).length;
if (unreadOf("six") !== 6 || unreadOf("three") !== 3)
  throw new Error("fixture lệch số phòng chưa đọc");
process.stdout.write(JSON.stringify(out));
