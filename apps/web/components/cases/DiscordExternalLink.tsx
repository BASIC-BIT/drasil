'use client';

import type { MouseEvent, ReactNode } from 'react';

const mobileUserAgentPattern = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i;
const desktopFallbackDelayMs = 1_000;

interface DiscordExternalLinkProps {
  readonly href: string;
  readonly desktopHref?: string;
  readonly className: string;
  readonly label: string;
  readonly children: ReactNode;
  readonly title?: string;
}

function shouldUseDesktopHref(desktopHref: string | undefined): desktopHref is string {
  if (!desktopHref || typeof navigator === 'undefined') {
    return false;
  }

  return !mobileUserAgentPattern.test(navigator.userAgent);
}

export function DiscordExternalLink({
  href,
  desktopHref,
  className,
  label,
  children,
  title,
}: DiscordExternalLinkProps) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!shouldUseDesktopHref(desktopHref)) {
      return;
    }

    const opened = window.open(desktopHref, '_blank');
    if (!opened) {
      return;
    }

    event.preventDefault();
    opened.opener = null;
    window.setTimeout(() => {
      if (!opened.closed) {
        opened.location.href = href;
      }
    }, desktopFallbackDelayMs);
  };

  return (
    <a
      aria-label={label}
      className={className}
      href={href}
      onClick={handleClick}
      rel="noreferrer"
      target="_blank"
      title={title ?? label}
    >
      {children}
    </a>
  );
}
