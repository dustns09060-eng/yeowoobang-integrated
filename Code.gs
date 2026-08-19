const SPREADSHEET_ID = '1PxeAtZrHS2N2VlKFTfxERyq8SAzgAn7o815q43gZzTY';

const SHEETS = Object.freeze({
  FOLLOW: '팔로우리스트',
  MATCH: '맞팔확인용',
  SETTINGS: '설정',
  NOTICES: '공지',
  LOG: '관리자로그',
  INVITE_SUMMARY: '초대별관리',
  INVITE_LOG: '초대등록기록',
});

const KEYS = Object.freeze({
  ACCESS_PASSWORD: '접속비밀번호',
  ADMIN_PASSWORD: '운영진비밀번호',
  FOLLOW_LOCK: '팔로우리스트잠금',
  FOLLOW_PASSWORD: '팔로우리스트잠금비밀번호',
  MATCH_LOCK: '맞팔잠금',
  MATCH_PASSWORD: '맞팔잠금비밀번호',
  NOTICE: '공지',
  APP_LOCK: '앱잠금',
  APP_LOCK_PASSWORD: '앱잠금비밀번호',
  UPDATED_AT: '마지막수정',
  VERSION: '버전',
  FORCE_UPDATE: '강제업데이트',
});

const DEFAULTS = Object.freeze({
  접속비밀번호: '1234',
  운영진비밀번호: '0702',
  팔로우리스트잠금: 'FALSE',
  팔로우리스트잠금비밀번호: '2132',
  맞팔잠금: 'TRUE',
  맞팔잠금비밀번호: '5678',
  공지: '오늘 공지',
  앱잠금: 'FALSE',
  앱잠금비밀번호: '0000',
  마지막수정: '',
  버전: 'V35',
  강제업데이트: 'FALSE',
});

const ALLOWED_SETTINGS = new Set([
  KEYS.ACCESS_PASSWORD,
  KEYS.FOLLOW_LOCK,
  KEYS.FOLLOW_PASSWORD,
  KEYS.MATCH_LOCK,
  KEYS.MATCH_PASSWORD,
  KEYS.NOTICE,
  KEYS.APP_LOCK,
  KEYS.APP_LOCK_PASSWORD,
  KEYS.VERSION,
  KEYS.FORCE_UPDATE,
]);

const CACHE_KEYS = Object.freeze({
  FOLLOW_LIST: 'YEOWOO_FOLLOW_LIST_V341',
  MATCH_LIST: 'YEOWOO_MATCH_LIST_V341',
  SETTINGS: 'YEOWOO_SETTINGS_V341',
  NOTICES: 'YEOWOO_NOTICES_V341',
});

const CACHE_SECONDS = Object.freeze({
  LIST: 300,
  SETTINGS: 60,
  NOTICES: 60,
});

function setupYeowoobang() {
  const ss = spreadsheet_();
  const follow = sheetOrCreate_(ss, SHEETS.FOLLOW);
  const match = sheetOrCreate_(ss, SHEETS.MATCH);
  const settings = sheetOrCreate_(ss, SHEETS.SETTINGS);
  const notices = sheetOrCreate_(ss, SHEETS.NOTICES);
  const log = sheetOrCreate_(ss, SHEETS.LOG);
  const inviteSummary = sheetOrCreate_(ss, SHEETS.INVITE_SUMMARY);
  const inviteLog = sheetOrCreate_(ss, SHEETS.INVITE_LOG);

  ensureListHeader_(follow);
  ensureListHeader_(match);
  settings.getRange('A:B').setNumberFormat('@');

  const current = settingsMap_(settings);
  Object.entries(DEFAULTS).forEach(([key, value]) => {
    if (!(key in current)) settings.appendRow([key, value]);
  });

  const refreshed = settingsMap_(settings);
  if (String(refreshed[KEYS.ADMIN_PASSWORD]) === '702') {
    setSetting_(settings, KEYS.ADMIN_PASSWORD, '0702');
  }

  ensureHeaders_(notices, ['작성시간', '내용', '공지ID']);
  fillMissingNoticeIds_(notices);
  ensureHeaders_(log, ['작성시간', '작업', '내용']);
  ensureHeaders_(inviteSummary, ['번호','닉네임','초대','이전','누적']);
  ensureHeaders_(inviteLog, ['등록ID','등록시간','신규회원닉네임','신규회원아이디','초대자닉네임','초대자아이디','상태','승인시간']);
  setSetting_(settings, KEYS.UPDATED_AT, now_());

  clearAllCaches_();
  SpreadsheetApp.flush();

  return {
    ok: true,
    message: '초기 설정 완료',
    publicConfig: publicConfig_(),
  };
}

