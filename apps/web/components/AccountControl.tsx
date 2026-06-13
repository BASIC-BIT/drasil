interface AccountControlProps {
  readonly username: string;
}

function initialsFor(username: string): string {
  return username
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

export function AccountControl({ username }: AccountControlProps) {
  const initials = initialsFor(username) || 'DA';

  return (
    <form action="/api/auth/logout" className="account-control" method="post">
      <span aria-hidden="true" className="account-avatar">
        {initials}
      </span>
      <span className="account-copy">
        <span className="account-label">Signed in as</span>
        <strong className="account-name">{username}</strong>
      </span>
      <button
        aria-label={`Sign out ${username}`}
        className="icon-button account-sign-out"
        title="Sign out"
        type="submit"
      >
        <span aria-hidden="true">-&gt;</span>
      </button>
    </form>
  );
}
