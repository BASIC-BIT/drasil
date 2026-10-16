import { IVerificationEventRepository } from '../repositories/VerificationEventRepository';
import { inject, injectable, optional } from 'inversify';
import { createHash } from 'crypto';
import { GuildMember } from 'discord.js';
import { TYPES } from '../di/symbols';
import { IDetectionEventsRepository } from '../repositories/DetectionEventsRepository';
import { IMessageContextRepository } from '../repositories/MessageContextRepository';
import { DetectionEvent, MessageContext } from '../repositories/types';
import { IGPTService, ProfileImageDescription } from './GPTService';
const PROFILE_IMAGE_HASH_MAX_BYTES = 3 * 1024 * 1024;
const PROFILE_IMAGE_HASH_TIMEOUT_MS = 5000;
export interface ProfileAssetSnapshot {
  avatar_url?: string;
  avatar_hash?: string;
  avatar_byte_sha256?: string;
  avatar_is_default?: boolean;
  avatar_decoration_url?: string;
  guild_avatar_url?: string;
  guild_avatar_hash?: string;
  banner_url?: string;
  banner_hash?: string;
  banner_byte_sha256?: string;
  accent_color?: string;
  captured_at: string;
}

export interface ModerationEvidenceSnapshot {
  captured_at: string;
  profile_assets: ProfileAssetSnapshot | null;
  profile_image_description: ProfileImageDescription | null;
  detection_history: DetectionEvent[];
  recent_messages: MessageContext[];
  unavailable_sources: string[];
}
@injectable()
export class ModerationEvidenceService {
  constructor(
    @inject(TYPES.DetectionEventsRepository)
    private readonly detectionEventsRepository: IDetectionEventsRepository,
    @inject(TYPES.MessageContextRepository)
    @optional()
    private readonly messageContextRepository?: IMessageContextRepository,
    @inject(TYPES.GPTService) @optional() private readonly gptService?: IGPTService,
    @inject(TYPES.VerificationEventRepository)
    @optional()
    private readonly verificationEvents?: IVerificationEventRepository
  ) {}

  public async capture(input: {
    guildId: string;
    userId: string;
    member: GuildMember | null;
    describeImages?: boolean;
  }): Promise<ModerationEvidenceSnapshot> {
    const unavailable: string[] = [];
    const member = input.member;
    const messagesRepository = this.messageContextRepository;
    const verificationEvents = this.verificationEvents;
    const optionalSource = async <T>(
      name: string,
      read: () => Promise<T>,
      fallback: T
    ): Promise<T> => {
      try {
        return await read();
      } catch {
        unavailable.push(name);
        return fallback;
      }
    };
    const [assets, history, messages] = await Promise.all([
      member
        ? optionalSource('profile_assets', () => this.buildProfileAssetSnapshot(member), null)
        : (unavailable.push('profile_assets'), null),
      optionalSource(
        'detection_history',
        () => this.detectionEventsRepository.findByServerAndUser(input.guildId, input.userId),
        []
      ),
      messagesRepository
        ? optionalSource(
            'recent_messages',
            () => messagesRepository.findRecentByServerAndUser(input.guildId, input.userId, 10),
            []
          )
        : (unavailable.push('recent_messages'), []),
    ]);
    let description: ProfileImageDescription | null = null;
    for (const event of history) {
      const metadata = event.metadata as Record<string, unknown> | null;
      const stored = metadata?.moderation_evidence as ModerationEvidenceSnapshot | undefined;
      if (stored?.profile_image_description && this.matchingAssets(assets, stored.profile_assets)) {
        description = stored.profile_image_description;
        break;
      }
    }
    if (!description && verificationEvents) {
      const cases = await optionalSource(
        'profile_image_description',
        () => verificationEvents.findByUserAndServer(input.userId, input.guildId),
        []
      );
      for (const event of cases) {
        const stored = (event.metadata as Record<string, unknown> | null)
          ?.profile_image_description as Record<string, unknown> | undefined;
        if (
          stored &&
          this.matchingAssets(
            assets,
            (event.metadata as Record<string, unknown> | null)?.profile_assets as
              | ProfileAssetSnapshot
              | undefined
          ) &&
          typeof stored.summary === 'string' &&
          typeof stored.analyzed_image_count === 'number' &&
          typeof stored.model === 'string' &&
          typeof stored.prompt_version === 'string' &&
          typeof stored.is_fallback === 'boolean'
        ) {
          description = {
            summary: stored.summary,
            analyzedImageCount: stored.analyzed_image_count,
            model: stored.model,
            promptVersion: stored.prompt_version,
            isFallback: stored.is_fallback,
          };
          break;
        }
      }
    }
    if (
      assets &&
      ((assets.avatar_url && !assets.avatar_byte_sha256) ||
        (assets.banner_url && !assets.banner_byte_sha256))
    )
      unavailable.push('profile_asset_hashes');
    if (!description && input.describeImages && member && assets) {
      description = await optionalSource(
        'profile_image_description',
        () => this.describeProfileImages(member, assets),
        null
      );
    }
    if (!description && !unavailable.includes('profile_image_description'))
      unavailable.push('profile_image_description');
    return {
      captured_at: new Date().toISOString(),
      profile_assets: assets,
      profile_image_description: description,
      detection_history: history.map((event) => ({
        ...event,
        metadata: event.metadata
          ? (Object.fromEntries(
              Object.entries(event.metadata).filter(([key]) => key !== 'moderation_evidence')
            ) as DetectionEvent['metadata'])
          : undefined,
      })),
      recent_messages: messages,
      unavailable_sources: unavailable,
    };
  }
  private matchingAssets(
    current: ProfileAssetSnapshot | null,
    stored?: ProfileAssetSnapshot | null
  ): boolean {
    if (!current || !stored || (!current.avatar_url && !current.banner_url)) return false;
    return (
      current.avatar_url === stored.avatar_url &&
      current.banner_url === stored.banner_url &&
      current.avatar_hash === stored.avatar_hash &&
      current.guild_avatar_hash === stored.guild_avatar_hash &&
      current.banner_hash === stored.banner_hash
    );
  }

