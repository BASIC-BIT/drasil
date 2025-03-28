// Mock all required services
jest.mock('discord.js');
jest.mock('../Bot');
jest.mock('../config/supabase');

describe('Bot Minimal Test', () => {
  it('should create a mock message', () => {
    // Import the mock directly
    const { MockMessage } = require('../__mocks__/discord.js');
    
    // Create a mock message
    const message = MockMessage({
      content: '!ping',
      isBot: false,
      userId: 'test-user-id',
    });
    
    // Log the message for debugging
    console.log('Mock Message:', message);
    
    // Verify the message has the expected properties
    expect(message).toBeDefined();
    expect(message.content).toBe('!ping');
    expect(message.reply).toBeDefined();
    expect(typeof message.reply).toBe('function');
  });
});