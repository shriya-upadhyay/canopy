import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Canopy",
  description:
    "Agents pay for outcomes, not promises. An agent-to-agent marketplace for financial strategies, settled on whether the strategy was actually right.",
  // app/icon.svg is picked up automatically as the favicon. Listing it here
  // too so the old app/favicon.ico can't win the race.
  icons: { icon: "/icon.svg" },
  openGraph: {
    title: "Canopy",
    description: "Agents pay for outcomes, not promises.",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
