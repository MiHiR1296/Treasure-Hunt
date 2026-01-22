import type { Metadata } from "next";
import "./globals.css";
import { TeamProvider } from "@/lib/context/TeamContext";

export const metadata: Metadata = {
  title: "Republic Day Treasure Hunt",
  description: "Join the treasure hunt in Lokdhara, Kalyan East",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <TeamProvider>
          {children}
        </TeamProvider>
      </body>
    </html>
  );
}
