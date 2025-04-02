/**
 * GPTService: Provides AI-powered user profile classification using OpenAI's GPT
 * - Analyzes user profile data to determine if user is suspicious
 * - Returns "OK" or "SUSPICIOUS" based on AI analysis
 */
import { injectable, inject } from 'inversify';
import OpenAI from 'openai';
import { getFormattedExamples } from '../config/gpt-config';
import { TYPES } from '../di/symbols';

export interface UserProfileData {
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

// Type for OpenAI error with response data
interface OpenAIErrorWithResponse extends Error {
  response?: {
    data?: unknown;
  };
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
        dangerouslyAllowBrowser: true, // Add this if testing in browser environment
      });

      // Display partial key for debugging
      if (apiKey) {
        const firstFour = apiKey.substring(0, 4);
        const lastFour = apiKey.substring(apiKey.length - 4);
        console.log(`OpenAI client initialized with API key: ${firstFour}...${lastFour}`);
      }
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
    try {
      // Create a structured prompt for GPT with few-shot examples
      const prompt = this.createPrompt(userProfile);

      console.log('Sending request to OpenAI with prompt:', prompt.substring(0, 400) + '...');

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

      // Debug the API response in development
      if (process.env.NODE_ENV === 'development' || process.env.DEBUG) {
        console.log('OpenAI API Response:', JSON.stringify(response, null, 2));
      }

      // Safer extraction of classification with more validation
      if (!response || !response.choices || !response.choices.length) {
        console.error('Unexpected API response structure:', response);
        return 'OK'; // Default to OK if response format is unexpected
      }

      // Extract the classification from the response
      const classification = response.choices[0]?.message?.content?.trim() || '';
      console.log('Classification from API:', classification);

      // Return only "OK" or "SUSPICIOUS", default to "OK" if unclear
      if (classification.includes('SUSPICIOUS')) {
        return 'SUSPICIOUS';
      } else {
        return 'OK';
      }
    } catch (error) {
      console.error('Error calling OpenAI API:', error);
      if (error instanceof Error) {
        console.error('Error details:', error.message);
        if ('response' in error) {
          console.error('API response:', (error as OpenAIErrorWithResponse).response?.data);
        }
      }
      // Default to "OK" in case of API errors to prevent false positives
      return 'OK';
    }
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
    const accountAge = accountCreatedAt
      ? `${Math.floor((Date.now() - accountCreatedAt.getTime()) / (1000 * 60 * 60 * 24))} days`
      : 'unknown';

    const joinedServerDaysAgo = joinedServerAt
      ? `${Math.floor((Date.now() - joinedServerAt.getTime()) / (1000 * 60 * 60 * 24))} days ago`
      : 'unknown';

    // Create the structured prompt focusing only on available Discord data
    let prompt = `Please analyze this Discord user profile:
Username: ${username}${discriminator ? `#${discriminator}` : ''}
${nickname ? `Nickname: ${nickname}` : ''}
Account age: ${accountAge}
Joined server: ${joinedServerDaysAgo}`;

    // Add recent messages if available
    if (recentMessages && recentMessages.length > 0) {
      prompt += `\nRecent messages: "${recentMessages.join('", "')}"`;
    }

    // Add few-shot examples from configuration
    prompt += getFormattedExamples();

    prompt += `\n\nBased on these details and examples, classify the user above as either 'OK' or 'SUSPICIOUS'.`;

    return prompt;
  }
}
