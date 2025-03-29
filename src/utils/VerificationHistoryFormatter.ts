import { VerificationEventWithActions, AdminAction } from '../repositories/types';

export class VerificationHistoryFormatter {
  static formatHistory(
    events: VerificationEventWithActions[],
    userId: string,
    includeMarkdown = true
  ): string {
    let output = includeMarkdown
      ? `# Verification History for <@${userId}>\n\n`
      : `Verification History for @${userId}\n\n`;

    for (const event of events) {
      output += this.formatVerificationEvent(event, includeMarkdown);
      output += '\n';
    }

    return output;
  }

  private static formatVerificationEvent(
    event: VerificationEventWithActions,
    includeMarkdown: boolean
  ): string {
    const timestamp = new Date(event.created_at).toLocaleString();
    let output = includeMarkdown
      ? `## ${timestamp}\n`
      : `=== ${timestamp} ===\n`;

    output += `Status: ${event.status}\n`;
    
    if (event.thread_id) {
      output += `Thread: <#${event.thread_id}>\n`;
    }

    if (event.notes) {
      output += `Notes: ${event.notes}\n`;
    }

    if (event.actions.length > 0) {
      output += '\nActions:\n';
      for (const action of event.actions) {
        output += this.formatAdminAction(action, includeMarkdown);
      }
    }

    return output;
  }

  private static formatAdminAction(action: AdminAction, includeMarkdown: boolean): string {
    const timestamp = new Date(action.action_at).toLocaleString();
    const adminMention = includeMarkdown ? `<@${action.admin_id}>` : `@${action.admin_id}`;
    let output = '';

    switch (action.action_type) {
      case 'verify':
        output = `✅ Verified by ${adminMention}`;
        break;
      case 'reject':
        output = `❌ Rejected by ${adminMention}`;
        break;
      case 'ban':
        output = `🔨 Banned by ${adminMention}`;
        break;
      case 'reopen':
        output = `🔄 Verification reopened by ${adminMention}`;
        break;
      case 'create_thread':
        output = `📝 Verification thread created by ${adminMention}`;
        break;
      default:
        output = `Action taken by ${adminMention}`;
    }

    output += ` at ${timestamp}`;

    if (action.previous_status !== action.new_status) {
      output += `\n  Status changed from ${action.previous_status || 'none'} to ${action.new_status}`;
    }

    if (action.notes) {
      output += `\n  Notes: ${action.notes}`;
    }

    return includeMarkdown ? `- ${output}\n` : `* ${output}\n`;
  }

  static formatForDiscord(events: VerificationEventWithActions[], userId: string): string {
    return this.formatHistory(events, userId, true);
  }

  static formatForFile(events: VerificationEventWithActions[], userId: string): string {
    return this.formatHistory(events, userId, false);
  }
} 