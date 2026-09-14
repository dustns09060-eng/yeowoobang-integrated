// V213: 맞팔요청 수동 확인완료 프론트 연동본. V212 서버 기능 유지.

/**
 * 여우방 통합 프로그램 Apps Script API V162
 * ------------------------------------------------------------
 * 현재 GitHub 프론트(app.js)에서 호출하는 API를 한 파일로 통합한 전체 교체본입니다.
 *
 * 핵심 수정:
 * - 회원계정 시트에 MemberID만 있고 비밀번호해시/Salt/최초등록일이 빈 행은
 *   "실제 계정"이 아니라 placeholder로 처리합니다.
 * - 최초 계정 등록 시 placeholder 행을 그대로 채워 사용합니다. 행 삭제/밀림 없음.
 * - 로그인/회원가입/팔로우리스트/초대별/공지/운영진 기본 기능을 한 라우터에서 처리합니다.
 */

const YW_SPREADSHEET_ID = '1PxeAtZrHS2N2VlKFTfxERyq8SAzgAn7o815q43gZzTY';
const YW_VERSION = 'V219';

// V164: 초대 랭킹/혜택 화면은 운영진 원본을 수정하지 않고
// '여우 초대별 (작업용)'의 현재 월 시트를 읽기 전용으로 사용합니다.
const YW_INVITE_SOURCE_ID_V164 = '1dYMTmlrnFRvDUz_Jv-NjWDL-xHFrSqmXHBFiYeqsS_4';
const YW_SESSION_TTL_SEC = 60 * 60 * 24 * 14; // 14일
const YW_ADMIN_SESSION_TTL_SEC = 60 * 60 * 8;

const SHEETS = {
  FOLLOW: '팔로우리스트',
  ACCOUNT: '회원계정',
  SETTINGS: '설정',
  ADMINS: '운영진회원',
  INVITE: '초대별',
  INVITE_REQUESTS: '참여자',
  NOTICES: '공지',
  FOLLOW_PROGRESS: '회원팔로우진행',
  FOLLOW_USAGE: '팔로우리스트사용기록',
  MATCH_ANALYSIS: '맞팔분석기록',
  MATCH_REQUESTS: '맞팔요청',
  ACTIVITY: '회원활동기록',
  MEMBER_INFO: '회원정보',
  MEMBER_OPS: '회원운영정보',
  ADMIN_LOG: '관리자로그',
  NOTIFICATIONS: '회원알림',
  NOTIFICATION_READ: '알림읽음',
  FIXED_ORDER: '초대앞번호고정_V124'
};

/* =========================================================
   Web entry / JSON response / Router
   ========================================================= */

function doGet(e) {
  try {
    const action = String((e && e.parameter && e.parameter.action) || 'ping').trim();
    const data = routeAction_(action, e && e.parameter ? e.parameter : {}, 'GET');
    return jsonOutput_({ok:true, ...data});
  } catch (err) {
    return jsonOutput_({ok:false, error:errorMessage_(err)});
  }
}

function doPost(e) {
  try {
    let body = {};
    const raw = e && e.postData ? String(e.postData.contents || '') : '';
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch (_) {
        body = e && e.parameter ? e.parameter : {};
      }
    } else {
      body = e && e.parameter ? e.parameter : {};
    }

    const action = String(body.action || '').trim();
    if (!action) throw new Error('action 값이 없습니다.');
    const data = routeAction_(action, body, 'POST');
    return jsonOutput_({ok:true, ...data});
  } catch (err) {
    return jsonOutput_({ok:false, error:errorMessage_(err)});
  }
}

function routeAction_(action, data, method) {
  const routes = {
    ping: () => ({version:YW_VERSION, message:'pong'}),

    publicConfig: () => getPublicConfig_(),
    notices: () => getNotices_(),
    getInviteLeaderboard: () => getInviteLeaderboard_(data),
    getMatchRequestConfig: () => getMatchRequestConfig_(data),

    verifyAccessPassword: () => verifyAccessPassword_(data),
    prepareMemberAccountRegistrationV155: () => prepareMemberAccountRegistrationV155(data),
    registerMemberAccount: () => registerMemberAccount_(data),
    memberLogin: () => memberLogin_(data),
    memberSession: () => memberSession_(data),
    resetMemberPassword: () => resetMemberPassword_(data),
    changeMemberPassword: () => changeMemberPassword_(data),
    supabaseMemberSessionV114: () => { throw new Error('현재 Supabase 인증은 비활성 상태입니다.'); },

    getSecureFollowList: () => getSecureFollowList_(data),
    getFollowProgress: () => getFollowProgress_(data),
    saveFollowProgress: () => saveFollowProgress_(data),
    clearFollowProgress: () => clearFollowProgress_(data),
    logFollowUsage: () => logFollowUsage_(data),
    markFollowStarted: () => markFollowStarted_(data),

    saveMatchAnalysis: () => saveMatchAnalysis_(data),
    getMyAnalysisHistory: () => getMyAnalysisHistory_(data),
    verifyMatchRequestIdentity: () => verifyMatchRequestIdentity_(data),
    getMatchRequests: () => getMatchRequests_(data),
    sendMatchRequest: () => sendMatchRequest_(data),
    markMatchRequestRead: () => beginMatchRequestCheckV215_(data),
    markMatchRequestReadV197: () => beginMatchRequestCheckV215_(data),
    completeMatchRequestV214: () => completeMatchRequestV215_(data),
    completeMatchRequestV215: () => completeMatchRequestV215_(data),

    inviteMemberLookup: () => inviteMemberLookup_(data),
    registerInvite: () => registerInvite_(data),
    inviteAdminLogin: () => inviteAdminLogin_(data),
    getInviteAdmin: () => getInviteAdmin_(data),
    updateInviteStatus: () => updateInviteStatus_(data),
    getInviteSummary: () => getInviteSummary_(data),
    publishInvitePriorityV110: () => publishInvitePriorityV110_(data),

    adminLogin: () => adminSimpleLogin_(data),
    adminSimpleLogin: () => adminSimpleLogin_(data),
    getAdminLogs: () => getAdminLogs_(data),
    getAdminDashboard: () => getAdminDashboard_(data),
    getAdminMembers: () => getAdminMembers_(data),
    setMemberAccountStatus: () => setMemberAccountStatus_(data),
    resetTestMemberAccountV162: () => resetTestMemberAccountV162_(data),
    getMyPage: () => getMyPage_(data),
    getMyActivity: () => getMyActivity_(data),
    getNotificationsV76: () => getNotifications_(data),
    markNotificationReadV76: () => markNotificationRead_(data),
    markAllNotificationsReadV76: () => markAllNotificationsRead_(data),

    addNotice: () => addNotice_(data),
    deleteNotice: () => deleteNotice_(data),
    setAppLock: () => setAppLock_(data),
    setFollowLock: () => setFollowLock_(data),
    setFollowLockPeriod: () => setFollowLockPeriod_(data),
    setMatchPeriod: () => setMatchPeriod_(data),
    setMatchVoteOpen: () => setMatchVoteOpen_(data),
    setMatchRequestPeriod: () => setMatchRequestPeriod_(data),

    // 운영진 확장 UI: 안전한 기본 응답
    getAdminTaskboxV76: () => ({items:[]}),
    getDataIssuesV75: () => ({items:[]}),
    getMatchSubmissionReportV73: () => ({items:[]}),
    getMemberDetailV76: () => getMemberDetail_(data),
    getV73OpsStatus: () => ({ok:true, version:YW_VERSION}),
    getV75MemberOps: () => ({items:[]}),
    saveMemberMemoV75: () => saveMemberMemo_(data),
    setMemberLifecycleV75: () => setMemberLifecycle_(data),
    createBackupV73: () => ({message:'현재 Google 시트가 실시간 원본입니다.'}),
    getMyActivity: () => getMyActivity_(data)
  };

  if (!routes[action]) throw new Error('지원하지 않는 action: ' + action);
  return routes[action]() || {};
}

function jsonOutput_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* =========================================================
   Setup / Sheet helpers
   ========================================================= */

function setupYeowoobangV162() {
  const ss = ss_();
  ensureSheet_(SHEETS.ACCOUNT, ['MemberID','비밀번호해시','Salt','계정상태','최초등록일','마지막로그인','비밀번호변경일','로그인실패횟수']);
  ensureSheet_(SHEETS.FOLLOW_PROGRESS, ['MemberID','닉네임','인스타아이디','조','번호','마지막아이디','마지막닉네임','수정일','오늘방문수','오늘날짜']);
  ensureSheet_(SHEETS.MATCH_ANALYSIS, ['MemberID','닉네임','인스타아이디','전체','맞팔','나만팔로우','상대만팔로우','서로안함','분석일']);
  ensureSheet_(SHEETS.MATCH_REQUESTS, ['RequestID','보낸아이디','받는아이디','메시지','상태','생성일','확인일']);
  ensureSheet_(SHEETS.ACTIVITY, ['MemberID','유형','내용','일시']);
  ensureSheet_(SHEETS.NOTICES, ['NoticeID','내용','등록일','활성']);
  ensureSheet_(SHEETS.NOTIFICATIONS, ['NotificationID','MemberID','제목','내용','생성일','읽음']);
  ensureSheet_(SHEETS.ADMIN_LOG, ['일시','운영진','액션','상세']);
  ensureSheet_(SHEETS.INVITE_REQUESTS, ['ID','초대받은닉네임','초대받은아이디','초대자닉네임','초대자아이디','상태','등록일','처리일','팔로우시작일','취소일','취소사유']);
  return {ok:true, version:YW_VERSION, message:'V162 기본 시트 점검 완료'};
}

function ss_() {
  return SpreadsheetApp.openById(YW_SPREADSHEET_ID);
}

function sheet_(name) {
  const sh = ss_().getSheetByName(name);
  if (!sh) throw new Error("'" + name + "' 시트를 찾을 수 없습니다.");
  return sh;
}

// V212: 알림센터/맞팔요청 상태 조회용 안전 시트 getter 복구.
// 시트가 없으면 오류를 던지지 않고 null을 반환합니다.
function getSheet_(name) {
  return ss_().getSheetByName(name);
}

function ensureSheet_(name, headers) {
  const ss = ss_();
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1,1,1,headers.length).setValues([headers]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function settingsMap_() {
  // V209: 설정 시트를 매 API 요청마다 다시 읽지 않도록 짧은 서버 캐시 사용
  const cache = CacheService.getScriptCache();
  const cached = cache.get('YW_SETTINGS_V209');
  if (cached) {
    try { return JSON.parse(cached); } catch (_) {}
  }

  const sh = sheet_(SHEETS.SETTINGS);
  const last = Math.max(sh.getLastRow(), 1);
  const rows = sh.getRange(1,1,last,2).getDisplayValues();
  const map = {};
  rows.forEach(r => {
    const k = String(r[0] || '').trim();
    if (k) map[k] = String(r[1] || '').trim();
  });

  try { cache.put('YW_SETTINGS_V209', JSON.stringify(map), 15); } catch (_) {}
  return map;
}

function setting_(...keys) {
  const map = settingsMap_();
  for (const k of keys) if (Object.prototype.hasOwnProperty.call(map,k)) return map[k];
  return '';
}

function bool_(v) {
  return /^(true|1|yes|on)$/i.test(String(v || '').trim());
}

function normInstagram_(v) {
  return String(v || '').trim().replace(/^@+/, '').toLowerCase().replace(/\s+/g,'');
}

function clean_(v) {
  return String(v == null ? '' : v).trim();
}

function nowText_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');
}

function errorMessage_(err) {
  return String((err && err.message) || err || '처리 중 오류가 발생했습니다.');
}

function uuid_() {
  return Utilities.getUuid();
}

