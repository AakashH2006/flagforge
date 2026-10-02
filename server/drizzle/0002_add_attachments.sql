CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"challenge_id" uuid NOT NULL,
	"filename" varchar(200) NOT NULL,
	"storage_key" varchar(64) NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_challenge_fk" FOREIGN KEY ("challenge_id","event_id") REFERENCES "public"."challenges"("id","event_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attachments_storage_key_idx" ON "attachments" USING btree ("storage_key");--> statement-breakpoint
CREATE UNIQUE INDEX "attachments_challenge_filename_lower_idx" ON "attachments" USING btree ("challenge_id",lower("filename"));--> statement-breakpoint
CREATE INDEX "attachments_challenge_idx" ON "attachments" USING btree ("challenge_id");