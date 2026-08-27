
const SHEET_ROOMS = '굴비방';
const SHEET_LINKS = '참여링크';
const SHEET_REQUESTS = '수정요청';
const SHEET_ADMINS = '운영진';
const SHEET_VOTES = '참여투표';
const SHEET_POLLS = '투표목록';
const SHEET_POLL_RESPONSES = '투표응답';
const SHEET_PROGRESS = '진행현황';

function doGet(e) {
  setupSheets_();
  const t = HtmlService.createTemplateFromFile('Index');
  t.room = (e && e.parameter && e.parameter.room) ? String(e.parameter.room).trim().toUpperCase() : '';
  return t.evaluate()
    .setTitle('모네 굴비엮기 · 좋아요')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no');
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function setupSheets_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  let rooms = ss.getSheetByName(SHEET_ROOMS);
  if (!rooms) {
    rooms = ss.insertSheet(SHEET_ROOMS);
    rooms.getRange(1,1,1,10).setValues([[
      'RoomCode','제목','최대인원','상태','방장PIN','생성일','마감안내','안내문구','생성자','수정일'
    ]]);
    rooms.setFrozenRows(1);
  }
  if (rooms.getMaxColumns() < 13) {
    rooms.insertColumnsAfter(rooms.getMaxColumns(), 13 - rooms.getMaxColumns());
  }
  if (!String(rooms.getRange(1,11).getValue() || '').trim()) {
    rooms.getRange(1,11).setValue('보관여부');
  }
  if (!String(rooms.getRange(1,12).getValue() || '').trim()) rooms.getRange(1,12).setValue('참여마감일시');
  if (!String(rooms.getRange(1,13).getValue() || '').trim()) rooms.getRange(1,13).setValue('완료마감일시');

  let links = ss.getSheetByName(SHEET_LINKS);
  if (!links) {
    links = ss.insertSheet(SHEET_LINKS);
    links.getRange(1,1,1,10).setValues([[
      'RoomCode','닉네임','인스타ID','링크','수정PIN','등록일','수정일','상태','순번','메모'
    ]]);
    links.setFrozenRows(1);
  }

  let requests = ss.getSheetByName(SHEET_REQUESTS);
  if (!requests) {
    requests = ss.insertSheet(SHEET_REQUESTS);
    requests.getRange(1,1,1,15).setValues([[
      'RequestID','RoomCode','인스타ID','기존닉네임','기존링크',
      '요청닉네임','요청링크','요청일','상태','처리일',
      '처리메모','처리담당자','처리담당슬롯','수정PIN확인','요청유형'
    ]]);
    requests.setFrozenRows(1);
  }


  let votes = ss.getSheetByName(SHEET_VOTES);
  if (!votes) {
    votes = ss.insertSheet(SHEET_VOTES);
    votes.getRange(1,1,1,8).setValues([[
      'RoomCode','인스타ID','닉네임','선택','투표일','수정일','상태','메모'
    ]]);
    votes.setFrozenRows(1);
  }


  let polls = ss.getSheetByName(SHEET_POLLS);
  if (!polls) {
    polls = ss.insertSheet(SHEET_POLLS);
    polls.getRange(1,1,1,10).setValues([[
      'PollID','RoomCode','제목','안내문구','선택지JSON','상태',
      '생성일','마감일시','생성운영진','수정일'
    ]]);
    polls.setFrozenRows(1);
  }

  let pollResponses = ss.getSheetByName(SHEET_POLL_RESPONSES);
  if (!pollResponses) {
    pollResponses = ss.insertSheet(SHEET_POLL_RESPONSES);
    pollResponses.getRange(1,1,1,9).setValues([[
      'PollID','RoomCode','인스타ID','닉네임','선택',
      '투표일','수정일','상태','메모'
    ]]);
    pollResponses.setFrozenRows(1);
  }

  let progress = ss.getSheetByName(SHEET_PROGRESS);
  if (!progress) {
    progress = ss.insertSheet(SHEET_PROGRESS);
    progress.getRange(1,1,1,8).setValues([[
      'RoomCode','인스타ID','닉네임','완료수','전체수','완료여부','수정일','상태'
    ]]);
    progress.setFrozenRows(1);
  }

  let admins = ss.getSheetByName(SHEET_ADMINS);
  if (!admins) {
    admins = ss.insertSheet(SHEET_ADMINS);
    admins.getRange(1,1,1,5).setValues([[
      '운영진ID','담당자명','로그인ID','PIN','사용여부'
    ]]);
    admins.setFrozenRows(1);

    // 기존 모네담당자 시트가 있으면 2~3행의 실제 계정을 자동 이관
    const oldAdmins = ss.getSheetByName('모네담당자');
    if (oldAdmins && oldAdmins.getLastRow() >= 2) {
      const rows = oldAdmins.getRange(2,1,Math.min(2, oldAdmins.getLastRow()-1),5).getValues();
      rows.forEach(function(r, idx) {
        const name = String(r[1] || '').trim();
        const loginId = String(r[2] || '').trim();
        const pin = String(r[3] || '').trim();
        if (loginId && pin) {
          admins.appendRow([
            String(r[0] || ('ADMIN_' + (idx + 1))),
            name,
            loginId,
            pin,
            String(r[4] || 'TRUE')
          ]);
        }
      });
    }
  }
}

/* ---------- 굴비방 ---------- */

function createRoom(data) {
  setupSheets_();
  verifyAdminToken_(data.token);
  const title = clean_(data.title);
  const maxPeople = Number(data.maxPeople || 9);
  const hostPin = String(data.hostPin || '').trim();
  const note = clean_(data.note || '');
  const deadline = clean_(data.deadline || '');
  const participationDeadlineRaw = String(data.participationDeadline || '').trim();
  const completionDeadlineRaw = String(data.completionDeadline || '').trim();
  let participationDeadline = '';
  let completionDeadline = '';
  if (participationDeadlineRaw) {
    const d = new Date(participationDeadlineRaw);
    if (isNaN(d.getTime())) throw new Error('참여 마감시간을 확인해주세요.');
    participationDeadline = d;
  }
  if (completionDeadlineRaw) {
    const d = new Date(completionDeadlineRaw);
    if (isNaN(d.getTime())) throw new Error('완료 마감시간을 확인해주세요.');
    completionDeadline = d;
  }
  if (participationDeadline && completionDeadline && completionDeadline <= participationDeadline) {
    throw new Error('완료 마감시간은 참여 마감시간보다 늦게 설정해주세요.');
  }

  if (!title) throw new Error('굴비 제목을 입력해주세요.');
  if (!Number.isFinite(maxPeople) || maxPeople < 2 || maxPeople > 1000) {
    throw new Error('최대 인원은 2~1000명으로 설정해주세요.');
  }
  if (!/^\d{4}$/.test(hostPin)) throw new Error('방장 PIN은 숫자 4자리로 입력해주세요.');

  const roomCode = makeRoomCode_();
  const now = new Date();
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_ROOMS);
  sh.appendRow([roomCode, title, maxPeople, 'OPEN', hostPin, now, deadline, note, '', now, 'FALSE', participationDeadline, completionDeadline]);

  return {
    ok: true,
    roomCode,
    url: buildRoomUrl_(roomCode),
    title,
    maxPeople
  };
}



