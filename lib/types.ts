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
export type Gender = "male" | "female" | "prefer_not_to_say";
export type DiscoveryPreference = "male" | "female" | "everyone";

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
  gender: Gender | null;
  discovery_preference: DiscoveryPreference | null;
  accepted_document_version?: string | null;
  accepted_at?: string | null;
}

export interface RoomWallPerson {
  id: string;
  displayName: string;
  avatarPath: string;
  avatarUrl: string;
}

export interface RoomPresenceState {
  discovery_enabled: boolean;
  left_at: string | null;
  recently_active: boolean;
  discovery_eligible: boolean;
  server_now: string;
}

export type ExploreAvailability = "ready" | "active" | "caught_up" | "waiting" | "left";

export interface ExploreItem {
  id: string;
  position: number;
  firstSeenAt: string | null;
  action: ExploreAction;
  candidateId: string;
  displayName: string;
  avatarPath: string;
  avatarUrl: string;
}

export interface ExploreState {
  status: ExploreAvailability;
  batch_id: string | null;
  assigned_count: number;
  remaining_count: number;

  discovery_enabled: boolean;
  left_at: string | null;
  server_now: string;
  items?: Array<{
    id: string;
    position: number;
    first_seen_at: string | null;
    action: ExploreAction;
    candidate_id: string;
    display_name: string;
    avatar_path: string;
  }>;
}

export type ExploreAction = "passed" | "interested" | null;

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
  roomId?: string;
  roomName?: string;
  roomStatus?: string;
}

export interface MatchMessage {
  id: string;
  matchId: string;
  senderId: string;
  body: string;
  createdAt: string;
  readAt: string | null;
}

export interface RoomAnalytics {
  room_id: string;
  last_updated: string;
  summary: Record<string, number | null>;
  rates: Record<string, number | null>;
}
