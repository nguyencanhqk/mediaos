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
  Clock,
  Calendar,
  CalendarDays,
  FileText,
  CheckCircle,
  CheckSquare,
  KanbanSquare,
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
  type LucideIcon,
} from "lucide-react";
import { cn } from "@mediaos/ui";

const ICON_MAP: Record<string, LucideIcon> = {
  "layout-dashboard": LayoutDashboard,
  users: Users,
  user: User,
  clock: Clock,
  calendar: Calendar,
  "calendar-days": CalendarDays,
  "file-text": FileText,
  "check-circle": CheckCircle,
  "check-square": CheckSquare,
  "kanban-square": KanbanSquare,
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
