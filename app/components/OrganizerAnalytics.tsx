"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Activity, BarChart3, Eye, Heart, MessageCircle, RefreshCw, ShieldCheck, Sparkles, Users } from "lucide-react";
import { getSupabaseOrganizerClient } from "@/lib/supabase/organizer-client";
import type { FoundationRoom, RoomAnalytics } from "@/lib/types";

function number(value: number | null | undefined) { return Number(value || 0); }
function count(value: number | null | undefined) { return new Intl.NumberFormat("en").format(number(value)); }
function rate(value: number | null | undefined) { return value == null ? "No data" : new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(value) + "%"; }
function duration(seconds: number | null | undefined) {
  if (seconds == null) return "No data";
  if (seconds < 60) return Math.round(seconds) + " sec";
  if (seconds < 3600) return Math.round(seconds / 60) + " min";
  return new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(seconds / 3600) + " hr";
}
function Metric({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return <article className="analytics-metric-card"><div>{icon}<span>{label}</span></div><strong>{value}</strong></article>;
}

export function OrganizerAnalytics({ room }: { room: FoundationRoom }) {
  const [analytics, setAnalytics] = useState<RoomAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attendance, setAttendance] = useState("");

  const load = useCallback(async () => {
    setError("");
    const client = getSupabaseOrganizerClient();
    if (!client) { setError("Supabase is not configured."); setLoading(false); return; }
    const result = await client.rpc("room_analytics", { p_room_id: room.id });
    if (result.error) setError("Aggregate analytics could not be loaded.");
    else {
      const next = result.data as RoomAnalytics;
      setAnalytics(next);
      const total = next.summary.total_attendance;
      setAttendance(total == null ? "" : String(total));
    }
    setLoading(false);
  }, [room.id]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(initialLoad);
  }, [load]);

  async function saveAttendance(event: FormEvent) {
    event.preventDefault();
    const client = getSupabaseOrganizerClient();
    if (!client || attendance === "") return;
    const result = await client.rpc("organizer_set_total_attendance", { p_room_id: room.id, p_total: Number(attendance) });
    if (result.error) setError("Attendance could not be saved."); else await load();
  }

  const funnel = useMemo(() => {
    if (!analytics) return [];
    const s = analytics.summary;
    return [
      ["Joined", number(s.joined_memberships)], ["Explore users", number(s.explore_users)],
      ["Profiles viewed", number(s.profiles_viewed)], ["Interests", number(s.interests_sent)],
      ["Matches", number(s.matches_created)], ["Conversations", number(s.conversations_started)],
    ] as const;
  }, [analytics]);

  if (loading) return <section className="organizer-analytics analytics-state"><RefreshCw className="spin" /><div><h2>Building privacy-safe totals…</h2><p>No people, pairs or chat text are loaded.</p></div></section>;
  if (!analytics) return <section className="organizer-analytics analytics-state analytics-state--error"><ShieldCheck /><div><h2>Analytics unavailable.</h2><p>{error}</p><button className="button button--ghost" onClick={() => void load()}>Try again</button></div></section>;

  const s = analytics.summary;
  const max = Math.max(1, ...funnel.map((entry) => entry[1]));
  return <section className="organizer-analytics">
    <header className="organizer-analytics__header"><div><span className="eyebrow">AGGREGATE ROOM ANALYTICS</span><h2>From arrival to real-life outcome.</h2><p>No private pairings, rejections, chat content, reporter identity or individual feedback answers.</p></div><button className="icon-button" onClick={() => void load()} aria-label="Refresh"><RefreshCw /></button></header>
    <form className="analytics-attendance" onSubmit={saveAttendance}><label>Total event attendance <small>Optional manual organizer estimate</small><input type="number" min="0" value={attendance} onChange={(event) => setAttendance(event.target.value)} placeholder="e.g. 180" /></label><button className="button button--ghost button--small">Save</button></form>
    <div className="analytics-summary-grid">
      <Metric label="Joined" value={count(s.joined_memberships)} icon={<Users />} />
      <Metric label="Recently active" value={count(s.active_memberships)} icon={<Activity />} />
      <Metric label="Discovery eligible" value={count(s.discovery_eligible_memberships)} icon={<Sparkles />} />
      <Metric label="Explore users" value={count(s.explore_users)} icon={<Users />} />
      <Metric label="Profiles viewed" value={count(s.profiles_viewed)} icon={<Eye />} />
      <Metric label="Interests" value={count(s.interests_sent)} icon={<Heart />} />
      <Metric label="Matches" value={count(s.matches_created)} icon={<Sparkles />} />
      <Metric label="Conversations" value={count(s.conversations_started)} icon={<MessageCircle />} />
    </div>
    <div className="analytics-dashboard-grid"><section className="analytics-panel analytics-funnel"><div className="analytics-panel__heading"><div><span>PILOT FUNNEL</span><h3>From Room to conversation</h3></div><BarChart3 /></div><div>{funnel.map(([label,value]) => <div key={label}><span>{label}</span><i><b style={{ width: Math.max(value ? 4 : 0, value / max * 100) + "%" }} /></i><strong>{count(value)}</strong></div>)}</div></section>
      <section className="analytics-panel analytics-rates"><div className="analytics-panel__heading"><div><span>CONVERSION</span><h3>Defined aggregates</h3></div><BarChart3 /></div><dl><div><dt>Attendance → joined</dt><dd>{rate(analytics.rates.join_rate)}</dd></div><div><dt>Joined → Explore</dt><dd>{rate(analytics.rates.explore_rate)}</dd></div><div><dt>Match → conversation</dt><dd>{rate(analytics.rates.match_to_conversation_rate)}</dd></div><div><dt>Median Match → first message</dt><dd>{duration(s.median_match_to_first_message_seconds)}</dd></div></dl></section></div>
    <section className="analytics-panel"><div className="analytics-panel__heading"><div><span>MET IN PERSON</span><h3>Post-event outcome answers</h3></div><Users /></div><div className="analytics-compact-grid"><div><span>Yes</span><strong>{count(s.irl_yes)}</strong></div><div><span>No</span><strong>{count(s.irl_no)}</strong></div><div><span>Not yet</span><strong>{count(s.irl_not_yet)}</strong></div><div><span>Prefer not to say</span><strong>{count(s.irl_prefer_not_to_say)}</strong></div></div></section>
    <section className="analytics-safety"><ShieldCheck /><div><span>SAFETY · AGGREGATES ONLY</span><h3>{count(s.blocks_count)} Blocks · {count(s.reports_count)} Reports</h3><p>Report details and moderation remain with authorized platform operations.</p></div></section>
    {error && <p className="form-error">{error}</p>}
  </section>;
}
