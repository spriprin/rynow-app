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
