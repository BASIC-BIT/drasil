import { expect, test } from '@playwright/test';

test('relative times refresh and an unmounted clock releases its interval', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-06-02T12:12:00Z') });
  await page.addInitScript(() => {
    const intervals = new Set<number>();
    const start = window.setInterval.bind(window);
    const stop = window.clearInterval.bind(window);
    window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      const id = start(handler, timeout, ...args);
      if (timeout === 60000) intervals.add(id);
      return id;
    }) as typeof window.setInterval;
    window.clearInterval = (id) => {
      if (typeof id === 'number') intervals.delete(id);
      stop(id);
    };
    Object.defineProperty(window, 'activeTimestampIntervals', { get: () => intervals.size });
  });
  await page.goto('/iframe.html?id=design-foundation-timestamp--clock-lifecycle&viewMode=story');
  const value = page.getByTestId('clock-value');
  await expect(value).toContainText('Jun 2, 12:10 PM UTC');
  await expect(value).toContainText('2 minutes ago');
  const intervals = () =>
    page.evaluate(() => Reflect.get(window, 'activeTimestampIntervals') as number);
  const mounted = await intervals();
  expect(mounted).toBeGreaterThan(0);
  await page.clock.fastForward(60000);
  await expect(value).toContainText('3 minutes ago');
  await page.getByRole('button', { name: 'Toggle clock' }).click();
  await expect.poll(intervals).toBe(mounted - 1);
  await page.getByRole('button', { name: 'Toggle clock' }).click();
  await expect.poll(intervals).toBe(mounted);
});
