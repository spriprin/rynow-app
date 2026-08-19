"use client";
/* eslint-disable @next/next/no-img-element -- avatars are short-lived signed Supabase Storage URLs. */

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { ArrowLeft, ArrowRight, CalendarDays, Check, ImagePlus, LockKeyhole, MapPin, Radio, RefreshCw, ShieldCheck, Users } from "lucide-react";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { FoundationProfile, FoundationRoom, RoomWallPerson } from "@/lib/types";

type Screen = "loading" | "configuration" | "missing" | "closed" | "not-open" | "onboarding" | "ready" | "room" | "error";
type OnboardingStep = 1 | 2 | 3;
type RoomWallRpcRow = { id: string; display_name: string; avatar_path: string; joined_at: string };

function initialScreenFor(room: FoundationRoom | null | undefined): Screen {
  if (room === null) return "missing";
  if (room?.status === "closed") return "closed";
  if (room && room.status !== "open") return "not-open";
  return "loading";
}

function roomDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function extensionFor(file: File) {
  const fromMime = file.type.split("/")[1]?.replace("jpeg", "jpg");
  return fromMime?.replace(/[^a-z0-9]/g, "") || "jpg";
}

export function RoomJoinApp({ joinCode, initialRoom }: { joinCode: string; initialRoom?: FoundationRoom | null }) {
  const [screen, setScreen] = useState<Screen>(() => initialScreenFor(initialRoom));
  const [room, setRoom] = useState<FoundationRoom | null>(initialRoom || null);
  const [profile, setProfile] = useState<FoundationProfile | null>(null);
  const [ownAvatarUrl, setOwnAvatarUrl] = useState("");
  const [wall, setWall] = useState<RoomWallPerson[]>([]);
  const [joinedCount, setJoinedCount] = useState(0);
  const [step, setStep] = useState<OnboardingStep>(1);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const bootstrapStarted = useRef(false);

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
    if (!visibleProfiles.length) {
      setWall([]);
      return;
    }

    const paths = visibleProfiles.map((item) => String(item.avatar_path));
    const { data: signed, error: signedError } = await client.storage.from("avatars").createSignedUrls(paths, 3600);
    if (signedError) throw signedError;
    const urlByPath = new Map((signed || []).map((item) => [item.path, item.signedUrl]));

    setWall(visibleProfiles.map((item) => ({
      id: String(item.id),
      displayName: String(item.display_name),
      avatarUrl: urlByPath.get(String(item.avatar_path)) || "",
    })));
  }, []);

  const enterRoom = useCallback(async (resolvedRoom: FoundationRoom) => {
    const client = getSupabaseBrowserClient();
    if (!client) return;
    const { error: joinError } = await client.rpc("join_room_by_code", { p_join_code: joinCode });
    if (joinError) throw joinError;
    await loadWall(resolvedRoom.id);
    setScreen("room");
  }, [joinCode, loadWall]);

  useEffect(() => {
    if (bootstrapStarted.current) return;
    bootstrapStarted.current = true;

    async function bootstrap() {
      if (!isSupabaseConfigured()) {
        setScreen("configuration");
        return;
      }
      const client = getSupabaseBrowserClient();
      if (!client) {
        setScreen("configuration");
        return;
      }

      let resolvedRoom = initialRoom || undefined;
      if (initialRoom === null) {
        setScreen("missing");
        return;
      }
      if (initialRoom === undefined) {
        const { data: roomData, error: roomError } = await client.rpc("get_room_by_join_code", { p_join_code: joinCode });
        if (roomError) throw roomError;
        resolvedRoom = (Array.isArray(roomData) ? roomData[0] : roomData) as FoundationRoom | undefined;
      }
      if (!resolvedRoom) {
        setScreen("missing");
        return;
      }
      setRoom(resolvedRoom);
      if (resolvedRoom.status === "closed") {
        setScreen("closed");
        return;
      }
      if (resolvedRoom.status !== "open") {
        setScreen("not-open");
        return;
      }

      let { data: sessionData } = await client.auth.getSession();
      if (!sessionData.session) {
        const { data, error: anonymousError } = await client.auth.signInAnonymously();
        if (anonymousError || !data.session) throw anonymousError || new Error("Could not create guest session");
        sessionData = { session: data.session };
      }
      const userId = sessionData.session.user.id;
      const { data: savedProfile, error: profileError } = await client
        .from("profiles")
        .select("id, display_name, avatar_path, age_confirmed_18")
        .eq("id", userId)
        .maybeSingle();
      if (profileError) throw profileError;

      if (!savedProfile) {
        setScreen("onboarding");
        return;
      }

      const typedProfile = savedProfile as FoundationProfile;
      setProfile(typedProfile);
      setDisplayName(typedProfile.display_name);
      const { data: signed } = await client.storage.from("avatars").createSignedUrl(typedProfile.avatar_path, 3600);
      setOwnAvatarUrl(signed?.signedUrl || "");

      const { data: membership, error: membershipError } = await client
        .from("room_members")
        .select("room_id")
        .eq("room_id", resolvedRoom.id)
        .eq("user_id", userId)
        .maybeSingle();
      if (membershipError) throw membershipError;
      if (membership) {
        await enterRoom(resolvedRoom);
      } else {
        setScreen("ready");
      }
    }

    void bootstrap().catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : "Could not open this Room");
      setScreen("error");
    });
  }, [enterRoom, initialRoom, joinCode]);

  useEffect(() => {
    if (screen !== "room" || !room) return;
    const timer = window.setInterval(() => {
      void loadWall(room.id).catch(() => undefined);
    }, 15000);
    return () => window.clearInterval(timer);
  }, [loadWall, room, screen]);

  function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return setError("Choose an image file.");
    if (file.size > 5 * 1024 * 1024) return setError("Photo must be smaller than 5 MB.");
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
    setError("");
  }

  async function finishOnboarding() {
    if (!room || !photoFile || displayName.trim().length < 2 || !ageConfirmed) return;
    setBusy(true);
    setError("");
    try {
      const client = getSupabaseBrowserClient();
      if (!client) throw new Error("Supabase is not configured");
      const { data: userData, error: userError } = await client.auth.getUser();
      if (userError || !userData.user) throw userError || new Error("Guest session not found");

      const avatarPath = `${userData.user.id}/avatar-${crypto.randomUUID()}.${extensionFor(photoFile)}`;
      const { error: uploadError } = await client.storage.from("avatars").upload(avatarPath, photoFile, {
        contentType: photoFile.type,
        upsert: false,
      });
      if (uploadError) throw uploadError;

      const nextProfile: FoundationProfile = {
        id: userData.user.id,
        display_name: displayName.trim(),
        avatar_path: avatarPath,
        age_confirmed_18: true,
      };
      const { error: profileError } = await client.from("profiles").upsert(nextProfile);
      if (profileError) throw profileError;

      setProfile(nextProfile);
      const { data: signed } = await client.storage.from("avatars").createSignedUrl(avatarPath, 3600);
      setOwnAvatarUrl(signed?.signedUrl || photoPreview);
      await enterRoom(room);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not finish your profile");
    } finally {
      setBusy(false);
    }
  }

  async function joinReturningGuest() {
    if (!room) return;
    setBusy(true);
    setError("");
    try {
      await enterRoom(room);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not join this Room");
    } finally {
      setBusy(false);
    }
  }

  if (screen === "loading") return <RoomState icon={<RefreshCw className="spin" />} title="Opening Room…" copy="Checking the event and your guest session." />;
  if (screen === "configuration") return <RoomState icon={<LockKeyhole />} title="Supabase isn’t connected." copy="This production QR route never falls back to demo people. Add the public Supabase URL and publishable key to continue." />;
  if (screen === "missing") return <RoomState icon={<LockKeyhole />} eyebrow="ROOM NOT FOUND" title="This link is not valid." copy="Ask the organizer for the current Room QR." />;
  if (screen === "closed") return <RoomState icon={<LockKeyhole />} eyebrow="ROOM CLOSED" title="This Room has ended." copy="New guests can no longer join this event." />;
  if (screen === "not-open") return <RoomState icon={<CalendarDays />} eyebrow="NOT OPEN YET" title="This Room isn’t open." copy="The organizer will open it when the event begins." />;
  if (screen === "error") return <RoomState icon={<LockKeyhole />} title="We couldn’t open the Room." copy={error || "Try the QR again."} />;

  if (screen === "onboarding" && room) {
    return (
      <main className="foundation-onboarding">
        <FoundationRoomHeader room={room} />
        <section className="foundation-form-card">
          <div className="foundation-progress"><i className={step >= 1 ? "active" : ""} /><i className={step >= 2 ? "active" : ""} /><i className={step >= 3 ? "active" : ""} /></div>
          {step === 1 && <>
            <span className="eyebrow">STEP 1 OF 3</span><h1>Add your photo.</h1><p>Use the camera or choose one from your gallery.</p>
            <label className={`foundation-photo-picker ${photoPreview ? "has-photo" : ""}`}>
              <span style={photoPreview ? { backgroundImage: `url(${photoPreview})` } : undefined}>{photoPreview ? <Check /> : <ImagePlus />}</span>
              <strong>{photoPreview ? "Photo selected" : "Camera or gallery"}</strong>
              <small>Required · maximum 5 MB</small>
              <input className="file-input" type="file" accept="image/*" onChange={choosePhoto} />
            </label>
            {error && <p className="form-error">{error}</p>}
            <button className="button button--lime button--wide" disabled={!photoFile} onClick={() => setStep(2)}>Continue <ArrowRight size={18} /></button>
          </>}
          {step === 2 && <>
            <button className="back-link" onClick={() => setStep(1)}><ArrowLeft size={17} />Back</button>
            <span className="eyebrow">STEP 2 OF 3</span><h1>What’s your name?</h1><p>This is the only profile detail people in the Room will see.</p>
            <label>First name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} minLength={2} maxLength={50} placeholder="Anna" /></label>
            <button className="button button--lime button--wide" disabled={displayName.trim().length < 2} onClick={() => setStep(3)}>Continue <ArrowRight size={18} /></button>
          </>}
          {step === 3 && <>
            <button className="back-link" onClick={() => setStep(2)}><ArrowLeft size={17} />Back</button>
            <span className="eyebrow">STEP 3 OF 3</span><h1>One last check.</h1><p>HERE is currently available only to adults.</p>
            <label className="foundation-age-check"><input type="checkbox" checked={ageConfirmed} onChange={(event) => setAgeConfirmed(event.target.checked)} /><span><Check size={18} /></span><strong>I am 18 or older</strong></label>
            {error && <p className="form-error">{error}</p>}
            <button className="button button--lime button--wide" disabled={!ageConfirmed || busy} onClick={finishOnboarding}>{busy ? "Joining…" : "Enter the Room"}<ArrowRight size={18} /></button>
            <small className="foundation-privacy"><ShieldCheck size={14} />Your session and profile stay on this device.</small>
          </>}
        </section>
      </main>
    );
  }

  if (screen === "ready" && room && profile) {
    return (
      <main className="foundation-onboarding">
        <FoundationRoomHeader room={room} />
        <section className="foundation-form-card returning-card">
          {ownAvatarUrl && <img className="returning-avatar" src={ownAvatarUrl} alt="" />}
          <span className="eyebrow">WELCOME BACK</span><h1>Hi, {profile.display_name}.</h1><p>Your profile is ready. Join this event’s Room?</p>
          {error && <p className="form-error">{error}</p>}
          <button className="button button--lime button--wide" disabled={busy} onClick={joinReturningGuest}>{busy ? "Joining…" : "Join Room"}<ArrowRight size={18} /></button>
        </section>
      </main>
    );
  }

  if (screen === "room" && room) {
    return (
      <main className="foundation-room-screen">
        <header><span className="brand"><span className="brand-mark"><Radio size={17} /></span>HERE<span className="brand-dot">.</span></span><span className="foundation-live"><i />ROOM OPEN</span></header>
        <section className="foundation-room-heading">
          <span className="eyebrow">HERE TONIGHT</span>
          <h1>{joinedCount} joined</h1>
          <p>{room.name} · {room.venue_name || room.city || "Tonight"}</p>
        </section>
        <section className="foundation-wall" aria-label="Room participants">
          <div className="foundation-wall__heading"><div><Users /><span>Room Wall</span></div><small>Real participants in this Room</small></div>
          {wall.length ? <div className="foundation-avatar-grid">{wall.map((person) => <article key={person.id}>{person.avatarUrl ? <img src={person.avatarUrl} alt="" /> : <span>{person.displayName.slice(0, 1)}</span>}<strong>{person.displayName}</strong></article>)}</div> : <div className="foundation-empty-wall"><Users /><strong>You’re first here.</strong><p>Other guests will appear after joining this exact Room.</p></div>}
        </section>
        <p className="foundation-room-note"><ShieldCheck size={15} />Only active members of this Room can see its wall.</p>
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
