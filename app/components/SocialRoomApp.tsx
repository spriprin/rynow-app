"use client";
/* eslint-disable @next/next/no-img-element -- guest photos are remote demo assets and QR images are client-generated data URLs. */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ChangeEvent, type FormEvent } from "react";
import QRCode from "qrcode";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  ChevronRight,
  CircleUserRound,
  Clock3,
  Copy,
  Download,
  Flag,
  Heart,
  ImagePlus,
  Info,
  LayoutGrid,
  Link2,
  LockKeyhole,
  LogOut,
  MapPin,
  Menu,
  MessageCircle,
  MoreHorizontal,
  Plus,
  QrCode,
  Radio,
  Send,
  ShieldCheck,
  Sparkles,
  UserRoundCheck,
  Users,
  X,
  Zap,
} from "lucide-react";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { ChatMessage, Person, Purpose, Room, RoomStatus } from "@/lib/types";

export type AppView =
  | "landing"
  | "room"
  | "discovery"
  | "matches"
  | "chat"
  | "profile"
  | "organizer"
  | "create"
  | "auth";

const photo = (id: string) =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&w=900&q=86`;

const PEOPLE: Person[] = [
  {
    id: "10000000-0000-4000-8000-000000000003",
    name: "Noah",
    age: 28,
    purpose: "Networking",
    bio: "Product designer, vinyl collector and the person who always knows the next good place.",
    interests: ["Design", "Startups", "Music", "Travel"],
    photo: photo("photo-1500648767791-00dcc994a43e"),
    accent: "#d7ff54",
  },
  {
    id: "10000000-0000-4000-8000-000000000004",
    name: "Sofia",
    age: 26,
    purpose: "Friends",
    bio: "New in Riga. Here for live music, good conversations and a little spontaneous dancing.",
    interests: ["Live music", "Art", "Travel", "Food"],
    photo: photo("photo-1494790108377-be9c29b29330"),
    accent: "#ff8269",
  },
  {
    id: "10000000-0000-4000-8000-000000000005",
    name: "Leo",
    age: 30,
    purpose: "Just meeting people",
    bio: "Architect by day, amateur DJ after dark. Ask me about the city’s hidden corners.",
    interests: ["Architecture", "House", "Running"],
    photo: photo("photo-1507003211169-0a1dd7228f2d"),
    accent: "#7f8cff",
  },
  {
    id: "10000000-0000-4000-8000-000000000006",
    name: "Amelia",
    age: 27,
    purpose: "Dating",
    bio: "Creative producer. Equal parts gallery openings, long dinners and last-minute flights.",
    interests: ["Fashion", "Cinema", "Food", "Pilates"],
    photo: photo("photo-1534528741775-53994a69daeb"),
    accent: "#f3b9ff",
  },
  {
    id: "10000000-0000-4000-8000-000000000007",
    name: "Martin",
    age: 31,
    purpose: "Networking",
    bio: "Building climate tech. I came for the panel, stayed for the dance floor.",
    interests: ["Technology", "Business", "Cycling"],
    photo: photo("photo-1539571696357-5a69c17a67c6"),
    accent: "#6de1c2",
  },
  {
    id: "10000000-0000-4000-8000-000000000008",
    name: "Elena",
    age: 29,
    purpose: "Friends",
    bio: "Photographer, curious human, enthusiastic beginner at almost everything.",
    interests: ["Photography", "Yoga", "Books", "Nature"],
    photo: photo("photo-1524504388940-b1c1722653e1"),
    accent: "#ffc85a",
  },
];

const DEFAULT_ROOM: Room = {
  id: "20000000-0000-4000-8000-000000000001",
  slug: "friday-social",
  name: "Friday Social Night",
  eventName: "Friday Social Night",
  venue: "Lumen Club",
  city: "Riga",
  description: "A one-night room for the people sharing this place, this music and this moment.",
  startsAt: "2026-08-14T21:00",
  endsAt: "2026-08-15T03:00",
  status: "LIVE",
  cover: photo("photo-1492684223066-81342ee5ff30"),
};

const PURPOSES: Purpose[] = ["Dating", "Friends", "Networking", "Just meeting people"];
const INTEREST_OPTIONS = [
  "Music",
  "Travel",
  "Business",
  "Startups",
  "Fitness",
  "Fashion",
  "Gaming",
  "Art",
  "Technology",
  "Food",
];

const INITIAL_MESSAGES: ChatMessage[] = [
  { id: "m1", sender: "them", content: "Hey! I think we were both near the terrace earlier 👋", time: "22:41" },
  { id: "m2", sender: "me", content: "Yes! I’m by the neon installation now. Want to say hi?", time: "22:42" },
  { id: "m3", sender: "them", content: "Perfect — coming over in two minutes.", time: "22:42" },
];

function statusLabel(status: RoomStatus) {
  return status === "LIVE" ? "Live now" : status.charAt(0) + status.slice(1).toLowerCase();
}

function formatEventDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Friday · 21:00";
  return new Intl.DateTimeFormat("en", {
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Riga",
  }).format(date);
}

function ageFromDate(dateOfBirth: string | null | undefined) {
  if (!dateOfBirth) return 18;
  const birth = new Date(`${dateOfBirth}T12:00:00Z`);
  const today = new Date();
  let age = today.getUTCFullYear() - birth.getUTCFullYear();
  if (today.getUTCMonth() < birth.getUTCMonth() || (today.getUTCMonth() === birth.getUTCMonth() && today.getUTCDate() < birth.getUTCDate())) age -= 1;
  return Math.max(age, 18);
}

function profileToPerson(profile: Record<string, unknown>): Person {
  const purpose = PURPOSES.includes(profile.purpose as Purpose) ? profile.purpose as Purpose : "Just meeting people";
  return {
    id: String(profile.id),
    name: String(profile.display_name || "Guest"),
    age: ageFromDate(profile.date_of_birth as string | null),
    purpose,
    bio: String(profile.bio || "Open to meeting someone new."),
    interests: Array.isArray(profile.interests) ? profile.interests.map(String) : [],
    photo: String(profile.profile_photo || photo("photo-1535713875002-d1d0cf377fde")),
    accent: "#d8ff52",
  };
}

export function SocialRoomApp({ initialView = "landing", roomSlug }: { initialView?: AppView; roomSlug?: string }) {
  const [view, setView] = useState<AppView>(initialView);
  const [previousView, setPreviousView] = useState<AppView>("landing");
  const [room, setRoom] = useState(DEFAULT_ROOM);
  const [authenticated, setAuthenticated] = useState(initialView === "organizer" || initialView === "discovery" || initialView === "matches");
  const [joined, setJoined] = useState(initialView === "discovery" || initialView === "matches");
  const [visible, setVisible] = useState(initialView === "discovery" || initialView === "matches");
  const [profileComplete, setProfileComplete] = useState(initialView !== "room" && initialView !== "landing");
  const [selectedPurpose, setSelectedPurpose] = useState<Purpose>("Just meeting people");
  const [selectedInterests, setSelectedInterests] = useState(["Music", "Travel", "Art"]);
  const [people, setPeople] = useState<Person[]>(PEOPLE);
  const [sentInterests, setSentInterests] = useState<string[]>([]);
  const [matchedPeople, setMatchedPeople] = useState<string[]>([PEOPLE[1].id, PEOPLE[2].id]);
  const [matchedProfiles, setMatchedProfiles] = useState<Person[]>(PEOPLE.slice(1, 3));
  const [matchIds, setMatchIds] = useState<Record<string, string>>({
    [PEOPLE[0].id]: "30000000-0000-4000-8000-000000000001",
    [PEOPLE[1].id]: "30000000-0000-4000-8000-000000000002",
  });
  const [selectedPerson, setSelectedPerson] = useState<Person | null>(null);
  const [showMatch, setShowMatch] = useState<Person | null>(null);
  const [activeChat, setActiveChat] = useState<Person>(PEOPLE[0]);
  const [messages, setMessages] = useState<ChatMessage[]>(INITIAL_MESSAGES);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [toast, setToast] = useState("");
  const [authError, setAuthError] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [profilePhoto, setProfilePhoto] = useState(photo("photo-1531123897727-8f129e1688ce"));
  const [quickPhoto, setQuickPhoto] = useState("");
  const [quickPhotoFile, setQuickPhotoFile] = useState<File | null>(null);
  const [displayName, setDisplayName] = useState("Maya");
  const [profileBio, setProfileBio] = useState("Creative strategist, live music person, always planning the next little adventure.");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [analytics, setAnalytics] = useState({ joined: 142, visible: 93, interests: 287, matches: 41, conversations: 29 });
  const [createdRooms, setCreatedRooms] = useState<Room[]>([DEFAULT_ROOM]);
  const runtimeOrigin = useSyncExternalStore(
    () => () => undefined,
    () => window.location.origin,
    () => process.env.NEXT_PUBLIC_APP_URL || "https://your-domain.com",
  );
  const messageEndRef = useRef<HTMLDivElement>(null);
  const [organizerIntent, setOrganizerIntent] = useState(initialView === "organizer");
  const supabaseEnabled = isSupabaseConfigured();

  const roomUrl = useMemo(() => {
    return `${runtimeOrigin || "https://your-domain.com"}/r/${room.slug}`;
  }, [room.slug, runtimeOrigin]);

  useEffect(() => {
    QRCode.toDataURL(roomUrl, {
      width: 720,
      margin: 2,
      color: { dark: "#101111", light: "#f7f4ec" },
      errorCorrectionLevel: "H",
    }).then(setQrDataUrl).catch(() => setQrDataUrl(""));
  }, [roomUrl]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, view]);

  useEffect(() => {
    const client = getSupabaseBrowserClient();
    if (!client || !roomSlug) return;
    void client.rpc("get_public_room", { p_slug: roomSlug }).then(({ data }) => {
      if (!data) return;
      setRoom({
        id: data.id,
        slug: data.slug,
        name: data.name,
        eventName: data.event_name,
        venue: data.venue_name,
        city: data.city,
        description: data.description,
        startsAt: data.starts_at,
        endsAt: data.ends_at,
        status: data.status,
        cover: data.cover_image || DEFAULT_ROOM.cover,
      });
      setAnalytics((current) => ({ ...current, joined: Number(data.participants || 0) }));
    });
  }, [roomSlug]);

  useEffect(() => {
    const client = getSupabaseBrowserClient();
    if (!client || view !== "organizer") return;
    void client.auth.getUser().then(async ({ data }) => {
      if (!data.user) {
        setAuthenticated(false);
        setView("auth");
        return;
      }
      setAuthenticated(true);
      await client.from("profiles").update({ role: "ORGANIZER" }).eq("id", data.user.id);
      const { data: rows } = await client.from("rooms").select("*").eq("organizer_id", data.user.id).order("created_at", { ascending: false });
      if (!rows?.length) return;
      const mappedRooms = rows.map((item) => ({
        id: item.id,
        slug: item.slug,
        name: item.name,
        eventName: item.event_name,
        venue: item.venue_name,
        city: item.city,
        description: item.description,
        startsAt: item.starts_at,
        endsAt: item.ends_at,
        status: item.status,
        cover: item.cover_image || DEFAULT_ROOM.cover,
      } satisfies Room));
      setCreatedRooms(mappedRooms);
      setRoom(mappedRooms[0]);
      const { data: roomStats } = await client.rpc("room_analytics", { p_room_id: mappedRooms[0].id });
      if (roomStats) setAnalytics({
        joined: Number(roomStats.participants || 0),
        visible: Number(roomStats.visible_users || 0),
        interests: Number(roomStats.interests_sent || 0),
        matches: Number(roomStats.matches_created || 0),
        conversations: Number(roomStats.messages_started || 0),
      });
    });
  }, [view]);

  useEffect(() => {
    const client = getSupabaseBrowserClient();
    if (!client || view !== "discovery" || !visible) return;
    void client.auth.getUser().then(async ({ data: userData }) => {
      const { data: rows } = await client
        .from("room_members")
        .select("user_id, profiles!room_members_user_id_fkey(id, display_name, profile_photo, date_of_birth, bio, interests, purpose)")
        .eq("room_id", room.id)
        .eq("status", "ACTIVE")
        .eq("is_visible", true)
        .neq("user_id", userData.user?.id || "00000000-0000-0000-0000-000000000000");
      if (!rows) return;
      setPeople(rows.flatMap((row) => {
        const relation = row.profiles as unknown;
        const profile = Array.isArray(relation) ? relation[0] : relation;
        return profile && typeof profile === "object" ? [profileToPerson(profile as Record<string, unknown>)] : [];
      }));
    });
  }, [room.id, view, visible]);

  useEffect(() => {
    const client = getSupabaseBrowserClient();
    if (!client || view !== "matches") return;
    void client.auth.getUser().then(async ({ data: userData }) => {
      if (!userData.user) return;
      const { data: rows } = await client
        .from("matches")
        .select("id, user_a, user_b, profile_a:profiles!matches_user_a_fkey(id, display_name, profile_photo, date_of_birth, bio, interests, purpose), profile_b:profiles!matches_user_b_fkey(id, display_name, profile_photo, date_of_birth, bio, interests, purpose)")
        .order("created_at", { ascending: false });
      if (!rows) return;
      const ids: Record<string, string> = {};
      const profiles = rows.flatMap((match) => {
        const relation = match.user_a === userData.user?.id ? match.profile_b : match.profile_a;
        const profile = (Array.isArray(relation) ? relation[0] : relation) as unknown;
        if (!profile || typeof profile !== "object") return [];
        const person = profileToPerson(profile as Record<string, unknown>);
        ids[person.id] = match.id;
        return [person];
      });
      setMatchedProfiles(profiles);
      setMatchedPeople(profiles.map((person) => person.id));
      setMatchIds(ids);
    });
  }, [view]);

  useEffect(() => {
    if (view !== "chat" || !supabaseEnabled) return;
    const client = getSupabaseBrowserClient();
    if (!client) return;
    const matchId = matchIds[activeChat.id];
    if (!matchId) return;
    void Promise.all([client.auth.getUser(), client.from("messages").select("*").eq("match_id", matchId).order("created_at")]).then(([userResult, messageResult]) => {
      if (!messageResult.data) return;
      setMessages(messageResult.data.map((row) => ({
        id: row.id,
        sender: row.sender_id === userResult.data.user?.id ? "me" : "them",
        content: row.content,
        time: new Date(row.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      })) as ChatMessage[]);
    });
    const channel = client
      .channel(`messages:${matchId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `match_id=eq.${matchId}` },
        (payload) => {
          const row = payload.new as { id: string; sender_id: string; content: string; created_at: string };
          client.auth.getUser().then(({ data }) => {
            setMessages((current) => current.some((message) => message.id === row.id)
              ? current
              : [...current, {
                  id: row.id,
                  sender: row.sender_id === data.user?.id ? "me" : "them",
                  content: row.content,
                  time: new Date(row.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
                }]);
          });
        },
      )
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }, [activeChat.id, matchIds, supabaseEnabled, view]);

  function navigate(next: AppView) {
    setPreviousView(view);
    setView(next);
    setMenuOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function flash(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2400);
  }

  async function copyRoomLink() {
    await navigator.clipboard?.writeText(roomUrl);
    flash("Room link copied");
  }

  async function startJoin() {
    setOrganizerIntent(false);
    if (!authenticated) {
      setPreviousView("room");
      setView("auth");
      return;
    }
    if (!profileComplete) {
      setPreviousView("room");
      setView("profile");
      return;
    }
    const client = getSupabaseBrowserClient();
    if (client) {
      const { error } = await client.rpc("join_room", { p_slug: room.slug });
      if (error) return flash(error.message);
    }
    setJoined(true);
    setAnalytics((current) => ({ ...current, joined: current.joined + 1 }));
    navigate("discovery");
  }

  function openOrganizer() {
    setOrganizerIntent(true);
    navigate("organizer");
  }

  async function handleAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthBusy(true);
    setAuthError("");
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") || "");
    const password = String(data.get("password") || "");
    const client = getSupabaseBrowserClient();

    if (client) {
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) {
        const result = await client.auth.signUp({ email, password, options: { data: { display_name: "New guest" } } });
        if (result.error) {
          setAuthError(result.error.message);
          setAuthBusy(false);
          return;
        }
      }
    }

    setAuthenticated(true);
    setAuthBusy(false);
    if (organizerIntent) {
      if (client) {
        const { data: userData } = await client.auth.getUser();
        if (userData.user) await client.from("profiles").update({ role: "ORGANIZER" }).eq("id", userData.user.id);
      }
      setProfileComplete(true);
      setView("organizer");
      return;
    }
    setPreviousView("room");
    setView("profile");
  }

  async function handleGoogleAuth() {
    const client = getSupabaseBrowserClient();
    if (client) {
      await client.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: organizerIntent ? `${window.location.origin}/organizer` : `${window.location.origin}/r/${room.slug}` },
      });
      return;
    }
    setAuthenticated(true);
    if (organizerIntent) {
      setProfileComplete(true);
      setView("organizer");
    } else {
      setPreviousView("room");
      setView("profile");
    }
  }

  async function handlePhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return flash("Photo must be smaller than 5 MB");
    const localPreview = URL.createObjectURL(file);
    setProfilePhoto(localPreview);
    const client = getSupabaseBrowserClient();
    if (!client) return flash("Photo updated for this demo session");
    const { data: userData } = await client.auth.getUser();
    if (!userData.user) return flash("Sign in before uploading a photo");
    const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const path = `${userData.user.id}/avatar-${Date.now()}.${extension}`;
    const { error } = await client.storage.from("profile-photos").upload(path, file, { upsert: true, contentType: file.type });
    if (error) return flash(error.message);
    const publicUrl = client.storage.from("profile-photos").getPublicUrl(path).data.publicUrl;
    await client.from("profiles").update({ profile_photo: publicUrl }).eq("id", userData.user.id);
    setProfilePhoto(publicUrl);
    flash("Profile photo updated");
  }

  function handleQuickPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setAuthError("Photo must be smaller than 5 MB");
      return;
    }
    setAuthError("");
    setQuickPhotoFile(file);
    setQuickPhoto(URL.createObjectURL(file));
  }

  async function quickJoin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("displayName") || "").trim();
    if (!quickPhotoFile || !quickPhoto) {
      setAuthError("Add a photo so people know who they are meeting.");
      return;
    }
    setAuthBusy(true);
    setAuthError("");
    const client = getSupabaseBrowserClient();
    let savedPhoto = quickPhoto;

    if (client) {
      const { data: authData, error: signInError } = await client.auth.signInAnonymously({
        options: { data: { display_name: name } },
      });
      if (signInError || !authData.user) {
        setAuthError(signInError?.message || "Could not start your guest session.");
        setAuthBusy(false);
        return;
      }
      const extension = quickPhotoFile.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${authData.user.id}/avatar-${Date.now()}.${extension}`;
      const { error: uploadError } = await client.storage
        .from("profile-photos")
        .upload(path, quickPhotoFile, { upsert: true, contentType: quickPhotoFile.type });
      if (uploadError) {
        setAuthError(uploadError.message);
        setAuthBusy(false);
        return;
      }
      savedPhoto = client.storage.from("profile-photos").getPublicUrl(path).data.publicUrl;
      const { error: profileError } = await client.from("profiles").upsert({
        id: authData.user.id,
        display_name: name,
        profile_photo: savedPhoto,
        purpose: selectedPurpose,
        interests: selectedInterests,
      });
      if (profileError) {
        setAuthError(profileError.message);
        setAuthBusy(false);
        return;
      }
      const { error: joinError } = await client.rpc("join_room", { p_slug: room.slug });
      if (joinError) {
        setAuthError(joinError.message);
        setAuthBusy(false);
        return;
      }
    }

    setDisplayName(name);
    setProfilePhoto(savedPhoto);
    setAuthenticated(true);
    setProfileComplete(true);
    setJoined(true);
    setVisible(false);
    setAuthBusy(false);
    setAnalytics((current) => ({ ...current, joined: current.joined + 1 }));
    navigate("discovery");
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const nextName = String(form.get("displayName") || "Guest");
    const nextDateOfBirth = String(form.get("dateOfBirth") || "");
    const nextBio = String(form.get("bio") || "");
    const client = getSupabaseBrowserClient();
    if (client) {
      const { data } = await client.auth.getUser();
      if (data.user) {
        const { error } = await client.from("profiles").upsert({
          id: data.user.id,
          display_name: nextName,
          date_of_birth: nextDateOfBirth,
          purpose: selectedPurpose,
          interests: selectedInterests,
          bio: nextBio,
          profile_photo: profilePhoto,
        });
        if (error) return flash(error.message);
        await client.rpc("join_room", { p_slug: room.slug });
      }
    }
    setDisplayName(nextName);
    setDateOfBirth(nextDateOfBirth);
    setProfileBio(nextBio);
    setProfileComplete(true);
    setJoined(true);
    setVisible(false);
    setAnalytics((current) => ({ ...current, joined: current.joined + 1 }));
    navigate("discovery");
  }

  async function saveProfileSettings() {
    const client = getSupabaseBrowserClient();
    if (client) {
      const { data } = await client.auth.getUser();
      if (data.user) {
        const { error } = await client.from("profiles").update({
          display_name: displayName.trim() || "Guest",
          date_of_birth: dateOfBirth || null,
          bio: profileBio,
          purpose: selectedPurpose,
          interests: selectedInterests,
          profile_photo: profilePhoto,
        }).eq("id", data.user.id);
        if (error) return flash(error.message);
      }
    }
    flash("Profile saved");
  }

  async function toggleVisibility() {
    const next = !visible;
    const client = getSupabaseBrowserClient();
    if (client) {
      const { error } = await client.rpc("set_room_visibility", { p_room_id: room.id, p_visible: next });
      if (error) return flash(error.message);
    }
    setVisible(next);
    setAnalytics((current) => ({ ...current, visible: Math.max(0, current.visible + (next ? 1 : -1)) }));
    flash(next ? "You’re now visible in this room" : "You’re hidden from discovery");
  }

  async function sendInterest(person: Person) {
    if (room.status !== "LIVE") return flash("This room is closed to new interests");
    if (sentInterests.includes(person.id)) return;
    const client = getSupabaseBrowserClient();
    let isMatch = person.id === PEOPLE[0].id;
    if (client) {
      const { data, error } = await client.rpc("send_interest", { p_room_id: room.id, p_receiver_id: person.id });
      if (error) return flash(error.message);
      const result = data as { matched?: boolean; match_id?: string } | null;
      isMatch = Boolean(result?.matched);
      if (result?.match_id) setMatchIds((current) => ({ ...current, [person.id]: result.match_id as string }));
    }
    setSentInterests((current) => [...current, person.id]);
    setAnalytics((current) => ({ ...current, interests: current.interests + 1 }));
    if (isMatch) {
      setMatchedPeople((current) => [...new Set([...current, person.id])]);
      setMatchedProfiles((current) => current.some((item) => item.id === person.id) ? current : [person, ...current]);
      setAnalytics((current) => ({ ...current, matches: current.matches + 1 }));
      window.setTimeout(() => setShowMatch(person), 350);
    } else {
      flash(`Interest sent to ${person.name}`);
    }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const content = String(data.get("message") || "").trim();
    if (!content) return;
    const client = getSupabaseBrowserClient();
    if (client) {
      const matchId = matchIds[activeChat.id];
      if (!matchId) return flash("Match is still syncing — try again in a moment");
      const { error } = await client.from("messages").insert({ match_id: matchId, content });
      if (error) return flash(error.message);
    } else {
      setMessages((current) => [...current, {
        id: crypto.randomUUID(),
        sender: "me",
        content,
        time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      }]);
    }
    form.reset();
    setAnalytics((current) => ({ ...current, conversations: Math.max(30, current.conversations) }));
  }

  async function createRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const slug = String(data.get("roomName") || "social-room")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") + `-${Math.random().toString(36).slice(2, 6)}`;
    const client = getSupabaseBrowserClient();
    const coverFile = data.get("coverImage");
    let coverUrl = DEFAULT_ROOM.cover;
    let organizerId: string | undefined;
    if (client) {
      const { data: userData } = await client.auth.getUser();
      organizerId = userData.user?.id;
      if (!organizerId) return flash("Sign in as an organizer first");
      if (coverFile instanceof File && coverFile.size > 0) {
        if (coverFile.size > 8 * 1024 * 1024) return flash("Cover image must be smaller than 8 MB");
        const extension = coverFile.name.split(".").pop()?.toLowerCase() || "jpg";
        const path = `${organizerId}/${crypto.randomUUID()}.${extension}`;
        const { error: uploadError } = await client.storage.from("room-covers").upload(path, coverFile, { contentType: coverFile.type });
        if (uploadError) return flash(uploadError.message);
        coverUrl = client.storage.from("room-covers").getPublicUrl(path).data.publicUrl;
      }
    } else if (coverFile instanceof File && coverFile.size > 0) {
      coverUrl = URL.createObjectURL(coverFile);
    }
    const nextRoom: Room = {
      id: crypto.randomUUID(),
      slug,
      name: String(data.get("roomName")),
      eventName: String(data.get("eventName")),
      venue: String(data.get("venue")),
      city: String(data.get("city")),
      description: String(data.get("description")),
      startsAt: String(data.get("startsAt")),
      endsAt: String(data.get("endsAt")),
      status: "UPCOMING",
      cover: coverUrl,
    };
    if (client) {
      const { data: inserted, error } = await client.from("rooms").insert({
        organizer_id: organizerId,
        name: nextRoom.name,
        event_name: nextRoom.eventName,
        venue_name: nextRoom.venue,
        city: nextRoom.city,
        description: nextRoom.description,
        starts_at: nextRoom.startsAt,
        ends_at: nextRoom.endsAt,
        status: nextRoom.status,
        cover_image: coverUrl,
      }).select().single();
      if (error) return flash(error.message);
      if (inserted) {
        nextRoom.id = inserted.id;
        nextRoom.slug = inserted.slug;
      }
    }
    setRoom(nextRoom);
    setCreatedRooms((current) => [nextRoom, ...current]);
    navigate("organizer");
    flash("Room created — your QR is ready");
  }

  async function closeRoom() {
    const client = getSupabaseBrowserClient();
    if (client) {
      const { error } = await client.from("rooms").update({ status: "CLOSED" }).eq("id", room.id);
      if (error) return flash(error.message);
    }
    setRoom((current) => ({ ...current, status: "CLOSED" }));
    setCreatedRooms((current) => current.map((item) => item.id === room.id ? { ...item, status: "CLOSED" } : item));
    flash("Room closed. Existing matches and chats remain available.");
  }

  if (view === "landing") {
    return (
      <div className="responsive-entry">
        <div className="entry-desktop"><LandingPage onJoin={() => navigate("room")} onCreate={openOrganizer} /></div>
        <div className="entry-mobile"><QuickJoinPage room={room} people={analytics.joined} photo={quickPhoto} busy={authBusy} error={authError} onPhoto={handleQuickPhoto} onSubmit={quickJoin} onOrganizer={openOrganizer} /></div>
      </div>
    );
  }

  if (view === "room" && !joined) {
    return (
      <div className="responsive-entry">
        <div className="entry-desktop"><PublicRoomPage room={room} people={analytics.joined} onJoin={startJoin} onBack={() => navigate("landing")} /></div>
        <div className="entry-mobile"><QuickJoinPage room={room} people={analytics.joined} photo={quickPhoto} busy={authBusy} error={authError} onPhoto={handleQuickPhoto} onSubmit={quickJoin} onOrganizer={openOrganizer} /></div>
      </div>
    );
  }

  if (view === "auth") {
    if (!organizerIntent) {
      return <QuickJoinPage room={room} people={analytics.joined} photo={quickPhoto} busy={authBusy} error={authError} onPhoto={handleQuickPhoto} onSubmit={quickJoin} onOrganizer={openOrganizer} />;
    }
    return (
      <OrganizerAuthPage
        room={room}
        busy={authBusy}
        error={authError}
        demo={!supabaseEnabled}
        onSubmit={handleAuth}
        onGoogle={handleGoogleAuth}
        onBack={() => navigate(previousView)}
      />
    );
  }

  if (view === "profile" && !profileComplete) {
    return (
      <OnboardingPage
        purpose={selectedPurpose}
        interests={selectedInterests}
        photo={profilePhoto}
        onPhoto={handlePhotoChange}
        onPurpose={setSelectedPurpose}
        onInterest={(interest) => setSelectedInterests((current) =>
          current.includes(interest) ? current.filter((item) => item !== interest) : [...current, interest].slice(-5),
        )}
        onSubmit={saveProfile}
        onBack={() => navigate(previousView)}
      />
    );
  }

  const shellView = view === "room" ? "discovery" : view;

  return (
    <div className="app-frame">
      <aside className={`side-nav ${menuOpen ? "side-nav--open" : ""}`}>
        <button className="brand brand--button" onClick={() => navigate("landing")} aria-label="Go to home">
          <span className="brand-mark"><Radio size={18} /></span>
          <span>HERE<span className="brand-dot">.</span></span>
        </button>
        <nav aria-label="Main navigation">
          {view === "organizer" || view === "create" ? (
            <>
              <NavItem active={view === "organizer"} icon={<LayoutGrid />} label="Rooms" onClick={() => navigate("organizer")} />
              <NavItem active={view === "create"} icon={<Plus />} label="Create room" onClick={() => navigate("create")} />
              <NavItem icon={<CircleUserRound />} label="Profile" onClick={() => { setProfileComplete(true); navigate("profile"); }} />
            </>
          ) : (
            <>
              <NavItem active={shellView === "discovery"} icon={<Users />} label="People" onClick={() => navigate("discovery")} />
              <NavItem active={view === "matches" || view === "chat"} icon={<MessageCircle />} label="Matches" badge={matchedPeople.length} onClick={() => navigate("matches")} />
              <NavItem active={view === "profile"} icon={<CircleUserRound />} label="Profile" onClick={() => navigate("profile")} />
            </>
          )}
        </nav>
        <div className="side-nav__room">
          <span className={`status-dot status-dot--${room.status.toLowerCase()}`} />
          <div><small>Current room</small><strong>{room.name}</strong></div>
        </div>
        <button className="nav-item nav-item--muted" onClick={() => { setAuthenticated(false); setJoined(false); navigate("landing"); }}>
          <LogOut size={19} /><span>Sign out</span>
        </button>
      </aside>

      <main className="app-main">
        <header className="mobile-header">
          <button className="brand brand--button" onClick={() => navigate("landing")}><span className="brand-mark"><Radio size={16} /></span>HERE<span className="brand-dot">.</span></button>
          <button className="icon-button" onClick={() => setMenuOpen(!menuOpen)} aria-label="Open menu">{menuOpen ? <X /> : <Menu />}</button>
        </header>

        {view === "discovery" && (
          <DiscoveryPage
            room={room}
            people={people}
            visible={visible}
            sent={sentInterests}
            onToggle={toggleVisibility}
            onInterest={sendInterest}
            onSelect={setSelectedPerson}
            onRoomInfo={() => navigate("room")}
          />
        )}
        {view === "room" && joined && <RoomInfoPage room={room} qr={qrDataUrl} roomUrl={roomUrl} onCopy={copyRoomLink} />}
        {view === "matches" && (
          <MatchesPage
            people={matchedProfiles}
            room={room}
            onChat={(person) => { setActiveChat(person); navigate("chat"); }}
            onProfile={setSelectedPerson}
          />
        )}
        {view === "chat" && <ChatPage person={activeChat} messages={messages} onBack={() => navigate("matches")} onSend={sendMessage} endRef={messageEndRef} />}
        {view === "profile" && profileComplete && (
          <ProfilePage name={displayName} bio={profileBio} dateOfBirth={dateOfBirth} photo={profilePhoto} onName={setDisplayName} onBio={setProfileBio} onDateOfBirth={setDateOfBirth} onPhoto={handlePhotoChange} visible={visible} interests={selectedInterests} purpose={selectedPurpose} onToggle={toggleVisibility} onPurpose={setSelectedPurpose} onInterest={(interest) => setSelectedInterests((current) => current.includes(interest) ? current.filter((item) => item !== interest) : [...current, interest])} onSave={saveProfileSettings} />
        )}
        {view === "organizer" && (
          <OrganizerPage
            rooms={createdRooms}
            currentRoom={room}
            analytics={analytics}
            qr={qrDataUrl}
            roomUrl={roomUrl}
            onCreate={() => navigate("create")}
            onSelect={(item) => setRoom(item)}
            onView={() => { setJoined(true); setVisible(true); navigate("discovery"); }}
            onCopy={copyRoomLink}
            onClose={closeRoom}
          />
        )}
        {view === "create" && <CreateRoomPage onSubmit={createRoom} onCancel={() => navigate("organizer")} />}
      </main>

      {!(["organizer", "create", "chat"] as AppView[]).includes(view) && (
        <nav className="bottom-nav" aria-label="Mobile navigation">
          <NavItem active={view === "discovery" || view === "room"} icon={<Users />} label="People" onClick={() => navigate("discovery")} />
          <NavItem active={view === "matches"} icon={<MessageCircle />} label="Matches" badge={matchedPeople.length} onClick={() => navigate("matches")} />
          <NavItem active={view === "profile"} icon={<CircleUserRound />} label="Profile" onClick={() => navigate("profile")} />
        </nav>
      )}

      {selectedPerson && (
        <ProfileSheet
          person={selectedPerson}
          sent={sentInterests.includes(selectedPerson.id)}
          onClose={() => setSelectedPerson(null)}
          onInterest={() => sendInterest(selectedPerson)}
          onBlock={() => { setSelectedPerson(null); flash(`${selectedPerson.name} has been blocked`); }}
          onReport={() => { setSelectedPerson(null); flash("Report received — thank you"); }}
        />
      )}

      {showMatch && (
        <MatchModal
          person={showMatch}
          onClose={() => setShowMatch(null)}
          onChat={() => { setActiveChat(showMatch); setShowMatch(null); navigate("chat"); }}
          onProfile={() => { setSelectedPerson(showMatch); setShowMatch(null); }}
        />
      )}
      {toast && <div className="toast"><Check size={17} />{toast}</div>}
    </div>
  );
}

function LandingPage({ onJoin, onCreate }: { onJoin: () => void; onCreate: () => void }) {
  return (
    <div className="landing">
      <header className="landing-nav">
        <button className="brand brand--button" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}><span className="brand-mark"><Radio size={18} /></span>HERE<span className="brand-dot">.</span></button>
        <div className="landing-nav__links"><a href="#how">How it works</a><a href="#organizers">For organizers</a></div>
        <button className="button button--small button--ghost" onClick={onCreate}>Create a room</button>
      </header>
      <main>
        <section className="hero">
          <div className="hero-glow hero-glow--one" /><div className="hero-glow hero-glow--two" />
          <div className="hero__copy">
            <div className="eyebrow"><span className="live-pulse" />IRL social discovery</div>
            <h1>Meet the people<br />who are already <em>here.</em></h1>
            <p>Join a live social room for your event, venue or party. No GPS. No endless feed. Just the people sharing this moment.</p>
            <div className="button-row">
              <button className="button button--lime" onClick={onJoin}>Join live room <ArrowRight size={18} /></button>
              <button className="button button--ghost" onClick={onCreate}>Create a room</button>
            </div>
            <div className="trust-line"><ShieldCheck size={17} /><span>Opt-in visibility</span><span>·</span><span>18+ only</span><span>·</span><span>No location tracking</span></div>
          </div>
          <div className="hero__visual" aria-label="Preview of people in a live room">
            <div className="hero-room-label"><span><span className="live-pulse" /> LIVE AT</span><strong>LUMEN CLUB</strong><small>93 people open to meet</small></div>
            <div className="portrait-stack">
              {PEOPLE.slice(0, 3).map((person, index) => (
                <div className={`hero-portrait hero-portrait--${index + 1}`} key={person.id} style={{ backgroundImage: `url(${person.photo})` }}>
                  <div><strong>{person.name}, {person.age}</strong><span>{person.purpose}</span></div>
                </div>
              ))}
            </div>
            <div className="floating-note"><Sparkles size={16} />You’re both here</div>
          </div>
        </section>

        <section className="how" id="how">
          <div className="section-heading"><span>ONE ROOM. ONE NIGHT.</span><h2>From QR to hello.</h2></div>
          <div className="steps">
            {[
              ["01", <QrCode key="i" />, "Scan the QR", "One tap opens the room for this exact place."],
              ["02", <Users key="i" />, "See who’s here", "Only people who joined and chose to be visible."],
              ["03", <Heart key="i" />, "Match", "Interest stays private unless it’s mutual."],
              ["04", <MessageCircle key="i" />, "Meet IRL", "Chat briefly, then look up from your phone."],
            ].map(([number, icon, title, copy]) => (
              <article className="step-card" key={String(number)}><span className="step-number">{number}</span><span className="step-icon">{icon}</span><h3>{title}</h3><p>{copy}</p></article>
            ))}
          </div>
        </section>

        <section className="organizer-cta" id="organizers">
          <div><span className="eyebrow">FOR ORGANIZERS</span><h2>Turn your event into<br />a social room.</h2><p>Create a room in minutes. Put the QR at the entrance, on tables or on screen — and give your crowd a reason to connect.</p><button className="button button--dark" onClick={onCreate}>Create your first room <ArrowRight size={18} /></button></div>
          <div className="qr-poster"><div className="qr-poster__top"><span>TONIGHT AT</span><strong>YOUR<br />PLACE</strong></div><div className="fake-qr"><QrCode size={112} /></div><span>SCAN TO SEE WHO’S HERE</span></div>
        </section>
      </main>
      <footer><span className="brand">HERE<span className="brand-dot">.</span></span><p>See who’s here. Meet in real life.</p><span>© 2026 · Privacy first</span></footer>
    </div>
  );
}

function QuickJoinPage({ room, people, photo: preview, busy, error, onPhoto, onSubmit, onOrganizer }: { room: Room; people: number; photo: string; busy: boolean; error: string; onPhoto: (event: ChangeEvent<HTMLInputElement>) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onOrganizer: () => void }) {
  return (
    <main className="mobile-quick-join">
      <section className="quick-room" style={{ backgroundImage: `linear-gradient(180deg, rgba(8,9,9,.12), rgba(8,9,9,.86)), url(${room.cover})` }}>
        <header><span className="brand"><span className="brand-mark"><Radio size={16} /></span>HERE<span className="brand-dot">.</span></span><span className="quick-live"><i />LIVE</span></header>
        <div className="quick-room__copy">
          <span>{room.eventName}</span>
          <h1>{room.venue}</h1>
          <p><MapPin size={14} />{room.city}<b>·</b>{people} joined</p>
        </div>
      </section>
      <form className="quick-form" onSubmit={onSubmit}>
        <div className="quick-form__heading"><span>JOIN IN ONE STEP</span><h2>Show who you are.</h2><p>One photo and your first name. That is all for now.</p></div>
        <label className={`quick-photo ${preview ? "quick-photo--ready" : ""}`} aria-label="Choose a profile photo from your gallery or camera">
          <span style={preview ? { backgroundImage: `url(${preview})` } : undefined}>{preview ? <Check size={22} /> : <ImagePlus size={28} />}</span>
          <strong>{preview ? "Photo added" : "Add photo"}</strong>
          <small>Choose from gallery or take a new photo</small>
          <input className="file-input" type="file" accept="image/*" onChange={onPhoto} required />
        </label>
        <label className="quick-name">Your first name<input name="displayName" minLength={2} maxLength={50} required autoComplete="given-name" placeholder="e.g. Maya" /></label>
        <label className="age-confirm"><input type="checkbox" required /><span><Check size={14} /></span><p>I am 18+ and agree to the community rules.</p></label>
        {error && <p className="form-error quick-error">{error}</p>}
        <button className="button button--lime button--wide quick-submit" disabled={busy}>{busy ? "Joining…" : "Enter the room"}<ArrowRight size={18} /></button>
        <p className="quick-privacy"><ShieldCheck size={15} />You stay hidden until you choose “Open to Meet”.</p>
        <button className="quick-organizer" type="button" onClick={onOrganizer}>Organizing this event?</button>
      </form>
    </main>
  );
}

function PublicRoomPage({ room, people, onJoin, onBack }: { room: Room; people: number; onJoin: () => void; onBack: () => void }) {
  return (
    <main className="public-room" style={{ "--room-cover": `url(${room.cover})` } as React.CSSProperties}>
      <div className="public-room__scrim" />
      <header><button className="brand brand--button" onClick={onBack}><span className="brand-mark"><Radio size={18} /></span>HERE<span className="brand-dot">.</span></button><span className="privacy-chip"><LockKeyhole size={14} /> Private to this room</span></header>
      <section className="public-room__content">
        <div className="room-kicker"><span className={`status-dot status-dot--${room.status.toLowerCase()}`} />{room.status === "LIVE" ? "TONIGHT AT" : statusLabel(room.status).toUpperCase()}</div>
        <h1>{room.venue}</h1>
        <p className="public-room__event">{room.eventName}</p>
        <div className="room-facts"><span><MapPin size={17} />{room.city}</span><span><CalendarDays size={17} />{formatEventDate(room.startsAt)}</span></div>
        <div className="people-here"><div className="mini-avatars">{PEOPLE.slice(0, 4).map((person) => <img src={person.photo} alt="" key={person.id} />)}</div><strong>{people} people joined</strong><span>·</span><span>93 visible now</span></div>
        <button className="button button--lime button--wide" onClick={onJoin}>Join room <ArrowRight size={19} /></button>
        <p className="age-note"><ShieldCheck size={15} /> By joining, you confirm you’re 18+ and agree to our community rules.</p>
      </section>
    </main>
  );
}

function OrganizerAuthPage({ room, busy, error, demo, onSubmit, onGoogle, onBack }: { room: Room; busy: boolean; error: string; demo: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onGoogle: () => void; onBack: () => void }) {
  return (
    <main className="split-page">
      <section className="split-page__visual" style={{ backgroundImage: `linear-gradient(180deg, transparent, rgba(10,10,10,.8)), url(${room.cover})` }}>
        <button className="brand brand--button" onClick={onBack}><span className="brand-mark"><Radio size={18} /></span>HERE<span className="brand-dot">.</span></button>
        <div><span className="eyebrow"><span className="live-pulse" /> ORGANIZER SPACE</span><h2>{room.eventName}</h2><p>{room.venue} · {room.city}</p></div>
      </section>
      <section className="auth-panel">
        <div className="form-wrap">
          <button className="back-link" onClick={onBack}><ArrowLeft size={17} /> Back</button>
          <span className="form-step">FOR ORGANIZERS</span>
          <h1>Organizer access.</h1>
          <p>Sign in to create rooms, download QR codes and view activity.</p>
          {demo && <div className="demo-note"><Zap size={16} /><span><strong>Demo access</strong> is enabled for this organizer space.</span></div>}
          <button className="button button--google" onClick={onGoogle}><span className="google-g">G</span> Sign in with Google</button>
          <div className="divider"><span>or organizer email</span></div>
          <form onSubmit={onSubmit} className="stack-form">
            <label>Email<input name="email" type="email" defaultValue={demo ? "maya@example.com" : ""} required placeholder="you@example.com" /></label>
            <label>Password<input name="password" type="password" defaultValue={demo ? "demo-password" : ""} minLength={6} required placeholder="At least 6 characters" /></label>
            {error && <p className="form-error">{error}</p>}
            <button className="button button--lime button--wide" disabled={busy}>{busy ? "Signing in…" : "Open organizer space"}<ArrowRight size={18} /></button>
          </form>
          <p className="legal-copy">Organizer accounts are separate from guest profiles.</p>
        </div>
      </section>
    </main>
  );
}

function OnboardingPage({ purpose, interests, photo: profilePhoto, onPhoto, onPurpose, onInterest, onSubmit, onBack }: { purpose: Purpose; interests: string[]; photo: string; onPhoto: (event: ChangeEvent<HTMLInputElement>) => void; onPurpose: (value: Purpose) => void; onInterest: (value: string) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onBack: () => void }) {
  return (
    <main className="onboarding">
      <header><button className="brand brand--button" onClick={onBack}><span className="brand-mark"><Radio size={18} /></span>HERE<span className="brand-dot">.</span></button><span className="form-step">02 / 02</span></header>
      <form className="profile-form" onSubmit={onSubmit}>
        <div className="profile-form__heading"><span className="eyebrow">YOUR ROOM PROFILE</span><h1>A little about you.</h1><p>Keep it light — you can change everything later.</p></div>
        <div className="photo-picker"><div className="photo-placeholder" style={{ backgroundImage: `url(${profilePhoto})` }} /><label className="photo-upload"> <ImagePlus size={17} />Change photo<input className="file-input" type="file" accept="image/jpeg,image/png,image/webp" onChange={onPhoto} /></label></div>
        <div className="form-grid">
          <label>Display name<input name="displayName" defaultValue="Maya" minLength={2} maxLength={50} required /></label>
          <label>Date of birth<input name="dateOfBirth" type="date" defaultValue="1998-06-14" max="2008-08-11" required /></label>
        </div>
        <fieldset><legend>What are you open to?</legend><div className="choice-grid">{PURPOSES.map((item) => <button type="button" className={`choice-card ${purpose === item ? "choice-card--active" : ""}`} onClick={() => onPurpose(item)} key={item}>{item}{purpose === item && <Check size={16} />}</button>)}</div></fieldset>
        <fieldset><legend>Pick a few interests <small>{interests.length}/5</small></legend><div className="chips">{INTEREST_OPTIONS.map((item) => <button type="button" className={`chip ${interests.includes(item) ? "chip--active" : ""}`} onClick={() => onInterest(item)} key={item}>{item}</button>)}</div></fieldset>
        <label>Short bio <small>Optional</small><textarea name="bio" maxLength={280} placeholder="One sentence is plenty…" defaultValue="Creative strategist, live music person, always planning the next little adventure." /></label>
        <button className="button button--lime button--wide">Save & join room <ArrowRight size={18} /></button>
        <p className="age-note"><ShieldCheck size={15} /> Your exact date of birth is never shown to other guests.</p>
      </form>
    </main>
  );
}

function DiscoveryPage({ room, people, visible, sent, onToggle, onInterest, onSelect, onRoomInfo }: { room: Room; people: Person[]; visible: boolean; sent: string[]; onToggle: () => void; onInterest: (person: Person) => void; onSelect: (person: Person) => void; onRoomInfo: () => void }) {
  if (room.status === "CLOSED") {
    return <div className="page-content empty-page"><span className="empty-icon"><LockKeyhole /></span><span className="eyebrow">ROOM CLOSED</span><h1>Discovery has ended.</h1><p>New interests are paused, but your matches and conversations are still here.</p><button className="button button--lime" onClick={() => window.scrollTo({ top: 0 })}>View matches <ArrowRight size={18} /></button></div>;
  }
  return (
    <div className="page-content discovery-page">
      <div className="room-strip"><button onClick={onRoomInfo}><span className="status-dot status-dot--live" /><div><small>LIVE AT</small><strong>{room.venue}</strong></div><ChevronRight size={18} /></button><div className="room-strip__count"><span>{visible ? 93 : 92}</span> open to meet</div></div>
      <header className="page-heading"><div><span className="eyebrow">{room.eventName}</span><h1>People here</h1><p>Everyone you see chose to be visible in this room.</p></div><button type="button" className="visibility-toggle" role="switch" aria-checked={visible} onClick={onToggle}><span><strong>Open to meet</strong><small>{visible ? "You’re visible" : "You’re hidden"}</small></span><i /></button></header>
      {!visible ? (
        <section className="visibility-gate"><div className="visibility-gate__people">{people.slice(0, 3).map((person) => <img src={person.photo} alt="" key={person.id} />)}<span>+90</span></div><span className="eyebrow">YOU’RE IN CONTROL</span><h2>Ready to meet someone?</h2><p>Turn on visibility to appear in this room and discover other people who are open to meeting.</p><button className="button button--lime" onClick={onToggle}>Turn on Open to Meet <Zap size={18} /></button><small><ShieldCheck size={14} /> Only people in {room.name} can see you.</small></section>
      ) : (
        <div className="people-grid">{people.map((person) => <PersonCard person={person} sent={sent.includes(person.id)} onInterest={() => onInterest(person)} onSelect={() => onSelect(person)} key={person.id} />)}</div>
      )}
    </div>
  );
}

function PersonCard({ person, sent, onInterest, onSelect }: { person: Person; sent: boolean; onInterest: () => void; onSelect: () => void }) {
  return (
    <article className="person-card">
      <button className="person-card__photo" style={{ backgroundImage: `linear-gradient(180deg, transparent 52%, rgba(7,8,8,.82)), url(${person.photo})` }} onClick={onSelect} aria-label={`View ${person.name}'s profile`}>
        <span className="purpose-pill">{person.purpose}</span><div><h2>{person.name}, {person.age}</h2><p>{person.bio}</p></div>
      </button>
      <div className="person-card__body"><div className="chips chips--small">{person.interests.slice(0, 4).map((interest) => <span className="chip" key={interest}>{interest}</span>)}</div><button className={`interest-button ${sent ? "interest-button--sent" : ""}`} onClick={onInterest}>{sent ? <><Check size={17} /> Sent</> : <><Heart size={17} /> Interested</>}</button></div>
    </article>
  );
}

