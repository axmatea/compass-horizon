import type { Metadata, Viewport } from "next";
import "./globals.css";

const TITLE = "COMPASS";
const DESCRIPTION = "Watch an acquisition agent learn, day by day.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  applicationName: TITLE,
  openGraph: { title: TITLE, description: DESCRIPTION, siteName: TITLE, type: "website" },
  twitter: { card: "summary", title: TITLE, description: DESCRIPTION },
};

export const viewport: Viewport = {
  themeColor: "#0d0d0c",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
