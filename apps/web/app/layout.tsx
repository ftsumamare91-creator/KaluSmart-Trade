import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "kalu Trading PLC · KaluSmart Trade",
  description: "Intelligent Business Insights & Automation for Ethiopian SMEs.",
  icons: { icon: "/icon.png" },
};

const themeScript = "try{if(localStorage.getItem('kalu-theme')==='dark')document.documentElement.classList.add('dark');}catch(e){}";

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body>{children}</body>
    </html>
  );
}