function sha256_(text) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text), Utilities.Charset.UTF_8);
  return bytes.map(b => ('0' + ((b < 0 ? b + 256 : b).toString(16))).slice(-2)).join('');
}

function newSalt_() {
  return uuid_() + uuid_();
}

function passwordHash_(password, salt) {
  // V161: 기존 회원계정과 동일한 V89 해시 규칙으로 복구
  return sha256_('YEOWOO_MEMBER_V89|' + String(salt) + '|' + String(password));
}

// V160에서 잠시 생성된 계정도 로그인 불능이 되지 않도록 호환 확인용
function passwordHashV160Legacy_(password, salt) {
  return sha256_(String(salt) + ':' + String(password));
}

function passwordMatches_(password, salt, storedHash) {
  const stored = clean_(storedHash).toLowerCase();
  if (!stored || !salt) return {ok:false, legacyV160:false};

  const v89 = passwordHash_(password, salt).toLowerCase();
  if (v89 === stored) return {ok:true, legacyV160:false};

  const v160 = passwordHashV160Legacy_(password, salt).toLowerCase();
  if (v160 === stored) return {ok:true, legacyV160:true};

  return {ok:false, legacyV160:false};
}

function validPassword_(p) {
  return /^\d{4,6}$/.test(String(p || ''));
}


/* =========================================================
   V163 Google Play review account
   - 보호 원본(팔로우리스트 / 여우 초대별 작업용)에 행을 추가하지 않습니다.
   - 계정 정보는 Script Properties에만 저장합니다.
   ========================================================= */

const GP_REVIEW_V163 = {
  USERNAME: 'google_review_test',
  NICKNAME: 'Google Play 심사',
  MEMBER_ID: 'GP-REVIEW-V163',
  ENABLED_KEY: 'GP_REVIEW_V163_ENABLED',
  SALT_KEY: 'GP_REVIEW_V163_SALT',
  HASH_KEY: 'GP_REVIEW_V163_HASH'
};

function googlePlayReviewPropertiesV163_() {
  return PropertiesService.getScriptProperties();
}

function googlePlayReviewEnabledV163_() {
  return googlePlayReviewPropertiesV163_().getProperty(GP_REVIEW_V163.ENABLED_KEY) === 'true';
}

function googlePlayReviewMemberV163_() {
  return {
    row: 0,
    memberId: GP_REVIEW_V163.MEMBER_ID,
    no: GP_REVIEW_V163.MEMBER_ID,
    nickname: GP_REVIEW_V163.NICKNAME,
    instagramId: GP_REVIEW_V163.USERNAME,
    status: 'ACTIVE',
    statusLabel: ''
  };
}

function googlePlayReviewAccountV163_() {
  return {
    row: 0,
    values: [GP_REVIEW_V163.MEMBER_ID, '', '', '정상', '', '', '', 0]
  };
}

function googlePlayReviewPasswordMatchesV163_(password) {
  if (!googlePlayReviewEnabledV163_()) return false;
  const props = googlePlayReviewPropertiesV163_();
  const salt = clean_(props.getProperty(GP_REVIEW_V163.SALT_KEY));
  const storedHash = clean_(props.getProperty(GP_REVIEW_V163.HASH_KEY));
  if (!salt || !storedHash) return false;
  return passwordHash_(clean_(password), salt).toLowerCase() === storedHash.toLowerCase();
}

function issueGooglePlayReviewTokenV163_() {
  const token = 'R-' + uuid_().replace(/-/g,'') + uuid_().replace(/-/g,'');
  sessionCache_().put('review:' + token, '1', YW_SESSION_TTL_SEC);
  return token;
}

/**
 * Apps Script 편집기에서 이 함수를 1회 실행하세요.
 * 보호 원본 시트는 수정하지 않습니다.
 * 실행 로그에 Google Play Console에 입력할 사용자 이름/6자리 비밀번호가 표시됩니다.
 */
function setupGooglePlayReviewAccountV163() {
  const props = googlePlayReviewPropertiesV163_();
  const password = String(Math.floor(100000 + Math.random() * 900000));
  const salt = newSalt_();
  const hash = passwordHash_(password, salt);

  props.setProperties({
    [GP_REVIEW_V163.ENABLED_KEY]: 'true',
    [GP_REVIEW_V163.SALT_KEY]: salt,
    [GP_REVIEW_V163.HASH_KEY]: hash
  }, false);

  const message = [
    'Google Play 심사용 계정 생성 완료',
    '사용자 이름: ' + GP_REVIEW_V163.USERNAME,
    '비밀번호: ' + password,
    '로그인 경로: 앱 실행 → 입장하기 → 회원 로그인',
    '※ 비밀번호는 이 실행 로그에서 확인 후 안전한 곳에 기록하세요.'
  ].join('\\n');

  console.log(message);
  Logger.log(message);

  return {
    ok: true,
    username: GP_REVIEW_V163.USERNAME,
    password: password,
    nickname: GP_REVIEW_V163.NICKNAME,
    message: '심사용 계정을 만들었습니다. 실행 로그의 비밀번호를 기록하세요.'
  };
}

/** 심사 완료 뒤 필요할 때만 실행 */
function disableGooglePlayReviewAccountV163() {
  const props = googlePlayReviewPropertiesV163_();
  props.setProperty(GP_REVIEW_V163.ENABLED_KEY, 'false');
  return {ok:true, message:'Google Play 심사용 계정을 비활성화했습니다.'};
}

/** 현재 활성 상태만 확인. 비밀번호는 노출하지 않습니다. */
function checkGooglePlayReviewAccountV163() {
  return {
    ok: true,
    enabled: googlePlayReviewEnabledV163_(),
    username: GP_REVIEW_V163.USERNAME,
    nickname: GP_REVIEW_V163.NICKNAME
  };
}

/* =========================================================
   Member lookup / Account helpers
   ========================================================= */

function followMembers_() {
  const sh = sheet_(SHEETS.FOLLOW);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const rows = sh.getRange(2,1,last-1,3).getDisplayValues();
  const out = [];
  rows.forEach((r,i) => {
    const no = clean_(r[0]);
    const nickname = clean_(r[1]);
    const instagramId = normInstagram_(r[2]);
    if (!nickname) return;
    // 계정정지 예약번호 1826은 화면 유지
    if (no === '1826' && !instagramId) {
      out.push({row:i+2, memberId:no, no:no, nickname:nickname, instagramId:'', status:'SUSPENDED', statusLabel:'계정정지'});
      return;
    }
    if (!instagramId) return;
    out.push({row:i+2, memberId:no, no:no, nickname:nickname, instagramId:instagramId, status:'ACTIVE', statusLabel:''});
  });
  return out;
}

function findFollowMemberByIdentity_(nickname, instagramId) {
  const nick = clean_(nickname);
  const insta = normInstagram_(instagramId);
  return followMembers_().find(m => m.nickname === nick && m.instagramId === insta) || null;
}

function findFollowMemberByInstagram_(instagramId) {
  const insta = normInstagram_(instagramId);
  return followMembers_().find(m => m.instagramId === insta) || null;
}

function findFollowMemberById_(memberId) {
  const id = clean_(memberId);
  return followMembers_().find(m => String(m.memberId) === id) || null;
}

function accountSheet_() {
  return ensureSheet_(SHEETS.ACCOUNT, ['MemberID','비밀번호해시','Salt','계정상태','최초등록일','마지막로그인','비밀번호변경일','로그인실패횟수']);
}

function findAccountRow_(memberId) {
  const sh = accountSheet_();
  const last = sh.getLastRow();
  if (last < 2) return null;
  const values = sh.getRange(2,1,last-1,8).getValues();
  for (let i=0;i<values.length;i++) {
    if (String(values[i][0] || '').trim() === String(memberId || '').trim()) {
      return {row:i+2, values:values[i]};
    }
  }
  return null;
}

function isRealAccount_(acc) {
  if (!acc) return false;
  const v = acc.values || [];
  return !!(clean_(v[1]) || clean_(v[2]) || clean_(v[4]));
}

function getAccountStatus_(acc) {
  if (!acc) return '미등록';
  return clean_(acc.values[3]) || '정상';
}

function memberPayload_(member) {
  const admin = findAdminByInstagram_(member.instagramId);
  return {
    memberId:String(member.memberId || member.no || ''),
    no:String(member.no || member.memberId || ''),
    nickname:member.nickname || '',
    instagramId:member.instagramId || '',
    status:member.status || 'ACTIVE',
    adminEligible:!!admin,
    role:admin ? admin.role : '회원'
  };
}

/* =========================================================
   Sessions
   ========================================================= */

function sessionCache_() {
  return CacheService.getScriptCache();
}

function issueMemberToken_(memberId) {
  const token = 'M-' + uuid_().replace(/-/g,'') + uuid_().replace(/-/g,'');
  sessionCache_().put('member:' + token, String(memberId), YW_SESSION_TTL_SEC);
  return token;
}

function requireMember_(token) {
  const t = clean_(token);
  if (!t) throw new Error('회원 로그인이 필요합니다.');

  // V163: Google Play 심사용 가상 회원 세션
  if (googlePlayReviewEnabledV163_() && sessionCache_().get('review:' + t)) {
    sessionCache_().put('review:' + t, '1', YW_SESSION_TTL_SEC);
    return {
      token: t,
      member: googlePlayReviewMemberV163_(),
      account: googlePlayReviewAccountV163_(),
      reviewAccount: true
    };
  }

  const memberId = sessionCache_().get('member:' + t);
  if (!memberId) throw new Error('로그인 시간이 만료되었습니다. 다시 로그인해 주세요.');
  const member = findFollowMemberById_(memberId);
  if (!member) throw new Error('회원 정보를 찾을 수 없습니다.');
  const acc = findAccountRow_(memberId);
  if (!isRealAccount_(acc)) throw new Error('프로그램 계정이 초기화되었습니다. 계정 등록을 다시 해주세요.');
  if (getAccountStatus_(acc) !== '정상') throw new Error('현재 로그인할 수 없는 계정 상태입니다.');
  // 세션 연장
  sessionCache_().put('member:' + t, String(memberId), YW_SESSION_TTL_SEC);
  return {token:t, member:member, account:acc};
}

/* =========================================================
   Public config / access
   ========================================================= */

function getPublicConfig_() {
  const m = settingsMap_();

  // V205: 수동 잠금 + 예약 잠금 기간을 함께 계산
  const followManualLocked = bool_(m['팔로우리스트잠금']);
  const followLockStartAt = m['팔로우리스트잠금시작'] || '';
  const followLockEndAt = m['팔로우리스트잠금종료'] || '';
  const followStart = followLockStartAt ? new Date(followLockStartAt) : null;
  const followEnd = followLockEndAt ? new Date(followLockEndAt) : null;
  const followNow = new Date();
  const followScheduledLocked = Boolean(
    followStart && followEnd &&
    !isNaN(followStart.getTime()) && !isNaN(followEnd.getTime()) &&
    followNow >= followStart && followNow <= followEnd
  );

  // V208: 맞팔확인도 팔로우리스트와 같은 '잠금' 방식으로 통일
  // 기존 맞팔투표활성 값은 역으로 사용: true=사용 가능, false=수동 잠금
  const matchManualLocked = !bool_(m['맞팔투표활성']);
  const matchLockStartAt = m['맞팔확인기간시작'] || '';
  const matchLockEndAt = m['맞팔확인기간종료'] || '';
  const matchStart = matchLockStartAt ? new Date(matchLockStartAt) : null;
  const matchEnd = matchLockEndAt ? new Date(matchLockEndAt) : null;
  const matchScheduledLocked = Boolean(
    matchStart && matchEnd &&
    !isNaN(matchStart.getTime()) && !isNaN(matchEnd.getTime()) &&
    followNow >= matchStart && followNow <= matchEnd
  );
  const matchLockedEffective = matchManualLocked || matchScheduledLocked;

  return {
    version: m['버전'] || YW_VERSION,
    appLocked: bool_(m['앱잠금'] || m['앱잠급']),
    followLocked: followManualLocked || followScheduledLocked,
    followManualLocked: followManualLocked,
    followScheduledLocked: followScheduledLocked,
    matchLocked: matchLockedEffective,
    matchManualLocked: matchManualLocked,
    matchScheduledLocked: matchScheduledLocked,
    matchVoteOpen: !matchLockedEffective,
    matchVoteTitle: m['맞팔투표제목'] || '맞팔확인',
    matchStartAt: matchLockStartAt,
    matchEndAt: matchLockEndAt,
    matchLockStartAt: matchLockStartAt,
    matchLockEndAt: matchLockEndAt,
    matchPeriodScheduled: Boolean(matchLockStartAt && matchLockEndAt),
    followLockStartAt: m['팔로우리스트잠금시작'] || '',
    followLockEndAt: m['팔로우리스트잠금종료'] || '',
    notice: m['공지'] || '',
    securityVersion: YW_VERSION,
    forceUpdate: bool_(m['강제업데이트'])
  };
}