function MatchesPage({ people, room, onChat, onProfile }: { people: Person[]; room: Room; onChat: (person: Person) => void; onProfile: (person: Person) => void }) {
  return (
    <div className="page-content matches-page"><header className="page-heading"><div><span className="eyebrow">CONNECTIONS</span><h1>Your matches</h1><p>Mutual interest, no awkward reveal.</p></div></header>
      <div className="match-list">{people.map((person, index) => <article className="match-row" key={person.id}><button className="match-row__person" onClick={() => onProfile(person)}><img src={person.photo} alt="" /><span className="online-dot" /><div><strong>{person.name}, {person.age}</strong><small>Matched at {room.venue}</small><p>{index === 0 ? "Perfect — coming over in two minutes." : index === 1 ? "That sounds great. See you by the bar?" : "You both want to meet."}</p></div></button><div className="match-row__meta"><span>{index === 0 ? "Now" : "21:18"}</span>{index === 0 && <i>2</i>}<button className="icon-button" onClick={() => onChat(person)} aria-label={`Chat with ${person.name}`}><MessageCircle size={19} /></button></div></article>)}</div>
      <div className="match-safety"><ShieldCheck /><div><strong>Your matches stay with you.</strong><p>Even after a room closes, existing matches and chats remain available.</p></div></div>
    </div>
  );
}

