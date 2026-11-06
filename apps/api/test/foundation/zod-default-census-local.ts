/**
 * S19-OPS-ZOD4-1 (C3.7) — TIẾN TRÌNH CON của census default: duyệt schema export của @mediaos/contracts + nạp từng tệp schema cục bộ (web-core/app/auth/console)
 * và in JSON kết quả ra stdout. Chạy riêng (vite-node) vì nạp ~40 tệp FE (i18n, react-hook-form…) NGAY TRONG worker vitest
 * làm pool sập `ERR_IPC_CHANNEL_CLOSED` khi chạy cả thư mục `test/foundation`. Không phải spec — không có `describe`.
 */
import { pathToFileURL } from "node:url";
import * as contracts from "@mediaos/contracts";
import { defOf, localSchemaFiles, newWalk, repoRel, walkSchema } from "./zod-default-census";

async function main(): Promise<void> {
  const contractsWalk = newWalk();
  let contractSchemas = 0;
  for (const [name, v] of Object.entries(contracts)) {
    if (!defOf(v)) continue;
    contractSchemas += 1;
    walkSchema(v, `contracts:${name}`, contractsWalk);
  }
  const files = localSchemaFiles();
  const walk = newWalk();
  const failed: string[] = [];
  let schemas = 0;
  for (const f of files) {
    let mod: Record<string, unknown>;
    try {
      mod = (await import(pathToFileURL(f).href)) as Record<string, unknown>;
    } catch (e) {
      failed.push(`${f}: ${(e as Error).message}`);
      continue;
    }
    for (const [name, v] of Object.entries(mod)) {
      if (!defOf(v)) continue;
      schemas += 1;
      walkSchema(v, `${repoRel(f)}:${name}`, walk);
    }
  }
  process.stdout.write(
    `\n@@CENSUS@@${JSON.stringify({ files: files.length, schemas, failed, walk, contractSchemas, contractsWalk })}\n`,
  );
}

void main();
