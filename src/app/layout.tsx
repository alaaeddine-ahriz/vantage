import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "World Watchout",
  description: "Live control center for world energy, industry and market news, built for market research.",
  icons: { icon: "/favicon.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0a0d12",
};

/* Applies the stored theme before hydration so light-theme users never see a dark flash. */
const themeInit =
  'try{var p=JSON.parse(localStorage.getItem("ww:prefs:v1")||"{}");if(p&&p.theme==="light"){document.documentElement.setAttribute("data-theme","light")}}catch(e){}';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
