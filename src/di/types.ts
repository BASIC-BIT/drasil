// Common types used across the application

export type DetectionResult = {
  label: 'OK' | 'SUSPICIOUS';
  confidence: number;
  confidenceLevel: 'Low' | 'Medium' | 'High';
  reasons: string[];
  usedGPT: boolean;
  triggerSource: 'message' | 'join';
  triggerContent: string | null;
};

export type UserProfile = {
  userId: string;
  username: string;
  accountAge?: number;
  joinedServer?: Date;
  messageHistory?: string[];
  avatarUrl?: string;
  isBot?: boolean;
};

export type HeuristicResult = {
  result: 'OK' | 'SUSPICIOUS';
  reasons: string[];
};

export type GPTResult = {
  result: 'OK' | 'SUSPICIOUS';
  confidence: number;
  reasons: string[];
};
