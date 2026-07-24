/**
 * DynamicIcon — render Lucide icon theo tên string từ registry.
 *
 * Dùng lazy approach: import icons tĩnh cho các icon MVP biết trước,
 * fallback về Circle nếu tên không khớp. Tránh dynamic import() để giữ
 * tree-shaking và không gây waterfall.
 */
import {
  LayoutDashboard,
  Users,
  User,
  UserCircle,
  Clock,
  Calendar,
  CalendarDays,
  CalendarClock,
  ShieldCheck,
  Table,
  FileText,
  CheckCircle,
  CheckSquare,
  KanbanSquare,
  FolderKanban,
  Bell,
  Settings,
  Shield,
  FileClock,
  Home,
  Grid3x3,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Menu,
  X,
  Search,
  Star,
  AlertTriangle,
  Lock,
  Circle,
  KeyRound,
  Hash,
  Database,
  Network,
  History,
  ClipboardList,
  FileSearch,
  ShieldAlert,
  LogIn,
  Building2,
  SlidersHorizontal,
  File,
  GraduationCap,
  Target,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@mediaos/ui";

const ICON_MAP: Record<string, LucideIcon> = {
  "layout-dashboard": LayoutDashboard,
  users: Users,
  user: User,
  // S5-ME-FE-1 — Personal Hub app/route icon.
  "user-circle": UserCircle,
  clock: Clock,
  calendar: Calendar,
  "calendar-days": CalendarDays,
  "calendar-clock": CalendarClock,
  "shield-check": ShieldCheck,
  table: Table,
  "file-text": FileText,
  "check-circle": CheckCircle,
  "check-square": CheckSquare,
  "kanban-square": KanbanSquare,
  // S5-FE-TASK-NAV-1.
  "folder-kanban": FolderKanban,
  bell: Bell,
  settings: Settings,
  shield: Shield,
  "file-clock": FileClock,
  home: Home,
  "grid-3x3": Grid3x3,
  logout: LogOut,
  "chevron-left": ChevronLeft,
  "chevron-right": ChevronRight,
  menu: Menu,
  x: X,
  search: Search,
  star: Star,
  "alert-triangle": AlertTriangle,
  lock: Lock,
  circle: Circle,
  // S2-FE-AUTH-4 (lane FE batch C).
  "key-round": KeyRound,
  // S2-FE-FND-5 (lane FE batch C).
  hash: Hash,
  database: Database,
  network: Network,
  history: History,
  "clipboard-list": ClipboardList,
  "file-search": FileSearch,
  "shield-alert": ShieldAlert,
  "log-in": LogIn,
  "building-2": Building2,
  "sliders-horizontal": SlidersHorizontal,
  file: File,
  // Tích hợp LMS Giai đoạn A — mục "Đào tạo".
  "graduation-cap": GraduationCap,
  // S5-GOAL-FE-1 — module Mục tiêu (sidebar goal.list + APP_REGISTRY 'goals'); tránh fallback Circle.
  target: Target,
};

interface DynamicIconProps {
  name: string;
  className?: string;
  strokeWidth?: number;
}

export function DynamicIcon({ name, className, strokeWidth = 1.9 }: DynamicIconProps) {
  const Icon = ICON_MAP[name] ?? Circle;
  return <Icon className={cn("h-4 w-4", className)} strokeWidth={strokeWidth} />;
}
