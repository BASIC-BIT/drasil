import type { Meta, StoryObj } from '@storybook/react-vite';
import { Foundation } from '@/components/inbox/foundation/Foundation';
import { SourceDesk, SourceDeskHistory } from './SourceDesk';
import { busyCase } from './CaseWorkspace.fixtures';

const meta = {
  title: 'Design foundation/Source desk parts',
  component: SourceDesk,
  args: { detail: busyCase },
  argTypes: { detail: { control: false } },
  decorators: [
    (Story) => (
      <Foundation theme="dark">
        <div style={{ maxWidth: 1000, padding: 24 }}>
          <Story />
        </div>
      </Foundation>
    ),
  ],
  parameters: { a11y: { test: 'error' } },
} satisfies Meta<typeof SourceDesk>;
export default meta;
type Story = StoryObj<typeof meta>;

export const EvidenceReader: Story = {};
export const ModerationHistory: Story = {
  render: ({ detail }) => (
    <div style={{ maxWidth: 300 }}>
      <SourceDeskHistory detail={detail} />
    </div>
  ),
};
