"use client";
/* eslint-disable @next/next/no-img-element -- avatars are short-lived signed Supabase Storage URLs. */

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Ban, CalendarDays, Check, Clock3, Flag, ImagePlus, LockKeyhole, MapPin, MessageCircle, Radio, RefreshCw, Send, ShieldCheck, Sparkles, Users, X } from "lucide-react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { DropItem, DropItemAction, FoundationProfile, FoundationRoom, IncomingInterest, MatchMessage, RoomDropState, RoomMatch, RoomWallPerson } from "@/lib/types";

type Screen = "loading" | "configuration" | "missing" | "closed" | "not-open" | "onboarding" | "ready" | "room" | "error";
type OnboardingStep = 1 | 2 | 3;
type RoomWallRpcRow = { id: string; display_name: string; avatar_path: string; joined_at: string };
type DropItemRpcRow = { id: string; item_position: number; first_seen_at: string | null; action: DropItemAction; candidate_id: string; display_name: string; avatar_path: string };
type IncomingInterestRpcRow = { interest_id: string; from_user_id: string; display_name: string; avatar_path: string; created_at: string };
type RoomMatchRpcRow = { match_id: string; other_user_id: string; display_name: string; avatar_path: string; matched_at: string; last_message_at: string | null; last_message_body: string | null; unread_count: number };
type MatchMessageRow = { id: string; match_id: string; sender_id: string; body: string; created_at: string; read_at: string | null };
type SafetyTarget = { userId: string; displayName: string; matchId: string | null };

const REPORT_REASONS = ["Harassment", "Fake profile", "Inappropriate behavior", "Spam", "Safety concern", "Other"] as const;

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

