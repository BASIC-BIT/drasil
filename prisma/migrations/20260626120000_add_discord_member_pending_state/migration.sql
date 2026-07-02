ALTER TYPE "moderation_queue_item_type" ADD VALUE 'pending_screening_member';

ALTER TABLE "server_members"
  ADD COLUMN "discord_member_pending" boolean NOT NULL DEFAULT false,
  ADD COLUMN "discord_member_pending_since" timestamp(6) with time zone,
  ADD COLUMN "discord_member_pending_cleared_at" timestamp(6) with time zone,
  ADD COLUMN "discord_member_pending_last_checked_at" timestamp(6) with time zone,
  ADD COLUMN "discord_member_pending_digest_sent_at" timestamp(6) with time zone;

CREATE INDEX "idx_server_members_discord_pending"
  ON "server_members" ("server_id", "discord_member_pending", "discord_member_pending_since");
