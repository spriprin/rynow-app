"use client";
/* eslint-disable @next/next/no-img-element -- remote sample portraits are part of the isolated product demo. */

import { useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Clock3, Flag, Heart, MessageCircle, MoreHorizontal, Radio, Send, Shield, Sparkles, Users, X } from "lucide-react";

type DemoView = "room" | "explore" | "drop" | "incoming" | "match" | "chat";
type SafetyMode = "menu" | "report" | null;

const photo = (id: string) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=900&q=86`;
const wallPeople = [
  ["Sofia", "photo-1494790108377-be9c29b29330"],
  ["Noah", "photo-1500648767791-00dcc994a43e"],
  ["Elena", "photo-1524504388940-b1c1722653e1"],
  ["Leo", "photo-1507003211169-0a1dd7228f2d"],
  ["Amelia", "photo-1534528741775-53994a69daeb"],
  ["Martin", "photo-1539571696357-5a69c17a67c6"],
  ["Nina", "photo-1531123897727-8f129e1688ce"],
  ["Oskar", "photo-1506794778202-cad84cf45f1d"],
] as const;

const dropPeople = [
  { name: "Sofia", age: 26, image: photo("photo-1494790108377-be9c29b29330"), bio: "New in Riga. Live music, long dinners and spontaneous dancing." },
  { name: "Noah", age: 28, image: photo("photo-1500648767791-00dcc994a43e"), bio: "Product designer, vinyl collector and always close to the dance floor." },
  { name: "Elena", age: 29, image: photo("photo-1524504388940-b1c1722653e1"), bio: "Photographer, curious human and enthusiastic beginner at almost everything." },
  { name: "Leo", age: 30, image: photo("photo-1507003211169-0a1dd7228f2d"), bio: "Architect by day, amateur DJ after dark." },
] as const;

const initialMessages = [
  { id: 1, mine: false, body: "Hey! I’m near the terrace bar 👋", time: "22:41" },
  { id: 2, mine: true, body: "I’m by the neon installation. Want to say hi?", time: "22:42" },
  { id: 3, mine: false, body: "Perfect — coming over in two minutes.", time: "22:42" },
];

export function CurrentProductDemo() {
  const [view, setView] = useState<DemoView>("room");
  const [dropIndex, setDropIndex] = useState(0);
  const [budget, setBudget] = useState(4);
  const [toast, setToast] = useState("");
  const [messages, setMessages] = useState(initialMessages);
  const [safetyMode, setSafetyMode] = useState<SafetyMode>(null);
  const person = dropPeople[dropIndex % dropPeople.length];

  function flash(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2400);
  }

  function nextProfile() {
    setDropIndex((current) => (current + 1) % dropPeople.length);
  }

  function sendInterest() {
    if (budget === 0) return flash(`No Interests left in this ${view === "drop" ? "Drop" : "Explore batch"}`);
    setBudget((current) => current - 1);
    flash(`Interest sent to ${person.name}`);
    nextProfile();
  }

  function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = String(form.get("message") || "").trim();
    if (!body) return;
    setMessages((current) => [...current, { id: Date.now(), mine: true, body, time: "now" }]);
    event.currentTarget.reset();
  }

  function mockSafety(action: string) {
    setSafetyMode(null);
    setView("room");
    flash(`${action} recorded for this demo only`);
  }

  return (
    <main className="product-demo">
      <header className="product-demo__header">
        <button className="brand brand--button" onClick={() => setView("room")}><span className="brand-mark"><Radio size={17} /></span>HERE<span className="brand-dot">.</span></button>
        <div><i className="live-pulse" /><span>FRIDAY SOCIAL · LIVE</span></div>
        <a href="/organizer?mode=signup">Create a real Room <ArrowRight size={15} /></a>
      </header>

      {view === "room" && <RoomWall onExplore={() => setView("explore")} onDrop={() => setView("drop")} onIncoming={() => setView("incoming")} onMatch={() => setView("match")} />}
      {(view === "explore" || view === "drop") && <section className="demo-drop-view"><DemoBack onClick={() => setView("room")} label="Back to Room" /><div className="demo-drop-heading"><div><span>{view === "drop" ? "DROP LIVE" : "EXPLORE · ALL EVENING"}</span><h1>{view === "drop" ? "Your Drop" : "See who’s here"}</h1><p>One profile at a time. This server-selected set is limited and persists after refresh.</p></div><strong><Heart size={16} />Adaptive Interest Budget · {budget} Interests left</strong></div><article className="demo-profile-card"><img src={person.image} alt={`${person.name}, sample profile`} /><div className="demo-profile-card__copy"><span>HERE TONIGHT</span><h2>{person.name}, {person.age}</h2><p>{person.bio}</p></div><div className="demo-profile-card__actions"><button className="button button--ghost" onClick={nextProfile}>Next</button><button className="button button--lime" onClick={sendInterest} disabled={budget === 0}><Heart size={17} />Interested</button></div></article><div className="demo-drop-progress" aria-label={`Profile ${dropIndex + 1} of ${dropPeople.length}`}>{dropPeople.map((item, index) => <i key={item.name} className={index === dropIndex ? "active" : ""} />)}</div></section>}

      {view === "incoming" && <section className="demo-incoming-view"><DemoBack onClick={() => setView("room")} label="Back to Room" /><div className="demo-section-title"><span>INTERESTED IN YOU</span><h1>Sofia wants to meet.</h1><p>The sender is visible. This is your decision — no guessing.</p></div><article className="demo-incoming-card"><img src={dropPeople[0].image} alt="Sofia, sample incoming Interest" /><div><span>HERE TONIGHT</span><h2>Sofia, 26</h2><p>{dropPeople[0].bio}</p><div><button className="button button--ghost" onClick={() => { setView("room"); flash("Not for me — no Match created"); }}><X size={17} />Not for me</button><button className="button button--lime" onClick={() => setView("match")}><Heart size={17} />Interested Too</button></div></div></article></section>}

      {view === "match" && <section className="demo-match-view"><div className="demo-match-avatars"><img src={photo("photo-1531123897727-8f129e1688ce")} alt="Your sample profile" /><img src={dropPeople[0].image} alt="Sofia" /></div><span>IT’S MUTUAL</span><h1>You’re both here<br />right now.</h1><p>Chat just enough to find each other — then meet in the room.</p><div className="button-row"><button className="button button--lime" onClick={() => setView("chat")}><MessageCircle size={17} />Message Sofia</button><button className="button button--ghost" onClick={() => setView("room")}>Back to Room</button></div></section>}

      {view === "chat" && <section className="demo-chat-view"><header><DemoBack onClick={() => setView("match")} label="Match" /><div><img src={dropPeople[0].image} alt="Sofia" /><span><strong>Sofia</strong><small>Both at Friday Social</small></span></div><button className="icon-button" onClick={() => setSafetyMode("menu")} aria-label="Safety options"><MoreHorizontal /></button></header><div className="demo-chat-context"><Sparkles size={15} />You matched here tonight. Say where you are and meet in person.</div><div className="demo-messages">{messages.map((message) => <article key={message.id} className={message.mine ? "mine" : "theirs"}><p>{message.body}</p><small>{message.time}</small></article>)}</div><form onSubmit={sendMessage}><input name="message" aria-label="Message Sofia" placeholder="Write a message…" autoComplete="off" /><button type="submit" aria-label="Send message"><Send size={17} /></button></form></section>}

      {safetyMode && <div className="demo-safety" role="dialog" aria-modal="true" aria-label="Safety options"><section><button className="icon-button" onClick={() => setSafetyMode(null)} aria-label="Close safety options"><X /></button>{safetyMode === "menu" ? <><Shield /><span>SAFETY</span><h2>You’re in control.</h2><p>These demo actions mirror the privacy boundaries in a real Room.</p><button onClick={() => mockSafety("Block")}><Shield size={17} />Block Sofia</button><button onClick={() => setSafetyMode("report")}><Flag size={17} />Report</button><button className="danger" onClick={() => mockSafety("Report and Block")}><Flag size={17} />Report and Block</button></> : <><Flag /><span>REPORT</span><h2>What happened?</h2><p>No report leaves this isolated demo.</p>{["Harassment", "Fake profile", "Inappropriate behavior", "Spam", "Safety concern"].map((reason) => <button key={reason} onClick={() => mockSafety(`Report: ${reason}`)}>{reason}<ArrowRight size={15} /></button>)}</>}</section></div>}

      <aside className="product-demo__notice"><div><strong>Product demo</strong><span>Sample people and interactions only. No account. Nothing is written to production.</span></div><a href="/organizer?mode=signup">Create a real Room & QR</a></aside>
      {toast && <div className="toast">{toast}</div>}
    </main>
  );
}

function DemoBack({ onClick, label }: { onClick: () => void; label: string }) {
  return <button className="back-link demo-back" onClick={onClick}><ArrowLeft size={17} />{label}</button>;
}

function RoomWall({ onExplore, onDrop, onIncoming, onMatch }: { onExplore: () => void; onDrop: () => void; onIncoming: () => void; onMatch: () => void }) {
  return <section className="demo-room"><div className="demo-room__heading"><span>HERE TONIGHT</span><h1>Friday Social</h1><p>Lumen Club · Riga</p></div><section className="demo-room-wall"><header><div><span>ROOM WALL</span><h2>74 people here</h2></div><Users /></header><div className="demo-wall-sample" aria-label="Limited non-clickable sample of people in this Room">{wallPeople.map(([name, id]) => <figure key={name}><img src={photo(id)} alt={`${name}, sample Room participant`} /><figcaption>{name}</figcaption></figure>)}</div><small>Limited sample · Room Wall is not a people catalogue</small></section><article className="demo-next-drop demo-explore"><span>EXPLORE · ALL EVENING</span><Users /><strong>See who’s here</strong><p>Open a small, fair selection now. It is never a full people catalogue.</p><button className="button button--dark" onClick={onExplore}>Explore now <ArrowRight size={17} /></button></article><div className="demo-room-grid"><article className="demo-next-drop"><span>NEXT DROP</span><Clock3 /><strong>08:42</strong><p>Drops are optional synchronized bursts of fresh discovery.</p><button className="button button--lime" onClick={onDrop}>Preview Drop <ArrowRight size={17} /></button></article><div><button className="demo-room-link" onClick={onIncoming}><span><Heart /><i>1</i></span><strong>Interested in You</strong><small>See who sent it</small><ArrowRight /></button><button className="demo-room-link" onClick={onMatch}><span><MessageCircle /></span><strong>Matches</strong><small>1 active connection</small><ArrowRight /></button></div></div></section>;
}
