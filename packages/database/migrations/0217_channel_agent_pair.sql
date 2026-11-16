ALTER TABLE "channel_messages" DROP CONSTRAINT IF EXISTS "channel_messages_agent_sender_check";--> statement-breakpoint
ALTER TABLE "channel_members" ADD COLUMN IF NOT EXISTS "pinned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN IF NOT EXISTS "agent_pair_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "channels_agent_pair_unique" ON "channels" USING btree ("agent_pair_key","user_id",coalesce("workspace_id", '')) WHERE "channels"."agent_pair_key" IS NOT NULL;
