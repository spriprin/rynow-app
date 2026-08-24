/* eslint-disable @next/next/no-img-element -- remote sample portraits are part of the marketing preview. */

import { ArrowRight, Heart, MessageCircle, Radio, ScanLine, Sparkles, Users } from "lucide-react";

const steps = [
  ["01", "Scan the Room QR", "Join the event Room in seconds — no email or password for guests."],
  ["02", "See the Room come alive", "A limited Room Wall shows that real people are here without becoming a catalogue."],
  ["03", "Explore who’s here", "Explore works all evening with small, fair, server-selected batches — never a full catalogue."],
  ["04", "Send a limited Interest", "An adaptive Interest Budget makes every signal intentional and limits spam."],
  ["05", "Join Drop moments", "Optional scheduled Drops create synchronized bursts of fresh discovery without blocking Explore."],
  ["06", "Match, say hi and meet", "Interested Too creates a Match and opens realtime chat so both people can meet in the room."],
] as const;

export function ProductLanding() {
  return (
    <main className="current-landing">
      <nav className="current-landing__nav" aria-label="Main navigation">
        <a className="brand" href="#top" aria-label="HERE home">
          <span className="brand-mark"><Radio size={18} /></span>HERE<span className="brand-dot">.</span>
        </a>
        <div className="current-landing__nav-links">
          <a href="#how">How it works</a>
          <a href="#demo-or-real">Demo or real Room?</a>
        </div>
        <a className="button button--ghost button--small" href="/organizer?mode=signin">Organizer sign in</a>
      </nav>

      <section className="current-hero" id="top">
        <div className="current-hero__copy">
          <span className="eyebrow"><i className="live-pulse" />LIVE SOCIAL ROOMS</span>
          <h1>Real people.<br />Same place.<br /><em>Right now.</em></h1>
          <p>HERE turns one event QR into a focused path from a lively Room Wall to always-on curated Explore, a mutual Match and a real hello across the room.</p>
          <div className="button-row">
            <a className="button button--lime" href="/demo">Try the product demo <ArrowRight size={18} /></a>
            <a className="button button--ghost" href="/organizer?mode=signup">Create a Room</a>
          </div>
          <small><ScanLine size={16} /> Room QR and membership — no GPS tracking.</small>
        </div>

        <div className="current-hero__product" aria-label="HERE product flow preview">
          <div className="current-hero__wall">
            <div><span>ROOM WALL</span><strong>74 people here</strong></div>
            <div className="current-avatar-row" aria-hidden="true">
              {[
                "photo-1494790108377-be9c29b29330",
                "photo-1500648767791-00dcc994a43e",
                "photo-1524504388940-b1c1722653e1",
                "photo-1507003211169-0a1dd7228f2d",
                "photo-1534528741775-53994a69daeb",
              ].map((id) => <img key={id} src={`https://images.unsplash.com/${id}?auto=format&fit=crop&w=160&q=82`} alt="" />)}
            </div>
          </div>
          <article className="current-drop-card">
            <span>EXPLORE · 4 INTERESTS LEFT</span>
            <div className="current-drop-card__photo" role="img" aria-label="Sample Explore profile" />
            <div><strong>Sofia, 26</strong><small>Here tonight</small></div>
            <div className="current-drop-card__actions"><span>Next</span><b><Heart size={15} />Interested</b></div>
          </article>
          <div className="current-match-chip"><MessageCircle size={17} /><span><small>IT’S MUTUAL</small>Say hi. Meet here.</span></div>
        </div>
      </section>

      <section className="current-principles">
        <article><Users /><strong>Room Wall creates abundance.</strong></article>
        <article><Sparkles /><strong>Explore works all evening.</strong></article>
        <article><Heart /><strong>Drops create shared moments.</strong></article>
        <article><MessageCircle /><strong>Chat helps people meet IRL.</strong></article>
      </section>

      <section className="current-how" id="how">
        <header><span>THE CURRENT HERE FLOW</span><h2>Less browsing.<br />More meeting.</h2></header>
        <div className="current-steps">
          {steps.map(([number, title, copy]) => (
            <article key={number}><span>{number}</span><h3>{title}</h3><p>{copy}</p></article>
          ))}
        </div>
      </section>

      <section className="current-choice" id="demo-or-real">
        <header><span>CHOOSE YOUR PATH</span><h2>See the product, then make it real.</h2></header>
        <div>
          <article>
            <span>PRODUCT DEMO</span><h3>Walk through HERE now.</h3>
            <p>Sample people and interactions. No account, nothing saved to production.</p>
            <a className="button button--dark" href="/demo">Try the product demo <ArrowRight size={17} /></a>
          </article>
          <article>
            <span>REAL ROOM</span><h3>Bring HERE to your event.</h3>
            <p>Create a permanent organizer account, generate a real QR and welcome persistent anonymous participants.</p>
            <div className="button-row">
              <a className="button button--lime" href="/organizer?mode=signup">Create a Room</a>
              <a className="button button--ghost" href="/organizer?mode=signin">Organizer sign in</a>
            </div>
          </article>
        </div>
      </section>

      <footer><span className="brand">HERE<span className="brand-dot">.</span></span><p>Room Wall → Explore + Drops → Match → meet IRL.</p></footer>
    </main>
  );
}
