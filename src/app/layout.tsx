import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";

// One variable family with a width axis: normal width for text, a narrow cut
// for dense labels and axis ticks (see --cond in globals.css).
const archivo = Archivo({
  subsets: ["latin"],
  weight: "variable",
  axes: ["wdth"],
  variable: "--font-sans",
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
    <html lang="en" className={archivo.variable}>
      <body>{children}</body>
    </html>
  );
}
