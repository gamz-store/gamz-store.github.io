import type { Metadata, Viewport } from "next";
import "./globals.css";

const siteUrl = "https://gamz-store.github.io";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Gamz Fireworks & Liquors | Big Nights, Bright Moments",
  description: "Discover fireworks, liquor favorites, and schedule an easy store pickup at Gamz Fireworks and Liquors.",
  applicationName: "Gamz",
  icons: { icon: "/logo.png", shortcut: "/logo.png" },
  openGraph: {
    type: "website",
    url: siteUrl,
    siteName: "Gamz Fireworks & Liquors",
    title: "Gamz Fireworks & Liquors | Big Nights, Bright Moments",
    description: "Discover fireworks, liquor favorites, and schedule an easy store pickup at Gamz Fireworks and Liquors.",
    images: [{ url: "/opengraph-image.png", width: 1200, height: 630, alt: "Gamz Fireworks & Liquors — Big nights. Bright moments." }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Gamz Fireworks & Liquors | Big Nights, Bright Moments",
    description: "Discover fireworks, liquor favorites, and schedule an easy store pickup.",
    images: ["/opengraph-image.png"],
  },
};

export const viewport: Viewport = { themeColor: "#ff4f00", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body suppressHydrationWarning>{children}</body></html>;
}
