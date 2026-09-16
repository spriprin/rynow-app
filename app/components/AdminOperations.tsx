"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Activity, Check, Flag, LockKeyhole, LogOut, MessageCircle, Radio, RefreshCw, ShieldCheck, Users } from "lucide-react";
import { getSupabaseOrganizerClient } from "@/lib/supabase/organizer-client";
import { AuthTurnstile, isTurnstileConfigured, type AuthTurnstileHandle } from "./AuthTurnstile";

type RoomOps = {
  room_id: string; room_name: string; status: string; joined: number; recently_active: number;
  discovery_eligible: number; explore_users: number; profiles_viewed: number; interests: number;
  matches: number; conversations_started: number; blocks: number; reports: number;
};
type ReportRow = {
  report_id: string; category: string; room_id: string | null; room_name: string | null;
  reported_user_id: string; reported_display_name: string; created_at: string; details: string | null;
  status: "open" | "reviewed" | "resolved"; event_staff_share_consent: boolean;
};
type View = "loading" | "signin" | "denied" | "dashboard";

export function AdminOperations() {
  const [view, setView] = useState<View>("loading");
  const [rooms, setRooms] = useState<RoomOps[]>([]);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [filter, setFilter] = useState<"open" | "reviewed" | "resolved">("open");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [captchaToken, setCaptchaToken] = useState("");
  const turnstileRef = useRef<AuthTurnstileHandle | undefined>(undefined);

  const load = useCallback(async (selected: string = filter) => {
    const client = getSupabaseOrganizerClient();
    if (!client) throw new Error("Supabase is not configured");
    const { data: userData } = await client.auth.getUser();
    if (!userData.user) { setView("signin"); return; }
    const [roomResult, reportResult] = await Promise.all([
      client.rpc("admin_operations_rooms"), client.rpc("admin_report_queue", { p_status: selected }),
    ]);
    if (roomResult.error || reportResult.error) {
      const message = roomResult.error?.message || reportResult.error?.message || "";
      if (message.includes("Platform admin")) { setView("denied"); return; }
      throw roomResult.error || reportResult.error;
    }
    setRooms((roomResult.data || []) as RoomOps[]);
    setReports((reportResult.data || []) as ReportRow[]);
    setView("dashboard");
  }, [filter]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => {
      void load().catch(() => { setError("Operations data could not be loaded."); setView("signin"); });
    }, 0);
    return () => window.clearTimeout(initialLoad);
  }, [load]);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    const client = getSupabaseOrganizerClient();
    if (!client) { setError("Supabase is not configured."); setBusy(false); return; }
    if (isTurnstileConfigured() && !captchaToken) { setError("Complete the quick security check."); setBusy(false); return; }
    const result = await client.auth.signInWithPassword({
      email: String(form.get("email")), password: String(form.get("password")),
      options: { captchaToken: captchaToken || undefined },
    });
    setCaptchaToken(""); turnstileRef.current?.reset();
    if (result.error) setError("Sign-in failed.");
    else await load().catch(() => setError("Admin access could not be verified."));
    setBusy(false);
  }

  async function signOut() {
    await getSupabaseOrganizerClient()?.auth.signOut();
    setRooms([]); setReports([]); setView("signin");
  }

  async function changeStatus(id: string, status: ReportRow["status"]) {
    const client = getSupabaseOrganizerClient(); if (!client) return;
    setBusy(true); setError("");
    const result = await client.rpc("admin_set_report_status", { p_report_id: id, p_status: status });
    if (result.error) setError("The moderation state could not be updated.");
    else await load(filter);
    setBusy(false);
  }

  if (view === "loading") return <main className="admin-operations admin-state"><RefreshCw className="spin" /><h1>Verifying platform access…</h1></main>;
  if (view === "signin") return <main className="admin-operations admin-state"><span className="brand"><span className="brand-mark"><Radio /></span>HERE<span className="brand-dot">.</span></span><LockKeyhole /><span className="eyebrow">PLATFORM OPERATIONS</span><h1>Admin sign in</h1><p>This is separate from guest access. A permanent account must also exist in the server-controlled admin allowlist.</p><form onSubmit={signIn}><input name="email" type="email" placeholder="Admin email" required /><input name="password" type="password" placeholder="Password" required /><AuthTurnstile action="admin_signin" instanceRef={turnstileRef} onSuccess={(token) => { setCaptchaToken(token); setError(""); }} onExpire={() => { setCaptchaToken(""); setError("The quick security check expired. Please try again."); }} onError={() => { setCaptchaToken(""); setError("The quick security check could not load."); }} /><button className="button button--lime" disabled={busy || (isTurnstileConfigured() && !captchaToken)}>Sign in</button></form>{error && <p className="form-error">{error}</p>}</main>;
  if (view === "denied") return <main className="admin-operations admin-state"><ShieldCheck /><span className="eyebrow">ACCESS DENIED</span><h1>This account is not a platform admin.</h1><p>Organizer ownership and user metadata never grant moderation access.</p><button className="button button--ghost" onClick={() => void signOut()}>Sign out</button></main>;

  return <main className="admin-operations">
    <header><span className="brand"><span className="brand-mark"><Radio /></span>HERE<span className="brand-dot">.</span></span><div><button className="icon-button" onClick={() => void load()} aria-label="Refresh"><RefreshCw /></button><button className="icon-button" onClick={() => void signOut()} aria-label="Sign out"><LogOut /></button></div></header>
    <section className="admin-heading"><span className="eyebrow">PLATFORM ADMIN ONLY</span><h1>Live Rooms &amp; moderation</h1><p>Operational aggregates and submitted safety Reports. No chats or private Interest graph are queried.</p></section>
    <section className="admin-room-grid">{rooms.map((room) => <article key={room.room_id}><header><strong>{room.room_name}</strong><span>{room.status}</span></header><dl><div><dt><Users />Joined</dt><dd>{room.joined}</dd></div><div><dt><Activity />Recently active</dt><dd>{room.recently_active}</dd></div><div><dt>Eligible</dt><dd>{room.discovery_eligible}</dd></div><div><dt>Explore users</dt><dd>{room.explore_users}</dd></div><div><dt>Views</dt><dd>{room.profiles_viewed}</dd></div><div><dt>Interests</dt><dd>{room.interests}</dd></div><div><dt>Matches</dt><dd>{room.matches}</dd></div><div><dt><MessageCircle />Conversations</dt><dd>{room.conversations_started}</dd></div><div><dt>Blocks</dt><dd>{room.blocks}</dd></div><div><dt>Reports</dt><dd>{room.reports}</dd></div></dl></article>)}</section>
    <section className="admin-reports"><header><div><Flag /><span><strong>Moderation queue</strong><small>Reporter identity remains server-side</small></span></div><nav>{(["open","reviewed","resolved"] as const).map((status) => <button className={filter === status ? "active" : ""} key={status} onClick={() => { setFilter(status); void load(status); }}>{status}</button>)}</nav></header>
      {reports.length ? reports.map((report) => <article key={report.report_id}><div><span>{report.category}</span><h3>{report.reported_display_name}</h3><p>{report.room_name || "Deleted Room"} · {new Date(report.created_at).toLocaleString()}</p>{report.details && <blockquote>{report.details}</blockquote>}{report.event_staff_share_consent && <small><Check />Guest consented to relevant event-staff escalation.</small>}</div><select disabled={busy} value={report.status} onChange={(event) => void changeStatus(report.report_id, event.target.value as ReportRow["status"])}><option value="open">Open</option><option value="reviewed">Reviewed</option><option value="resolved">Resolved</option></select></article>) : <p className="admin-empty">No {filter} Reports.</p>}
    </section>
    {error && <p className="form-error">{error}</p>}
  </main>;
}
