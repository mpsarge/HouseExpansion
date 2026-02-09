import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "House Expansion Lab",
  description: "Explore how changing the House size shifts apportionment and Electoral College votes.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="min-h-screen font-sans">
        {children}
      </body>
    </html>
  );
}
