import type { Metadata, Viewport } from "next";
import "./globals.css";

const TITLE = "Longview: the acquisition agent that waits for the truth";
const DESCRIPTION =
  "Ads are judged on day one. Customers arrive on day thirty. Longview keeps every experiment open until lead quality arrives, remembers what it believed, and changes its mind with receipts.";

export const metadata: Metadata = {
  title: { default: TITLE, template: "%s | Longview" },
  description: DESCRIPTION,
  applicationName: "Longview",
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    siteName: "Longview",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: TITLE,
    description: DESCRIPTION,
  },
};

export const viewport: Viewport = {
  themeColor: "#0d0d0c",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>
        <a className="lv-skip" href="#main">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
