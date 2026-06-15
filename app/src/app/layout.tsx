import type { Metadata } from "next";
import "./globals.css";

import { Sidebar } from "@/components/sidebar";
import { StatusBanner } from "@/components/status-banner";

export const metadata: Metadata = {
  title: "Project Sentinel",
  description: "Resilience monitoring dashboard",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-background text-foreground antialiased">
        <div className="flex min-h-screen">
          <Sidebar />
          <div className="flex flex-1 flex-col overflow-x-hidden">
            <StatusBanner />
            <main className="flex-1 p-8">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
