import type { Metadata, Viewport } from "next";
import "./globals.css";

const siteUrl = "https://gamz-store.github.io";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Gamz Fireworks and Liquors | Celebrate Responsibly",
  description: "Browse the Gamz Fireworks and Liquors selection and schedule your store pickup.",
  applicationName: "Gamz",
  openGraph: { type: "website", url: siteUrl, siteName: "Gamz", title: "Gamz Fireworks and Liquors", description: "Party favorites, bright nights, and bottles worth sharing." },
};

export const viewport: Viewport = { themeColor: "#ff4f00", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body suppressHydrationWarning>{children}</body></html>;
}
