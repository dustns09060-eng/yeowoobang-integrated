/* V257: default OFF. Public routing hints only; server/SQL independently gate access. */
window.YW_CANARY_V257_CONFIG = Object.freeze({
  enabled: false,
  testInstagramIds: [], // 1-5 normalized Instagram IDs; never passwords/member records
  supabaseUrl: "",    // https://PROJECT.supabase.co
  publishableKey: "", // publishable/anon only. NEVER service_role/secret keys
  bridgeApiUrl: "",  // New deployment URL in the SAME Apps Script project; old deployment stays unchanged
  timeoutMs: 4500     // Entire Canary attempt, including Apps Script session exchange
});