function roomPhase_(room) {
  if (!room) return 'CLOSED';
  if (String(room.status || '').toUpperCase() === 'CLOSED') return 'CLOSED';
  const now = Date.now();
  const p = room.participationDeadline ? new Date(room.participationDeadline).getTime() : NaN;
  const c = room.completionDeadline ? new Date(room.completionDeadline).getTime() : NaN;
  if (!isNaN(c) && now >= c) return 'CLOSED';
  if (!isNaN(p) && now >= p) return 'COMPLETION';
  return 'PARTICIPATION';
}

function phaseLabel_(phase) {
  if (phase === 'PARTICIPATION') return '참여 중';
  if (phase === 'COMPLETION') return '좋아요 완료 중';
  return '마감';
}

function getRoomList() {
  setupSheets_();
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_ROOMS);
  const values = sh.getDataRange().getValues();
  const items = [];

  for (let i = values.length - 1; i >= 1; i--) {
    const roomCode = normalizeRoomCode_(values[i][0]);
    if (!roomCode) continue;
    const archived = String(values[i][10] || '').toUpperCase() === 'TRUE';
    if (archived) continue;

    const room = findRoom_(roomCode);
    const phase = roomPhase_(room);
    const links = getLinks_(roomCode);
    items.push({
      roomCode: roomCode,
      title: String(values[i][1] || ''),
      maxPeople: Number(values[i][2] || 0),
      status: String(values[i][3] || 'OPEN'),
      phase: phase,
      phaseLabel: phaseLabel_(phase),
      createdAt: formatDate_(values[i][5]),
      deadline: values[i][6] ? String(values[i][6]) : '',
      participationDeadline: room && room.participationDeadline ? formatDate_(room.participationDeadline) : '',
      completionDeadline: room && room.completionDeadline ? formatDate_(room.completionDeadline) : '',
      count: links.length,
      shareUrl: buildRoomUrl_(roomCode)
    });
  }

  const rank = {PARTICIPATION:0, COMPLETION:1, CLOSED:2};
  items.sort(function(a,b){
    const d=(rank[a.phase]||0)-(rank[b.phase]||0);
    if (d) return d;
    return String(b.createdAt||'').localeCompare(String(a.createdAt||''));
  });
  return {ok:true,items:items};
}


function archiveRooms(data) {
  setupSheets_();
  verifyAdminToken_(data.token);
  const codes = Array.isArray(data.roomCodes) ? data.roomCodes : [];
  if (!codes.length) throw new Error('보관할 굴비를 선택해주세요.');
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_ROOMS);
  let count = 0;
  codes.forEach(function(c) {
    const room = findRoom_(normalizeRoomCode_(c));
    if (!room) return;
    sh.getRange(room.row,11).setValue('TRUE');
    sh.getRange(room.row,10).setValue(new Date());
    count++;
  });
  return {ok:true,count:count,message:count+'개의 굴비를 보관함으로 이동했어요.'};
}

function archiveRoom(data) {
  setupSheets_();
  const admin = verifyAdminToken_(data.token);
  const roomCode = normalizeRoomCode_(data.roomCode);
  const room = findRoom_(roomCode);
  if (!room) throw new Error('굴비방을 찾을 수 없어요.');

  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_ROOMS);
  sh.getRange(room.row, 11).setValue('TRUE');
  sh.getRange(room.row, 10).setValue(new Date());

  return { ok:true, message:'굴비를 목록에서 보관했어요.', adminName:admin.name };
}

function getArchivedRoomList(data) {
  setupSheets_();
  verifyAdminToken_(data.token);

  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_ROOMS);
  const values = sh.getDataRange().getValues();
  const items = [];

  for (let i = values.length - 1; i >= 1; i--) {
    const roomCode = normalizeRoomCode_(values[i][0]);
    if (!roomCode) continue;

    const archived = String(values[i][10] || '').toUpperCase() === 'TRUE';
    if (!archived) continue;

    const links = getLinks_(roomCode);
    items.push({
      roomCode: roomCode,
      title: String(values[i][1] || ''),
      maxPeople: Number(values[i][2] || 0),
      status: String(values[i][3] || 'OPEN'),
      createdAt: formatDate_(values[i][5]),
      count: links.length,
      shareUrl: buildRoomUrl_(roomCode)
    });
  }

  return { ok:true, items:items };
}

function restoreRoom(data) {
  setupSheets_();
  const admin = verifyAdminToken_(data.token);
  const roomCode = normalizeRoomCode_(data.roomCode);
  const room = findRoom_(roomCode);
  if (!room) throw new Error('굴비방을 찾을 수 없어요.');

  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_ROOMS);
  sh.getRange(room.row, 11).setValue('FALSE');
  sh.getRange(room.row, 10).setValue(new Date());

  return { ok:true, message:'굴비를 목록으로 복원했어요.', adminName:admin.name };
}

function getRoom(roomCode) {
  setupSheets_();
  roomCode = normalizeRoomCode_(roomCode);
  if (!roomCode) throw new Error('굴비방 코드를 입력해주세요.');

  const room = findRoom_(roomCode);
  if (!room) throw new Error('존재하지 않는 굴비방이에요.');
  // 보관된 과거 굴비를 브라우저가 기억해 다시 여는 현상 방지
  const roomSheet = SpreadsheetApp.getActive().getSheetByName(SHEET_ROOMS);
  const archived = String(roomSheet.getRange(room.row, 11).getValue() || '').toUpperCase() === 'TRUE';
  if (archived) throw new Error('보관된 굴비방이에요. 굴비 목록에서 현재 방을 열어주세요.');

  const links = getLinks_(roomCode);
  return {
    roomCode,
    title: room.title,
    maxPeople: room.maxPeople,
    status: room.status,
    phase: roomPhase_(room),
    phaseLabel: phaseLabel_(roomPhase_(room)),
    deadline: room.deadline,
    participationDeadline: room.participationDeadline ? formatDate_(room.participationDeadline) : '',
    completionDeadline: room.completionDeadline ? formatDate_(room.completionDeadline) : '',
    note: room.note,
    count: links.length,
    links: links.map((x, i) => ({
      no: i + 1,
      nickname: x.nickname,
      instagramId: x.instagramId,
      url: x.url,
      updatedAt: formatDate_(x.updatedAt || x.createdAt)
    })),
    shareUrl: buildRoomUrl_(roomCode)
  };
}