function formatCountdown(target: string | null, nowMs: number) {
  if (!target) return "--:--:--";
  const seconds = Math.max(0, Math.floor((new Date(target).getTime() - nowMs) / 1000));
  const hours = Math.floor(seconds / 3600).toString().padStart(2, "0");
  const minutes = Math.floor((seconds % 3600) / 60).toString().padStart(2, "0");
  const remaining = (seconds % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}:${remaining}`;
}

function mapMessage(row: MatchMessageRow): MatchMessage {
  return { id: row.id, matchId: row.match_id, senderId: row.sender_id, body: row.body, createdAt: row.created_at, readAt: row.read_at };
}

async function signedUrlMap(paths: string[]) {
  const client = getSupabaseBrowserClient();
  const uniquePaths = [...new Set(paths.filter(Boolean))];
  if (!client || !uniquePaths.length) return new Map<string, string>();
  const { data, error } = await client.storage.from("avatars").createSignedUrls(uniquePaths, 3600);
  if (error) throw error;
  return new Map((data || []).map((item) => [item.path, item.signedUrl]));
}

export function RoomJoinApp({ joinCode, initialRoom }: { joinCode: string; initialRoom?: FoundationRoom | null }) {
  const [screen, setScreen] = useState<Screen>(() => initialScreenFor(initialRoom));
  const [room, setRoom] = useState<FoundationRoom | null>(initialRoom || null);
  const [profile, setProfile] = useState<FoundationProfile | null>(null);
  const [ownAvatarUrl, setOwnAvatarUrl] = useState("");
  const [wall, setWall] = useState<RoomWallPerson[]>([]);
  const [joinedCount, setJoinedCount] = useState(0);
  const [dropState, setDropState] = useState<RoomDropState | null>(null);
  const [dropItems, setDropItems] = useState<DropItem[]>([]);
  const [incomingInterests, setIncomingInterests] = useState<IncomingInterest[]>([]);
  const [incomingOpen, setIncomingOpen] = useState(false);
  const [selectedIncoming, setSelectedIncoming] = useState<IncomingInterest | null>(null);
  const [matches, setMatches] = useState<RoomMatch[]>([]);
  const [matchesOpen, setMatchesOpen] = useState(false);
  const [selectedMatch, setSelectedMatch] = useState<RoomMatch | null>(null);
  const [messages, setMessages] = useState<MatchMessage[]>([]);
  const [matchMoment, setMatchMoment] = useState<RoomMatch | null>(null);
  const [safetyTarget, setSafetyTarget] = useState<SafetyTarget | null>(null);
  const [dropOpen, setDropOpen] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [step, setStep] = useState<OnboardingStep>(1);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dropError, setDropError] = useState("");
  const bootstrapStarted = useRef(false);
  const markingSeen = useRef(new Set<string>());
  const markingIncomingOpened = useRef(new Set<string>());
  const zeroRequeryFor = useRef("");
  const selectedMatchId = selectedMatch?.id || "";

  const loadWall = useCallback(async (roomId: string) => {
    const client = getSupabaseBrowserClient();
    if (!client) return;
    const [{ data: count }, { data: wallProfiles, error: wallError }] = await Promise.all([
      client.rpc("room_joined_count", { p_room_id: roomId }),
      client.rpc("room_wall_profiles", { p_room_id: roomId, p_limit: 12 }),
    ]);
    if (wallError) throw wallError;
    setJoinedCount(Number(count || 0));
    const visibleProfiles = (wallProfiles || []) as RoomWallRpcRow[];
    const urls = await signedUrlMap(visibleProfiles.map((item) => String(item.avatar_path)));
    setWall(visibleProfiles.map((item) => ({ id: String(item.id), displayName: String(item.display_name), avatarUrl: urls.get(String(item.avatar_path)) || "" })));
  }, []);

  const loadConnections = useCallback(async (roomId: string) => {
    const client = getSupabaseBrowserClient();
    if (!client) return [];
    const { data, error: matchesError } = await client.rpc("room_matches", { p_room_id: roomId });
    if (matchesError) throw matchesError;
    const rows = (data || []) as RoomMatchRpcRow[];
    const urls = await signedUrlMap(rows.map((item) => item.avatar_path));
    const nextMatches = rows.map((item) => ({
      id: item.match_id,
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
    setSelectedMatch((current) => current ? nextMatches.find((item) => item.id === current.id) || null : null);
    return nextMatches;
  }, []);

  const loadMessages = useCallback(async (matchId: string) => {
    const client = getSupabaseBrowserClient();
    if (!client) return;
    const { data, error: messagesError } = await client.from("messages").select("id, match_id, sender_id, body, created_at, read_at").eq("match_id", matchId).order("created_at").order("id");
    if (messagesError) throw messagesError;
    setMessages(((data || []) as MatchMessageRow[]).map(mapMessage));
    await client.rpc("mark_match_messages_read", { p_match_id: matchId });
  }, []);

  const loadAssignedDrop = useCallback(async (dropId: string) => {
    const client = getSupabaseBrowserClient();
    if (!client) return [];
    const { data, error: itemsError } = await client.rpc("claim_your_drop", { p_drop_id: dropId });
    if (itemsError) throw itemsError;
    const rows = (data || []) as DropItemRpcRow[];
    const urls = await signedUrlMap(rows.map((item) => item.avatar_path));
    const items = rows.map((item) => ({ id: item.id, position: Number(item.item_position), firstSeenAt: item.first_seen_at, action: item.action, candidateId: item.candidate_id, displayName: item.display_name, avatarPath: item.avatar_path, avatarUrl: urls.get(item.avatar_path) || "" } satisfies DropItem));
    setDropItems(items);
    return items;
  }, []);

  const loadDiscovery = useCallback(async (roomId: string) => {
    const client = getSupabaseBrowserClient();
    if (!client) return;
    const [{ data: stateData, error: stateError }, { data: incomingData, error: incomingError }] = await Promise.all([
      client.rpc("room_drop_state", { p_room_id: roomId }),
      client.rpc("interested_in_you", { p_room_id: roomId }),
    ]);
    if (stateError) throw stateError;
    if (incomingError) throw incomingError;
    const state = (Array.isArray(stateData) ? stateData[0] : stateData) as RoomDropState | undefined;
    setDropState(state || null);
    if (state?.drop_id && Number(state.assigned_count) > 0) await loadAssignedDrop(state.drop_id);
    else { setDropItems([]); setDropOpen(false); }

    const incoming = (incomingData || []) as IncomingInterestRpcRow[];
    const urls = await signedUrlMap(incoming.map((item) => item.avatar_path));
    setIncomingInterests(incoming.map((item) => ({ interestId: item.interest_id, fromUserId: item.from_user_id, displayName: item.display_name, avatarPath: item.avatar_path, avatarUrl: urls.get(item.avatar_path) || "", createdAt: item.created_at })));
  }, [loadAssignedDrop]);

  const enterRoom = useCallback(async (resolvedRoom: FoundationRoom) => {
    const client = getSupabaseBrowserClient();
    if (!client) return;
    const { error: joinError } = await client.rpc("join_room_by_code", { p_join_code: joinCode });
    if (joinError) throw joinError;
    await Promise.all([loadWall(resolvedRoom.id), loadDiscovery(resolvedRoom.id), loadConnections(resolvedRoom.id)]);
    setScreen("room");
  }, [joinCode, loadConnections, loadDiscovery, loadWall]);

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

      let { data: sessionData } = await client.auth.getSession();
      if (!sessionData.session && resolvedRoom.status === "open") {
        const { data, error: anonymousError } = await client.auth.signInAnonymously();
        if (anonymousError || !data.session) throw anonymousError || new Error("Could not create guest session");
        sessionData = { session: data.session };
      }
      if (!sessionData.session) return setScreen("closed");
      const userId = sessionData.session.user.id;
      const { data: savedProfile, error: profileError } = await client.from("profiles").select("id, display_name, avatar_path, age_confirmed_18").eq("id", userId).maybeSingle();
      if (profileError) throw profileError;
      if (!savedProfile) return setScreen(resolvedRoom.status === "closed" ? "closed" : "onboarding");

      const typedProfile = savedProfile as FoundationProfile;
      setProfile(typedProfile);
      setDisplayName(typedProfile.display_name);
      const { data: signed } = await client.storage.from("avatars").createSignedUrl(typedProfile.avatar_path, 3600);
      setOwnAvatarUrl(signed?.signedUrl || "");
      const { data: membership, error: membershipError } = await client.from("room_members").select("room_id").eq("room_id", resolvedRoom.id).eq("user_id", userId).maybeSingle();
      if (membershipError) throw membershipError;
      if (resolvedRoom.status === "closed") {
        if (!membership) return setScreen("closed");
        await loadConnections(resolvedRoom.id);
        return setScreen("room");
      }
      if (membership) await enterRoom(resolvedRoom);
      else setScreen("ready");
    }
    void bootstrap().catch((reason: unknown) => { setError(reason instanceof Error ? reason.message : "Could not open this Room"); setScreen("error"); });
  }, [enterRoom, initialRoom, joinCode, loadConnections]);

  useEffect(() => {
    if (screen !== "room" || !room) return;
    const timer = window.setInterval(() => {
      const refreshes = room.status === "open"
        ? [loadWall(room.id), loadDiscovery(room.id), loadConnections(room.id)]
        : [loadConnections(room.id)];
      void Promise.all(refreshes).catch(() => undefined);
    }, 10000);
    return () => window.clearInterval(timer);
  }, [loadConnections, loadDiscovery, loadWall, room, screen]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!selectedMatchId) return;
    const client = getSupabaseBrowserClient();
    if (!client) return;
    let active = true;
    let channel: RealtimeChannel | null = null;
    void (async () => {
      const { data: { session } } = await client.auth.getSession();
      if (session) await client.realtime.setAuth(session.access_token);
      if (!active) return;
      channel = client
        .channel(`match-${selectedMatchId}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `match_id=eq.${selectedMatchId}` }, (payload) => {
          const message = mapMessage(payload.new as MatchMessageRow);
          setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message]);
          if (message.senderId !== profile?.id) void client.rpc("mark_match_messages_read", { p_match_id: selectedMatchId });
        })
        .subscribe();
    })();
    return () => {
      active = false;
      if (channel) void client.removeChannel(channel);
    };
  }, [profile?.id, selectedMatchId]);

  useEffect(() => {
    const target = dropState?.next_scheduled_at;
    if (screen !== "room" || !room || !target || new Date(target).getTime() > nowMs) return;
    if (zeroRequeryFor.current === target) return;
    zeroRequeryFor.current = target;
    void loadDiscovery(room.id).catch(() => undefined);
  }, [dropState?.next_scheduled_at, loadDiscovery, nowMs, room, screen]);

  const activeItem = useMemo(() => dropItems.find((item) => item.action === null) || null, [dropItems]);
  const interestsLeft = Math.max(0, Number(dropState?.interest_budget || 0) - Number(dropState?.interests_used || 0));

  useEffect(() => {
    if (!dropOpen || !activeItem || activeItem.firstSeenAt || markingSeen.current.has(activeItem.id)) return;
    const client = getSupabaseBrowserClient();
    if (!client) return;
    markingSeen.current.add(activeItem.id);
    void client.rpc("mark_drop_item_seen", { p_drop_item_id: activeItem.id }).then(({ data, error: seenError }) => {
      markingSeen.current.delete(activeItem.id);
      if (seenError) return setDropError(seenError.message);
      setDropItems((current) => current.map((item) => item.id === activeItem.id ? { ...item, firstSeenAt: String(data) } : item));
    });
  }, [activeItem, dropOpen]);

  useEffect(() => {
    if (!incomingOpen || !selectedIncoming || markingIncomingOpened.current.has(selectedIncoming.interestId)) return;
    const client = getSupabaseBrowserClient();
    if (!client) return;
    const interestId = selectedIncoming.interestId;
    markingIncomingOpened.current.add(interestId);
    void client.rpc("mark_incoming_interest_opened", { p_interest_id: interestId }).then(({ error: openedError }) => {
      markingIncomingOpened.current.delete(interestId);
      if (openedError) setError(openedError.message);
    });
  }, [incomingOpen, selectedIncoming]);

  function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return setError("Choose an image file.");
    if (file.size > 5 * 1024 * 1024) return setError("Photo must be smaller than 5 MB.");
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoFile(file); setPhotoPreview(URL.createObjectURL(file)); setError("");
  }

  async function finishOnboarding() {
    if (!room || !photoFile || displayName.trim().length < 2 || !ageConfirmed) return;
    setBusy(true); setError("");
    try {
      const client = getSupabaseBrowserClient();
      if (!client) throw new Error("Supabase is not configured");
      const { data: userData, error: userError } = await client.auth.getUser();
      if (userError || !userData.user) throw userError || new Error("Guest session not found");
      const avatarPath = `${userData.user.id}/avatar-${crypto.randomUUID()}.${extensionFor(photoFile)}`;
      const { error: uploadError } = await client.storage.from("avatars").upload(avatarPath, photoFile, { contentType: photoFile.type, upsert: false });
      if (uploadError) throw uploadError;
      const nextProfile: FoundationProfile = { id: userData.user.id, display_name: displayName.trim(), avatar_path: avatarPath, age_confirmed_18: true };
      const { error: profileError } = await client.from("profiles").upsert(nextProfile);
      if (profileError) throw profileError;
      setProfile(nextProfile);
      const { data: signed } = await client.storage.from("avatars").createSignedUrl(avatarPath, 3600);
      setOwnAvatarUrl(signed?.signedUrl || photoPreview);
      await enterRoom(room);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not finish your profile"); }
    finally { setBusy(false); }
  }

  async function joinReturningGuest() {
    if (!room) return;
    setBusy(true); setError("");
    try { await enterRoom(room); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not join this Room"); }
    finally { setBusy(false); }
  }

  async function openYourDrop() {
    if (!dropState?.drop_id) return;
    setBusy(true); setDropError("");
    try {
      const items = await loadAssignedDrop(dropState.drop_id);
      if (!items.length) throw new Error("Your Drop is still forming. People are joining now.");
      setDropOpen(true);
      if (room) await loadDiscovery(room.id);
    } catch (reason) { setDropError(reason instanceof Error ? reason.message : "Could not open Your Drop"); }
    finally { setBusy(false); }
  }

  async function actOnItem(action: "passed" | "interested") {
    if (!activeItem?.firstSeenAt || !room) return;
    setBusy(true); setDropError("");
    try {
      const client = getSupabaseBrowserClient();
      if (!client) throw new Error("Supabase is not configured");
      if (action === "interested") {
        const { data, error: interestError } = await client.rpc("send_interest", { p_drop_item_id: activeItem.id });
        if (interestError) throw interestError;
        setDropState((current) => current ? { ...current, interests_used: Number(current.interest_budget || 0) - Number(data || 0) } : current);
      } else {
        const { error: passError } = await client.rpc("pass_drop_item", { p_drop_item_id: activeItem.id });
        if (passError) throw passError;
      }
      setDropItems((current) => current.map((item) => item.id === activeItem.id ? { ...item, action } : item));
      await loadDiscovery(room.id);
    } catch (reason) { setDropError(reason instanceof Error ? reason.message : "Could not save this choice"); }
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
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save your response"); }
    finally { setBusy(false); }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedMatch || !room) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const body = String(form.get("message") || "").trim();
    if (!body) return;
    setBusy(true); setError("");
    try {
      const client = getSupabaseBrowserClient();
      if (!client) throw new Error("Supabase is not configured");
      const { data, error: messageError } = await client.rpc("send_match_message", { p_match_id: selectedMatch.id, p_body: body });
      if (messageError) throw messageError;
      const row = (Array.isArray(data) ? data[0] : data) as MatchMessageRow | null;
      if (row) {
        const message = mapMessage(row);
        setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message]);
      }
      formElement.reset();
      await loadConnections(room.id);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not send this message"); }
    finally { setBusy(false); }
  }

  function openConversation(match: RoomMatch) {
    setSelectedMatch(match); setMessages([]); setError("");
    void loadMessages(match.id).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not open this conversation"));
  }

  async function blockPerson(target: SafetyTarget) {
    if (!room) return;
    setBusy(true); setError("");
    try {
      const client = getSupabaseBrowserClient();
      if (!client) throw new Error("Supabase is not configured");
      const { error: blockError } = await client.rpc("block_user_in_context", {
        p_blocked_id: target.userId,
        p_room_id: room.id,
        p_match_id: target.matchId,
      });
      if (blockError) throw blockError;
      setSafetyTarget(null); setSelectedIncoming(null); setSelectedMatch(null); setMatchMoment(null);
      if (room.status === "open") await loadDiscovery(room.id);
      await loadConnections(room.id);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not block this person"); }
    finally { setBusy(false); }
  }

  async function submitSafetyReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!safetyTarget || !room) return;
    const form = new FormData(event.currentTarget);
    const shouldBlock = form.get("block") === "true";
    setBusy(true); setError("");
    try {
      const client = getSupabaseBrowserClient();
      if (!client) throw new Error("Supabase is not configured");
      const { error: reportError } = await client.rpc("submit_report", {
        p_reported_user_id: safetyTarget.userId,
        p_room_id: room.id,
        p_match_id: safetyTarget.matchId,
        p_reason: String(form.get("reason") || ""),
        p_details: String(form.get("details") || "").trim() || null,
        p_block: shouldBlock,
      });
      if (reportError) throw reportError;
      setSafetyTarget(null);
      if (shouldBlock) {
        setSelectedIncoming(null); setSelectedMatch(null); setMatchMoment(null);
        if (room.status === "open") await loadDiscovery(room.id);
        await loadConnections(room.id);
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not submit this report"); }
    finally { setBusy(false); }
  }

  if (screen === "loading") return <RoomState icon={<RefreshCw className="spin" />} title="Opening Room…" copy="Checking the event and your guest session." />;
  if (screen === "configuration") return <RoomState icon={<LockKeyhole />} title="Supabase isn’t connected." copy="This production QR route never falls back to demo people. Add the public Supabase URL and publishable key to continue." />;
  if (screen === "missing") return <RoomState icon={<LockKeyhole />} eyebrow="ROOM NOT FOUND" title="This link is not valid." copy="Ask the organizer for the current Room QR." />;
  if (screen === "closed") return <RoomState icon={<LockKeyhole />} eyebrow="ROOM CLOSED" title="This Room has ended." copy="New guests can no longer join this event." />;
  if (screen === "not-open") return <RoomState icon={<CalendarDays />} eyebrow="NOT OPEN YET" title="This Room isn’t open." copy="The organizer will open it when the event begins." />;
  if (screen === "error") return <RoomState icon={<LockKeyhole />} title="We couldn’t open the Room." copy={error || "Try the QR again."} />;

  if (screen === "onboarding" && room) {
    return <main className="foundation-onboarding"><FoundationRoomHeader room={room} /><section className="foundation-form-card"><div className="foundation-progress"><i className={step >= 1 ? "active" : ""} /><i className={step >= 2 ? "active" : ""} /><i className={step >= 3 ? "active" : ""} /></div>{step === 1 && <><span className="eyebrow">STEP 1 OF 3</span><h1>Add your photo.</h1><p>Use the camera or choose one from your gallery.</p><label className={`foundation-photo-picker ${photoPreview ? "has-photo" : ""}`}><span style={photoPreview ? { backgroundImage: `url(${photoPreview})` } : undefined}>{photoPreview ? <Check /> : <ImagePlus />}</span><strong>{photoPreview ? "Photo selected" : "Camera or gallery"}</strong><small>Required · maximum 5 MB</small><input className="file-input" type="file" accept="image/*" onChange={choosePhoto} /></label>{error && <p className="form-error">{error}</p>}<button className="button button--lime button--wide" disabled={!photoFile} onClick={() => setStep(2)}>Continue <ArrowRight size={18} /></button></>}{step === 2 && <><button className="back-link" onClick={() => setStep(1)}><ArrowLeft size={17} />Back</button><span className="eyebrow">STEP 2 OF 3</span><h1>What’s your name?</h1><p>This is the only profile detail people in the Room will see.</p><label>First name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} minLength={2} maxLength={50} placeholder="Anna" /></label><button className="button button--lime button--wide" disabled={displayName.trim().length < 2} onClick={() => setStep(3)}>Continue <ArrowRight size={18} /></button></>}{step === 3 && <><button className="back-link" onClick={() => setStep(2)}><ArrowLeft size={17} />Back</button><span className="eyebrow">STEP 3 OF 3</span><h1>One last check.</h1><p>HERE is currently available only to adults.</p><label className="foundation-age-check"><input type="checkbox" checked={ageConfirmed} onChange={(event) => setAgeConfirmed(event.target.checked)} /><span><Check size={18} /></span><strong>I am 18 or older</strong></label>{error && <p className="form-error">{error}</p>}<button className="button button--lime button--wide" disabled={!ageConfirmed || busy} onClick={finishOnboarding}>{busy ? "Joining…" : "Enter the Room"}<ArrowRight size={18} /></button><small className="foundation-privacy"><ShieldCheck size={14} />Your session and profile stay on this device.</small></>}</section></main>;
  }

  if (screen === "ready" && room && profile) {
    return <main className="foundation-onboarding"><FoundationRoomHeader room={room} /><section className="foundation-form-card returning-card">{ownAvatarUrl && <img className="returning-avatar" src={ownAvatarUrl} alt="" />}<span className="eyebrow">WELCOME BACK</span><h1>Hi, {profile.display_name}.</h1><p>Your profile is ready. Join this event’s Room?</p>{error && <p className="form-error">{error}</p>}<button className="button button--lime button--wide" disabled={busy} onClick={joinReturningGuest}>{busy ? "Joining…" : "Join Room"}<ArrowRight size={18} /></button></section></main>;
  }

  if (screen === "room" && room) {
    if (selectedMatch) {
      const target = { userId: selectedMatch.otherUserId, displayName: selectedMatch.displayName, matchId: selectedMatch.id };
      return <>
        <ChatView
          room={room}
          match={selectedMatch}
          messages={messages}
          ownUserId={profile?.id || ""}
          busy={busy}
          error={error}
          onBack={() => { setSelectedMatch(null); setMessages([]); setError(""); }}
          onSend={sendMessage}
          onBlock={() => void blockPerson(target)}
          onReport={() => setSafetyTarget(target)}
        />
        {safetyTarget && <SafetySheet target={safetyTarget} busy={busy} error={error} onClose={() => setSafetyTarget(null)} onSubmit={submitSafetyReport} />}
      </>;
    }

    const hasCurrentDrop = Boolean(dropState?.drop_id);
    const isForming = hasCurrentDrop && Number(dropState?.assigned_count || 0) === 0 && Number(dropState?.eligible_count || 0) < Number(dropState?.min_unlock_count || 0);
    const hasSeenEveryone = isForming && Number(dropState?.eligible_count || 0) === 0 && Number(dropState?.active_candidate_count || 0) > 0;
    const isClaimable = hasCurrentDrop && Number(dropState?.assigned_count || 0) === 0 && !isForming;
    const isComplete = hasCurrentDrop && Number(dropState?.assigned_count || 0) > 0 && Number(dropState?.remaining_count || 0) === 0;

    return (
      <main className="foundation-room-screen">
        <header>
          <span className="brand"><span className="brand-mark"><Radio size={17} /></span>HERE<span className="brand-dot">.</span></span>
          <span className={`foundation-live ${room.status === "closed" ? "foundation-live--ended" : ""}`}><i />{room.status === "closed" ? "ROOM ENDED" : "ROOM OPEN"}</span>
        </header>

        {room.status === "closed" ? <section className="closed-connections-intro"><LockKeyhole /><span className="eyebrow">ROOM ENDED</span><h1>Your connections stay with you.</h1><p>Discovery is closed, but existing Matches and conversations remain available.</p></section> : <>
        <section className="foundation-room-heading">
          <span className="eyebrow">HERE TONIGHT</span>
          <h1>{joinedCount} people here</h1>
          <p>{room.name} · {room.venue_name || room.city || "Tonight"}</p>
        </section>

        <section className="foundation-wall" aria-label="Room activity">
          <div className="foundation-wall__heading">
            <div><Users /><span>Room Wall</span></div>
            <small>Real people · not a catalogue</small>
          </div>
          {wall.length ? (
            <div className="foundation-avatar-cloud" aria-label={`${wall.length} recent Room participants`}>
              {wall.map((person) => person.avatarUrl
                ? <img key={person.id} src={person.avatarUrl} alt="" />
                : <span key={person.id}>{person.displayName.slice(0, 1)}</span>)}
            </div>
          ) : (
            <div className="foundation-empty-wall"><Users /><strong>You’re first here.</strong><p>Other guests will appear after joining this exact Room.</p></div>
          )}
        </section>

        {dropOpen && dropItems.length ? (
          <section className="your-drop">
            <button className="back-link" onClick={() => setDropOpen(false)}><ArrowLeft size={17} />Room Wall</button>
            <div className="your-drop__top"><span className="eyebrow">YOUR DROP</span><span>{activeItem ? `${activeItem.position} / ${dropItems.length}` : "Complete"}</span></div>
            {activeItem ? (
              <article className="drop-profile-card">
                <div className="drop-profile-card__photo">{activeItem.avatarUrl ? <img src={activeItem.avatarUrl} alt="" /> : <span>{activeItem.displayName.slice(0, 1)}</span>}</div>
                <div className="drop-profile-card__copy"><span>Same place. Right now.</span><h2>{activeItem.displayName}</h2><p>{interestsLeft} {interestsLeft === 1 ? "Interest" : "Interests"} left</p><div className="profile-safety-actions"><button type="button" onClick={() => void blockPerson({ userId: activeItem.candidateId, displayName: activeItem.displayName, matchId: null })}><Ban size={14} />Block</button><button type="button" onClick={() => setSafetyTarget({ userId: activeItem.candidateId, displayName: activeItem.displayName, matchId: null })}><Flag size={14} />Report</button></div></div>
                <div className="drop-profile-card__actions">
                  <button className="button button--ghost" disabled={busy || !activeItem.firstSeenAt} onClick={() => actOnItem("passed")}>Next <ArrowRight size={17} /></button>
                  <button className="button button--lime" disabled={busy || !activeItem.firstSeenAt || interestsLeft === 0} onClick={() => actOnItem("interested")}><Sparkles size={17} />Interested</button>
                </div>
              </article>
            ) : (
              <div className="drop-complete">
                <Check />
                <span className="eyebrow">THAT’S YOUR DROP</span>
                <h2>You’ve seen this Drop.</h2>
                {dropState?.next_scheduled_at ? <p>Next Drop · <strong>{formatCountdown(dropState.next_scheduled_at, nowMs)}</strong><br />New people are joining tonight.</p> : <p>New people may appear in the next one.</p>}
                <button className="button button--dark" onClick={() => setDropOpen(false)}>Back to Room</button>
              </div>
            )}
            {dropError && <p className="form-error">{dropError}</p>}
          </section>
        ) : (
          <section className={`drop-status ${isClaimable ? "drop-status--live" : ""}`}>
            <div>{isClaimable ? <Sparkles /> : <Clock3 />}</div>
            {isClaimable ? <><span className="eyebrow">DROP LIVE</span><h2>Your Drop is ready.</h2><p>A limited selection, balanced for fair opportunity.</p><button className="button button--dark" disabled={busy} onClick={openYourDrop}>Open Your Drop <ArrowRight size={18} /></button></>
              : Number(dropState?.assigned_count || 0) > 0 && !isComplete ? <><span className="eyebrow">YOUR DROP</span><h2>Continue where you left off.</h2><p>Your people and their order stay the same after refresh.</p><button className="button button--dark" onClick={() => setDropOpen(true)}>Continue Your Drop <ArrowRight size={18} /></button></>
                : isComplete ? <><span className="eyebrow">THAT’S YOUR DROP</span><h2>You’ve seen this Drop.</h2>{dropState?.next_scheduled_at ? <p>Next Drop · <strong>{formatCountdown(dropState.next_scheduled_at, nowMs)}</strong><br />New people are joining tonight.</p> : <p>New people may appear in the next one.</p>}</>
                  : hasSeenEveryone ? <><span className="eyebrow">CURRENTLY CAUGHT UP</span><h2>You’ve seen everyone currently available.</h2><p>New people may appear in the next Drop.</p></>
                    : isForming ? <><span className="eyebrow">DROP LIVE</span><h2>Your Drop is forming.</h2><p>People are joining now.</p></>
                      : dropState?.next_scheduled_at ? <><span className="eyebrow">NEXT DROP</span><h2 className="drop-countdown">{formatCountdown(dropState.next_scheduled_at, nowMs)}</h2><p>Stay present. Everyone’s Drop opens together.</p></>
                        : <><span className="eyebrow">DROPS</span><h2>The next Drop will appear here.</h2><p>Keep an eye on the Room Wall.</p></>}
            {dropError && <p className="form-error">{dropError}</p>}
          </section>
        )}

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
                    {person.avatarUrl ? <img src={person.avatarUrl} alt="" /> : <span>{person.displayName.slice(0, 1)}</span>}
                    <strong>{person.displayName}</strong>
                  </button>
                ))}
              </div>
            ) : <p className="interested-in-you__empty">No incoming Interests yet.</p>
          )}
          {incomingOpen && selectedIncoming && (
            <article className="incoming-profile">
              {selectedIncoming.avatarUrl ? <img src={selectedIncoming.avatarUrl} alt="" /> : <span>{selectedIncoming.displayName.slice(0, 1)}</span>}
              <div className="incoming-profile__copy"><span className="eyebrow">SAME PLACE. RIGHT NOW.</span><h2>{selectedIncoming.displayName}</h2><p>They sent you an Interest in this Room.</p><div className="incoming-profile__actions"><button className="button button--lime" disabled={busy} onClick={() => void respondToIncoming(true)}><Sparkles size={17} />Interested Too</button><button className="button button--ghost" disabled={busy} onClick={() => void respondToIncoming(false)}>Not for me</button></div><div className="profile-safety-actions"><button type="button" onClick={() => void blockPerson({ userId: selectedIncoming.fromUserId, displayName: selectedIncoming.displayName, matchId: null })}><Ban size={14} />Block</button><button type="button" onClick={() => setSafetyTarget({ userId: selectedIncoming.fromUserId, displayName: selectedIncoming.displayName, matchId: null })}><Flag size={14} />Report</button></div></div>
              <button type="button" className="icon-button" onClick={() => setSelectedIncoming(null)} aria-label="Close profile"><ArrowLeft size={18} /></button>
            </article>
          )}
        </section>
        </>}

        <MatchesSection matches={matches} open={matchesOpen} onToggle={() => setMatchesOpen((current) => !current)} onOpen={openConversation} />

        {matchMoment && <MatchMoment match={matchMoment} onMessage={() => { openConversation(matchMoment); setMatchMoment(null); }} onBack={() => setMatchMoment(null)} />}
        {safetyTarget && <SafetySheet target={safetyTarget} busy={busy} error={error} onClose={() => setSafetyTarget(null)} onSubmit={submitSafetyReport} />}

        <p className="foundation-room-note"><ShieldCheck size={15} />If you can see the Room, the Room can see you.</p>
      </main>
    );
  }

  return null;
}