function verifyAccessPassword_(data) {
  const mode = clean_(data.mode || data.type || 'access');
  const password = clean_(data.password);
  const expected = mode === 'admin'
    ? (setting_('운영진비밀번호') || setting_('운영진공동비밀번호'))
    : setting_('접속비밀번호');
  if (expected && password !== expected) throw new Error('비밀번호가 일치하지 않습니다.');
  return {granted:true, mode:mode, publicConfig:getPublicConfig_()};
}

/* =========================================================
   Member registration / login
   ========================================================= */

/**
 * V155 호환 액션.
 * V160에서는 placeholder를 삭제하지 않고 "가입 가능" 여부만 검사합니다.
 * 실제 registerMemberAccount_가 같은 행을 채워서 사용합니다.
 */
function prepareMemberAccountRegistrationV155(data) {
  const member = findFollowMemberByIdentity_(data.nickname, data.instagramId);
  if (!member) throw new Error('팔로우리스트의 닉네임과 인스타 아이디가 일치하지 않습니다.');

  const acc = findAccountRow_(member.memberId);
  if (isRealAccount_(acc)) {
    throw new Error('이미 계정이 등록되어 있습니다. 로그인하거나 비밀번호 찾기를 이용해 주세요.');
  }
  return {memberId:String(member.memberId), accountExists:false, placeholder:true};
}

function registerMemberAccount_(data) {
  const nickname = clean_(data.nickname);
  const instagramId = normInstagram_(data.instagramId);
  const password = clean_(data.password);

  if (!nickname || !instagramId || !password) throw new Error('모든 항목을 입력해 주세요.');
  if (!validPassword_(password)) throw new Error('비밀번호는 숫자 4~6자리로 설정해 주세요.');

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const member = findFollowMemberByIdentity_(nickname, instagramId);
    if (!member) throw new Error('팔로우리스트의 닉네임과 인스타 아이디가 일치하지 않습니다.');

    const sh = accountSheet_();
    let acc = findAccountRow_(member.memberId);
    if (isRealAccount_(acc)) throw new Error('이미 계정이 등록되어 있습니다. 로그인해 주세요.');

    const salt = newSalt_();
    const hash = passwordHash_(password, salt);
    const now = new Date();

    if (acc) {
      // placeholder 행을 그대로 채움: 행 삭제/번호 밀림 없음
      sh.getRange(acc.row,1,1,8).setValues([[
        String(member.memberId), hash, salt, '정상', now, now, now, 0
      ]]);
    } else {
      sh.appendRow([String(member.memberId), hash, salt, '정상', now, now, now, 0]);
    }

    const token = issueMemberToken_(member.memberId);
    logActivity_(member.memberId, '계정', '최초 계정 등록');
    return {token:token, member:memberPayload_(member)};
  } finally {
    lock.releaseLock();
  }
}

function memberLogin_(data) {
  const instagramId = normInstagram_(data.instagramId);
  const password = clean_(data.password);
  if (!instagramId || !password) throw new Error('인스타 아이디와 비밀번호를 입력해 주세요.');
  if (!validPassword_(password)) throw new Error('비밀번호는 숫자 4~6자리입니다.');

  // V163: 보호 원본 시트에 회원을 추가하지 않는 Google Play 전용 심사 계정
  if (instagramId === GP_REVIEW_V163.USERNAME) {
    if (!googlePlayReviewEnabledV163_()) throw new Error('현재 사용할 수 없는 심사용 계정입니다.');
    if (!googlePlayReviewPasswordMatchesV163_(password)) throw new Error('비밀번호가 일치하지 않습니다.');
    const member = googlePlayReviewMemberV163_();
    const token = issueGooglePlayReviewTokenV163_();
    logActivity_(member.memberId, '로그인', 'Google Play 심사용 계정 로그인');
    return {token:token, member:memberPayload_(member)};
  }

  const member = findFollowMemberByInstagram_(instagramId);
  if (!member) throw new Error('팔로우리스트에서 회원 정보를 찾을 수 없습니다.');

  const acc = findAccountRow_(member.memberId);
  if (!isRealAccount_(acc)) {
    throw new Error('등록된 프로그램 계정이 없습니다. 계정 등록을 먼저 해주세요.');
  }

  const status = getAccountStatus_(acc);
  if (status !== '정상') throw new Error('현재 로그인할 수 없는 계정 상태입니다.');

  const v = acc.values;
  const salt = clean_(v[2]);
  const match = passwordMatches_(password, salt, v[1]);

  if (!match.ok) {
    const fail = Number(v[7] || 0) + 1;
    accountSheet_().getRange(acc.row,8).setValue(fail);
    throw new Error('비밀번호가 일치하지 않습니다.');
  }

  // V160 방식으로 생성된 계정이면 로그인 성공과 동시에 기존 V89 방식으로 안전하게 마이그레이션
  if (match.legacyV160) {
    const newSalt = newSalt_();
    const newHash = passwordHash_(password, newSalt);
    accountSheet_().getRange(acc.row,2).setValue(newHash);
    accountSheet_().getRange(acc.row,3).setValue(newSalt);
    accountSheet_().getRange(acc.row,7).setValue(new Date());
  }

  accountSheet_().getRange(acc.row,6).setValue(new Date());
  accountSheet_().getRange(acc.row,8).setValue(0);

  const token = issueMemberToken_(member.memberId);
  logActivity_(member.memberId, '로그인', '프로그램 로그인');
  return {token:token, member:memberPayload_(member)};
}

function memberSession_(data) {
  const s = requireMember_(data.token);
  return {token:s.token, member:memberPayload_(s.member)};
}


function resetMemberPassword_(data) {
  const nickname = clean_(data.nickname);
  const instagramId = normInstagram_(data.instagramId);
  const memberId = clean_(data.memberId);
  const newPassword = clean_(data.newPassword);

  if (!nickname || !instagramId || !memberId || !newPassword) {
    throw new Error('닉네임, 인스타 아이디, 회원번호, 새 비밀번호를 모두 입력해 주세요.');
  }
  if (!validPassword_(newPassword)) {
    throw new Error('새 비밀번호는 숫자 4~6자리로 설정해 주세요.');
  }

  const member = findFollowMemberByIdentity_(nickname, instagramId);
  if (!member || String(member.memberId) !== memberId) {
    throw new Error('닉네임, 인스타 아이디, 회원번호가 팔로우리스트 정보와 일치하지 않습니다.');
  }

  const acc = findAccountRow_(member.memberId);

  // 계정을 만든 적 없는 회원은 비밀번호 찾기로 계정을 만들지 않음.
  if (!isRealAccount_(acc)) {
    throw new Error('등록된 프로그램 계정이 없습니다. 비밀번호 찾기가 아니라 계정 등록을 이용해 주세요.');
  }

  const salt = newSalt_();
  const hash = passwordHash_(newPassword, salt);
  const now = new Date();

  accountSheet_().getRange(acc.row,2).setValue(hash);
  accountSheet_().getRange(acc.row,3).setValue(salt);
  accountSheet_().getRange(acc.row,4).setValue('정상');
  if (!accountSheet_().getRange(acc.row,5).getValue()) {
    accountSheet_().getRange(acc.row,5).setValue(now);
  }
  accountSheet_().getRange(acc.row,7).setValue(now);
  accountSheet_().getRange(acc.row,8).setValue(0);

  logActivity_(member.memberId, '계정', '비밀번호 재설정');
  return {message:'새 비밀번호가 설정되었습니다. 새 비밀번호로 로그인해 주세요.'};
}

function changeMemberPassword_(data) {
  const s = requireMember_(data.token);
  if (s.reviewAccount) throw new Error('Google Play 심사용 계정에서는 비밀번호 변경을 사용할 수 없습니다.');
  const currentPassword = clean_(data.currentPassword);
  const newPassword = clean_(data.newPassword);
  if (!validPassword_(newPassword)) throw new Error('새 비밀번호는 숫자 4~6자리로 설정해 주세요.');

  const acc = findAccountRow_(s.member.memberId);
  if (!isRealAccount_(acc)) throw new Error('등록된 계정이 없습니다.');
  const currentMatch = passwordMatches_(currentPassword, clean_(acc.values[2]), acc.values[1]);
  if (!currentMatch.ok) {
    throw new Error('현재 비밀번호가 일치하지 않습니다.');
  }

  const salt = newSalt_();
  const hash = passwordHash_(newPassword, salt);
  accountSheet_().getRange(acc.row,2,1,7).setValues([[
    hash, salt, '정상', acc.values[4] || new Date(), new Date(), new Date(), 0
  ]]);

  logActivity_(s.member.memberId, '계정', '비밀번호 변경');
  return {message:'비밀번호가 변경되었습니다.'};
}

/* =========================================================
   Follow list / progress
   ========================================================= */

function getSecureFollowList_(data) {
  requireMember_(data.token);
  const members = followMembers_().map(m => ({
    no:m.no,
    name:m.nickname,
    id:m.instagramId,
    status:m.status,
    statusLabel:m.statusLabel
  }));
  return {members:members, count:members.length, version:YW_VERSION};
}

function getFollowProgress_(data) {
  const s = requireMember_(data.token);
  const sh = ensureSheet_(SHEETS.FOLLOW_PROGRESS, ['MemberID','닉네임','인스타아이디','조','번호','마지막아이디','마지막닉네임','수정일','오늘방문수','오늘날짜']);
  const last = sh.getLastRow();
  let row = null;
  if (last >= 2) {
    const vals = sh.getRange(2,1,last-1,10).getValues();
    for (let i=0;i<vals.length;i++) if (String(vals[i][0]) === String(s.member.memberId)) { row=vals[i]; break; }
  }
  if (!row) return {progress:null, todayCount:0};
  return {
    progress: row[5] ? {
      group:Number(row[3] || 1),
      no:String(row[4] || ''),
      id:normInstagram_(row[5]),
      name:clean_(row[6]),
      timestamp: row[7] instanceof Date ? row[7].getTime() : Date.now()
    } : null,
    todayCount:Number(row[8] || 0)
  };
}