function closeRoom(data) {
  const roomCode = normalizeRoomCode_(data.roomCode);
  const hostPin = String(data.hostPin || '').trim();
  const room = findRoom_(roomCode);
  if (!room) throw new Error('존재하지 않는 굴비방이에요.');
  if (String(room.hostPin) !== hostPin) throw new Error('방장 PIN이 맞지 않아요.');

  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_ROOMS);
  sh.getRange(room.row, 4).setValue('CLOSED');
  sh.getRange(room.row, 10).setValue(new Date());
  return { ok: true, message: '굴비방을 마감했어요.', room: getRoom(roomCode) };
}

function reopenRoom(data) {
  const roomCode = normalizeRoomCode_(data.roomCode);
  const hostPin = String(data.hostPin || '').trim();
  const room = findRoom_(roomCode);
  if (!room) throw new Error('존재하지 않는 굴비방이에요.');
  if (String(room.hostPin) !== hostPin) throw new Error('방장 PIN이 맞지 않아요.');

  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_ROOMS);
  sh.getRange(room.row, 4).setValue('OPEN');
  sh.getRange(room.row, 10).setValue(new Date());
  return { ok: true, message: '굴비방을 다시 열었어요.', room: getRoom(roomCode) };
}


/* ---------- 참여 투표 ---------- */

function submitVote(data) {
  setupSheets_();

  const roomCode = normalizeRoomCode_(data.roomCode);
  const instagramId = normalizeInstagramId_(data.instagramId);
  const nickname = clean_(data.nickname || '');
  const choice = String(data.choice || '').trim();

  if (!roomCode) throw new Error('굴비방 정보가 없어요.');
  if (!instagramId) throw new Error('인스타 아이디를 입력해주세요.');
  if (!['참여','벌칙','프패'].includes(choice)) throw new Error('투표 항목을 선택해주세요.');

  const room = findRoom_(roomCode);
  if (!room) throw new Error('존재하지 않는 굴비방이에요.');
  if (room.status !== 'OPEN') throw new Error('마감된 굴비방은 투표할 수 없어요.');

  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_VOTES);
  const values = sh.getDataRange().getValues();
  const now = new Date();

  for (let i = 1; i < values.length; i++) {
    if (
      normalizeRoomCode_(values[i][0]) === roomCode &&
      normalizeInstagramId_(values[i][1]) === instagramId
    ) {
      sh.getRange(i+1,3).setValue(nickname);
      sh.getRange(i+1,4).setValue(choice);
      sh.getRange(i+1,6).setValue(now);
      sh.getRange(i+1,7).setValue('ACTIVE');
      return {ok:true,message:'투표가 변경됐어요.',choice:choice};
    }
  }

  sh.appendRow([roomCode,instagramId,nickname,choice,now,now,'ACTIVE','']);
  return {ok:true,message:'투표가 완료됐어요.',choice:choice};
}

function getMyVote(data) {
  setupSheets_();
  const roomCode = normalizeRoomCode_(data.roomCode);
  const instagramId = normalizeInstagramId_(data.instagramId);
  if (!instagramId) return {ok:true,choice:''};

  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_VOTES);
  const values = sh.getDataRange().getValues();

  for (let i = values.length - 1; i >= 1; i--) {
    if (
      normalizeRoomCode_(values[i][0]) === roomCode &&
      normalizeInstagramId_(values[i][1]) === instagramId &&
      String(values[i][6] || 'ACTIVE') === 'ACTIVE'
    ) {
      return {ok:true,choice:String(values[i][3] || '')};
    }
  }
  return {ok:true,choice:''};
}

function getVoteSummary(roomCode) {
  setupSheets_();
  roomCode = normalizeRoomCode_(roomCode);

  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_VOTES);
  const values = sh.getDataRange().getValues();
  const counts = {'참여':0,'벌칙':0,'프패':0};
  let total = 0;

  for (let i = 1; i < values.length; i++) {
    if (
      normalizeRoomCode_(values[i][0]) === roomCode &&
      String(values[i][6] || 'ACTIVE') === 'ACTIVE'
    ) {
      const c = String(values[i][3] || '');
      if (counts.hasOwnProperty(c)) {
        counts[c]++;
        total++;
      }
    }
  }

  return {ok:true,total:total,counts:counts};
}


/* ---------- 운영진 투표 관리 ---------- */

function getVoteAdminList(data) {
  setupSheets_();
  verifyAdminToken_(data.token);

  const roomCode = normalizeRoomCode_(data.roomCode);
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_VOTES);
  const values = sh.getDataRange().getValues();
  const items = [];
  const counts = {'참여':0,'벌칙':0,'프패':0};

  for (let i = 1; i < values.length; i++) {
    if (
      normalizeRoomCode_(values[i][0]) === roomCode &&
      String(values[i][6] || 'ACTIVE') === 'ACTIVE'
    ) {
      const choice = String(values[i][3] || '');
      if (counts.hasOwnProperty(choice)) counts[choice]++;
      items.push({
        instagramId: normalizeInstagramId_(values[i][1]),
        nickname: String(values[i][2] || ''),
        choice: choice,
        votedAt: formatDate_(values[i][4]),
        updatedAt: formatDate_(values[i][5])
      });
    }
  }

  return {ok:true,total:items.length,counts:counts,items:items};
}

function updateVoteByAdmin(data) {
  setupSheets_();
  const admin = verifyAdminToken_(data.token);

  const roomCode = normalizeRoomCode_(data.roomCode);
  const instagramId = normalizeInstagramId_(data.instagramId);
  const choice = String(data.choice || '').trim();

  if (!['참여','벌칙','프패'].includes(choice)) {
    throw new Error('투표 항목이 올바르지 않아요.');
  }

  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_VOTES);
  const values = sh.getDataRange().getValues();

  for (let i = 1; i < values.length; i++) {
    if (
      normalizeRoomCode_(values[i][0]) === roomCode &&
      normalizeInstagramId_(values[i][1]) === instagramId &&
      String(values[i][6] || 'ACTIVE') === 'ACTIVE'
    ) {
      sh.getRange(i+1,4).setValue(choice);
      sh.getRange(i+1,6).setValue(new Date());
      sh.getRange(i+1,8).setValue('운영진 수정: ' + admin.name);
      return {ok:true,message:'투표를 수정했어요.'};
    }
  }

  throw new Error('해당 투표를 찾을 수 없어요.');
}

