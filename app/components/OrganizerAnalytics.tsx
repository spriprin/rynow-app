"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, BarChart3, CircleHelp, Eye, Heart, MessageCircle, RefreshCw, ShieldCheck, Sparkles, Users } from "lucide-react";
import { getSupabaseOrganizerClient } from "@/lib/supabase/organizer-client";
import type { FoundationRoom, RoomAnalytics, RoomAnalyticsDrop } from "@/lib/types";

const FORMULAS = {
  active: "Memberships where is_active = true. This is app presence, not exact physical attendance.",
  unlock: "Successful unique viewer + Drop unlocks ÷ unique viewer + Drop claim attempts.",
  completion: "Completed viewer + Drop runs ÷ started viewer + Drop runs. A run completes only when every assigned card was actually seen and handled.",
  response: "Accepted + declined Interests ÷ all Interests sent in this Room.",
  acceptance: "Accepted Interests ÷ all responded Interests.",
  decline: "Declined Interests ÷ all responded Interests.",
  conversation: "Matches with at least one real message ÷ all Matches created in this Room.",
  cardsSeen: "Assigned cards where first_seen_at is not null. Assignment alone is never an impression.",
  incomingOpened: "Incoming Interests whose recipient actually opened the sender card. List loading and polling do not count.",
} as const;

function count(value: number | null | undefined) {
  return new Intl.NumberFormat("en").format(Number(value || 0));
}

function rate(value: number | null | undefined) {
  return value == null ? "No data" : `${new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(value)}%`;
}

function duration(seconds: number | null) {
  if (seconds == null) return "No data";
  if (seconds < 60) return `${Math.round(seconds)} sec`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  return `${new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(seconds / 3600)} hr`;
}

function updatedAt(value: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value));
}

