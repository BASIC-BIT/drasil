import { DetectionEvent } from '../repositories/types';

/**
 * Formats detection events into a readable text file format
 */
export class DetectionHistoryFormatter {
  /**
   * Creates a formatted text file content from detection events
   * @param userId The Discord user ID
   * @param events Array of detection events
   * @param guildId The Discord guild ID (for message links)
   * @returns Formatted string for the text file
   */
  public static formatHistory(userId: string, events: DetectionEvent[], guildId: string): string {
    // Sort events by date, most recent first
    const sortedEvents = events.sort(
      (a, b) => new Date(b.detected_at).getTime() - new Date(a.detected_at).getTime()
    );

    let fileContent = this.createHeader(userId);
    fileContent += this.createDetailedHistory(sortedEvents, guildId);

    return fileContent;
  }

  private static createHeader(userId: string): string {
    let content = `Detection History for User <@${userId}>\n`;
    content += `Generated at ${new Date().toISOString()}\n\n`;
    return content;
  }

  private static createDetailedHistory(events: DetectionEvent[], guildId: string): string {
    let content = '=== Detailed History ===\n\n';

    events.forEach((event, index) => {
      content += `[Event ${index + 1}]\n`;
      content += `Time: ${new Date(event.detected_at).toISOString()}\n`;
      content += `Type: ${event.detection_type}\n`;
      content += `Confidence: ${(event.confidence * 100).toFixed(0)}%\n`;

      // event.reasons is guaranteed to be an array by DetectionEvent type,
      // so the truthiness check `event.reasons &&` is unnecessary.
      if (event.reasons.length > 0) {
        content += `Reasons: ${event.reasons.join(', ')}\n`;
      }

      if (event.message_id && event.channel_id) {
        content += `Message Link: https://discord.com/channels/${guildId}/${event.channel_id}/${event.message_id}\n`;
      }

      if (event.metadata?.content) {
        content += `Message Content: ${event.metadata.content}\n`;
      }

      content += '\n';
    });

    return content;
  }
}
