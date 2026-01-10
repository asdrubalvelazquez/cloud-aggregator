import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Suspense } from "react";
import { CopyProvider } from "@/context/CopyContext";
import { CopyProgressBar } from "@/components/CopyProgressBar";
import { CanonicalHostGuard } from "@/components/CanonicalHostGuard";
import GoogleAnalytics from "@/components/GoogleAnalytics";
import PageViewTracker from "@/components/PageViewTracker";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Viewport configuration (separate from metadata in Next.js 14+)
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#7B8FD4" },
    { media: "(prefers-color-scheme: dark)", color: "#2a2a3e" },
  ],
};

// Metadata configuration
// CANONICAL DOMAIN: https://www.cloudaggregatorapp.com
// Dual-domain possible (preview host + www); www is preferred
export const metadata: Metadata = {
  metadataBase: new URL("https://www.cloudaggregatorapp.com"),
  title: {
    default: "Cloud Aggregator – Connect Multiple Google Drive Accounts",
    template: "%s | Cloud Aggregator",
  },
  description: "Cloud Aggregator lets you connect multiple Google Drive accounts in one dashboard. View each account separately and manually copy files between them with full user control.",
  keywords: [
    "cloud storage",
    "google drive",
    "file management",
    "cloud aggregator",
    "multiple drives",
    "cloud files",
    "drive manager",
  ],
  authors: [{ name: "Cloud Aggregator" }],
  creator: "Cloud Aggregator",
  publisher: "Cloud Aggregator",
  alternates: {
    canonical: "https://www.cloudaggregatorapp.com",
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://www.cloudaggregatorapp.com",
    siteName: "Cloud Aggregator",
    title: "Cloud Aggregator – Connect Multiple Google Drive Accounts",
    description: "Connect multiple Google Drive accounts (each remains separate). Select files with Google Picker and manually copy between accounts with explicit user confirmation. User-controlled operations only.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Cloud Aggregator – Connect Multiple Google Drive Accounts",
    description: "Connect multiple Google Drive accounts (each remains separate). Select files with Google Picker and manually copy between accounts with explicit user confirmation. User-controlled operations only.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  icons: {
    icon: [
      { url: "/icon", sizes: "192x192", type: "image/png", media: "(prefers-color-scheme: light)" },
      { url: "/icon-dark", sizes: "192x192", type: "image/png", media: "(prefers-color-scheme: dark)" },
      { url: "/favicon.ico", sizes: "32x32" },
    ],
    apple: [
      { url: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <GoogleAnalytics />
        <CopyProvider>
          <Suspense fallback={null}>
            <PageViewTracker />
          </Suspense>
          <CanonicalHostGuard />
          {children}
          <CopyProgressBar />
        </CopyProvider>
      </body>
    </html>
  );
}
