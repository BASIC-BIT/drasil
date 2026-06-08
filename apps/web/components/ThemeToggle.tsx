'use client';

import { useEffect } from 'react';

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
  useEffect(() => {
    const theme = storedTheme();
    if (theme) {
      document.documentElement.dataset.theme = theme;
    }
  }, []);

  return (
    <button
      aria-label="Toggle light and dark mode"
      className="button ghost theme-toggle"
      onClick={() => {
        applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
      }}
      title="Toggle light and dark mode"
      type="button"
    >
      Theme
    </button>
  );
}
