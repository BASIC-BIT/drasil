import { injectable, inject } from 'inversify';
import { PostHog } from 'posthog-node';
import { IConfigService } from '../config/ConfigService';
import { TYPES } from '../di/symbols';
import { hashIdentifier } from '../observability/hash';
import {
  DEFAULT_ANALYTICS_CONSENT_LEVEL,
  getAnalyticsSettings,
  AnalyticsConsentLevel,
} from '../utils/analyticsSettings';

const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com';
const MAX_PROPERTY_STRING_LENGTH = 500;
const DEFAULT_PRODUCT_ANALYTICS_ENVIRONMENT = 'development';

type AnalyticsPrimitive = string | number | boolean | null;
export type ProductAnalyticsProperties = Record<
  string,
  AnalyticsPrimitive | readonly AnalyticsPrimitive[] | undefined
>;

export interface ProductAnalyticsIdentifiers {
  moderatorId?: string;
  reporterId?: string;
  sourceGuildId?: string;
  detectionEventId?: string;
  verificationEventId?: string;
}

export interface ProductAnalyticsRuntimeStatus {
  configured: boolean;
  host?: string;
  environment?: string;
  reason?: string;
}

interface PostHogCaptureClient {
  capture(input: {
    distinctId: string;
    event: string;
    properties?: Record<string, unknown>;
    groups?: Record<string, string>;
  }): void;
  shutdown(): Promise<void>;
  on?(event: 'error', callback: (error: Error) => void): void;
  debug?(): void;
}

interface ProductAnalyticsCaptureInput {
  consentLevel: AnalyticsConsentLevel;
  guildId: string;
  userId?: string;
  event: string;
  properties?: ProductAnalyticsProperties;
  identifiers?: ProductAnalyticsIdentifiers;
}

export interface ProductAnalyticsPayload {
  distinctId: string;
  event: string;
  properties: Record<string, unknown>;
  groups: Record<string, string>;
}

export interface IProductAnalyticsService {
  getStatus(): ProductAnalyticsRuntimeStatus;
  captureGuildEvent(
    guildId: string,
    event: string,
    properties?: ProductAnalyticsProperties,
    identifiers?: ProductAnalyticsIdentifiers
  ): Promise<void>;
  captureUserEvent(
    guildId: string,
    userId: string,
    event: string,
    properties?: ProductAnalyticsProperties,
    identifiers?: ProductAnalyticsIdentifiers
  ): Promise<void>;
  shutdown(): Promise<void>;
}

export const NOOP_PRODUCT_ANALYTICS_SERVICE: IProductAnalyticsService = {
  getStatus: () => ({ configured: false, reason: 'not bound' }),
  captureGuildEvent: async () => undefined,
  captureUserEvent: async () => undefined,
  shutdown: async () => undefined,
};

function readProjectToken(): string | undefined {
  for (const token of [process.env.POSTHOG_PROJECT_API_KEY, process.env.POSTHOG_API_KEY]) {
    const trimmedToken = token?.trim();
    if (trimmedToken) {
      return trimmedToken;
    }
  }

  return undefined;
}

function sanitizePropertyValue(value: ProductAnalyticsProperties[string]): unknown {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === 'string') {
    return value.slice(0, MAX_PROPERTY_STRING_LENGTH);
  }

  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return value;
  }

  return value.map((item) =>
    typeof item === 'string' ? item.slice(0, MAX_PROPERTY_STRING_LENGTH) : item
  );
}

function sanitizeProperties(properties: ProductAnalyticsProperties = {}): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(properties)) {
    const sanitizedValue = sanitizePropertyValue(value);
    if (sanitizedValue !== undefined) {
      sanitized[key] = sanitizedValue;
    }
  }

  return sanitized;
}

function readProductAnalyticsEnvironment(): string {
  return (
    process.env.POSTHOG_PRODUCT_ANALYTICS_ENVIRONMENT?.trim() ||
    process.env.POSTHOG_ENVIRONMENT?.trim() ||
    process.env.NODE_ENV?.trim() ||
    DEFAULT_PRODUCT_ANALYTICS_ENVIRONMENT
  ).slice(0, MAX_PROPERTY_STRING_LENGTH);
}

function addIdentifierProperties(
  properties: Record<string, unknown>,
  identifiers: Record<string, string | undefined>,
  consentLevel: AnalyticsConsentLevel
): void {
  for (const [key, value] of Object.entries(identifiers)) {
    if (!value) {
      continue;
    }

    properties[`${key}_hash`] = hashIdentifier(value);
    if (consentLevel === 'full') {
      properties[key] = value;
    }
  }
}

