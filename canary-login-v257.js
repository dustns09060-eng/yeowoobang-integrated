/* Password/ticket stays in function memory; no storage, URLs or logs. */
(function (root) {
  'use strict';
  const normalized = value => String(value || '').trim().toLowerCase().replace(/^@+/, '');
  function eligible(id) {
    const c = root.YW_CANARY_V257_CONFIG;
    return !!(c && c.enabled === true && Array.isArray(c.testInstagramIds) &&
      c.testInstagramIds.length > 0 && c.testInstagramIds.length <= 5 &&
      c.testInstagramIds.map(normalized).includes(normalized(id)));
  }
  async function login(id, password, apiUrl, legacy) {
    const started = performance.now();
    const c = root.YW_CANARY_V257_CONFIG || {};
    const bridgeUrl = c.bridgeApiUrl || apiUrl;
    let reason = 'not_selected', edgeMs = null, bridgeMs = null;
    if (eligible(id)) {
      const controller = new AbortController();
      let timer;
      try {
        if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(c.supabaseUrl || '') ||
            !c.publishableKey || /^sb_secret_/.test(c.publishableKey) ||
            !/^https:\/\//.test(bridgeUrl || '')) throw new Error('configuration');
        // Fail closed if an accidentally supplied JWT claims the service_role.
        if (c.publishableKey.split('.').length === 3) {
          const claim = JSON.parse(atob(c.publishableKey.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
          if (claim.role !== 'anon') throw new Error('configuration');
        }
        const budget = Math.min(8000, Math.max(1000, Number(c.timeoutMs) || 4500));
        const jsonPost = async (url, headers, body) => {
          const r = await fetch(url, { method:'POST', headers, body:JSON.stringify(body),
            cache:'no-store', credentials:'omit', redirect:'follow', signal:controller.signal });
          if (!r.ok) throw new Error('unavailable');
          const data = await r.json();
          if (data.ok !== true) throw new Error('rejected');
          return data;
        };
        const attempt = (async () => {
          const edgeStart = performance.now();
          const proof = await jsonPost(c.supabaseUrl + '/functions/v1/v257-login',
            {'Content-Type':'application/json', apikey:c.publishableKey},
            {instagramId:normalized(id), password:String(password).trim()});
          edgeMs = Math.round(performance.now() - edgeStart);
          if (typeof proof.ticket !== 'string' || proof.ticket.length > 8192) throw new Error('invalid_response');
          const bridgeStart = performance.now();
          const result = await jsonPost(bridgeUrl, {'Content-Type':'text/plain;charset=UTF-8'},
            {action:'canarySessionV257', ticket:proof.ticket});
          bridgeMs = Math.round(performance.now() - bridgeStart);
          if (!/^M-[a-f0-9]+$/i.test(result.token || '') ||
              normalized(result.member?.instagramId) !== normalized(id) || !result.member?.memberId)
            throw new Error('invalid_response');
          return result;
        })();
        const result = await Promise.race([attempt, new Promise((_, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, budget);
        })]);
        return {result, perf:{path:'V257_CANARY', edgeMs, bridgeMs,
          totalBeforeHomeMs:Math.round(performance.now()-started), fallback:false}};
      } catch (e) {
        reason = ['timeout','configuration','invalid_response','rejected'].includes(e?.message) ? e.message : 'unavailable';
      } finally { clearTimeout(timer); controller.abort(); }
    }
    const failedMs = Math.round(performance.now()-started);
    // Exactly one fallback invocation. The original API helper keeps its original retry semantics.
    const result = await legacy();
    return {result, perf:{path:'V257_FALLBACK', fallback:true, reason, edgeMs, bridgeMs,
      canaryAttemptMs:failedMs, totalBeforeHomeMs:Math.round(performance.now()-started)}};
  }
  root.YW_CANARY_V257 = {eligible, login};
})(typeof window === 'undefined' ? globalThis : window);