function dropTime(value: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function Info({ copy }: { copy: string }) {
  return <button type="button" className="analytics-info" aria-label={copy} title={copy}><CircleHelp size={14} /></button>;
}

function MetricCard({ label, value, icon, info }: { label: string; value: string; icon: React.ReactNode; info?: string }) {
  return <article className="analytics-metric-card"><div>{icon}<span>{label}{info && <Info copy={info} />}</span></div><strong>{value}</strong></article>;
}

export function OrganizerAnalytics({ room }: { room: FoundationRoom }) {
  const [analytics, setAnalytics] = useState<RoomAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const client = getSupabaseOrganizerClient();
      if (!client) throw new Error("Supabase is not configured");
      const { data, error: analyticsError } = await client.rpc("room_analytics", { p_room_id: room.id });
      if (analyticsError) throw analyticsError;
      setAnalytics(data as RoomAnalytics);
    } catch {
      setError("Room analytics could not be loaded. Your private interaction data was not exposed.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [room.id]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const funnel = useMemo(() => {
    if (!analytics) return [];
    const summary = analytics.summary;
    return [
      ["Joined", summary.joined_memberships],
      ["Your Drop started", summary.your_drop_started_participants],
      ["Card seen", summary.card_seen_participants],
      ["Interest", summary.interest_senders],
      ["Match", summary.matches_created],
      ["Conversation", summary.conversations_started],
    ] as const;
  }, [analytics]);

  if (loading) return <section className="organizer-analytics analytics-state" aria-busy="true"><RefreshCw className="spin" /><div><span className="eyebrow">ROOM ANALYTICS</span><h2>Building privacy-safe totals…</h2><p>No people, pairs or message text are loaded.</p></div></section>;

  if (error || !analytics) return <section className="organizer-analytics analytics-state analytics-state--error"><ShieldCheck /><div><span className="eyebrow">ROOM ANALYTICS</span><h2>Analytics unavailable.</h2><p>{error || "Try again in a moment."}</p><button className="button button--ghost button--small" onClick={() => void load(true)}>Try again</button></div></section>;

  const summary = analytics.summary;
  const maxFunnel = Math.max(1, ...funnel.map(([, value]) => value));

  return <section className="organizer-analytics">
    <header className="organizer-analytics__header">
      <div><span className="eyebrow">ROOM ANALYTICS</span><h2>What happened in this Room.</h2><p>Aggregate product health only. Active means app presence, not verified physical attendance.</p></div>
      <div><small>Last updated<br /><strong>{updatedAt(analytics.last_updated)}</strong></small><button className="icon-button" onClick={() => void load(true)} disabled={refreshing} aria-label="Refresh Room analytics"><RefreshCw className={refreshing ? "spin" : ""} /></button></div>
    </header>

    <div className="analytics-summary-grid">
      <MetricCard label="Joined" value={count(summary.joined_memberships)} icon={<Users />} />
      <MetricCard label="Active" value={count(summary.active_memberships)} icon={<Activity />} info={FORMULAS.active} />
      <MetricCard label="Cards seen" value={count(summary.cards_seen)} icon={<Eye />} info={FORMULAS.cardsSeen} />
      <MetricCard label="Interests" value={count(summary.interests_sent)} icon={<Heart />} />
      <MetricCard label="Matches" value={count(summary.matches_created)} icon={<Sparkles />} />
      <MetricCard label="Conversations" value={count(summary.conversations_started)} icon={<MessageCircle />} />
    </div>

    {summary.joined_memberships === 0 && <div className="analytics-empty"><Users /><div><strong>No participant data yet.</strong><p>Share this Room’s QR. Aggregates will appear after real guests join.</p></div></div>}

    <div className="analytics-dashboard-grid">
      <section className="analytics-panel analytics-funnel">
        <div className="analytics-panel__heading"><div><span>CONVERSION FUNNEL</span><h3>From Room to conversation</h3></div><BarChart3 /></div>
        <div>{funnel.map(([label, value]) => <div key={label}><span>{label}</span><i><b style={{ width: `${Math.max(value ? 4 : 0, (value / maxFunnel) * 100)}%` }} /></i><strong>{count(value)}</strong></div>)}</div>
      </section>

      <section className="analytics-panel analytics-rates">
        <div className="analytics-panel__heading"><div><span>QUALITY RATES</span><h3>Defined, never guessed</h3></div><CircleHelp /></div>
        <dl>
          <div><dt>Unlock rate <Info copy={FORMULAS.unlock} /></dt><dd>{rate(analytics.rates.unlock_rate)}</dd></div>
          <div><dt>Drop completion <Info copy={FORMULAS.completion} /></dt><dd>{rate(analytics.rates.drop_completion_rate)}</dd></div>
          <div><dt>Interest response <Info copy={FORMULAS.response} /></dt><dd>{rate(analytics.rates.interest_response_rate)}</dd></div>
          <div><dt>Match → conversation <Info copy={FORMULAS.conversation} /></dt><dd>{rate(analytics.rates.match_to_conversation_rate)}</dd></div>
        </dl>
      </section>
    </div>

    <section className="analytics-panel analytics-discovery">
      <div className="analytics-panel__heading"><div><span>DISCOVERY HEALTH</span><h3>Real server-side events</h3></div><Eye /></div>
      <div className="analytics-compact-grid">
        <div><span>Drops scheduled</span><strong>{count(summary.scheduled_drops)}</strong></div>
        <div><span>Effectively opened</span><strong>{count(summary.effectively_opened_drops)}</strong></div>
        <div><span>Unique claim attempts</span><strong>{count(summary.claim_attempts)}</strong></div>
        <div><span>Forming attempts</span><strong>{count(summary.forming_attempts)}</strong></div>
        <div><span>Successful unlocks</span><strong>{count(summary.successful_unlocks)}</strong></div>
        <div><span>Completed Your Drops</span><strong>{count(summary.your_drop_completed_runs)}</strong></div>
        <div><span>Incoming Interests opened <Info copy={FORMULAS.incomingOpened} /></span><strong>{count(summary.incoming_interests_opened)}</strong></div>
        <div><span>Median Match → first message</span><strong>{duration(summary.median_match_to_first_message_seconds)}</strong></div>
      </div>
    </section>

    <section className="analytics-panel analytics-response">
      <div className="analytics-panel__heading"><div><span>INTEREST RESPONSE</span><h3>Aggregate outcomes</h3></div><Heart /></div>
      <div className="analytics-response__counts"><div><span>Pending</span><strong>{count(summary.pending_interests)}</strong></div><div><span>Accepted</span><strong>{count(summary.accepted_interests)}</strong></div><div><span>Declined</span><strong>{count(summary.declined_interests)}</strong></div></div>
      <div className="analytics-response__rates"><span>Response <strong>{rate(analytics.rates.interest_response_rate)}</strong><Info copy={FORMULAS.response} /></span><span>Acceptance <strong>{rate(analytics.rates.interest_acceptance_rate)}</strong><Info copy={FORMULAS.acceptance} /></span><span>Decline <strong>{rate(analytics.rates.interest_decline_rate)}</strong><Info copy={FORMULAS.decline} /></span></div>
    </section>

    <DropAnalytics drops={analytics.drops} />

    <section className="analytics-safety"><ShieldCheck /><div><span>SAFETY · AGGREGATES ONLY</span><h3>{count(summary.blocks_count)} Blocks · {count(summary.reports_count)} Reports</h3><p>No identities, reasons, message bodies or pair graph are available here. Block attribution starts with Sprint 4.</p></div></section>
    <footer className="analytics-privacy-note"><ShieldCheck /><span>Analytics never affects Fair Exposure and never exposes profiles, assignments, Interests, Matches, messages, Blocks or Reports as person-level records.</span></footer>
  </section>;
}

function DropAnalytics({ drops }: { drops: RoomAnalyticsDrop[] }) {
  return <section className="analytics-panel analytics-drop-table">
    <div className="analytics-panel__heading"><div><span>DROP BREAKDOWN</span><h3>One aggregate row per Drop</h3></div><Sparkles /></div>
    {drops.length === 0 ? <div className="analytics-insufficient"><strong>No Drops scheduled.</strong><p>Add a Drop to begin measuring discovery health.</p></div> : <div className="analytics-drop-table__scroll"><table><thead><tr><th>Drop</th><th>Status</th><th>Claims</th><th>Unlocked</th><th>Cards seen</th><th>Completed</th><th>Interests</th><th>Matches</th></tr></thead><tbody>{drops.map((drop) => <tr key={drop.drop_id}><td><strong>#{drop.sequence_number}</strong><small>{dropTime(drop.effective_open_at)}</small></td><td><span className={`analytics-drop-status analytics-drop-status--${drop.effective_status}`}>{drop.effective_status}</span></td><td>{count(drop.claim_attempts)}<small>{count(drop.forming_attempts)} forming</small></td><td>{count(drop.successful_unlocks)}<small>{rate(drop.unlock_rate)}</small></td><td>{count(drop.cards_seen)}</td><td>{count(drop.completed_runs)}<small>{rate(drop.completion_rate)}</small></td><td>{count(drop.interests_sent)}<small>{count(drop.incoming_interests_opened)} opened</small></td><td>{count(drop.matches_created)}</td></tr>)}</tbody></table></div>}
  </section>;
}
