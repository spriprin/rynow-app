"use client";
/* eslint-disable @next/next/no-img-element -- QR codes are generated data URLs. */

import { useEffect, useMemo, useState, type FormEvent } from "react";
import QRCode from "qrcode";
import { ArrowLeft, ArrowRight, CalendarDays, Check, Download, Link2, LockKeyhole, LogOut, MapPin, Plus, QrCode, Radio, Users } from "lucide-react";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { FoundationRoom } from "@/lib/types";

type OrganizerScreen = "loading" | "configuration" | "auth" | "rooms" | "create";
type OrganizerRoom = FoundationRoom & { joinedCount: number };

function localDateTime(offsetHours: number) {
  const date = new Date(Date.now() + offsetHours * 60 * 60 * 1000);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function eventDate(value: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export function OrganizerFoundationApp() {
  const [screen, setScreen] = useState<OrganizerScreen>("loading");
  const [rooms, setRooms] = useState<OrganizerRoom[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [organizerId, setOrganizerId] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  const selectedRoom = rooms.find((room) => room.id === selectedId) || rooms[0] || null;
  const origin = useMemo(() => {
    const configuredOrigin = process.env.NEXT_PUBLIC_APP_URL?.trim();
    const browserOrigin = typeof window === "undefined" ? "" : window.location.origin;
    return (configuredOrigin || browserOrigin || "https://here-social-room.spriprin.chatgpt.site").replace(/\/+$/, "");
  }, []);
  const joinUrl = useMemo(() => selectedRoom ? `${origin}/r/${selectedRoom.join_code}` : "", [origin, selectedRoom]);

  async function loadRooms(userId: string) {
    const client = getSupabaseBrowserClient();
    if (!client) return;
    const { data, error: roomError } = await client.from("rooms").select("id, name, venue_name, city, starts_at, ends_at, status, join_code, cover_path").eq("organizer_id", userId).order("created_at", { ascending: false });
    if (roomError) throw roomError;
    const withCounts = await Promise.all((data || []).map(async (room) => {
      const { data: count } = await client.rpc("room_joined_count", { p_room_id: room.id });
      return { ...(room as FoundationRoom), joinedCount: Number(count || 0) };
    }));
    setRooms(withCounts);
    setSelectedId((current) => current || withCounts[0]?.id || "");
  }

  useEffect(() => {
    async function bootstrap() {
      if (!isSupabaseConfigured()) {
        setScreen("configuration");
        return;
      }
      const client = getSupabaseBrowserClient();
      if (!client) return setScreen("configuration");
      const { data, error: userError } = await client.auth.getUser();
      if (userError || !data.user || data.user.is_anonymous) {
        setScreen("auth");
        return;
      }
      setOrganizerId(data.user.id);
      await loadRooms(data.user.id);
      setScreen("rooms");
    }
    void bootstrap().catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : "Could not load organizer space");
      setScreen("auth");
    });
  }, []);

  useEffect(() => {
    if (!joinUrl) return;
    void QRCode.toDataURL(joinUrl, { width: 960, margin: 4, errorCorrectionLevel: "H", color: { dark: "#000000", light: "#ffffff" } }).then(setQrDataUrl);
  }, [joinUrl]);

  function flash(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2200);
  }

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const form = new FormData(event.currentTarget);
      const client = getSupabaseBrowserClient();
      if (!client) throw new Error("Supabase is not configured");
      const { data, error: signInError } = await client.auth.signInWithPassword({ email: String(form.get("email") || ""), password: String(form.get("password") || "") });
      if (signInError || !data.user) throw signInError || new Error("Organizer account not found");
      if (data.user.is_anonymous) throw new Error("A permanent organizer account is required");
      setOrganizerId(data.user.id);
      await loadRooms(data.user.id);
      setScreen("rooms");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not sign in");
    } finally {
      setBusy(false);
    }
  }

  async function createRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const form = new FormData(event.currentTarget);
      const client = getSupabaseBrowserClient();
      if (!client || !organizerId) throw new Error("Organizer session required");
      const { data, error: createError } = await client.from("rooms").insert({
        organizer_id: organizerId,
        name: String(form.get("name") || "").trim(),
        venue_name: String(form.get("venueName") || "").trim() || null,
        city: String(form.get("city") || "").trim() || null,
        starts_at: new Date(String(form.get("startsAt"))).toISOString(),
        ends_at: new Date(String(form.get("endsAt"))).toISOString(),
        status: "open",
      }).select("id, name, venue_name, city, starts_at, ends_at, status, join_code, cover_path").single();
      if (createError || !data) throw createError || new Error("Could not create Room");
      const created = { ...(data as FoundationRoom), joinedCount: 0 };
      setRooms((current) => [created, ...current]);
      setSelectedId(created.id);
      setScreen("rooms");
      flash("Room created — the QR is live");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create Room");
    } finally {
      setBusy(false);
    }
  }

  async function closeRoom() {
    if (!selectedRoom) return;
    const client = getSupabaseBrowserClient();
    if (!client) return;
    const { error: closeError } = await client.from("rooms").update({ status: "closed" }).eq("id", selectedRoom.id);
    if (closeError) return setError(closeError.message);
    setRooms((current) => current.map((room) => room.id === selectedRoom.id ? { ...room, status: "closed" } : room));
    flash("Room closed");
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(joinUrl);
      flash("Join link copied");
    } catch {
      setError("Copy is blocked by this browser. Open the link below and share it from the browser.");
    }
  }

  async function signOut() {
    const client = getSupabaseBrowserClient();
    await client?.auth.signOut();
    setRooms([]);
    setOrganizerId("");
    setScreen("auth");
  }

  if (screen === "loading") return <OrganizerState title="Opening organizer space…" copy="Checking your permanent organizer session." />;
  if (screen === "configuration") return <OrganizerState title="Supabase isn’t connected." copy="Add the public Supabase URL and publishable key before creating real Rooms." />;
  if (screen === "auth") return <main className="organizer-auth"><section><span className="brand"><span className="brand-mark"><Radio size={18} /></span>HERE<span className="brand-dot">.</span></span><span className="eyebrow">ORGANIZER DEVELOPMENT ACCESS</span><h1>Create real Rooms.</h1><p>Use a pre-created permanent Supabase Auth account. Guest anonymous sessions cannot create or manage Rooms.</p></section><form onSubmit={signIn}><LockKeyhole /><h2>Organizer sign in</h2><label>Email<input type="email" name="email" required autoComplete="email" /></label><label>Password<input type="password" name="password" required minLength={6} autoComplete="current-password" /></label>{error && <p className="form-error">{error}</p>}<button className="button button--lime button--wide" disabled={busy}>{busy ? "Signing in…" : "Open organizer space"}<ArrowRight size={18} /></button><small>No guest registration or social login is used here.</small></form></main>;

  if (screen === "create") return <main className="foundation-organizer"><header className="foundation-organizer__top"><span className="brand"><span className="brand-mark"><Radio size={18} /></span>HERE<span className="brand-dot">.</span></span></header><section className="foundation-create"><button className="back-link" onClick={() => { setError(""); setScreen("rooms"); }}><ArrowLeft size={17} />Back to Rooms</button><span className="eyebrow">SPRINT 1</span><h1>Create a Room.</h1><p>Only the event essentials. A unique join code and QR are generated automatically.</p><form onSubmit={createRoom}><label>Room name<input name="name" required minLength={2} maxLength={100} placeholder="HERE Test Party" /></label><div className="form-grid"><label>Venue name<input name="venueName" placeholder="Lumen Club" /></label><label>City<input name="city" placeholder="Riga" /></label></div><div className="form-grid"><label>Starts<input name="startsAt" type="datetime-local" required defaultValue={localDateTime(1)} /></label><label>Ends<input name="endsAt" type="datetime-local" required defaultValue={localDateTime(5)} /></label></div>{error && <p className="form-error">{error}</p>}<button className="button button--lime" disabled={busy}>{busy ? "Creating…" : "Create Room & QR"}<ArrowRight size={18} /></button></form></section></main>;

  return <main className="foundation-organizer"><header className="foundation-organizer__top"><span className="brand"><span className="brand-mark"><Radio size={18} /></span>HERE<span className="brand-dot">.</span></span><div><button className="button button--lime button--small" onClick={() => setScreen("create")}><Plus size={17} />Create Room</button><button className="icon-button" onClick={signOut} aria-label="Sign out"><LogOut size={18} /></button></div></header><section className="foundation-organizer__heading"><div><span className="eyebrow">REAL ROOMS</span><h1>Organizer space</h1><p>Persistent Rooms, real join links and aggregate participant counts.</p></div></section>{rooms.length === 0 ? <section className="foundation-no-rooms"><QrCode /><h2>No Rooms yet.</h2><p>Create the first real event Room. No demo Room will be added automatically.</p><button className="button button--lime" onClick={() => setScreen("create")}><Plus size={18} />Create Room</button></section> : <div className="foundation-organizer-grid"><section className="foundation-room-list">{rooms.map((room) => <button key={room.id} className={`foundation-room-row ${selectedRoom?.id === room.id ? "active" : ""}`} onClick={() => setSelectedId(room.id)}><span className={`status-badge status-badge--${room.status}`}><i />{room.status}</span><div><h2>{room.name}</h2><p><MapPin size={14} />{[room.venue_name, room.city].filter(Boolean).join(", ") || "Venue not set"}</p><p><CalendarDays size={14} />{eventDate(room.starts_at)}</p></div><strong><Users size={17} />{room.joinedCount} joined</strong></button>)}</section>{selectedRoom && <aside className="foundation-qr-card"><span className="eyebrow">ROOM ACCESS</span><h2>{selectedRoom.name}</h2><p>{selectedRoom.status === "closed" ? "This Room has ended." : "Scan to join this exact Room."}</p><div className="qr-image">{qrDataUrl ? <img src={qrDataUrl} alt={`QR code for ${selectedRoom.name}`} /> : <QrCode size={160} />}</div><a className="foundation-join-link" href={joinUrl} target="_blank" rel="noreferrer">{joinUrl}</a><div className="qr-actions"><a className="button button--dark" href={qrDataUrl} download={`${selectedRoom.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-qr.png`}><Download size={17} />Download PNG</a><a className="button button--ghost" href={joinUrl} target="_blank" rel="noreferrer"><ArrowRight size={17} />Open join link</a><button className="button button--ghost" onClick={copyLink}><Link2 size={17} />Copy link</button></div><div className="foundation-qr-stats"><Users /><span><strong>{selectedRoom.joinedCount}</strong> real participants</span></div>{selectedRoom.status !== "closed" && <button className="foundation-close-room" onClick={closeRoom}>Close Room</button>}</aside>}</div>}{error && <p className="foundation-global-error form-error">{error}</p>}{toast && <div className="toast"><Check size={17} />{toast}</div>}</main>;
}

function OrganizerState({ title, copy }: { title: string; copy: string }) {
  return <main className="foundation-state"><span className="brand"><span className="brand-mark"><Radio size={17} /></span>HERE<span className="brand-dot">.</span></span><div className="foundation-state__icon"><LockKeyhole /></div><h1>{title}</h1><p>{copy}</p></main>;
}
