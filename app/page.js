import Landing from "../components/Landing";
import { isPublicEnabled } from "../lib/public/server";

export const dynamic = 'force-dynamic';
export default function HomePage() {
  return <Landing publicEnabled={isPublicEnabled()} />;
}
