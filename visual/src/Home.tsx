import { Mark, Icon } from "./ui";
import { LeagueAvatar } from "./Markets";
import { league, teams, members } from "./model";
import { routeUrl } from "./routing";
export function HomePage({ unavailable = false }: { unavailable?: boolean }) {
  return (
    <div className="home-page">
      <header className="home-header">
        <a className="brand" href="/">
          <Mark />
          <span className="wordmark">boff</span>
        </a>
        <nav>
          <a href={routeUrl("access")}>Sign In</a>
          <a className="button secondary" href={routeUrl("setup")}>
            Connect A League
          </a>
        </nav>
      </header>
      <main className="home-content">
        {unavailable ? (
          <>
            <h1>League Or Page Unavailable</h1>
            <p>Choose a connected league to continue.</p>
            <a className="button primary" href="/">
              Your Leagues
            </a>
          </>
        ) : (
          <>
            <h1>Your Leagues</h1>
            <a className="home-league" href={routeUrl("matchups")}>
              <LeagueAvatar />
              <span>
                <strong>{league.league}</strong>
                <small>
                  {league.season} · Sleeper · {teams.length} Teams ·{" "}
                  {members.length} Participants
                </small>
              </span>
              <span className="home-open">
                Open Weekly Slate <Icon name="arrow" size={18} />
              </span>
            </a>
            <p className="field-note">
              Your connected league and weekly markets.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
