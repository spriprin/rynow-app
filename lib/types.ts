export type RoomStatus = "DRAFT" | "UPCOMING" | "LIVE" | "CLOSED";
export type Purpose = "Dating" | "Friends" | "Networking" | "Just meeting people";

export interface Person {
  id: string;
  name: string;
  age: number;
  purpose: Purpose;
  bio: string;
  interests: string[];
  photo: string;
  accent: string;
}

export interface Room {
  id: string;
  slug: string;
  name: string;
  eventName: string;
  venue: string;
  city: string;
  description: string;
  startsAt: string;
  endsAt: string;
  status: RoomStatus;
  cover: string;
}

export interface ChatMessage {
  id: string;
  sender: "me" | "them";
  content: string;
  time: string;
}

export type FoundationRoomStatus = "draft" | "open" | "closed";

export interface FoundationRoom {
  id: string;
  name: string;
  venue_name: string | null;
  city: string | null;
  starts_at: string;
  ends_at: string;
  status: FoundationRoomStatus;
  join_code: string;
  cover_path: string | null;
}

export interface FoundationProfile {
  id: string;
  display_name: string;
  avatar_path: string;
  age_confirmed_18: boolean;
}

export interface RoomWallPerson {
  id: string;
  displayName: string;
  avatarUrl: string;
}
