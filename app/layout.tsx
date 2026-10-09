import type { Metadata, Viewport } from "next";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export function generateMetadata(): Metadata {
  const origin = new URL(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").origin;
  const isStaging = new URL(origin).hostname === "staging.rynowqr.com";

  return {
    metadataBase: new URL(origin),
    robots: isStaging ? { index: false, follow: false } : undefined,
    title: "RYNOW — Real people. Same place. Right now.",
    description: "Turn your event into a place where meeting someone new is easier. Guests join by QR, discover people at the same event, match and meet in real life — no app download required.",
    openGraph: {
      title: "RYNOW — Real people. Same place. Right now.",
      description: "Guests join your event by QR, discover people at the same event, match and meet in real life — no app download required.",
      type: "website",
      images: [{ url: `${origin}/og.png`, width: 1730, height: 909, alt: "RYNOW — live social Rooms for real events." }],
    },
    twitter: {
      card: "summary_large_image",
      title: "RYNOW — Real people. Same place. Right now.",
      description: "One event QR. Limited discovery. Real-world connection.",
      images: [`${origin}/og.png`],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
