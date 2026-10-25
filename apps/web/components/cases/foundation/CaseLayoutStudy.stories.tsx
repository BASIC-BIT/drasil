import type { Meta, StoryObj } from '@storybook/react-vite';
import { CaseLayoutStudy } from './CaseLayoutStudy';
import { busyCase } from './CaseWorkspace.fixtures';

const meta = {
  title: 'Design foundation/Case layout comparison',
  component: CaseLayoutStudy,
  parameters: { layout: 'fullscreen', a11y: { test: 'error' } },
  args: { detail: busyCase, layout: 'sources', theme: 'dark' },
  argTypes: { detail: { control: false } },
} satisfies Meta<typeof CaseLayoutStudy>;
export default meta;
type Story = StoryObj<typeof meta>;
export const SourceDesk: Story = {};
export const CaseChronology: Story = { args: { layout: 'chronology' } };
export const SourceDeskLight: Story = { args: { theme: 'light' } };
export const CaseChronologyLight: Story = { args: { layout: 'chronology', theme: 'light' } };
