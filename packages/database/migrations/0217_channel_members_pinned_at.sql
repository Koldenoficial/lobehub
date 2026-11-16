ALTER TABLE "channel_members" ADD COLUMN IF NOT EXISTS "pinned_at" timestamp with time zone;