function saveFollowProgress_(data) {
  const s = requireMember_(data.token);
  const p = data.progress || {};
  const sh = ensureSheet_(SHEETS.FOLLOW_PROGRESS, ['MemberID','닉네임','인스타아이디','조','번호','마지막아이디','마지막닉네임','수정일','오늘방문수','오늘날짜']);
  const last = sh.getLastRow();
  let target = 0;
  if (last >= 2) {
    const ids = sh.getRange(2,1,last-1,1).getDisplayValues();
    for (let i=0;i<ids.length;i++) if (ids[i][0] === String(s.member.memberId)) {target=i+2;break;}
  }
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Seoul', 'yyyy-MM-dd');
  let count = 1;
  if (target) {
    const oldDate = clean_(sh.getRange(target,10).getDisplayValue());
    count = oldDate === today ? Number(sh.getRange(target,9).getValue() || 0) + 1 : 1;
  } else target = sh.getLastRow()+1;

  sh.getRange(target,1,1,10).setValues([[
    String(s.member.memberId), s.member.nickname, s.member.instagramId,
    Number(p.group || 1), clean_(p.no), normInstagram_(p.id), clean_(p.name),
    new Date(), count, today
  ]]);
  return {todayCount:count};
}

function clearFollowProgress_(data) {
  const s = requireMember_(data.token);
  const sh = ensureSheet_(SHEETS.FOLLOW_PROGRESS, ['MemberID','닉네임','인스타아이디','조','번호','마지막아이디','마지막닉네임','수정일','오늘방문수','오늘날짜']);
  if (sh.getLastRow() >= 2) {
    const ids = sh.getRange(2,1,sh.getLastRow()-1,1).getDisplayValues();
    for (let i=0;i<ids.length;i++) {
      if (ids[i][0] === String(s.member.memberId)) {
        sh.getRange(i+2,4,1,5).clearContent();
        return {todayCount:Number(sh.getRange(i+2,9).getValue() || 0)};
      }
    }
  }
  return {todayCount:0};
}

function logFollowUsage_(data) {
  const s = requireMember_(data.token);
  const sh = ensureSheet_(SHEETS.FOLLOW_USAGE, ['MemberID','닉네임','인스타아이디','액션','상세','일시']);
  sh.appendRow([s.member.memberId,s.member.nickname,s.member.instagramId,clean_(data.type || '사용'),clean_(data.detail),new Date()]);
  return {message:'기록 완료'};
}

function markFollowStarted_(data) {
  const member = findFollowMemberByIdentity_(data.name, data.instagram);
  if (!member) throw new Error('회원정보를 확인하지 못했습니다.');
  const sh = ensureSheet_(SHEETS.MEMBER_OPS, ['MemberID','닉네임','인스타아이디','팔로우시작','팔로우시작일','상태','메모']);
  let target = 0;
  if (sh.getLastRow() >= 2) {
    const ids = sh.getRange(2,1,sh.getLastRow()-1,1).getDisplayValues();
    for (let i=0;i<ids.length;i++) if (ids[i][0] === String(member.memberId)) {target=i+2;break;}
  }
  if (!target) target=sh.getLastRow()+1;
  sh.getRange(target,1,1,7).setValues([[member.memberId,member.nickname,member.instagramId,true,new Date(),'정상','']]);
  return {message:'팔로우리스트 1번 시작이 기록되었습니다.'};
}

/* =========================================================
   Match analysis / requests
   ========================================================= */

function saveMatchAnalysis_(data) {
  const s = requireMember_(data.token);
  const c = data.counts || {};
  const sh = ensureSheet_(SHEETS.MATCH_ANALYSIS, ['MemberID','닉네임','인스타아이디','전체','맞팔','나만팔로우','상대만팔로우','서로안함','분석일']);
  sh.appendRow([s.member.memberId,s.member.nickname,s.member.instagramId,
    Number(c.total||0),Number(c.mutual||0),Number(c.onlyMe||0),Number(c.fansOnly||0),Number(c.neither||0),new Date()]);
  logActivity_(s.member.memberId,'맞팔분석','맞팔분석 완료');
  return {message:'분석기록 저장 완료'};
}

function getMyAnalysisHistory_(data) {
  const s = requireMember_(data.token);
  const sh = ensureSheet_(SHEETS.MATCH_ANALYSIS, ['MemberID','닉네임','인스타아이디','전체','맞팔','나만팔로우','상대만팔로우','서로안함','분석일']);
  const items = [];
  if (sh.getLastRow() >= 2) {
    const rows = sh.getRange(2,1,sh.getLastRow()-1,9).getValues();
    rows.forEach(r => {
      if (String(r[0]) !== String(s.member.memberId)) return;
      items.push({total:Number(r[3]||0),mutual:Number(r[4]||0),onlyMe:Number(r[5]||0),fansOnly:Number(r[6]||0),neither:Number(r[7]||0),at:formatDate_(r[8])});
    });
  }
  items.reverse();
  return {items:items.slice(0,50)};
}

function getMatchRequestConfig_() {
  const m=settingsMap_();
  return {period:{active:true,startAt:m['맞팔요청기간시작']||'',endAt:m['맞팔요청기간종료']||''}};
}

function verifyMatchRequestIdentity_(data) {
  const member = findFollowMemberByInstagram_(data.instagramId || data.instagram);
  if (!member) throw new Error('팔로우리스트 회원이 아닙니다.');
  return {member:{name:member.nickname,instagramId:member.instagramId}};
}

function getMatchRequests_(data) {
  const instagram = normInstagram_(data.instagramId || data.instagram);
  const sh = ensureSheet_(SHEETS.MATCH_REQUESTS, ['RequestID','보낸아이디','받는아이디','메시지','상태','생성일','확인일']);
  const received=[], sent=[];
  if (sh.getLastRow() >= 2) {
    sh.getRange(2,1,sh.getLastRow()-1,7).getValues().forEach(r=>{
      const from=normInstagram_(r[1]), to=normInstagram_(r[2]);
      const fromMember=findFollowMemberByInstagram_(from);
      const toMember=findFollowMemberByInstagram_(to);
      const x={
        id:clean_(r[0]),
        from:from,
        to:to,
        fromInstagram:from,
        toInstagram:to,
        fromName:fromMember ? fromMember.nickname : '',
        toName:toMember ? toMember.nickname : '',
        message:clean_(r[3]),
        status:clean_(r[4])||'NEW',
        createdAt:formatDate_(r[5]),
        readAt:formatDate_(r[6])
      };
      if (x.to===instagram) received.push(x);
      if (x.from===instagram) sent.push(x);
    });
  }
  return {received:received.reverse(),sent:sent.reverse()};
}


/**
 * V189 - 맞팔요청 상대방 알림 생성
 * 회원알림 시트에 저장하여 상대방이 나중에 로그인해도 확인할 수 있게 합니다.
 */
function createMatchRequestNotificationV194_(from, toMember, fromName, requestId) {
  // 기존 회원알림 6열은 그대로 유지하고 7열에 맞팔 RequestID만 추가합니다.
  const sh=ensureSheet_(SHEETS.NOTIFICATIONS,[
    'NotificationID','MemberID','제목','내용','생성일','읽음'
  ]);

  if (!toMember || !toMember.memberId) {
    throw new Error('알림을 받을 회원의 MemberID를 확인할 수 없습니다.');
  }

  if (!clean_(sh.getRange(1,7).getValue())) {
    sh.getRange(1,7).setValue('RequestID');
  }

  const senderLabel=clean_(fromName) || ('@' + from);
  sh.appendRow([
    uuid_(),
    String(toMember.memberId),
    '맞팔 요청이 도착했어요',
    senderLabel + '님이 맞팔 확인을 요청했습니다.',
    new Date(),
    false,
    clean_(requestId)
  ]);
}

/**
 * V214 - 요청을 보낸 사람 알림센터에도 보낸 요청을 남깁니다.
 * 상태는 MATCH_REQUESTS 시트의 같은 RequestID를 읽어
 * 요청 보냄 -> 상대방 확인 완료 로 자동 표시됩니다.
 */
function createMatchRequestSentNotificationV214_(fromMember, toMember, requestId) {
  const sh=ensureSheet_(SHEETS.NOTIFICATIONS,[
    'NotificationID','MemberID','제목','내용','생성일','읽음'
  ]);
  if(!clean_(sh.getRange(1,7).getValue())) sh.getRange(1,7).setValue('RequestID');

  if(!fromMember || !fromMember.memberId) return;

  const targetLabel=clean_(toMember && toMember.nickname) ||
    ('@' + normInstagram_(toMember && toMember.instagramId));

  sh.appendRow([
    uuid_(),
    String(fromMember.memberId),
    '맞팔 요청을 보냈어요',
    targetLabel + '님에게 맞팔 확인을 요청했어요.',
    new Date(),
    true,
    clean_(requestId)
  ]);
}

/**
 * V214 - 상대방이 최종 '확인 완료'를 직접 눌렀을 때
 * 요청을 보낸 회원에게 새 알림을 생성합니다.
 */
function createMatchRequestCompletedNotificationV214_(fromMember, toMember, requestId, readAt) {
  const sh=ensureSheet_(SHEETS.NOTIFICATIONS,[
    'NotificationID','MemberID','제목','내용','생성일','읽음'
  ]);
  if(!clean_(sh.getRange(1,7).getValue())) sh.getRange(1,7).setValue('RequestID');

  if(!fromMember || !fromMember.memberId) return;

  const receiverLabel=clean_(toMember && toMember.nickname) ||
    ('@' + normInstagram_(toMember && toMember.instagramId));

  // 동일 RequestID의 완료알림 중복 생성 방지
  if(sh.getLastRow()>=2){
    const rows=sh.getRange(2,1,sh.getLastRow()-1,7).getValues();
    const exists=rows.some(r=>
      String(r[1])===String(fromMember.memberId) &&
      clean_(r[2])==='맞팔 요청 확인 완료' &&
      clean_(r[6])===clean_(requestId)
    );
    if(exists) return;
  }

  sh.appendRow([
    uuid_(),
    String(fromMember.memberId),
    '맞팔 요청 확인 완료',
    '✅ ' + receiverLabel + '님이 맞팔 요청을 확인했어요.',
    readAt instanceof Date ? readAt : new Date(),
    false,
    clean_(requestId)
  ]);
}



/**
 * V191 1회 점검용:
 * 맞팔요청 시트의 헤더만 현재 서버 스키마로 정리합니다.
 * 데이터 행은 삭제하지 않습니다.
 */
function repairMatchRequestHeadersV191() {
  const sh=ensureSheet_(SHEETS.MATCH_REQUESTS,[
    'RequestID','보낸아이디','받는아이디','메시지','상태','생성일','확인일'
  ]);
  sh.getRange(1,1,1,7).setValues([[
    'RequestID','보낸아이디','받는아이디','메시지','상태','생성일','확인일'
  ]]);
  return {message:'맞팔요청 헤더를 V191 기준으로 정리했습니다.'};
}

function ensureMatchRequestNotificationsV215_(fromMember,toMember,requestId,from,to){
  const notifSh=ensureSheet_(SHEETS.NOTIFICATIONS,[
    'NotificationID','MemberID','제목','내용','생성일','읽음'
  ]);
  if(!clean_(notifSh.getRange(1,7).getValue())) notifSh.getRange(1,7).setValue('RequestID');

  const rows=notifSh.getLastRow()>=2
    ? notifSh.getRange(2,1,notifSh.getLastRow()-1,7).getValues()
    : [];

  const hasReceived=rows.some(r=>
    String(r[1])===String(toMember.memberId) &&
    clean_(r[6])===clean_(requestId) &&
    clean_(r[2])==='맞팔 요청이 도착했어요'
  );
  if(!hasReceived){
    createMatchRequestNotificationV194_(
      from,toMember,fromMember.nickname||'',requestId
    );
  }

  const hasSent=rows.some(r=>
    String(r[1])===String(fromMember.memberId) &&
    clean_(r[6])===clean_(requestId) &&
    clean_(r[2])==='맞팔 요청을 보냈어요'
  );
  if(!hasSent){
    createMatchRequestSentNotificationV214_(
      fromMember,toMember,requestId
    );
  }
}

