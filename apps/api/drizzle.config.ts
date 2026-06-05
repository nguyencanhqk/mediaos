import { defineConfig } from "drizzle-kit";

// drizzle-kit generate (offline, từ schema) + migrate (runtime qua DATABASE_DIRECT_URL).
// Bảng nghiệp vụ thêm từ G2-3; G1 chỉ có migration baseline tạo extensions.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./migrations",
  strict: true,
  verbose: true,
  dbCredentials: {
    // Chỉ dùng cho push/introspect — generate không cần kết nối.
    url: process.env.DATABASE_DIRECT_URL ?? "postgres://localhost:5432/mediaos",
  },
});
