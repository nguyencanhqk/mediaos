import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { positionsApi } from "@/lib/positions-api";

export function PositionsPage() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");

  const { data: positions = [], isLoading, isError } = useQuery({
    queryKey: ["org", "positions"],
    queryFn: positionsApi.listPositions,
  });

  const create = useMutation({
    mutationFn: () => positionsApi.createPosition({ name, code: code.trim() || undefined }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["org", "positions"] });
      setName("");
      setCode("");
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => positionsApi.deletePosition(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["org", "positions"] }),
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-8">
      <h1 className="text-2xl font-semibold">Chức vụ</h1>

      <div className="flex gap-2">
        <Input
          placeholder="Tên chức vụ…"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="max-w-xs"
        />
        <Input
          placeholder="Mã (tuỳ chọn)"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="max-w-[130px]"
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
      {positions.length === 0 && !isLoading && (
        <p className="text-sm text-muted-foreground">Chưa có chức vụ nào.</p>
      )}

      <ul className="divide-y divide-border rounded-xl border border-border">
        {positions.map((p) => (
          <li key={p.id} className="flex items-center justify-between px-4 py-3 text-sm">
            <div>
              <span className="font-medium">{p.name}</span>
              {p.code && (
                <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                  {p.code}
                </span>
              )}
              {p.orgUnitName && (
                <span className="ml-2 text-xs text-muted-foreground">· {p.orgUnitName}</span>
              )}
              {p.defaultRoleName && (
                <span className="ml-2 text-xs text-muted-foreground">
                  Role: {p.defaultRoleName}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <span
                className={`text-xs ${
                  p.status === "active" ? "text-green-600" : "text-muted-foreground"
                }`}
              >
                {p.status}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => remove.mutate(p.id)}
                disabled={remove.isPending}
              >
                Xoá
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