export function buildProductAnalyticsPayload(
  input: ProductAnalyticsCaptureInput
): ProductAnalyticsPayload | null {
  if (input.consentLevel === 'off') {
    return null;
  }

  const guildIdHash = hashIdentifier(input.guildId);
  const userIdHash = input.userId ? hashIdentifier(input.userId) : undefined;
  const distinctId = input.userId
    ? input.consentLevel === 'full'
      ? `discord_user:${input.userId}`
      : `drasil_user:${userIdHash}`
    : input.consentLevel === 'full'
      ? `discord_guild:${input.guildId}`
      : `drasil_guild:${guildIdHash}`;

  const properties: Record<string, unknown> = {
    ...sanitizeProperties(input.properties),
    app: 'drasil',
    node_env: process.env.NODE_ENV ?? 'development',
    analytics_environment: readProductAnalyticsEnvironment(),
    analytics_consent_level: input.consentLevel,
    guild_id_hash: guildIdHash,
    $process_person_profile: false,
  };

  if (userIdHash) {
    properties.user_id_hash = userIdHash;
  }

  addIdentifierProperties(
    properties,
    {
      moderator_id: input.identifiers?.moderatorId,
      reporter_id: input.identifiers?.reporterId,
      source_guild_id: input.identifiers?.sourceGuildId,
      detection_event_id: input.identifiers?.detectionEventId,
      verification_event_id: input.identifiers?.verificationEventId,
    },
    input.consentLevel
  );

  if (input.consentLevel === 'full') {
    properties.guild_id = input.guildId;
    if (input.userId) {
      properties.user_id = input.userId;
    }
  }

  return {
    distinctId,
    event: input.event,
    properties,
    groups: {
      guild: input.consentLevel === 'full' ? input.guildId : `drasil_guild:${guildIdHash}`,
    },
  };
}

@injectable()
export class ProductAnalyticsService implements IProductAnalyticsService {
  private readonly configService: IConfigService;
  private readonly client: PostHogCaptureClient | null;
  private readonly status: ProductAnalyticsRuntimeStatus;

  constructor(@inject(TYPES.ConfigService) configService: IConfigService) {
    this.configService = configService;

    if (process.env.POSTHOG_PRODUCT_ANALYTICS_ENABLED === 'false') {
      this.client = null;
      this.status = { configured: false, reason: 'disabled by POSTHOG_PRODUCT_ANALYTICS_ENABLED' };
      return;
    }

    const projectToken = readProjectToken();
    if (!projectToken) {
      this.client = null;
      this.status = { configured: false, reason: 'POSTHOG_PROJECT_API_KEY not set' };
      return;
    }

    const host = process.env.POSTHOG_HOST?.trim() || DEFAULT_POSTHOG_HOST;
    const environment = readProductAnalyticsEnvironment();
    this.client = new PostHog(projectToken, {
      host,
      disableGeoip: true,
    });
    this.client.on?.('error', (error) => {
      console.warn('[posthog] analytics client error:', error);
    });
    if (process.env.POSTHOG_DEBUG === 'true') {
      this.client.debug?.();
    }
    this.status = { configured: true, host, environment };
  }

  public getStatus(): ProductAnalyticsRuntimeStatus {
    return { ...this.status };
  }

  public async captureGuildEvent(
    guildId: string,
    event: string,
    properties?: ProductAnalyticsProperties,
    identifiers?: ProductAnalyticsIdentifiers
  ): Promise<void> {
    await this.captureEvent({ guildId, event, properties, identifiers });
  }

  public async captureUserEvent(
    guildId: string,
    userId: string,
    event: string,
    properties?: ProductAnalyticsProperties,
    identifiers?: ProductAnalyticsIdentifiers
  ): Promise<void> {
    await this.captureEvent({ guildId, userId, event, properties, identifiers });
  }

  public async shutdown(): Promise<void> {
    if (!this.client) {
      return;
    }

    await this.client.shutdown();
  }

  private async captureEvent(
    input: Omit<ProductAnalyticsCaptureInput, 'consentLevel'>
  ): Promise<void> {
    if (!this.client) {
      return;
    }

    try {
      const consentLevel = this.resolveCachedConsentLevel(input.guildId);
      if (!consentLevel) {
        if (process.env.POSTHOG_DEBUG === 'true') {
          console.debug('[posthog] skipping event; guild config not cached', {
            event: input.event,
            guild_id_hash: hashIdentifier(input.guildId),
          });
        }
        return;
      }

      const payload = buildProductAnalyticsPayload({
        ...input,
        consentLevel,
      });
      if (!payload) {
        return;
      }

      this.client.capture(payload);
    } catch (error) {
      console.warn(`[posthog] failed to capture ${input.event}:`, error);
    }
  }

  private resolveCachedConsentLevel(guildId: string): AnalyticsConsentLevel | null {
    const cachedConfig = this.configService.getCachedServerConfig(guildId);
    if (!cachedConfig) {
      return process.env.DATABASE_URL ? null : DEFAULT_ANALYTICS_CONSENT_LEVEL;
    }

    return getAnalyticsSettings(cachedConfig.settings).consentLevel;
  }
}
