import { SocialRoomApp } from "../../components/SocialRoomApp";

export default async function RoomPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <SocialRoomApp initialView="room" roomSlug={slug} />;
}