  private async buildProfileAssetSnapshot(member: GuildMember): Promise<ProfileAssetSnapshot> {
    const user = await member.client.users
      .fetch(member.id, { force: true })
      .catch(() => member.user);
    const avatarHash = this.readString((user as { avatar?: unknown }).avatar);
    const guildAvatarHash = this.readString((member as { avatar?: unknown }).avatar);
    const avatarUrl =
      this.callImageUrl(member, 'displayAvatarURL', { size: 256 }) ??
      this.callImageUrl(user, 'displayAvatarURL', { size: 256 });
    const guildAvatarUrl = this.callImageUrl(member, 'avatarURL', { size: 256 });
    const bannerUrl =
      this.callImageUrl(user, 'bannerURL', { size: 512 }) ??
      this.callImageUrl(member, 'bannerURL', { size: 512 });
    const avatarDecorationUrl =
      this.callImageUrl(member, 'avatarDecorationURL', { size: 256 }) ??
      this.callImageUrl(user, 'avatarDecorationURL', { size: 256 });
    const snapshot: ProfileAssetSnapshot = {
      captured_at: new Date().toISOString(),
      avatar_is_default: !avatarHash && !guildAvatarHash,
    };

    if (avatarUrl) {
      snapshot.avatar_url = avatarUrl;
      snapshot.avatar_byte_sha256 = await this.hashRemoteImage(avatarUrl);
    }
    if (avatarHash) {
      snapshot.avatar_hash = avatarHash;
    }
    if (guildAvatarUrl) {
      snapshot.guild_avatar_url = guildAvatarUrl;
    }
    if (guildAvatarHash) {
      snapshot.guild_avatar_hash = guildAvatarHash;
    }
    if (avatarDecorationUrl) {
      snapshot.avatar_decoration_url = avatarDecorationUrl;
    }
    if (bannerUrl) {
      snapshot.banner_url = bannerUrl;
      snapshot.banner_byte_sha256 = await this.hashRemoteImage(bannerUrl);
    }
    const bannerHash = this.readString((user as { banner?: unknown }).banner);
    if (bannerHash) {
      snapshot.banner_hash = bannerHash;
    }
    const hexAccentColor = this.readString((user as { hexAccentColor?: unknown }).hexAccentColor);
    if (hexAccentColor) {
      snapshot.accent_color = hexAccentColor;
    }

    return snapshot;
  }

  private async describeProfileImages(
    member: GuildMember,
    profileAssets: ProfileAssetSnapshot
  ): Promise<ProfileImageDescription | null> {
    if (
      !this.gptService ||
      typeof this.gptService.describeProfileImages !== 'function' ||
      (!profileAssets.avatar_url && !profileAssets.banner_url)
    ) {
      return null;
    }

    return await this.gptService.describeProfileImages({
      username: member.user.username,
      displayName: member.displayName,
      avatarUrl: profileAssets.avatar_url,
      bannerUrl: profileAssets.banner_url,
      avatarIsDefault: profileAssets.avatar_is_default,
    });
  }

  private async hashRemoteImage(url: string): Promise<string | undefined> {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(PROFILE_IMAGE_HASH_TIMEOUT_MS),
      });
      if (!response.ok) {
        return undefined;
      }
      const rawContentLength = response.headers.get('content-length');
      const contentLength = rawContentLength !== null ? Number(rawContentLength) : null;
      if (
        contentLength !== null &&
        (!Number.isFinite(contentLength) ||
          contentLength < 0 ||
          contentLength > PROFILE_IMAGE_HASH_MAX_BYTES)
      ) {
        return undefined;
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > PROFILE_IMAGE_HASH_MAX_BYTES) {
        return undefined;
      }
      return createHash('sha256').update(buffer).digest('hex');
    } catch {
      return undefined;
    }
  }

  private callImageUrl(
    source: unknown,
    methodName: string,
    options: { size: number }
  ): string | undefined {
    const method = (source as Record<string, unknown>)[methodName];
    if (typeof method !== 'function') {
      return undefined;
    }

    const value = (method as (options?: { size: number }) => string | null | undefined).call(
      source,
      options
    );
    return typeof value === 'string' && value ? value : undefined;
  }

  private readString(value: unknown): string | undefined {
    return typeof value === 'string' && value ? value : undefined;
  }
}
