// lib/supabaseClient.js
// Reads your project's URL + anon (public) key from environment variables.
// Get both from: Supabase dashboard → Project Settings → API

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
