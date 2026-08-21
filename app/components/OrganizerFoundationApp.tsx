"use client";
/* eslint-disable @next/next/no-img-element, @next/next/no-html-link-for-pages -- QR codes are generated data URLs and brand links keep the Vinext client boundary dependency-free. */

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import QRCode from "qrcode";
import { ArrowLeft, ArrowRight, CalendarDays, Check, Clock3, Download, KeyRound, Link2, LockKeyhole, LogOut, MailCheck, MapPin, Plus, QrCode, Radio, ShieldCheck, Trash2, Users } from "lucide-react";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { getSupabaseOrganizerClient, getTrustedApplicationOrigin, organizerAuthRedirect } from "@/lib/supabase/organizer-client";
import type { FoundationRoom, OrganizerDrop } from "@/lib/types";

type OrganizerScreen = "loading" | "configuration" | "auth" | "check-email" | "reset-password" | "rooms" | "create";
type AuthMode = "signin" | "signup" | "forgot";
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
  const [authMode, setAuthMode] = useState<AuthMode>("signin");
  const [pendingEmail, setPendingEmail] = useState("");

  const selectedRoom = rooms.find((room) => room.id === selectedId) || rooms[0] || null;
  const origin = useMemo(() => {
    const browserOrigin = typeof window === "undefined" ? "" : window.location.origin;
    return getTrustedApplicationOrigin(browserOrigin);
  }, []);
  const joinUrl = useMemo(() => selectedRoom ? `${origin}/r/${selectedRoom.join_code}` : "", [origin, selectedRoom]);

  async function loadRooms(userId: string) {
    const client = getSupabaseOrganizerClient();
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
      const client = getSupabaseOrganizerClient();
      if (!client) return setScreen("configuration");
      const search = new URLSearchParams(window.location.search);
      if (search.get("mode") === "signup") setAuthMode("signup");
      if (search.get("mode") === "signin") setAuthMode("signin");
      const recoveryRequested = search.get("recovery") === "1";
      const { data, error: userError } = await client.auth.getUser();
      if (userError || !data.user || data.user.is_anonymous) {
        if (data.user?.is_anonymous) await client.auth.signOut({ scope: "local" });
        setScreen(recoveryRequested ? "reset-password" : "auth");
        return;
      }
      if (recoveryRequested) {
        setScreen("reset-password");
        return;
      }
      setOrganizerId(data.user.id);
      await loadRooms(data.user.id);
      setScreen("rooms");
    }
    const client = getSupabaseOrganizerClient();
    const subscription = client?.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setScreen("reset-password");
    });
    void bootstrap().catch(() => {
      setError("We couldn’t open organizer space. Please sign in again.");
      setScreen("auth");
    });
    return () => subscription?.data.subscription.unsubscribe();
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
      const client = getSupabaseOrganizerClient();
      if (!client) throw new Error("Supabase is not configured");
      const { data, error: signInError } = await client.auth.signInWithPassword({ email: String(form.get("email") || ""), password: String(form.get("password") || "") });
      if (signInError || !data.user) throw new Error("We couldn’t sign you in. Check your details or reset your password.");
      if (data.user.is_anonymous) throw new Error("A permanent organizer account is required");
      setOrganizerId(data.user.id);
      await loadRooms(data.user.id);
      setScreen("rooms");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "We couldn’t sign you in. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function signUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const form = new FormData(event.currentTarget);
      const email = String(form.get("email") || "").trim().toLowerCase();
      const password = String(form.get("password") || "");
      const confirmation = String(form.get("confirmPassword") || "");
      if (password !== confirmation) throw new Error("Passwords don’t match.");
      const client = getSupabaseOrganizerClient();
      if (!client) throw new Error("Supabase is not configured");
      const { data, error: signUpError } = await client.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: organizerAuthRedirect("/organizer?auth=confirmed", window.location.origin) },
      });
      if (signUpError) {
        if (signUpError.code === "weak_password") throw new Error("Use a stronger password with at least 8 characters.");
        throw new Error("We couldn’t create the account. Check the details and try again.");
      }
      setPendingEmail(email);
      if (!data.session || !data.user || data.user.is_anonymous) {
        setScreen("check-email");
        return;
      }
      setOrganizerId(data.user.id);
      await loadRooms(data.user.id);
      setScreen("rooms");
      flash("Organizer account created");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "We couldn’t create the account. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function requestPasswordReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") || "").trim().toLowerCase();
    try {
      const client = getSupabaseOrganizerClient();
      if (!client) throw new Error("Supabase is not configured");
      const { error: resetError } = await client.auth.resetPasswordForEmail(email, {
        redirectTo: organizerAuthRedirect("/organizer?recovery=1", window.location.origin),
      });
      if (resetError?.status === 429) throw new Error("Too many requests. Please wait a moment and try again.");
      setPendingEmail(email);
      setScreen("check-email");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "We couldn’t send the recovery email. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function updatePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const form = new FormData(event.currentTarget);
      const password = String(form.get("password") || "");
      const confirmation = String(form.get("confirmPassword") || "");
      if (password !== confirmation) throw new Error("Passwords don’t match.");
      const client = getSupabaseOrganizerClient();
      if (!client) throw new Error("Supabase is not configured");
      const { data, error: updateError } = await client.auth.updateUser({ password });
      if (updateError || !data.user) throw new Error("This recovery link is invalid or has expired. Request a new one.");
      setOrganizerId(data.user.id);
      await loadRooms(data.user.id);
      window.history.replaceState({}, "", "/organizer");
      setScreen("rooms");
      flash("Password updated");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "We couldn’t update the password.");
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
      const client = getSupabaseOrganizerClient();
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
    const client = getSupabaseOrganizerClient();
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
    const client = getSupabaseOrganizerClient();
    await client?.auth.signOut({ scope: "local" });
    setRooms([]);
    setOrganizerId("");
    setScreen("auth");
  }

  if (screen === "loading") return <OrganizerState title="Opening organizer space…" copy="Checking your permanent organizer session." />;
  if (screen === "configuration") return <OrganizerState title="Supabase isn’t connected." copy="Add the public Supabase URL and publishable key before creating real Rooms." />;
  if (screen === "auth") return <main className="organizer-auth"><section><a className="brand" href="/"><span className="brand-mark"><Radio size={18} /></span>HERE<span className="brand-dot">.</span></a><span className="eyebrow">REAL EVENT ROOMS</span><h1>Create a Room for your event.</h1><p>Sign in or create a permanent organizer account. Guests still join instantly through the Room QR.</p><small><ShieldCheck size={16} />Organizer accounts and anonymous guest sessions stay separate on this device.</small></section><div className="organizer-auth__panel"><div className="organizer-auth__tabs" role="tablist" aria-label="Organizer authentication"><button type="button" role="tab" aria-selected={authMode === "signin"} onClick={() => { setAuthMode("signin"); setError(""); }}>Sign in</button><button type="button" role="tab" aria-selected={authMode === "signup"} onClick={() => { setAuthMode("signup"); setError(""); }}>Create account</button></div>{authMode === "signin" && <form onSubmit={signIn}><LockKeyhole /><h2>Welcome back.</h2><p>Open your organizer space and manage your own Rooms.</p><label>Email<input type="email" name="email" required autoComplete="email" /></label><label>Password<input type="password" name="password" required minLength={8} autoComplete="current-password" /></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="button button--lime button--wide" disabled={busy}>{busy ? "Signing in…" : "Sign in"}<ArrowRight size={18} /></button><button type="button" className="organizer-auth__link" onClick={() => { setAuthMode("forgot"); setError(""); }}>Forgot password?</button></form>}{authMode === "signup" && <form onSubmit={signUp}><KeyRound /><h2>Create organizer account.</h2><p>Your account owns only the Rooms you create.</p><label>Email<input type="email" name="email" required autoComplete="email" /></label><label>Password<input type="password" name="password" required minLength={8} autoComplete="new-password" /></label><label>Confirm password<input type="password" name="confirmPassword" required minLength={8} autoComplete="new-password" /></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="button button--lime button--wide" disabled={busy}>{busy ? "Creating account…" : "Create account"}<ArrowRight size={18} /></button></form>}{authMode === "forgot" && <form onSubmit={requestPasswordReset}><MailCheck /><h2>Reset your password.</h2><p>We’ll send recovery instructions if the address can be used.</p><label>Email<input type="email" name="email" required autoComplete="email" /></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="button button--lime button--wide" disabled={busy}>{busy ? "Sending…" : "Send recovery email"}<ArrowRight size={18} /></button><button type="button" className="organizer-auth__link" onClick={() => { setAuthMode("signin"); setError(""); }}>Back to sign in</button></form>}</div></main>;

  if (screen === "check-email") return <main className="foundation-state"><a className="brand" href="/"><span className="brand-mark"><Radio size={17} /></span>HERE<span className="brand-dot">.</span></a><div className="foundation-state__icon"><MailCheck /></div><span className="eyebrow">CHECK YOUR EMAIL</span><h1>Continue from your inbox.</h1><p>If <strong>{pendingEmail || "this address"}</strong> can be used, we sent the next step. The link returns only to the trusted HERE organizer page.</p><button className="button button--dark" onClick={() => { setAuthMode("signin"); setError(""); setScreen("auth"); }}>Back to sign in</button></main>;

  if (screen === "reset-password") return <main className="organizer-auth organizer-auth--single"><section><a className="brand" href="/"><span className="brand-mark"><Radio size={18} /></span>HERE<span className="brand-dot">.</span></a><span className="eyebrow">PASSWORD RECOVERY</span><h1>Choose a new password.</h1><p>The recovery link is accepted only by the dedicated organizer session.</p></section><div className="organizer-auth__panel"><form onSubmit={updatePassword}><KeyRound /><h2>New password</h2><label>Password<input type="password" name="password" required minLength={8} autoComplete="new-password" /></label><label>Confirm password<input type="password" name="confirmPassword" required minLength={8} autoComplete="new-password" /></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="button button--lime button--wide" disabled={busy}>{busy ? "Updating…" : "Update password"}<ArrowRight size={18} /></button></form></div></main>;

  if (screen === "create") return <main className="foundation-organizer"><header className="foundation-organizer__top"><span className="brand"><span className="brand-mark"><Radio size={18} /></span>HERE<span className="brand-dot">.</span></span></header><section className="foundation-create"><button className="back-link" onClick={() => { setError(""); setScreen("rooms"); }}><ArrowLeft size={17} />Back to Rooms</button><span className="eyebrow">SPRINT 1</span><h1>Create a Room.</h1><p>Only the event essentials. A unique join code and QR are generated automatically.</p><form onSubmit={createRoom}><label>Room name<input name="name" required minLength={2} maxLength={100} placeholder="HERE Test Party" /></label><div className="form-grid"><label>Venue name<input name="venueName" placeholder="Lumen Club" /></label><label>City<input name="city" placeholder="Riga" /></label></div><div className="form-grid"><label>Starts<input name="startsAt" type="datetime-local" required defaultValue={localDateTime(1)} /></label><label>Ends<input name="endsAt" type="datetime-local" required defaultValue={localDateTime(5)} /></label></div>{error && <p className="form-error">{error}</p>}<button className="button button--lime" disabled={busy}>{busy ? "Creating…" : "Create Room & QR"}<ArrowRight size={18} /></button></form></section></main>;

  return <main className="foundation-organizer"><header className="foundation-organizer__top"><span className="brand"><span className="brand-mark"><Radio size={18} /></span>HERE<span className="brand-dot">.</span></span><div><button className="button button--lime button--small" onClick={() => setScreen("create")}><Plus size={17} />Create Room</button><button className="icon-button" onClick={signOut} aria-label="Sign out"><LogOut size={18} /></button></div></header><section className="foundation-organizer__heading"><div><span className="eyebrow">REAL ROOMS</span><h1>Organizer space</h1><p>Persistent Rooms, real join links and aggregate participant counts.</p></div></section>{rooms.length === 0 ? <section className="foundation-no-rooms"><QrCode /><h2>No Rooms yet.</h2><p>Create the first real event Room. No demo Room will be added automatically.</p><button className="button button--lime" onClick={() => setScreen("create")}><Plus size={18} />Create Room</button></section> : <div className="foundation-organizer-grid"><section className="foundation-room-list">{rooms.map((room) => <button key={room.id} className={`foundation-room-row ${selectedRoom?.id === room.id ? "active" : ""}`} onClick={() => setSelectedId(room.id)}><span className={`status-badge status-badge--${room.status}`}><i />{room.status}</span><div><h2>{room.name}</h2><p><MapPin size={14} />{[room.venue_name, room.city].filter(Boolean).join(", ") || "Venue not set"}</p><p><CalendarDays size={14} />{eventDate(room.starts_at)}</p></div><strong><Users size={17} />{room.joinedCount} joined</strong></button>)}</section>{selectedRoom && <div className="foundation-organizer-sidebar"><aside className="foundation-qr-card"><span className="eyebrow">ROOM ACCESS</span><h2>{selectedRoom.name}</h2><p>{selectedRoom.status === "closed" ? "This Room has ended." : "Scan to join this exact Room."}</p><div className="qr-image">{qrDataUrl ? <img src={qrDataUrl} alt={`QR code for ${selectedRoom.name}`} /> : <QrCode size={160} />}</div><a className="foundation-join-link" href={joinUrl} target="_blank" rel="noreferrer">{joinUrl}</a><div className="qr-actions"><a className="button button--dark" href={qrDataUrl} download={`${selectedRoom.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-qr.png`}><Download size={17} />Download PNG</a><a className="button button--ghost" href={joinUrl} target="_blank" rel="noreferrer"><ArrowRight size={17} />Open join link</a><button className="button button--ghost" onClick={copyLink}><Link2 size={17} />Copy link</button></div><div className="foundation-qr-stats"><Users /><span><strong>{selectedRoom.joinedCount}</strong> real participants</span></div>{selectedRoom.status !== "closed" && <button className="foundation-close-room" onClick={closeRoom}>Close Room</button>}</aside><OrganizerDropControls room={selectedRoom} /></div>}</div>}{error && <p className="foundation-global-error form-error">{error}</p>}{toast && <div className="toast"><Check size={17} />{toast}</div>}</main>;
}

