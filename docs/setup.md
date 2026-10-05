# Setup Progress

Updated October 5, 2026. Owner authorized service setup; free tiers only.

| Component | Status |
| --- | --- |
| coopergurrie.com | Purchase confirmed |
| Local React/Vite/TypeScript | Scaffolded |
| GitHub private repository | Owner uploaded main successfully; remote commits and private visibility verified in browser |
| Vercel Hobby account/project | Initial setup page deployed successfully; https://sportsbook.coopergurrie.com/ loads over HTTPS |
| Supabase free project | Created and healthy: fantasy-sportsbook, us-east-1; public app settings saved in ignored .env.local |
| Resend / sending domain | coopergurrie.com verified in us-east-1; ready for sender sportsbook@coopergurrie.com |
| DNS / custom SMTP | Three required Resend DNS records saved and verified; Supabase custom SMTP saved by owner and enabled; actual delivery not tested yet |
| Import, live emails, deployment | Approved Week 3 import completed and verified; Stage 1 frontend built locally, awaiting deployment approval; live email delivery remains untested |

Project/repository name: fantasy-sportsbook. Region: US East. Approved site: sportsbook.coopergurrie.com, leaving root for other projects. Approved sender: Goldy Fantasy Sportsbook <sportsbook@coopergurrie.com>. Personal email stays owner/recovery account; paid mailbox optional.

## Connection Order

1. Sign in to existing GitHub and create private repository; push reviewed foundation.
2. Create/sign in to Vercel Hobby, Supabase and Resend. Owner handles new passwords, terms acceptance and credential entry.
3. Create Supabase free project; record URL/publishable key in local settings. Configure invited-user sign-in during implementation.
4. Verify sending domain with exact Resend DNS records; connect custom SMTP to Supabase for member sign-in emails.
5. Prepare hosting configuration, then deploy after owner approval. Initial setup-page deployment approved and completed.
6. Connect approved sportsbook.coopergurrie.com and configure sign-in return URL. Canonical Supabase Site URL saved; additional callback paths will be defined with the sign-in implementation.

No passwords, API keys or SMTP credentials in documentation/chat/Git. No paid trials or upgrades.

Supabase setup defaults: Data API enabled, automatic table exposure disabled, automatic RLS enabled. Account tables, historical tickets/legs, wallet ledger and leaderboard function are live. All 12 mappings and balances are initialized; 19 Week 3 tickets are settled. Public tables use explicit authenticated grants and league/member access rules. Account approval creates a membership, not an authentication identity or outgoing email.

Supabase dashboard: https://supabase.com/dashboard/project/bmvjcdgxwxqalaohpsnw. Project URL: https://bmvjcdgxwxqalaohpsnw.supabase.co. Local app has the browser-safe publishable key; database password and server secret keys have not been copied.

Resend domain ID: 336b7c17-318a-4985-a719-960aa13334db. Saved DNS records (30-minute TTL): TXT resend._domainkey with Resend's public DKIM key; CNAME rsend to rsend.forge.rmta.net; CNAME send to send.forge.rmta.net. No receiving-email or website-routing records were added. Owner approved these three records at action time. Resend status Verified confirmed in dashboard on October 5, 2026.

Repository-local commit author approved by owner: Cooper Gurrie <cooper.gurrie@gmail.com>. Initial sandbox upload failed when Git's credential helper shell could not start. Owner completed the push in their own command prompt; remote main at 73533ea verified in browser. No credentials requested or copied.

Vercel project created for Vite with public Supabase URL/publishable key. Initial deployment succeeded and setup page loaded at https://fantasy-sportsbook-smoky.vercel.app/. Website CNAME sportsbook to 109429a0f1506e07.vercel-dns-017.com saved in Spaceship (30-minute TTL). Custom HTTPS address https://sportsbook.coopergurrie.com/ loaded successfully in browser on October 5, 2026. Supabase Site URL set to https://sportsbook.coopergurrie.com.

Supabase custom SMTP saved by owner with approved sender, smtp.resend.com, port 465, username resend and 60-second interval. Dashboard confirms SMTP enabled and stored password hidden. Key was not read or copied by the agent. Actual delivery testing remains pending.

## Official References

- [Vite](https://vite.dev/guide/)
- [Vercel Hobby](https://vercel.com/docs/plans/hobby)
- [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)
- [Resend verified domains](https://resend.com/docs/dashboard/domains/introduction)
