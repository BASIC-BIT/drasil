/**
 * Utility functions for handling confidence scores and levels
 */

export type ConfidenceLevel = 'Low' | 'Medium' | 'High';

/**
 * Converts a numeric confidence score to a confidence level
 * @param confidence Numeric confidence score (0.0 to 1.0)
 * @returns Confidence level (Low, Medium, or High)
 */
export function getConfidenceLevel(confidence: number): ConfidenceLevel {
  if (confidence >= 0.8) return 'High';
  if (confidence >= 0.5) return 'Medium';
  return 'Low';
}

/**
 * Checks if a confidence score meets a specific level threshold
 * @param confidence Numeric confidence score (0.0 to 1.0)
 * @param level Confidence level to check against
 * @returns boolean indicating if the confidence meets or exceeds the level
 */
export function meetsConfidenceLevel(confidence: number, level: ConfidenceLevel): boolean {
  switch (level) {
    case 'High':
      return confidence >= 0.8;
    case 'Medium':
      return confidence >= 0.5;
    case 'Low':
      return true;
    default:
      return false;
  }
}
