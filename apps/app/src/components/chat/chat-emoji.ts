/**
 * S17-CHAT-UX2-FE-3 — bộ emoji **TĨNH** của ô soạn (SPEC-15 §22c **CHAT-DEC-027**).
 *
 * ⚠️ KHÔNG thêm dependency để có bộ này. `emoji-mart` & họ hàng kéo theo một **bảng dữ liệu vài trăm
 * KB** cho một tính năng chèn ký tự — đúng lớp phình bundle mà `console-had-zero-code-splitting` đã
 * trả giá một lần. `pnpm-lock.yaml` KHÔNG được đổi vì WO này.
 *
 * File này chỉ được nạp qua `import()` ĐỘNG từ `composer/EmojiPicker.tsx`: người dùng không mở bảng
 * emoji thì 122 ký tự + nhãn tiếng Việt không nằm trong chunk khởi động của `/chat`.
 *
 * ⚠️ KHÁC HẲN bộ 6 emoji thả cảm xúc (`CHAT_REACTION_EMOJIS`, CHAT-DEC-018): bộ kia là **tập đóng có
 * ràng buộc ở DB** (`chk_chat_reactions_emoji`), thêm một ký tự vào đó là 500 lúc chạy. Bộ này thuần
 * hiển thị — nó chỉ chèn ký tự Unicode vào `body`, không có CHECK nào canh. Đừng gộp hai bộ.
 */

export interface EmojiGroup {
  /** Khoá i18n dưới `chat:composer.emoji.groups.*`. */
  key: string;
  emojis: readonly string[];
}

export const EMOJI_GROUPS: readonly EmojiGroup[] = [
  {
    key: "smileys",
    emojis: [
      "😀",
      "😃",
      "😄",
      "😁",
      "😆",
      "😅",
      "😂",
      "🤣",
      "🙂",
      "🙃",
      "😉",
      "😊",
      "😇",
      "🥰",
      "😍",
      "😘",
      "😋",
      "😜",
      "🤪",
      "🤗",
      "🤔",
      "🤨",
      "😐",
      "😴",
      "😪",
      "😌",
      "😢",
      "😭",
      "😤",
      "😡",
    ],
  },
  {
    key: "gestures",
    emojis: [
      "👍",
      "👎",
      "👌",
      "🤌",
      "✌️",
      "🤝",
      "👏",
      "🙌",
      "👋",
      "🤙",
      "💪",
      "🙏",
      "✍️",
      "👀",
      "🫡",
      "🤞",
      "☝️",
      "👉",
      "👈",
      "👆",
      "👇",
      "✊",
      "🤛",
      "🖐️",
    ],
  },
  {
    key: "hearts",
    emojis: [
      "❤️",
      "🧡",
      "💛",
      "💚",
      "💙",
      "💜",
      "🖤",
      "🤍",
      "💔",
      "❣️",
      "💯",
      "✅",
      "❌",
      "⭕",
      "❗",
      "❓",
      "⚠️",
      "🔥",
      "✨",
      "⭐",
      "🎉",
      "🎊",
    ],
  },
  {
    key: "work",
    emojis: [
      "📌",
      "📎",
      "📁",
      "📂",
      "📅",
      "📆",
      "🗓️",
      "📊",
      "📈",
      "📉",
      "📝",
      "✏️",
      "📋",
      "📖",
      "💼",
      "💻",
      "🖥️",
      "📱",
      "☎️",
      "📧",
      "🔔",
      "🔒",
      "🔑",
      "⏰",
    ],
  },
  {
    key: "misc",
    emojis: [
      "☕",
      "🍵",
      "🍺",
      "🍰",
      "🎂",
      "🍕",
      "🍜",
      "🍚",
      "🍎",
      "🍇",
      "🚀",
      "🎯",
      "🏆",
      "🥇",
      "🎁",
      "🌟",
      "🌈",
      "☀️",
      "🌙",
      "⚡",
      "🍀",
      "🌸",
    ],
  },
] as const;

/** Tổng số emoji — dùng cho test canh "bộ vẫn ~120, không ai lỡ tay xoá nửa nhóm". */
export const EMOJI_COUNT = EMOJI_GROUPS.reduce((n, g) => n + g.emojis.length, 0);