function OrganizerState({ title, copy }: { title: string; copy: string }) {
  return <main className="foundation-state"><span className="brand"><span className="brand-mark"><Radio size={17} /></span>HERE<span className="brand-dot">.</span></span><div className="foundation-state__icon"><LockKeyhole /></div><h1>{title}</h1><p>{copy}</p></main>;
}

function OrganizerDropControls({ room }: { room: OrganizerRoom }) {
  const [drops, setDrops] = useState<OrganizerDrop[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [nowMs, setNowMs] = useState(() => Date.now());

  const loadDrops = useCallback(async () => {
    const client = getSupabaseOrganizerClient();
    if (!client) return;
    const { data, error: loadError } = await client.from("drops").select("id, room_id, sequence_number, scheduled_at, opened_at, drop_size, min_unlock_count, interest_budget, created_at").eq("room_id", room.id).order("sequence_number");
    if (loadError) throw loadError;
    setDrops((data || []) as OrganizerDrop[]);
  }, [room.id]);

  useEffect(() => {
    const loadTimer = window.setTimeout(() => { void loadDrops().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load Drops")); }, 0);
    const clockTimer = window.setInterval(() => setNowMs(Date.now()), 30000);
    return () => { window.clearTimeout(loadTimer); window.clearInterval(clockTimer); };
  }, [loadDrops]);

  async function addDrop(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setBusy(true); setError("");
    try {
      const form = new FormData(formElement);
      const client = getSupabaseOrganizerClient();
      if (!client) throw new Error("Supabase is not configured");
      const { error: createError } = await client.rpc("create_room_drop", {
        p_room_id: room.id,
        p_scheduled_at: new Date(String(form.get("scheduledAt"))).toISOString(),
        p_drop_size: Number(form.get("dropSize")),
        p_min_unlock_count: Number(form.get("minUnlockCount")),
        p_interest_budget: Number(form.get("interestBudget")),
      });
      if (createError) throw createError;
      await loadDrops();
      formElement.reset();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not add Drop"); }
    finally { setBusy(false); }
  }

  async function openNow(dropId: string) {
    setBusy(true); setError("");
    try {
      const client = getSupabaseOrganizerClient();
      const { error: openError } = await client!.rpc("open_drop_now", { p_drop_id: dropId });
      if (openError) throw openError;
      await loadDrops();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not open Drop"); }
    finally { setBusy(false); }
  }

  async function removeDrop(dropId: string) {
    setBusy(true); setError("");
    try {
      const client = getSupabaseOrganizerClient();
      const { error: deleteError } = await client!.rpc("delete_future_drop", { p_drop_id: dropId });
      if (deleteError) throw deleteError;
      await loadDrops();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not delete Drop"); }
    finally { setBusy(false); }
  }

  return <section className="organizer-drops"><div className="organizer-drops__heading"><div><span className="eyebrow">DROPS</span><h2>Drop schedule</h2></div><Clock3 /></div>{drops.length ? <div className="organizer-drop-list">{drops.map((drop) => { const future = !drop.opened_at && new Date(drop.scheduled_at).getTime() > nowMs; return <article key={drop.id}><div><strong>Drop {drop.sequence_number}</strong><span>{drop.opened_at ? "Live now" : eventDate(drop.scheduled_at)}</span><small>{drop.drop_size} people · unlock at {drop.min_unlock_count} · {drop.interest_budget} Interests</small></div>{room.status !== "closed" && <div><button type="button" onClick={() => openNow(drop.id)} disabled={busy || Boolean(drop.opened_at)}>Open Now</button>{future && <button type="button" className="drop-delete" onClick={() => removeDrop(drop.id)} disabled={busy} aria-label={`Delete Drop ${drop.sequence_number}`}><Trash2 size={15} /></button>}</div>}</article>; })}</div> : <p>No Drops scheduled yet.</p>}{room.status !== "closed" && <form className="organizer-drop-form" onSubmit={addDrop}><label>Drop time<input name="scheduledAt" type="datetime-local" required defaultValue={localDateTime(1)} /></label><div className="organizer-drop-numbers"><label>Size<input name="dropSize" type="number" min="1" max="20" defaultValue="10" required /></label><label>Unlock<input name="minUnlockCount" type="number" min="1" max="20" defaultValue="6" required /></label><label>Interests<input name="interestBudget" type="number" min="0" max="20" defaultValue="3" required /></label></div><button className="button button--dark button--wide" disabled={busy}><Plus size={16} />Add Drop</button></form>}{error && <p className="form-error">{error}</p>}<small className="organizer-drops__privacy"><ShieldCheck size={13} />Organizers never see individual Interests.</small></section>;
}
