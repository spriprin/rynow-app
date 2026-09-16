"use client";
/* eslint-disable @next/next/no-img-element -- avatars are short-lived signed Supabase Storage URLs. */

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Ban, CalendarDays, Check, DoorOpen, Flag, ImagePlus, LockKeyhole, MapPin, MessageCircle, Radio, RefreshCw, Send, ShieldCheck, Sparkles, Users, X } from "lucide-react";
import type { RealtimeChannel, Session } from "@supabase/supabase-js";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { logDiagnostic, retryRead, userFacingError } from "@/lib/reliability";
import type { DiscoveryPreference, ExploreAction, ExploreItem, ExploreState, FoundationProfile, FoundationRoom, Gender, IncomingInterest, MatchMessage, RoomMatch, RoomPresenceState, RoomWallPerson } from "@/lib/types";
import { isExplicitlyLeft, mergeExploreBuffer, REPORT_CATEGORIES, LEGAL_VERSION, CAUGHT_UP_COPY } from "@/lib/rc1-state";
import { UserArea } from "./UserArea";
import { AuthTurnstile, isTurnstileConfigured, type AuthTurnstileHandle } from "./AuthTurnstile";

type Screen = "loading" | "configuration" | "missing" | "closed" | "not-open" | "verification" | "onboarding" | "profile-completion" | "ready" | "edit-profile" | "room" | "error";
type OnboardingStep = 1 | 2 | 3 | 4;
type RoomWallRpcRow = { id: string; display_name: string; avatar_path: string; joined_at: string };
type ExploreItemRpcRow = { id: string; position: number; first_seen_at: string | null; action: ExploreAction; candidate_id: string; display_name: string; avatar_path: string };
type IncomingInterestRpcRow = { interest_id: string; from_user_id: string; display_name: string; avatar_path: string; created_at: string };
type RoomMatchRpcRow = { match_id: string; other_user_id: string; display_name: string; avatar_path: string; matched_at: string; last_message_at: string | null; last_message_body: string | null; unread_count: number };
type MatchMessageRow = { id: string; match_id: string; sender_id: string; body: string; created_at: string; read_at: string | null };
type SafetyTarget = { userId: string; displayName: string; matchId: string | null; roomId: string };
type ConnectionState = "online" | "offline" | "recovering";

const REPORT_REASONS = REPORT_CATEGORIES;
const PROFILE_SELECT = "id, display_name, avatar_path, age_confirmed_18, gender, discovery_preference, accepted_document_version, accepted_at";
const GENDER_OPTIONS: Array<{ value: Gender; label: string }> = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
];
const DISCOVERY_OPTIONS: Array<{ value: DiscoveryPreference; label: string }> = [
  { value: "female", label: "Women" },
  { value: "male", label: "Men" },
  { value: "everyone", label: "Everyone" },
];
const PRESENCE_HEARTBEAT_MS = 60_000;
const ROOM_POLL_MS = 15_000;
const SIGNED_AVATAR_SECONDS = 300;
const SIGNED_AVATAR_CACHE_MS = 4 * 60 * 1000;
const avatarUrlCache = new Map<string, { url: string; refreshAfter: number }>();

function defaultDiscoveryPreference(gender: Gender): DiscoveryPreference {
  if (gender === "male") return "female";
  if (gender === "female") return "male";
  return "everyone";
}

function hasCompletedDiscoveryProfile(profile: FoundationProfile) {
  return profile.gender !== null && profile.discovery_preference !== null
    && profile.accepted_document_version === LEGAL_VERSION && Boolean(profile.accepted_at);
}

function initialScreenFor(room: FoundationRoom | null | undefined): Screen {
  if (room === null) return "missing";
  if (room && room.status === "draft") return "not-open";
  return "loading";
}

