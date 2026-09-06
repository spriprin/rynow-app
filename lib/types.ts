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
  action: DropItemAction;
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
  interest_budget: number;
  interests_used: number;
  cooldown_until: string | null;
  discovery_enabled: boolean;
  left_at: string | null;
  server_now: string;
  items?: Array<{
    id: string;
    position: number;
    first_seen_at: string | null;
    action: DropItemAction;
    candidate_id: string;
    display_name: string;
    avatar_path: string;
  }>;
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

export interface RoomAnalyticsSummary {
  joined_memberships: number;
  active_memberships: number;
  scheduled_drops: number;
  effectively_opened_drops: number;
  claim_attempts: number;
  forming_attempts: number;
  successful_unlocks: number;
  cards_seen: number;
  your_drop_started_participants: number;
  card_seen_participants: number;
  your_drop_started_runs: number;
  your_drop_completed_runs: number;
  your_drop_completed_participants: number;
  interests_sent: number;
  interest_senders: number;
  incoming_interests_opened: number;
  pending_interests: number;
  accepted_interests: number;
  declined_interests: number;
  matches_created: number;
  conversations_started: number;
  median_match_to_first_message_seconds: number | null;
  blocks_count: number;
  reports_count: number;
  discovery_eligible_memberships: number;
  explore_batches_claimed: number;
  explore_batches_completed: number;
  explore_cards_seen: number;
  explore_interests_sent: number;
}

export interface RoomAnalyticsRates {
  unlock_rate: number | null;
  drop_completion_rate: number | null;
  interest_response_rate: number | null;
  interest_acceptance_rate: number | null;
  interest_decline_rate: number | null;
  match_to_conversation_rate: number | null;
}

export interface RoomAnalyticsDrop {
  drop_id: string;
  sequence_number: number;
  scheduled_at: string;
  effective_open_at: string;
  effective_status: "scheduled" | "opened";
  claim_attempts: number;
  forming_attempts: number;
  successful_unlocks: number;
  unlock_rate: number | null;
  cards_seen: number;
  started_runs: number;
  completed_runs: number;
  completion_rate: number | null;
  interests_sent: number;
  incoming_interests_opened: number;
  matches_created: number;
}

export interface RoomAnalytics {
  room_id: string;
  last_updated: string;
  summary: RoomAnalyticsSummary;
  rates: RoomAnalyticsRates;
  drops: RoomAnalyticsDrop[];
  collection_scope: {
    historical: string[];
    sprint4_onward: string[];
  };
  presence_model?: {
    heartbeat_seconds: number;
    recent_active_timeout_seconds: number;
    discovery_eligible_timeout_seconds: number;
    definition: string;
  };
  explore?: {
    batches_claimed: number;
    batches_completed: number;
    cards_seen: number;
    interests_sent: number;
    completion_rate: number | null;
  };
}
