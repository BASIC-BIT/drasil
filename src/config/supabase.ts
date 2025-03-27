import { createClient } from '@supabase/supabase-js';

// Environment variables for Supabase
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_KEY || '';

// Validate environment variables
if (!supabaseUrl || !supabaseKey) {
  console.error('Error: Missing Supabase environment variables. Please check your .env file.');
  // Don't throw an error in production, just log it
  if (process.env.NODE_ENV !== 'production') {
    throw new Error('Missing Supabase environment variables');
  }
}

// Create a single instance of the Supabase client to be used throughout the app
export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false, // We don't need auth features for the bot
  },
});

// Export typed versions once we have our database types defined
// This will be expanded later
export type Database = {
  // To be defined based on our schema
};

// Helper function to check if Supabase is configured properly
export const isSupabaseConfigured = (): boolean => {
  return !!(supabaseUrl && supabaseKey);
};