function doGet(e) {
  try {
    const action = param_(e, 'action') || 'publicConfig';

    if (action === 'ping') {
      return json_({ ok: true, service: 'yeowoobang-api', time: now_() });
    }
    if (action === 'publicConfig') return json_(publicConfig_());
    if (action === 'roomList' || action === 'followList') return json_(followList_());
    if (action === 'matchList') return json_(matchList_());
    if (action === 'notices') return json_({ ok: true, notices: notices_() });
    if (action === 'stats') return json_(stats_());

    return json_({ ok: false, error: '지원하지 않는 GET action입니다: ' + action });
  } catch (err) {
    return jsonError_(err);
  }
}

function doPost(e) {
  try {
    const body = body_(e);
    const action = String(body.action || '').trim();

    if (action === 'verifyAccessPassword') return json_(verify_(KEYS.ACCESS_PASSWORD, body.password));
    if (action === 'verifyFollowPassword') return json_(verify_(KEYS.FOLLOW_PASSWORD, body.password));
    if (action === 'verifyMatchPassword') return json_(verify_(KEYS.MATCH_PASSWORD, body.password));
    if (action === 'verifyAppLockPassword') return json_(verify_(KEYS.APP_LOCK_PASSWORD, body.password));
    if (action === 'adminLogin') return json_(verify_(KEYS.ADMIN_PASSWORD, body.password));
    if (action === 'registerInvite') return json_(registerInvite_(body));

    requireAdmin_(body.adminPassword);

    if (action === 'getAdminLogs') return json_({ ok: true, logs: adminLogs_() });
    if (action === 'getInviteAdmin') return json_({ ok: true, items: inviteAdminItems_() });
    if (action === 'updateInviteStatus') return json_(updateInviteStatus_(body.id, body.status));
    if (action === 'setAppLock') return json_(updateSettings_({ [KEYS.APP_LOCK]: boolString_(body.locked) }, '앱잠금 변경'));
    if (action === 'setFollowLock') return json_(updateSettings_({ [KEYS.FOLLOW_LOCK]: boolString_(body.locked) }, '팔로우리스트잠금 변경'));
    if (action === 'setMatchLock') return json_(updateSettings_({ [KEYS.MATCH_LOCK]: boolString_(body.locked) }, '맞팔잠금 변경'));
    if (action === 'updateSettings') return json_(updateSettings_(parseSettings_(body.settings), '설정 변경'));
    if (action === 'addNotice') return json_(addNotice_(body.content));
    if (action === 'deleteNotice') return json_(deleteNotice_(body.noticeId));
    if (action === 'clearNotices') return json_(clearNotices_());

    if (action === 'clearListCaches') {
      clearListCaches_();
      log_('명단 캐시 삭제', '');
      return json_({ ok: true, message: '팔로우리스트·맞팔명단 캐시를 삭제했습니다.' });
    }

    return json_({ ok: false, error: '지원하지 않는 POST action입니다: ' + action });
  } catch (err) {
    return jsonError_(err);
  }
}

function publicConfig_() {
  const settings = getSettings_();
  return {
    ok: true,
    appLocked: bool_(settings[KEYS.APP_LOCK]),
    followLocked: bool_(settings[KEYS.FOLLOW_LOCK]),
    matchLocked: bool_(settings[KEYS.MATCH_LOCK]),
    notice: String(settings[KEYS.NOTICE] || ''),
    updatedAt: String(settings[KEYS.UPDATED_AT] || ''),
    version: String(settings[KEYS.VERSION] || 'V35'),
    forceUpdate: bool_(settings[KEYS.FORCE_UPDATE]),
    securityVersion: securityVersion_(settings),
  };
}

function followList_() {
  return listFromSheet_(SHEETS.FOLLOW, CACHE_KEYS.FOLLOW_LIST, '팔로우리스트');
}

function matchList_() {
  return listFromSheet_(SHEETS.MATCH, CACHE_KEYS.MATCH_LIST, '맞팔확인용 명단');
}