function deleteVoteByAdmin(data) {
  setupSheets_();
  const admin = verifyAdminToken_(data.token);

  const roomCode = normalizeRoomCode_(data.roomCode);
  const instagramId = normalizeInstagramId_(data.instagramId);

  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_VOTES);
  const values = sh.getDataRange().getValues();

  for (let i = 1; i < values.length; i++) {
    if (
      normalizeRoomCode_(values[i][0]) === roomCode &&
      normalizeInstagramId_(values[i][1]) === instagramId &&
      String(values[i][6] || 'ACTIVE') === 'ACTIVE'
    ) {
      sh.getRange(i+1,7).setValue('DELETED');
      sh.getRange(i+1,6).setValue(new Date());
      sh.getRange(i+1,8).setValue('운영진 삭제: ' + admin.name);
      return {ok:true,message:'투표를 삭제했어요.'};
    }
  }

  throw new Error('해당 투표를 찾을 수 없어요.');
}


/* ---------- 운영진 자유 투표 ---------- */

function createPollId_() {
  return 'POLL' + Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Seoul', 'yyyyMMddHHmmssSSS');
}

function parsePollOptions_(v) {
  let arr = Array.isArray(v) ? v : [];
  arr = arr.map(function(x){ return clean_(x); }).filter(function(x){ return !!x; });
  const unique = [];
  arr.forEach(function(x){ if (unique.indexOf(x) === -1) unique.push(x); });
  if (unique.length < 2) throw new Error('투표 선택지는 2개 이상 입력해주세요.');
  if (unique.length > 8) throw new Error('투표 선택지는 최대 8개까지 가능해요.');
  return unique;
}

function pollDeadlinePassed_(deadline) {
  if (!deadline) return false;
  const d = new Date(deadline);
  if (isNaN(d.getTime())) return false;
  return d.getTime() <= Date.now();
}

function createCustomPoll(data) {
  setupSheets_();
  const admin = verifyAdminToken_(data.token);
  const roomCode = normalizeRoomCode_(data.roomCode);
  const title = clean_(data.title);
  const notice = clean_(data.notice || '');
  const options = parsePollOptions_(data.options);
  const deadlineRaw = String(data.deadline || '').trim();

  if (!roomCode || !findRoom_(roomCode)) throw new Error('굴비방을 찾을 수 없어요.');
  if (!title) throw new Error('투표 제목을 입력해주세요.');

  let deadline = '';
  if (deadlineRaw) {
    const d = new Date(deadlineRaw);
    if (isNaN(d.getTime())) throw new Error('투표 마감시간을 확인해주세요.');
    deadline = d;
  }

  const pollId = createPollId_();
  const now = new Date();
  SpreadsheetApp.getActive().getSheetByName(SHEET_POLLS).appendRow([
    pollId, roomCode, title, notice, JSON.stringify(options), 'OPEN',
    now, deadline, admin.name, now
  ]);

  return {ok:true,pollId:pollId,message:'투표를 만들었어요.'};
}

function getCustomPolls(data) {
  setupSheets_();
  const roomCode = normalizeRoomCode_(data.roomCode);
  const instagramId = normalizeInstagramId_(data.instagramId || '');

  const psh = SpreadsheetApp.getActive().getSheetByName(SHEET_POLLS);
  const rsh = SpreadsheetApp.getActive().getSheetByName(SHEET_POLL_RESPONSES);
  const pvals = psh.getDataRange().getValues();
  const rvals = rsh.getDataRange().getValues();
  const items = [];

  for (let i = pvals.length - 1; i >= 1; i--) {
    if (normalizeRoomCode_(pvals[i][1]) !== roomCode) continue;
    let status = String(pvals[i][5] || 'OPEN');
    const deadline = pvals[i][7];
    if (status === 'OPEN' && pollDeadlinePassed_(deadline)) {
      status = 'CLOSED';
      psh.getRange(i+1,6).setValue('CLOSED');
      psh.getRange(i+1,10).setValue(new Date());
    }
    if (status === 'DELETED') continue;

    let options = [];
    try { options = JSON.parse(String(pvals[i][4] || '[]')); } catch(e) {}
    if (!Array.isArray(options)) options = [];

    const counts = {};
    options.forEach(function(o){ counts[o] = 0; });
    let total = 0;
    let myChoice = '';

    for (let j = 1; j < rvals.length; j++) {
      if (
        String(rvals[j][0] || '') === String(pvals[i][0] || '') &&
        String(rvals[j][7] || 'ACTIVE') === 'ACTIVE'
      ) {
        const c = String(rvals[j][4] || '');
        if (counts.hasOwnProperty(c)) counts[c]++;
        total++;
        if (instagramId && normalizeInstagramId_(rvals[j][2]) === instagramId) myChoice = c;
      }
    }

    items.push({
      pollId: String(pvals[i][0] || ''),
      title: String(pvals[i][2] || ''),
      notice: String(pvals[i][3] || ''),
      options: options,
      status: status,
      createdAt: formatDate_(pvals[i][6]),
      deadline: pvals[i][7] ? formatDate_(pvals[i][7]) : '',
      total: total,
      counts: counts,
      myChoice: myChoice
    });
  }

  return {ok:true,items:items};
}

function submitCustomPollVote(data) {
  setupSheets_();
  const roomCode = normalizeRoomCode_(data.roomCode);
  const pollId = String(data.pollId || '').trim();
  const instagramId = normalizeInstagramId_(data.instagramId);
  const nickname = clean_(data.nickname || '');
  const choice = clean_(data.choice);

  if (!instagramId) throw new Error('인스타 아이디를 입력해주세요.');

  const psh = SpreadsheetApp.getActive().getSheetByName(SHEET_POLLS);
  const pvals = psh.getDataRange().getValues();
  let pollRow = -1;
  let options = [];
  let status = '';
  let deadline = '';

  for (let i = 1; i < pvals.length; i++) {
    if (
      String(pvals[i][0] || '') === pollId &&
      normalizeRoomCode_(pvals[i][1]) === roomCode
    ) {
      pollRow = i + 1;
      status = String(pvals[i][5] || 'OPEN');
      deadline = pvals[i][7];
      try { options = JSON.parse(String(pvals[i][4] || '[]')); } catch(e) {}
      break;
    }
  }

  if (pollRow < 0) throw new Error('투표를 찾을 수 없어요.');
  if (status !== 'OPEN' || pollDeadlinePassed_(deadline)) {
    if (status === 'OPEN') psh.getRange(pollRow,6).setValue('CLOSED');
    throw new Error('마감된 투표예요.');
  }
  if (!Array.isArray(options) || options.indexOf(choice) === -1) {
    throw new Error('투표 선택지를 다시 확인해주세요.');
  }

  const rsh = SpreadsheetApp.getActive().getSheetByName(SHEET_POLL_RESPONSES);
  const rvals = rsh.getDataRange().getValues();
  const now = new Date();

  for (let i = 1; i < rvals.length; i++) {
    if (
      String(rvals[i][0] || '') === pollId &&
      normalizeInstagramId_(rvals[i][2]) === instagramId
    ) {
      rsh.getRange(i+1,4).setValue(nickname);
      rsh.getRange(i+1,5).setValue(choice);
      rsh.getRange(i+1,7).setValue(now);
      rsh.getRange(i+1,8).setValue('ACTIVE');
      return {ok:true,message:'투표가 변경됐어요.',choice:choice};
    }
  }

  rsh.appendRow([pollId,roomCode,instagramId,nickname,choice,now,now,'ACTIVE','']);
  return {ok:true,message:'투표가 완료됐어요.',choice:choice};
}

