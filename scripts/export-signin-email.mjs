import fs from "node:fs";
import { renderEmail, sampleEmail } from "../api/_lib/email-templates.ts";
fs.mkdirSync("supabase/templates", { recursive: true });
const base = sampleEmail("signin");
const official = renderEmail({
  ...base,
  sample: false,
  greeting: "Welcome,",
  url: "https://SIGN_IN_LINK_PLACEHOLDER",
  details: [],
});
fs.writeFileSync(
  "supabase/templates/magic-link.html",
  official.replaceAll(
    "https://SIGN_IN_LINK_PLACEHOLDER",
    "{{ .ConfirmationURL }}",
  ),
);
fs.writeFileSync("signin-email-review.html", renderEmail(base));
console.log("Exported production sign-in HTML and a sample preview.");