function listFromSheet_(sheetName, cacheKey, label) {
  const cache = CacheService.getScriptCache();
  const cached = getLargeCache_(cacheKey);

  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      parsed.cached = true;
      return parsed;
    } catch (_) {
      removeLargeCache_(cacheKey);
    }
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const cachedAfterLock = getLargeCache_(cacheKey);
    if (cachedAfterLock) {
      try {
        const parsed = JSON.parse(cachedAfterLock);
        parsed.cached = true;
        return parsed;
      } catch (_) {
        removeLargeCache_(cacheKey);
      }
    }

    const sh = sheet_(sheetName);
    const lastRow = sh.getLastRow();

    if (lastRow < 2) {
      const emptyResult = {
        ok: true,
        label,
        count: 0,
        members: [],
        updatedAt: now_(),
        cached: false,
      };
      putLargeCache_(cacheKey, JSON.stringify(emptyResult), CACHE_SECONDS.LIST);
      return emptyResult;
    }

    const rows = sh.getRange(2, 1, lastRow - 1, 3).getDisplayValues();
    const members = [];

    rows.forEach((row, index) => {
      const no = String(row[0] || '').trim();
      const name = String(row[1] || '').trim();
      const id = instaId_(row[2]);

      if (!name || !id) return;

      members.push({
        no: no || String(index + 1),
        name,
        id,
        instagramUrl: 'https://www.instagram.com/' + encodeURIComponent(id) + '/',
      });
    });

    const result = {
      ok: true,
      label,
      count: members.length,
      members,
      updatedAt: now_(),
      cached: false,
    };

    try {
      putLargeCache_(cacheKey, JSON.stringify(result), CACHE_SECONDS.LIST);
    } catch (err) {
      console.warn('명단 캐시 저장 실패(' + sheetName + '): ' + err);
    }

    return result;
  } finally {
    lock.releaseLock();
  }
}

function notices_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(CACHE_KEYS.NOTICES);

  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (_) {
      cache.remove(CACHE_KEYS.NOTICES);
    }
  }

  const sh = sheet_(SHEETS.NOTICES);
  const lastRow = sh.getLastRow();

  if (lastRow < 2) {
    cache.put(CACHE_KEYS.NOTICES, JSON.stringify([]), CACHE_SECONDS.NOTICES);
    return [];
  }

  const result = sh.getRange(2, 1, lastRow - 1, 3)
    .getDisplayValues()
    .map((row) => ({
      createdAt: String(row[0] || ''),
      content: String(row[1] || ''),
      noticeId: String(row[2] || ''),
    }))
    .filter((item) => item.content)
    .reverse();

  cache.put(CACHE_KEYS.NOTICES, JSON.stringify(result), CACHE_SECONDS.NOTICES);
  return result;
}

function stats_() {
  const follow = followList_();
  const match = matchList_();
  const settings = getSettings_();

  return {
    ok: true,
    roomCount: follow.count,
    followCount: follow.count,
    matchCount: match.count,
    noticeCount: notices_().length,
    appLocked: bool_(settings[KEYS.APP_LOCK]),
    followLocked: bool_(settings[KEYS.FOLLOW_LOCK]),
    matchLocked: bool_(settings[KEYS.MATCH_LOCK]),
    updatedAt: String(settings[KEYS.UPDATED_AT] || ''),
    version: String(settings[KEYS.VERSION] || ''),
  };
}

function verify_(key, input) {
  const settings = getSettings_();
  return {
    ok: safeEqual_(String(settings[key] || ''), String(input == null ? '' : input)),
    updatedAt: String(settings[KEYS.UPDATED_AT] || ''),
    version: String(settings[KEYS.VERSION] || ''),
    securityVersion: securityVersion_(settings),
  };
}


function registerInvite_(body) {
  const inviteeName = cleanInvite_(body.inviteeName);
  const inviteeInstagram = normInviteId_(body.inviteeInstagram);
  const inviterName = cleanInvite_(body.inviterName);
  const inviterInstagram = normInviteId_(body.inviterInstagram);
  if (!inviteeName || !inviteeInstagram || !inviterName || !inviterInstagram) {
    throw new Error('모든 정보를 입력해 주세요.');
  }
  if (inviteeInstagram === inviterInstagram) throw new Error('본인을 초대자로 등록할 수 없습니다.');

  const follow = sheet_(SHEETS.FOLLOW);
  if (!findFollowMember_(follow, inviterName, inviterInstagram)) {
    throw new Error('초대자 정보가 팔로우리스트와 일치하지 않습니다.');
  }

  const log = sheet_(SHEETS.INVITE_LOG);
  const rows = log.getLastRow() >= 2 ? log.getRange(2,1,log.getLastRow()-1,8).getValues() : [];
  if (rows.some(r => normInviteId_(r[3]) === inviteeInstagram && String(r[6]) !== 'REJECTED')) {
    throw new Error('이미 초대 등록 요청을 한 인스타 아이디입니다.');
  }

  log.appendRow([Utilities.getUuid(), new Date(), inviteeName, inviteeInstagram, inviterName, inviterInstagram, 'PENDING', '']);
  return { ok:true, message:'초대 등록 요청이 완료되었습니다. 운영진 승인 후 자동 반영됩니다.' };
}

