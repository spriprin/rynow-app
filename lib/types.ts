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

export type DropItemAction = "passed" | "interested" | null;

export interface RoomDropState {
  drop_id: string | null;
  sequence_number: number | null;
  scheduled_at: string | null;
  effective_open_at: string | null;
  drop_size: number | null;
  min_unlock_count: number | null;
  interest_budget: number | null;
  assigned_count: number;
  remaining_count: number;
  interests_used: number;
  eligible_count: number;
  active_candidate_count: number;
  next_scheduled_at: string | null;
  server_now: string;
}

export interface DropItem {
  id: string;
  position: number;
  firstSeenAt: string | null;
  action: DropItemAction;
  candidateId: string;
  displayName: string;
  avatarPath: string;
  avatarUrl: string;
}

export interface IncomingInterest {
  interestId: string;
  fromUserId: string;
  displayName: string;
  avatarPath: string;
  avatarUrl: string;
  createdAt: string;
}

export interface RoomMatch {
  id: string;
  otherUserId: string;
  displayName: string;
  avatarPath: string;
  avatarUrl: string;
  matchedAt: string;
  lastMessageAt: string | null;
  lastMessageBody: string | null;
  unreadCount: number;
}

export interface MatchMessage {
  id: string;
  matchId: string;
  senderId: string;
  body: string;
  createdAt: string;
  readAt: string | null;
}

export interface OrganizerDrop {
  id: string;
  room_id: string;
  sequence_number: number;
  scheduled_at: string;
  opened_at: string | null;
  drop_size: number;
  min_unlock_count: number;
  interest_budget: number;
  created_at: string;
}
