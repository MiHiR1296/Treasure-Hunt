import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Treasure Hunt Engine",
  description: "Real-world adventures, one clue at a time.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}
