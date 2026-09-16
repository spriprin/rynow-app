"use client";
/* eslint-disable @next/next/no-img-element -- private avatars use short-lived signed Storage URLs. */

import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Bell, Check, Heart, MessageCircle, Settings, ShieldCheck, Trash2, UserRound, X } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { IRL_ANSWERS } from "@/lib/rc1-state";
import type { RoomMatch } from "@/lib/types";

type ConnectionRow = {
  match_id: string; room_id: string; room_name: string; room_status: string; other_user_id: string;
  display_name: string; avatar_path: string; matched_at: string;
  last_message_at: string | null; last_message_body: string | null; unread_count: number;
  feedback_due: boolean; feedback_answer: string | null;
};
type Counts = { interest: number; match: number; message: number; total?: number };
const EMPTY_COUNTS: Counts = { interest: 0, match: 0, message: 0, total: 0 };

export function UserArea({ userId, roomId, onEditProfile, onOpenConnection }: {
  userId: string; roomId: string; onEditProfile: () => void; onOpenConnection: (connection: RoomMatch) => void;
}) {
  const [open, setOpen] = useState(false);
  const [connections, setConnections] = useState<Array<RoomMatch & { feedbackDue: boolean; feedbackAnswer: string | null }>>([]);
  const [counts, setCounts] = useState<Counts>(EMPTY_COUNTS);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(async () => {
    const client = getSupabaseBrowserClient();
    if (!client || !userId) return;
    const [connectionResult, notificationResult] = await Promise.all([
      client.rpc("user_connections"), client.rpc("notification_state"),
    ]);
    if (connectionResult.error) throw connectionResult.error;
    if (notificationResult.error) throw notificationResult.error;
    const rows = (connectionResult.data || []) as ConnectionRow[];
    const paths = [...new Set(rows.map((row) => row.avatar_path).filter(Boolean))];
    const signed = paths.length ? await client.storage.from("avatars").createSignedUrls(paths, 300) : { data: [], error: null };
    const urls = new Map((signed.data || []).map((item) => [item.path, item.signedUrl]));
    setConnections(rows.map((row) => ({
      id: row.match_id, roomId: row.room_id, roomName: row.room_name, roomStatus: row.room_status,
      otherUserId: row.other_user_id, displayName: row.display_name,
      avatarPath: row.avatar_path, avatarUrl: urls.get(row.avatar_path) || "",
      matchedAt: row.matched_at, lastMessageAt: row.last_message_at,
      lastMessageBody: row.last_message_body, unreadCount: Number(row.unread_count || 0),
      feedbackDue: Boolean(row.feedback_due), feedbackAnswer: row.feedback_answer,
    })));
    const state = (notificationResult.data || EMPTY_COUNTS) as Counts;
    setCounts({
      interest: Number(state.interest || 0), match: Number(state.match || 0),
      message: Number(state.message || 0), total: Number(state.total || 0),
    });
  }, [userId]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => {
      void load().catch(() => setStatus("Updates will retry automatically."));
    }, 0);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine) void load().catch(() => undefined);
    }, 15_000);
    const foreground = () => { if (document.visibilityState === "visible") void load().catch(() => undefined); };
    document.addEventListener("visibilitychange", foreground);
    return () => { window.clearTimeout(initialLoad); window.clearInterval(timer); document.removeEventListener("visibilitychange", foreground); };
  }, [load]);

  async function markRead(kind: "interest" | "match" | "message", matchId: string | null = null) {
    const client = getSupabaseBrowserClient();
    if (!client) return;
    await client.rpc("mark_notifications_read", { p_kind: kind, p_room_id: kind === "interest" ? roomId : null, p_match_id: matchId });
    await load();
  }

  async function answer(match: RoomMatch, answerValue: string) {
    const client = getSupabaseBrowserClient();
    if (!client) return;
    setBusy(true); setStatus("");
    const result = await client.rpc("record_match_irl_feedback", { p_match_id: match.id, p_answer: answerValue });
    if (result.error) setStatus("We couldn’t save that answer. Please try again.");
    else { setStatus("Thanks — your answer is private."); await load(); }
    setBusy(false);
  }

  async function requestDeletion() {
    const client = getSupabaseBrowserClient();
    if (!client) return;
    setBusy(true); setStatus("");
    const result = await client.rpc("request_my_data_deletion");
    setStatus(result.error ? "We couldn’t create the deletion request. Please try again." : "Deletion request recorded. Data is not erased automatically while the shared-data policy is under review.");
    setConfirmDelete(false); setBusy(false);
  }

  const total = counts.interest + counts.match + counts.message;
  const due = connections.find((connection) => connection.feedbackDue);
  return <>
    <button className="user-area-trigger" type="button" onClick={() => setOpen(true)}
      aria-label={"Open profile and connections" + (total ? ", " + total + " new updates" : "")}>
      <UserRound size={17} /><span>Profile</span>{total > 0 && <i>{total > 99 ? "99+" : total}</i>}
    </button>
    {open && <div className="user-area-backdrop" role="dialog" aria-modal="true" aria-label="Your profile and connections">
      <section className="user-area-panel">
        <header><div><span className="eyebrow">YOUR AREA</span><h2>Profile &amp; Connections</h2></div><button className="icon-button" onClick={() => setOpen(false)} aria-label="Close"><X /></button></header>
        <button className="user-area-edit" onClick={() => { setOpen(false); onEditProfile(); }}><UserRound /><span><strong>Your profile</strong><small>Edit name, photo and preferences</small></span><ArrowRight /></button>
        <section className="user-notifications">
          <div><Bell /><strong>Updates</strong></div>
          <button onClick={() => void markRead("interest")}><Heart />Incoming Interests <i>{counts.interest}</i></button>
          <button onClick={() => void markRead("match")}><Check />New Matches <i>{counts.match}</i></button>
          <button onClick={() => void markRead("message")}><MessageCircle />New messages <i>{counts.message}</i></button>
        </section>
        {due && <section className="irl-feedback">
          <span className="eyebrow">AFTER THE EVENT</span><h3>Did you meet {due.displayName} in person?</h3>
          <p>Your answer stays private from {due.displayName}. Organizers receive totals only.</p>
          <div>{IRL_ANSWERS.map((answerOption) => <button disabled={busy} key={answerOption.value} onClick={() => void answer(due, answerOption.value)}>{answerOption.label}</button>)}</div>
        </section>}
        {connections.length > 0 && <section className="user-connections">
          <div><MessageCircle /><strong>Connections</strong><small>{connections.length}</small></div>
          {connections.map((connection) => <button key={connection.id} onClick={() => {
            setOpen(false); void markRead("message", connection.id); onOpenConnection(connection);
          }}>
            {connection.avatarUrl ? <img src={connection.avatarUrl} alt="" /> : <span>{connection.displayName.slice(0, 1)}</span>}
            <div><strong>{connection.displayName}</strong><small>{connection.roomName}</small><p>{connection.lastMessageBody || "Open chat"}</p></div>
            {connection.unreadCount > 0 && <i>{connection.unreadCount}</i>}<ArrowRight />
          </button>)}
        </section>}
        <section className="user-settings">
          <div><Settings /><strong>Settings</strong></div>
          <p><a href="/privacy" target="_blank">Draft Privacy Policy</a><a href="/terms" target="_blank">Draft Terms</a></p>
          {!confirmDelete ? <button className="delete-data-trigger" onClick={() => setConfirmDelete(true)}><Trash2 />Delete my data</button>
            : <div className="delete-data-confirm"><ShieldCheck /><p>This records a deletion request for review. Shared chats and safety evidence are not blindly erased.</p><button disabled={busy} onClick={() => void requestDeletion()}>Confirm request</button><button disabled={busy} onClick={() => setConfirmDelete(false)}>Cancel</button></div>}
        </section>
        {status && <p className="user-area-status" role="status">{status}</p>}
      </section>
    </div>}
  </>;
}
