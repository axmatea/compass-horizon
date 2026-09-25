import type { Metadata, Viewport } from "next";
import "./globals.css";

const TITLE = "COMPASS";
const DESCRIPTION = "Your own seat. One shared plan. Explore the COMPASS virtual office and shared memory concept.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  applicationName: TITLE,
  openGraph: { title: TITLE, description: DESCRIPTION, siteName: TITLE, type: "website" },
  twitter: { card: "summary", title: TITLE, description: DESCRIPTION },
};

export const viewport: Viewport = {
  themeColor: "#f7f5ee",
  colorScheme: "light",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
