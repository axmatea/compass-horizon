import type { Metadata } from "next";
import { DemoApp } from "@/components/demo/DemoApp";
import "@/components/demo/demo.css";

export const metadata: Metadata = {
  title: "Demo",
  description:
    "Watch Longview change its mind: two campaigns, a simulated 30-day clock, late evidence, a crash mid-run, and a time machine over the agent's own memory.",
  openGraph: {
    title: "Longview demo: watch it change its mind",
    description: "Synthetic data, simulated clock, real engine. Beliefs with receipts, late truth, crash-safe runs and a time machine.",
    type: "website",
  },
};

export default function DemoPage() {
  return <DemoApp />;
}
