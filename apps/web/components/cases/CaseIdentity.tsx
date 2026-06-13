import type { CaseUserIdentity } from '@drasil/contracts';

interface CaseIdentityProps {
  readonly identity: CaseUserIdentity;
  readonly href?: string;
  readonly headingLevel: 1 | 2;
}

function identityInitial(identity: CaseUserIdentity): string {
  return identity.displayLabel.trim()[0]?.toUpperCase() ?? '?';
}

function uniqueIdentityFacts(identity: CaseUserIdentity): Array<[string, string]> {
  const facts: Array<[string, string | null]> = [
    ['Nickname', identity.nickname],
    ['Username', identity.username ? `@${identity.username}` : null],
    ['Global name', identity.globalName],
    ['Discord ID', identity.id],
  ];
  const seen = new Set<string>();

  return facts.flatMap(([label, value]) => {
    const normalized = value?.trim();
    if (!normalized) {
      return [];
    }

    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      return [];
    }
    seen.add(key);

    return [[label, normalized]];
  });
}

export function CaseIdentity({ identity, href, headingLevel }: CaseIdentityProps) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2';
  const facts = uniqueIdentityFacts(identity);

  return (
    <div className="case-identity">
      {identity.avatarUrl ? (
        <img
          alt=""
          className="case-avatar"
          loading="lazy"
          referrerPolicy="no-referrer"
          src={identity.avatarUrl}
        />
      ) : (
        <span className="case-avatar case-avatar-placeholder" aria-hidden="true">
          {identityInitial(identity)}
        </span>
      )}
      <div className="case-identity-copy">
        <Heading className={headingLevel === 1 ? 'page-title' : undefined}>
          {href ? <a href={href}>{identity.displayLabel}</a> : identity.displayLabel}
        </Heading>
        <div className="identity-facts" aria-label="Discord identity">
          {facts.map(([label, value]) => (
            <span className="identity-fact" key={`${label}-${value}`}>
              <span className="muted">{label}</span>
              <strong>{value}</strong>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
