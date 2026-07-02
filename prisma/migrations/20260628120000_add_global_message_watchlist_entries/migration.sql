CREATE TABLE "public"."global_message_watchlist_entries" (
  "id" text PRIMARY KEY,
  "label" text NOT NULL,
  "term" text NOT NULL,
  "enabled" boolean NOT NULL DEFAULT true,
  "requires_link_or_video" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz(6) DEFAULT now(),
  "updated_at" timestamptz(6) DEFAULT now(),
  "created_by" text,
  "updated_by" text,
  CONSTRAINT "global_message_watchlist_entries_id_not_blank" CHECK (length(btrim("id")) > 0),
  CONSTRAINT "global_message_watchlist_entries_label_not_blank" CHECK (length(btrim("label")) > 0),
  CONSTRAINT "global_message_watchlist_entries_term_not_blank" CHECK (length(btrim("term")) > 0),
  CONSTRAINT "global_message_watchlist_entries_term_length" CHECK (length(btrim("term")) <= 120)
);

CREATE INDEX "idx_global_message_watchlist_entries_enabled"
  ON "public"."global_message_watchlist_entries" ("enabled");

ALTER TABLE "public"."global_message_watchlist_entries" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "public"."global_message_watchlist_entries" FROM anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "public"."global_message_watchlist_entries" FROM authenticated;
  END IF;
END $$;