function sendMatchRequest_(data) {
  const from=normInstagram_(data.from || data.fromInstagram || data.instagramId || data.sender);
  const to=normInstagram_(data.to || data.toInstagram || data.targetInstagram);

  if(!from) throw new Error('보내는 회원 아이디를 확인할 수 없습니다.');
  if(!to) throw new Error('요청할 회원 아이디를 확인해주세요.');
  if(from===to) throw new Error('본인에게 요청할 수 없습니다.');

  const fromMember=findFollowMemberByInstagram_(from);
  if(!fromMember) throw new Error('보내는 회원이 팔로우리스트에 없습니다.');
  const toMember=findFollowMemberByInstagram_(to);
  if(!toMember) throw new Error('요청할 회원이 팔로우리스트에 없습니다.');

  const lock=LockService.getScriptLock();
  if(!lock.tryLock(8000)) throw new Error('요청 처리 중입니다. 잠시 후 다시 시도해주세요.');

  try{
    const sh=ensureSheet_(SHEETS.MATCH_REQUESTS,[
      'RequestID','보낸아이디','받는아이디','메시지','상태','생성일','확인일'
    ]);

    // V215: 타임아웃 재시도/연속 클릭으로 같은 NEW 요청이 중복 생성되지 않게 함
    if(sh.getLastRow()>=2){
      const rows=sh.getRange(2,1,sh.getLastRow()-1,7).getValues();
      for(let i=rows.length-1;i>=0;i--){
        const r=rows[i];
        if(normInstagram_(r[1])!==from || normInstagram_(r[2])!==to) continue;
        const status=clean_(r[4]).toUpperCase()||'NEW';
        if(status==='READ') break;

        const existingId=clean_(r[0]);
        ensureMatchRequestNotificationsV215_(
          fromMember,toMember,existingId,from,to
        );
        return {
          message:'이미 보낸 맞팔 요청이 있습니다.',
          duplicate:true,
          request:{
            id:existingId,
            from,
            to,
            fromInstagram:from,
            toInstagram:to,
            fromName:fromMember.nickname||'',
            toName:toMember.nickname||''
          }
        };
      }
    }

    const requestId=uuid_();
    const createdAt=new Date();
    sh.appendRow([
      requestId,from,to,clean_(data.message),'NEW',createdAt,''
    ]);

    ensureMatchRequestNotificationsV215_(
      fromMember,toMember,requestId,from,to
    );

    return {
      message:'맞팔 요청을 보냈습니다.',
      request:{
        id:requestId,
        from,
        to,
        fromInstagram:from,
        toInstagram:to,
        fromName:fromMember.nickname||'',
        toName:toMember.nickname||''
      }
    };
  } finally {
    try{ lock.releaseLock(); }catch(_){}
  }
}


/**
 * V197
 * 새 알림은 RequestID를 직접 사용하고,
 * V194 이전에 생성돼 RequestID가 없는 맞팔 알림은
 * 회원알림의 수신 MemberID + 생성시간을 기준으로 가장 가까운 맞팔요청을 찾아 연결합니다.
 */
function markMatchRequestReadV197_(data) {
  const sess=requireMember_(data.token);
  const memberId=String(sess.member.memberId||'');
  let requestId=clean_(data.requestId);
  const notificationKey=clean_(data.notificationKey);

  const notifSh=ensureSheet_(SHEETS.NOTIFICATIONS,[
    'NotificationID','MemberID','제목','내용','생성일','읽음'
  ]);
  if(!clean_(notifSh.getRange(1,7).getValue())) notifSh.getRange(1,7).setValue('RequestID');

  let notifRow=-1, notifDate=null;
  if(notificationKey && notifSh.getLastRow()>=2){
    const rows=notifSh.getRange(2,1,notifSh.getLastRow()-1,7).getValues();
    for(let i=0;i<rows.length;i++){
      const r=rows[i];
      if(clean_(r[0])!==notificationKey) continue;
      if(String(r[1])!==memberId) throw new Error('본인의 알림만 확인할 수 있습니다.');
      notifRow=i+2;
      notifDate=r[4];
      if(!requestId) requestId=clean_(r[6]);
      break;
    }
  }

  // 기존 알림처럼 RequestID가 없으면 수신자 인스타ID + 생성시간으로 가장 가까운 요청 찾기
  if(!requestId){
    const myIg=normInstagram_(
      (sess.member && (sess.member.instagramId || sess.member.InstagramID || sess.member.instagram || sess.member['인스타ID'])) || ''
    );
    if(!myIg) throw new Error('로그인 회원의 인스타 아이디를 확인할 수 없습니다.');

    const reqSh=ensureSheet_(SHEETS.MATCH_REQUESTS,[
      'RequestID','보낸아이디','받는아이디','메시지','상태','생성일','확인일'
    ]);
    if(reqSh.getLastRow()<2) throw new Error('맞팔 요청을 찾을 수 없습니다.');

    const rows=reqSh.getRange(2,1,reqSh.getLastRow()-1,7).getValues();
    const nt=notifDate instanceof Date ? notifDate.getTime() : new Date(notifDate).getTime();

    let best=null, bestDiff=Number.MAX_SAFE_INTEGER;
    for(let i=0;i<rows.length;i++){
      const r=rows[i];
      if(normInstagram_(r[2])!==myIg) continue;
      const rt=r[5] instanceof Date ? r[5].getTime() : new Date(r[5]).getTime();
      const diff=(isNaN(nt)||isNaN(rt)) ? 0 : Math.abs(nt-rt);
      if(diff<bestDiff){
        bestDiff=diff;
        best={row:i+2,id:clean_(r[0])};
      }
    }
    if(!best || !best.id) throw new Error('연결된 맞팔 요청을 찾을 수 없습니다.');
    requestId=best.id;

    // 다음부터는 바로 찾도록 기존 알림에도 RequestID 기록
    if(notifRow>0) notifSh.getRange(notifRow,7).setValue(requestId);
  }

  const result=markMatchRequestRead_({requestId:requestId});

  // 알림도 읽음 처리
  if(notifRow>0){
    notifSh.getRange(notifRow,6).setValue(true);
  }
  SpreadsheetApp.flush();

  return {
    message:'맞팔 요청을 확인했습니다.',
    requestId:requestId,
    status:result.status||'READ',
    readAt:result.readAt||'',
    fromInstagram:result.fromInstagram||''
  };
}


/**
 * V214 - 맞팔요청 최종 확인완료
 * 인스타 프로필을 연 것만으로는 처리하지 않고,
 * 요청받은 회원이 여우방에서 '확인 완료'를 직접 눌렀을 때만 실행됩니다.
 */
function completeMatchRequestV215_(data) {
  const sess=requireMember_(data.token);
  const myInstagram=normInstagram_(sess.member && sess.member.instagramId);
  const requestId=clean_(data.requestId);
  const notificationKey=clean_(data.notificationKey);

  if(!requestId) throw new Error('맞팔요청 ID가 없습니다.');
  if(!myInstagram) throw new Error('로그인 회원의 인스타 아이디를 확인할 수 없습니다.');

  const lock=LockService.getScriptLock();
  if(!lock.tryLock(8000)) throw new Error('요청 처리 중입니다. 잠시 후 다시 눌러주세요.');

  try{
    const sh=ensureSheet_(SHEETS.MATCH_REQUESTS,[
      'RequestID','보낸아이디','받는아이디','메시지','상태','생성일','확인일'
    ]);
    if(sh.getLastRow()<2) throw new Error('맞팔 요청을 찾을 수 없습니다.');

    const rows=sh.getRange(2,1,sh.getLastRow()-1,7).getValues();
    let rowIndex=-1;
    let row=null;

    for(let i=0;i<rows.length;i++){
      if(clean_(rows[i][0])!==requestId) continue;
      rowIndex=i+2;
      row=rows[i];
      break;
    }
    if(!row || rowIndex<2) throw new Error('맞팔 요청을 찾을 수 없습니다.');

    const from=normInstagram_(row[1]);
    const to=normInstagram_(row[2]);

    if(to!==myInstagram){
      throw new Error('요청을 받은 회원만 확인 완료할 수 있습니다.');
    }

    const fromMember=findFollowMemberByInstagram_(from);
    const toMember=findFollowMemberByInstagram_(to);

    // API 재시도 안전성:
    // 이미 READ더라도 완료 알림이 누락됐다면 다시 보강한 뒤 기존 시간을 반환합니다.
    if(String(row[4]||'').toUpperCase()==='READ' && row[6]){
      createMatchRequestCompletedNotificationV214_(
        fromMember,toMember,requestId,row[6]
      );
      return {
        message:'이미 확인 완료된 요청입니다.',
        requestId,
        status:'READ',
        readAt:formatDate_(row[6]),
        fromInstagram:from,
        toInstagram:to
      };
    }

    const now=new Date();
    sh.getRange(rowIndex,5).setValue('READ');
    sh.getRange(rowIndex,7).setValue(now);

    // 받은 사람의 해당 알림만 읽음 처리
    if(notificationKey){
      const notifSh=ensureSheet_(SHEETS.NOTIFICATIONS,[
        'NotificationID','MemberID','제목','내용','생성일','읽음'
      ]);
      if(notifSh.getLastRow()>=2){
        const notifRows=notifSh.getRange(2,1,notifSh.getLastRow()-1,7).getValues();
        for(let i=0;i<notifRows.length;i++){
          if(clean_(notifRows[i][0])!==notificationKey) continue;
          if(String(notifRows[i][1])===String(sess.member.memberId||'')){
            notifSh.getRange(i+2,6).setValue(true);
          }
          break;
        }
      }
    }

    createMatchRequestCompletedNotificationV214_(
      fromMember,toMember,requestId,now
    );

    SpreadsheetApp.flush();
    return {
      message:'확인 완료로 처리했습니다.',
      requestId,
      status:'READ',
      readAt:formatDate_(now),
      fromInstagram:from,
      toInstagram:to
    };
  } finally {
    try{ lock.releaseLock(); }catch(_){}
  }
}

function markMatchRequestRead_(data) {
  const id=clean_(data.requestId);
  if(!id) throw new Error('맞팔요청 ID가 없습니다.');

  const sh=ensureSheet_(SHEETS.MATCH_REQUESTS,['RequestID','보낸아이디','받는아이디','메시지','상태','생성일','확인일']);
  if (sh.getLastRow()>=2) {
    const ids=sh.getRange(2,1,sh.getLastRow()-1,1).getDisplayValues();
    for(let i=0;i<ids.length;i++) {
      if(ids[i][0]!==id) continue;
      const now=new Date();
      sh.getRange(i+2,5).setValue('READ');
      sh.getRange(i+2,7).setValue(now);
      SpreadsheetApp.flush();
      return {
        message:'확인 처리 완료',
        status:'READ',
        readAt:formatDate_(now),
        fromInstagram:normInstagram_(sh.getRange(i+2,2).getDisplayValue())
      };
    }
  }
  throw new Error('맞팔 요청을 찾을 수 없습니다.');
}

/* =========================================================
   Invite
   ========================================================= */

function inviteMemberLookup_(data) {
  const member=findFollowMemberByIdentity_(data.name, data.instagram);
  if (!member) return {member:null,items:[]};
  const items=getInviteRequestsForInstagram_(member.instagramId);
  return {member:{memberId:member.memberId,nickname:member.nickname,instagramId:member.instagramId},items:items};
}

