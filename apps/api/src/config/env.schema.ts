import { z } from "zod";

/**
 * Validate biến môi trường tại biên hệ thống (coding-style: fail-fast, không tin dữ liệu ngoài).
 * DB URL để OPTIONAL → API vẫn boot khi DB chưa lên (health/db báo "down"), giúp `pnpm dev` chạy không cần docker.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().positive().default(3000),
  API_PREFIX: z.string().min(1).default("api"),
  API_VERSION: z.string().min(1).default("v1"),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  DATABASE_URL: z.string().url().optional(),
  DATABASE_DIRECT_URL: z.string().url().optional(),
  VALKEY_URL: z.string().url().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  return parsed.data;
}
