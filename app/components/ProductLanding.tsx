/* eslint-disable @next/next/no-img-element -- remote sample portraits are part of the marketing preview. */

import { ArrowRight, BarChart3, Heart, MessageCircle, Radio, ScanLine, ShieldCheck, Sparkles } from "lucide-react";

const organizerBenefits = [
  [Heart, "Make the first move easier", "Guests can find out whether interest is mutual before approaching someone."],
  [ScanLine, "Works inside your existing event", "One QR. No app installation. HERE adds a social layer without replacing the event itself."],
  [Sparkles, "Create moments of interaction", "Discovery stays available throughout the night. Optional Drops bring guests back for shared moments with fresh people to discover."],
  [BarChart3, "Understand engagement", "See aggregate participation, interest, match and conversation metrics — never private interests or messages."],
] as const;

const steps = [
  ["01", "Put the HERE QR at your event", "Create a Room and place the QR on screens, posters, tables or event materials."],
  ["02", "Guests join in seconds", "They open HERE in their browser, add a photo and first name, confirm they are 18+ and enter the Room. No download or email/password signup required."],
  ["03", "They discover people at the same event", "HERE shows small selections of real participants instead of a full attendee catalogue."],
  ["04", "Someone catches their attention", "They can privately show interest."],
  ["05", "Mutual interest creates a Match", "The other person can respond. If both are interested, they can message each other."],
  ["06", "They are already in the same place", "The point is to move from a Match to a real conversation at the event."],
] as const;

const privacyPoints = [
  "No full attendee list.",
  "An interest is visible only to the person who receives it.",
  "Organizers cannot see private interests or chat messages.",
  "Guests can block and report other participants.",
  "HERE uses the event Room — not GPS tracking — to establish who is at the event.",
] as const;

const analyticsMetrics = [
  "Guests joined",
  "People who explored",
  "Interests sent",
  "Response and acceptance rates",
  "Matches created",
  "Matches that started a conversation",
] as const;

export function ProductLanding() {
  return (
    <main className="current-landing">
      <nav className="current-landing__nav" aria-label="Main navigation">
        <a className="brand" href="#top" aria-label="HERE home">
          <span className="brand-mark"><Radio size={18} /></span>HERE<span className="brand-dot">.</span>
        </a>
        <div className="current-landing__nav-links">
          <a href="#why">Why HERE</a>
          <a href="#how">How it works</a>
          <a href="#privacy">Privacy</a>
        </div>
        <div className="current-landing__nav-actions">
          <a className="current-landing__demo-link" href="/demo">Guest demo <ArrowRight size={14} /></a>
          <a className="button button--ghost button--small" href="/organizer?mode=signin">Organizer sign in</a>
        </div>
      </nav>

      <section className="current-hero" id="top">
        <div className="current-hero__copy">
          <span className="eyebrow"><i className="live-pulse" />A SOCIAL LAYER FOR REAL-LIFE EVENTS</span>
          <h1>Real people.<br />Same place.<br /><em>Right now.</em></h1>
          <h2>Turn your event into a place where meeting someone new is easier.</h2>
          <p>Guests scan one QR, see a limited selection of people who are at the same event, show interest and match if it’s mutual — then meet in real life. No app download required.</p>
          <div className="button-row">
            <a className="button button--lime" href="/demo">Try the guest demo <ArrowRight size={18} /></a>
            <a className="button button--ghost" href="/organizer?mode=signup">Create a Room <ArrowRight size={18} /></a>
          </div>
          <small><ScanLine size={16} /> Demo starts with guest check-in · Browser-based · No GPS tracking</small>
        </div>

        <div className="current-hero__product" aria-label="HERE product flow preview">
          <div className="current-hero__wall">
            <div><span>AT THIS EVENT</span><strong>74 people joined</strong></div>
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
            <span>SOMEONE AT THIS EVENT</span>
            <div className="current-drop-card__photo" role="img" aria-label="Sample guest profile" />
            <div><strong>Sofia, 26</strong><small>Here tonight</small></div>
            <div className="current-drop-card__actions"><span>Next</span><b><Heart size={15} />Interested</b></div>
          </article>
          <div className="current-match-chip"><MessageCircle size={17} /><span><small>IT’S MUTUAL</small>Say hi. Meet here.</span></div>
        </div>
      </section>

      <section className="current-choice" id="demo-or-real">
        <header><span>SEE IT IN ACTION</span><h2>See the product, then make it real.</h2></header>
        <div>
          <article>
            <span>PRODUCT DEMO</span><h3>See how HERE feels as a guest.</h3>
            <p>Create a local demo profile, enter a sample Room and try Explore, Interests, Match, chat and safety controls. Nothing is saved to the real event system.</p>
            <a className="button button--dark" href="/demo">Start guest walkthrough <ArrowRight size={17} /></a>
          </article>
          <article>
            <span>FOR ORGANIZERS</span><h3>Create HERE for your event.</h3>
            <p>Create your event Room, get a QR code and invite real guests to join.</p>
            <div className="button-row">
              <a className="button button--lime" href="/organizer?mode=signup">Create a Room</a>
              <a className="button button--ghost" href="/organizer?mode=signin">Organizer sign in</a>
            </div>
          </article>
        </div>
      </section>

      <section className="current-value" id="why">
        <header>
          <span>WHY ORGANIZERS USE HERE</span>
          <h2>Give people another reason to connect at your event.</h2>
        </header>
        <div className="current-value__grid">
          {organizerBenefits.map(([Icon, title, copy]) => (
            <article key={title}><Icon /><h3>{title}</h3><p>{copy}</p></article>
          ))}
        </div>
      </section>

      <section className="current-how" id="how">
        <header><span>HOW HERE WORKS</span><h2>From one QR to a real conversation.</h2></header>
        <div className="current-steps">
          {steps.map(([number, title, copy]) => (
            <article key={number}><span>{number}</span><h3>{title}</h3><p>{copy}</p></article>
          ))}
        </div>
        <p className="current-how__note"><Sparkles size={17} /> Organizers can also schedule optional Drops — shared moments during the night when guests receive fresh people to discover. HERE works throughout the event without them.</p>
      </section>

      <section className="current-trust" id="privacy">
        <div className="current-trust__copy">
          <span>PRIVACY &amp; CONTROL</span>
          <ShieldCheck size={34} />
          <h2>Private by design.</h2>
          <p>HERE helps people connect without turning your event into a public attendee directory.</p>
        </div>
        <ul>
          {privacyPoints.map((point) => <li key={point}><span>✓</span>{point}</li>)}
        </ul>
      </section>

      <section className="current-analytics">
        <header>
          <span>FOR ORGANIZERS</span>
          <h2>See how people engaged.</h2>
          <p>After the event, your dashboard shows aggregate engagement across the Room.</p>
        </header>
        <div className="current-analytics__metrics">
          {analyticsMetrics.map((metric) => <div key={metric}><BarChart3 size={17} /><span>{metric}</span></div>)}
        </div>
        <p className="current-analytics__privacy"><ShieldCheck size={18} /> You see engagement, not private conversations or who liked whom.</p>
      </section>

      <footer><span className="brand">HERE<span className="brand-dot">.</span></span><p>A social layer for real-life events.</p></footer>
    </main>
  );
}