function inviteAdminItems_() {
  const sh = sheet_(SHEETS.INVITE_LOG);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2,1,sh.getLastRow()-1,8).getValues().map(r => ({
    id:String(r[0]||''),
    createdAt:formatInviteDate_(r[1]),
    inviteeName:String(r[2]||''),
    inviteeInstagram:String(r[3]||''),
    inviterName:String(r[4]||''),
    inviterInstagram:String(r[5]||''),
    status:String(r[6]||'PENDING'),
    approvedAt:formatInviteDate_(r[7])
  })).reverse();
}

function updateInviteStatus_(id, status) {
  status = String(status || '').toUpperCase();
  if (!['APPROVED','REJECTED'].includes(status)) throw new Error('올바르지 않은 상태입니다.');

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const log = sheet_(SHEETS.INVITE_LOG);
    if (log.getLastRow() < 2) throw new Error('초대 요청이 없습니다.');
    const ids = log.getRange(2,1,log.getLastRow()-1,1).getValues();
    let row = 0;
    for (let i=0;i<ids.length;i++) if (String(ids[i][0]) === String(id)) { row=i+2; break; }
    if (!row) throw new Error('초대 요청을 찾을 수 없습니다.');

    const v = log.getRange(row,1,1,8).getValues()[0];
    if (String(v[6]) !== 'PENDING') throw new Error('이미 처리된 요청입니다.');

    const inviteeName = cleanInvite_(v[2]);
    const inviteeInstagram = normInviteId_(v[3]);
    const inviterName = cleanInvite_(v[4]);

    if (status === 'APPROVED') {
      const follow = sheet_(SHEETS.FOLLOW);
      if (!findFollowByInstagram_(follow, inviteeInstagram)) appendFollowMember_(follow, inviteeName, inviteeInstagram);
      ensureInviteSummaryMember_(inviterName);
      incrementInviteSummary_(inviterName, inviteeName);
      clearListCaches_();
      log.getRange(row,8).setValue(new Date());
    }

    log.getRange(row,7).setValue(status);
    log_('초대 ' + (status === 'APPROVED' ? '승인' : '거절'), inviteeName + ' ← ' + inviterName);
    return { ok:true };
  } finally {
    lock.releaseLock();
  }
}

