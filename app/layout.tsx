import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
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
  title: {
    default: "tfila.co — next minyan near you",
    template: "%s · tfila.co",
  },
  description:
    "Find the next minyan near you. Mobile-first directory of Jewish shul times, kept fresh automatically.",
  metadataBase: new URL("https://tfila.co"),
  icons: {
    icon: "/favicon.ico",
    apple: "/tfila-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "tfila.co",
  },
};

// We don't have a dark theme — opt out so OS dark mode and Chrome's
// "Force Dark for Web" don't repaint the page over our light palette.
export const viewport: Viewport = {
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-stone-50 text-neutral-900">
        {children}
        <Analytics />
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
