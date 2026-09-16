import { Radio, ShieldCheck } from "lucide-react";
import Link from "next/link";

export default function PrivacyPage() {
  return <main className="legal-page">
    <nav><Link className="brand" href="/"><span className="brand-mark"><Radio size={17} /></span>HERE<span className="brand-dot">.</span></Link><Link href="/">Back to HERE</Link></nav>
    <article>
      <span className="eyebrow">DRAFT · PILOT RC1</span><h1>Privacy Policy</h1>
      <p className="legal-warning"><ShieldCheck />This is a technical draft for product review. It is not final legal advice and does not claim legal or GDPR compliance.</p>
      <p>Version: pilot-rc1-draft-2026-09-14. Last updated: September 14, 2026.</p>
      <h2>What HERE currently stores</h2><p>A persistent guest identifier, profile name, profile photo path, 18+ confirmation, discovery preferences, event memberships and activity timestamps. Product interactions may include viewed profiles, Interests, Matches, text messages, Blocks, Reports, notification state and post-event “met in person” feedback.</p>
      <h2>Why it is used</h2><p>To let guests join the same event Room, discover eligible people, form reciprocal Matches, chat, use safety controls and let operators understand aggregate pilot outcomes.</p>
      <h2>Who can see what</h2><p>Other eligible guests receive only limited profile data needed for discovery. Match participants can access their shared chat. Organizers receive event-level aggregates by default—not private chats, private pairings, reporter identity or individual feedback answers. Authorized platform moderators may access Reports and necessary safety context.</p>
      <h2>Photos and profile persistence</h2><p>Photos are stored in a private Supabase Storage bucket. A guest profile persists across events so the same browser session can reuse it. Signed links are short-lived.</p>
      <h2>Retention proposal</h2><p>The current technical proposal is approximately 30 days for short-lived operational and unmatched event data, 90 days for Matches and chats, and 180 days for safety Reports. Cleanup is disabled until the owner approves the final policy and backup process.</p>
      <h2>Your choices</h2><p>You can leave discovery, Block or Report a person, choose whether relevant Report details may be shared with event staff, and submit a “Delete my data” request in Settings. Shared chats and safety evidence require a reviewed deletion/anonymization process.</p>
      <h2>Open legal decisions</h2><p>The final operator identity, lawful bases, contact details, jurisdiction, international transfers, processor terms, minor safeguards and final retention periods still require owner and legal review before a public pilot.</p>
    </article>
  </main>;
}