function findFollowMember_(sh, name, instagram) {
  if (!sh || sh.getLastRow() < 2) return null;
  const target = normInviteId_(instagram);
  const rows = sh.getRange(2,1,sh.getLastRow()-1,3).getValues();
  return rows.find(r => cleanInvite_(r[1]) === cleanInvite_(name) && normInviteId_(r[2]) === target) || null;
}
function findFollowByInstagram_(sh, instagram) {
  if (!sh || sh.getLastRow() < 2) return null;
  const target = normInviteId_(instagram);
  const rows = sh.getRange(2,1,sh.getLastRow()-1,3).getValues();
  return rows.find(r => normInviteId_(r[2]) === target) || null;
}
function appendFollowMember_(sh, name, instagram) {
  let maxNo = 0;
  if (sh.getLastRow() >= 2) sh.getRange(2,1,sh.getLastRow()-1,1).getValues().forEach(r => maxNo=Math.max(maxNo,Number(r[0])||0));
  sh.appendRow([maxNo+1, cleanInvite_(name), normInviteId_(instagram)]);
}
function ensureInviteSummaryMember_(nickname) {
  const sh = sheet_(SHEETS.INVITE_SUMMARY);
  let row = findInviteSummaryRow_(sh,nickname);
  if (row) return row;
  const follow = sheet_(SHEETS.FOLLOW);
  const found = findFollowByName_(follow,nickname);
  sh.appendRow([found ? found[0] : '', cleanInvite_(nickname), 0, 0, 0]);
  return sh.getLastRow();
}
function findFollowByName_(sh,name) {
  if (!sh || sh.getLastRow()<2) return null;
  const rows=sh.getRange(2,1,sh.getLastRow()-1,3).getValues();
  return rows.find(r=>cleanInvite_(r[1])===cleanInvite_(name))||null;
}
function findInviteSummaryRow_(sh,nickname) {
  if (!sh || sh.getLastRow()<2) return 0;
  const names=sh.getRange(2,2,sh.getLastRow()-1,1).getValues();
  for(let i=0;i<names.length;i++) if(cleanInvite_(names[i][0])===cleanInvite_(nickname)) return i+2;
  return 0;
}
function incrementInviteSummary_(inviterName, inviteeName) {
  const sh=sheet_(SHEETS.INVITE_SUMMARY);
  const row=findInviteSummaryRow_(sh,inviterName);
  if(!row) throw new Error('초대별관리에서 초대자를 찾을 수 없습니다.');
  const current=Number(sh.getRange(row,3).getValue()||0);
  const previous=Number(sh.getRange(row,4).getValue()||0);
  sh.getRange(row,3).setValue(current+1);
  sh.getRange(row,5).setValue(current+1+previous);

  const start=6,last=Math.max(start,sh.getLastColumn()),width=Math.max(1,last-start+1);
  const vals=sh.getRange(row,start,1,width).getValues()[0];
  if (!vals.some(v=>cleanInvite_(v)===cleanInvite_(inviteeName))) {
    const empty=vals.findIndex(v=>!String(v||'').trim());
    if(empty>=0) sh.getRange(row,start+empty).setValue(inviteeName);
    else sh.getRange(row,last+1).setValue(inviteeName);
  }
}
function normInviteId_(value) {
  let s=String(value||'').trim().toLowerCase();
  s=s.replace(/^https?:\/\/(www\.)?instagram\.com\//,'').replace(/[/?#].*$/,'').replace(/^@+/,'').replace(/\s+/g,'');
  return s?'@'+s:'';
}
function cleanInvite_(value) { return String(value||'').trim().replace(/\s+/g,' ').slice(0,100); }
function formatInviteDate_(value) {
  if (!value) return '';
  const d=value instanceof Date?value:new Date(value);
  return Utilities.formatDate(d,'Asia/Seoul','yyyy-MM-dd HH:mm:ss');
}

function requireAdmin_(password) {
  if (!verify_(KEYS.ADMIN_PASSWORD, password).ok) {
    throw new Error('운영진 비밀번호가 올바르지 않습니다.');
  }
}

function changePassword_(key, password, title) {
  const value = String(password == null ? '' : password).trim();
  validatePassword_(value);
  return updateSettings_({ [key]: value }, title);
}

function updateSettings_(updates, title) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const sh = sheet_(SHEETS.SETTINGS);
    const changed = {};
    const lockKeys = [KEYS.APP_LOCK, KEYS.FOLLOW_LOCK, KEYS.MATCH_LOCK];
    const passwordKeys = [KEYS.ACCESS_PASSWORD, KEYS.FOLLOW_PASSWORD, KEYS.MATCH_PASSWORD, KEYS.APP_LOCK_PASSWORD];

    Object.entries(updates || {}).forEach(([key, raw]) => {
      if (!ALLOWED_SETTINGS.has(key)) return;

      let value = String(raw == null ? '' : raw).trim();
      if (lockKeys.includes(key)) value = boolString_(value);
      if (passwordKeys.includes(key)) validatePassword_(value);

      setSetting_(sh, key, value);
      changed[key] = passwordKeys.includes(key) ? '****' : value;
    });

    const time = now_();
    setSetting_(sh, KEYS.UPDATED_AT, time);
    clearSettingsCache_();
    log_(title, JSON.stringify(changed));
    SpreadsheetApp.flush();

    return {
      ok: true,
      changed: Object.keys(changed),
      updatedAt: time,
      publicConfig: publicConfig_(),
    };
  } finally {
    lock.releaseLock();
  }
}

