import type { Metadata, Viewport } from "next";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "ViaMensa | Food corridor control tower",
  description: "Plan food deliveries, explore corridor disruptions, and keep communities connected to supply.",
};

export const viewport: Viewport = { colorScheme: "light", themeColor: "#ffffff" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
