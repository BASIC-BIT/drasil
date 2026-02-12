ALTER TABLE "public"."servers"
ADD COLUMN "heuristic_message_threshold" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN "heuristic_message_timeframe_seconds" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN "heuristic_suspicious_keywords" TEXT[] NOT NULL DEFAULT ARRAY[
  'nitro scam',
  'free discord nitro',
  'free nitro',
  'discord nitro',
  'steam gift',
  'gift card',
  'click this link',
  'claim your prize',
  'crypto giveaway',
  'airdrop',
  'free robux'
]::TEXT[];

ALTER TABLE "public"."servers"
ADD CONSTRAINT "servers_heuristic_message_threshold_check"
  CHECK ("heuristic_message_threshold" >= 1 AND "heuristic_message_threshold" <= 100),
ADD CONSTRAINT "servers_heuristic_message_timeframe_seconds_check"
  CHECK (
    "heuristic_message_timeframe_seconds" >= 1
    AND "heuristic_message_timeframe_seconds" <= 600
  ),
ADD CONSTRAINT "servers_heuristic_suspicious_keywords_len_check"
  CHECK (COALESCE(array_length("heuristic_suspicious_keywords", 1), 0) <= 200);
