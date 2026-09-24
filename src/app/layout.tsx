import type { Metadata, Viewport } from "next";
import { Source_Sans_3, Source_Serif_4 } from "next/font/google";
import { ThemeSync } from "@/shared/ui/ThemeControl";
import { Providers } from "./providers";
import { THEME_SCRIPT } from "@/lib/theme";
import "./globals.css";

// Self-hosted at build time: the browser never contacts a font service.
const ui = Source_Sans_3({ subsets: ["latin"], variable: "--font-ui", display: "swap" });
const display = Source_Serif_4({ subsets: ["latin"], variable: "--font-display", display: "swap", axes: ["opsz"] });

export const metadata: Metadata = {
  title: "Contract drafting from your Word template",
  description: "Upload a Word contract template, answer a few questions, edit the draft and download it as .docx.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // The on-screen keyboard shrinks the layout, so the composer stays above it.
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f6f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1218" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning applies to <html>'s own attributes only: the head script sets data-theme and color-scheme before React hydrates.
    <html lang="en" className={`${ui.variable} ${display.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <ThemeSync />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
