/**
 * GPT Service Configuration
 *
 * This file contains configuration for the GPT service, including few-shot examples
 * for better classification of user profiles.
 */

import { UserProfileData } from '../services/GPTService';

const MINUTE_IN_MS = 60 * 1000;
const HOUR_IN_MS = 60 * MINUTE_IN_MS;
const DAY_IN_MS = 24 * HOUR_IN_MS;

const HOURS_VARIANCE = 10;
const MINUTES_VARIANCE = 10;

// TODO: Remove the optional variance argument in favor of just automatically calculating the largest sensible value
function getDaysAgoWithVariance(days: number, hoursVariance = HOURS_VARIANCE): Date {
  const variance = Math.floor(Math.random() * hoursVariance * HOUR_IN_MS);

  return new Date(Date.now() - days * DAY_IN_MS - variance);
}

function getHoursAgoWithVariance(hours: number, minutesVariance = MINUTES_VARIANCE): Date {
  const variance = Math.floor(Math.random() * minutesVariance * MINUTE_IN_MS);

  return new Date(Date.now() - hours * HOUR_IN_MS - variance);
}

function getMinutesAgoWithVariance(minutes: number, minutesVariance = MINUTES_VARIANCE): Date {
  const variance = Math.floor(Math.random() * minutesVariance * MINUTE_IN_MS);

  return new Date(Date.now() - minutes * MINUTE_IN_MS - variance);
}

/**
 * Configuration for the GPT service
 */
export interface GPTServiceConfig {
  /**
   * Number of days an account should exist before being considered established
   */
  newAccountThresholdDays: number;

  /**
   * Examples of clearly suspicious users for few-shot learning (obvious spam/scam)
   */
  clearlySuspiciousExamples: UserProfileData[];

  /**
   * Examples of borderline suspicious users for few-shot learning
   * (not obvious spam, but should still be flagged)
   */
  borderlineSuspiciousExamples: UserProfileData[];

  /**
   * Examples of borderline normal/OK users for few-shot learning
   * (has some unusual characteristics but should not be flagged)
   */
  borderlineNormalExamples: UserProfileData[];

  /**
   * Examples of clearly normal/OK users for few-shot learning (obvious legitimate users)
   */
  clearlyNormalExamples: UserProfileData[];

  /**
   * @deprecated Use clearlySuspiciousExamples and borderlineSuspiciousExamples instead
   */
  suspiciousExamples?: UserProfileData[];

  /**
   * @deprecated Use clearlyNormalExamples and borderlineNormalExamples instead
   */
  normalExamples?: UserProfileData[];
}

/**
 * Default configuration for GPT service
 */