function getPollAdminOverview(data) {
  setupSheets_();
  verifyAdminToken_(data.token);
  const roomCode = normalizeRoomCode_(data.roomCode);

  const psh = SpreadsheetApp.getActive().getSheetByName(SHEET_POLLS);
  const rsh = SpreadsheetApp.getActive().getSheetByName(SHEET_POLL_RESPONSES);
  const pvals = psh.getDataRange().getValues();
  const rvals = rsh.getDataRange().getValues();
  const polls = [];

  for (let i = pvals.length - 1; i >= 1; i--) {
    if (normalizeRoomCode_(pvals[i][1]) !== roomCode) continue;
    const status = String(pvals[i][5] || 'OPEN');
    if (status === 'DELETED') continue;

    let options = [];
    try { options = JSON.parse(String(pvals[i][4] || '[]')); } catch(e) {}
    if (!Array.isArray(options)) options = [];
    const counts = {};
    options.forEach(function(o){ counts[o] = 0; });
    const responses = [];

    for (let j = 1; j < rvals.length; j++) {
      if (
        String(rvals[j][0] || '') === String(pvals[i][0] || '') &&
        String(rvals[j][7] || 'ACTIVE') === 'ACTIVE'
      ) {
        const c = String(rvals[j][4] || '');
        if (counts.hasOwnProperty(c)) counts[c]++;
        responses.push({
          instagramId: normalizeInstagramId_(rvals[j][2]),
          nickname: String(rvals[j][3] || ''),
          choice: c,
          updatedAt: formatDate_(rvals[j][6] || rvals[j][5])
        });
      }
    }

    polls.push({
      pollId:String(pvals[i][0] || ''),
      title:String(pvals[i][2] || ''),
      notice:String(pvals[i][3] || ''),
      options:options,
      status:status,
      deadline:pvals[i][7] ? formatDate_(pvals[i][7]) : '',
      counts:counts,
      total:responses.length,
      responses:responses
    });
  }
  return {ok:true,polls:polls};
}

function setCustomPollStatus(data) {
  setupSheets_();
  verifyAdminToken_(data.token);
  const pollId = String(data.pollId || '').trim();
  const status = String(data.status || '').trim().toUpperCase();
  if (['OPEN','CLOSED'].indexOf(status) === -1) throw new Error('투표 상태가 올바르지 않아요.');

  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_POLLS);
  const vals = sh.getDataRange().getValues();
  for (let i = 1; i < vals.length; i++) {
    if (String(vals[i][0] || '') === pollId) {
      sh.getRange(i+1,6).setValue(status);
      sh.getRange(i+1,10).setValue(new Date());
      return {ok:true,message:status === 'OPEN' ? '투표를 다시 열었어요.' : '투표를 마감했어요.'};
    }
  }
  throw new Error('투표를 찾을 수 없어요.');
}

function deleteCustomPoll(data) {
  setupSheets_();
  verifyAdminToken_(data.token);
  const pollId = String(data.pollId || '').trim();
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_POLLS);
  const vals = sh.getDataRange().getValues();
  for (let i = 1; i < vals.length; i++) {
    if (String(vals[i][0] || '') === pollId) {
      sh.getRange(i+1,6).setValue('DELETED');
      sh.getRange(i+1,10).setValue(new Date());
      return {ok:true,message:'투표를 삭제했어요.'};
    }
  }
  throw new Error('투표를 찾을 수 없어요.');
}

function updateCustomPollResponse(data) {
  setupSheets_();
  verifyAdminToken_(data.token);
  const pollId = String(data.pollId || '').trim();
  const instagramId = normalizeInstagramId_(data.instagramId);
  const choice = clean_(data.choice);

  const psh = SpreadsheetApp.getActive().getSheetByName(SHEET_POLLS);
  const pvals = psh.getDataRange().getValues();
  let options = [];
  for (let i = 1; i < pvals.length; i++) {
    if (String(pvals[i][0] || '') === pollId) {
      try { options = JSON.parse(String(pvals[i][4] || '[]')); } catch(e) {}
      break;
    }
  }
  if (!Array.isArray(options) || options.indexOf(choice) === -1) throw new Error('선택지가 올바르지 않아요.');

  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_POLL_RESPONSES);
  const vals = sh.getDataRange().getValues();
  for (let i = 1; i < vals.length; i++) {
    if (
      String(vals[i][0] || '') === pollId &&
      normalizeInstagramId_(vals[i][2]) === instagramId &&
      String(vals[i][7] || 'ACTIVE') === 'ACTIVE'
    ) {
      sh.getRange(i+1,5).setValue(choice);
      sh.getRange(i+1,7).setValue(new Date());
      sh.getRange(i+1,9).setValue('운영진 수정');
      return {ok:true,message:'투표 응답을 수정했어요.'};
    }
  }
  throw new Error('투표 응답을 찾을 수 없어요.');
}

function deleteCustomPollResponse(data) {
  setupSheets_();
  verifyAdminToken_(data.token);
  const pollId = String(data.pollId || '').trim();
  const instagramId = normalizeInstagramId_(data.instagramId);
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_POLL_RESPONSES);
  const vals = sh.getDataRange().getValues();

  for (let i = 1; i < vals.length; i++) {
    if (
      String(vals[i][0] || '') === pollId &&
      normalizeInstagramId_(vals[i][2]) === instagramId &&
      String(vals[i][7] || 'ACTIVE') === 'ACTIVE'
    ) {
      sh.getRange(i+1,8).setValue('DELETED');
      sh.getRange(i+1,7).setValue(new Date());
      sh.getRange(i+1,9).setValue('운영진 삭제');
      return {ok:true,message:'투표 응답을 삭제했어요.'};
    }
  }
  throw new Error('투표 응답을 찾을 수 없어요.');
}

