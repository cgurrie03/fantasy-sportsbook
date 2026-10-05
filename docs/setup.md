# Setup Progress

Updated October 5, 2026. Owner authorized service setup; free tiers only.

| Component | Status |
| --- | --- |
| coopergurrie.com | Purchase confirmed |
| Local React/Vite/TypeScript | Scaffolded |
| GitHub private repository | Created as cgurrie03/fantasy-sportsbook; local origin configured; code not pushed yet |
| Vercel Hobby account/project | Account/workspace Cooper Gurrie Projects created on Hobby; fantasy-sportsbook repository visible for import; deployment pending |
| Supabase free project | Created and healthy: fantasy-sportsbook, us-east-1; public app settings saved in ignored .env.local |
| Resend / sending domain | coopergurrie.com added in us-east-1; verification in progress |
| DNS / custom SMTP | Three required Resend DNS records approved and saved in Spaceship; custom SMTP not configured |
| Import, live emails, deployment | Separate approval gates |

Project/repository name: fantasy-sportsbook. Region: US East. Proposed site: goldy.coopergurrie.com, leaving root for other projects; confirm before website DNS changes. Approved sender: Goldy Fantasy Sportsbook <sportsbook@coopergurrie.com>. Personal email stays owner/recovery account; paid mailbox optional.

## Connection Order

1. Sign in to existing GitHub and create private repository; push reviewed foundation.
2. Create/sign in to Vercel Hobby, Supabase and Resend. Owner handles new passwords, terms acceptance and credential entry.
3. Create Supabase free project; record URL/publishable key in local settings. Configure invited-user sign-in during implementation.
4. Verify sending domain with exact Resend DNS records; connect custom SMTP to Supabase for member sign-in emails.
5. Prepare hosting configuration without deploying. Vercel repository import triggers deployment; stop at that approval gate.
6. Confirm final app address and auth redirect URLs when deployment is approved.

No passwords, API keys or SMTP credentials in documentation/chat/Git. No paid trials or upgrades.

Supabase setup defaults: Data API enabled, automatic table exposure disabled, automatic RLS enabled. No application tables or historical records created/imported yet.

Supabase dashboard: https://supabase.com/dashboard/project/bmvjcdgxwxqalaohpsnw. Project URL: https://bmvjcdgxwxqalaohpsnw.supabase.co. Local app has the browser-safe publishable key; database password and server secret keys have not been copied.

Resend domain ID: 336b7c17-318a-4985-a719-960aa13334db. Saved DNS records (30-minute TTL): TXT resend._domainkey with Resend's public DKIM key; CNAME rsend to rsend.forge.rmta.net; CNAME send to send.forge.rmta.net. No receiving-email or website-routing records were added. Owner approved these three records at action time. Resend status was Pending immediately after submission; verification is not yet confirmed.

## Official References

- [Vite](https://vite.dev/guide/)
- [Vercel Hobby](https://vercel.com/docs/plans/hobby)
- [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)
- [Resend verified domains](https://resend.com/docs/dashboard/domains/introduction)
