import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { Foundation } from './Foundation';
import { WorkspaceReadFailure } from './WorkspaceReadFailure';

const meta = {
  title: 'Workspace/Read recovery',
  component: WorkspaceReadFailure,
  args: { code: 'access_denied', returnTo: '/admin', onRetry: fn() },
  decorators: [
    (Story) => (
      <Foundation>
        <div style={{ maxWidth: 720, padding: 32 }}>
          <Story />
        </div>
      </Foundation>
    ),
  ],
} satisfies Meta<typeof WorkspaceReadFailure>;
export default meta;
type Story = StoryObj<typeof meta>;

export const AccessDenied: Story = {};
export const Unavailable: Story = { args: { code: 'unavailable' } };
