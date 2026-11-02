import { useCallback, useEffect, useRef, useState } from "react";
import {
  captureTeamInvitation,
  forgetTeamInvitation,
} from "../lib/team-invitation";
import { supabase } from "../lib/supabase";
import { errorMessage } from "../lib/accounts";
import type { Team } from "../lib/accounts";
type Claim = {
  id: string;
  league_id: string;
  team_id: string;
  display_name: string;
  verified_email: string;
  state: string;
  revision: number;
  league_name: string;
  team_name: string;
  reason: string | null;
};
type Invite = {
  id: string;
  team_id: string | null;
  invited_email: string | null;
  expires_at: string;
  revision: number;
  state: string;
};
type Directory = { claims: Claim[]; invitations: Invite[] };
async function rpc(
  name: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
) {
  const r = await supabase!
    .rpc(name, args)
    .abortSignal(signal ?? AbortSignal.timeout(15000));
  if (r.error) throw r.error;
  return r.data;
}
function useDirectory(leagueId: string | null) {
  const [data, setData] = useState<Directory>({ claims: [], invitations: [] }),
    [notice, setNotice] = useState(""),
    [ready, setReady] = useState(false);
  const alive = useRef(false);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      const d = await rpc(
        "team_claim_directory",
        { p_league: leagueId },
        signal,
      );
      if (
        !d ||
        !Array.isArray(d.claims) ||
        !Array.isArray(d.invitations) ||
        d.claims.length > 256 ||
        d.invitations.length > 256 ||
        new TextEncoder().encode(JSON.stringify(d)).length > 400000
      )
        throw Error("Claim directory exceeds its read budget.");
      if (alive.current && !signal?.aborted) {
        setData(d);
        setReady(true);
      }
    },
    [leagueId],
  );
  useEffect(() => {
    alive.current = true;
    const c = new AbortController();
    void load(AbortSignal.any([c.signal, AbortSignal.timeout(15000)])).catch(
      (e) => {
        if (!c.signal.aborted) setNotice(errorMessage(e));
      },
    );
    return () => {
      alive.current = false;
      c.abort();
    };
  }, [load]);
  return { data, notice, setNotice, ready, load, alive };
}
export function TeamClaimAdmin({
  leagueId,
  teams,
}: {
  leagueId: string;
  teams: Team[];
}) {
  const { data, notice, setNotice, ready, load, alive } =
    useDirectory(leagueId);
  const [team, setTeam] = useState(""),
    [email, setEmail] = useState(""),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [link, setLink] = useState("");
  const attempt = useRef<{
    terms: string;
    token: string;
    digest: string;
  } | null>(null);
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setNotice("");
    try {
      await action();
      await load();
    } catch (e) {
      if (alive.current) setNotice(errorMessage(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function issue() {
    const terms = JSON.stringify([
      leagueId,
      team,
      email.trim().toLowerCase(),
      reason.trim(),
    ]);
    if (attempt.current?.terms !== terms) {
      const bytes = crypto.getRandomValues(new Uint8Array(32)),
        token = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
          "",
        );
      const digest = Array.from(
        new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(token),
          ),
        ),
        (b) => b.toString(16).padStart(2, "0"),
      ).join("");
      attempt.current = { terms, token, digest };
    }
    const a = attempt.current!;
    await rpc("issue_team_invitation", {
      p_league: leagueId,
      p_team: team || null,
      p_email: email.trim().toLowerCase() || null,
      p_digest: a.digest,
      p_reason: reason.trim(),
    });
    if (alive.current) {
      setLink(window.location.origin + "/#/join/" + a.token);
      setNotice(
        "Invitation ready. Copy it for commissioner distribution; no email was sent. The link expires in seven days.",
      );
    }
  }
  return (
    <article className="admin-panel">
      <h2>Invitations and team claims</h2>
      <p>
        A shared league link lets verified accounts request a team. Each request
        needs your approval. Co-owners receive independent, unfunded wallets.
        Invitations grant no staff access.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(issue);
        }}
      >
        <label>
          Invitation team
          <select
            aria-label="Invitation team"
            value={team}
            disabled={busy}
            onChange={(e) => {
              setTeam(e.target.value);
              setLink("");
            }}
          >
            <option value="">All teams — commissioner signup link</option>
            {teams
              .filter((t) => t.league_id === leagueId)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.team_name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Restrict to verified email (optional)
          <input
            aria-label="Invitation email"
            type="email"
            maxLength={254}
            value={email}
            disabled={busy}
            onChange={(e) => {
              setEmail(e.target.value);
              setLink("");
            }}
          />
        </label>
        <label>
          Claim review reason
          <textarea
            aria-label="Claim review reason"
            maxLength={400}
            minLength={8}
            required
            value={reason}
            disabled={busy}
            onChange={(e) => {
              setReason(e.target.value);
              setLink("");
            }}
          />
        </label>
        <button
          className="primary"
          disabled={busy || !ready || reason.trim().length < 8}
        >
          Create signup link
        </button>
      </form>
      {link && (
        <label>
          Copy invitation link
          <input
            aria-label="Copy invitation link"
            readOnly
            value={link}
            onFocus={(e) => e.currentTarget.select()}
          />
          <small>
            Saved only in this screen. Revoke and issue a fresh link if you lose
            it.
          </small>
        </label>
      )}
      <h3>Review requests</h3>
      {!ready && <p role="status">Loading invitation reviews…</p>}
      {ready && !data.claims.length && <p>No team claims yet.</p>}
      {data.claims.map((c) => (
        <section key={c.id} aria-label={"Claim from " + c.display_name}>
          <strong>
            {c.display_name} · {c.team_name}
          </strong>
          <p>
            {c.verified_email} · {c.state}
          </p>
          {c.reason && <p>{c.reason}</p>}
          {c.state === "pending" &&
            (["approve", "reject"] as const).map((action) => (
              <button
                type="button"
                className="secondary"
                key={action}
                disabled={busy || reason.trim().length < 8}
                onClick={() =>
                  void run(async () => {
                    await rpc("review_team_claim", {
                      p_claim: c.id,
                      p_expected: c.revision,
                      p_action: action,
                      p_reason: reason.trim(),
                    });
                    setNotice(
                      action === "approve"
                        ? "Claim approved. Independent wallet funding remains pending."
                        : "Claim rejected. No account access granted.",
                    );
                  })
                }
              >
                {action === "approve" ? "Approve claim" : "Reject claim"} for{" "}
                {c.display_name}
              </button>
            ))}
          {c.state === "approved" && (
            <button
              type="button"
              className="secondary"
              disabled={busy || reason.trim().length < 8}
              onClick={() =>
                void run(async () => {
                  await rpc("review_team_claim", {
                    p_claim: c.id,
                    p_expected: c.revision,
                    p_action: "revoke",
                    p_reason: reason.trim(),
                  });
                  setNotice(
                    "Claim access revoked. Financial history and money retained.",
                  );
                })
              }
            >
              Revoke claim for {c.display_name}
            </button>
          )}
        </section>
      ))}
      <h3>Issued invitations</h3>
      {data.invitations.map((i) => (
        <p key={i.id}>
          {i.team_id
            ? teams.find((t) => t.id === i.team_id)?.team_name
            : "League signup link"}{" "}
          · {i.invited_email ?? "Verified accounts may request"} · {i.state} ·
          Expires {new Date(i.expires_at).toLocaleString()}
          {i.state === "open" && (
            <button
              type="button"
              className="secondary"
              disabled={busy || reason.trim().length < 8}
              onClick={() =>
                void run(async () => {
                  await rpc("revoke_team_invitation", {
                    p_invitation: i.id,
                    p_expected: i.revision,
                    p_reason: reason.trim(),
                  });
                  setLink("");
                  attempt.current = null;
                  setNotice(
                    "Invitation revoked. Pending requests canceled; approved accounts require separate claim revocation.",
                  );
                })
              }
            >
              Revoke invitation {i.id.slice(0, 8)}
            </button>
          )}
        </p>
      ))}
      {notice && <p role="status">{notice}</p>}
    </article>
  );
}
export function TeamClaimPortal({
  initialToken = "",
  onClaimed,
}: {
  initialToken?: string;
  onClaimed?: () => void;
}) {
  const { data, notice, setNotice, ready, load, alive } = useDirectory(null);
  const [code, setCode] = useState(
      () => captureTeamInvitation() || initialToken,
    ),
    [name, setName] = useState(""),
    [team, setTeam] = useState(""),
    [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{
    league_name: string;
    teams: { id: string; name: string }[];
  } | null>(null);
  useEffect(() => {
    if (/^#\/join\/[0-9a-f]{64}$/.test(window.location.hash))
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search + "#/join",
      );
  }, []);
  function token() {
    let t = code.trim();
    if (!/^[0-9a-f]{64}$/.test(t)) {
      try {
        const u = new URL(t);
        t =
          u.origin === window.location.origin
            ? (/^#\/join\/([0-9a-f]{64})$/.exec(u.hash)?.[1] ?? "")
            : "";
      } catch {
        t = "";
      }
    }
    if (!/^[0-9a-f]{64}$/.test(t))
      throw Error(
        "Enter your invitation code or this sportsbook’s invitation link.",
      );
    return t;
  }
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setNotice("");
    try {
      await action();
    } catch (e) {
      if (alive.current) setNotice(errorMessage(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <main className="admin-workspace">
      <h1>Request team access</h1>
      <p>
        Sign in with your verified account, then use your commissioner’s
        invitation. Selecting a team requests owner review. It grants no access
        or funds by itself.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const d = await rpc("team_invitation_preview", {
              p_token: token(),
            });
            if (!d || !Array.isArray(d.teams) || d.teams.length > 32)
              throw Error("Invitation preview unavailable.");
            if (alive.current) {
              setPreview(d);
              setTeam(d.teams.length === 1 ? d.teams[0].id : "");
            }
          });
        }}
      >
        <label>
          Invitation code or link
          <input
            aria-label="Invitation code or link"
            maxLength={512}
            autoComplete="off"
            value={code}
            disabled={busy}
            onChange={(e) => {
              setCode(e.target.value);
              setPreview(null);
              setTeam("");
            }}
          />
        </label>
        <button className="secondary" disabled={busy || !code.trim()}>
          Review invitation
        </button>
      </form>
      {preview && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await rpc("submit_team_claim", {
                p_token: token(),
                p_team: team,
                p_name: name.trim(),
              });
              if (alive.current) {
                setPreview(null);
                setCode("");
                forgetTeamInvitation();
                onClaimed?.();
                setName("");
                setNotice(
                  "Request recorded. Owner approval and an explicit funding decision remain pending.",
                );
              }
              await load();
            });
          }}
        >
          <h2>{preview.league_name}</h2>
          <label>
            Your team
            <select
              aria-label="Your team"
              required
              disabled={busy}
              value={team}
              onChange={(e) => setTeam(e.target.value)}
            >
              <option value="">Choose the team you manage</option>
              {preview.teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Participant display name
            <input
              aria-label="Participant display name"
              required
              maxLength={80}
              value={name}
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <button className="primary" disabled={busy || !team || !name.trim()}>
            Request owner approval
          </button>
        </form>
      )}
      <h2>Your requests</h2>
      {!ready && <p role="status">Loading your requests…</p>}
      {data.claims.map((c) => (
        <p key={c.id}>
          {c.league_name} · {c.team_name} · {c.state}
          {c.state === "approved" ? " · Funding is reviewed separately." : ""}
        </p>
      ))}
      {notice && <p role="status">{notice}</p>}
      <a href="#/account">Return to account</a>
    </main>
  );
}