function ChatPage({ person, messages, onBack, onSend, endRef }: { person: Person; messages: ChatMessage[]; onBack: () => void; onSend: (event: FormEvent<HTMLFormElement>) => void; endRef: React.RefObject<HTMLDivElement | null> }) {
  return (
    <div className="chat-page"><header className="chat-header"><button className="icon-button" onClick={onBack}><ArrowLeft /></button><img src={person.photo} alt="" /><div><strong>{person.name}</strong><span><i />Matched at Lumen Club</span></div><button className="icon-button"><MoreHorizontal /></button></header>
      <div className="chat-match-note"><Sparkles size={16} /><span>You matched tonight</span></div>
      <div className="messages"><div className="message-day">TODAY</div>{messages.map((message) => <div className={`message message--${message.sender}`} key={message.id}><p>{message.content}</p><span>{message.time}{message.sender === "me" && <Check size={13} />}</span></div>)}<div ref={endRef} /></div>
      <form className="message-form" onSubmit={onSend}><input name="message" autoComplete="off" placeholder={`Message ${person.name}…`} aria-label="Message" /><button aria-label="Send message"><Send size={19} /></button></form>
    </div>
  );
}

function ProfilePage({ name, bio, dateOfBirth, photo: profilePhoto, onName, onBio, onDateOfBirth, onPhoto, visible, interests, purpose, onToggle, onPurpose, onInterest, onSave }: { name: string; bio: string; dateOfBirth: string; photo: string; onName: (name: string) => void; onBio: (bio: string) => void; onDateOfBirth: (value: string) => void; onPhoto: (event: ChangeEvent<HTMLInputElement>) => void; visible: boolean; interests: string[]; purpose: Purpose; onToggle: () => void; onPurpose: (purpose: Purpose) => void; onInterest: (interest: string) => void; onSave: () => void }) {
  return (
    <div className="page-content profile-page"><header className="page-heading"><div><span className="eyebrow">YOUR PROFILE</span><h1>Keep it simple.</h1><p>Only your photo and name are required. Everything else is optional.</p></div><button className="button button--lime button--small" onClick={onSave}>Save changes</button></header>
      <div className="profile-layout"><section className="profile-preview"><div className="profile-preview__photo" style={{ backgroundImage: `linear-gradient(180deg, transparent, rgba(8,8,8,.78)), url(${profilePhoto})` }}><label className="icon-button" aria-label="Change profile photo"><ImagePlus size={18} /><input className="file-input" type="file" accept="image/jpeg,image/png,image/webp" onChange={onPhoto} /></label><div><h2>{name || "Guest"}{dateOfBirth ? `, ${ageFromDate(dateOfBirth)}` : ""}</h2><span>{purpose}</span></div></div>{bio && <p>{bio}</p>}<div className="chips chips--small">{interests.map((item) => <span className="chip" key={item}>{item}</span>)}</div></section>
        <section className="settings-card"><div className="setting-row setting-row--highlight"><div className="setting-icon"><Radio /></div><div><strong>Open to Meet</strong><p>Control your visibility in the current room.</p></div><label className="mini-switch" htmlFor="profile-visibility" aria-label="Open to Meet visibility"><input id="profile-visibility" type="checkbox" checked={visible} onChange={onToggle} /><i /></label></div><div className="settings-section settings-section--basics"><label>First name<input value={name} minLength={2} maxLength={50} onChange={(event) => onName(event.target.value)} /></label><label>About you <small>Optional</small><textarea value={bio} maxLength={280} onChange={(event) => onBio(event.target.value)} placeholder="One sentence is plenty…" /></label></div><details className="optional-settings"><summary><span><strong>Add more details</strong><small>Age, purpose and interests</small></span><ChevronRight size={18} /></summary><div className="optional-settings__body"><label>Date of birth <small>Optional and never shown</small><input type="date" value={dateOfBirth} max="2008-08-11" onChange={(event) => onDateOfBirth(event.target.value)} /></label><div><h3>Your purpose</h3><div className="choice-grid">{PURPOSES.map((item) => <button type="button" className={`choice-card ${purpose === item ? "choice-card--active" : ""}`} onClick={() => onPurpose(item)} key={item}>{item}{purpose === item && <Check size={15} />}</button>)}</div></div><div><h3>Interests</h3><div className="chips">{INTEREST_OPTIONS.map((item) => <button type="button" className={`chip ${interests.includes(item) ? "chip--active" : ""}`} onClick={() => onInterest(item)} key={item}>{item}</button>)}</div></div></div></details><div className="privacy-row"><ShieldCheck /><div><strong>Private by design</strong><p>No location tracking. You appear only in rooms you join.</p></div></div><div className="mobile-save"><button className="button button--lime button--wide" onClick={onSave}>Save changes</button></div></section></div>
    </div>
  );
}

