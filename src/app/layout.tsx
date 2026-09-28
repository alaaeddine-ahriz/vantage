import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vantage",
  description: "Live control center for world energy, industry and market news, built for market research.",
  icons: { icon: "/favicon.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0a0d12",
};

/* Dark is the default and is rendered on the server; the stored theme is applied before hydration so light-theme users never see a dark flash. */
const themeInit =
  'try{var p=JSON.parse(localStorage.getItem("ww:prefs:v1")||"{}");if(p&&p.theme==="light"){document.documentElement.classList.remove("dark")}}catch(e){}';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body className="bg-background text-foreground antialiased">
        <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
      </body>
    </html>
  );
}
