import { Geist, Geist_Mono } from "next/font/google";
import { ConvexClientProvider } from "./convex-client-provider";
import { RegisterServiceWorker } from "./register-service-worker";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport = {
  themeColor: "#1a1a1a",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata = {
  title: "Notes",
  description: "Voice and text notes",
  applicationName: "Notes",
  appleWebApp: {
    capable: true,
    title: "Notes",
    statusBarStyle: "default",
  },
  formatDetection: {
    telephone: false,
  },
};

export default function RootLayout({ children }) {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className={geistSans.className}>
        <ConvexClientProvider deploymentUrl={convexUrl}>
          {children}
        </ConvexClientProvider>
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
