/**
 * GPTService: Provides AI-powered user profile classification using OpenAI's GPT
 * - Analyzes user profile data to determine if user is suspicious
 * - Returns "OK" or "SUSPICIOUS" based on AI analysis
 */
import { injectable, inject } from 'inversify';
import OpenAI from 'openai';
import { getFormattedExamples } from '../config/gpt-config';
import { TYPES } from '../di/symbols';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import { hashIdentifier } from '../observability/hash';

export interface UserProfileData {
  serverId?: string; // Added optional serverId
  userId?: string; // Added optional userId
  username: string;
  discriminator?: string;
  nickname?: string;
  accountCreatedAt: Date;
  joinedServerAt: Date;
  recentMessages: string[];
  // Add other relevant profile fields as needed
}

/**
 * Interface for the GPT service that performs AI-powered analysis
 */
export interface IGPTService {
  /**
   * Analyzes a user profile to determine if they are suspicious
   * @param userProfile Object containing user information
   * @returns Object with result, confidence and reasons
   */
  analyzeProfile(userProfile: UserProfileData): Promise<{
    result: 'OK' | 'SUSPICIOUS';
    confidence: number;
    reasons: string[];
  }>;
}

/**
 * Implementation of the GPT service using OpenAI API
 */
@injectable()
export class GPTService implements IGPTService {
  private openai: OpenAI;

  constructor(@inject(TYPES.OpenAI) openai?: OpenAI) {
    if (openai) {
      this.openai = openai;
    } else {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        console.error('No OpenAI API key found in environment variables');
      }

      // Initialize the OpenAI client with API key from environment variable
      this.openai = new OpenAI({
        apiKey,
      });

      // Never log API keys.
    }
  }

  /**
   * Analyzes a user profile to determine if they are suspicious
   * @param userProfile Object containing user information
   * @returns Object with result, confidence and reasons
   */
  public async analyzeProfile(userProfile: UserProfileData): Promise<{
    result: 'OK' | 'SUSPICIOUS';
    confidence: number;
    reasons: string[];
  }> {
    try {
      // Call the classification method
      const classification = await this.classifyUserProfile(userProfile);

      // Extract confidence and reasons (mock implementation - would be enhanced with actual GPT output parsing)
      const confidence = classification === 'SUSPICIOUS' ? 0.8 : 0.2;
      const reasons =
        classification === 'SUSPICIOUS'
          ? ['Suspicious user profile detected']
          : ['User profile appears normal'];

      return {
        result: classification as 'OK' | 'SUSPICIOUS',
        confidence,
        reasons,
      };
    } catch (error) {
      console.error('Error in GPT analysis:', error);
      // Default to less restrictive result in case of errors
      return {
        result: 'OK',
        confidence: 0.1,
        reasons: ['Error in GPT analysis'],
      };
    }
  }

  /**
   * Classifies a user profile as "OK" or "SUSPICIOUS" using GPT
   *
   * @param profileData The user profile data to analyze
   * @returns Promise resolving to "OK" or "SUSPICIOUS"
   */
  private async classifyUserProfile(userProfile: UserProfileData): Promise<string> {
    const tracer = trace.getTracer('drasil');
    const debugGpt = process.env.DEBUG_GPT === 'true';

    const userIdHash = userProfile.userId ? hashIdentifier(userProfile.userId) : undefined;
    const serverIdHash = userProfile.serverId ? hashIdentifier(userProfile.serverId) : undefined;

    return tracer.startActiveSpan(
      'drasil.gpt.classifyUserProfile',
      {
        attributes: {
          ...(serverIdHash ? { 'drasil.guild_id_hash': serverIdHash } : {}),
          ...(userIdHash ? { 'drasil.user_id_hash': userIdHash } : {}),
          'drasil.gpt.model': 'gpt-4o-mini',
          'drasil.profile.recent_messages_count': userProfile.recentMessages.length,
        },
      },
      async (span) => {
        try {
          // Create a structured prompt for GPT with few-shot examples
          const prompt = this.createPrompt(userProfile);

          // Call OpenAI API
          const response = await this.openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
              {
                role: 'system',
                content:
                  "You are a Discord moderation assistant. Based on the user's profile, classify whether the user is suspicious. If suspicious, respond 'SUSPICIOUS'; if normal, respond 'OK'. In your decision, consider factors like account age, username characteristics, nickname if available, how recently they joined, and the content of their recent message if provided.",
              },
              {
                role: 'user',
                content: prompt,
              },
            ],
            temperature: 0.3,
            max_tokens: 50,
          });

          if (response.usage) {
            span.setAttribute('drasil.openai.prompt_tokens', response.usage.prompt_tokens);
            span.setAttribute('drasil.openai.completion_tokens', response.usage.completion_tokens);
            span.setAttribute('drasil.openai.total_tokens', response.usage.total_tokens);
          }

          // Safer extraction of classification with more validation
          if (!response.choices.length) {
            span.setAttribute('drasil.gpt.classification', 'OK');
            return 'OK';
          }

          const raw = response.choices[0]?.message?.content?.trim() || '';
          const normalized = raw.includes('SUSPICIOUS') ? 'SUSPICIOUS' : 'OK';
          span.setAttribute('drasil.gpt.classification', normalized);

          if (debugGpt) {
            console.log(`[gpt] classification=${normalized}`);
          }

          return normalized;
        } catch (error) {
          span.recordException(error as Error);
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error instanceof Error ? error.message : 'OpenAI error',
          });

          if (debugGpt) {
            console.warn('[gpt] OpenAI call failed; defaulting to OK', error);
          }

          // Default to "OK" in case of API errors to prevent false positives
          return 'OK';
        } finally {
          span.end();
        }
      }
    );
  }

  /**
   * Creates a structured prompt for GPT based on profile data
   * Includes few-shot examples to improve classification accuracy
   *
   * @param profileData The user profile data
   * @returns A formatted prompt string with examples
   */
  private createPrompt(profileData: UserProfileData): string {
    const { username, discriminator, nickname, accountCreatedAt, joinedServerAt, recentMessages } =
      profileData;

    // Format account creation and join dates if available
    // accountCreatedAt is guaranteed by UserProfileData type, ternary is unnecessary
    const accountAge = `${Math.floor((Date.now() - accountCreatedAt.getTime()) / (1000 * 60 * 60 * 24))} days`;

    // joinedServerAt is guaranteed by UserProfileData type, ternary is unnecessary
    const joinedServerDaysAgo = `${Math.floor((Date.now() - joinedServerAt.getTime()) / (1000 * 60 * 60 * 24))} days ago`;

    // Create the structured prompt focusing only on available Discord data
    let prompt = `Please analyze this Discord user profile:
Username: ${username}${discriminator ? `#${discriminator}` : ''}
${nickname ? `Nickname: ${nickname}` : ''}
Account age: ${accountAge}
Joined server: ${joinedServerDaysAgo}`;

    // Add recent messages if available
    // recentMessages is guaranteed to be an array by UserProfileData type,
    // so the truthiness check `recentMessages &&` is unnecessary.
    if (recentMessages.length > 0) {
      prompt += `\nRecent messages: "${recentMessages.join('", "')}"`;
    }

    // Add few-shot examples from configuration
    prompt += getFormattedExamples();

    prompt += `\n\nBased on these details and examples, classify the user above as either 'OK' or 'SUSPICIOUS'.`;

    return prompt;
  }
}
