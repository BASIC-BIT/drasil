import { LegacyContent } from './LegacyContent';
import { WorkspaceShell, type WorkspaceShellProps } from './WorkspaceShell';

export function LegacyWorkspacePage({ children, ...identity }: WorkspaceShellProps) {
  return (
    <WorkspaceShell {...identity}>
      <LegacyContent>{children}</LegacyContent>
    </WorkspaceShell>
  );
}
