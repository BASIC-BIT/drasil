/**
 * GPTService: Provides AI-powered user profile classification using OpenAI's GPT
 * - Analyzes user profile data to determine if user is suspicious
 * - Returns "OK" or "SUSPICIOUS" based on AI analysis
 */
import OpenAI from 'openai';

export interface UserProfileData {
  username: string;
  discriminator?: string;
  nickname?: string;
  bio?: string;
  accountCreatedAt?: Date;
  joinedServerAt?: Date;
  connectedAccounts?: string[];
  // Add other relevant profile fields as needed
}

// Type for OpenAI error with response data
interface OpenAIErrorWithResponse extends Error {
  response?: {
    data?: unknown;
  };
}

export class GPTService {
  private openai: OpenAI;

  constructor() {
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

  /**
   * Classifies a user profile as "OK" or "SUSPICIOUS" using GPT
   *
   * @param profileData The user profile data to analyze
   * @returns Promise resolving to "OK" or "SUSPICIOUS"
   */
  public async classifyUserProfile(profileData: UserProfileData): Promise<string> {
    try {
      // Create a structured prompt for GPT
      const prompt = this.createPrompt(profileData);

      console.log('Sending request to OpenAI with prompt:', prompt.substring(0, 100) + '...');

      // Call OpenAI API
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content:
              "You are a Discord moderation assistant. Based on the user's profile, classify whether the user is suspicious. If suspicious, respond 'SUSPICIOUS'; if normal, respond 'OK'.",
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
   *
   * @param profileData The user profile data
   * @returns A formatted prompt string
   */
  private createPrompt(profileData: UserProfileData): string {
    const {
      username,
      discriminator,
      nickname,
      bio,
      accountCreatedAt,
      joinedServerAt,
      connectedAccounts,
    } = profileData;

    // Format account creation and join dates if available
    const accountAge = accountCreatedAt
      ? `${Math.floor((Date.now() - accountCreatedAt.getTime()) / (1000 * 60 * 60 * 24))} days`
      : 'unknown';

    const joinedServerDaysAgo = joinedServerAt
      ? `${Math.floor((Date.now() - joinedServerAt.getTime()) / (1000 * 60 * 60 * 24))} days ago`
      : 'unknown';

    // Format connected accounts if available
    const connectedAccountsStr = connectedAccounts?.length ? connectedAccounts.join(', ') : 'none';

    // Create the structured prompt
    return `Please analyze this Discord user profile:
Username: ${username}${discriminator ? `#${discriminator}` : ''}
${nickname ? `Nickname: ${nickname}` : ''}
Account age: ${accountAge}
Joined server: ${joinedServerDaysAgo}
Connected accounts: ${connectedAccountsStr}
${bio ? `Bio: ${bio}` : 'No bio'}

Based on these details, classify the user as either 'OK' or 'SUSPICIOUS'.`;
  }
}
