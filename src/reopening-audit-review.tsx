import { createRoot } from "react-dom/client";
import { ReopeningReview } from "./components/ReopeningReview";
import "./index.css";
import "./App.css";
import "./components/Sportsbook.css";
async function start() {
  const response = await fetch("/work/reopening-review.json");
  if (!response.ok) throw Error("Local review sources unavailable.");
  const { preview, data, leagueId } = await response.json();
  createRoot(document.getElementById("root")!).render(
    <div className="app-shell">
      <header className="masthead">
        <div>
          <h1>Sportsbook review</h1>
          <p>Sunday, October 18 at 12:00 PM Eastern / proposed closing time</p>
        </div>
        <a href="/#/demo">Public demo</a>
      </header>
      <p className="review-notice">
        Captured public league data and repository baseline configuration. These
        prices are for review; regenerate with the production model settings and
        fresh sources before approval. No production changes or emails.
      </p>
      <ReopeningReview
        data={data}
        leagueId={leagueId}
        initialPreview={preview}
        readOnly
      />
    </div>,
  );
}
void start().catch(() => {
  document.getElementById("root")!.textContent =
    "The local review could not load. Prepare the captured sources again.";
});
