import type { Metadata } from "next";
import "./globals.css";

export function generateMetadata(): Metadata {
  const origin = new URL(process.env.NEXT_PUBLIC_APP_URL || "https://here-social-room.spriprin.chatgpt.site").origin;

  return {
    metadataBase: new URL(origin),
    title: "HERE — Real people. Same place. Right now.",
    description: "Room Wall, limited Drops, intentional Interests, Matches and realtime chat for people sharing one real event.",
    openGraph: {
      title: "HERE — Real people. Same place. Right now.",
      description: "Join a live Room, open Your Drop, Match and meet IRL.",
      type: "website",
      images: [{ url: `${origin}/og.png`, width: 1733, height: 909, alt: "HERE — live social Rooms for real events." }],
    },
    twitter: {
      card: "summary_large_image",
      title: "HERE — Real people. Same place. Right now.",
      description: "Limited discovery for real-world connection.",
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
