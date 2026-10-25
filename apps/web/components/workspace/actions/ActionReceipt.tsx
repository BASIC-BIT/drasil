import {
  deriveWorkspaceActionPresentation,
  type WorkspaceActionPresentationInput,
} from '@/lib/workspaceActionPresentation';
import styles from './Actions.module.css';

export function ActionReceipt(input: WorkspaceActionPresentationInput) {
  const presentation = deriveWorkspaceActionPresentation(input);
  if (presentation.kind === 'idle') return null;
  return (
    <p role="status" aria-live="polite" className={styles.receipt} data-kind={presentation.kind}>
      {presentation.message}
    </p>
  );
}
