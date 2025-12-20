import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { CopyProvider } from "@/context/CopyContext";
import { CopyProgressBar } from "@/components/CopyProgressBar";

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
  themeColor: "#4B9FFF",
};

// Metadata configuration
export const metadata: Metadata = {
  metadataBase: new URL("https://cloudaggregatorapp.com"),
  title: {
    default: "Cloud Aggregator – Manage All Your Cloud Drives in One Place",
    template: "%s | Cloud Aggregator",
  },
  description: "Cloud Aggregator lets you connect and manage multiple Google Drive accounts in one place. Copy, organize, and control your cloud files easily.",
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
    canonical: "https://cloudaggregatorapp.com",
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://cloudaggregatorapp.com",
    siteName: "Cloud Aggregator",
    title: "Cloud Aggregator – Manage All Your Cloud Drives in One Place",
    description: "Cloud Aggregator lets you connect and manage multiple Google Drive accounts in one place. Copy, organize, and control your cloud files easily.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Cloud Aggregator – Manage All Your Cloud Drives in One Place",
    description: "Cloud Aggregator lets you connect and manage multiple Google Drive accounts in one place. Copy, organize, and control your cloud files easily.",
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
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
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
        <CopyProvider>
          {children}
          <CopyProgressBar />
        </CopyProvider>
      </body>
    </html>
  );
}
