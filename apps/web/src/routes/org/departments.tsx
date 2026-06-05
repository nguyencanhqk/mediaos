import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { orgApi } from "@/lib/org-api";

export function DepartmentsPage() {
  const qc = useQueryClient();
  const [name, setName] = useState("");

  const { data: departments = [], isLoading, isError } = useQuery({
    queryKey: ["org", "departments"],
    queryFn: orgApi.listDepartments,
  });

  const create = useMutation({
    mutationFn: () => orgApi.createDepartment({ name, type: "department" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["org", "departments"] });
      setName("");
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
            <span className="font-medium">{d.name}</span>
            <span className="text-muted-foreground capitalize">{d.type}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
