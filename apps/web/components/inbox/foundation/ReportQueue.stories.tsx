import type { Meta, StoryObj } from '@storybook/react-vite';
import { Foundation } from '@/components/workspace/Foundation';
import { ReportQueue } from './ReportQueue';
import { everydayReports } from './ReportInbox.fixtures';

const meta = {
  title: 'Design foundation/Report queue',
  component: ReportQueue,
  decorators: [
    (Story) => (
      <Foundation theme="dark">
        <div style={{ width: 350, maxWidth: '100%' }}>
          <Story />
        </div>
      </Foundation>
    ),
  ],
  parameters: { a11y: { test: 'error' } },
  args: {
    reports: everydayReports,
    selectedId: everydayReports[0].id,
    states: {},
    onSelect: () => {},
    onClearSearch: () => {},
  },
} satisfies Meta<typeof ReportQueue>;
export default meta;
type Story = StoryObj<typeof meta>;
export const SelectedReport: Story = {};