/* ---------- 참여 링크 ---------- */

function addMyLink(data) {
  setupSheets_();
  const roomCode = normalizeRoomCode_(data.roomCode);
  const nickname = clean_(data.nickname);
  const instagramId = normalizeInstagramId_(data.instagramId);
  const url = normalizeInstagramUrl_(data.url);

  if (!nickname) throw new Error('닉네임을 입력해주세요.');
  if (!instagramId) throw new Error('인스타 아이디를 입력해주세요.');
  if (!url) throw new Error('인스타 게시물/릴스 링크를 확인해주세요.');

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const room = findRoom_(roomCode);
    if (!room) throw new Error('존재하지 않는 굴비방이에요.');
    if (room.status !== 'OPEN') throw new Error('마감된 굴비방이라 새 링크를 등록할 수 없어요.');
    if (roomPhase_(room) !== 'PARTICIPATION') throw new Error('링크 등록 시간이 마감됐어요.');

    const existing = findLink_(roomCode, instagramId);
    if (existing && existing.status === 'ACTIVE') {
      throw new Error('이 인스타 아이디는 이미 링크를 등록했어요.');
    }

    const current = getLinks_(roomCode);
    if (current.some(function(x){ return String(x.url || '') === String(url || ''); })) {
      throw new Error('이미 등록된 게시물 링크예요.');
    }
    if (current.length >= room.maxPeople) throw new Error('참여 인원이 모두 찼어요.');

    const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_LINKS);
    const now = new Date();
    sh.appendRow([roomCode, nickname, instagramId, url, '', now, now, 'ACTIVE', current.length + 1, '']);

    return { ok: true, message: '링크가 등록됐어요.', room: getRoom(roomCode) };
  } finally {
    lock.releaseLock();
  }
}

function verifyMyLink(data) {
  const roomCode = normalizeRoomCode_(data.roomCode);
  const instagramId = normalizeInstagramId_(data.instagramId);

  const found = findLink_(roomCode, instagramId);
  if (!found || found.status !== 'ACTIVE') throw new Error('등록된 참여 정보를 찾을 수 없어요.');

  return {
    ok: true,
    nickname: found.nickname,
    instagramId: found.instagramId,
    url: found.url,
    pending: hasPendingRequest_(roomCode, instagramId)
  };
}

/* 참여취소 기능 없음. 링크 수정만 운영진 승인 요청 */

function requestUpdateMyLink(data) {
  setupSheets_();
  const roomCode = normalizeRoomCode_(data.roomCode);
  const instagramId = normalizeInstagramId_(data.instagramId);
  const nickname = clean_(data.nickname);
  const url = normalizeInstagramUrl_(data.url);

  if (!nickname) throw new Error('닉네임을 입력해주세요.');
  if (!url) throw new Error('인스타 게시물/릴스 링크를 확인해주세요.');

  const room = findRoom_(roomCode);
  if (!room) throw new Error('존재하지 않는 굴비방이에요.');
  if (room.status !== 'OPEN') throw new Error('마감된 굴비방은 수정 요청을 할 수 없어요.');

  const found = findLink_(roomCode, instagramId);
  if (!found || found.status !== 'ACTIVE') throw new Error('등록된 참여 정보를 찾을 수 없어요.');
  if (hasPendingRequest_(roomCode, instagramId)) throw new Error('이미 운영진 승인 대기 중인 수정 요청이 있어요.');

  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_REQUESTS);
  const now = new Date();
  sh.appendRow([
    makeRequestId_(), roomCode, instagramId, found.nickname, found.url,
    nickname, url, now, 'PENDING', '', '', '', '', 'OK', 'UPDATE'
  ]);

  return { ok: true, message: '링크 수정 요청이 접수됐어요. 모네 담당자 승인 후 반영됩니다.' };
}

function getMyRequestStatus(data) {
  setupSheets_();
  const roomCode = normalizeRoomCode_(data.roomCode);
  const instagramId = normalizeInstagramId_(data.instagramId);

  const found = findLink_(roomCode, instagramId);
  if (!found) throw new Error('등록된 참여 정보를 찾을 수 없어요.');

  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_REQUESTS);
  const values = sh.getDataRange().getValues();
  const items = [];

  for (let i = values.length - 1; i >= 1; i--) {
    if (
      String(values[i][1]).trim().toUpperCase() === roomCode &&
      normalizeInstagramId_(values[i][2]) === instagramId
    ) {
      items.push({
        requestId: String(values[i][0]),
        requestedAt: formatDate_(values[i][7]),
        status: String(values[i][8]),
        processedAt: formatDate_(values[i][9]),
        note: String(values[i][10] || '')
      });
      if (items.length >= 5) break;
    }
  }
  return { ok: true, items };
}


/* ---------- 참여 인증 ---------- */

/*
  올바른 게시물/릴스 링크를 정상 등록한 참여자만
  프로그램 안에서 다른 참여자의 링크 '열기' 버튼을 사용할 수 있게 하는 인증.
*/
function verifyParticipantAccess(data) {
  setupSheets_();

  const roomCode = normalizeRoomCode_(data.roomCode);
  const instagramId = normalizeInstagramId_(data.instagramId);

  const room = findRoom_(roomCode);
  if (!room) throw new Error('존재하지 않는 굴비방이에요.');

  const found = findLink_(roomCode, instagramId);
  if (!found || found.status !== 'ACTIVE') {
    throw new Error('먼저 본인의 정상적인 게시물/릴스 링크를 등록해주세요.');
  }

  const normalized = normalizeInstagramUrl_(found.url);
  if (!normalized) {
    throw new Error('등록된 링크가 정상적인 인스타 게시물 링크가 아닙니다. 먼저 링크 수정 요청을 해주세요.');
  }

  return { ok: true, instagramId: found.instagramId, nickname: found.nickname };
}


/* ---------- 개인 진행 저장 / 운영 현황 ---------- */

function saveProgressSummary(data) {
  setupSheets_();
  const roomCode = normalizeRoomCode_(data.roomCode);
  const instagramId = normalizeInstagramId_(data.instagramId);
  const nickname = clean_(data.nickname || '');
  const done = Math.max(0, Number(data.done || 0));
  const total = Math.max(0, Number(data.total || 0));
  if (!roomCode || !instagramId) return {ok:false};

  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_PROGRESS);
  const vals = sh.getDataRange().getValues();
  const now = new Date();
  const completed = total > 0 && done >= total ? 'TRUE' : 'FALSE';

  for (let i = 1; i < vals.length; i++) {
    if (normalizeRoomCode_(vals[i][0]) === roomCode && normalizeInstagramId_(vals[i][1]) === instagramId) {
      sh.getRange(i+1,3,1,6).setValues([[nickname,done,total,completed,now,'ACTIVE']]);
      return {ok:true};
    }
  }
  sh.appendRow([roomCode,instagramId,nickname,done,total,completed,now,'ACTIVE']);
  return {ok:true};
}