function addNotice_(content) {
  const text = String(content == null ? '' : content).trim();
  if (!text) throw new Error('공지 내용을 입력해주세요.');
  if (text.length > 1000) throw new Error('공지 내용은 1,000자 이하로 입력해주세요.');

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const id = Utilities.getUuid();
    const time = now_();

    sheet_(SHEETS.NOTICES).appendRow([time, text, id]);

    const settings = sheet_(SHEETS.SETTINGS);
    setSetting_(settings, KEYS.NOTICE, text);
    setSetting_(settings, KEYS.UPDATED_AT, time);

    clearNoticeCache_();
    clearSettingsCache_();

    log_('공지 작성', text.slice(0, 100));
    SpreadsheetApp.flush();

    return {
      ok: true,
      noticeId: id,
      createdAt: time,
      notices: notices_(),
    };
  } finally {
    lock.releaseLock();
  }
}

function deleteNotice_(noticeId) {
  const id = String(noticeId || '').trim();
  if (!id) throw new Error('삭제할 공지 ID가 없습니다.');

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const sh = sheet_(SHEETS.NOTICES);
    const lastRow = sh.getLastRow();
    let found = false;

    if (lastRow >= 2) {
      const ids = sh.getRange(2, 3, lastRow - 1, 1).getDisplayValues();

      for (let index = ids.length - 1; index >= 0; index--) {
        if (String(ids[index][0]) === id) {
          sh.deleteRow(index + 2);
          found = true;
          break;
        }
      }
    }

    if (!found) throw new Error('삭제할 공지를 찾지 못했습니다.');

    clearNoticeCache_();
    const list = notices_();
    const latest = list.length ? list[0].content : '';

    const settings = sheet_(SHEETS.SETTINGS);
    const time = now_();

    setSetting_(settings, KEYS.NOTICE, latest);
    setSetting_(settings, KEYS.UPDATED_AT, time);

    clearSettingsCache_();
    log_('공지 삭제', id);
    SpreadsheetApp.flush();

    return { ok: true, notices: list, updatedAt: time };
  } finally {
    lock.releaseLock();
  }
}

function clearNotices_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const sh = sheet_(SHEETS.NOTICES);
    const lastRow = sh.getLastRow();

    if (lastRow >= 2) sh.deleteRows(2, lastRow - 1);

    const settings = sheet_(SHEETS.SETTINGS);
    const time = now_();

    setSetting_(settings, KEYS.NOTICE, '');
    setSetting_(settings, KEYS.UPDATED_AT, time);

    clearNoticeCache_();
    clearSettingsCache_();

    log_('공지 전체 삭제', '');
    SpreadsheetApp.flush();

    return { ok: true, notices: [], updatedAt: time };
  } finally {
    lock.releaseLock();
  }
}

function adminLogs_() {
  const sh = sheet_(SHEETS.LOG);
  const lastRow = sh.getLastRow();

  if (lastRow < 2) return [];

  const count = Math.min(100, lastRow - 1);

  return sh.getRange(lastRow - count + 1, 1, count, 3)
    .getDisplayValues()
    .map((row) => ({
      createdAt: String(row[0] || ''),
      action: String(row[1] || ''),
      detail: String(row[2] || ''),
    }))
    .reverse();
}

function fillMissingNoticeIds_(sh) {
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return;

  const values = sh.getRange(2, 1, lastRow - 1, 3).getDisplayValues();

  values.forEach((row, index) => {
    const content = String(row[1] || '').trim();
    const noticeId = String(row[2] || '').trim();

    if (content && !noticeId) {
      sh.getRange(index + 2, 3).setValue(Utilities.getUuid());
    }
  });
}

function securityVersion_(settings) {
  const source = [
    settings[KEYS.ACCESS_PASSWORD],
    settings[KEYS.ADMIN_PASSWORD],
    settings[KEYS.FOLLOW_LOCK],
    settings[KEYS.FOLLOW_PASSWORD],
    settings[KEYS.MATCH_LOCK],
    settings[KEYS.MATCH_PASSWORD],
    settings[KEYS.APP_LOCK],
    settings[KEYS.APP_LOCK_PASSWORD],
  ].map((value) => String(value || '')).join('|');

  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    source,
    Utilities.Charset.UTF_8
  );

  return digest
    .map((byte) => ('0' + ((byte + 256) % 256).toString(16)).slice(-2))
    .join('')
    .slice(0, 24);
}

