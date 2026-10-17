import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans, IBM_Plex_Sans_Condensed } from "next/font/google";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";

const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-sans",
  display: "swap",
});
const condensed = IBM_Plex_Sans_Condensed({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-condensed",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ViaMensa | Food corridor control tower",
  description:
    "Plan food deliveries, explore corridor disruptions, and keep communities connected to supply.",
};

export const viewport: Viewport = { colorScheme: "dark", themeColor: "#0b1013" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${sans.variable} ${condensed.variable}`}>
      <body>{children}</body>
    </html>
  );
}