function FoundationRoomHeader({ room }: { room: FoundationRoom }) {
  return <section className="foundation-room-summary"><header><span className="brand"><span className="brand-mark"><Radio size={17} /></span>HERE<span className="brand-dot">.</span></span><span className="foundation-live"><i />ROOM OPEN</span></header><div><span className="eyebrow">TONIGHT AT</span><h2>{room.venue_name || room.name}</h2><p><MapPin size={15} />{room.city || "Event location"}<b>·</b><CalendarDays size={15} />{roomDate(room.starts_at)}</p></div></section>;
}

function RoomState({ icon, eyebrow, title, copy }: { icon: React.ReactNode; eyebrow?: string; title: string; copy: string }) {
  return <main className="foundation-state"><span className="brand"><span className="brand-mark"><Radio size={17} /></span>HERE<span className="brand-dot">.</span></span><div className="foundation-state__icon">{icon}</div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h1>{title}</h1><p>{copy}</p></main>;
}

function MatchesSection({ matches, open, onToggle, onOpen }: { matches: RoomMatch[]; open: boolean; onToggle: () => void; onOpen: (match: RoomMatch) => void }) {
  return <section className="room-matches">
    <button className="room-matches__toggle" type="button" aria-expanded={open} onClick={onToggle}>
      <span><MessageCircle /><strong>Matches</strong></span>
      <span>{matches.length}<ArrowRight size={18} /></span>
    </button>
    {open && (matches.length ? <div className="room-match-list">{matches.map((match) => <button type="button" key={match.id} onClick={() => onOpen(match)}>{match.avatarUrl ? <img src={match.avatarUrl} alt="" /> : <span>{match.displayName.slice(0, 1)}</span>}<div><strong>{match.displayName}</strong><small>{match.lastMessageBody || "You’re both here. Say hi."}</small></div><time>{new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit" }).format(new Date(match.lastMessageAt || match.matchedAt))}</time>{match.unreadCount > 0 && <i>{match.unreadCount}</i>}<ArrowRight size={17} /></button>)}</div> : <p className="room-matches__empty">Mutual connections will appear here.</p>)}
  </section>;
}

function MatchMoment({ match, onMessage, onBack }: { match: RoomMatch; onMessage: () => void; onBack: () => void }) {
  return <div className="match-moment" role="dialog" aria-modal="true" aria-label="New Match">
    <section><span className="match-moment__icon"><Sparkles /></span><span className="eyebrow">IT’S MUTUAL</span>{match.avatarUrl ? <img src={match.avatarUrl} alt="" /> : <div className="match-moment__avatar">{match.displayName.slice(0, 1)}</div>}<h2>You and {match.displayName} noticed each other.</h2><p>You’re both here right now. Say hi, then go meet in person.</p><div><button className="button button--lime" onClick={onMessage}><MessageCircle size={17} />Message</button><button className="button button--ghost" onClick={onBack}>Back to Room</button></div></section>
  </div>;
}

function ChatView({ room, match, messages, ownUserId, busy, error, onBack, onSend, onBlock, onReport }: { room: FoundationRoom; match: RoomMatch; messages: MatchMessage[]; ownUserId: string; busy: boolean; error: string; onBack: () => void; onSend: (event: FormEvent<HTMLFormElement>) => void; onBlock: () => void; onReport: () => void }) {
  return <main className="match-chat">
    <header><button className="icon-button" onClick={onBack} aria-label="Back to Matches"><ArrowLeft size={19} /></button><div>{match.avatarUrl ? <img src={match.avatarUrl} alt="" /> : <span>{match.displayName.slice(0, 1)}</span>}<div><strong>{match.displayName}</strong><small>{room.status === "closed" ? "You met here" : `Here at ${room.venue_name || room.name} tonight`}</small></div></div><div className="chat-safety"><button type="button" onClick={onReport}><Flag size={15} />Report</button><button type="button" onClick={onBlock}><Ban size={15} />Block</button></div></header>
    <section className="match-chat__context"><span className="eyebrow">REAL PEOPLE. SAME PLACE.</span><p>{room.status === "closed" ? "This Room has ended, but your conversation remains." : `You’re both at ${room.venue_name || room.name} tonight. Chat briefly, then go say hi.`}</p></section>
    <section className="match-chat__messages" aria-live="polite">{messages.length ? messages.map((message) => <article className={message.senderId === ownUserId ? "mine" : "theirs"} key={message.id}><p>{message.body}</p><time>{new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit" }).format(new Date(message.createdAt))}</time></article>) : <div className="match-chat__empty"><MessageCircle /><strong>Break the final barrier.</strong><p>One short message is enough.</p></div>}</section>
    {error && <p className="match-chat__error form-error">{error}</p>}
    <form className="match-chat__composer" onSubmit={onSend}><input name="message" maxLength={1000} placeholder={`Message ${match.displayName}`} aria-label={`Message ${match.displayName}`} autoComplete="off" /><button className="button button--lime" disabled={busy} aria-label="Send message"><Send size={18} /></button></form>
  </main>;
}

function SafetySheet({ target, busy, error, onClose, onSubmit }: { target: SafetyTarget; busy: boolean; error: string; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <div className="safety-sheet" role="dialog" aria-modal="true" aria-label={`Report ${target.displayName}`}><form onSubmit={onSubmit}><button type="button" className="icon-button safety-sheet__close" onClick={onClose} aria-label="Close report"><X size={18} /></button><Flag /><span className="eyebrow">SAFETY</span><h2>Report {target.displayName}</h2><p>The person you report will never see who submitted it.</p><label>Reason<select name="reason" required defaultValue=""><option value="" disabled>Choose a reason</option>{REPORT_REASONS.map((reason) => <option value={reason} key={reason}>{reason}</option>)}</select></label><label>Details <small>Optional</small><textarea name="details" maxLength={1000} placeholder="Add anything our safety team should know." /></label>{error && <p className="form-error">{error}</p>}<div><button className="button button--dark" name="block" value="false" disabled={busy}>Submit report</button><button className="button button--lime" name="block" value="true" disabled={busy}><Ban size={16} />Report and Block</button></div></form></div>;
}