function onEdit(e) {
  try {
    if (!e || !e.range) return;

    const sh = e.range.getSheet();
    const sheetName = sh.getName();

    if (sheetName === SHEETS.SETTINGS) {
      const key = String(sh.getRange(e.range.getRow(), 1).getDisplayValue() || '').trim();

      if (key && key !== KEYS.UPDATED_AT) {
        setSetting_(sh, KEYS.UPDATED_AT, now_());
        clearSettingsCache_();

        const passwordKeys = [
          KEYS.ACCESS_PASSWORD,
          KEYS.ADMIN_PASSWORD,
          KEYS.FOLLOW_PASSWORD,
          KEYS.MATCH_PASSWORD,
          KEYS.APP_LOCK_PASSWORD,
        ];

        const value = passwordKeys.includes(key) ? '****' : String(e.value || '');
        log_('시트 직접 수정', key + ': ' + value);
      }
    } else if (sheetName === SHEETS.NOTICES && e.range.getRow() >= 2) {
      fillMissingNoticeIds_(sh);

      const settings = sheet_(SHEETS.SETTINGS);
      setSetting_(settings, KEYS.UPDATED_AT, now_());

      clearNoticeCache_();
      clearSettingsCache_();

      log_('공지 시트 수정', '행 ' + e.range.getRow());
    } else if (sheetName === SHEETS.FOLLOW) {
      clearFollowCache_();

      const settings = sheet_(SHEETS.SETTINGS);
      setSetting_(settings, KEYS.UPDATED_AT, now_());
      clearSettingsCache_();
    } else if (sheetName === SHEETS.MATCH) {
      clearMatchCache_();

      const settings = sheet_(SHEETS.SETTINGS);
      setSetting_(settings, KEYS.UPDATED_AT, now_());
      clearSettingsCache_();
    }
  } catch (err) {
    console.error(err);
  }
}

function spreadsheet_() {
  if (!SPREADSHEET_ID || SPREADSHEET_ID === '여기에_구글시트_ID_입력') {
    throw new Error('SPREADSHEET_ID를 입력해주세요.');
  }
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function sheet_(name) {
  const sh = spreadsheet_().getSheetByName(name);
  if (!sh) throw new Error("'" + name + "' 시트를 찾지 못했습니다.");
  return sh;
}

function sheetOrCreate_(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function getSettings_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(CACHE_KEYS.SETTINGS);

  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (_) {
      cache.remove(CACHE_KEYS.SETTINGS);
    }
  }

  const settings = settingsMap_(sheet_(SHEETS.SETTINGS));
  cache.put(CACHE_KEYS.SETTINGS, JSON.stringify(settings), CACHE_SECONDS.SETTINGS);
  return settings;
}

function settingsMap_(sh) {
  const lastRow = sh.getLastRow();
  if (lastRow < 1) return {};

  const values = sh.getRange(1, 1, lastRow, 2).getDisplayValues();
  const out = {};

  values.forEach(([keyValue, value]) => {
    const key = String(keyValue || '').trim();
    if (key) out[key] = String(value || '');
  });

  return out;
}

function setSetting_(sh, key, value) {
  sh.getRange('A:B').setNumberFormat('@');

  const lastRow = Math.max(sh.getLastRow(), 1);
  const keys = sh.getRange(1, 1, lastRow, 1).getDisplayValues();

  for (let index = 0; index < keys.length; index++) {
    if (String(keys[index][0]).trim() === key) {
      sh.getRange(index + 1, 2).setNumberFormat('@').setValue(String(value));
      return;
    }
  }

  sh.appendRow([key, String(value)]);
  sh.getRange(sh.getLastRow(), 2).setNumberFormat('@');
}

function ensureListHeader_(sh) {
  const row = sh.getRange(1, 1, 1, 3).getDisplayValues()[0];
  const expected = ['번호', '닉네임', '아이디'];

  expected.forEach((header, index) => {
    if (!String(row[index] || '').trim()) {
      sh.getRange(1, index + 1).setValue(header);
    }
  });
}

function ensureHeaders_(sh, headers) {
  const row = sh.getRange(1, 1, 1, headers.length).getDisplayValues()[0];
  const empty = row.every((value) => !String(value || '').trim());

  if (sh.getLastRow() === 0 || empty) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    headers.forEach((header, index) => {
      if (!String(row[index] || '').trim()) {
        sh.getRange(1, index + 1).setValue(header);
      }
    });
  }
}

function log_(action, detail) {
  sheet_(SHEETS.LOG).appendRow([
    now_(),
    String(action || ''),
    String(detail || ''),
  ]);
}

