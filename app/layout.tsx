import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const configuredUrl = new URL(process.env.NEXT_PUBLIC_APP_URL || "https://here-social.example");
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host") || configuredUrl.host;
  const protocol = requestHeaders.get("x-forwarded-proto") || configuredUrl.protocol.replace(":", "");
  const origin = `${protocol}://${host}`;

  return {
    metadataBase: new URL(origin),
    title: "HERE — See who's here. Meet IRL.",
    description: "Live social rooms for events, venues and parties. Meet the people who are already here.",
    openGraph: {
      title: "HERE — Meet the people who are already here.",
      description: "Join a live social room for your event, venue or party.",
      type: "website",
      images: [{ url: `${origin}/og.png`, width: 1733, height: 909, alt: "HERE — Meet the people who are already here." }],
    },
    twitter: {
      card: "summary_large_image",
      title: "HERE — See who's here. Meet IRL.",
      description: "Live social rooms for real-world connection.",
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
