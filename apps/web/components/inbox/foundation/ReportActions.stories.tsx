import type { Meta, StoryObj } from '@storybook/react-vite';
import { Foundation } from './Foundation';
import { ReportActions } from './ReportActions';
import { everydayReports } from './ReportInbox.fixtures';

const meta = {
  title: 'Design foundation/Report actions',
  component: ReportActions,
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
  args: {
    report: everydayReports[0],
    state: { kind: 'ready' },
    onAction: () => {},
    onNext: () => {},
    hasNext: true,
  },
} satisfies Meta<typeof ReportActions>;
export default meta;
type Story = StoryObj<typeof meta>;
export const AvailableActions: Story = {};
