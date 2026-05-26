export function getConfidenceBucket(confidence: number): string {
  const percent = Math.round(confidence * 100);
  if (percent >= 90) return '90-100';
  if (percent >= 70) return '70-89';
  if (percent >= 50) return '50-69';
  return '0-49';
}
