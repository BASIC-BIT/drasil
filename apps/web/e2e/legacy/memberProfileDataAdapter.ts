// Explicit legacy test-build boundary. Never imported by the release build.
import { fixtureMemberProfile } from '@/lib/memberProfileFixtures';
import { type MemberProfile } from '@drasil/contracts';
import { type MemberProfileDataAdapter } from '../../lib/memberProfileDataAdapter';
export * from '../../lib/memberProfileDataAdapter';

export class FixtureMemberProfileDataAdapter implements MemberProfileDataAdapter {
  public async getMemberProfile(guildId: string, userId: string): Promise<MemberProfile | null> {
    return fixtureMemberProfile(guildId, userId);
  }
}

export function createMemberProfileDataAdapter(): MemberProfileDataAdapter {
  return new FixtureMemberProfileDataAdapter();
}
