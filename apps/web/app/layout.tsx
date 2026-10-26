import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Drasil Moderation',
  description: 'Review reports, cases and account recovery in your Discord server.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('drasil-theme');if(t==='light'||t==='dark'){document.documentElement.dataset.theme=t;}}catch(e){}`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
