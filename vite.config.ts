import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { environmentIdentity } from './api/_lib/environment-policy.ts'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env }
  if (env.VITE_SUPABASE_URL || env.VERCEL) {
    const identity = environmentIdentity(env)
    for (const [suffix, value] of Object.entries({
      ENVIRONMENT: identity.environment,
      EXPECTED_PROJECT_REF: identity.project_ref,
      APP_ORIGIN: identity.app_origin,
      DEPLOYMENT_SCOPE: env.VERCEL_ENV ?? 'development',
    })) {
      if (env[`VITE_BOFF_${suffix}`] !== value)
        throw new Error(`VITE_BOFF_${suffix} disagrees with the server environment.`)
    }
    if (env.VITE_SUPABASE_URL !== env.SUPABASE_URL)
      throw new Error('Browser and server database targets disagree.')
    if (identity.environment === 'development' &&
        (!env.BOFF_DEV_OWNER_ID || env.VITE_BOFF_DEV_OWNER_ID !== env.BOFF_DEV_OWNER_ID ||
         !env.VITE_BOFF_DEV_OWNER_EMAIL))
      throw new Error('Development owner identity must be configured consistently.')
    for (const name of Object.keys(env))
      if (/^VITE_.*(SERVICE_ROLE|SECRET|PRIVATE|RESEND)/i.test(name) && env[name])
        throw new Error('Server credentials cannot be exposed to the browser.')
  }
  return { plugins: [react()] }
})
