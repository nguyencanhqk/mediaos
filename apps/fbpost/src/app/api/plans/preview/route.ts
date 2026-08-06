import { NextRequest } from "next/server";
import { fail, guard, ok } from "@/lib/api";
import { planConfigSchema, resolvePlan } from "@/lib/plan/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Xem truoc ma tran lich truoc khi tao that.
 * Khong ghi gi vao CSDL va khong goi Facebook.
 */
export async function POST(request: NextRequest) {
  return guard(async () => {
    const body: unknown = await request.json();
    const parsed = planConfigSchema.safeParse(body);
    if (!parsed.success) {
      return fail(parsed.error.issues.map((i) => i.message).join("; "));
    }

    const resolved = resolvePlan(parsed.data);
    return ok({ ...resolved.preview, blocked: resolved.error });
  });
}
