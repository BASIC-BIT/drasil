ALTER TYPE "captcha_provider" ADD VALUE 'discord_image';
ALTER TABLE "captcha_challenges" ADD COLUMN "method_revision" integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT "captcha_challenges_method_revision_nonnegative" CHECK (method_revision >= 0);
ALTER TABLE "captcha_challenge_requests"
  ADD COLUMN "provider" "captcha_provider" NOT NULL DEFAULT 'turnstile',
  ADD COLUMN "method_revision" integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT "captcha_requests_method_revision_nonnegative" CHECK (method_revision >= 0);

CREATE TABLE "captcha_challenge_images" (
  "captcha_challenge_id" uuid NOT NULL,
  "generation" integer NOT NULL,
  "png" bytea NOT NULL,
  "answer_digest" bytea NOT NULL,
  "key_version" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "captcha_challenge_images_pkey" PRIMARY KEY ("captcha_challenge_id", "generation"),
  CONSTRAINT "captcha_images_challenge_fkey" FOREIGN KEY ("captcha_challenge_id") REFERENCES "captcha_challenges"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "captcha_images_generation_positive" CHECK (generation > 0),
  CONSTRAINT "captcha_images_digest_length" CHECK (octet_length(answer_digest) = 32),
  CONSTRAINT "captcha_images_png_size" CHECK (octet_length(png) BETWEEN 33 AND 262144),
  CONSTRAINT "captcha_images_png_signature" CHECK (substring(png from 1 for 8) = decode('89504e470d0a1a0a', 'hex')),
  CONSTRAINT "captcha_images_key_version_bounded" CHECK (length(btrim(key_version)) BETWEEN 1 AND 100)
);
ALTER TABLE "public"."captcha_challenge_images" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "public"."captcha_challenge_images" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "public"."captcha_challenge_images" FROM authenticated;
  END IF;
END $$;

-- All native and web lifecycle writers share this transaction-level invariant.
-- The trigger removes private material only; application code owns state/audit/queue.
CREATE FUNCTION delete_terminal_captcha_image_material() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status <> 'pending' OR NEW.generation <> OLD.generation THEN
    DELETE FROM captcha_challenge_images WHERE captcha_challenge_id = NEW.id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER captcha_image_lifecycle_cleanup
  AFTER UPDATE OF status, generation ON captcha_challenges
  FOR EACH ROW EXECUTE FUNCTION delete_terminal_captcha_image_material();
