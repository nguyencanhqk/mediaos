/**
 * Doc thoi diem hen tu file import.
 * Chap nhan nhieu dinh dang vi nguoi dung Viet Nam thuong go DD/MM/YYYY,
 * trong khi Excel lai xuat ra ISO hoac doi tuong Date.
 */

const PATTERNS: { regex: RegExp; order: ("d" | "m" | "y")[] }[] = [
  // 2026-08-10 09:00  hoac  2026/08/10 09:00
  { regex: /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/, order: ["y", "m", "d"] },
  // 10/08/2026 09:00  hoac  10-08-2026 09:00
  { regex: /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:[ T](\d{1,2}):(\d{2}))?/, order: ["d", "m", "y"] },
];

/** Tra ve unix seconds theo mui gio cua may, hoac null neu khong doc duoc. */
export function parseScheduleValue(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : Math.floor(value.getTime() / 1000);
  }

  const text = String(value).trim();
  if (!text) return null;

  for (const { regex, order } of PATTERNS) {
    const match = regex.exec(text);
    if (!match) continue;

    const parts = { y: 0, m: 0, d: 0 };
    order.forEach((key, index) => {
      parts[key] = Number(match[index + 1]);
    });

    const hour = match[4] === undefined ? 0 : Number(match[4]);
    const minute = match[5] === undefined ? 0 : Number(match[5]);
    const date = new Date(parts.y, parts.m - 1, parts.d, hour, minute, 0, 0);

    if (Number.isNaN(date.getTime())) return null;
    // Chan gia tri vo ly kieu 31/02.
    if (date.getMonth() !== parts.m - 1 || date.getDate() !== parts.d) return null;
    return Math.floor(date.getTime() / 1000);
  }

  const fallback = new Date(text);
  return Number.isNaN(fallback.getTime()) ? null : Math.floor(fallback.getTime() / 1000);
}
