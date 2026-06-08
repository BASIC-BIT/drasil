'use client';

import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

const themeStorageKey = 'drasil-theme';

function isTheme(value: string | null): value is Theme {
  return value === 'light' || value === 'dark';
}

function storedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(themeStorageKey);
    return isTheme(value) ? value : null;
  } catch {
    return null;
  }
}

function currentTheme(): Theme {
  const theme = storedTheme();
  if (theme) {
    return theme;
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(themeStorageKey, theme);
  } catch {
    // The visible theme still changes even if the browser blocks persistence.
  }
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const current = currentTheme();
    const stored = storedTheme();
    if (stored) {
      document.documentElement.dataset.theme = stored;
    }
    setTheme(current);
  }, []);

  const nextTheme = theme === 'dark' ? 'light' : 'dark';

  return (
    <button
      aria-label="Toggle light and dark mode"
      className="icon-button theme-toggle"
      onClick={() => {
        applyTheme(nextTheme);
        setTheme(nextTheme);
      }}
      title={`Switch to ${nextTheme} mode`}
      type="button"
    >
      <span aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span>
    </button>
  );
}
