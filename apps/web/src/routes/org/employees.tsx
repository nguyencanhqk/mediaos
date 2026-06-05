import { useQuery } from "@tanstack/react-query";
import { orgApi } from "@/lib/org-api";

export function EmployeesPage() {
  const { data: employees = [], isLoading, isError } = useQuery({
    queryKey: ["org", "employees"],
    queryFn: orgApi.listEmployees,
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-8">
      <h1 className="text-2xl font-semibold">Nhân sự</h1>

      {isLoading && <p className="text-sm text-muted-foreground">Đang tải…</p>}
      {isError && <p className="text-sm text-destructive">Không tải được dữ liệu.</p>}

      {employees.length === 0 && !isLoading && (
        <p className="text-sm text-muted-foreground">Chưa có nhân sự nào.</p>
      )}

      <ul className="divide-y divide-border rounded-xl border border-border">
        {employees.map((e) => (
          <li key={e.id} className="space-y-1 px-4 py-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{e.fullName ?? e.email}</span>
              <span
                className={`text-xs ${
                  e.status === "active" ? "text-green-600" : "text-muted-foreground"
                }`}
              >
                {e.status}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">{e.email}</p>
            {e.teams.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1">
                {e.teams.map((t) => (
                  <span
                    key={t.teamId}
                    className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                  >
                    {t.teamName} · {t.roleName}
                  </span>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
