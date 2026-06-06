-- Migration 0015: G5-1a — mở rộng bảng companies với cấu hình công ty.
-- Zod: working_days_json = { days: number[] (0-6) }; payroll_config_json = { cutoffDay: 1-31, payDay: 1-31 }

ALTER TABLE companies
  ADD COLUMN logo_url            TEXT,
  ADD COLUMN timezone            TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  ADD COLUMN currency            TEXT NOT NULL DEFAULT 'VND',
  ADD COLUMN language            TEXT NOT NULL DEFAULT 'vi',
  ADD COLUMN working_days_json   JSONB NOT NULL DEFAULT '{"days":[1,2,3,4,5]}',
  ADD COLUMN payroll_config_json JSONB NOT NULL DEFAULT '{"cutoffDay":25,"payDay":5}',
  ADD COLUMN schema_version      INT  NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE companies
  ADD CONSTRAINT companies_language_check CHECK (language IN ('vi', 'en')),
  ADD CONSTRAINT companies_currency_check CHECK (currency IN ('VND', 'USD'));