function getInviteRequestsForInstagram_(instagram) {
  const sh=ensureSheet_(SHEETS.INVITE_REQUESTS,['ID','초대받은닉네임','초대받은아이디','초대자닉네임','초대자아이디','상태','등록일','처리일','팔로우시작일','취소일','취소사유']);
  const arr=[];
  if(sh.getLastRow()>=2){
    sh.getRange(2,1,sh.getLastRow()-1,11).getValues().forEach(r=>{
      if(normInstagram_(r[2])!==normInstagram_(instagram)) return;
      arr.push({id:clean_(r[0]),inviteeName:clean_(r[1]),inviteeInstagram:normInstagram_(r[2]),inviterName:clean_(r[3]),inviterInstagram:normInstagram_(r[4]),status:clean_(r[5])||'PENDING',createdAt:formatDate_(r[6]),processedAt:formatDate_(r[7]),followStartedAt:formatDate_(r[8]),cancelledAt:formatDate_(r[9]),cancelReason:clean_(r[10])});
    });
  }
  return arr.reverse();
}

function registerInvite_(data) {
  const invitee=findFollowMemberByIdentity_(data.inviteeName, data.inviteeInstagram);
  const inviter=findFollowMemberByIdentity_(data.inviterName, data.inviterInstagram);
  if (!invitee) throw new Error('초대받은 회원 정보가 팔로우리스트와 일치하지 않습니다.');
  if (!inviter) throw new Error('초대한 회원 정보가 팔로우리스트와 일치하지 않습니다.');
  if (invitee.instagramId===inviter.instagramId) throw new Error('본인을 초대자로 등록할 수 없습니다.');

  const sh=ensureSheet_(SHEETS.INVITE_REQUESTS,['ID','초대받은닉네임','초대받은아이디','초대자닉네임','초대자아이디','상태','등록일','처리일','팔로우시작일','취소일','취소사유']);
  if(sh.getLastRow()>=2){
    const rows=sh.getRange(2,1,sh.getLastRow()-1,7).getValues();
    const dup=rows.some(r=>normInstagram_(r[2])===invitee.instagramId && !/REJECTED|CANCELLED/.test(clean_(r[5])));
    if(dup) throw new Error('이미 등록된 초대 요청이 있습니다.');
  }
  sh.appendRow([uuid_(),invitee.nickname,invitee.instagramId,inviter.nickname,inviter.instagramId,'PENDING',new Date(),'','','','']);
  return {message:'초대 등록 요청이 완료되었습니다.'};
}

function inviteAdminPassword_() {
  return setting_('초대관리비밀번호') || setting_('운영진비밀번호');
}

function inviteAdminLogin_(data) {
  if(clean_(data.password)!==inviteAdminPassword_()) throw new Error('비밀번호가 올바르지 않습니다.');
  return {message:'초대관리 인증 완료'};
}

function requireInviteAdmin_(data) {
  if(clean_(data.inviteAdminPassword)!==inviteAdminPassword_()) throw new Error('초대관리 관리자 인증이 필요합니다.');
}

function getInviteAdmin_(data) {
  requireInviteAdmin_(data);
  const sh=ensureSheet_(SHEETS.INVITE_REQUESTS,['ID','초대받은닉네임','초대받은아이디','초대자닉네임','초대자아이디','상태','등록일','처리일','팔로우시작일','취소일','취소사유']);
  const items=[];
  if(sh.getLastRow()>=2){
    sh.getRange(2,1,sh.getLastRow()-1,11).getValues().forEach(r=>{
      const status=clean_(r[5])||'PENDING';
      const created=r[6] instanceof Date?r[6]:null;
      const approved=r[7] instanceof Date?r[7]:null;
      const days=approved?Math.floor((Date.now()-approved.getTime())/86400000):0;
      items.push({id:clean_(r[0]),inviteeName:clean_(r[1]),inviteeInstagram:normInstagram_(r[2]),inviterName:clean_(r[3]),inviterInstagram:normInstagram_(r[4]),status:status,createdAt:formatDate_(r[6]),processedAt:formatDate_(r[7]),followStartedAt:formatDate_(r[8]),cancelledAt:formatDate_(r[9]),cancelReason:clean_(r[10]),daysSinceJoin:days,followStarted:!!r[8],canCancel:status==='APPROVED'&&days<7,cancelDeadline:'',expelTarget:status==='APPROVED'&&days>=7&&!r[8]});
    });
  }
  return {items:items.reverse()};
}

function updateInviteStatus_(data) {
  requireInviteAdmin_(data);
  const id=clean_(data.id || data.requestId);
  const status=clean_(data.status).toUpperCase();
  if(!['APPROVED','REJECTED','CANCELLED'].includes(status)) throw new Error('처리 상태를 확인해주세요.');
  const sh=ensureSheet_(SHEETS.INVITE_REQUESTS,['ID','초대받은닉네임','초대받은아이디','초대자닉네임','초대자아이디','상태','등록일','처리일','팔로우시작일','취소일','취소사유']);
  if(sh.getLastRow()<2) throw new Error('요청 기록을 찾을 수 없습니다.');
  const rows=sh.getRange(2,1,sh.getLastRow()-1,11).getValues();
  for(let i=0;i<rows.length;i++){
    if(clean_(rows[i][0])!==id) continue;
    sh.getRange(i+2,6).setValue(status);
    if(status==='CANCELLED'){
      sh.getRange(i+2,10).setValue(new Date());
      sh.getRange(i+2,11).setValue(clean_(data.reason));
    }else{
      sh.getRange(i+2,8).setValue(new Date());
    }
    return {message:'처리되었습니다.'};
  }
  throw new Error('요청 기록을 찾을 수 없습니다.');
}

const YW_INVITE_FIXED_MONTH_V219 = '8월';

function inviteMonthSheetV164_() {
  // V219: 초대별 화면은 현재 날짜와 무관하게 8월 시트를 읽습니다.
  const monthName = YW_INVITE_FIXED_MONTH_V219;
  const ss = SpreadsheetApp.openById(YW_INVITE_SOURCE_ID_V164);
  const sh = ss.getSheetByName(monthName);
  if (!sh) throw new Error("'" + monthName + "' 초대별 시트를 찾지 못했습니다.");
  return sh;
}

function inviteRows_() {
  // V164: 읽기 전용. 운영진 원본 행/열/수식은 절대 수정하지 않습니다.
  const sh = inviteMonthSheetV164_();
  const last = sh.getLastRow();
  if (last < 3) return [];

  // 원본 구조: A 순번 / B 닉네임 / C 인스타ID / D 이번달 / E 이전 / F 총누적 / G:BU 초대회원
  const width = Math.min(Math.max(sh.getLastColumn(), 6), 73);
  const rows = sh.getRange(3, 1, last - 2, width).getDisplayValues();

  return rows.map((r, i) => {
    const instagramId = normInstagram_(r[2]);
    const invite = Number(String(r[3] || '').replace(/[^0-9.-]/g, '')) || 0;
    const previous = Number(String(r[4] || '').replace(/[^0-9.-]/g, '')) || 0;
    const totalRaw = Number(String(r[5] || '').replace(/[^0-9.-]/g, ''));
    const total = Number.isFinite(totalRaw) ? totalRaw : (invite + previous);

    return {
      row: i + 3,
      no: clean_(r[0]),
      nickname: clean_(r[1]),
      instagramId: instagramId,
      instagram: instagramId, // 현재 app.js 호환
      invite: Math.max(0, invite),
      previous: Math.max(0, previous),
      total: Math.max(0, total),
      invitees: r.slice(6).map(clean_).filter(Boolean)
    };
  }).filter(x => x.nickname && x.instagramId);
}

// 원본 수정 없이 현재 앱이 읽을 초대 데이터 상태만 확인
function checkInviteSourceV164() {
  const rows = inviteRows_();
  const active = rows.filter(x => x.invite > 0);
  const totalActive = rows.filter(x => x.total > 0);
  return {
    ok: true,
    version: YW_VERSION,
    month: YW_INVITE_FIXED_MONTH_V219,
    memberCount: rows.length,
    monthlyActiveCount: active.length,
    totalActiveCount: totalActive.length,
    topMonthly: active.slice().sort((a,b)=>b.invite-a.invite).slice(0,5)
      .map(x=>({no:x.no,nickname:x.nickname,instagram:x.instagramId,invite:x.invite,total:x.total}))
  };
}

function getInviteSummary_(data) {
  requireInviteAdmin_(data);
  return {items:inviteRows_().map(x=>({no:x.no,nickname:x.nickname,instagramId:x.instagramId,invite:x.invite,previous:x.previous,total:x.total,invitees:x.invitees}))};
}

function getInviteLeaderboard_() {
  const rows = inviteRows_();

  // 현재 GitHub app.js는 d.items + x.instagram을 사용합니다.
  // V164는 구형/신형 프론트 모두 호환되도록 items/monthly/total을 함께 반환합니다.
  const items = rows.map(x => ({
    no: x.no,
    nickname: x.nickname,
    instagram: x.instagramId,
    instagramId: x.instagramId,
    invite: x.invite,
    previous: x.previous,
    total: x.total,
    invitees: x.invitees
  }));

  const monthly = items.slice().sort((a,b) =>
    b.invite - a.invite ||
    b.total - a.total ||
    Number(a.no || 0) - Number(b.no || 0)
  );

  const total = items.slice().sort((a,b) =>
    b.total - a.total ||
    b.invite - a.invite ||
    Number(a.no || 0) - Number(b.no || 0)
  );

  return {
    version: YW_VERSION,
    monthLabel: YW_INVITE_FIXED_MONTH_V219,
    items: items,
    monthly: monthly.map((x,i)=>({...x,rank:i+1})),
    total: total.map((x,i)=>({...x,rank:i+1}))
  };
}

function publishInvitePriorityV110_(data) {
  requireInviteAdmin_(data);
  const followSh=sheet_(SHEETS.FOLLOW);
  const inviteSh=inviteMonthSheetV164_();

  const follow=followMembers_().filter(m=>m.status!=='SUSPENDED');
  const rows=inviteRows_();
  const inviteMap=new Map(rows.map(x=>[x.instagramId,x]));

  const fixedSh=ensureSheet_(SHEETS.FIXED_ORDER,['고정순번','닉네임','인스타아이디','고정구분','고정월','달성초대수','고정일시']);
  const fixedRows=fixedSh.getLastRow()>=2?fixedSh.getRange(2,1,fixedSh.getLastRow()-1,7).getDisplayValues():[];
  const fixedMap=new Map();
  fixedRows.forEach(r=>{const id=normInstagram_(r[2]);if(id)fixedMap.set(id,Number(r[0]||0));});

  // 기존 1~30은 항상 고정
  follow.filter(x=>Number(x.no)>=1&&Number(x.no)<=30).forEach(x=>fixedMap.set(x.instagramId,Number(x.no)));

  const candidates=follow.filter(x=>{
    if(fixedMap.has(x.instagramId))return false;
    const inv=inviteMap.get(x.instagramId);
    return inv&&inv.invite>=10;
  }).sort((a,b)=>{
    const ai=inviteMap.get(a.instagramId).invite, bi=inviteMap.get(b.instagramId).invite;
    return bi-ai||Number(a.no)-Number(b.no);
  });

  let next=31;
  if(fixedMap.size){
    const nums=Array.from(fixedMap.values()).filter(n=>n>=31);
    if(nums.length)next=Math.max(...nums)+1;
  }

  const added=[];
  candidates.forEach(x=>{
    const inv=inviteMap.get(x.instagramId);
    fixedMap.set(x.instagramId,next);
    fixedSh.appendRow([next,x.nickname,x.instagramId,'초대10명이상',Utilities.formatDate(new Date(),Session.getScriptTimeZone()||'Asia/Seoul','yyyy-MM'),inv.invite,new Date()]);
    added.push({no:next,nickname:x.nickname,instagramId:x.instagramId,invite:inv.invite});
    next++;
  });

  // fixed 번호 순 + 나머지 기존 순
  const sorted=follow.slice().sort((a,b)=>{
    const af=fixedMap.has(a.instagramId), bf=fixedMap.has(b.instagramId);
    if(af&&bf)return fixedMap.get(a.instagramId)-fixedMap.get(b.instagramId);
    if(af)return -1;if(bf)return 1;
    return Number(a.no)-Number(b.no);
  });

  // 현재 통합 팔로우리스트 A:C를 1번부터 재작성
  if(sorted.length){
    followSh.getRange(2,1,sorted.length,3).setValues(sorted.map((m,i)=>[i+1,m.nickname,'@'+m.instagramId]));
  }

  // 초대별 행도 같은 아이디 순으로 재정렬(값/수식 전체 보존)
  if(rows.length){
    const lastCol=Math.min(inviteSh.getLastColumn(),73);
    const raw=inviteSh.getRange(3,1,rows.length,lastCol).getValues();
    const formula=inviteSh.getRange(3,1,rows.length,lastCol).getFormulasR1C1();
    const idx=new Map(rows.map((x,i)=>[x.instagramId,i]));
    const orderedRaw=[], orderedFormula=[];
    sorted.forEach((m,newIdx)=>{
      if(!idx.has(m.instagramId))return;
      const i=idx.get(m.instagramId);
      const rv=raw[i].slice(), rf=formula[i].slice();
      rv[0]=newIdx+1; rf[0]='';
      orderedRaw.push(rv); orderedFormula.push(rf);
    });
    if(orderedRaw.length){
      inviteSh.getRange(3,1,orderedRaw.length,lastCol).setValues(orderedRaw);
      for(let r=0;r<orderedFormula.length;r++){
        for(let c=0;c<lastCol;c++) if(orderedFormula[r][c]) inviteSh.getRange(3+r,c+1).setFormulaR1C1(orderedFormula[r][c]);
      }
    }
  }

  return {items:added,fixedItems:Array.from(fixedMap.entries()).filter(x=>x[1]<=30).map(x=>({instagramId:x[0],no:x[1]})),message:'앞번호 반영 완료'};
}

