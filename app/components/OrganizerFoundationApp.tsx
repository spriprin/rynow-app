"use client";
/* eslint-disable @next/next/no-img-element, @next/next/no-html-link-for-pages -- QR codes are generated data URLs and brand links keep the Vinext client boundary dependency-free. */

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import QRCode from "qrcode";
import { ArrowLeft, ArrowRight, CalendarDays, Check, Download, KeyRound, Link2, LockKeyhole, LogOut, MailCheck, MapPin, Plus, QrCode, Radio, ShieldCheck, Users } from "lucide-react";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { getSupabaseOrganizerClient, getTrustedApplicationOrigin, organizerAuthRedirect } from "@/lib/supabase/organizer-client";
import { logDiagnostic, retryRead, userFacingError } from "@/lib/reliability";
import type { FoundationRoom } from "@/lib/types";
import { AuthTurnstile, isTurnstileConfigured, type AuthTurnstileHandle } from "./AuthTurnstile";
import { OrganizerAnalytics } from "./OrganizerAnalytics";

type OrganizerScreen = "loading" | "configuration" | "auth" | "check-email" | "reset-password" | "rooms" | "create";
type AuthMode = "signin" | "signup" | "forgot";
type OrganizerRoom = FoundationRoom & { joinedCount: number; recentCount: number; eligibleCount: number };
type OrganizerPresenceCount = { room_id: string; joined_count: number; recent_count: number; eligible_count: number };

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
  const [captchaToken, setCaptchaToken] = useState("");
  const [pendingEmail, setPendingEmail] = useState("");
  const closingRoom = useRef(false);
  const turnstileRef = useRef<AuthTurnstileHandle | undefined>(undefined);

  const selectedRoom = rooms.find((room) => room.id === selectedId) || rooms[0] || null;
  const origin = useMemo(() => {
    const browserOrigin = typeof window === "undefined" ? "" : window.location.origin;
    return getTrustedApplicationOrigin(browserOrigin);
  }, []);
  const joinUrl = useMemo(() => selectedRoom ? `${origin}/r/${selectedRoom.join_code}` : "", [origin, selectedRoom]);

  const loadPresenceCounts = useCallback(async () => {
    const client = getSupabaseOrganizerClient();
    if (!client) return;
    const data = await retryRead("organizer_presence_counts", async () => {
      const result = await client.rpc("organizer_room_presence_counts");
      if (result.error) throw result.error;
      return (result.data || []) as OrganizerPresenceCount[];
    });
    const counts = new Map(data.map((item) => [item.room_id, item]));
    setRooms((current) => current.map((room) => ({
      ...room,
      joinedCount: Number(counts.get(room.id)?.joined_count || 0),
      recentCount: Number(counts.get(room.id)?.recent_count || 0),
      eligibleCount: Number(counts.get(room.id)?.eligible_count || 0),
    })));
  }, []);

  const loadRooms = useCallback(async (userId: string) => {
    const client = getSupabaseOrganizerClient();
    if (!client) return;
    const [roomData, presenceData] = await retryRead("organizer_rooms", async () => {
      const results = await Promise.all([
        client.from("rooms").select("id, name, venue_name, city, starts_at, ends_at, status, join_code, cover_path").eq("organizer_id", userId).order("created_at", { ascending: false }),
        client.rpc("organizer_room_presence_counts"),
      ]);
      if (results[0].error) throw results[0].error;
      if (results[1].error) throw results[1].error;
      return [results[0].data || [], (results[1].data || []) as OrganizerPresenceCount[]] as const;
    });
    const counts = new Map(presenceData.map((item) => [item.room_id, item]));
    const withCounts = roomData.map((room) => ({
      ...(room as FoundationRoom),
      joinedCount: Number(counts.get(room.id)?.joined_count || 0),
      recentCount: Number(counts.get(room.id)?.recent_count || 0),
      eligibleCount: Number(counts.get(room.id)?.eligible_count || 0),
    }));
    setRooms(withCounts);
    setSelectedId((current) => current || withCounts[0]?.id || "");
  }, []);

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
        if (!recoveryRequested && !isTurnstileConfigured()) {
          setError("Turnstile is not configured for Auth operations.");
          setScreen("configuration");
          return;
        }
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
  }, [loadRooms]);

  useEffect(() => {
    if (!joinUrl) return;
    void QRCode.toDataURL(joinUrl, { width: 960, margin: 4, errorCorrectionLevel: "H", color: { dark: "#000000", light: "#ffffff" } }).then(setQrDataUrl);
  }, [joinUrl]);

  useEffect(() => {
    if (screen !== "rooms" || !organizerId) return;
    const refresh = () => {
      if (document.visibilityState === "visible" && navigator.onLine) {
        void loadPresenceCounts().catch((reason: unknown) => logDiagnostic("organizer_presence_poll", reason));
      }
    };
    const timer = window.setInterval(refresh, 30_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [loadPresenceCounts, organizerId, screen]);

  function flash(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2200);
  }

  function changeAuthMode(nextMode: AuthMode) {
    setCaptchaToken("");
    setError("");
    turnstileRef.current?.reset();
    setAuthMode(nextMode);
  }

  function requireCaptchaToken() {
    if (!isTurnstileConfigured()) throw new Error("Turnstile is not configured for Auth operations.");
    if (!captchaToken) throw new Error("Complete the quick security check.");
    return captchaToken;
  }

  function resetAuthChallenge() {
    setCaptchaToken("");
    turnstileRef.current?.reset();
  }

  function authChallenge(action: string) {
    return <AuthTurnstile key={`${authMode}:${action}`} action={action} instanceRef={turnstileRef} onSuccess={(token) => { setCaptchaToken(token); setError(""); }} onExpire={() => { setCaptchaToken(""); setError("The quick security check expired. Please try it again."); }} onError={() => { setCaptchaToken(""); setError("The quick security check could not load. Check your connection and try again."); }} />;
  }

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const form = new FormData(event.currentTarget);
      const client = getSupabaseOrganizerClient();
      if (!client) throw new Error("Supabase is not configured");
      const { data, error: signInError } = await client.auth.signInWithPassword({ email: String(form.get("email") || ""), password: String(form.get("password") || ""), options: { captchaToken: requireCaptchaToken() } });
      if (signInError || !data.user) throw new Error("We couldn’t sign you in. Check your details or reset your password.");
      if (data.user.is_anonymous) throw new Error("A permanent organizer account is required");
      setOrganizerId(data.user.id);
      await loadRooms(data.user.id);
      setScreen("rooms");
    } catch (reason) {
      logDiagnostic("organizer_sign_in", reason);
      setError(userFacingError(reason, "We couldn’t sign you in. Please try again.", "Too many requests. Please try again in a moment."));
    } finally {
      resetAuthChallenge();
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
        options: { captchaToken: requireCaptchaToken(), emailRedirectTo: organizerAuthRedirect("/organizer?auth=confirmed", window.location.origin) },
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
      logDiagnostic("organizer_sign_up", reason);
      setError(userFacingError(reason, "We couldn’t create the account. Please try again.", "Too many requests. Please try again in a moment."));
    } finally {
      resetAuthChallenge();
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
        captchaToken: requireCaptchaToken(),
        redirectTo: organizerAuthRedirect("/organizer?recovery=1", window.location.origin),
      });
      if (resetError?.status === 429) throw new Error("Too many requests. Please wait a moment and try again.");
      setPendingEmail(email);
      setScreen("check-email");
    } catch (reason) {
      logDiagnostic("organizer_password_recovery", reason);
      setError(userFacingError(reason, "We couldn’t send the recovery email. Please try again.", "Too many requests. Please try again in a moment."));
    } finally {
      resetAuthChallenge();
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
      logDiagnostic("organizer_password_update", reason);
      setError(userFacingError(reason, "We couldn’t update the password. Try again."));
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
      const created = { ...(data as FoundationRoom), joinedCount: 0, recentCount: 0, eligibleCount: 0 };
      setRooms((current) => [created, ...current]);
      setSelectedId(created.id);
      setScreen("rooms");
      flash("Room created — the QR is live");
    } catch (reason) {
      logDiagnostic("organizer_create_room", reason);
      setError(userFacingError(reason, "We couldn’t create this Room. Try again."));
    } finally {
      setBusy(false);
    }
  }

  async function closeRoom() {
    if (!selectedRoom || closingRoom.current) return;
    closingRoom.current = true;
    const client = getSupabaseOrganizerClient();
    if (!client) { closingRoom.current = false; return; }
    try {
      const { error: closeError } = await client.from("rooms").update({ status: "closed" }).eq("id", selectedRoom.id);
      if (closeError) throw closeError;
      setRooms((current) => current.map((room) => room.id === selectedRoom.id ? { ...room, status: "closed", recentCount: 0, eligibleCount: 0 } : room));
      flash("Room closed");
    } catch (reason) {
      logDiagnostic("close_room", reason, { roomId: selectedRoom.id });
      setError(userFacingError(reason, "We couldn’t close this Room. Try again."));
    } finally {
      closingRoom.current = false;
    }
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
  if (screen === "configuration") return <OrganizerState title="Organizer Auth isn’t configured." copy={error || "Add the public Supabase settings and Turnstile site key before using organizer authentication."} />;
  if (screen === "auth") return <main className="organizer-auth"><section><a className="brand" href="/"><span className="brand-mark"><Radio size={18} /></span>RYNOW<span className="brand-dot">.</span></a><span className="eyebrow">REAL EVENT ROOMS</span><h1>Create a Room for your event.</h1><p>Sign in or create a permanent organizer account. Guests still join instantly through the Room QR.</p><small><ShieldCheck size={16} />Organizer accounts and anonymous guest sessions stay separate on this device.</small></section><div className="organizer-auth__panel"><div className="organizer-auth__tabs" role="tablist" aria-label="Organizer authentication"><button type="button" role="tab" aria-selected={authMode === "signin"} onClick={() => changeAuthMode("signin")}>Sign in</button><button type="button" role="tab" aria-selected={authMode === "signup"} onClick={() => changeAuthMode("signup")}>Create account</button></div>{authMode === "signin" && <form onSubmit={signIn}><LockKeyhole /><h2>Welcome back.</h2><p>Open your organizer space and manage your own Rooms.</p><label>Email<input type="email" name="email" required autoComplete="email" /></label><label>Password<input type="password" name="password" required minLength={8} autoComplete="current-password" /></label>{authChallenge("organizer_signin")}{error && <p className="form-error" role="alert">{error}</p>}<button className="button button--lime button--wide" disabled={busy || !captchaToken}>{busy ? "Signing in…" : "Sign in"}<ArrowRight size={18} /></button><button type="button" className="organizer-auth__link" onClick={() => changeAuthMode("forgot")}>Forgot password?</button></form>}{authMode === "signup" && <form onSubmit={signUp}><KeyRound /><h2>Create organizer account.</h2><p>Your account owns only the Rooms you create.</p><label>Email<input type="email" name="email" required autoComplete="email" /></label><label>Password<input type="password" name="password" required minLength={8} autoComplete="new-password" /></label><label>Confirm password<input type="password" name="confirmPassword" required minLength={8} autoComplete="new-password" /></label>{authChallenge("organizer_signup")}{error && <p className="form-error" role="alert">{error}</p>}<button className="button button--lime button--wide" disabled={busy || !captchaToken}>{busy ? "Creating account…" : "Create account"}<ArrowRight size={18} /></button></form>}{authMode === "forgot" && <form onSubmit={requestPasswordReset}><MailCheck /><h2>Reset your password.</h2><p>We’ll send recovery instructions if the address can be used.</p><label>Email<input type="email" name="email" required autoComplete="email" /></label>{authChallenge("organizer_recovery")}{error && <p className="form-error" role="alert">{error}</p>}<button className="button button--lime button--wide" disabled={busy || !captchaToken}>{busy ? "Sending…" : "Send recovery email"}<ArrowRight size={18} /></button><button type="button" className="organizer-auth__link" onClick={() => changeAuthMode("signin")}>Back to sign in</button></form>}</div></main>;

  if (screen === "check-email") return <main className="foundation-state"><a className="brand" href="/"><span className="brand-mark"><Radio size={17} /></span>RYNOW<span className="brand-dot">.</span></a><div className="foundation-state__icon"><MailCheck /></div><span className="eyebrow">CHECK YOUR EMAIL</span><h1>Continue from your inbox.</h1><p>If <strong>{pendingEmail || "this address"}</strong> can be used, we sent the next step. The link returns only to the trusted RYNOW organizer page.</p><button className="button button--dark" onClick={() => { changeAuthMode("signin"); setScreen("auth"); }}>Back to sign in</button></main>;

  if (screen === "reset-password") return <main className="organizer-auth organizer-auth--single"><section><a className="brand" href="/"><span className="brand-mark"><Radio size={18} /></span>RYNOW<span className="brand-dot">.</span></a><span className="eyebrow">PASSWORD RECOVERY</span><h1>Choose a new password.</h1><p>The recovery link is accepted only by the dedicated organizer session.</p></section><div className="organizer-auth__panel"><form onSubmit={updatePassword}><KeyRound /><h2>New password</h2><label>Password<input type="password" name="password" required minLength={8} autoComplete="new-password" /></label><label>Confirm password<input type="password" name="confirmPassword" required minLength={8} autoComplete="new-password" /></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="button button--lime button--wide" disabled={busy}>{busy ? "Updating…" : "Update password"}<ArrowRight size={18} /></button></form></div></main>;

  if (screen === "create") return <main className="foundation-organizer"><header className="foundation-organizer__top"><span className="brand"><span className="brand-mark"><Radio size={18} /></span>RYNOW<span className="brand-dot">.</span></span></header><section className="foundation-create"><button className="back-link" onClick={() => { setError(""); setScreen("rooms"); }}><ArrowLeft size={17} />Back to Rooms</button><span className="eyebrow">SPRINT 1</span><h1>Create a Room.</h1><p>Only the event essentials. A unique join code and QR are generated automatically.</p><form onSubmit={createRoom}><label>Room name<input name="name" required minLength={2} maxLength={100} placeholder="RYNOW Test Party" /></label><div className="form-grid"><label>Venue name<input name="venueName" placeholder="Lumen Club" /></label><label>City<input name="city" placeholder="Riga" /></label></div><div className="form-grid"><label>Starts<input name="startsAt" type="datetime-local" required defaultValue={localDateTime(1)} /></label><label>Ends<input name="endsAt" type="datetime-local" required defaultValue={localDateTime(5)} /></label></div>{error && <p className="form-error">{error}</p>}<button className="button button--lime" disabled={busy}>{busy ? "Creating…" : "Create Room & QR"}<ArrowRight size={18} /></button></form></section></main>;

  return <main className="foundation-organizer"><header className="foundation-organizer__top"><span className="brand"><span className="brand-mark"><Radio size={18} /></span>RYNOW<span className="brand-dot">.</span></span><div><button className="button button--lime button--small" onClick={() => setScreen("create")}><Plus size={17} />Create Room</button><button className="icon-button" onClick={signOut} aria-label="Sign out"><LogOut size={18} /></button></div></header><section className="foundation-organizer__heading"><div><span className="eyebrow">REAL ROOMS</span><h1>Organizer space</h1><p>Guests discover small, fairly balanced selections throughout the open event.</p></div></section>{rooms.length === 0 ? <section className="foundation-no-rooms"><QrCode /><h2>No Rooms yet.</h2><p>Create the first real event Room. No demo Room will be added automatically.</p><button className="button button--lime" onClick={() => setScreen("create")}><Plus size={18} />Create Room</button></section> : <><div className="foundation-organizer-grid"><section className="foundation-room-list">{rooms.map((room) => <button key={room.id} className={`foundation-room-row ${selectedRoom?.id === room.id ? "active" : ""}`} onClick={() => setSelectedId(room.id)}><span className={`status-badge status-badge--${room.status}`}><i />{room.status}</span><div><h2>{room.name}</h2><p><MapPin size={14} />{[room.venue_name, room.city].filter(Boolean).join(", ") || "Venue not set"}</p><p><CalendarDays size={14} />{eventDate(room.starts_at)}</p></div><strong><Users size={17} />{room.joinedCount} joined · {room.recentCount} recently active</strong></button>)}</section>{selectedRoom && <div className="foundation-organizer-sidebar"><aside className="foundation-qr-card"><span className="eyebrow">ROOM ACCESS</span><h2>{selectedRoom.name}</h2><p>{selectedRoom.status === "closed" ? "This Room has ended." : "Scan to join this exact Room."}</p><div className="qr-image">{qrDataUrl ? <img src={qrDataUrl} alt={`QR code for ${selectedRoom.name}`} /> : <QrCode size={160} />}</div><a className="foundation-join-link" href={joinUrl} target="_blank" rel="noreferrer">{joinUrl}</a><div className="qr-actions"><a className="button button--dark" href={qrDataUrl} download={`${selectedRoom.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-qr.png`}><Download size={17} />Download PNG</a><a className="button button--ghost" href={joinUrl} target="_blank" rel="noreferrer"><ArrowRight size={17} />Open join link</a><button className="button button--ghost" onClick={copyLink}><Link2 size={17} />Copy link</button></div><div className="foundation-qr-stats"><Users /><span><strong>{selectedRoom.joinedCount}</strong> joined · <strong>{selectedRoom.recentCount}</strong> recently active · <strong>{selectedRoom.eligibleCount}</strong> discovery eligible</span></div>{selectedRoom.status !== "closed" && <button className="foundation-close-room" onClick={closeRoom}>Close Room</button>}</aside></div>}</div>{selectedRoom && <OrganizerAnalytics room={selectedRoom} />}</>}{error && <p className="foundation-global-error form-error">{error}</p>}{toast && <div className="toast"><Check size={17} />{toast}</div>}</main>;
}

function OrganizerState({ title, copy }: { title: string; copy: string }) {
  return <main className="foundation-state"><span className="brand"><span className="brand-mark"><Radio size={17} /></span>RYNOW<span className="brand-dot">.</span></span><div className="foundation-state__icon"><LockKeyhole /></div><h1>{title}</h1><p>{copy}</p></main>;
}
