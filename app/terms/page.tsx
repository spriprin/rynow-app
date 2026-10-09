import { Radio, ShieldCheck } from "lucide-react";
import Link from "next/link";

export default function TermsPage() {
  return <main className="legal-page">
    <nav><Link className="brand" href="/"><span className="brand-mark"><Radio size={17} /></span>RYNOW<span className="brand-dot">.</span></Link><Link href="/">Back to RYNOW</Link></nav>
    <article>
      <span className="eyebrow">DRAFT · PILOT RC1</span><h1>Terms of Use</h1>
      <p className="legal-warning"><ShieldCheck />This is a product-infrastructure draft for a controlled pilot, not final legal advice.</p>
      <p>Version: pilot-rc1-draft-2026-10-09. Last updated: October 9, 2026.</p>
      <h2>Operator and contact</h2><p>The pilot is operated by Pavel Yerchak. Questions about the pilot may be sent to <a href="mailto:spriprin@gmail.com">spriprin@gmail.com</a>.</p>
      <h2>Who may use the pilot</h2><p>RYNOW is currently intended only for people aged 18 or older who are attending the relevant physical event. Entry to a Room does not verify identity or guarantee another guest’s conduct.</p>
      <h2>Expected conduct</h2><p>Do not harass, impersonate, threaten, spam or upload inappropriate or unlawful content. Respect another person’s “No,” their privacy and the rules of the physical event.</p>
      <h2>How RYNOW works</h2><p>RYNOW offers a curated discovery feed, private Interest responses, mutual Matches and text chat. It is optional and should never prevent the physical event from continuing. Availability, delivery or a Match is not guaranteed.</p>
      <h2>Safety</h2><p>Guests can Block, Report, or Report &amp; Block. A separate consent control can request event-staff assistance. Immediate danger should be handled through venue staff or local emergency services; RYNOW is not an emergency service.</p>
      <h2>Accounts and content</h2><p>The pilot uses a persistent anonymous guest session rather than email/password guest registration. You remain responsible for content you submit. Event records are scheduled for deletion after the 60-day period described in the Draft Privacy Policy.</p>
      <h2>Before external invitations</h2><p>This is an invite-only pilot draft, not a final global service agreement. Check it against the actual event location and audience before inviting outside attendees.</p>
    </article>
  </main>;
}
