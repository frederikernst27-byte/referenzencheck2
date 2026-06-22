import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Referenzencheck – Quellen- & Halluzinations-Scanner",
  description:
    "Prüft Literaturverzeichnisse gegen Google Scholar, Crossref, OpenAlex & Semantic Scholar, um KI-Halluzinationen und erfundene Quellen aufzudecken.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