function body_(e) {
  const out = {};

  if (e && e.parameter) {
    Object.keys(e.parameter).forEach((key) => {
      out[key] = e.parameter[key];
    });
  }

  const raw = e && e.postData && e.postData.contents
    ? String(e.postData.contents)
    : '';

  const contentType = e && e.postData && e.postData.type
    ? String(e.postData.type).toLowerCase()
    : '';

  if (raw && contentType.includes('application/json')) {
    Object.assign(out, JSON.parse(raw));
  }

  if (typeof out.settings === 'string') {
    out.settings = JSON.parse(out.settings);
  }

  return out;
}

function parseSettings_(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;

  try {
    return JSON.parse(String(value));
  } catch (_) {
    throw new Error('settings JSON 형식이 올바르지 않습니다.');
  }
}

function param_(e, key) {
  return e && e.parameter ? e.parameter[key] : '';
}

function json_(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function jsonError_(err) {
  console.error(err);
  return json_({
    ok: false,
    error: err && err.message ? err.message : String(err),
  });
}

function instaId_(value) {
  const text = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//, '')
    .replace(/^instagram\.com\//, '')
    .replace(/^_u\//, '')
    .replace(/^@+/, '')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '')
    .trim();

  return /^[a-z0-9._]{1,30}$/.test(text) ? text : '';
}

function validatePassword_(password) {
  if (!password) throw new Error('비밀번호를 입력해주세요.');
  if (password.length < 4 || password.length > 30) {
    throw new Error('비밀번호는 4~30자로 입력해주세요.');
  }
}

function bool_(value) {
  return String(value || '').trim().toUpperCase() === 'TRUE';
}

function boolString_(value) {
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';

  return ['TRUE', '1', 'ON', 'YES', 'Y']
    .includes(String(value || '').trim().toUpperCase())
    ? 'TRUE'
    : 'FALSE';
}

function safeEqual_(a, b) {
  a = String(a || '');
  b = String(b || '');

  if (a.length !== b.length) return false;

  let diff = 0;
  for (let index = 0; index < a.length; index++) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }

  return diff === 0;
}

function now_() {
  return Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone() || 'Asia/Seoul',
    'yyyy-MM-dd HH:mm:ss'
  );
}

function clearFollowCache_() {
  removeLargeCache_(CACHE_KEYS.FOLLOW_LIST);
}

function clearMatchCache_() {
  removeLargeCache_(CACHE_KEYS.MATCH_LIST);
}

function clearListCaches_() {
  removeLargeCache_(CACHE_KEYS.FOLLOW_LIST);
  removeLargeCache_(CACHE_KEYS.MATCH_LIST);
}

function clearSettingsCache_() {
  CacheService.getScriptCache().remove(CACHE_KEYS.SETTINGS);
}

function clearNoticeCache_() {
  CacheService.getScriptCache().remove(CACHE_KEYS.NOTICES);
}

function clearAllCaches_() {
  removeLargeCache_(CACHE_KEYS.FOLLOW_LIST);
  removeLargeCache_(CACHE_KEYS.MATCH_LIST);
  const cache = CacheService.getScriptCache();
  cache.remove(CACHE_KEYS.SETTINGS);
  cache.remove(CACHE_KEYS.NOTICES);
}


// CacheService 한 항목의 용량 제한을 피하기 위해 큰 명단 JSON을 여러 조각으로 저장합니다.
function putLargeCache_(key, text, seconds) {
  const cache = CacheService.getScriptCache();
  removeLargeCache_(key);
  const chunkSize = 80000;
  const chunks = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize));
  }
  const values = {};
  chunks.forEach((chunk, index) => {
    values[key + '_PART_' + index] = chunk;
  });
  if (chunks.length) cache.putAll(values, seconds);
  cache.put(key + '_COUNT', String(chunks.length), seconds);
}

function getLargeCache_(key) {
  const cache = CacheService.getScriptCache();
  const count = Number(cache.get(key + '_COUNT') || 0);
  if (!count) return null;
  const keys = Array.from({ length: count }, (_, i) => key + '_PART_' + i);
  const values = cache.getAll(keys);
  const parts = keys.map(k => values[k]);
  if (parts.some(part => typeof part !== 'string')) {
    removeLargeCache_(key);
    return null;
  }
  return parts.join('');
}

function removeLargeCache_(key) {
  const cache = CacheService.getScriptCache();
  const count = Number(cache.get(key + '_COUNT') || 0);
  const keys = [key + '_COUNT'];
  for (let i = 0; i < count; i++) keys.push(key + '_PART_' + i);
  cache.removeAll(keys);
}