function getRoomDashboard(data) {
  setupSheets_();
  verifyAdminToken_(data.token);
  const roomCode = normalizeRoomCode_(data.roomCode);
  const links = getLinks_(roomCode);
  const linkIds = {};
  links.forEach(function(x){ linkIds[normalizeInstagramId_(x.instagramId)] = true; });

  const psh = SpreadsheetApp.getActive().getSheetByName(SHEET_PROGRESS);
  const vals = psh.getDataRange().getValues();
  let completed = 0;
  const unfinished = [];
  const completedIds = {};

  for (let i = 1; i < vals.length; i++) {
    if (
      normalizeRoomCode_(vals[i][0]) === roomCode &&
      String(vals[i][7] || 'ACTIVE') === 'ACTIVE'
    ) {
      const id = normalizeInstagramId_(vals[i][1]);
      if (String(vals[i][5] || '').toUpperCase() === 'TRUE') {
        completedIds[id] = true;
      }
    }
  }
  Object.keys(completedIds).forEach(function(id){ if (linkIds[id]) completed++; });
  links.forEach(function(x){
    const id = normalizeInstagramId_(x.instagramId);
    if (!completedIds[id]) unfinished.push({nickname:x.nickname,instagramId:id});
  });

  return {
    ok:true,
    registered:links.length,
    completed:completed,
    unfinished:unfinished.length,
    unfinishedList:unfinished
  };
}

/* ---------- 운영진 알림/승인 ---------- */

/* 공개되는 건 '대기 건수'뿐. 10초마다 화면에서 갱신해 알림 배지로 표시 */
function getPendingRequestCount() {
  setupSheets_();
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_REQUESTS);
  const values = sh.getDataRange().getValues();
  let count = 0;
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][8]) === 'PENDING') count++;
  }
  return { ok: true, count };
}

/* 모네 담당자 2명만 로그인 가능 */
function adminLogin(data) {
  setupSheets_();
  const admin = verifyMonetAdmin_(data.loginId, data.pin);
  return {
    ok: true,
    slot: admin.slot,
    name: admin.name,
    token: makeAdminToken_(admin)
  };
}

function getPendingRequests(data) {
  setupSheets_();
  const admin = verifyAdminToken_(data.token);

  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_REQUESTS);
  const values = sh.getDataRange().getValues();
  const items = [];

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][8]) !== 'PENDING') continue;

    const roomCode = normalizeRoomCode_(values[i][1]);
    const room = findRoom_(roomCode);

    items.push({
      requestId: String(values[i][0]),
      roomCode,
      roomTitle: room ? room.title : '',
      instagramId: normalizeInstagramId_(values[i][2]),
      oldNickname: String(values[i][3] || ''),
      oldUrl: String(values[i][4] || ''),
      newNickname: String(values[i][5] || ''),
      newUrl: String(values[i][6] || ''),
      requestedAt: formatDate_(values[i][7])
    });
  }

  return { ok: true, adminName: admin.name, items };
}

function processRequest(data) {
  setupSheets_();
  const admin = verifyAdminToken_(data.token);
  const requestId = String(data.requestId || '').trim();
  const decision = String(data.decision || '').trim().toUpperCase();
  const note = clean_(data.note || '');

  if (!['APPROVE','REJECT'].includes(decision)) throw new Error('처리 방식이 올바르지 않아요.');

  const reqSh = SpreadsheetApp.getActive().getSheetByName(SHEET_REQUESTS);
  const values = reqSh.getDataRange().getValues();

  let row = -1;
  let req = null;
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0]) === requestId) {
      row = i + 1;
      req = values[i];
      break;
    }
  }

  if (!req) throw new Error('수정 요청을 찾을 수 없어요.');
  if (String(req[8]) !== 'PENDING') throw new Error('이미 처리된 요청이에요.');

  if (decision === 'APPROVE') {
    const roomCode = normalizeRoomCode_(req[1]);
    const instagramId = normalizeInstagramId_(req[2]);
    const found = findLink_(roomCode, instagramId);

    if (!found || found.status !== 'ACTIVE') throw new Error('현재 참여 정보를 찾을 수 없어 승인할 수 없어요.');

    const linkSh = SpreadsheetApp.getActive().getSheetByName(SHEET_LINKS);
    linkSh.getRange(found.row, 2).setValue(String(req[5] || found.nickname));
    linkSh.getRange(found.row, 4).setValue(String(req[6] || found.url));
    linkSh.getRange(found.row, 7).setValue(new Date());

    reqSh.getRange(row, 9).setValue('APPROVED');
  } else {
    reqSh.getRange(row, 9).setValue('REJECTED');
  }

  reqSh.getRange(row, 10).setValue(new Date());
  reqSh.getRange(row, 11).setValue(note);
  reqSh.getRange(row, 12).setValue(admin.name);
  reqSh.getRange(row, 13).setValue(admin.slot);

  return {
    ok: true,
    message: decision === 'APPROVE' ? '링크 수정을 승인했어요.' : '링크 수정 요청을 거절했어요.'
  };
}

/* ---------- 내부 ---------- */

function verifyMonetAdmin_(loginId, pin) {
  const id = String(loginId || '').trim().toLowerCase();
  const p = String(pin || '').trim();
  if (!id || !p) throw new Error('운영진 로그인ID와 PIN을 입력해주세요.');

  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_ADMINS);
  const lastRow = sh.getLastRow();
  if (lastRow < 2) throw new Error('등록된 운영진이 없어요.');

  const values = sh.getRange(2,1,lastRow-1,5).getValues();

  for (let i = 0; i < values.length; i++) {
    const slot = String(values[i][0] || '').trim();
    const name = String(values[i][1] || '').trim();
    const savedId = String(values[i][2] || '').trim().toLowerCase();
    const savedPin = String(values[i][3] || '').trim();
    const enabled = String(values[i][4] || 'TRUE').toUpperCase() !== 'FALSE';

    if (enabled && savedId && savedPin && savedId === id && savedPin === p) {
      return { slot: slot || ('ADMIN_' + (i + 1)), name: name || savedId, loginId: savedId, pin: savedPin };
    }
  }

  throw new Error('운영진 정보가 맞지 않아요.');
}

