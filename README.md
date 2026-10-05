# Goldy Fantasy Sportsbook

A private Sleeper fantasy football sportsbook for 12 friends, using virtual currency. This is the clean restart; Apps Script version 1 remains a reference.

## Current Stage

Project and service setup. The local codebase is scaffolded. The visible page is a setup placeholder, not the approved sportsbook implementation. No historical tickets have been imported; no bets or emails can be sent.

## Development

Use Node 22.12+ or Node 24. Run npm ci, npm run dev, npm run lint and npm run build. The committed lockfile fixes dependency versions.

Copy .env.example to .env.local when Supabase exists. Only the project URL and publishable key belong in browser settings. Backend credentials remain in service secret settings, never Git.

## Services

- GitHub: private repository owned by cgurrie03.
- Vercel: Hobby plan, React/Vite hosting for this personal project.
- Supabase: free project, accounts/database/backend operations.
- Resend: free transactional sending and custom SMTP for sign-in links.
- Spaceship: registration/DNS for coopergurrie.com.

See [product decisions](docs/product.md) and [setup progress](docs/setup.md).

Service setup is authorized. Paid upgrades, historical import/settlement and deployment are separate approvals. Importing a repository into Vercel normally starts a deployment; stop at that gate until approved.
