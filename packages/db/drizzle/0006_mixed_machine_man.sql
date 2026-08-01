CREATE TYPE "public"."ledger_pending_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "ledger_pending_transfer" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"created_by" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"currency" text NOT NULL,
	"postings" jsonb NOT NULL,
	"status" "ledger_pending_status" DEFAULT 'pending' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp (3),
	"transaction_id" text,
	"created_at" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_pending_transfer_orgId_key_unique" UNIQUE("org_id","idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "ledger_pending_transfer" ADD CONSTRAINT "ledger_pending_transfer_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_pending_transfer" ADD CONSTRAINT "ledger_pending_transfer_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_pending_transfer" ADD CONSTRAINT "ledger_pending_transfer_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_pending_transfer" ADD CONSTRAINT "ledger_pending_transfer_transaction_id_ledger_transaction_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."ledger_transaction"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_pending_transfer_orgId_status_createdAt_idx" ON "ledger_pending_transfer" USING btree ("org_id","status","created_at");