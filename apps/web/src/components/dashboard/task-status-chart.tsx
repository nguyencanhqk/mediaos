import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

interface StatusRow {
  status: string;
  count: number;
}

interface TaskStatusChartProps {
  data: StatusRow[];
}

const STATUS_LABEL: Record<string, string> = {
  not_started: "Chưa bắt đầu",
  in_progress: "Đang làm",
  waiting_review: "Chờ duyệt",
  revision: "Sửa lại",
  approved: "Đã duyệt",
  completed: "Hoàn thành",
};

const STATUS_COLOR: Record<string, string> = {
  not_started: "#94a3b8",
  in_progress: "#3b82f6",
  waiting_review: "#f59e0b",
  revision: "#f97316",
  approved: "#10b981",
  completed: "#6366f1",
};

/**
 * Horizontal bar chart — task count by status.
 * Shown only when caller has read:task (manager/leadership).
 */
export function TaskStatusChart({ data }: TaskStatusChartProps) {
  const chartData = data.map((r) => ({
    name: STATUS_LABEL[r.status] ?? r.status,
    count: r.count,
    color: STATUS_COLOR[r.status] ?? "#94a3b8",
  }));

  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <p className="mb-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Phân bổ task theo trạng thái
      </p>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={chartData} layout="vertical" margin={{ left: 16, right: 16 }}>
          <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
          <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={96} />
          <Tooltip
            formatter={(v: number) => [v, "Task"]}
            contentStyle={{ fontSize: 12 }}
          />
          <Bar dataKey="count" radius={[0, 4, 4, 0]}>
            {chartData.map((entry, i) => (
              <Cell key={i} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