function roomDate(value: string) {
  return new Intl.DateTimeFormat("en", { weekday: "long", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function extensionFor(file: File) {
  const fromMime = file.type.split("/")[1]?.replace("jpeg", "jpg");
  return fromMime?.replace(/[^a-z0-9]/g, "") || "jpg";
}

function mapMessage(row: MatchMessageRow): MatchMessage {
  return { id: row.id, matchId: row.match_id, senderId: row.sender_id, body: row.body, createdAt: row.created_at, readAt: row.read_at };
}

async function signedUrlMap(paths: string[], force = false) {
  const client = getSupabaseBrowserClient();
  const uniquePaths = [...new Set(paths.filter(Boolean))];
  if (!client || !uniquePaths.length) return new Map<string, string>();
  const now = Date.now();
  const pathsToSign = uniquePaths.filter((path) => force || !avatarUrlCache.get(path) || avatarUrlCache.get(path)!.refreshAfter <= now);
  if (pathsToSign.length) {
    try {
      const data = await retryRead("refresh_avatar_urls", async () => {
        const result = await client.storage.from("avatars").createSignedUrls(pathsToSign, SIGNED_AVATAR_SECONDS);
        if (result.error) throw result.error;
        return result.data || [];
      });
      data.forEach((item) => {
        const signedUrl = item.signedUrl;
        const signedPath = item.path;
        if (signedPath && signedUrl) avatarUrlCache.set(signedPath, { url: signedUrl, refreshAfter: now + SIGNED_AVATAR_CACHE_MS });
      });
    } catch {
      // The screen remains usable with initials. The next foreground/read cycle
      // asks Storage for a fresh URL again.
    }
  }
  return new Map(uniquePaths.flatMap((path) => {
    const cached = avatarUrlCache.get(path);
    return cached ? [[path, cached.url] as const] : [];
  }));
}

function ResilientAvatar({ path, url, name, className }: { path: string; url: string; name: string; className?: string }) {
  return <ResilientAvatarImage key={`${path}:${url}`} path={path} url={url} name={name} className={className} />;
}

function ResilientAvatarImage({ path, url, name, className }: { path: string; url: string; name: string; className?: string }) {
  const [source, setSource] = useState(url);
  const [failed, setFailed] = useState(!url);
  const retrying = useRef(false);

  async function recover() {
    if (!path || retrying.current) return setFailed(true);
    retrying.current = true;
    const refreshed = (await signedUrlMap([path], true)).get(path) || "";
    retrying.current = false;
    if (!refreshed || refreshed === source) return setFailed(true);
    setSource(refreshed);
    setFailed(false);
  }

  if (failed || !source) return <span className={className}>{name.slice(0, 1)}</span>;
  return <img className={className} src={source} alt="" onError={() => void recover()} />;
}

export function RoomJoinApp({ joinCode, initialRoom }: { joinCode: string; initialRoom?: FoundationRoom | null }) {
  const [screen, setScreen] = useState<Screen>(() => initialScreenFor(initialRoom));
  const [room, setRoom] = useState<FoundationRoom | null>(initialRoom || null);
  const [profile, setProfile] = useState<FoundationProfile | null>(null);
  const [ownAvatarUrl, setOwnAvatarUrl] = useState("");
  const [wall, setWall] = useState<RoomWallPerson[]>([]);
  const [joinedCount, setJoinedCount] = useState(0);
  const [presence, setPresence] = useState<RoomPresenceState | null>(null);
  const [exploreState, setExploreState] = useState<ExploreState | null>(null);
  const [exploreItems, setExploreItems] = useState<ExploreItem[]>([]);
  const [exploreOpen, setExploreOpen] = useState(false);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const [incomingInterests, setIncomingInterests] = useState<IncomingInterest[]>([]);
  const [incomingOpen, setIncomingOpen] = useState(false);
  const [selectedIncoming, setSelectedIncoming] = useState<IncomingInterest | null>(null);
  const [matches, setMatches] = useState<RoomMatch[]>([]);
  const [matchesOpen, setMatchesOpen] = useState(false);
  const [selectedMatch, setSelectedMatch] = useState<RoomMatch | null>(null);
  const [messages, setMessages] = useState<MatchMessage[]>([]);
  const [matchMoment, setMatchMoment] = useState<RoomMatch | null>(null);
  const [safetyTarget, setSafetyTarget] = useState<SafetyTarget | null>(null);
  const activeExploreItem = useMemo(() => exploreItems.find((item) => item.action === null) || null, [exploreItems]);
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [step, setStep] = useState<OnboardingStep>(1);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [gender, setGender] = useState<Gender | "">("");
  const [discoveryPreference, setDiscoveryPreference] = useState<DiscoveryPreference | "">("");
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [discoveryError, setDiscoveryError] = useState("");
  const [connectionState, setConnectionState] = useState<ConnectionState>(() => typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "online");
  const [recoveryEpoch, setRecoveryEpoch] = useState(0);
  const bootstrapStarted = useRef(false);
  const anonymousSignInPending = useRef(false);
  const turnstileRef = useRef<AuthTurnstileHandle | undefined>(undefined);
  const markingSeen = useRef(new Set<string>());
  const markingIncomingOpened = useRef(new Set<string>());
  const polling = useRef(false);
  const realtimeReconnectAttempts = useRef(0);
  const sendingMessage = useRef(false);
  const messageAttempt = useRef<{ matchId: string; body: string; id: string } | null>(null);
  const submittingReport = useRef(false);
  const reportAttempt = useRef<{ fingerprint: string; id: string } | null>(null);
  const profileCompletionHasMembership = useRef(false);
  const profileEditorReturn = useRef<"ready" | "room">("ready");
  const selectedMatchId = selectedMatch?.id || "";
  const activeRoomId = room?.id || "";
  const activeRoomStatus = room?.status;

  useEffect(() => () => {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
  }, [photoPreview]);

  const loadWall = useCallback(async (roomId: string) => {
    const client = getSupabaseBrowserClient();
    if (!client) return;
    const [countResult, wallResult] = await retryRead("load_room_wall", async () => {
      const results = await Promise.all([
        client.rpc("room_joined_count", { p_room_id: roomId }),
        client.rpc("room_wall_profiles", { p_room_id: roomId, p_limit: 12 }),
      ]);
      if (results[0].error) throw results[0].error;
      if (results[1].error) throw results[1].error;
      return results;
    }, { roomId });
    const count = countResult.data;
    const wallProfiles = wallResult.data;
    setJoinedCount(Number(count || 0));
    const visibleProfiles = (wallProfiles || []) as RoomWallRpcRow[];
    const urls = await signedUrlMap(visibleProfiles.map((item) => String(item.avatar_path)));
    setWall(visibleProfiles.map((item) => ({ id: String(item.id), displayName: String(item.display_name), avatarPath: String(item.avatar_path), avatarUrl: urls.get(String(item.avatar_path)) || "" })));
  }, []);

  const loadConnections = useCallback(async (roomId: string) => {
    const client = getSupabaseBrowserClient();
    if (!client) return [];
    const data = await retryRead("load_matches", async () => {
      const result = await client.rpc("room_matches", { p_room_id: roomId });
      if (result.error) throw result.error;
      return result.data;
    }, { roomId });
    const rows = (data || []) as RoomMatchRpcRow[];
    const urls = await signedUrlMap(rows.map((item) => item.avatar_path));
    const nextMatches = rows.map((item) => ({
      id: item.match_id,
      roomId,
      otherUserId: item.other_user_id,
      displayName: item.display_name,
      avatarPath: item.avatar_path,
      avatarUrl: urls.get(item.avatar_path) || "",
      matchedAt: item.matched_at,
      lastMessageAt: item.last_message_at,
      lastMessageBody: item.last_message_body,
      unreadCount: Number(item.unread_count || 0),
    } satisfies RoomMatch));
    setMatches(nextMatches);
    setSelectedMatch((current) => current ? nextMatches.find((item) => item.id === current.id) || (current.roomId !== roomId ? current : null) : null);
    return nextMatches;
  }, []);

  const loadMessages = useCallback(async (matchId: string) => {
    const client = getSupabaseBrowserClient();
    if (!client) return;
    const data = await retryRead("load_messages", async () => {
      const result = await client.from("messages").select("id, match_id, sender_id, body, created_at, read_at").eq("match_id", matchId).order("created_at").order("id");
      if (result.error) throw result.error;
      return result.data;
    }, { matchId });
    setMessages(((data || []) as MatchMessageRow[]).map(mapMessage));
    await client.rpc("mark_match_messages_read", { p_match_id: matchId });
    await client.rpc("mark_notifications_read", { p_kind: "message", p_room_id: null, p_match_id: matchId });
  }, []);

  const mapExploreItems = useCallback(async (rows: ExploreItemRpcRow[]) => {
    const urls = await signedUrlMap(rows.map((item) => item.avatar_path));
    return rows.map((item) => ({
      id: item.id,
      position: Number(item.position),
      firstSeenAt: item.first_seen_at,
      action: item.action,
      candidateId: item.candidate_id,
      displayName: item.display_name,
      avatarPath: item.avatar_path,
      avatarUrl: urls.get(item.avatar_path) || "",
    } satisfies ExploreItem));
  }, []);

  const loadPresence = useCallback(async (roomId: string) => {
    const client = getSupabaseBrowserClient();
    if (!client) return null;
    const result = await client.rpc("room_presence_state", { p_room_id: roomId });
    if (result.error) throw result.error;
    const nextPresence = (Array.isArray(result.data) ? result.data[0] : result.data) as RoomPresenceState | null;
    setPresence(nextPresence);
    return nextPresence;
  }, []);

  const loadExploreState = useCallback(async (roomId: string) => {
    const client = getSupabaseBrowserClient();
    if (!client) return null;
    const result = await client.rpc("claim_explore_batch", { p_room_id: roomId });
    if (result.error) throw result.error;
    const nextState = result.data as ExploreState;
    const items = await mapExploreItems((nextState?.items || []) as ExploreItemRpcRow[]);
    setExploreState(nextState);
    setExploreItems((current) => mergeExploreBuffer(current, items));
    return nextState;
  }, [mapExploreItems]);

  const loadDiscovery = useCallback(async (roomId: string) => {
    const client = getSupabaseBrowserClient();
    if (!client) return;
    const [, incomingResult] = await Promise.all([
      loadExploreState(roomId),
      client.rpc("interested_in_you", { p_room_id: roomId }),
    ]);
    if (incomingResult.error) throw incomingResult.error;
    const incoming = (incomingResult.data || []) as IncomingInterestRpcRow[];
    const urls = await signedUrlMap(incoming.map((item) => item.avatar_path));
    setIncomingInterests(incoming.map((item) => ({ interestId: item.interest_id, fromUserId: item.from_user_id, displayName: item.display_name, avatarPath: item.avatar_path, avatarUrl: urls.get(item.avatar_path) || "", createdAt: item.created_at })));
  }, [loadExploreState]);

  const clearDiscovery = useCallback(() => {
    setWall([]); setExploreItems([]); setExploreState(null); setExploreOpen(false);
    setIncomingInterests([]); setIncomingOpen(false); setSelectedIncoming(null);
  }, []);

  const heartbeat = useCallback(async (roomId: string) => {
    if (document.visibilityState === "hidden" || !navigator.onLine) return;
    const client = getSupabaseBrowserClient();
    if (!client) return;
    const { error: heartbeatError } = await client.rpc("heartbeat_room_presence", { p_room_id: roomId });
    if (heartbeatError) {
      logDiagnostic("presence_heartbeat", heartbeatError, { roomId });
      throw heartbeatError;
    }
  }, []);

  const refreshRoom = useCallback(async (roomId: string, resumePresence = false) => {
    const client = getSupabaseBrowserClient();
    if (!client || !navigator.onLine) return;
    const resolvedRoom = await retryRead("refresh_room", async () => {
      const result = await client.rpc("get_room_by_join_code", { p_join_code: joinCode });
      if (result.error) throw result.error;
      return (Array.isArray(result.data) ? result.data[0] : result.data) as FoundationRoom | undefined;
    }, { roomId });
    if (!resolvedRoom) throw new Error("Room not found");
    setRoom(resolvedRoom);

    if (resolvedRoom.status === "closed") {
      setIncomingOpen(false);
      setSelectedIncoming(null);
      setDiscoveryError("");
      await loadConnections(roomId);
      setConnectionState("online");
      return;
    }

    const restoredPresence = await loadPresence(roomId);
    if (isExplicitlyLeft(restoredPresence)) {
      clearDiscovery();
      await loadConnections(roomId);
      setConnectionState("online");
      return;
    }
    if (resumePresence) await heartbeat(roomId);
    await Promise.all([loadWall(roomId), loadDiscovery(roomId), loadConnections(roomId)]);
    setConnectionState("online");
  }, [clearDiscovery, heartbeat, joinCode, loadConnections, loadDiscovery, loadPresence, loadWall]);

  const enterRoom = useCallback(async (resolvedRoom: FoundationRoom) => {
    const client = getSupabaseBrowserClient();
    if (!client) return;
    const { error: joinError } = await client.rpc("join_room_by_code", { p_join_code: joinCode });
    if (joinError) throw joinError;
    const restoredPresence = await loadPresence(resolvedRoom.id);
    if (isExplicitlyLeft(restoredPresence)) {
      clearDiscovery();
      await loadConnections(resolvedRoom.id);
    } else {
      await Promise.all([loadWall(resolvedRoom.id), loadDiscovery(resolvedRoom.id), loadConnections(resolvedRoom.id)]);
    }
    setConnectionState("online");
    setScreen("room");
  }, [clearDiscovery, joinCode, loadConnections, loadDiscovery, loadPresence, loadWall]);

  const continueGuestSession = useCallback(async (resolvedRoom: FoundationRoom, session: Session) => {
    const client = getSupabaseBrowserClient();
    if (!client) throw new Error("Supabase is not configured");
    const userId = session.user.id;
    const { data: savedProfile, error: profileError } = await client.from("profiles").select(PROFILE_SELECT).eq("id", userId).maybeSingle();
    if (profileError) throw profileError;
    if (!savedProfile) {
      setScreen(resolvedRoom.status === "closed" ? "closed" : "onboarding");
      return;
    }

    const typedProfile = savedProfile as FoundationProfile;
    setProfile(typedProfile);
    setDisplayName(typedProfile.display_name);
    setGender(typedProfile.gender || "");
    setDiscoveryPreference(typedProfile.discovery_preference || (typedProfile.gender ? defaultDiscoveryPreference(typedProfile.gender) : ""));
    setLegalAccepted(typedProfile.accepted_document_version === LEGAL_VERSION && Boolean(typedProfile.accepted_at));
    const ownUrls = await signedUrlMap([typedProfile.avatar_path]);
    setOwnAvatarUrl(ownUrls.get(typedProfile.avatar_path) || "");
    const { data: membership, error: membershipError } = await client.from("room_members").select("room_id").eq("room_id", resolvedRoom.id).eq("user_id", userId).maybeSingle();
    if (membershipError) throw membershipError;
    if (resolvedRoom.status === "closed") {
      if (!membership) {
        setScreen("closed");
        return;
      }
      await loadConnections(resolvedRoom.id);
      setScreen("room");
      return;
    }
    if (!hasCompletedDiscoveryProfile(typedProfile)) {
      profileCompletionHasMembership.current = Boolean(membership);
      setScreen("profile-completion");
      return;
    }
    if (membership) await enterRoom(resolvedRoom);
    else setScreen("ready");
  }, [enterRoom, loadConnections]);

  useEffect(() => {
    if (bootstrapStarted.current) return;
    bootstrapStarted.current = true;
    async function bootstrap() {
      if (!isSupabaseConfigured()) return setScreen("configuration");
      const client = getSupabaseBrowserClient();
      if (!client) return setScreen("configuration");
      let resolvedRoom = initialRoom || undefined;
      if (initialRoom === null) return setScreen("missing");
      if (initialRoom === undefined) {
        const { data: roomData, error: roomError } = await client.rpc("get_room_by_join_code", { p_join_code: joinCode });
        if (roomError) throw roomError;
        resolvedRoom = (Array.isArray(roomData) ? roomData[0] : roomData) as FoundationRoom | undefined;
      }
      if (!resolvedRoom) return setScreen("missing");
      setRoom(resolvedRoom);
      if (resolvedRoom.status === "draft") return setScreen("not-open");

      const { data: sessionData } = await client.auth.getSession();
      if (!sessionData.session && resolvedRoom.status === "open") {
        if (!isTurnstileConfigured()) {
          setError("Guest verification is not configured for new sessions.");
          setScreen("configuration");
          return;
        }
        setScreen("verification");
        return;
      }
      if (!sessionData.session) return setScreen("closed");
      await continueGuestSession(resolvedRoom, sessionData.session);
    }
    void bootstrap().catch((reason: unknown) => {
      logDiagnostic("guest_bootstrap", reason);
      setError(userFacingError(reason, "Something went wrong while opening this Room. Please try again."));
      setScreen("error");
    });
  }, [continueGuestSession, initialRoom, joinCode]);

  const completeAnonymousVerification = useCallback(async (captchaToken: string) => {
    if (!room || room.status !== "open" || anonymousSignInPending.current) return;
    anonymousSignInPending.current = true;
    setBusy(true);
    setError("");
    let createdSession: Session | null = null;
    let resetChallenge = false;
    try {
      const client = getSupabaseBrowserClient();
      if (!client) throw new Error("Supabase is not configured");
      const { data, error: anonymousError } = await client.auth.signInAnonymously({
        options: { captchaToken },
      });
      if (anonymousError || !data.session) throw anonymousError || new Error("Could not create guest session");
      createdSession = data.session;
      setScreen("loading");
      await continueGuestSession(room, createdSession);
    } catch (reason) {
      logDiagnostic("anonymous_guest_verification", reason, { roomId: room.id });
      setError(userFacingError(reason, "We couldn’t complete the quick security check. Please try again."));
      if (createdSession) {
        setScreen("error");
      } else {
        resetChallenge = true;
      }
    } finally {
      anonymousSignInPending.current = false;
      setBusy(false);
      if (resetChallenge) turnstileRef.current?.reset();
    }
  }, [continueGuestSession, room]);

  useEffect(() => {
    if (screen !== "room" || !activeRoomId) return;
    const runPoll = async () => {
      if (document.visibilityState === "hidden" || !navigator.onLine || polling.current) return;
      polling.current = true;
      try {
        await refreshRoom(activeRoomId);
        if (selectedMatchId) await loadMessages(selectedMatchId);
      } catch (reason) {
        setConnectionState("recovering");
        logDiagnostic("room_poll", reason, { roomId: activeRoomId });
      } finally {
        polling.current = false;
      }
    };
    const timer = window.setInterval(() => { void runPoll(); }, ROOM_POLL_MS);
    return () => window.clearInterval(timer);
  }, [activeRoomId, loadMessages, refreshRoom, screen, selectedMatchId]);

  useEffect(() => {
    if (screen !== "room" || !activeRoomId || activeRoomStatus !== "open" || presence?.discovery_enabled === false) return;
    const sendHeartbeat = async () => {
      if (document.visibilityState === "hidden" || !navigator.onLine) return;
      try {
        await heartbeat(activeRoomId);
      } catch {
        setConnectionState("recovering");
      }
    };
    void sendHeartbeat();
    const timer = window.setInterval(() => { void sendHeartbeat(); }, PRESENCE_HEARTBEAT_MS);
    return () => window.clearInterval(timer);
  }, [activeRoomId, activeRoomStatus, heartbeat, presence?.discovery_enabled, screen]);

  useEffect(() => {
    if (screen !== "room" || !activeRoomId) return;
    const recover = () => {
      if (!navigator.onLine) return;
      realtimeReconnectAttempts.current = 0;
      setConnectionState("recovering");
      setRecoveryEpoch((current) => current + 1);
      void refreshRoom(activeRoomId, activeRoomStatus === "open").catch((reason: unknown) => {
        logDiagnostic("foreground_recovery", reason, { roomId: activeRoomId });
        setConnectionState("recovering");
      });
    };
    const handleOnline = () => recover();
    const handleOffline = () => setConnectionState("offline");
    const handleVisibility = () => {
      if (document.visibilityState === "visible") recover();
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [activeRoomId, activeRoomStatus, refreshRoom, screen]);

  useEffect(() => {
    if (!selectedMatchId) return;
    const client = getSupabaseBrowserClient();
    if (!client) return;
    let active = true;
    let channel: RealtimeChannel | null = null;
    let reconnectTimer: number | undefined;
    void (async () => {
      const { data: { session } } = await client.auth.getSession();
      if (session) await client.realtime.setAuth(session.access_token);
      if (!active) return;
      channel = client
        .channel(`match-${selectedMatchId}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `match_id=eq.${selectedMatchId}` }, (payload) => {
          const message = mapMessage(payload.new as MatchMessageRow);
          setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message]);
          if (message.senderId !== profile?.id) {
            void client.rpc("mark_match_messages_read", { p_match_id: selectedMatchId });
            void client.rpc("mark_notifications_read", { p_kind: "message", p_room_id: null, p_match_id: selectedMatchId });
          }
        })
        .subscribe((status, statusError) => {
          if (!active) return;
          if (status === "SUBSCRIBED") {
            realtimeReconnectAttempts.current = 0;
            setConnectionState("online");
            void loadMessages(selectedMatchId).catch((reason: unknown) => {
              logDiagnostic("realtime_history_recovery", reason, { matchId: selectedMatchId });
            });
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            setConnectionState(navigator.onLine ? "recovering" : "offline");
            logDiagnostic("realtime_subscription", statusError || new Error(status), { matchId: selectedMatchId });
            if (navigator.onLine && document.visibilityState === "visible" && realtimeReconnectAttempts.current < 8) {
              realtimeReconnectAttempts.current += 1;
              reconnectTimer = window.setTimeout(
                () => { if (active) setRecoveryEpoch((current) => current + 1); },
                Math.min(10_000, 1_500 * realtimeReconnectAttempts.current),
              );
            }
          }
        });
    })();
    return () => {
      active = false;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (channel) void client.removeChannel(channel);
    };
  }, [loadMessages, profile?.id, recoveryEpoch, selectedMatchId]);

  useEffect(() => {
    if (!exploreOpen || !activeExploreItem || activeExploreItem.firstSeenAt || markingSeen.current.has(activeExploreItem.id)) return;
    const client = getSupabaseBrowserClient();
    if (!client) return;
    markingSeen.current.add(activeExploreItem.id);
    void client.rpc("mark_explore_item_seen", { p_explore_item_id: activeExploreItem.id }).then(({ data, error: seenError }) => {
      markingSeen.current.delete(activeExploreItem.id);
      if (seenError) {
        logDiagnostic("mark_explore_item_seen", seenError, { roomId: room?.id, discoveryId: exploreState?.batch_id || undefined });
        return setDiscoveryError(userFacingError(seenError, "We couldn’t open this profile. Try again."));
      }
      setExploreItems((current) => current.map((item) => item.id === activeExploreItem.id ? { ...item, firstSeenAt: String(data) } : item));
    });
  }, [activeExploreItem, exploreOpen, exploreState?.batch_id, room?.id]);

  useEffect(() => {
    if (!incomingOpen || !selectedIncoming || markingIncomingOpened.current.has(selectedIncoming.interestId)) return;
    const client = getSupabaseBrowserClient();
    if (!client) return;
    const interestId = selectedIncoming.interestId;
    markingIncomingOpened.current.add(interestId);
    void client.rpc("mark_incoming_interest_opened", { p_interest_id: interestId }).then(({ error: openedError }) => {
      markingIncomingOpened.current.delete(interestId);
      if (openedError) {
        logDiagnostic("mark_incoming_interest_opened", openedError, { roomId: room?.id });
        setError(userFacingError(openedError, "We couldn’t update this Interest. Try again."));
      }
    });
    void client.rpc("mark_notifications_read", { p_kind: "interest", p_room_id: room?.id || null, p_match_id: null });
  }, [incomingOpen, room?.id, selectedIncoming]);

  function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return setError("Choose an image file.");
    if (file.size > 5 * 1024 * 1024) return setError("Photo must be smaller than 5 MB.");
    setPhotoFile(file); setPhotoPreview(URL.createObjectURL(file)); setError("");
  }

  async function finishOnboarding() {
    if (!room || !photoFile || displayName.trim().length < 2 || !gender || !ageConfirmed || !legalAccepted) return;
    setBusy(true); setError("");
    let persistedProfile: FoundationProfile | null = null;
    let uploadedPath = "";
    try {
      const client = getSupabaseBrowserClient();
      if (!client) throw new Error("Supabase is not configured");
      const { data: userData, error: userError } = await client.auth.getUser();
      if (userError || !userData.user) throw userError || new Error("Guest session not found");
      const avatarPath = `${userData.user.id}/avatar-${crypto.randomUUID()}.${extensionFor(photoFile)}`;
      const { error: uploadError } = await client.storage.from("avatars").upload(avatarPath, photoFile, { contentType: photoFile.type, cacheControl: "300", upsert: false });
      if (uploadError) throw uploadError;
      uploadedPath = avatarPath;
      const nextProfile: FoundationProfile = {
        id: userData.user.id,
        display_name: displayName.trim(),
        avatar_path: avatarPath,
        age_confirmed_18: true,
        gender,
        discovery_preference: discoveryPreference || defaultDiscoveryPreference(gender),
      };
      const { error: profileError } = await client.from("profiles").insert(nextProfile);
      if (profileError) throw profileError;
      persistedProfile = nextProfile;
      setProfile(nextProfile);
      const accepted = await client.rpc("accept_pilot_terms", { p_version: LEGAL_VERSION });
      if (accepted.error) throw accepted.error;
      nextProfile.accepted_document_version = LEGAL_VERSION;
      nextProfile.accepted_at = String(accepted.data);
      const ownUrls = await signedUrlMap([avatarPath], true);
      const signedAvatarUrl = ownUrls.get(avatarPath) || "";
      setOwnAvatarUrl(signedAvatarUrl || photoPreview);
      setPhotoFile(null);
      if (signedAvatarUrl) setPhotoPreview("");
      await enterRoom(room);
    } catch (reason) {
      logDiagnostic("finish_onboarding", reason, { roomId: room.id });
      const client = getSupabaseBrowserClient();
      if (!persistedProfile && uploadedPath && client) void client.storage.from("avatars").remove([uploadedPath]);
      if (persistedProfile) {
        profileCompletionHasMembership.current = false;
        setProfile({ ...persistedProfile });
        setOwnAvatarUrl(photoPreview);
        setScreen("profile-completion");
        setError("Your profile was saved. Continue to finish entering the Room.");
      } else {
        setError(userFacingError(reason, "We couldn’t finish your profile. Try again."));
      }
    }
    finally { setBusy(false); }
  }

  async function finishProfileCompletion() {
    const needsLegalAcceptance = Boolean(profile && (profile.accepted_document_version !== LEGAL_VERSION || !profile.accepted_at));
    if (!room || !profile || !gender || (needsLegalAcceptance && !legalAccepted)) return;
    setBusy(true); setError("");
    try {
      const client = getSupabaseBrowserClient();
      if (!client) throw new Error("Supabase is not configured");
      const { data: userData, error: userError } = await client.auth.getUser();
      if (userError || !userData.user || userData.user.id !== profile.id) throw userError || new Error("Guest session not found");
      const preference = discoveryPreference || defaultDiscoveryPreference(gender);
      const { data: savedProfile, error: profileError } = await client.from("profiles")
        .update({ gender, discovery_preference: preference })
        .eq("id", userData.user.id)
        .select(PROFILE_SELECT)
        .single();
      if (profileError || !savedProfile) throw profileError || new Error("Profile could not be saved");
      const nextProfile = savedProfile as FoundationProfile;
      if (needsLegalAcceptance) {
        const accepted = await client.rpc("accept_pilot_terms", { p_version: LEGAL_VERSION });
        if (accepted.error) throw accepted.error;
        nextProfile.accepted_document_version = LEGAL_VERSION;
        nextProfile.accepted_at = String(accepted.data);
      }
      setProfile(nextProfile);
      setGender(nextProfile.gender || "");
      setDiscoveryPreference(nextProfile.discovery_preference || "");
      if (profileCompletionHasMembership.current) await enterRoom(room);
      else setScreen("ready");
    } catch (reason) {
      logDiagnostic("complete_profile_preferences", reason, { roomId: room.id });
      setError(userFacingError(reason, "We couldn’t update your profile. Try again."));
    }
    finally { setBusy(false); }
  }

  function openProfileEditor(returnTo: "ready" | "room") {
    if (!profile) return;
    profileEditorReturn.current = returnTo;
    setPhotoFile(null);
    setPhotoPreview("");
    setDisplayName(profile.display_name);
    setGender(profile.gender || "");
    setDiscoveryPreference(profile.discovery_preference || (profile.gender ? defaultDiscoveryPreference(profile.gender) : ""));
    setError("");
    setScreen("edit-profile");
  }

  function cancelProfileEditor() {
    if (!profile) return;
    setPhotoFile(null);
    setPhotoPreview("");
    setDisplayName(profile.display_name);
    setGender(profile.gender || "");
    setDiscoveryPreference(profile.discovery_preference || (profile.gender ? defaultDiscoveryPreference(profile.gender) : ""));
    setError("");
    setScreen(profileEditorReturn.current);
  }

  async function saveReturningProfile() {
    if (!profile || displayName.trim().length < 2 || !gender || !discoveryPreference) return;
    const client = getSupabaseBrowserClient();
    if (!client) return setError("Profile editing isn’t configured.");
    const profileClient = client;
    setBusy(true); setError("");
    let uploadedPath = "";
    const expectedDisplayName = displayName.trim();
    let expectedAvatarPath = profile.avatar_path;
    const expectedGender = gender;
    const expectedDiscoveryPreference = discoveryPreference;

    async function removeAvatarWithRetry(path: string, diagnostic: string) {
      let lastError: unknown = null;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const { error: removeError } = await profileClient.storage.from("avatars").remove([path]);
        if (!removeError) return null;
        lastError = removeError;
        if (attempt < 3) await new Promise((resolve) => window.setTimeout(resolve, attempt * 250));
      }
      logDiagnostic(diagnostic, lastError);
      return lastError;
    }

    async function applySavedProfile(savedProfile: FoundationProfile) {
      const ownUrls = await signedUrlMap([savedProfile.avatar_path], true);
      if (savedProfile.avatar_path !== profile!.avatar_path) avatarUrlCache.delete(profile!.avatar_path);
      setProfile(savedProfile);
      setDisplayName(savedProfile.display_name);
      setGender(savedProfile.gender || "");
      setDiscoveryPreference(savedProfile.discovery_preference || "");
      setOwnAvatarUrl(ownUrls.get(savedProfile.avatar_path) || (savedProfile.avatar_path === profile!.avatar_path ? ownAvatarUrl : ""));
      setPhotoFile(null);
      setPhotoPreview("");
      setScreen(profileEditorReturn.current);
      if (profileEditorReturn.current === "room" && room?.status === "open") {
        void loadDiscovery(room.id).catch((reason: unknown) => logDiagnostic("refresh_discovery_after_profile_edit", reason, { roomId: room.id }));
      }
    }

    try {
      const { data: userData, error: userError } = await client.auth.getUser();
      if (userError || !userData.user || userData.user.id !== profile.id) throw userError || new Error("Guest session not found");

      if (photoFile) {
        expectedAvatarPath = `${userData.user.id}/avatar-${crypto.randomUUID()}.${extensionFor(photoFile)}`;
        const { error: uploadError } = await client.storage.from("avatars").upload(expectedAvatarPath, photoFile, { contentType: photoFile.type, cacheControl: "300", upsert: false });
        if (uploadError) throw uploadError;
        uploadedPath = expectedAvatarPath;
      }

      const { data: savedProfile, error: profileError } = await client.from("profiles")
        .update({
          display_name: expectedDisplayName,
          avatar_path: expectedAvatarPath,
          gender: expectedGender,
          discovery_preference: expectedDiscoveryPreference,
        })
        .eq("id", userData.user.id)
        .select(PROFILE_SELECT)
        .single();
      if (profileError || !savedProfile) throw profileError || new Error("Profile could not be saved");

      const nextProfile = savedProfile as FoundationProfile;
      let cleanupError: unknown = null;
      if (uploadedPath && profile.avatar_path !== uploadedPath) {
        cleanupError = await removeAvatarWithRetry(profile.avatar_path, "remove_replaced_avatar");
      }
      await applySavedProfile(nextProfile);
      if (cleanupError) setError("Profile updated. We couldn't remove the previous stored photo yet. A previously opened link can remain cached for up to one hour (new uploads: five minutes).");
    } catch (reason) {
      const { data: currentProfile, error: reconciliationError } = await client.from("profiles")
        .select(PROFILE_SELECT)
        .eq("id", profile.id)
        .maybeSingle();
      const reconciled = currentProfile as FoundationProfile | null;

      if (!reconciliationError
        && reconciled?.display_name === expectedDisplayName
        && reconciled.avatar_path === expectedAvatarPath
        && reconciled.gender === expectedGender
        && reconciled.discovery_preference === expectedDiscoveryPreference) {
        let cleanupError: unknown = null;
        if (uploadedPath && profile.avatar_path !== uploadedPath) {
          cleanupError = await removeAvatarWithRetry(profile.avatar_path, "remove_replaced_avatar_after_reconciliation");
        }
        await applySavedProfile(reconciled);
        if (cleanupError) setError("Profile updated. We couldn't remove the previous stored photo yet. A previously opened link can remain cached for up to one hour (new uploads: five minutes).");
        return;
      }

      if (reconciliationError) {
        logDiagnostic("reconcile_profile_update", reconciliationError);
      } else if (uploadedPath && reconciled?.avatar_path !== uploadedPath) {
        await removeAvatarWithRetry(uploadedPath, "rollback_profile_avatar");
      }
      logDiagnostic("edit_profile", reason);
      setError(userFacingError(reason, "We couldn’t update your profile. Try again."));
    }
    finally { setBusy(false); }
  }

  async function joinReturningGuest() {
    if (!room) return;
    setBusy(true); setError("");
    try { await enterRoom(room); }
    catch (reason) {
      logDiagnostic("join_room", reason, { roomId: room.id });
      setError(userFacingError(reason, "We couldn’t join this Room. Try again."));
    }
    finally { setBusy(false); }
  }

  async function openExplore() {
    if (!room || presence?.discovery_enabled === false) return;
    setBusy(true); setDiscoveryError("");
    try {
      const client = getSupabaseBrowserClient();
      if (!client) throw new Error("Supabase is not configured");
      const { data, error: exploreError } = await client.rpc("claim_explore_batch", { p_room_id: room.id });
      if (exploreError) throw exploreError;
      const nextState = (Array.isArray(data) ? data[0] : data) as ExploreState | null;
      const items = await mapExploreItems((nextState?.items || []) as ExploreItemRpcRow[]);
      setExploreState(nextState);
      setExploreItems(items);
      setExploreOpen(true);
    } catch (reason) {
      logDiagnostic("claim_explore_batch", reason, { roomId: room.id });
      setDiscoveryError(userFacingError(reason, "We couldn’t open Explore. Try again."));
    }
    finally { setBusy(false); }
  }

  async function actOnExploreItem(action: "passed" | "interested") {
    if (!activeExploreItem?.firstSeenAt || !room) return;
    setBusy(true); setDiscoveryError("");
    try {
      const client = getSupabaseBrowserClient();
      if (!client) throw new Error("Supabase is not configured");
      if (action === "interested") {
        const { error: interestError } = await client.rpc("send_explore_interest", { p_explore_item_id: activeExploreItem.id });
        if (interestError) throw interestError;
      } else {
        const { error: passError } = await client.rpc("pass_explore_item", { p_explore_item_id: activeExploreItem.id });
        if (passError) throw passError;
      }
      setExploreItems((current) => current.map((item) => item.id === activeExploreItem.id ? { ...item, action } : item));
      await loadExploreState(room.id);
    } catch (reason) {
      logDiagnostic(`explore_${action}`, reason, { roomId: room.id, discoveryId: exploreState?.batch_id || undefined });
      setDiscoveryError(userFacingError(reason, "We couldn’t save this choice. Try again."));
    }
    finally { setBusy(false); }
  }

  async function leaveEvent() {
    if (!room) return;
    setBusy(true); setError("");
    try {
      const client = getSupabaseBrowserClient();
      if (!client) throw new Error("Supabase is not configured");
      const { error: leaveError } = await client.rpc("leave_room_presence", { p_room_id: room.id });
      if (leaveError) throw leaveError;
      setLeaveConfirmOpen(false);
      setExploreOpen(false);
      clearDiscovery();
      await Promise.all([loadPresence(room.id), loadConnections(room.id)]);
    } catch (reason) {
      logDiagnostic("leave_event", reason, { roomId: room.id });
      setError(userFacingError(reason, "We couldn’t leave this event. Try again."));
    }
    finally { setBusy(false); }
  }

  async function rejoinEvent() {
    if (!room) return;
    setBusy(true); setError("");
    try {
      const client = getSupabaseBrowserClient();
      if (!client) throw new Error("Supabase is not configured");
      const { error: rejoinError } = await client.rpc("rejoin_room_presence", { p_room_id: room.id });
      if (rejoinError) throw rejoinError;
      await Promise.all([loadPresence(room.id), loadWall(room.id), loadDiscovery(room.id), loadConnections(room.id)]);
    } catch (reason) {
      logDiagnostic("rejoin_event", reason, { roomId: room.id });
      setError(userFacingError(reason, "We couldn’t rejoin this event. Try again."));
    }
    finally { setBusy(false); }
  }

  async function respondToIncoming(interested: boolean) {
    if (!selectedIncoming || !room) return;
    setBusy(true); setError("");
    try {
      const client = getSupabaseBrowserClient();
      if (!client) throw new Error("Supabase is not configured");
      const { data: matchId, error: responseError } = await client.rpc("respond_to_interest", { p_interest_id: selectedIncoming.interestId, p_interested: interested });
      if (responseError) throw responseError;
      setSelectedIncoming(null);
      await loadDiscovery(room.id);
      const nextMatches = await loadConnections(room.id);
      if (interested && matchId) {
        const createdMatch = nextMatches.find((item) => item.id === matchId);
        if (createdMatch) setMatchMoment(createdMatch);
      }
    } catch (reason) {
      logDiagnostic("respond_to_interest", reason, { roomId: room.id });
      setError(userFacingError(reason, "We couldn’t save your response. Try again."));
    }
    finally { setBusy(false); }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedMatch || !room || sendingMessage.current) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const body = String(form.get("message") || "").trim();
    if (!body) return;
    sendingMessage.current = true;
    const attempt = messageAttempt.current?.matchId === selectedMatch.id && messageAttempt.current.body === body
      ? messageAttempt.current
      : { matchId: selectedMatch.id, body, id: crypto.randomUUID() };
    messageAttempt.current = attempt;
    setBusy(true); setError("");
    try {
      const client = getSupabaseBrowserClient();
      if (!client) throw new Error("Supabase is not configured");
      const { data, error: messageError } = await client.rpc("send_match_message_idempotent", {
        p_match_id: selectedMatch.id,
        p_body: body,
        p_client_message_id: attempt.id,
      });
      if (messageError) throw messageError;
      const row = (Array.isArray(data) ? data[0] : data) as MatchMessageRow | null;
      if (row) {
        const message = mapMessage(row);
        setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message]);
      }
      messageAttempt.current = null;
      formElement.reset();
      await loadConnections(room.id);
    } catch (reason) {
      logDiagnostic("send_message", reason, { roomId: room.id, matchId: selectedMatch.id });
      setError(userFacingError(reason, "We couldn’t send this message. Try again."));
    }
    finally { sendingMessage.current = false; setBusy(false); }
  }

  function openConversation(match: RoomMatch) {
    setSelectedMatch(match); setMessages([]); setError("");
    void loadMessages(match.id).catch((reason: unknown) => setError(userFacingError(reason, "We couldn’t open this conversation. Try again.")));
  }

  async function blockPerson(target: SafetyTarget) {
    if (!room) return;
    setBusy(true); setError("");
    try {
      const client = getSupabaseBrowserClient();
      if (!client) throw new Error("Supabase is not configured");
      const { error: blockError } = await client.rpc("block_user_rc1", {
        p_blocked_id: target.userId,
        p_room_id: target.roomId,
        p_match_id: target.matchId,
      });
      if (blockError) throw blockError;
      setSafetyTarget(null); setSelectedIncoming(null); setSelectedMatch(null); setMatchMoment(null);
      setExploreItems((current) => current.map((item) => item.candidateId === target.userId ? { ...item, action: "passed" } : item));
      if (room.status === "open") {
        await loadExploreState(room.id);
        await loadDiscovery(room.id);
      }
      await loadConnections(room.id);
    } catch (reason) {
      logDiagnostic("block_person", reason, { roomId: room.id, matchId: target.matchId || undefined });
      setError(userFacingError(reason, "We couldn’t complete this Block. Try again."));
    }
    finally { setBusy(false); }
  }

  async function submitSafetyReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!safetyTarget || !room || submittingReport.current) return;
    const form = new FormData(event.currentTarget);
    const shouldBlock = form.get("block") === "true";
    const shareWithEventStaff = form.get("shareWithEventStaff") === "true";
    const reason = String(form.get("reason") || "");
    const details = String(form.get("details") || "").trim() || null;
    const fingerprint = JSON.stringify([safetyTarget.userId, safetyTarget.roomId, safetyTarget.matchId, reason, details, shouldBlock, shareWithEventStaff]);
    const attempt = reportAttempt.current?.fingerprint === fingerprint
      ? reportAttempt.current
      : { fingerprint, id: crypto.randomUUID() };
    reportAttempt.current = attempt;
    submittingReport.current = true;
    setBusy(true); setError("");
    try {
      const client = getSupabaseBrowserClient();
      if (!client) throw new Error("Supabase is not configured");
      const { error: reportError } = await client.rpc("submit_report_rc1", {
        p_reported_user_id: safetyTarget.userId,
        p_room_id: safetyTarget.roomId,
        p_match_id: safetyTarget.matchId,
        p_category: reason,
        p_details: details,
        p_block: shouldBlock,
        p_share_with_event_staff: shareWithEventStaff,
        p_client_action_id: attempt.id,
      });
      if (reportError) throw reportError;
      reportAttempt.current = null;
      setSafetyTarget(null);
      if (shouldBlock) {
        setSelectedIncoming(null); setSelectedMatch(null); setMatchMoment(null);
        setExploreItems((current) => current.map((item) => item.candidateId === safetyTarget.userId ? { ...item, action: "passed" } : item));
        if (room.status === "open") {
          await loadExploreState(room.id);
          await loadDiscovery(room.id);
        }
        await loadConnections(room.id);
      }
    } catch (failure) {
      logDiagnostic("submit_report", failure, { roomId: room.id, matchId: safetyTarget.matchId || undefined });
      setError(userFacingError(failure, "We couldn’t submit this report. Try again."));
    }
    finally { submittingReport.current = false; setBusy(false); }
  }

  if (screen === "loading") return <RoomState icon={<RefreshCw className="spin" />} title="Opening Room…" copy="Checking the event and your guest session." />;
  if (screen === "configuration") return <RoomState icon={<LockKeyhole />} title="Guest access isn’t configured." copy={error || "This production QR route requires the public Supabase settings and Turnstile site key. It never falls back to demo people."} />;
  if (screen === "missing") return <RoomState icon={<LockKeyhole />} eyebrow="ROOM NOT FOUND" title="This link is not valid." copy="Ask the organizer for the current Room QR." />;
  if (screen === "closed") return <RoomState icon={<LockKeyhole />} eyebrow="ROOM CLOSED" title="This Room has ended." copy="New guests can no longer join this event." />;
  if (screen === "not-open") return <RoomState icon={<CalendarDays />} eyebrow="NOT OPEN YET" title="This Room isn’t open." copy="The organizer will open it when the event begins." />;
  if (screen === "error") return <RoomState icon={<LockKeyhole />} title="We couldn’t open the Room." copy={error || "Try the QR again."} actionLabel="Try again" onAction={() => window.location.reload()} />;

  if (screen === "verification" && room) {
    return <main className="foundation-onboarding"><FoundationRoomHeader room={room} /><section className="foundation-form-card returning-card auth-verification-card"><ShieldCheck className="auth-verification-card__icon" /><span className="eyebrow">QUICK SAFETY CHECK</span><h1>Almost there.</h1><p>This automatic check protects the Room from bots. Most people won’t need to do anything.</p><AuthTurnstile action="guest_anonymous_signup" instanceRef={turnstileRef} onSuccess={(token) => void completeAnonymousVerification(token)} onExpire={() => setError("The quick security check expired. Please try it again.")} onError={() => setError("The quick security check could not load. Check your connection and try again.")} />{busy && <p className="auth-verification-card__status">Opening your guest session…</p>}{error && <p className="form-error" role="alert">{error}</p>}<small className="foundation-privacy"><ShieldCheck size={14} />Existing guest sessions skip this check.</small></section></main>;
  }

  if (screen === "onboarding" && room) {
    return <main className="foundation-onboarding">
      <FoundationRoomHeader room={room} />
      <section className="foundation-form-card">
        <div className="foundation-progress"><i className={step >= 1 ? "active" : ""} /><i className={step >= 2 ? "active" : ""} /><i className={step >= 3 ? "active" : ""} /><i className={step >= 4 ? "active" : ""} /></div>
        {step === 1 && <>
          <span className="eyebrow">STEP 1 OF 4</span><h1>Add your photo.</h1><p>Use the camera or choose one from your gallery.</p>
          <label className={`foundation-photo-picker ${photoPreview ? "has-photo" : ""}`}><span style={photoPreview ? { backgroundImage: `url(${photoPreview})` } : undefined}>{photoPreview ? <Check /> : <ImagePlus />}</span><strong>{photoPreview ? "Photo selected" : "Camera or gallery"}</strong><small>Required · maximum 5 MB</small><input className="file-input" type="file" accept="image/*" onChange={choosePhoto} /></label>
          {error && <p className="form-error">{error}</p>}<button className="button button--lime button--wide" disabled={!photoFile} onClick={() => setStep(2)}>Continue <ArrowRight size={18} /></button>
        </>}
        {step === 2 && <>
          <button className="back-link" onClick={() => setStep(1)}><ArrowLeft size={17} />Back</button><span className="eyebrow">STEP 2 OF 4</span><h1>What’s your name?</h1><p>This is the profile name people in the Room will see.</p>
          <label>First name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} minLength={2} maxLength={50} placeholder="Anna" /></label>
          <button className="button button--lime button--wide" disabled={displayName.trim().length < 2} onClick={() => setStep(3)}>Continue <ArrowRight size={18} /></button>
        </>}
        {step === 3 && <>
          <button className="back-link" onClick={() => setStep(2)}><ArrowLeft size={17} />Back</button><span className="eyebrow">STEP 3 OF 4</span><h1>How do you identify?</h1><p>This sets a simple starting preference. You can change who you want to see from your profile. Organizers do not receive your individual answer.</p>
          <ProfileChoices name="onboarding-gender" label="Gender" value={gender} options={GENDER_OPTIONS} onChange={(value) => { setGender(value); setDiscoveryPreference(defaultDiscoveryPreference(value)); }} />
          <button className="button button--lime button--wide" disabled={!gender} onClick={() => setStep(4)}>Continue <ArrowRight size={18} /></button>
        </>}
        {step === 4 && <>
          <button className="back-link" onClick={() => setStep(3)}><ArrowLeft size={17} />Back</button><span className="eyebrow">STEP 4 OF 4</span><h1>One last check.</h1><p>HERE is currently available only to adults.</p>
          <label className="foundation-age-check"><input type="checkbox" checked={ageConfirmed} onChange={(event) => setAgeConfirmed(event.target.checked)} /><span><Check size={18} /></span><strong>I am 18 or older</strong></label>
          <label className="foundation-age-check"><input type="checkbox" checked={legalAccepted} onChange={(event) => setLegalAccepted(event.target.checked)} /><span><Check size={18} /></span><strong>I accept the <a href="/terms" target="_blank" rel="noreferrer">Draft Terms</a> and acknowledge the <a href="/privacy" target="_blank" rel="noreferrer">Draft Privacy Policy</a>.</strong></label>
          {error && <p className="form-error">{error}</p>}<button className="button button--lime button--wide" disabled={!ageConfirmed || !legalAccepted || busy} onClick={finishOnboarding}>{busy ? "Joining…" : "Enter the Room"}<ArrowRight size={18} /></button><small className="foundation-privacy"><ShieldCheck size={14} />Your profile is saved for your next HERE event.</small>
        </>}
      </section>
    </main>;
  }

  if (screen === "profile-completion" && room && profile) {
    return <main className="foundation-onboarding">
      <FoundationRoomHeader room={room} />
      <section className="foundation-form-card returning-card profile-completion-card">
        <ResilientAvatar className="returning-avatar" path={profile.avatar_path} url={ownAvatarUrl} name={profile.display_name} />
        <span className="eyebrow">ONE QUICK THING</span><h1>Confirm your profile.</h1><p>Complete the missing preference or accept the current draft documents, then continue with your existing profile.</p>
        <ProfileChoices name="returning-gender" label="Gender" value={gender} options={GENDER_OPTIONS} onChange={(value) => { setGender(value); setDiscoveryPreference(defaultDiscoveryPreference(value)); }} />
        {(profile.accepted_document_version !== LEGAL_VERSION || !profile.accepted_at) && <label className="foundation-age-check"><input type="checkbox" checked={legalAccepted} onChange={(event) => setLegalAccepted(event.target.checked)} /><span><Check size={18} /></span><strong>I accept the <a href="/terms" target="_blank" rel="noreferrer">Draft Terms</a> and acknowledge the <a href="/privacy" target="_blank" rel="noreferrer">Draft Privacy Policy</a>.</strong></label>}
        {error && <p className="form-error">{error}</p>}
        <button className="button button--lime button--wide" disabled={!gender || ((profile.accepted_document_version !== LEGAL_VERSION || !profile.accepted_at) && !legalAccepted) || busy} onClick={finishProfileCompletion}>{busy ? "Saving…" : "Continue"}<ArrowRight size={18} /></button>
        <small className="foundation-privacy"><ShieldCheck size={14} />Your name, photo, connections and guest identity stay unchanged.</small>
      </section>
    </main>;
  }

  if (screen === "ready" && room && profile) {
    return <main className="foundation-onboarding"><FoundationRoomHeader room={room} /><section className="foundation-form-card returning-card"><ResilientAvatar className="returning-avatar" path={profile.avatar_path} url={ownAvatarUrl} name={profile.display_name} /><span className="eyebrow">WELCOME BACK</span><h1>Hi, {profile.display_name}.</h1><p>Your profile is ready. Join this event’s Room?</p>{error && <p className="form-error">{error}</p>}<div className="returning-actions"><button className="button button--lime button--wide" disabled={busy} onClick={joinReturningGuest}>{busy ? "Joining…" : "Join Room"}<ArrowRight size={18} /></button><button className="button button--ghost button--wide" disabled={busy} onClick={() => openProfileEditor("ready")}>Edit profile</button></div></section></main>;
  }

  if (screen === "edit-profile" && room && profile) {
    const editPhotoUrl = photoPreview || ownAvatarUrl;
    return <main className="foundation-onboarding"><FoundationRoomHeader room={room} /><section className="foundation-form-card profile-editor-card"><button className="back-link" disabled={busy} onClick={cancelProfileEditor}><ArrowLeft size={17} />Back</button><span className="eyebrow">YOUR PROFILE</span><h1>Update your profile.</h1><p>Change what people see and who appears in your future Explore.</p><label className="foundation-photo-picker has-photo"><span style={editPhotoUrl ? { backgroundImage: `url(${editPhotoUrl})` } : undefined}>{photoFile ? <Check /> : <ImagePlus />}</span><strong>{photoFile ? "New photo selected" : "Change photo"}</strong><small>Camera or gallery · maximum 5 MB</small><input className="file-input" type="file" accept="image/*" onChange={choosePhoto} /></label><label>First name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} minLength={2} maxLength={50} placeholder="Anna" /></label><ProfileChoices name="profile-gender" label="Gender" value={gender} options={GENDER_OPTIONS} onChange={setGender} /><ProfileChoices name="profile-discovery" label="Show me" value={discoveryPreference} options={DISCOVERY_OPTIONS} onChange={setDiscoveryPreference} /><small className="profile-choice-note">Changes apply to future selections. Existing cards, incoming Interests, Matches and chats stay unchanged. Organizers do not receive your individual gender or Show me setting.</small>{error && <p className="form-error">{error}</p>}<div className="returning-actions"><button className="button button--lime button--wide" disabled={displayName.trim().length < 2 || !gender || !discoveryPreference || busy} onClick={saveReturningProfile}>{busy ? "Saving…" : "Save changes"}<Check size={18} /></button><button className="button button--ghost button--wide" disabled={busy} onClick={cancelProfileEditor}>Cancel</button></div><small className="foundation-privacy"><ShieldCheck size={14} />Your guest identity and 18+ confirmation stay unchanged.</small></section></main>;
  }

  if (screen === "room" && room) {
    if (selectedMatch) {
      const target = { userId: selectedMatch.otherUserId, displayName: selectedMatch.displayName, matchId: selectedMatch.id, roomId: selectedMatch.roomId || room.id };
      return <>
        <ChatView
          room={room}
          match={selectedMatch}
          messages={messages}
          ownUserId={profile?.id || ""}
          busy={busy}
          error={error}
          connectionState={connectionState}
          onRetry={() => {
            realtimeReconnectAttempts.current = 0;
            setRecoveryEpoch((current) => current + 1);
            void refreshRoom(room.id, room.status === "open");
          }}
          onBack={() => { setSelectedMatch(null); setMessages([]); setError(""); }}
          onSend={sendMessage}
          onBlock={() => void blockPerson(target)}
          onReport={() => setSafetyTarget(target)}
        />
        {safetyTarget && <SafetySheet target={safetyTarget} busy={busy} error={error} onClose={() => setSafetyTarget(null)} onSubmit={submitSafetyReport} />}
      </>;
    }

    const hasLeftEvent = isExplicitlyLeft(presence);
    return (
      <main className="foundation-room-screen">
        <header>
          <span className="brand"><span className="brand-mark"><Radio size={17} /></span>HERE<span className="brand-dot">.</span></span>
          <div className="foundation-room-actions">
            {profile && <UserArea userId={profile.id} roomId={room.id} onEditProfile={() => openProfileEditor("room")} onOpenConnection={(connection) => { setMatches((current) => current.some((item) => item.id === connection.id) ? current : [...current, connection]); openConversation(connection); }} />}
            <span className={`foundation-live ${room.status === "closed" ? "foundation-live--ended" : ""}`}><i />{room.status === "closed" ? "ROOM ENDED" : "ROOM OPEN"}</span>
          </div>
        </header>
        <ConnectionBanner state={connectionState} onRetry={() => {
          realtimeReconnectAttempts.current = 0;
          setRecoveryEpoch((current) => current + 1);
          void refreshRoom(room.id, room.status === "open");
        }} />

        {room.status === "closed" ? <section className="closed-connections-intro"><LockKeyhole /><span className="eyebrow">ROOM ENDED</span><h1>Your connections stay with you.</h1><p>Discovery is closed, but existing Matches and conversations remain available.</p></section> : <>
        <section className="foundation-room-heading">
          <span className="eyebrow">HERE TONIGHT</span>
          <h1>{joinedCount} people here</h1>
          <p>{room.name} · {room.venue_name || room.city || "Tonight"}</p>
        </section>

        {hasLeftEvent ? (
          <section className="presence-left-card">
            <DoorOpen />
            <span className="eyebrow">YOU LEFT THE EVENT</span>
            <h2>Rejoin this event?</h2>
            <p>Your existing Matches and chats remain available. Rejoin only if you’re back at the event.</p>
            {error && <p className="form-error">{error}</p>}
            <button className="button button--dark" disabled={busy} onClick={() => void rejoinEvent()}>{busy ? "Rejoining…" : "Rejoin event"}</button>
          </section>
        ) : <>

        {exploreOpen && activeExploreItem ? (
          <section className="explore-carousel explore-flow">
            <button className="back-link" onClick={() => setExploreOpen(false)}><ArrowLeft size={17} />Back to Room</button>
            <div className="explore-carousel__top"><span className="eyebrow">EXPLORE</span><span>Here, now</span></div>
            <article className="explore-profile-card">
              <div className="explore-profile-card__photo"><ResilientAvatar path={activeExploreItem.avatarPath} url={activeExploreItem.avatarUrl} name={activeExploreItem.displayName} /></div>
              <div className="explore-profile-card__copy"><span>Here at this event.</span><h2>{activeExploreItem.displayName}</h2><div className="profile-safety-actions"><button type="button" onClick={() => void blockPerson({ userId: activeExploreItem.candidateId, displayName: activeExploreItem.displayName, matchId: null, roomId: room.id })}><Ban size={14} />Block</button><button type="button" onClick={() => setSafetyTarget({ userId: activeExploreItem.candidateId, displayName: activeExploreItem.displayName, matchId: null, roomId: room.id })}><Flag size={14} />Report</button></div></div>
              <div className="explore-profile-card__actions">
                <button className="button button--ghost" disabled={busy || !activeExploreItem.firstSeenAt} onClick={() => void actOnExploreItem("passed")}>Next <ArrowRight size={17} /></button>
                <button className="button button--lime" disabled={busy || !activeExploreItem.firstSeenAt} onClick={() => void actOnExploreItem("interested")}><Sparkles size={17} />Interested</button>
              </div>
            </article>
            {discoveryError && <p className="form-error">{discoveryError}</p>}
          </section>
        ) : (
          <section className={`explore-status ${exploreState?.status === "ready" || exploreState?.status === "active" ? "explore-status--ready" : ""}`}>
            <div className="explore-status__icon"><Users /></div>
            <span className="eyebrow">EXPLORE · ALL EVENING</span>
            {exploreState?.status === "caught_up" || exploreState?.status === "waiting" ? <><h2>You’re caught up.</h2><p>{CAUGHT_UP_COPY}</p><button className="button button--dark" disabled={busy} onClick={() => void openExplore()}>Check for new people</button></>
              : exploreState?.status === "active" ? <><h2>Continue where you left off.</h2><p>Your current people and their order stay the same after refresh.</p><button className="button button--dark" disabled={busy} onClick={() => void openExplore()}>Continue Explore <ArrowRight size={18} /></button></>
                : <><h2>See who’s here.</h2><p>A small, fairly balanced set of people who are active at this event.</p><button className="button button--dark" disabled={busy} onClick={() => void openExplore()}>{busy ? "Opening…" : "Explore now"}<ArrowRight size={18} /></button></>}
            {discoveryError && <p className="form-error">{discoveryError}</p>}
          </section>
        )}

        <section className="foundation-wall" aria-label="Room activity">
          <div className="foundation-wall__heading">
            <div><Users /><span>Room Wall</span></div>
            <small>Real people · not a catalogue</small>
          </div>
          {wall.length ? (
            <div className="foundation-avatar-cloud" aria-label={`${wall.length} recent Room participants`}>
              {wall.map((person) => <ResilientAvatar key={person.id} path={person.avatarPath} url={person.avatarUrl} name={person.displayName} />)}
            </div>
          ) : (
            <div className="foundation-empty-wall"><Users /><strong>You’re first here.</strong><p>Other guests will appear after joining this exact Room.</p></div>
          )}
        </section>

        <section className="interested-in-you">
          <button
            className="interested-in-you__toggle"
            type="button"
            aria-expanded={incomingOpen}
            onClick={() => { setIncomingOpen((current) => !current); setSelectedIncoming(null); }}
          >
            <span><Sparkles /><strong>Interested in You</strong></span>
            <span>{incomingInterests.length}<ArrowRight size={18} /></span>
          </button>
          {incomingOpen && (
            incomingInterests.length ? (
              <div className="incoming-interest-list" aria-label="People interested in you">
                {incomingInterests.map((person) => (
                  <button type="button" key={person.interestId} onClick={() => setSelectedIncoming(person)} aria-label={`View ${person.displayName}'s profile`}>
                    <ResilientAvatar path={person.avatarPath} url={person.avatarUrl} name={person.displayName} />
                    <strong>{person.displayName}</strong>
                  </button>
                ))}
              </div>
            ) : <p className="interested-in-you__empty">No incoming Interests yet.</p>
          )}
          {incomingOpen && selectedIncoming && (
            <article className="incoming-profile">
              <ResilientAvatar path={selectedIncoming.avatarPath} url={selectedIncoming.avatarUrl} name={selectedIncoming.displayName} />
              <div className="incoming-profile__copy"><span className="eyebrow">SAME PLACE. RIGHT NOW.</span><h2>{selectedIncoming.displayName}</h2><p>They sent you an Interest in this Room.</p><div className="incoming-profile__actions"><button className="button button--lime" disabled={busy} onClick={() => void respondToIncoming(true)}><Sparkles size={17} />Interested Too</button><button className="button button--ghost" disabled={busy} onClick={() => void respondToIncoming(false)}>Not for me</button></div><div className="profile-safety-actions"><button type="button" onClick={() => void blockPerson({ userId: selectedIncoming.fromUserId, displayName: selectedIncoming.displayName, matchId: null, roomId: room.id })}><Ban size={14} />Block</button><button type="button" onClick={() => setSafetyTarget({ userId: selectedIncoming.fromUserId, displayName: selectedIncoming.displayName, matchId: null, roomId: room.id })}><Flag size={14} />Report</button></div></div>
              <button type="button" className="icon-button" onClick={() => setSelectedIncoming(null)} aria-label="Close profile"><ArrowLeft size={18} /></button>
            </article>
          )}
        </section>
        </>}
        </>}

        {matches.length > 0 && <MatchesSection matches={matches} open={matchesOpen} onToggle={() => setMatchesOpen((current) => !current)} onOpen={openConversation} />}

        {matchMoment && <MatchMoment match={matchMoment} onMessage={() => { openConversation(matchMoment); setMatchMoment(null); }} onBack={() => setMatchMoment(null)} />}
        {safetyTarget && <SafetySheet target={safetyTarget} busy={busy} error={error} onClose={() => setSafetyTarget(null)} onSubmit={submitSafetyReport} />}

        {room.status === "open" && !hasLeftEvent && <button className="leave-event-action" type="button" onClick={() => setLeaveConfirmOpen(true)}><DoorOpen size={16} />Leave event</button>}
        {leaveConfirmOpen && <div className="leave-event-modal" role="dialog" aria-modal="true" aria-label="Leave event"><section><button className="icon-button" type="button" onClick={() => setLeaveConfirmOpen(false)} aria-label="Close"><X size={18} /></button><DoorOpen /><span className="eyebrow">LEAVE EVENT</span><h2>Leave event</h2><p>You’ll stop appearing in new discoveries. Your Matches and chats will stay available.</p>{error && <p className="form-error">{error}</p>}<div><button className="button button--ghost" type="button" onClick={() => setLeaveConfirmOpen(false)}>Stay in event</button><button className="button button--dark" type="button" disabled={busy} onClick={() => void leaveEvent()}>{busy ? "Leaving…" : "Leave event"}</button></div></section></div>}

        <p className="foundation-room-note"><ShieldCheck size={15} />If you can see the Room, the Room can see you.</p>
      </main>
    );
  }

  return null;
}

