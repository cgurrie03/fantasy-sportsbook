import { useState } from "react";
import { errorMessage } from "../lib/accounts";
export function PolicyTransfer<T extends object>({
  name,
  contract,
  values,
  defaults,
  validate,
  onApply,
}: {
  name: string;
  contract: string;
  values: T;
  defaults: T;
  validate: (v: unknown) => T;
  onApply: (v: T) => void;
}) {
  const [text, setText] = useState(""),
    [notice, setNotice] = useState("");
  function apply() {
    try {
      if (new TextEncoder().encode(text).length > 2048)
        throw Error("Policy transfer exceeds 2 KiB.");
      const d = JSON.parse(text);
      if (
        !d ||
        d.contract !== contract ||
        Object.keys(d).sort().join(",") !== "contract,values"
      )
        throw Error(
          "Only the matching policy contract and values may be imported.",
        );
      onApply(validate(d.values));
      setNotice(
        "Imported into the proposed values. Review the effective period and save explicitly.",
      );
    } catch (e) {
      setNotice(errorMessage(e));
    }
  }
  return (
    <details>
      <summary>{name} defaults and policy transfer</summary>
      <p>
        Copies policy values only. Accounts, balances, approvals, secrets,
        effective dates and league identity are excluded. Applying values
        changes this form; the reviewed save is still required.
      </p>
      <button
        type="button"
        onClick={() => {
          onApply({ ...defaults });
          setNotice(
            "Shared defaults loaded into proposed values. Review and save explicitly.",
          );
        }}
      >
        Load {name.toLowerCase()} shared defaults
      </button>
      <button
        type="button"
        onClick={() => {
          setText(JSON.stringify({ contract, values }, null, 2));
          setNotice("Policy values ready to copy.");
        }}
      >
        Export {name.toLowerCase()} values
      </button>
      <label>
        {name} policy JSON
        <textarea
          aria-label={name + " policy JSON"}
          value={text}
          maxLength={2048}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <button type="button" onClick={apply}>
        Apply {name.toLowerCase()} policy JSON
      </button>
      {notice && <p role="status">{notice}</p>}
    </details>
  );
}
