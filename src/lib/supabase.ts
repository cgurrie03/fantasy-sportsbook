import { createClient } from '@supabase/supabase-js'
const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
// Configuration can be prepared before the service project exists.
export const supabase = url && publishableKey ? createClient(url, publishableKey) : null
