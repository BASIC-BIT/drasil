# PostHog Product Analytics

Drasil can export product analytics events to PostHog. This is optional and safe-by-default:

- No events are sent unless `POSTHOG_PROJECT_API_KEY` or `POSTHOG_API_KEY` is configured.
- Each server defaults to `anonymous` sharing.
- Server administrators can change sharing with `/config analytics view` and `/config analytics set-level`.
- `off` sends no product analytics for that server.
- `anonymous` sends hashed Discord IDs plus non-content event properties.
- `full` may include raw Discord IDs for future cross-network verification features.
- Message content, report reasons, usernames, channel names, and server names are not sent.

## Environment

```bash
POSTHOG_PROJECT_API_KEY=phc_...
POSTHOG_HOST=https://us.i.posthog.com

# Optional kill switch. Omit or set true to enable when a token is present.
POSTHOG_PRODUCT_ANALYTICS_ENABLED=true

# Optional SDK debug logging.
POSTHOG_DEBUG=false
```

Use `OBSERVABILITY_HASH_KEY` in production if you want anonymous hashed IDs to remain stable across restarts.

## Events

Current events are intentionally narrow:

- `guild installed`
- `verification setup completed`
- `analytics consent updated`
- `detection flagged`
- `verification case opened`
- `verification case updated`
- `manual flag submitted`
- `user report submitted`
- `observed detection action completed`
- `moderation action completed`

Event properties are restricted to counts, booleans, modes, confidence buckets, detection/action types, and hashed identifiers unless the server chooses `full` sharing.
