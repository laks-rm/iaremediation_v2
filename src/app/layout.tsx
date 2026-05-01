import type { Metadata } from "next";

import { ToastProvider } from "../components/Toast";
import { AIAssistantProvider } from "../lib/ai-assistant-context";
import { ThemeProvider } from "../lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: "IA Remediation",
  description: "Internal audit remediation tracking",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-dm-sans">
        <ThemeProvider>
          <ToastProvider>
            <AIAssistantProvider>{children}</AIAssistantProvider>
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