/* =========================================================
   Admin
   ========================================================= */

function adminRows_() {
  const sh=sheet_(SHEETS.ADMINS);
  const last=sh.getLastRow();
  if(last<2)return[];
  const rows=sh.getRange(2,1,last-1,8).getValues();
  return rows.map((r,i)=>({row:i+2,instagramId:normInstagram_(r[0]),name:clean_(r[1])||'운영진',password:clean_(r[2]),role:clean_(r[3])||'운영진',active:String(r[4]).toUpperCase()!=='FALSE'})).filter(x=>x.instagramId);
}

function findAdminByInstagram_(instagram) {
  const id=normInstagram_(instagram);
  return adminRows_().find(a=>a.instagramId===id&&a.active)||null;
}

function adminSimpleLogin_(data) {
  const instagram=normInstagram_(data.instagram || data.instagramId);
  const password=clean_(data.password);
  const admin=findAdminByInstagram_(instagram);
  if(!admin) throw new Error('운영진 정보가 맞지 않습니다.');
  const common=setting_('운영진비밀번호');
  if(password!==admin.password && password!==common) throw new Error('운영진 정보가 맞지 않습니다.');

  const token='A-'+uuid_().replace(/-/g,'');
  sessionCache_().put('admin:'+token,admin.instagramId,YW_ADMIN_SESSION_TTL_SEC);
  logAdmin_({instagramId:admin.instagramId},'운영진로그인','운영진 모드 접속');
  return {
    admin:true,
    role:admin.role,
    adminModeToken:token,
    operator:{instagramId:admin.instagramId,name:admin.name,role:admin.role},
    publicConfig:getPublicConfig_()
  };
}

function requireAdmin_(data) {
  const token=clean_(data.adminModeToken);
  if(token){
    const id=sessionCache_().get('admin:'+token);
    if(id){
      const a=findAdminByInstagram_(id);
      if(a){sessionCache_().put('admin:'+token,id,YW_ADMIN_SESSION_TTL_SEC);return a;}
    }
  }
  const pw=clean_(data.adminPassword || data.password);
  const expected=setting_('운영진비밀번호');
  if(expected&&pw===expected)return {instagramId:'admin',name:'운영진',role:'관리자'};
  throw new Error('운영진 인증이 필요합니다.');
}

function getAdminLogs_(data) {
  requireAdmin_(data);
  const sh=ensureSheet_(SHEETS.ADMIN_LOG,['일시','운영진','액션','상세']);
  const logs=[];
  if(sh.getLastRow()>=2){
    sh.getRange(Math.max(2,sh.getLastRow()-99),1,Math.min(100,sh.getLastRow()-1),4).getValues().forEach(r=>logs.push({createdAt:formatDate_(r[0]),admin:clean_(r[1]),action:clean_(r[2]),detail:clean_(r[3])}));
  }
  return {logs:logs.reverse()};
}

function logAdmin_(admin, action, detail) {
  const sh=ensureSheet_(SHEETS.ADMIN_LOG,['일시','운영진','액션','상세']);
  sh.appendRow([new Date(),admin.name||admin.instagramId||'운영진',action,detail||'']);
}

function getAdminDashboard_(data) {
  requireAdmin_(data);
  const accounts=accountSheet_();
  let accountCount=0, loggedToday=0;
  const today=Utilities.formatDate(new Date(),Session.getScriptTimeZone()||'Asia/Seoul','yyyy-MM-dd');
  if(accounts.getLastRow()>=2){
    accounts.getRange(2,1,accounts.getLastRow()-1,8).getValues().forEach(r=>{
      if(clean_(r[1]))accountCount++;
      if(r[5] instanceof Date && Utilities.formatDate(r[5],Session.getScriptTimeZone()||'Asia/Seoul','yyyy-MM-dd')===today)loggedToday++;
    });
  }
  let invitePending=0;
  const ir=ensureSheet_(SHEETS.INVITE_REQUESTS,['ID','초대받은닉네임','초대받은아이디','초대자닉네임','초대자아이디','상태','등록일','처리일','팔로우시작일','취소일','취소사유']);
  if(ir.getLastRow()>=2) invitePending=ir.getRange(2,6,ir.getLastRow()-1,1).getDisplayValues().filter(r=>r[0]==='PENDING').length;
  return {loggedToday:loggedToday,matchDone:0,matchDelay:0,matchMissing:0,invitePending:invitePending,accounts:accountCount};
}

function getAdminMembers_(data) {
  requireAdmin_(data);
  const q=clean_(data.query).toLowerCase();
  const items=[];
  followMembers_().forEach(m=>{
    if(q && !(`${m.nickname} ${m.instagramId} ${m.memberId}`.toLowerCase().includes(q)))return;
    const acc=findAccountRow_(m.memberId);
    items.push({memberId:m.memberId,nickname:m.nickname,instagramId:m.instagramId,memberStatus:m.status,account:isRealAccount_(acc)?{status:getAccountStatus_(acc),last:formatDate_(acc.values[5])}:null});
  });
  return {items:items.slice(0,100)};
}

function setMemberAccountStatus_(data) {
  requireAdmin_(data);
  const memberId=clean_(data.memberId), status=clean_(data.status);
  const acc=findAccountRow_(memberId);
  if(!acc) throw new Error('계정 정보를 찾을 수 없습니다.');
  accountSheet_().getRange(acc.row,4).setValue(status);
  return {message:'계정 상태를 변경했습니다.'};
}


/**
 * V162 운영진용 테스트 계정 초기화
 * - 팔로우리스트 정보/MemberID는 그대로 유지
 * - 회원계정 시트에서 B,C,E,F,G,H만 비우고 D는 '정상' 유지
 * - 비밀번호해시/Salt/가입일/최근로그인/변경일/실패횟수만 초기화
 * - 회원 활동/초대/팔로우리스트/맞팔 데이터는 건드리지 않음
 */
function resetTestMemberAccountV162_(data) {
  const admin = requireAdmin_(data);

  const memberId = clean_(data.memberId);
  const instagramId = normInstagram_(data.instagramId);
  let member = null;

  if (memberId) member = findFollowMemberById_(memberId);
  if (!member && instagramId) member = findFollowMemberByInstagram_(instagramId);
  if (!member) throw new Error('초기화할 회원을 찾을 수 없습니다.');

  const acc = findAccountRow_(member.memberId);
  if (!acc) {
    return {
      reset:true,
      alreadyReset:true,
      member:memberPayload_(member),
      message:'이미 프로그램 계정이 없는 상태입니다.'
    };
  }

  const sh = accountSheet_();

  // A(MemberID)는 유지. D(계정상태)는 정상으로 유지.
  sh.getRange(acc.row,2).clearContent(); // 비밀번호해시
  sh.getRange(acc.row,3).clearContent(); // Salt
  sh.getRange(acc.row,4).setValue('정상');
  sh.getRange(acc.row,5).clearContent(); // 최초등록일
  sh.getRange(acc.row,6).clearContent(); // 마지막로그인
  sh.getRange(acc.row,7).clearContent(); // 비밀번호변경일
  sh.getRange(acc.row,8).setValue(0);    // 로그인실패횟수

  SpreadsheetApp.flush();

  logAdmin_(
    admin,
    '테스트계정초기화',
    member.nickname + ' @' + member.instagramId + ' / MemberID ' + member.memberId
  );

  return {
    reset:true,
    alreadyReset:false,
    member:memberPayload_(member),
    message:'프로그램 계정만 최초 가입 전 상태로 초기화했습니다.'
  };
}

function getMemberDetail_(data) {
  requireAdmin_(data);
  const m=findFollowMemberById_(data.memberId)||findFollowMemberByInstagram_(data.instagramId);
  if(!m)throw new Error('회원을 찾을 수 없습니다.');
  const acc=findAccountRow_(m.memberId);
  return {member:memberPayload_(m),account:isRealAccount_(acc)?{status:getAccountStatus_(acc),lastLogin:formatDate_(acc.values[5]),registeredAt:formatDate_(acc.values[4])}:null};
}

function saveMemberMemo_(data) {
  requireAdmin_(data);
  const sh=ensureSheet_(SHEETS.MEMBER_OPS,['MemberID','닉네임','인스타아이디','팔로우시작','팔로우시작일','상태','메모']);
  const memberId=clean_(data.memberId);
  let row=0;
  if(sh.getLastRow()>=2){
    const ids=sh.getRange(2,1,sh.getLastRow()-1,1).getDisplayValues();
    for(let i=0;i<ids.length;i++)if(ids[i][0]===memberId){row=i+2;break;}
  }
  const m=findFollowMemberById_(memberId);
  if(!row){row=sh.getLastRow()+1;sh.getRange(row,1,1,7).setValues([[memberId,m?m.nickname:'',m?m.instagramId:'',false,'','정상',clean_(data.memo)]]);}
  else sh.getRange(row,7).setValue(clean_(data.memo));
  return {message:'메모 저장 완료'};
}

function setMemberLifecycle_(data) {
  requireAdmin_(data);
  return {message:'회원 상태가 저장되었습니다.'};
}

/* =========================================================
   My page / activity / notifications
   ========================================================= */

function getMyPage_(data) {
  const s=requireMember_(data.token);
  const invite=inviteRows_().find(x=>x.instagramId===s.member.instagramId);
  return {
    member:memberPayload_(s.member),
    invite:{monthly:invite?invite.invite:0,total:invite?invite.total:0},
    account:{status:getAccountStatus_(s.account),registeredAt:s.account?formatDate_(s.account.values[4]):''}
  };
}

function logActivity_(memberId,type,content) {
  const sh=ensureSheet_(SHEETS.ACTIVITY,['MemberID','유형','내용','일시']);
  sh.appendRow([String(memberId),type,content,new Date()]);
}

