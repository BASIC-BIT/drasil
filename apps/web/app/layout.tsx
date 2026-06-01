import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Drasil Setup',
  description: 'Setup and diagnostics dashboard for the Drasil Discord anti-spam bot.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
