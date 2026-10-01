import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

const mukta = localFont({
  src: [
    { path: "../../node_modules/@fontsource/mukta/files/mukta-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../../node_modules/@fontsource/mukta/files/mukta-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "../../node_modules/@fontsource/mukta/files/mukta-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "../../node_modules/@fontsource/mukta/files/mukta-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-mukta",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Contribution Tracker", template: "%s · Contribution Tracker" },
  description: "Plan, verify and fairly split the work of a two-partner web studio.",
};

export const viewport: Viewport = { themeColor: "#1b2a4a", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" className={mukta.variable}>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