function ProfileChoices<T extends string>({ name, label, value, options, onChange }: {
  name: string;
  label: string;
  value: T | "";
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return <fieldset className="profile-choice-group">
    <legend>{label}</legend>
    <div>{options.map((option) => <label className={value === option.value ? "selected" : ""} key={option.value}>
      <input type="radio" name={name} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} />
      <span>{option.label}</span><Check size={16} />
    </label>)}</div>
  </fieldset>;
}

function FoundationRoomHeader({ room }: { room: FoundationRoom }) {
  return <section className="foundation-room-summary"><header><span className="brand"><span className="brand-mark"><Radio size={17} /></span>HERE<span className="brand-dot">.</span></span><span className="foundation-live"><i />ROOM OPEN</span></header><div><span className="eyebrow">TONIGHT AT</span><h2>{room.venue_name || room.name}</h2><p><MapPin size={15} />{room.city || "Event location"}<b>·</b><CalendarDays size={15} />{roomDate(room.starts_at)}</p></div></section>;
}

function RoomState({ icon, eyebrow, title, copy, actionLabel, onAction }: { icon: React.ReactNode; eyebrow?: string; title: string; copy: string; actionLabel?: string; onAction?: () => void }) {
  return <main className="foundation-state"><span className="brand"><span className="brand-mark"><Radio size={17} /></span>HERE<span className="brand-dot">.</span></span><div className="foundation-state__icon">{icon}</div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h1>{title}</h1><p>{copy}</p>{actionLabel && onAction && <button className="button button--dark" onClick={onAction}>{actionLabel}</button>}</main>;
}

