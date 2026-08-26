/* 여우방 V107 Supabase Auth
   - 기존 Apps Script 기능은 유지
   - 로그인 전 Supabase Auth + members 상태/권한을 먼저 검증
   - 실제 전환은 supabase-auth-v107.json 설정 후 사용
*/
window.YW_SUPABASE_AUTH_V107 = {
  _config: null,

  async config(){
    if(this._config) return this._config;
    const r = await fetch('./supabase-auth-v107.json?v=1120', {cache:'no-store'});
    if(!r.ok) throw new Error('Supabase 설정 파일을 불러오지 못했습니다.');
    this._config = await r.json();
    return this._config;
  },

  async enabled(){
    const c = await this.config();
    return c.enabled === true
      && /^https:\/\/.+\.supabase\.co$/.test(c.supabaseUrl || '')
      && !!c.anonKey
      && !String(c.anonKey).includes('PASTE_');
  },

  normalizeInstagramId(loginId){
    return String(loginId || '')
      .trim()
      .replace(/^@/, '')
      .toLowerCase();
  },

  async signIn(loginId, password){
    const c = await this.config();
    if(!(await this.enabled())) return { skipped:true };

    const id = this.normalizeInstagramId(loginId);
    if(!id) throw new Error('인스타 아이디를 입력해 주세요.');
    if(!password) throw new Error('비밀번호를 입력해 주세요.');

    const endpoint = (c.functionsBase || `${c.supabaseUrl}/functions/v1`)
      .replace(/\/+$/, '') + '/auth-login-v107';

    const res = await fetch(endpoint, {
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'apikey':c.anonKey,
        'Authorization':`Bearer ${c.anonKey}`
      },
      body:JSON.stringify({
        instagram_username:id,
        password:String(password)
      }),
      cache:'no-store'
    });

    let data = {};
    try {
      data = await res.json();
    } catch(_) {
      throw new Error('Supabase 로그인 서버 응답 오류');
    }

    if(!res.ok || !data.ok) {
      throw new Error(data.error || 'Supabase 로그인에 실패했습니다.');
    }

    sessionStorage.setItem('ywSupabaseAccessTokenV107', data.access_token || '');
    sessionStorage.setItem('ywSupabaseMemberV107', JSON.stringify(data.member || {}));
    return data;
  },



  async registerExistingMember(nickname, loginId, registrationCode, password){
    const c = await this.config();
    if(!(await this.enabled())) return { skipped:true };

    const id = this.normalizeInstagramId(loginId);
    const name = String(nickname || '').trim();
    const code = String(registrationCode || '').trim().toUpperCase().replace(/\s+/g, '');
    const pw = String(password || '');
    if(!name) throw new Error('여우방 닉네임을 입력해 주세요.');
    if(!id) throw new Error('인스타 아이디를 입력해 주세요.');
    if(!/^[A-Z2-9]{8}$/.test(code)) throw new Error('최초등록코드 8자리를 확인해 주세요.');
    if(!/^\d{4,6}$/.test(pw)) throw new Error('최초 비밀번호는 숫자 4~6자리로 설정해 주세요.');

    const endpoint = (c.functionsBase || `${c.supabaseUrl}/functions/v1`)
      .replace(/\/+$/, '') + '/auth-register-v111';

    const res = await fetch(endpoint, {
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'apikey':c.anonKey,
        'Authorization':`Bearer ${c.anonKey}`
      },
      body:JSON.stringify({
        nickname:name,
        instagram_username:id,
        registration_code:code,
        password:pw
      }),
      cache:'no-store'
    });

    let data = {};
    try { data = await res.json(); }
    catch(_) { throw new Error('Supabase 계정 등록 서버 응답 오류'); }

    if(!res.ok || !data.ok) {
      throw new Error(data.error || 'Supabase 계정 등록에 실패했습니다.');
    }

    if(data.access_token) sessionStorage.setItem('ywSupabaseAccessTokenV107', data.access_token);
    sessionStorage.setItem('ywSupabaseMemberV107', JSON.stringify(data.member || {}));
    return data;
  },

  getAccessToken(){
    return sessionStorage.getItem('ywSupabaseAccessTokenV107') || '';
  },

  getMember(){
    try {
      return JSON.parse(sessionStorage.getItem('ywSupabaseMemberV107') || '{}');
    } catch(_) {
      return {};
    }
  },

  isAdmin(){
    const member = this.getMember();
    return ['admin','staff','operator'].includes(String(member.role || '').toLowerCase());
  },

  clear(){
    sessionStorage.removeItem('ywSupabaseAccessTokenV107');
    sessionStorage.removeItem('ywSupabaseMemberV107');
  }
};
