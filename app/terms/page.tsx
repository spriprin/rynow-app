import { Radio, ShieldCheck } from "lucide-react";
import Link from "next/link";

export default function TermsPage() {
  return <main className="legal-page">
    <nav><Link className="brand" href="/"><span className="brand-mark"><Radio size={17} /></span>RYNOW<span className="brand-dot">.</span></Link><Link href="/">Back to RYNOW</Link></nav>
    <article>
      <span className="eyebrow">DRAFT · PILOT RC1</span><h1>Terms of Use</h1>
      <p className="legal-warning"><ShieldCheck />This is a product-infrastructure draft. It is not final legal advice and does not identify a final legal operator.</p>
      <p>Version: pilot-rc1-draft-2026-09-14. Last updated: September 14, 2026.</p>
      <h2>Who may use the pilot</h2><p>RYNOW is currently intended only for people aged 18 or older who are attending the relevant physical event. Entry to a Room does not verify identity or guarantee another guest’s conduct.</p>
      <h2>Expected conduct</h2><p>Do not harass, impersonate, threaten, spam or upload inappropriate or unlawful content. Respect another person’s “No,” their privacy and the rules of the physical event.</p>
      <h2>How RYNOW works</h2><p>RYNOW offers a curated discovery feed, private Interest responses, mutual Matches and text chat. It is optional and should never prevent the physical event from continuing. Availability, delivery or a Match is not guaranteed.</p>
      <h2>Safety</h2><p>Guests can Block, Report, or Report &amp; Block. A separate consent control can request event-staff assistance. Immediate danger should be handled through venue staff or local emergency services; RYNOW is not an emergency service.</p>
      <h2>Accounts and content</h2><p>The pilot uses a persistent anonymous guest session rather than email/password guest registration. You remain responsible for content you submit. Product and safety records may be retained according to the reviewed Privacy Policy.</p>
      <h2>Open legal decisions</h2><p>The final contracting entity, governing law, liability terms, content licence, enforcement process, contact channel and dispute provisions require owner and legal review before public release.</p>
    </article>
  </main>;
}
