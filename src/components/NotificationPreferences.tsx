import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { errorMessage } from "../lib/accounts";

const choices = [
  ["opening", "Opening editions"],
  ["reminder", "Closing reminders"],
  ["recap", "Weekly recaps"],
  ["monday_watch", "Monday ticket watches"],
  ["reopening", "Approved reopening announcements"],
] as const;
type Kind = (typeof choices)[number][0];
type Values = Partial<Record<Kind, boolean | null>>;
type Preferences = {
  league_id: string;
  revision: number;
  defaults: Record<Kind, boolean>;
  available: Record<Kind, boolean>;
  effective: Record<Kind, boolean>;
  overrides: Values;
};
export function NotificationPreferences({
  leagueId,
  ownerDefaults = false,
  canConfigure = false,
}: {
  leagueId: string;
  ownerDefaults?: boolean;
  canConfigure?: boolean;
}) {
  const [saved, setSaved] = useState<Preferences | null>(null),
    [values, setValues] = useState<Values>({});
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [loading, setLoading] = useState(true);
  const request = useRef(0);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const fence = request;
    const id = ++request.current;
    void Promise.resolve(
      supabase!.rpc(
        ownerDefaults
          ? "league_notification_defaults"
          : "my_notification_preferences",
        { p_league: leagueId },
      ),
    )
      .then((r) => {
        if (id !== request.current) return;
        if (r.error) {
          setNotice(errorMessage(r.error));
          return;
        }
        const p = r.data as Preferences;
        if (
          p?.league_id !== leagueId ||
          !Number.isInteger(p.revision) ||
          !p.defaults ||
          !p.available ||
          !p.effective ||
          !p.overrides
        ) {
          setNotice("Notification choices could not be verified.");
          return;
        }
        setSaved(p);
        setValues(ownerDefaults ? p.defaults : p.overrides);
      })
      .catch((e) => {
        if (id === request.current) setNotice(errorMessage(e));
      })
      .finally(() => {
        if (id === request.current) setLoading(false);
      });
    return () => {
      fence.current++;
    };
  }, [leagueId, ownerDefaults, reload]);
  function reloadChoices() {
    request.current++;
    setSaved(null);
    setValues({});
    setNotice("");
    setLoading(true);
    setReload((v) => v + 1);
  }
  async function save() {
    if (!saved || busy || (ownerDefaults && !canConfigure)) return;
    const id = ++request.current;
    setBusy(true);
    setNotice("");
    try {
      const r = await supabase!.rpc(
        ownerDefaults
          ? "save_league_notification_defaults"
          : "save_my_notification_preferences",
        {
          p_league: leagueId,
          p_revision: saved.revision,
          p_values: values,
        },
      );
      if (id !== request.current) return;
      if (r.error) throw r.error;
      if (r.data?.league_id !== leagueId)
        throw Error("Notification choices could not be verified.");
      const p = r.data as Preferences;
      setSaved(p);
      setValues(ownerDefaults ? p.defaults : p.overrides);
      setNotice(
        "Notification choices saved for this league. Messages already being delivered may still arrive.",
      );
    } catch (e) {
      if (id === request.current) setNotice(errorMessage(e));
    } finally {
      if (id === request.current) setBusy(false);
    }
  }
  return (
    <section
      className="account-card notification-preferences"
      aria-label={
        ownerDefaults
          ? "League notification defaults"
          : "Your notification preferences"
      }
    >
      <h2>
        {ownerDefaults
          ? "League notification defaults"
          : "Your notification preferences"}
      </h2>
      <p>
        {ownerDefaults
          ? "Enabled types are available to participants, who can opt out individually. Existing schedule switches still apply."
          : "Choose routine emails for your account in this league. Other owners of your fantasy team have their own choices."}
      </p>
      <p>
        At most three routine emails per Tuesday–Monday week (Eastern).
        Accepted-bet receipts and security messages are separate. A nearby
        closing reminder may include your Monday ticket watch.
      </p>
      <p>
        When all three slots are used, later routine emails are skipped. Turn
        off a type to leave room for another.
      </p>
      {loading ? (
        <p role="status">Loading notification choices…</p>
      ) : saved ? (
        <>
          <fieldset disabled={busy || (ownerDefaults && !canConfigure)}>
            <legend>
              {ownerDefaults
                ? "Available routine email types"
                : "Routine email choices"}
            </legend>
            {choices.map(([kind, label]) => (
              <label key={kind} className="notification-choice">
                <span>{label}</span>
                {ownerDefaults ? (
                  <input
                    type="checkbox"
                    aria-label={label}
                    checked={values[kind] === true}
                    onChange={(e) =>
                      setValues((v) => ({ ...v, [kind]: e.target.checked }))
                    }
                  />
                ) : (
                  <select
                    aria-label={label}
                    disabled={!saved.available[kind]}
                    value={
                      values[kind] === true
                        ? "on"
                        : values[kind] === false
                          ? "off"
                          : "default"
                    }
                    onChange={(e) =>
                      setValues((v) => ({
                        ...v,
                        [kind]:
                          e.target.value === "default"
                            ? null
                            : e.target.value === "on",
                      }))
                    }
                  >
                    <option value="default">Use league default</option>
                    <option value="on">On</option>
                    <option value="off">Off</option>
                  </select>
                )}
                {!ownerDefaults && !saved.available[kind] && (
                  <small>Disabled by league settings</small>
                )}
              </label>
            ))}
          </fieldset>
          <button
            className="primary"
            disabled={busy || (ownerDefaults && !canConfigure)}
            onClick={() => void save()}
          >
            {busy
              ? "Saving notification choices…"
              : ownerDefaults
                ? "Save league notification defaults"
                : "Save my notification choices"}
          </button>
        </>
      ) : null}
      {notice && <p role="status">{notice}</p>}
      {!loading && (
        <button className="secondary" disabled={busy} onClick={reloadChoices}>
          Reload notification choices
        </button>
      )}
    </section>
  );
}
