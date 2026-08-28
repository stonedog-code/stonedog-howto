import type { ReactNode } from "react";

export const metadata = {
  title: "How-to",
  description: "Internal documentation across products.",
};

// Private and internal. A crawler that reaches this has already got further
// than it should, but saying so costs nothing.
export const viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta name="robots" content="noindex, nofollow" />
      </head>
      <body>{children}</body>
    </html>
  );
}
