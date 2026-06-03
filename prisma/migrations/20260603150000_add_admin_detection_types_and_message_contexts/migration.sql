ALTER TYPE public.detection_type ADD VALUE IF NOT EXISTS 'admin_case';
ALTER TYPE public.detection_type ADD VALUE IF NOT EXISTS 'admin_flag';
ALTER TYPE public.detection_type ADD VALUE IF NOT EXISTS 'role_intake';

CREATE TABLE IF NOT EXISTS public.message_contexts (
  id uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
  server_id text NOT NULL,
  user_id text NOT NULL,
  message_id text NOT NULL,
  channel_id text,
  content_preview text NOT NULL,
  content_features jsonb DEFAULT '{}',
  created_at timestamptz(6) NOT NULL,
  observed_at timestamptz(6) NOT NULL DEFAULT now(),
  expires_at timestamptz(6) NOT NULL,
  CONSTRAINT message_contexts_pkey PRIMARY KEY (id)
);

CREATE UNIQUE INDEX IF NOT EXISTS message_contexts_server_message_key
  ON public.message_contexts(server_id, message_id);
CREATE INDEX IF NOT EXISTS idx_message_contexts_expires_at
  ON public.message_contexts(expires_at);
CREATE INDEX IF NOT EXISTS idx_message_contexts_server_user_created_at
  ON public.message_contexts(server_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_message_contexts_server_created_at
  ON public.message_contexts(server_id, created_at DESC);

ALTER TABLE public.message_contexts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.message_contexts FROM anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public.message_contexts FROM authenticated;
  END IF;
END $$;
