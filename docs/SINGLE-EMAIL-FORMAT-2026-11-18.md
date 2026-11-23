# One Full Email Format — November 18, 2026

Development frontend `dpl_AgU9qSUfBh8nnoPaLHky2upZ4FrX`; refresh worker v66; migration `full_email_format`. Production was not deployed and no additional emails were sent.

- Removed Brief/Detailed controls from owner previews, Include Details from Communications, and the detail checkbox/query mode from the web reader.
- Full content is now the sole email format, including legacy renderer calls and older links/preferences with details=false. Existing function arguments remain for compatibility.
- Central effective communications and routine-delivery detail checks always select full content. Email and push opt-outs remain unchanged. Multi-league reports still require verified membership and email eligibility; only the obsolete detail-consent condition was removed.
- Large AMP reports keep rich content with bounded lists instead of reverting to brief templates. Push previews remain short.

Verification: TypeScript/build, four report render/AMP/MIME/isolation tests, old brief flag normalization, actual database opt-out/default/legacy-reader checks, and browser league-switching/old-link checks passed. Hosted desktop/mobile owner previews and Communications passed with intercepted fixture data: full balance content, no detail controls, channel toggles retained, no errors or horizontal overflow.

No new tables, polling, media storage, memberships or financial changes. Existing captured/sent historical messages are not rewritten. The six earlier test emails remain historical Brief/Detailed examples; future sends use the full format.
