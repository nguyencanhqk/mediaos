import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { orgApi } from "@/lib/org-api";

export function DepartmentsPage() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");

  const { data: departments = [], isLoading, isError } = useQuery({
    queryKey: ["org", "departments"],
    queryFn: orgApi.listDepartments,
  });

  const create = useMutation({
    mutationFn: () =>
      orgApi.createDepartment({ name, type: "department", code: code.trim() || undefined }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["org", "departments"] });
      setName("");
      setCode("");
    },
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
        <Button
          onClick={() => create.mutate()}
          disabled={!name.trim() || create.isPending}
        >
          Thêm
        </Button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Đang tải…</p>}
      {isError && <p className="text-sm text-destructive">Không tải được dữ liệu.</p>}

      {departments.length === 0 && !isLoading && (
        <p className="text-sm text-muted-foreground">Chưa có phòng ban nào.</p>
      )}

      <ul className="divide-y divide-border rounded-xl border border-border">
        {departments.map((d) => (
          <li key={d.id} className="flex items-center justify-between px-4 py-3 text-sm">
            <div>
              <span className="font-medium">{d.name}</span>
              {d.code && (
                <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                  {d.code}
                </span>
              )}
              {d.headUserName && (
                <span className="ml-2 text-xs text-muted-foreground">
                  Trưởng: {d.headUserName}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground capitalize">{d.type}</span>
              <span
                className={`text-xs ${
                  d.status === "active" ? "text-green-600" : "text-muted-foreground"
                }`}
              >
                {d.status}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
