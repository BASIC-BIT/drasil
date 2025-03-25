/* eslint-disable jest/no-disabled-tests */

// REAL API TEST - NOT MOCKED
// Tell Jest NOT to mock the openai module for this test file
jest.unmock('openai');

import { GPTService, UserProfileData } from '../../services/GPTService';
import { config } from 'dotenv';
import { resolve } from 'path';

// Load environment variables from .env file
// This needs to run before any other code to ensure variables are available
config({ path: resolve(__dirname, '../../../.env') });

// Verify that we loaded the API key correctly
const apiKey = process.env.OPENAI_API_KEY;
console.log('API key loaded:', apiKey ? 'Yes (length: ' + apiKey.length + ')' : 'No');

/**
 * REAL API TEST - This test actually calls the OpenAI API
 *
 * To run this test:
 * 1. Ensure you have a valid OPENAI_API_KEY in your .env file
 * 2. Run with: npm test -- -t "real API" --testPathPattern=realapi
 * 3. You can add DEBUG=true to see detailed API responses
 *
 * IMPORTANT: This test is skipped by default to avoid unnecessary API calls and costs
 *
 * Debugging Notes:
 * - If you encounter "Cannot read properties of undefined (reading 'choices')", check that:
 *   1. Your OpenAI API key is valid and has sufficient credits
 *   2. You're using a supported model name in GPTService.ts (e.g., 'gpt-4o')
 *   3. The API is responding with the expected format
 */

// Set debug mode for more verbose output
process.env.DEBUG = 'true';

describe.skip('GPTService - Real API', () => {
  // Run this test only when you want to test with the real API
  it('should classify a normal user profile using the real OpenAI API', async () => {
    // Check if API key exists
    if (!process.env.OPENAI_API_KEY) {
      console.warn('Skipping real API test: No OpenAI API key found in .env file');
      return;
    }

    // Create the service instance
    const gptService = new GPTService();

    // Sample normal user profile
    const normalUser: UserProfileData = {
      username: 'regular_gamer',
      discriminator: '1234',
      bio: 'I enjoy playing Minecraft and Valorant. Cat enthusiast. Discord member since 2019.',
      accountCreatedAt: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000), // 1 year old account
      joinedServerAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // joined 30 days ago
      connectedAccounts: ['Spotify', 'Steam', 'Xbox'],
    };

    console.log('Calling OpenAI API with normal user...');
    try {
      // Call the API - this will make a real API request!
      const result = await gptService.classifyUserProfile(normalUser);

      console.log('API call successful, result:', result);

      // Check the result - we expect a string response
      expect(typeof result).toBe('string');
      expect(['OK', 'SUSPICIOUS']).toContain(result);

      // We should expect this account to be classified as OK, but the AI might have other ideas
      // so we don't assert on the specific value
      console.log(`Real API classification for normal user: ${result}`);
    } catch (error) {
      console.error('Test error with API call:', error);
      throw error; // Re-throw to fail the test
    }
  }, 30000); // Increase timeout for API call

  it('should classify a suspicious user profile using the real OpenAI API', async () => {
    // Check if API key exists
    if (!process.env.OPENAI_API_KEY) {
      console.warn('Skipping real API test: No OpenAI API key found in .env file');
      return;
    }

    // Create the service instance
    const gptService = new GPTService();

    // Sample suspicious user profile
    const suspiciousUser: UserProfileData = {
      username: 'FREE_NITRO_GlFT',
      discriminator: '0001',
      bio: 'Get FREE Discord Nitro! Click my profile link to claim your gift now!',
      accountCreatedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // 1 day old
      joinedServerAt: new Date(Date.now() - 30 * 60 * 1000), // joined 30 minutes ago
      connectedAccounts: [],
    };

    console.log('Calling OpenAI API with suspicious user...');
    try {
      // Call the API - this will make a real API request!
      const result = await gptService.classifyUserProfile(suspiciousUser);

      console.log('API call successful, result:', result);

      // Check the result - we expect a string response
      expect(typeof result).toBe('string');
      expect(['OK', 'SUSPICIOUS']).toContain(result);

      // We should expect this account to be classified as SUSPICIOUS, but we're not strictly
      // asserting that to avoid test failures if the model changes its evaluations
      console.log(`Real API classification for suspicious user: ${result}`);
    } catch (error) {
      console.error('Test error with API call:', error);
      throw error; // Re-throw to fail the test
    }
  }, 30000); // Increase timeout for API call
});