function OrganizerPage({ rooms, currentRoom, analytics, qr, roomUrl, onCreate, onSelect, onView, onCopy, onClose }: { rooms: Room[]; currentRoom: Room; analytics: { joined: number; visible: number; interests: number; matches: number; conversations: number }; qr: string; roomUrl: string; onCreate: () => void; onSelect: (room: Room) => void; onView: () => void; onCopy: () => void; onClose: () => void }) {
  return (
    <div className="page-content organizer-page"><header className="page-heading organizer-heading"><div><span className="eyebrow">ORGANIZER SPACE</span><h1>Good evening, Alex.</h1><p>Here’s what’s happening in your rooms.</p></div><button className="button button--lime" onClick={onCreate}><Plus size={18} />Create room</button></header>
      <section className="analytics-grid">{[
        ["Participants", analytics.joined, <Users key="i" />], ["Visible now", analytics.visible, <UserRoundCheck key="i" />], ["Interests sent", analytics.interests, <Heart key="i" />], ["Matches", analytics.matches, <Sparkles key="i" />], ["Conversations", analytics.conversations, <MessageCircle key="i" />],
      ].map(([label, value, icon]) => <article key={String(label)}><span>{icon}</span><strong>{value}</strong><small>{label}</small></article>)}</section>
      <div className="organizer-grid"><section><div className="section-title"><div><h2>My rooms</h2><span>{rooms.length} total</span></div><button className="text-button">View archive <ArrowRight size={16} /></button></div><div className="room-list">{rooms.map((item) => <article className={`room-card ${item.id === currentRoom.id ? "room-card--active" : ""}`} key={item.id}><button type="button" className="room-card__cover" style={{ backgroundImage: `url(${item.cover})` }} onClick={() => onSelect(item)} aria-label={`Select ${item.name}`}><span className={`status-badge status-badge--${item.status.toLowerCase()}`}><i />{statusLabel(item.status)}</span></button><div className="room-card__body"><span>{item.eventName}</span><h3>{item.name}</h3><p><MapPin size={14} />{item.venue}, {item.city}</p><p><Clock3 size={14} />{formatEventDate(item.startsAt)}</p><div className="room-mini-stats"><span><strong>{analytics.joined}</strong> joined</span><span><strong>{analytics.matches}</strong> matches</span></div><div className="room-actions"><button onClick={onView}>View room</button><button onClick={onCopy}><Copy size={15} />Copy link</button><button onClick={onClose} disabled={item.status === "CLOSED"}>{item.status === "CLOSED" ? "Closed" : "Close room"}</button></div></div></article>)}</div></section>
        <aside className="qr-card"><div className="qr-card__heading"><span className="eyebrow">ROOM ACCESS</span><h2>Your QR is ready</h2><p>Place it where your guests can scan it.</p></div><div className="qr-image">{qr ? <img src={qr} alt={`QR code for ${currentRoom.name}`} /> : <QrCode size={160} />}</div><strong>{currentRoom.name}</strong><span>{roomUrl.replace(/^https?:\/\//, "")}</span><div className="qr-actions"><a className="button button--dark" href={qr} download={`${currentRoom.slug}-qr.png`}><Download size={17} />Download PNG</a><button className="button button--ghost" onClick={onCopy}><Link2 size={17} />Copy link</button></div><div className="qr-tip"><Info size={16} /><p>This QR always opens <strong>/r/{currentRoom.slug}</strong>, including after sign-in.</p></div></aside>
      </div>
    </div>
  );
}

function CreateRoomPage({ onSubmit, onCancel }: { onSubmit: (event: FormEvent<HTMLFormElement>) => void; onCancel: () => void }) {
  return (
    <div className="page-content create-page"><button className="back-link" onClick={onCancel}><ArrowLeft size={17} />Back to rooms</button><header className="page-heading"><div><span className="eyebrow">NEW SOCIAL ROOM</span><h1>Create a room</h1><p>Start with the essentials. You can edit everything later.</p></div></header>
      <form className="create-form" onSubmit={onSubmit}><section><h2>Room details</h2><div className="form-grid"><label>Room name<input name="roomName" required placeholder="Test Party" /></label><label>Event name<input name="eventName" required placeholder="Summer launch party" /></label><label>Venue name<input name="venue" required placeholder="Lumen Club" /></label><label>City<input name="city" required placeholder="Riga" /></label></div><label>Description<textarea name="description" required placeholder="Tell guests what this room is for…" /></label></section><section><h2>Timing</h2><div className="form-grid"><label>Starts<input name="startsAt" type="datetime-local" defaultValue="2026-08-14T21:00" required /></label><label>Ends<input name="endsAt" type="datetime-local" defaultValue="2026-08-15T03:00" required /></label></div><div className="cover-drop"><ImagePlus /><div><strong>Add a cover image</strong><span>Optional · JPG, PNG or WEBP</span></div><label className="button button--ghost button--small">Choose image<input className="file-input" name="coverImage" type="file" accept="image/jpeg,image/png,image/webp" /></label></div></section><div className="form-actions"><button type="button" className="button button--ghost" onClick={onCancel}>Cancel</button><button className="button button--lime">Create room & QR <ArrowRight size={18} /></button></div></form>
    </div>
  );
}

function RoomInfoPage({ room, qr, roomUrl, onCopy }: { room: Room; qr: string; roomUrl: string; onCopy: () => void }) {
  return <div className="page-content room-info-page"><div className="room-info-hero" style={{ backgroundImage: `linear-gradient(90deg, rgba(7,8,8,.92), rgba(7,8,8,.15)), url(${room.cover})` }}><span className="eyebrow"><span className={`status-dot status-dot--${room.status.toLowerCase()}`} />{statusLabel(room.status)}</span><h1>{room.eventName}</h1><p>{room.description}</p><div className="room-facts"><span><MapPin size={17} />{room.venue}, {room.city}</span><span><CalendarDays size={17} />{formatEventDate(room.startsAt)}</span></div></div><div className="room-info-grid"><section><h2>Room rules</h2><div className="rule"><ShieldCheck /><div><strong>Consent comes first</strong><p>You appear only after joining and turning on Open to Meet.</p></div></div><div className="rule"><LockKeyhole /><div><strong>Private by context</strong><p>Only visible guests in this room can discover one another.</p></div></div><div className="rule"><Users /><div><strong>Meet respectfully</strong><p>Block and report controls are always available.</p></div></div></section><aside className="mini-qr">{qr && <img src={qr} alt="Room QR" />}<strong>Invite someone here</strong><p>{roomUrl}</p><button className="button button--ghost button--wide" onClick={onCopy}><Copy size={17} />Copy room link</button></aside></div></div>;
}

function ProfileSheet({ person, sent, onClose, onInterest, onBlock, onReport }: { person: Person; sent: boolean; onClose: () => void; onInterest: () => void; onBlock: () => void; onReport: () => void }) {
  return <div className="modal-backdrop"><aside className="profile-sheet"><button className="modal-close" onClick={onClose}><X /></button><div className="profile-sheet__photo" style={{ backgroundImage: `linear-gradient(180deg, transparent, rgba(7,8,8,.82)), url(${person.photo})` }}><div><span>{person.purpose}</span><h2>{person.name}, {person.age}</h2></div></div><div className="profile-sheet__body"><p>{person.bio}</p><div className="chips">{person.interests.map((item) => <span className="chip" key={item}>{item}</span>)}</div><button className={`button button--wide ${sent ? "button--ghost" : "button--lime"}`} onClick={onInterest} disabled={sent}>{sent ? <><Check size={18} />Interest sent</> : <><Heart size={18} />I’m interested</>}</button><div className="safety-actions"><button onClick={onBlock}><LockKeyhole size={16} />Block user</button><button onClick={onReport}><Flag size={16} />Report user</button></div></div></aside></div>;
}

function MatchModal({ person, onClose, onChat, onProfile }: { person: Person; onClose: () => void; onChat: () => void; onProfile: () => void }) {
  return <div className="modal-backdrop match-backdrop"><section className="match-modal"><button className="modal-close" onClick={onClose}><X /></button><div className="match-rays" /><span className="eyebrow"><Sparkles size={15} /> MUTUAL INTEREST</span><h1>It’s a match.</h1><p>You both want to meet.</p><div className="match-faces"><div style={{ backgroundImage: `url(${photo("photo-1531123897727-8f129e1688ce")})` }} /><span><Heart fill="currentColor" /></span><div style={{ backgroundImage: `url(${person.photo})` }} /></div><strong>You + {person.name}</strong><small>You’re both at Lumen Club right now.</small><div className="button-row"><button className="button button--lime" onClick={onChat}><MessageCircle size={18} />Chat</button><button className="button button--ghost" onClick={onProfile}>View profile</button></div></section></div>;
}

function NavItem({ active = false, icon, label, badge, onClick }: { active?: boolean; icon: React.ReactNode; label: string; badge?: number; onClick: () => void }) {
  return <button className={`nav-item ${active ? "nav-item--active" : ""}`} onClick={onClick}>{icon}<span>{label}</span>{badge ? <i>{badge}</i> : null}</button>;
}
