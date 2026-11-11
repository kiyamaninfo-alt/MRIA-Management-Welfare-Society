// Public Configuration
export const CONFIG = {
  SUPABASE_URL: "https://aqbpanrsotkpnqxhlces.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_CjtgAQJgXXLWI-FOft-wzQ_3sekCrWa",
  FUNCTIONS_URL: "https://aqbpanrsotkpnqxhlces.supabase.co/functions/v1",
  ADMIN_EMAIL: "krishaja@gmail.com",
  APP_NAME: "MRIA Management Welfare Association",
  APP_NAME_SI: "MRIA කළමනාකාර අංශයේ සුබසාධක සංගමය",
  HERO_TAGLINE: "Digital Platform - MRIA Management Welfare Association",
  SUB_HEADLINE: "100% DEDICATED STAFF WELFARE",
  FOOTER_TEXT: "© MRIA කළමනාකාර අංශයේ සුබසාධක සංගමය",
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    lock: (name, acquireTimeout, fn) => fn(),
  },
};
