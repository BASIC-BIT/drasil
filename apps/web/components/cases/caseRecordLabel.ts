export function recordLabel(value: string): string {
  const labels: Readonly<Record<string, string>> = {
    gpt_analysis: 'Content analysis',
    suspicious_content: 'Content check',
    user_report: 'Member report',
    reported_text: 'Reported message',
    reporter_text: 'Reporter statement',
    restricted: 'Restricted',
    verified: 'Verified',
    banned: 'Banned',
    kicked: 'Kicked',
    closed_no_action: 'Closed without action',
    drasil: 'Drasil',
    native_discord: 'Discord',
  };
  return labels[value] ?? value.replace(/_/g, ' ');
}
