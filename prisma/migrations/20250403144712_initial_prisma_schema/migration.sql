-- CreateEnum
CREATE TYPE "admin_action_type" AS ENUM ('verify', 'reject', 'ban', 'reopen', 'create_thread');

-- CreateEnum
CREATE TYPE "detection_type" AS ENUM ('message_frequency', 'suspicious_content', 'gpt_analysis', 'new_account', 'pattern_match');

-- CreateEnum
CREATE TYPE "verification_status" AS ENUM ('pending', 'verified', 'banned');

-- CreateTable
CREATE TABLE "admin_actions" (
    "id" UUID NOT NULL DEFAULT extensions.uuid_generate_v4(),
    "server_id" TEXT,
    "user_id" TEXT,
    "admin_id" TEXT NOT NULL,
    "verification_event_id" UUID,
    "detection_event_id" UUID,
    "action_type" "admin_action_type" NOT NULL,
    "action_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "previous_status" "verification_status",
    "new_status" "verification_status",
    "notes" TEXT,
    "metadata" JSONB DEFAULT '{}',

    CONSTRAINT "admin_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "detection_events" (
    "id" UUID NOT NULL DEFAULT extensions.uuid_generate_v4(),
    "server_id" TEXT,
    "user_id" TEXT,
    "detection_type" "detection_type" NOT NULL,
    "confidence" REAL NOT NULL,
    "detected_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "message_id" TEXT,
    "channel_id" TEXT,
    "thread_id" TEXT,
    "reasons" TEXT[],
    "metadata" JSONB DEFAULT '{}',
    "admin_action" TEXT,
    "admin_action_by" TEXT,
    "admin_action_at" TIMESTAMPTZ(6),
    "latest_verification_event_id" UUID,

    CONSTRAINT "detection_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "server_members" (
    "server_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "join_date" TIMESTAMPTZ(6),
    "reputation_score" REAL DEFAULT 0.0,
    "is_restricted" BOOLEAN DEFAULT false,
    "last_verified_at" TIMESTAMPTZ(6),
    "last_message_at" TIMESTAMPTZ(6),
    "message_count" INTEGER DEFAULT 0,
    "verification_status" "verification_status" DEFAULT 'pending',
    "last_status_change" TIMESTAMPTZ(6),
    "created_by" TEXT,
    "updated_by" TEXT,

    CONSTRAINT "server_members_pkey" PRIMARY KEY ("server_id","user_id")
);

-- CreateTable
CREATE TABLE "servers" (
    "guild_id" TEXT NOT NULL,
    "restricted_role_id" TEXT,
    "admin_channel_id" TEXT,
    "verification_channel_id" TEXT,
    "admin_notification_role_id" TEXT,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_by" TEXT,
    "settings" JSONB DEFAULT '{}',
    "is_active" BOOLEAN DEFAULT true,

    CONSTRAINT "servers_pkey" PRIMARY KEY ("guild_id")
);

-- CreateTable
CREATE TABLE "users" (
    "discord_id" TEXT NOT NULL,
    "username" TEXT,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_by" TEXT,
    "global_reputation_score" REAL,
    "suspicious_server_count" INTEGER DEFAULT 0,
    "first_flagged_at" TIMESTAMPTZ(6),
    "account_created_at" TIMESTAMPTZ(6),
    "metadata" JSONB DEFAULT '{}',

    CONSTRAINT "users_pkey" PRIMARY KEY ("discord_id")
);

-- CreateTable
CREATE TABLE "verification_events" (
    "id" UUID NOT NULL DEFAULT extensions.uuid_generate_v4(),
    "server_id" TEXT,
    "user_id" TEXT,
    "detection_event_id" UUID,
    "thread_id" TEXT,
    "notification_message_id" TEXT,
    "status" "verification_status" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(6),
    "resolved_by" TEXT,
    "notes" TEXT,
    "metadata" JSONB DEFAULT '{}',

    CONSTRAINT "verification_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_admin_actions_admin" ON "admin_actions"("admin_id");

-- CreateIndex
CREATE INDEX "idx_admin_actions_detection" ON "admin_actions"("detection_event_id");

-- CreateIndex
CREATE INDEX "idx_admin_actions_server" ON "admin_actions"("server_id");

-- CreateIndex
CREATE INDEX "idx_admin_actions_user" ON "admin_actions"("user_id");

-- CreateIndex
CREATE INDEX "idx_admin_actions_verification" ON "admin_actions"("verification_event_id");

-- CreateIndex
CREATE INDEX "idx_detection_events_detected_at" ON "detection_events"("detected_at");

-- CreateIndex
CREATE INDEX "idx_detection_events_detected_at_range" ON "detection_events" USING BRIN ("detected_at");

-- CreateIndex
CREATE INDEX "idx_detection_events_server" ON "detection_events"("server_id");

-- CreateIndex
CREATE INDEX "idx_detection_events_type" ON "detection_events"("detection_type");

-- CreateIndex
CREATE INDEX "idx_detection_events_user" ON "detection_events"("user_id");

-- CreateIndex
CREATE INDEX "idx_detection_events_user_server_type" ON "detection_events"("user_id", "server_id", "detection_type");

-- CreateIndex
CREATE INDEX "idx_server_members_server" ON "server_members"("server_id");

-- CreateIndex
CREATE INDEX "idx_server_members_user" ON "server_members"("user_id");

-- CreateIndex
CREATE INDEX "idx_server_members_user_server_status" ON "server_members"("user_id", "server_id", "is_restricted");

-- CreateIndex
CREATE INDEX "idx_verification_events_created_at_range" ON "verification_events" USING BRIN ("created_at");

-- CreateIndex
CREATE INDEX "idx_verification_events_detection" ON "verification_events"("detection_event_id");

-- CreateIndex
CREATE INDEX "idx_verification_events_server" ON "verification_events"("server_id");

-- CreateIndex
CREATE INDEX "idx_verification_events_status" ON "verification_events"("status");

-- CreateIndex
CREATE INDEX "idx_verification_events_user" ON "verification_events"("user_id");

-- CreateIndex
CREATE INDEX "idx_verification_events_user_server_status" ON "verification_events"("user_id", "server_id", "status");

-- AddForeignKey
ALTER TABLE "admin_actions" ADD CONSTRAINT "admin_actions_detection_event_id_fkey" FOREIGN KEY ("detection_event_id") REFERENCES "detection_events"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "admin_actions" ADD CONSTRAINT "admin_actions_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "servers"("guild_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "admin_actions" ADD CONSTRAINT "admin_actions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("discord_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "admin_actions" ADD CONSTRAINT "admin_actions_verification_event_id_fkey" FOREIGN KEY ("verification_event_id") REFERENCES "verification_events"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "detection_events" ADD CONSTRAINT "detection_events_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "servers"("guild_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "detection_events" ADD CONSTRAINT "detection_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("discord_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "detection_events" ADD CONSTRAINT "fk_detection_events_verification" FOREIGN KEY ("latest_verification_event_id") REFERENCES "verification_events"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "server_members" ADD CONSTRAINT "server_members_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "servers"("guild_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "server_members" ADD CONSTRAINT "server_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("discord_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "verification_events" ADD CONSTRAINT "verification_events_detection_event_id_fkey" FOREIGN KEY ("detection_event_id") REFERENCES "detection_events"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "verification_events" ADD CONSTRAINT "verification_events_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "servers"("guild_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "verification_events" ADD CONSTRAINT "verification_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("discord_id") ON DELETE CASCADE ON UPDATE NO ACTION;
