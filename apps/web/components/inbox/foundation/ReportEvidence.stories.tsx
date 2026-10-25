import type { Meta, StoryObj } from '@storybook/react-vite';
import { Foundation } from '@/components/workspace/Foundation';
import { ReportEvidence } from './ReportEvidence';
import { everydayReports } from './ReportInbox.fixtures';

const meta = {
  title: 'Design foundation/Report evidence',
  component: ReportEvidence,
  decorators: [
    (Story) => (
      <Foundation theme="dark">
        <div style={{ maxWidth: 800, padding: 28 }}>
          <Story />
        </div>
      </Foundation>
    ),
  ],
  parameters: { a11y: { test: 'error' } },
  args: { items: everydayReports[0].evidence },
} satisfies Meta<typeof ReportEvidence>;
export default meta;
type Story = StoryObj<typeof meta>;
export const SubmittedEvidence: Story = {};