/*
  Apps Script 웹앱에서 간단히 유지하는 세션 토큰.
  민감한 외부 서비스용 인증이 아니라 내부 승인화면 진입 제한용.
*/
function makeAdminToken_(admin) {
  const ts = Date.now();
  const raw = [admin.slot, admin.loginId, ts].join('|');
  const sig = Utilities.base64EncodeWebSafe(
    Utilities.computeHmacSha256Signature(raw, admin.pin)
  );
  return Utilities.base64EncodeWebSafe(raw) + '.' + sig;
}

function verifyAdminToken_(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 2) throw new Error();

    const raw = Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString();
    const [slot, loginId, tsText] = raw.split('|');
    const ts = Number(tsText);
    if (!slot || !loginId || !ts) throw new Error();

    if (Date.now() - ts > 12 * 60 * 60 * 1000) throw new Error('SESSION_EXPIRED');

    const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_ADMINS);
    const lastRow = sh.getLastRow();
    if (lastRow < 2) throw new Error();

    const values = sh.getRange(2,1,lastRow-1,5).getValues();

    for (let i = 0; i < values.length; i++) {
      const rSlot = String(values[i][0] || '').trim();
      const name = String(values[i][1] || '').trim();
      const rId = String(values[i][2] || '').trim().toLowerCase();
      const pin = String(values[i][3] || '').trim();
      const enabled = String(values[i][4] || 'TRUE').toUpperCase() !== 'FALSE';

      if (enabled && rSlot === slot && rId === loginId && pin) {
        const sig = Utilities.base64EncodeWebSafe(
          Utilities.computeHmacSha256Signature(raw, pin)
        );
        if (sig !== parts[1]) throw new Error();
        return { slot:rSlot, name:name || rId, loginId:rId };
      }
    }
  } catch (e) {
    if (String(e && e.message) === 'SESSION_EXPIRED') {
      throw new Error('운영진 로그인 시간이 만료됐어요. 다시 로그인해주세요.');
    }
  }
  throw new Error('운영진 로그인이 필요해요.');
}

function findRoom_(roomCode) {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_ROOMS);
  const values = sh.getDataRange().getValues();

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0]).trim().toUpperCase() === roomCode) {
      return {
        row: i + 1,
        roomCode: String(values[i][0]),
        title: String(values[i][1]),
        maxPeople: Number(values[i][2]),
        status: String(values[i][3]),
        hostPin: String(values[i][4]),
        createdAt: values[i][5],
        deadline: values[i][6] ? String(values[i][6]) : '',
        note: values[i][7] ? String(values[i][7]) : '',
        participationDeadline: values[i][11] || '',
        completionDeadline: values[i][12] || ''
      };
    }
  }
  return null;
}

function findLink_(roomCode, instagramId) {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_LINKS);
  const values = sh.getDataRange().getValues();

  for (let i = 1; i < values.length; i++) {
    if (
      String(values[i][0]).trim().toUpperCase() === roomCode &&
      normalizeInstagramId_(values[i][2]) === instagramId
    ) {
      return {
        row: i + 1,
        nickname: String(values[i][1]),
        instagramId: normalizeInstagramId_(values[i][2]),
        url: String(values[i][3]),
        editPin: String(values[i][4]),
        createdAt: values[i][5],
        updatedAt: values[i][6],
        status: String(values[i][7] || 'ACTIVE'),
        order: Number(values[i][8] || i)
      };
    }
  }
  return null;
}

function getLinks_(roomCode) {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_LINKS);
  const values = sh.getDataRange().getValues();
  const out = [];

  for (let i = 1; i < values.length; i++) {
    if (
      String(values[i][0]).trim().toUpperCase() === roomCode &&
      String(values[i][7] || 'ACTIVE') === 'ACTIVE'
    ) {
      out.push({
        nickname: String(values[i][1]),
        instagramId: normalizeInstagramId_(values[i][2]),
        url: String(values[i][3]),
        createdAt: values[i][5],
        updatedAt: values[i][6],
        order: Number(values[i][8] || i)
      });
    }
  }

  out.sort((a,b) => a.order - b.order);
  return out;
}

function hasPendingRequest_(roomCode, instagramId) {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_REQUESTS);
  const values = sh.getDataRange().getValues();

  for (let i = 1; i < values.length; i++) {
    if (
      String(values[i][1]).trim().toUpperCase() === roomCode &&
      normalizeInstagramId_(values[i][2]) === instagramId &&
      String(values[i][8]) === 'PENDING'
    ) return true;
  }
  return false;
}

function makeRoomCode_() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 20; attempt++) {
    let code = '';
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    if (!findRoom_(code)) return code;
  }
  throw new Error('방 코드 생성에 실패했어요. 다시 시도해주세요.');
}

function makeRequestId_() {
  return 'RQ' + Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone() || 'Asia/Seoul',
    'yyyyMMddHHmmssSSS'
  );
}

function buildRoomUrl_(roomCode) {
  let base = '';
  try { base = ScriptApp.getService().getUrl() || ''; } catch (e) {}
  return base ? `${base}?room=${encodeURIComponent(roomCode)}` : `?room=${encodeURIComponent(roomCode)}`;
}

function normalizeRoomCode_(v) {
  return String(v || '').trim().toUpperCase().replace(/[^A-Z0-9]/g,'');
}

function normalizeInstagramId_(v) {
  return String(v || '').trim().replace(/^@/,'').toLowerCase();
}

function normalizeInstagramUrl_(v) {
  // Apps Script 서버에서는 브라우저의 URL 객체에 의존하지 않고
  // 정규식으로 직접 파싱한다. (클라이언트에서 정상으로 보이는데
  // 서버 저장 단계에서 거절되는 문제 방지)
  let s = String(v || '').trim();
  if (!s) return '';

  s = s.replace(/\s+/g, '');
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;

  // www / m / instagram.com 허용, p / reel / reels / tv 허용
  // 뒤의 ?igsi, ?igsh 등 공유 파라미터와 #fragment는 모두 무시
  const m = s.match(/^https?:\/\/(?:www\.|m\.)?instagram\.com\/(p|reel|reels|tv)\/([A-Za-z0-9_-]+)(?:\/)?(?:[?#].*)?$/i);
  if (!m) return '';

  const shortcode = m[2];
  if (!shortcode || shortcode.length < 5) return '';

  // 모네방 룰: 모든 게시물/릴스 주소를 /p/ 형식으로 통일
  return 'https://www.instagram.com/p/' + shortcode + '/';
}

function clean_(v) {
  return String(v || '').trim().replace(/[<>]/g,'');
}

function formatDate_(d) {
  if (!d) return '';
  try {
    return Utilities.formatDate(
      new Date(d),
      Session.getScriptTimeZone() || 'Asia/Seoul',
      'MM/dd HH:mm'
    );
  } catch (e) {
    return '';
  }
}
