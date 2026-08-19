import { RoomJoinApp } from "../../components/RoomJoinApp";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { FoundationRoom } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function RoomPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const client = await createSupabaseServerClient();
  let initialRoom: FoundationRoom | null | undefined;

  if (client) {
    const { data, error } = await client.rpc("get_room_by_join_code", { p_join_code: slug });
    if (!error) {
      initialRoom = ((Array.isArray(data) ? data[0] : data) as FoundationRoom | undefined) || null;
    }
  }

  return <RoomJoinApp joinCode={slug} initialRoom={initialRoom} />;
}