function ConnectionBanner({ state, onRetry }: { state: ConnectionState; onRetry: () => void }) {
  if (state === "online") return null;
  return <div className={`connection-banner connection-banner--${state}`} role="status">
    <span>{state === "offline" ? "Connection lost." : "Trying to reconnect…"}</span>
    <button type="button" onClick={onRetry}>Try again</button>
  </div>;
}

function MatchesSection({ matches, open, onToggle, onOpen }: { matches: RoomMatch[]; open: boolean; onToggle: () => void; onOpen: (match: RoomMatch) => void }) {
  return <section className="room-matches">
    <button className="room-matches__toggle" type="button" aria-expanded={open} onClick={onToggle}>
      <span><MessageCircle /><strong>Matches</strong></span>
      <span>{matches.length}<ArrowRight size={18} /></span>
    </button>
    {open && (matches.length ? <div className="room-match-list">{matches.map((match) => <button type="button" key={match.id} onClick={() => onOpen(match)}><ResilientAvatar path={match.avatarPath} url={match.avatarUrl} name={match.displayName} /><div><strong>{match.displayName}</strong><small>{match.lastMessageBody || "You’re both here. Say hi."}</small></div><time>{new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit" }).format(new Date(match.lastMessageAt || match.matchedAt))}</time>{match.unreadCount > 0 && <i>{match.unreadCount}</i>}<ArrowRight size={17} /></button>)}</div> : <p className="room-matches__empty">Mutual connections will appear here.</p>)}
  </section>;
}

function MatchMoment({ match, onMessage, onBack }: { match: RoomMatch; onMessage: () => void; onBack: () => void }) {
  return <div className="match-moment" role="dialog" aria-modal="true" aria-label="New Match">
    <section><span className="match-moment__icon"><Sparkles /></span><span className="eyebrow">IT’S MUTUAL</span><ResilientAvatar className="match-moment__avatar" path={match.avatarPath} url={match.avatarUrl} name={match.displayName} /><h2>You and {match.displayName} noticed each other.</h2><p>You’re both here right now. Say hi, then go meet in person.</p><div><button className="button button--lime" onClick={onMessage}><MessageCircle size={17} />Message</button><button className="button button--ghost" onClick={onBack}>Back to Room</button></div></section>
  </div>;
}

function ChatView({ room, match, messages, ownUserId, busy, error, connectionState, onRetry, onBack, onSend, onBlock, onReport }: { room: FoundationRoom; match: RoomMatch; messages: MatchMessage[]; ownUserId: string; busy: boolean; error: string; connectionState: ConnectionState; onRetry: () => void; onBack: () => void; onSend: (event: FormEvent<HTMLFormElement>) => void; onBlock: () => void; onReport: () => void }) {
  const sourceRoomName = match.roomName || room.name;
  const sourceRoomEnded = (match.roomId !== undefined && match.roomId !== room.id) || match.roomStatus === "closed" || room.status === "closed";
  return <main className="match-chat">
    <header><button className="icon-button" onClick={onBack} aria-label="Back to Matches"><ArrowLeft size={19} /></button><div><ResilientAvatar path={match.avatarPath} url={match.avatarUrl} name={match.displayName} /><div><strong>{match.displayName}</strong><small>{sourceRoomName}</small></div></div><div className="chat-safety"><button type="button" onClick={onReport}><Flag size={15} />Report</button><button type="button" onClick={onBlock}><Ban size={15} />Block</button></div></header>
    <ConnectionBanner state={connectionState} onRetry={onRetry} />
    <section className="match-chat__context"><span className="eyebrow">REAL PEOPLE. SAME PLACE.</span><p>{sourceRoomEnded ? `You connected at ${sourceRoomName}. Your conversation remains.` : `You’re both at ${room.venue_name || room.name} tonight. Chat briefly, then go say hi.`}</p></section>
    <section className="match-chat__messages" aria-live="polite">{messages.length ? messages.map((message) => <article className={message.senderId === ownUserId ? "mine" : "theirs"} key={message.id}><p>{message.body}</p><time>{new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit" }).format(new Date(message.createdAt))}</time></article>) : <div className="match-chat__empty"><MessageCircle /><strong>Break the final barrier.</strong><p>One short message is enough.</p></div>}</section>
    {error && <p className="match-chat__error form-error">{error}</p>}
    <form className="match-chat__composer" onSubmit={onSend}><input name="message" maxLength={1000} placeholder={`Message ${match.displayName}`} aria-label={`Message ${match.displayName}`} autoComplete="off" /><button className="button button--lime" disabled={busy} aria-label="Send message"><Send size={18} /></button></form>
  </main>;
}

function SafetySheet({ target, busy, error, onClose, onSubmit }: { target: SafetyTarget; busy: boolean; error: string; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <div className="safety-sheet" role="dialog" aria-modal="true" aria-label={`Report ${target.displayName}`}>
    <form onSubmit={onSubmit}>
      <button type="button" className="icon-button safety-sheet__close" onClick={onClose} aria-label="Close report"><X size={18} /></button>
      <Flag /><span className="eyebrow">SAFETY</span><h2>Report {target.displayName}</h2>
      <p>The person you report will never see who submitted it.</p>
      <label>Reason<select name="reason" required defaultValue=""><option value="" disabled>Choose a reason</option>{REPORT_REASONS.map((reason) => <option value={reason} key={reason}>{reason}</option>)}</select></label>
      <label>Details <small>Optional</small><textarea name="details" maxLength={1000} placeholder="Add anything our safety team should know." /></label>
      <label className="event-staff-consent" htmlFor="event-staff-consent">
        <input id="event-staff-consent" type="checkbox" name="shareWithEventStaff" value="true" aria-label="Share relevant report details with event staff" />
        <span><strong>Do you need help from event staff?</strong><small>Only select this if you consent to sharing this report’s relevant details with event staff.</small></span>
      </label>
      {error && <p className="form-error">{error}</p>}
      <div><button className="button button--dark" name="block" value="false" disabled={busy}>Submit report</button><button className="button button--lime" name="block" value="true" disabled={busy}><Ban size={16} />Report and Block</button></div>
    </form>
  </div>;
}
