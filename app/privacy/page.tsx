import { Radio, ShieldCheck } from "lucide-react";
import Link from "next/link";

export default function PrivacyPage() {
  return <main className="legal-page">
    <nav><Link className="brand" href="/"><span className="brand-mark"><Radio size={17} /></span>RYNOW<span className="brand-dot">.</span></Link><Link href="/">Back to RYNOW</Link></nav>
    <article>
      <span className="eyebrow">DRAFT · PILOT RC1</span><h1>Privacy Policy</h1>
      <p className="legal-warning"><ShieldCheck />This is a technical draft for product review. It is not final legal advice and does not claim legal or GDPR compliance.</p>
      <p>Version: pilot-rc1-draft-2026-10-09. Last updated: October 9, 2026.</p>
      <h2>Operator and contact</h2><p>The pilot is operated by Pavel Yerchak. For privacy questions or a data-deletion request, contact <a href="mailto:spriprin@gmail.com">spriprin@gmail.com</a>.</p>
      <h2>What RYNOW currently stores</h2><p>A persistent guest identifier, profile name, profile photo path, 18+ confirmation, discovery preferences, event memberships and activity timestamps. Product interactions may include viewed profiles, Interests, Matches, text messages, Blocks, Reports, notification state and post-event “met in person” feedback.</p>
      <h2>Why it is used</h2><p>To let guests join the same event Room, discover eligible people, form reciprocal Matches, chat, use safety controls and let operators understand aggregate pilot outcomes.</p>
      <h2>Who can see what</h2><p>Other eligible guests receive only limited profile data needed for discovery. Match participants can access their shared chat. Organizers receive event-level aggregates by default—not private chats, private pairings, reporter identity or individual feedback answers. Authorized platform moderators may access Reports and necessary safety context.</p>
      <h2>Photos and profile persistence</h2><p>Photos are stored in a private Supabase Storage bucket. A guest profile persists across events so the same browser session can reuse it. Signed links are short-lived.</p>
      <h2>60-day retention for the controlled pilot</h2><p>Event records, including Matches, chats and Reports, are checked daily for deletion once 60 days have passed since the event ended. Anonymous guest accounts and their stored avatars are checked daily after 60 days without sign-in or profile activity, once no event or shared safety record still refers to them. This cleanup is active on the isolated staging system; production must be verified separately before any public launch.</p>
      <h2>Your choices</h2><p>You can leave discovery, Block or Report a person, and choose whether relevant Report details may be shared with event staff. “Delete my data” currently submits a request for human review; it does not immediately erase the account. Shared chats and safety evidence require careful removal of your identity without destroying another person’s copy.</p>
      <h2>Before external invitations</h2><p>This draft must still be checked against the location and audience of the specific event before inviting outside attendees. The contact above is available for pilot privacy questions; this draft is not final legal advice.</p>
    </article>
  </main>;
}
