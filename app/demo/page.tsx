import { SocialRoomApp } from "../components/SocialRoomApp";

export default function DemoPage() {
  return <><SocialRoomApp initialView="discovery" /><aside className="demo-mode-banner" aria-label="Demo mode notice"><span><strong>Product demo</strong> — sample people and interactions only.</span><a href="/organizer">Create a real Room & QR</a></aside></>;
}
