import { mock } from 'jest-mock-extended';
import type { User } from 'discord.js';
import type { IConfigService } from '../../config/ConfigService';
import { ReportSubmissionService } from '../../services/ReportSubmissionService';
import type { ISecurityActionService } from '../../services/SecurityActionService';
it('preserves external message origin and attachments for downstream per-server policy', async () => {
  const security = mock<ISecurityActionService>();
  security.handleMessageReport.mockResolvedValue(true);
  const service = new ReportSubmissionService(mock<IConfigService>(), security);
  const target = { id: 'target', username: 'target' } as User;
  const reporter = { id: 'reporter', username: 'reporter' } as User;
  const report = {
    messageId: 'source-message',
    channelId: 'source-channel',
    reason: 'evidence',
    attachments: [{ id: 'attachment', url: 'https://example.com/evidence.png' }],
  };
  expect(await service.submitMessageReport(target, reporter, report)).toEqual({
    status: 'submitted',
  });
  expect(security.handleMessageReport).toHaveBeenCalledWith(target, reporter, report);
});