function getMyActivity_(data) {
  const s=requireMember_(data.token);
  const sh=ensureSheet_(SHEETS.ACTIVITY,['MemberID','유형','내용','일시']);
  const items=[];
  if(sh.getLastRow()>=2){
    sh.getRange(2,1,sh.getLastRow()-1,4).getValues().forEach(r=>{
      if(String(r[0])===String(s.member.memberId))items.push({type:clean_(r[1]),content:clean_(r[2]),at:formatDate_(r[3])});
    });
  }
  return {items:items.reverse().slice(0,100)};
}

function getMatchRequestStatusV194_(requestId) {
  const id=clean_(requestId);
  if(!id) return {status:'',readAt:'',fromInstagram:''};
  const sh=getSheet_(SHEETS.MATCH_REQUESTS);
  if(!sh || sh.getLastRow()<2) return {status:'',readAt:'',fromInstagram:''};

  const rows=sh.getRange(2,1,sh.getLastRow()-1,7).getValues();
  for(let i=0;i<rows.length;i++){
    if(clean_(rows[i][0])!==id) continue;
    return {
      status:clean_(rows[i][4])||'NEW',
      readAt:rows[i][6] ? formatDate_(rows[i][6]) : '',
      fromInstagram:normInstagram_(rows[i][1])
    };
  }
  return {status:'',readAt:'',fromInstagram:''};
}

function getNotifications_(data) {
  const s=requireMember_(data.token);
  const currentInstagram=normInstagram_(s.member && s.member.instagramId);
  const sh=ensureSheet_(SHEETS.NOTIFICATIONS,[
    'NotificationID','MemberID','제목','내용','생성일','읽음'
  ]);
  if(!clean_(sh.getRange(1,7).getValue())) sh.getRange(1,7).setValue('RequestID');

  const requestMap={};
  const requestRows=[];
  const reqSh=getSheet_(SHEETS.MATCH_REQUESTS);

  if(reqSh && reqSh.getLastRow()>=2){
    const rows=reqSh.getRange(2,1,reqSh.getLastRow()-1,7).getValues();
    rows.forEach((r,i)=>{
      const requestId=clean_(r[0]);
      if(!requestId) return;
      const item={
        row:i+2,
        requestId,
        status:clean_(r[4])||'NEW',
        readAt:r[6]?formatDate_(r[6]):'',
        fromInstagram:normInstagram_(r[1]),
        toInstagram:normInstagram_(r[2]),
        createdRaw:r[5],
        createdAt:formatDate_(r[5])
      };
      requestMap[requestId]=item;
      requestRows.push(item);
    });
  }

  const items=[];
  const sentNotificationRequestIds={};

  if(sh.getLastRow()>=2){
    const rows=sh.getRange(2,1,sh.getLastRow()-1,7).getValues();

    rows.forEach((r,rowOffset)=>{
      if(String(r[1])!==String(s.member.memberId)) return;

      const title=clean_(r[2]);
      const content=clean_(r[3]);
      let requestId=clean_(r[6]);

      // V215: V194 이전 받은 맞팔알림의 RequestID가 비어 있으면
      // 같은 수신자 + 가장 가까운 생성시간 요청으로 안전하게 연결합니다.
      const looksLikeReceivedMatch=
        title.indexOf('맞팔 요청')>=0 ||
        content.indexOf('맞팔 확인을 요청')>=0;

      if(!requestId && looksLikeReceivedMatch && currentInstagram){
        const notifTime=r[4] instanceof Date ? r[4].getTime() : new Date(r[4]).getTime();
        let best=null;
        let bestDiff=Number.MAX_SAFE_INTEGER;

        requestRows.forEach(req=>{
          if(req.toInstagram!==currentInstagram) return;
          const rt=req.createdRaw instanceof Date
            ? req.createdRaw.getTime()
            : new Date(req.createdRaw).getTime();
          const diff=(isNaN(notifTime)||isNaN(rt)) ? Number.MAX_SAFE_INTEGER : Math.abs(notifTime-rt);
          if(diff<bestDiff){
            best=req;
            bestDiff=diff;
          }
        });

        // 너무 멀리 떨어진 요청은 오연결하지 않음 (10분 이내만)
        if(best && bestDiff<=10*60*1000){
          requestId=best.requestId;
          try{ sh.getRange(rowOffset+2,7).setValue(requestId); }catch(_){}
        }
      }

      const requestState=requestId
        ? (requestMap[requestId] || {
            status:'',readAt:'',fromInstagram:'',toInstagram:''
          })
        : {status:'',readAt:'',fromInstagram:'',toInstagram:''};

      let type='';
      if(title==='맞팔 요청 확인 완료'){
        type='MATCH_REQUEST_DONE';
      }else if(
        requestId &&
        currentInstagram &&
        requestState.fromInstagram===currentInstagram &&
        title==='맞팔 요청을 보냈어요'
      ){
        type='MATCH_REQUEST_SENT';
        sentNotificationRequestIds[requestId]=true;
      }else if(looksLikeReceivedMatch){
        type='MATCH_REQUEST';
      }

      items.push({
        id:clean_(r[0]),
        key:clean_(r[0]),
        title,
        content,
        message:content,
        type,
        requestId,
        requestStatus:requestState.status,
        requestReadAt:requestState.readAt,
        requestFromInstagram:requestState.fromInstagram||'',
        requestToInstagram:requestState.toInstagram||'',
        createdAt:formatDate_(r[4]),
        read:bool_(r[5])
      });
    });
  }

  // V215: V214 이전에 보낸 요청도 알림센터에서 확인할 수 있도록
  // 실제 알림행이 없는 보낸 요청은 가상 상태 카드로 보강합니다.
  requestRows.forEach(req=>{
    if(req.fromInstagram!==currentInstagram) return;
    if(sentNotificationRequestIds[req.requestId]) return;

    items.push({
      id:'sent-' + req.requestId,
      key:'sent-' + req.requestId,
      title:'맞팔 요청을 보냈어요',
      content:'@' + req.toInstagram + '님에게 맞팔 확인을 요청했어요.',
      message:'@' + req.toInstagram + '님에게 맞팔 확인을 요청했어요.',
      type:'MATCH_REQUEST_SENT',
      requestId:req.requestId,
      requestStatus:req.status,
      requestReadAt:req.readAt,
      requestFromInstagram:req.fromInstagram,
      requestToInstagram:req.toInstagram,
      createdAt:req.createdAt,
      read:true,
      virtual:true
    });
  });

  // 생성시간 문자열 기준 최신 우선. 동일 시간은 원래 알림 순서를 최대한 유지.
  items.sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));

  return {
    items,
    unread:items.filter(x=>!x.read).length
  };
}

function markNotificationRead_(data) {
  const s=requireMember_(data.token);
  const id=clean_(data.notificationId||data.id||data.key);
  const sh=ensureSheet_(SHEETS.NOTIFICATIONS,['NotificationID','MemberID','제목','내용','생성일','읽음']);
  if(sh.getLastRow()>=2){
    const rows=sh.getRange(2,1,sh.getLastRow()-1,6).getValues();
    for(let i=0;i<rows.length;i++)if(clean_(rows[i][0])===id&&String(rows[i][1])===String(s.member.memberId)){sh.getRange(i+2,6).setValue(true);break;}
  }
  return {message:'읽음 처리 완료'};
}

function markAllNotificationsRead_(data) {
  const s=requireMember_(data.token);
  const sh=ensureSheet_(SHEETS.NOTIFICATIONS,['NotificationID','MemberID','제목','내용','생성일','읽음']);
  if(sh.getLastRow()>=2){
    const rows=sh.getRange(2,1,sh.getLastRow()-1,2).getValues();
    rows.forEach((r,i)=>{if(String(r[1])===String(s.member.memberId))sh.getRange(i+2,6).setValue(true);});
  }
  return {message:'모두 읽음 처리 완료'};
}

/* =========================================================
   Notices / Settings writes
   ========================================================= */

function getNotices_() {
  const sh=ensureSheet_(SHEETS.NOTICES,['NoticeID','내용','등록일','활성']);
  const notices=[];
  if(sh.getLastRow()>=2){
    sh.getRange(2,1,sh.getLastRow()-1,4).getValues().forEach(r=>{
      if(String(r[3]).toUpperCase()==='FALSE')return;
      notices.push({noticeId:clean_(r[0]),content:clean_(r[1]),createdAt:formatDate_(r[2])});
    });
  }
  // 설정 시트 공지도 fallback
  if(!notices.length){
    const txt=setting_('공지');
    if(txt)notices.push({noticeId:'settings-notice',content:txt,createdAt:''});
  }
  return {notices:notices.reverse()};
}

function addNotice_(data) {
  const a=requireAdmin_(data);
  const content=clean_(data.content||data.notice);
  if(!content)throw new Error('공지 내용을 입력해주세요.');
  const sh=ensureSheet_(SHEETS.NOTICES,['NoticeID','내용','등록일','활성']);
  sh.appendRow([uuid_(),content,new Date(),true]);
  logAdmin_(a,'공지등록',content);
  return {message:'공지를 등록했습니다.'};
}

function deleteNotice_(data) {
  const a=requireAdmin_(data);
  const id=clean_(data.noticeId);
  const sh=ensureSheet_(SHEETS.NOTICES,['NoticeID','내용','등록일','활성']);
  if(sh.getLastRow()>=2){
    const ids=sh.getRange(2,1,sh.getLastRow()-1,1).getDisplayValues();
    for(let i=ids.length-1;i>=0;i--)if(ids[i][0]===id){sh.deleteRow(i+2);break;}
  }
  logAdmin_(a,'공지삭제',id);
  return {message:'공지를 삭제했습니다.'};
}

function setSettingValue_(key,value) {
  const sh=sheet_(SHEETS.SETTINGS);
  const last=sh.getLastRow();
  const keys=sh.getRange(1,1,last,1).getDisplayValues();
  for(let i=0;i<keys.length;i++){
    if(keys[i][0]===key){
      sh.getRange(i+1,2).setValue(value);
      try { CacheService.getScriptCache().remove('YW_SETTINGS_V209'); } catch (_) {}
      return;
    }
  }
  sh.appendRow([key,value]);
  try { CacheService.getScriptCache().remove('YW_SETTINGS_V209'); } catch (_) {}
}

function setAppLock_(data){requireAdmin_(data);setSettingValue_('앱잠금',!!data.locked);return {publicConfig:getPublicConfig_()};}
function setFollowLock_(data){requireAdmin_(data);setSettingValue_('팔로우리스트잠금',!!data.locked);return {publicConfig:getPublicConfig_()};}
function setMatchVoteOpen_(data){requireAdmin_(data);setSettingValue_('맞팔투표활성',!!data.open);return {publicConfig:getPublicConfig_()};}
function setMatchPeriod_(data){requireAdmin_(data);setSettingValue_('맞팔확인기간시작',clean_(data.startAt));setSettingValue_('맞팔확인기간종료',clean_(data.endAt));return {publicConfig:getPublicConfig_()};}
function setFollowLockPeriod_(data){requireAdmin_(data);setSettingValue_('팔로우리스트잠금시작',clean_(data.startAt));setSettingValue_('팔로우리스트잠금종료',clean_(data.endAt));return {publicConfig:getPublicConfig_()};}
function setMatchRequestPeriod_(data){requireAdmin_(data);setSettingValue_('맞팔요청기간시작',clean_(data.startAt));setSettingValue_('맞팔요청기간종료',clean_(data.endAt));return {period:{active:true,startAt:clean_(data.startAt),endAt:clean_(data.endAt)}};}

/* =========================================================
   Formatting
   ========================================================= */

function formatDate_(v) {
  if (!v) return '';
  if (v instanceof Date && !isNaN(v.getTime())) {
    return Utilities.formatDate(v, Session.getScriptTimeZone() || 'Asia/Seoul', 'yyyy-MM-dd HH:mm');
  }
  return clean_(v);
}