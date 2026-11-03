import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { errorMessage } from "../lib/accounts";
type Identity = {
  league_id: string;
  revision_hash: string;
  sportsbook_url: string | null;
  email_sender: string | null;
  required_origin: string;
};
export function CommunicationIdentityEditor({
  leagueId,
}: {
  leagueId: string;
}) {
  const [identity, setIdentity] = useState<Identity | null>(null),
    [url, setUrl] = useState(""),
    [sender, setSender] = useState(""),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    void Promise.resolve(
      supabase!
        .rpc("communication_identity_review", { p_league: leagueId })
        .abortSignal(AbortSignal.timeout(15000)),
    )
      .then((r) => {
        if (!alive.current) return;
        if (r.error) {
          setNotice(errorMessage(r.error));
          return;
        }
        if (
          r.data?.league_id !== leagueId ||
          !/^[a-f0-9]{64}$/.test(r.data?.revision_hash)
        ) {
          setNotice("Communication identity scope is unavailable.");
          return;
        }
        setIdentity(r.data);
        setUrl(r.data.sportsbook_url ?? r.data.required_origin);
        setSender(r.data.email_sender ?? "");
      })
      .catch((e) => {
        if (alive.current) setNotice(errorMessage(e));
      });
    return () => {
      alive.current = false;
    };
  }, [leagueId]);
  async function save() {
    if (!identity || busy) return;
    setBusy(true);
    setNotice("");
    try {
      const r = await supabase!
        .rpc("save_communication_identity", {
          p_league: leagueId,
          p_expected: identity.revision_hash,
          p_url: url.trim(),
          p_sender: sender.trim(),
          p_reason: reason.trim(),
        })
        .abortSignal(AbortSignal.timeout(15000));
      if (r.error) throw r.error;
      if (
        r.data?.league_id !== leagueId ||
        !/^[a-f0-9]{64}$/.test(r.data?.revision_hash)
      )
        throw Error("Saved communication identity scope is invalid.");
      if (alive.current) {
        setIdentity(r.data);
        setReason("");
        setNotice(
          "Communication identity saved. Provider capability review must match the new configuration before activation.",
        );
      }
    } catch (e) {
      if (alive.current) setNotice(errorMessage(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <article className="admin-panel" aria-label="League communication identity">
      <h2>League Communication Identity</h2>
      <p>
        Pause operations and automation before editing. Use this environment's
        application origin and a sender you have verified with the mail
        provider. Saving does not verify a mail domain or send a message.
      </p>
      <div className="settings-fields">
        <label>
          Sportsbook communication URL
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </label>
        <label>
          Verified league sender
          <input
            type="email"
            value={sender}
            onChange={(e) => setSender(e.target.value)}
          />
        </label>
        <label>
          Communication identity review reason
          <input
            maxLength={400}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
      </div>
      <button
        disabled={!identity || busy || reason.trim().length < 8 || !sender}
        onClick={() => void save()}
      >
        Save communication identity
      </button>
      {notice && <p role="status">{notice}</p>}
    </article>
  );
}
