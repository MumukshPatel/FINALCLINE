import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "MandiNet | Estimated net sale proceeds",
  description: "Compare dated sale scenarios after transport and farmer-borne selling expenses.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