export const gptConfig: GPTServiceConfig = {
  // Accounts less than 30 days old are considered "new"
  newAccountThresholdDays: 30,

  // Category 1: Clearly suspicious examples (obvious spam/scam)
  clearlySuspiciousExamples: [
    {
      username: 'Free_Nitro_Giveaway',
      discriminator: '0001',
      accountCreatedAt: getDaysAgoWithVariance(1), // 1 day old
      joinedServerAt: getMinutesAgoWithVariance(30), // joined 30 minutes ago
      recentMessage: 'Click here for FREE DISCORD NITRO: bit.ly/free-nitro-discord',
    },
    {
      username: 'Steam_Games_Free',
      discriminator: '9999',
      accountCreatedAt: getDaysAgoWithVariance(3), // 3 days old
      joinedServerAt: getMinutesAgoWithVariance(5, 2), // joined 5 minutes ago
      recentMessage: 'Check my profile for free Steam games! Limited time offer!',
    },
    {
      username: 'xXDistributor_BotXx',
      nickname: '✅ Verified Gamer',
      accountCreatedAt: getDaysAgoWithVariance(2), // 2 days old
      joinedServerAt: getHoursAgoWithVariance(1), // joined 1 hour ago
      recentMessage: '@everyone I am giving away free Discord Nitro to celebrate my birthday!',
    },
    {
      username: 'Melissa_bailey0847',
      nickname: 'Melissa_bailey',
      accountCreatedAt: getDaysAgoWithVariance(3), // 3 days old
      joinedServerAt: getDaysAgoWithVariance(2), // joined 2 days ago
      recentMessage: 'https://t.me/Melissa_Bailey224',
    },
  ],

  // Category 2: Borderline suspicious examples (subtle but should be flagged)
  borderlineSuspiciousExamples: [
    {
      username: 'Emily_Johnson',
      discriminator: '1984',
      accountCreatedAt: getDaysAgoWithVariance(15), // 15 days old
      joinedServerAt: getDaysAgoWithVariance(1), // joined 1 day ago
      recentMessage: 'Hey guys, anyone into NFTs? I got some cool art to share, DM me.',
    },
    {
      username: 'crypto_enthusiast',
      discriminator: '5544',
      accountCreatedAt: getDaysAgoWithVariance(20), // 20 days old
      joinedServerAt: getDaysAgoWithVariance(2), // joined 2 days ago
      recentMessage: 'I made 5x returns using this trading strategy: tradinglink.co/strategy',
    },
    {
      username: 'AlexGaming',
      discriminator: '7212',
      nickname: 'Alex | Giveaway Soon',
      accountCreatedAt: getDaysAgoWithVariance(25), // 25 days old
      joinedServerAt: getHoursAgoWithVariance(12), // joined 12 hours ago
      recentMessage:
        'Bored of playing alone? Join my community server, we have giveaways every week!',
    },
  ],

  // Category 3: Borderline normal examples (unusual but should be OK)
  borderlineNormalExamples: [
    {
      username: 'shaliassa',
      discriminator: '4321',
      accountCreatedAt: getDaysAgoWithVariance(10), // 10 days old
      joinedServerAt: getDaysAgoWithVariance(1), // joined today
      recentMessage: "Hello! I'm looking for people to play with. Anyone here?",
    },
    {
      username: 'undrana_burta',
      discriminator: '2468',
      accountCreatedAt: getDaysAgoWithVariance(14), // 14 days old
      joinedServerAt: getDaysAgoWithVariance(1), // joined 1 day ago
      recentMessage: 'Check out my portfolio at github.com/codinghelp. Any feedback appreciated!',
    },
    {
      username: 'xX_DarkShadow_Xx',
      discriminator: '3690',
      nickname: '💀Shadow💀',
      accountCreatedAt: getDaysAgoWithVariance(21), // 21 days old
      joinedServerAt: getDaysAgoWithVariance(3), // joined 3 days ago
      recentMessage: 'Does anyone know when the next Fortnite tournament is?',
    },
  ],

  // Category 4: Clearly normal examples (obviously legitimate users)
  clearlyNormalExamples: [
    {
      username: 'GamerDude',
      discriminator: '1234',
      accountCreatedAt: getDaysAgoWithVariance(365), // 1 year old
      joinedServerAt: getDaysAgoWithVariance(30), // joined 30 days ago
      recentMessage: 'Hey everyone! Anyone want to play some Minecraft later?',
    },
    {
      username: 'CodingWizard',
      discriminator: '5678',
      nickname: 'JavaScript Expert',
      accountCreatedAt: getDaysAgoWithVariance(180), // 180 days old
      joinedServerAt: getDaysAgoWithVariance(90), // joined 90 days ago
      recentMessage: 'I just finished my new React project, check it out on GitHub!',
    },
    {
      username: 'NewMember',
      discriminator: '4321',
      accountCreatedAt: getDaysAgoWithVariance(45), // 45 days old
      joinedServerAt: getDaysAgoWithVariance(1), // joined 1 day ago
      recentMessage: 'Hi everyone! I am new here. This server looks great!',
    },
  ],
};

/**
 * Format a single user profile example for the GPT prompt
 * @param example The user profile data to format
 * @param index Index for numbering in the output
 * @param type Whether this is an "OK" or "SUSPICIOUS" example
 * @returns Formatted string representation of the user profile
 */
export function formatProfileExample(
  example: UserProfileData,
  index: number,
  type: 'OK' | 'SUSPICIOUS'
): string {
  const accountAge = example.accountCreatedAt
    ? `${Math.floor((Date.now() - example.accountCreatedAt.getTime()) / DAY_IN_MS)} days`
    : 'unknown';

  const joinedServerDaysAgo = example.joinedServerAt
    ? `${Math.floor((Date.now() - example.joinedServerAt.getTime()) / DAY_IN_MS)} days ago`
    : 'unknown';

  let result = `\nExample ${index + 1} (${type}):\n`;
  result += `Username: ${example.username}${example.discriminator ? `#${example.discriminator}` : ''}\n`;
  if (example.nickname) result += `Nickname: ${example.nickname}\n`;
  result += `Account age: ${accountAge}\n`;
  result += `Joined server: ${joinedServerDaysAgo}\n`;
  if (example.recentMessage) result += `Recent message: "${example.recentMessage}"\n`;
  result += `Classification: ${type}\n`;

  return result;
}

/**
 * Get example profiles formatted for the GPT prompt
 * @returns Formatted example string
 */
export function getFormattedExamples(): string {
  let examples = '\n\nHere are some examples:\n';
  let index = 0;

  // Add clearly suspicious examples
  examples += '\n// Clearly suspicious examples (obvious spam/scam)';
  gptConfig.clearlySuspiciousExamples.forEach((example) => {
    examples += formatProfileExample(example, index++, 'SUSPICIOUS');
  });

  // Add borderline suspicious examples
  examples += '\n// Borderline suspicious examples (subtle but should be flagged)';
  gptConfig.borderlineSuspiciousExamples.forEach((example) => {
    examples += formatProfileExample(example, index++, 'SUSPICIOUS');
  });

  // Add borderline normal examples
  examples += '\n// Borderline normal examples (unusual but should be OK)';
  gptConfig.borderlineNormalExamples.forEach((example) => {
    examples += formatProfileExample(example, index++, 'OK');
  });

  // Add clearly normal examples
  examples += '\n// Clearly normal examples (obviously legitimate users)';
  gptConfig.clearlyNormalExamples.forEach((example) => {
    examples += formatProfileExample(example, index++, 'OK');
  });

  return examples;
}
