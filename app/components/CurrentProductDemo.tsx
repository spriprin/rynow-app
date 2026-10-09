"use client";
/* eslint-disable @next/next/no-img-element -- remote sample portraits and a device-local preview are part of the isolated product demo. */

import { useState, type ChangeEvent, type FormEvent } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  Flag,
  Heart,
  ImagePlus,
  MessageCircle,
  MoreHorizontal,
  Radio,
  ScanLine,
  Send,
  Shield,
  ShieldCheck,
  Sparkles,
  UserRound,
  Users,
  X,
} from "lucide-react";

type DemoView = "room" | "profile" | "explore" | "incoming" | "match" | "chat";
type DemoStep = 1 | 2 | 3 | 4;
type DemoGender = "male" | "female" | "prefer_not_to_say";
type DemoPreference = "female" | "male" | "everyone";
type SafetyMode = "menu" | "report" | null;

const photo = (id: string) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=900&q=86`;
const demoAvatar = photo("photo-1531123897727-8f129e1688ce");
const wallPeople = [
  ["Sofia", "photo-1494790108377-be9c29b29330"],
  ["Noah", "photo-1500648767791-00dcc994a43e"],
  ["Elena", "photo-1524504388940-b1c1722653e1"],
  ["Leo", "photo-1507003211169-0a1dd7228f2d"],
  ["Amelia", "photo-1534528741775-53994a69daeb"],
  ["Martin", "photo-1539571696357-5a69c17a67c6"],
  ["Oskar", "photo-1506794778202-cad84cf45f1d"],
] as const;

const explorePeople = [
  { name: "Sofia", age: 26, image: photo("photo-1494790108377-be9c29b29330"), bio: "New in Riga. Live music, long dinners and spontaneous dancing." },
  { name: "Noah", age: 28, image: photo("photo-1500648767791-00dcc994a43e"), bio: "Product designer, vinyl collector and always close to the dance floor." },
  { name: "Elena", age: 29, image: photo("photo-1524504388940-b1c1722653e1"), bio: "Photographer, curious human and enthusiastic beginner at almost everything." },
  { name: "Leo", age: 30, image: photo("photo-1507003211169-0a1dd7228f2d"), bio: "Architect by day, amateur DJ after dark." },
] as const;

const genderOptions: Array<{ value: DemoGender; label: string }> = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
];

const preferenceOptions: Array<{ value: DemoPreference; label: string }> = [
  { value: "female", label: "Women" },
  { value: "male", label: "Men" },
  { value: "everyone", label: "Everyone" },
];

const initialMessages = [
  { id: 1, mine: false, body: "Hey! I’m near the terrace bar 👋", time: "22:41" },
  { id: 2, mine: true, body: "I’m by the neon installation. Want to say hi?", time: "22:42" },
  { id: 3, mine: false, body: "Perfect — coming over in two minutes.", time: "22:42" },
];

function defaultPreference(gender: DemoGender): DemoPreference {
  if (gender === "male") return "female";
  if (gender === "female") return "male";
  return "everyone";
}

export function CurrentProductDemo() {
  const [registered, setRegistered] = useState(false);
  const [step, setStep] = useState<DemoStep>(1);
  const [displayName, setDisplayName] = useState("");
  const [avatar, setAvatar] = useState("");
  const [gender, setGender] = useState<DemoGender | "">("");
  const [preference, setPreference] = useState<DemoPreference | "">("");
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const [view, setView] = useState<DemoView>("room");
  const [exploreIndex, setExploreIndex] = useState(0);
  const [hasMatch, setHasMatch] = useState(false);
  const [toast, setToast] = useState("");
  const [messages, setMessages] = useState(initialMessages);
  const [safetyMode, setSafetyMode] = useState<SafetyMode>(null);
  const person = explorePeople[exploreIndex] || null;
  const name = displayName.trim() || "Guest";

  function flash(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2400);
  }

  function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setPhotoError("Choose an image from your camera or gallery.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setPhotoError("Photo must be smaller than 5 MB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setAvatar(reader.result);
        setPhotoError("");
      }
    };
    reader.onerror = () => setPhotoError("That photo could not be opened. Try another one.");
    reader.readAsDataURL(file);
  }

  function chooseGender(nextGender: DemoGender) {
    setGender(nextGender);
    setPreference(defaultPreference(nextGender));
  }

  function finishRegistration() {
    if (!avatar || displayName.trim().length < 2 || !gender || !preference || !ageConfirmed || !legalAccepted) return;
    setRegistered(true);
    setView("room");
    flash(`Welcome to Friday Social, ${displayName.trim()}`);
  }

  function restartDemo() {
    setRegistered(false);
    setStep(1);
    setDisplayName("");
    setAvatar("");
    setGender("");
    setPreference("");
    setAgeConfirmed(false);
    setLegalAccepted(false);
    setPhotoError("");
    setView("room");
    setExploreIndex(0);
    setMessages(initialMessages);
    setHasMatch(false);
    setSafetyMode(null);
    setToast("");
  }

  function nextProfile() {
    setExploreIndex((current) => Math.min(current + 1, explorePeople.length));
  }

  function sendInterest() {
    if (!person) return;
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

  if (!registered) {
    return (
      <main className="product-demo product-demo--registration">
        <DemoHeader />
        <DemoRegistration
          step={step}
          setStep={setStep}
          displayName={displayName}
          setDisplayName={setDisplayName}
          avatar={avatar}
          useSamplePhoto={() => { setAvatar(demoAvatar); setPhotoError(""); }}
          photoError={photoError}
          choosePhoto={choosePhoto}
          gender={gender}
          chooseGender={chooseGender}
          preference={preference}
          ageConfirmed={ageConfirmed}
          setAgeConfirmed={setAgeConfirmed}
          legalAccepted={legalAccepted}
          setLegalAccepted={setLegalAccepted}
          finishRegistration={finishRegistration}
        />
        <DemoNotice onRestart={restartDemo} showRestart={false} />
        {toast && <div className="toast">{toast}</div>}
      </main>
    );
  }

  return (
    <main className="product-demo">
      <DemoHeader name={name} avatar={avatar} onProfile={() => setView("profile")} onRoom={() => setView("room")} />

      {view === "room" && (
        <RoomWall
          name={name}
          avatar={avatar}
          onProfile={() => setView("profile")}
          onExplore={() => setView("explore")}
          onIncoming={() => setView("incoming")}
          hasMatch={hasMatch}
          onMatch={() => setView("match")}
        />
      )}

      {view === "profile" && (
        <section className="demo-profile-settings">
          <DemoBack onClick={() => setView("room")} label="Back to Room" />
          <div className="demo-section-title">
            <span>YOUR DEMO PROFILE</span>
            <h1>Make it yours.</h1>
            <p>These changes stay inside this demo and disappear when the page reloads.</p>
          </div>
          <div className="demo-profile-settings__form">
            <label className={`demo-photo-picker ${avatar ? "has-photo" : ""}`}>
              <span style={avatar ? { backgroundImage: `url(${avatar})` } : undefined}>{avatar ? <Camera /> : <ImagePlus />}</span>
              <strong>Change photo</strong>
              <small>Camera or gallery · maximum 5 MB</small>
              <input className="demo-file-input" type="file" accept="image/*" onChange={choosePhoto} />
            </label>
            <label>First name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} minLength={2} maxLength={50} /></label>
            <DemoChoices name="demo-profile-gender" label="Gender" value={gender} options={genderOptions} onChange={chooseGender} />
            <DemoChoices name="demo-profile-preference" label="Show me" value={preference} options={preferenceOptions} onChange={setPreference} />
            {photoError && <p className="form-error" role="alert">{photoError}</p>}
            <button className="button button--lime button--wide" disabled={!avatar || displayName.trim().length < 2 || !gender || !preference} onClick={() => { setView("room"); flash("Demo profile updated"); }}>Save changes <Check size={18} /></button>
            <small className="foundation-privacy"><ShieldCheck size={14} />No profile data is sent to production.</small>
          </div>
          {hasMatch && <section className="demo-profile-connections"><span className="eyebrow">CONNECTIONS</span><button onClick={() => setView("chat")}><img src={explorePeople[0].image} alt="" /><span><strong>Sofia</strong><small>Friday Social · Open chat</small></span><ArrowRight /></button></section>}
        </section>
      )}

      {view === "explore" && (
        <section className="demo-explore-view">
          <DemoBack onClick={() => setView("room")} label="Back to Room" />
          <div className="demo-explore-heading">
            <div>
              <span>EXPLORE · ALL EVENING</span>
              <h1>See who’s here</h1>
              <p>One profile at a time. This sample selection is limited, just like the live product.</p>
            </div>
          </div>
          {person ? <><article className="demo-profile-card">
            <img src={person.image} alt={person.name + ", sample profile"} />
            <div className="demo-profile-card__copy"><span>AT THIS EVENT</span><h2>{person.name}, {person.age}</h2><p>{person.bio}</p></div>
            <div className="demo-profile-card__actions">
              <button className="button button--ghost" onClick={nextProfile}>Next</button>
              <button className="button button--lime" onClick={sendInterest}><Heart size={17} />Interested</button>
            </div>
          </article>
          <div className="demo-explore-progress" aria-label={"Profile " + (exploreIndex + 1) + " of " + explorePeople.length}>{explorePeople.map((item, index) => <i key={item.name} className={index === exploreIndex ? "active" : ""} />)}</div></>
          : <article className="demo-caught-up"><Users /><h2>You’ve seen everyone available right now.</h2><p>New people will appear here as they join the event.</p><button className="button button--ghost" onClick={() => setView("room")}>Back to Room</button></article>}
        </section>
      )}

      {view === "incoming" && (
        <section className="demo-incoming-view">
          <DemoBack onClick={() => setView("room")} label="Back to Room" />
          <div className="demo-section-title"><span>INTERESTED IN YOU</span><h1>Sofia wants to meet.</h1><p>The sender is visible. This is your decision — no guessing.</p></div>
          <article className="demo-incoming-card">
            <img src={explorePeople[0].image} alt="Sofia, sample incoming Interest" />
            <div><span>AT THIS EVENT</span><h2>Sofia, 26</h2><p>{explorePeople[0].bio}</p><div><button className="button button--ghost" onClick={() => { setView("room"); flash("Not for me — no Match created"); }}><X size={17} />Not for me</button><button className="button button--lime" onClick={() => { setHasMatch(true); setView("match"); }}><Heart size={17} />Interested Too</button></div></div>
          </article>
        </section>
      )}

      {view === "match" && (
        <section className="demo-match-view">
          <div className="demo-match-avatars"><img src={avatar} alt={`${name}, your demo profile`} /><img src={explorePeople[0].image} alt="Sofia" /></div>
          <span>IT’S MUTUAL</span><h1>You’re both here<br />right now.</h1><p>Chat just enough to find each other — then meet in the room.</p>
          <div className="button-row"><button className="button button--lime" onClick={() => setView("chat")}><MessageCircle size={17} />Message Sofia</button><button className="button button--ghost" onClick={() => setView("room")}>Back to Room</button></div>
        </section>
      )}

      {view === "chat" && (
        <section className="demo-chat-view">
          <header><DemoBack onClick={() => setView("match")} label="Match" /><div><img src={explorePeople[0].image} alt="Sofia" /><span><strong>Sofia</strong><small>Both at Friday Social</small></span></div><button className="icon-button" onClick={() => setSafetyMode("menu")} aria-label="Safety options"><MoreHorizontal /></button></header>
          <div className="demo-chat-context"><Sparkles size={15} />You matched here tonight. Say where you are and meet in person.</div>
          <div className="demo-messages">{messages.map((message) => <article key={message.id} className={message.mine ? "mine" : "theirs"}><p>{message.body}</p><small>{message.time}</small></article>)}</div>
          <form onSubmit={sendMessage}><input name="message" aria-label="Message Sofia" placeholder="Write a message…" autoComplete="off" /><button type="submit" aria-label="Send message"><Send size={17} /></button></form>
        </section>
      )}

      {safetyMode && (
        <div className="demo-safety" role="dialog" aria-modal="true" aria-label="Safety options">
          <section>
            <button className="icon-button" onClick={() => setSafetyMode(null)} aria-label="Close safety options"><X /></button>
            {safetyMode === "menu" ? <><Shield /><span>SAFETY</span><h2>You’re in control.</h2><p>These demo actions mirror the privacy boundaries in a real Room.</p><button onClick={() => mockSafety("Block")}><Shield size={17} />Block Sofia</button><button onClick={() => setSafetyMode("report")}><Flag size={17} />Report</button><button className="danger" onClick={() => mockSafety("Report and Block")}><Flag size={17} />Report and Block</button></> : <><Flag /><span>REPORT</span><h2>What happened?</h2><p>No report leaves this isolated demo.</p>{["Harassment / inappropriate behaviour", "Spam", "Fake profile / impersonation", "Inappropriate profile/content", "Safety concern", "Other"].map((reason) => <button key={reason} onClick={() => mockSafety(`Report: ${reason}`)}>{reason}<ArrowRight size={15} /></button>)}</>}
          </section>
        </div>
      )}

      <DemoNotice onRestart={restartDemo} showRestart />
      {toast && <div className="toast">{toast}</div>}
    </main>
  );
}

function DemoHeader({ name, avatar, onProfile, onRoom }: { name?: string; avatar?: string; onProfile?: () => void; onRoom?: () => void }) {
  return (
    <header className="product-demo__header">
      {onRoom ? <button className="brand brand--button" onClick={onRoom}><span className="brand-mark"><Radio size={17} /></span>RYNOW<span className="brand-dot">.</span></button> : <Link className="brand" href="/"><span className="brand-mark"><Radio size={17} /></span>RYNOW<span className="brand-dot">.</span></Link>}
      <div><i className="live-pulse" /><span>FRIDAY SOCIAL · DEMO</span></div>
      {onProfile && avatar ? <button className="demo-profile-trigger" onClick={onProfile} aria-label="Edit demo profile"><img src={avatar} alt="" /><span>{name}</span><UserRound size={15} /></button> : <Link href="/">Back to website <ArrowRight size={15} /></Link>}
    </header>
  );
}

function DemoRegistration({ step, setStep, displayName, setDisplayName, avatar, useSamplePhoto, photoError, choosePhoto, gender, chooseGender, preference, ageConfirmed, setAgeConfirmed, legalAccepted, setLegalAccepted, finishRegistration }: {
  step: DemoStep;
  setStep: (step: DemoStep) => void;
  displayName: string;
  setDisplayName: (name: string) => void;
  avatar: string;
  useSamplePhoto: () => void;
  photoError: string;
  choosePhoto: (event: ChangeEvent<HTMLInputElement>) => void;
  gender: DemoGender | "";
  chooseGender: (gender: DemoGender) => void;
  preference: DemoPreference | "";
  ageConfirmed: boolean;
  setAgeConfirmed: (confirmed: boolean) => void;
  legalAccepted: boolean;
  setLegalAccepted: (accepted: boolean) => void;
  finishRegistration: () => void;
}) {
  const preferenceLabel = preferenceOptions.find((option) => option.value === preference)?.label;

  return (
    <section className="demo-registration">
      <aside className="demo-registration__event">
        <span className="eyebrow"><ScanLine size={16} />SIMULATED QR ENTRY</span>
        <div><small>YOU’RE JOINING</small><h1>Friday<br />Social.</h1><p>Lumen Club · Riga</p></div>
        <ul aria-label="Guest entry flow">
          <li className="done"><Check size={15} /><span><strong>Room link opened</strong><small>The QR takes guests straight here.</small></span></li>
          <li className="done"><Check size={15} /><span><strong>Guest session</strong><small>Simulated instantly — no email or password.</small></span></li>
          <li className={step === 4 ? "done" : "active"}><UserRound size={15} /><span><strong>Create your profile</strong><small>Photo, first name and one safety check.</small></span></li>
          <li><ArrowRight size={15} /><span><strong>Enter the Room</strong><small>Explore the complete guest demo.</small></span></li>
        </ul>
        <p className="demo-registration__privacy"><ShieldCheck size={16} />Demo data stays on this page and never reaches the live event system.</p>
      </aside>

      <section className="demo-registration__form">
        <div className="foundation-progress" aria-label={`Registration step ${step} of 4`}><i className={step >= 1 ? "active" : ""} /><i className={step >= 2 ? "active" : ""} /><i className={step >= 3 ? "active" : ""} /><i className={step >= 4 ? "active" : ""} /></div>

        {step === 1 && <>
          <span className="eyebrow">STEP 1 OF 4</span><h2>Add your photo.</h2><p>Use your camera or choose a photo from the gallery. For privacy, you can use a sample instead.</p>
          <label className={`demo-photo-picker ${avatar ? "has-photo" : ""}`}>
            <span style={avatar ? { backgroundImage: `url(${avatar})` } : undefined}>{avatar ? <Check /> : <ImagePlus />}</span>
            <strong>{avatar ? "Photo ready" : "Camera or gallery"}</strong>
            <small>Required · image file · maximum 5 MB</small>
            <input className="demo-file-input" type="file" accept="image/*" onChange={choosePhoto} />
          </label>
          <button type="button" className="demo-sample-photo" onClick={useSamplePhoto}><Camera size={16} />Use a sample photo</button>
          {photoError && <p className="form-error" role="alert">{photoError}</p>}
          <button className="button button--lime button--wide" disabled={!avatar} onClick={() => setStep(2)}>Continue <ArrowRight size={18} /></button>
        </>}

        {step === 2 && <>
          <DemoBack onClick={() => setStep(1)} label="Back" />
          <span className="eyebrow">STEP 2 OF 4</span><h2>What’s your name?</h2><p>This is what people in the Room will see.</p>
          <label>First name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} minLength={2} maxLength={50} placeholder="Anna" autoComplete="given-name" /></label>
          <button className="button button--lime button--wide" disabled={displayName.trim().length < 2} onClick={() => setStep(3)}>Continue <ArrowRight size={18} /></button>
        </>}

        {step === 3 && <>
          <DemoBack onClick={() => setStep(2)} label="Back" />
          <span className="eyebrow">STEP 3 OF 4</span><h2>How do you identify?</h2><p>This creates a simple starting preference. Organizers never receive your individual answer.</p>
          <DemoChoices name="demo-registration-gender" label="Gender" value={gender} options={genderOptions} onChange={chooseGender} />
          {preferenceLabel && <p className="demo-registration__preference"><Sparkles size={16} /><span><strong>Starting “Show me” preference: {preferenceLabel}</strong><small>You can change this from your demo profile after joining.</small></span></p>}
          <button className="button button--lime button--wide" disabled={!gender} onClick={() => setStep(4)}>Continue <ArrowRight size={18} /></button>
        </>}

        {step === 4 && <>
          <DemoBack onClick={() => setStep(3)} label="Back" />
          <span className="eyebrow">STEP 4 OF 4</span><h2>One last check.</h2><p>RYNOW is currently available only to adults.</p>
          <label className="foundation-age-check"><input type="checkbox" checked={ageConfirmed} onChange={(event) => setAgeConfirmed(event.target.checked)} /><span><Check size={18} /></span><strong>I am 18 or older</strong></label>
          <label className="foundation-age-check"><input type="checkbox" checked={legalAccepted} onChange={(event) => setLegalAccepted(event.target.checked)} /><span><Check size={18} /></span><strong>I accept the <Link href="/terms" target="_blank">Draft Terms</Link> and acknowledge the <Link href="/privacy" target="_blank">Draft Privacy Policy</Link>.</strong></label>
          <button className="button button--lime button--wide" disabled={!ageConfirmed || !legalAccepted} onClick={finishRegistration}>Enter the demo Room <ArrowRight size={18} /></button>
          <small className="foundation-privacy"><ShieldCheck size={14} />No real account is created. Reload to reset the demo.</small>
        </>}
      </section>
    </section>
  );
}

function DemoChoices<T extends string>({ name, label, value, options, onChange }: { name: string; label: string; value: T | ""; options: Array<{ value: T; label: string }>; onChange: (value: T) => void }) {
  return (
    <fieldset className="profile-choice-group">
      <legend>{label}</legend>
      <div>{options.map((option) => <label key={option.value} className={value === option.value ? "selected" : ""}><input type="radio" name={name} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} /><span>{option.label}</span><Check size={16} /></label>)}</div>
    </fieldset>
  );
}

function DemoNotice({ onRestart, showRestart }: { onRestart: () => void; showRestart: boolean }) {
  return (
    <aside className="product-demo__notice">
      <div><strong>Product demo</strong><span>Sample people and interactions only. Nothing is written to production.</span></div>
      <div className="product-demo__notice-actions">
        {showRestart && <button type="button" onClick={onRestart}>Restart demo</button>}
        <a href="/organizer?mode=signup">Create a real Room &amp; QR</a>
      </div>
    </aside>
  );
}

function DemoBack({ onClick, label }: { onClick: () => void; label: string }) {
  return <button className="back-link demo-back" onClick={onClick}><ArrowLeft size={17} />{label}</button>;
}

function RoomWall({ name, avatar, onProfile, onExplore, onIncoming, hasMatch, onMatch }: { name: string; avatar: string; onProfile: () => void; onExplore: () => void; onIncoming: () => void; hasMatch: boolean; onMatch: () => void }) {
  return (
    <section className="demo-room">
      <div className="demo-room__heading"><span>AT THIS EVENT</span><h1>Friday Social</h1><p>Lumen Club · Riga</p></div>
      <button className="demo-own-profile" onClick={onProfile}><img src={avatar} alt="" /><span><small>YOU’RE IN</small><strong>{name}</strong></span><span>Edit profile <ArrowRight size={15} /></span></button>
      <section className="demo-room-wall">
        <header><div><span>ROOM WALL</span><h2>75 people here</h2></div><Users /></header>
        <div className="demo-wall-sample" aria-label="Limited non-clickable sample of people in this Room">
          <figure className="demo-wall-self"><img src={avatar} alt={`${name}, your demo profile`} /><figcaption>{name}<span>You</span></figcaption></figure>
          {wallPeople.map(([personName, id]) => <figure key={personName}><img src={photo(id)} alt={`${personName}, sample Room participant`} /><figcaption>{personName}</figcaption></figure>)}
        </div>
        <small>Limited sample · Room Wall is not a people catalogue</small>
      </section>
      <article className="demo-explore-card demo-explore"><span>EXPLORE · ALL EVENING</span><Users /><strong>See who’s here</strong><p>Open a small, fair selection now. It is never a full people catalogue.</p><button className="button button--dark" onClick={onExplore}>Explore now <ArrowRight size={17} /></button></article>
      <div className="demo-room-grid"><div><button className="demo-room-link" onClick={onIncoming}><span><Heart /><i>1</i></span><strong>Interested in You</strong><small>See who sent it</small><ArrowRight /></button>{hasMatch && <button className="demo-room-link" onClick={onMatch}><span><MessageCircle /></span><strong>Connections</strong><small>Sofia · Friday Social</small><ArrowRight /></button>}</div></div>
    </section>
  );
}
