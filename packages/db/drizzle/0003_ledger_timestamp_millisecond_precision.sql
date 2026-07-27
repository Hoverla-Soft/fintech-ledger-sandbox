ALTER TABLE "ledger_account" ALTER COLUMN "created_at" SET DATA TYPE timestamp (3);--> statement-breakpoint
ALTER TABLE "ledger_account" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "ledger_audit_entry" ALTER COLUMN "created_at" SET DATA TYPE timestamp (3);--> statement-breakpoint
ALTER TABLE "ledger_audit_entry" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "ledger_idempotency_key" ALTER COLUMN "created_at" SET DATA TYPE timestamp (3);--> statement-breakpoint
ALTER TABLE "ledger_idempotency_key" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "ledger_posting" ALTER COLUMN "created_at" SET DATA TYPE timestamp (3);--> statement-breakpoint
ALTER TABLE "ledger_posting" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "ledger_transaction" ALTER COLUMN "created_at" SET DATA TYPE timestamp (3);--> statement-breakpoint
ALTER TABLE "ledger_transaction" ALTER COLUMN "created_at" SET DEFAULT now();