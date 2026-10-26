import type { Meta, StoryObj } from '@storybook/react-vite';
import { Foundation } from './Foundation';
import { Timestamp, TimestampClock } from './Timestamp';
import { useState } from 'react';

const meta = {
  title: 'Design foundation/Timestamp',
  component: Timestamp,
  decorators: [
    (Story) => (
      <Foundation theme="dark">
        <div style={{ padding: 28 }}>
          <Story />
        </div>
      </Foundation>
    ),
  ],
  parameters: { a11y: { test: 'error' } },
  args: { value: '2026-06-02T12:10:00.000Z' },
} satisfies Meta<typeof Timestamp>;
export default meta;
type Story = StoryObj<typeof meta>;

export const DateAndTime: Story = {};
export const DateOnly: Story = { args: { value: '2026-06-04', format: 'date' } };

export const CompactTime: Story = { args: { format: 'time' } };

function ClockLifecycleExample() {
  const [visible, setVisible] = useState(true);
  return (
    <>
      <button onClick={() => setVisible((value) => !value)}>Toggle clock</button>
      {visible ? (
        <TimestampClock>
          <p data-testid="clock-value">
            <Timestamp value="2026-06-02T12:10:00.000Z" />
          </p>
        </TimestampClock>
      ) : null}
    </>
  );
}
export const ClockLifecycle: Story = { render: () => <ClockLifecycleExample /> };
