CREATE TYPE "public"."ledger_account_type" AS ENUM('normal', 'external');--> statement-breakpoint
CREATE TYPE "public"."ledger_audit_outcome" AS ENUM('posted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."ledger_posting_direction" AS ENUM('debit', 'credit');--> statement-breakpoint
CREATE TABLE "ledger_account" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"currency" text NOT NULL,
	"type" "ledger_account_type" NOT NULL,
	"balance" bigint DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_account_orgId_name_unique" UNIQUE("org_id","name"),
	CONSTRAINT "ledger_account_id_orgId_unique" UNIQUE("id","org_id")
);
--> statement-breakpoint
CREATE TABLE "ledger_audit_entry" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"action" text NOT NULL,
	"outcome" "ledger_audit_outcome" NOT NULL,
	"reason" text,
	"transaction_id" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_idempotency_key" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"transaction_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_idempotency_key_orgId_key_unique" UNIQUE("org_id","key")
);
--> statement-breakpoint
CREATE TABLE "ledger_posting" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"transaction_id" text NOT NULL,
	"account_id" text NOT NULL,
	"direction" "ledger_posting_direction" NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_posting_amount_positive" CHECK ("ledger_posting"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "ledger_transaction" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"currency" text NOT NULL,
	"reverses_transaction_id" text,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_transaction_id_orgId_unique" UNIQUE("id","org_id")
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"inviter_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"metadata" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "active_organization_id" text;--> statement-breakpoint
ALTER TABLE "ledger_account" ADD CONSTRAINT "ledger_account_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_audit_entry" ADD CONSTRAINT "ledger_audit_entry_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_audit_entry" ADD CONSTRAINT "ledger_audit_entry_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_audit_entry" ADD CONSTRAINT "ledger_audit_entry_transaction_id_ledger_transaction_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."ledger_transaction"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_idempotency_key" ADD CONSTRAINT "ledger_idempotency_key_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_idempotency_key" ADD CONSTRAINT "ledger_idempotency_key_transaction_id_ledger_transaction_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."ledger_transaction"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_posting" ADD CONSTRAINT "ledger_posting_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_posting" ADD CONSTRAINT "ledger_posting_account_id_org_id_fk" FOREIGN KEY ("account_id","org_id") REFERENCES "public"."ledger_account"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_posting" ADD CONSTRAINT "ledger_posting_transaction_id_org_id_fk" FOREIGN KEY ("transaction_id","org_id") REFERENCES "public"."ledger_transaction"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_transaction" ADD CONSTRAINT "ledger_transaction_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_transaction" ADD CONSTRAINT "ledger_transaction_reverses_transaction_id_ledger_transaction_id_fk" FOREIGN KEY ("reverses_transaction_id") REFERENCES "public"."ledger_transaction"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_transaction" ADD CONSTRAINT "ledger_transaction_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_audit_entry_orgId_createdAt_idx" ON "ledger_audit_entry" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "ledger_posting_orgId_idx" ON "ledger_posting" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "ledger_posting_accountId_createdAt_idx" ON "ledger_posting" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "ledger_posting_transactionId_idx" ON "ledger_posting" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "ledger_transaction_orgId_createdAt_id_idx" ON "ledger_transaction" USING btree ("org_id","created_at","id");--> statement-breakpoint
CREATE INDEX "invitation_organizationId_idx" ON "invitation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "invitation" USING btree ("email");--> statement-breakpoint
CREATE INDEX "member_organizationId_idx" ON "member" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "member_userId_idx" ON "member" USING btree ("user_id");