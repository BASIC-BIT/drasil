import type { Meta, StoryObj } from '@storybook/react-vite';
import { MemberProfileView } from './MemberProfileView';
import { fixtureMemberProfile } from '@/lib/memberProfileFixtures';

const profile = fixtureMemberProfile('guild-1', 'user-300');

const meta = {
  title: 'Active Triage/Member Profile',
  component: MemberProfileView,
  args: {
    guildId: 'guild-1',
    guildName: 'Fixture Guild',
    profile: profile!,
    sessionUsername: 'Fixture Admin',
  },
} satisfies Meta<typeof MemberProfileView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const BannedMemberHistory: Story = {};
