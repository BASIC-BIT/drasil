import { GuildMember, Message, PermissionFlagsBits } from 'discord.js';
import { IDetectionOrchestrator } from '../services/DetectionOrchestrator';
import { UserProfileData } from '../services/GPTService';
import { IHeuristicService } from '../services/HeuristicService';

export class TestCommandHandler {
  public constructor(
    private readonly heuristicService: IHeuristicService,
    private readonly detectionOrchestrator: IDetectionOrchestrator
  ) {}

  public async handleTestCommands(message: Message): Promise<void> {
    const args = message.content.split(' ');
    const testCommand = args[1]?.toLowerCase();

    if (!testCommand) {
      await message.reply(
        'Available test commands: `!test spam`, `!test newaccount`, `!test spamwords`'
      );
      return;
    }

    try {
      // Declare test variables outside switch to avoid lexical declaration errors
      let newAccountProfile: UserProfileData;
      let newAccountResult;
      let spamMessage: string;
      let spamResult;

      if (!message.member) {
        await message.reply('This command can only be used in a server.');
        return;
      }

      if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
        await message.reply('You need administrator permissions to use test commands.');
        return;
      }

      switch (testCommand) {
        case 'spam':
          // Simulate message frequency spam
          if (!message.guildId) {
            await message.reply('This command can only be used in a server.');
            return;
          }
          for (let i = 0; i < 10; i++) {
            this.heuristicService.isFrequencyAboveThreshold(message.author.id, message.guildId);
          }
          await message.reply(
            'Simulated rapid message frequency. Next message should trigger detection.'
          );
          break;

        case 'newaccount':
          // Create a simulated profile with recent account creation
          newAccountProfile = {
            ...this.extractUserProfileData(message.member),
            accountCreatedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // 1 day old account
            joinedServerAt: new Date(Date.now() - 1 * 60 * 60 * 1000), // Joined 1 hour ago
          };

          // Analyze with this profile
          newAccountResult = await this.detectionOrchestrator.detectMessage(
            message.guild?.id || 'TEST',
            message.author.id,
            'Test message with simulated new account',
            newAccountProfile
          );

          await message.reply(
            `Test result: ${newAccountResult.label}\n` +
              `Confidence: ${(newAccountResult.confidence * 100).toFixed(2)}%\n` +
              `Reason: ${newAccountResult.reasons.join(', ')}\n`
          );
          break;

        case 'spamwords':
          // Test with known spam keywords
          spamMessage = 'free discord nitro gift card claim your prize now';
          spamResult = await this.detectionOrchestrator.detectMessage(
            message.guild?.id || 'TEST',
            message.author.id,
            spamMessage,
            this.extractUserProfileData(message.member)
          );

          await message.reply(
            `Test message: "${spamMessage}"\n` +
              `Result: ${spamResult.label}\n` +
              `Confidence: ${(spamResult.confidence * 100).toFixed(2)}%\n` +
              `Reason: ${spamResult.reasons.join(', ')}\n`
          );
          break;

        default:
          await message.reply(
            'Unknown test command. Available commands: `!test spam`, `!test newaccount`, `!test spamwords`'
          );
      }
    } catch (error) {
      console.error('Error in test command:', error);
      await message.reply('An error occurred while executing the test command.');
    }
  }

  private extractUserProfileData(member: GuildMember): UserProfileData {
    return {
      username: member.user.username,
      discriminator: member.user.discriminator,
      nickname: member.nickname || undefined,
      accountCreatedAt: new Date(member.user.createdTimestamp),
      joinedServerAt: member.joinedAt ? new Date(member.joinedAt) : new Date(),
      recentMessages: [],
    };
  }
}
