import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { OrgChart, flattenOrgTree } from "@/components/org-chart";
import { orgApi } from "@/lib/org-api";

export function DepartmentsPage() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const {
    data: departments = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["org", "departments"],
    queryFn: orgApi.listDepartments,
  });

  const { data: tree = [] } = useQuery({
    queryKey: ["org", "tree"],
    queryFn: orgApi.getOrgTree,
  });

  const { data: users = [] } = useQuery({
    queryKey: ["org", "user-picker"],
    queryFn: orgApi.listEmployees,
  });

  const chartUnits = useMemo(() => flattenOrgTree(tree), [tree]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["org", "departments"] });
    void qc.invalidateQueries({ queryKey: ["org", "tree"] });
  };

  const create = useMutation({
    mutationFn: () =>
      orgApi.createDepartment({ name, type: "department", code: code.trim() || undefined }),
    onSuccess: () => {
      invalidate();
      setName("");
      setCode("");
    },
  });

  const update = useMutation({
    mutationFn: (vars: { id: string; patch: Parameters<typeof orgApi.updateOrgUnit>[1] }) =>
      orgApi.updateOrgUnit(vars.id, vars.patch),
    onSuccess: invalidate,
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-8">
      <h1 className="text-2xl font-semibold">Phòng ban</h1>

      <div className="flex gap-2">
        <Input
          placeholder="Tên phòng ban…"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="max-w-xs"
        />
        <Input
          placeholder="Mã (tuỳ chọn)"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="max-w-[120px]"
        />
        <Button onClick={() => create.mutate()} disabled={!name.trim() || create.isPending}>
          Thêm
        </Button>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Sơ đồ tổ chức</h2>
        <OrgChart units={chartUnits} onSelectNode={setSelectedId} />
      </section>

      {isLoading && <p className="text-sm text-muted-foreground">Đang tải…</p>}
      {isError && <p className="text-sm text-destructive">Không tải được dữ liệu.</p>}

      {departments.length === 0 && !isLoading && (
        <p className="text-sm text-muted-foreground">Chưa có phòng ban nào.</p>
      )}

      <ul className="divide-y divide-border rounded-xl border border-border">
        {departments.map((d) => {
          const nextStatus = d.status === "active" ? "inactive" : "active";
          return (
            <li
              key={d.id}
              className={`flex items-center justify-between gap-3 px-4 py-3 text-sm ${
                selectedId === d.id ? "bg-muted/60" : ""
              }`}
            >
              <div className="min-w-0">
                <span className="font-medium">{d.name}</span>
                {d.code && (
                  <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                    {d.code}
                  </span>
                )}
                <span className="ml-2 text-xs text-muted-foreground capitalize">{d.type}</span>
              </div>

              <div className="flex items-center gap-2">
                <Select
                  aria-label={`Trưởng phòng của ${d.name}`}
                  value={d.headUserId ?? ""}
                  onChange={(e) =>
                    update.mutate({ id: d.id, patch: { headUserId: e.target.value || null } })
                  }
                  disabled={update.isPending}
                  className="h-8 max-w-[180px] text-xs"
                >
                  <option value="">— Chưa có trưởng phòng —</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.fullName ?? u.email}
                    </option>
                  ))}
                </Select>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => update.mutate({ id: d.id, patch: { status: nextStatus } })}
                  disabled={update.isPending}
                  className={d.status === "active" ? "text-green-600" : "text-muted-foreground"}
                >
                  {d.status === "active" ? "Đang bật" : "Đang tắt"}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
