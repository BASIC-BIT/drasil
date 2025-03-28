-- Discord Anti-Spam Bot Seed Data
-- Initial development configuration

-- Start transaction
BEGIN;

-- Seed initial server configuration
INSERT INTO public.servers (
    guild_id,
    restricted_role_id,
    admin_channel_id,
    verification_channel_id,
    admin_notification_role_id,
    created_at,
    updated_at,
    settings,
    is_active
) VALUES (
    '1249723747896918109',
    '1354218905937121402',
    '1278730769572958238',
    '1355206974630793227',
    '1278730769572958238',
    '2025-03-28 18:48:25.629+00',
    '2025-03-28 18:48:52.983+00',
    '{
        "auto_restrict": true,
        "use_gpt_on_join": true,
        "message_threshold": 5,
        "message_timeframe": 10,
        "suspicious_keywords": ["free nitro", "discord nitro", "claim your prize"],
        "message_retention_days": 7,
        "gpt_message_check_count": 3,
        "detection_retention_days": 30,
        "min_confidence_threshold": 70
    }'::jsonb,
    true
) ON CONFLICT (guild_id) DO UPDATE 
    SET restricted_role_id = EXCLUDED.restricted_role_id,
        admin_channel_id = EXCLUDED.admin_channel_id,
        verification_channel_id = EXCLUDED.verification_channel_id,
        admin_notification_role_id = EXCLUDED.admin_notification_role_id,
        settings = EXCLUDED.settings,
        is_active = EXCLUDED.is_active;

-- Commit transaction
COMMIT;
