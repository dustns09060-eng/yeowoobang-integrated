const $ = (id) => document.getElementById(id);

let roomList = [];
let roomAuditSource = [];
let matchRoomList = [];
let result = { all: [], mutual: [], onlyMe: [], fansOnly: [], neither: [] };
let currentTab = "all";
let currentGroup = 0;
let currentCopyBatch = 0;
let installPrompt = null;
let adminLoggedIn = false;
let adminPasswordValue = "";
let publicConfig = null;
let accessGranted = false;
let appLockGranted = false;
let matchGranted = false;
let followGranted = false;
let gateMode = "loading";
let memberSession = null;
const MEMBER_SESSION_KEY = "yeowoobang:memberSession:v1";
let securityVersion = "";
let noticeSignature = "";
const APP_VERSION = "V71-FINAL";

let config = {
  version: "V4.2 FASTBOOT",
  appName: "여우방 통합 프로그램",
  apiUrl: "https://script.google.com/macros/s/AKfycbxWgC8LmsbYvyAhTJ34wc_oiJVdBLQz5iFBaSAbX8yKn1HHxl2bBMn2tLYyCFtBjd09/exec",
  sheetId: "1PxeAtZrHS2N2VlKFTfxERyq8SAzgAn7o815q43gZzTY",
  sheetName: "팔로우리스트",
  fallbackCsv: "room-list.csv",
};

const FOLLOW_PROGRESS_KEY = "yeowoobang:lastFollowPosition:v1";
const FOLLOW_DAILY_KEY = "yeowoobang:dailyFollowVisits:v1";
const FOLLOW_LIST_CACHE_KEY = "yeowoobang:followListCache:v1";
const FOLLOW_LIST_CACHE_MAX_AGE = 1000 * 60 * 60 * 24 * 7;
let memberTodayFollowCount = null;
let memberFollowProgressLoaded = false;
const ROSTER_BASELINE_KEY = "yeowoobang:adminRosterBaseline:v1";
let lastRosterAudit = null;
const JSZIP_CDN_URL = "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js";
let jsZipLoadPromise = null;

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function readStorageJson(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (_) {
    return fallback;
  }
}

function writeStorageJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (_) {
    return false;
  }
}

function formatResumeTime(timestamp) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";

  const today = localDateKey();
  const target = localDateKey(date);
  const time = date.toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  });

  if (target === today) return `오늘 ${time}`;

  return `${date.toLocaleDateString("ko-KR", {
    month: "numeric",
    day: "numeric",
  })} ${time}`;
}

function getDailyVisitData() {
  const today = localDateKey();
  const saved = readStorageJson(FOLLOW_DAILY_KEY, null);

  if (!saved || saved.date !== today || !Array.isArray(saved.ids)) {
    return { date: today, ids: [] };
  }

  return saved;
}

function recordDailyVisit(id) {
  const daily = getDailyVisitData();
  if (!daily.ids.includes(id)) daily.ids.push(id);
  writeStorageJson(FOLLOW_DAILY_KEY, daily);
  renderResumeCard();
}

function saveLastFollowPosition(item) {
  const index = roomList.findIndex((person) => person.id === item.id);
  const group = index >= 0 ? Math.floor(index / 500) + 1 : Math.max(currentGroup, 1);

  const data = {
    group,
    no: String(item.no || ""),
    name: String(item.name || ""),
    id: String(item.id || ""),
    timestamp: Date.now(),
  };

  if (writeStorageJson(FOLLOW_PROGRESS_KEY, data)) {
    recordDailyVisit(data.id);
    renderResumeCard();
  }

  // 로그인 회원은 서버에도 저장 → 다른 기기에서도 이어보기 가능
  if (memberSession?.token) {
    void saveMemberFollowProgressToServer(data);
  }
}

function getLastFollowPosition() {
  const saved = readStorageJson(FOLLOW_PROGRESS_KEY, null);
  if (!saved || !validUsername(normalize(saved.id))) return null;
  return {
    ...saved,
    id: normalize(saved.id),
    group: Math.max(1, Number(saved.group) || 1),
  };
}

function renderResumeCard() {
  const card = $("resumeCard");
  if (!card) return;

  const last = getLastFollowPosition();
  const daily = getDailyVisitData();

  $("todayVisitCount").textContent = `오늘 ${memberSession && Number.isFinite(memberTodayFollowCount) ? memberTodayFollowCount : daily.ids.length}명`;

  if (!last) {
    card.classList.add("hidden");
    return;
  }

  $("resumeLocation").textContent = `${last.group}조 · ${last.no}번`;
  $("resumeName").textContent = last.name || "닉네임 없음";
  $("resumeId").textContent = `@${last.id}`;
  $("resumeTime").textContent = formatResumeTime(last.timestamp);
  card.classList.remove("hidden");
}

async function clearLastFollowPosition() {
  try {
    localStorage.removeItem(FOLLOW_PROGRESS_KEY);
  } catch (_) {}

  renderResumeCard();

  if (memberSession?.token) {
    try {
      const result = await apiPost("clearFollowProgress", { token: memberSession.token }, 12000);
      if (Number.isFinite(Number(result?.todayCount))) memberTodayFollowCount = Number(result.todayCount);
      renderResumeCard();
      toast("내 이어보기 기록을 초기화했습니다.");
      return;
    } catch (error) {
      toast(error.message || "서버 기록 초기화에 실패했습니다.");
      return;
    }
  }

  toast("이어보기 기록을 초기화했습니다.");
}

async function loadMemberFollowProgress() {
  if (!memberSession?.token) {
    memberTodayFollowCount = null;
    memberFollowProgressLoaded = false;
    renderResumeCard();
    return;
  }

  try {
    const result = await apiPost("getFollowProgress", { token: memberSession.token }, 12000);
    memberFollowProgressLoaded = true;
    memberTodayFollowCount = Number(result?.todayCount || 0);

    if (result?.progress?.id) {
      const progress = {
        group: Math.max(1, Number(result.progress.group) || 1),
        no: String(result.progress.no || ""),
        name: String(result.progress.name || ""),
        id: normalize(result.progress.id),
        timestamp: Number(result.progress.timestamp || Date.now()),
      };
      writeStorageJson(FOLLOW_PROGRESS_KEY, progress);
    } else {
      // V67에서 기기에만 저장했던 기록이 있으면 최초 1회 서버로 이관
      const local = getLastFollowPosition();
      if (local?.id) {
        await saveMemberFollowProgressToServer(local, true);
      }
    }

    renderResumeCard();
  } catch (error) {
    console.warn("회원 팔로우 진행상태 불러오기 실패", error);
    // 서버 오류 시 기존 기기 저장값으로 계속 이용 가능
    memberFollowProgressLoaded = false;
    renderResumeCard();
  }
}

async function saveMemberFollowProgressToServer(data, migration = false) {
  if (!memberSession?.token || !data?.id) return;

  try {
    const result = await apiPost("saveFollowProgress", {
      token: memberSession.token,
      progress: {
        group: Math.max(1, Number(data.group) || 1),
        no: String(data.no || ""),
        name: String(data.name || ""),
        id: normalize(data.id),
      },
    }, 12000);

    if (Number.isFinite(Number(result?.todayCount))) {
      memberTodayFollowCount = Number(result.todayCount);
    }

    if (result?.progress?.timestamp) {
      const current = getLastFollowPosition();
      if (current?.id === normalize(data.id)) {
        current.timestamp = Number(result.progress.timestamp);
        writeStorageJson(FOLLOW_PROGRESS_KEY, current);
      }
    }

    memberFollowProgressLoaded = true;
    renderResumeCard();
  } catch (error) {
    console.warn(migration ? "기존 이어보기 기록 이관 실패" : "팔로우 진행상태 서버 저장 실패", error);
  }
}

function highlightFollowItem(id) {
  const target = document.querySelector(
    `.follow-item[data-follow-id="${CSS.escape(id)}"]`
  );

  if (!target) return false;

  target.scrollIntoView({ behavior: "smooth", block: "center" });
  target.classList.add("resume-highlight");

  setTimeout(() => {
    target.classList.remove("resume-highlight");
  }, 2600);

  return true;
}

function resumeLastFollowPosition() {
  const last = getLastFollowPosition();
  if (!last) {
    toast("저장된 이어보기 기록이 없습니다.");
    return;
  }

  $("followSearch").value = "";
  currentGroup = last.group;
  currentCopyBatch = 0;
  renderGroupTabs();
  renderCopyBatches();
  renderFollowList();

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (!highlightFollowItem(last.id)) {
        toast("명단에서 마지막 위치를 찾지 못했습니다.");
      }
    });
  });
}

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.style.display = "block";
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.style.display = "none"), 1900);
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}

function normalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//, "")
    .replace(/^instagram\.com\//, "")
    .replace(/^_u\//, "")
    .replace(/^@+/, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "")
    .trim();
}

function validUsername(value) {
  return /^[a-z0-9._]{1,30}$/.test(value) &&
    !["instagram", "accounts", "explore", "direct", "p", "reels", "stories", "www", "about", "privacy", "terms", "login", "_u"].includes(value);
}

function unique(values) {
  const set = new Set();
  for (const value of values || []) {
    const id = normalize(value);
    if (validUsername(id)) set.add(id);
  }
  return [...set];
}


function saveFollowListCache(list) {
  if (!Array.isArray(list) || !list.length) return;

  writeStorageJson(FOLLOW_LIST_CACHE_KEY, {
    savedAt: Date.now(),
    members: list.map((item) => ({
      no: item.no,
      name: item.name,
      id: item.id,
    })),
  });
}

function restoreFollowListCache() {
  const cached = readStorageJson(FOLLOW_LIST_CACHE_KEY, null);
  if (!cached || !Array.isArray(cached.members) || !cached.members.length) {
    return false;
  }

  const age = Date.now() - Number(cached.savedAt || 0);
  if (!Number.isFinite(age) || age > FOLLOW_LIST_CACHE_MAX_AGE) {
    return false;
  }

  const restored = cached.members
    .map((item, index) => ({
      no: item.no || index + 1,
      name: String(item.name || ""),
      id: normalize(item.id),
    }))
    .filter((item) => validUsername(item.id));

  if (!restored.length) return false;

  roomList = restored;
  updateFollowStats();
  renderGroupTabs();
  renderCopyBatches();
  renderFollowList();
  renderResumeCard();

  if ($("followState")) {
    $("followState").textContent =
      `저장된 명단 ${roomList.length}명을 먼저 표시했습니다. 최신 명단 확인 중...`;
  }

  return true;
}

function scheduleNoticeLoad(delay = 2000) {
  window.setTimeout(() => {
    if (accessGranted) {
      loadNotices(false).catch(() => {});
    }
  }, delay);
}

function loadJsZipLibrary() {
  if (window.JSZip) return Promise.resolve(window.JSZip);
  if (jsZipLoadPromise) return jsZipLoadPromise;

  jsZipLoadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-jszip-lazy="true"]');

    if (existing) {
      existing.addEventListener("load", () => resolve(window.JSZip), { once: true });
      existing.addEventListener("error", () => reject(new Error("ZIP 분석 라이브러리를 불러오지 못했습니다.")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = JSZIP_CDN_URL;
    script.async = true;
    script.dataset.jszipLazy = "true";

    script.onload = () => {
      if (window.JSZip) {
        resolve(window.JSZip);
      } else {
        reject(new Error("ZIP 분석 라이브러리를 불러오지 못했습니다."));
      }
    };

    script.onerror = () => {
      jsZipLoadPromise = null;
      reject(new Error("ZIP 분석 라이브러리를 불러오지 못했습니다."));
    };

    document.head.appendChild(script);
  });

  return jsZipLoadPromise;
}


async function fetchWithTimeout(url, options = {}, timeoutMs = 4500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function loadConfig() {
  try {
    const response = await fetchWithTimeout("config.json?v=642", { cache: "no-store" }, 2500);
    if (response.ok) config = { ...config, ...(await response.json()) };
  } catch (_) {
    // app.js에 내장된 API 주소로 계속 진행합니다.
  }
}
async function apiGet(action, timeoutMs = 6000) {
  if (!config.apiUrl) throw new Error("Apps Script 주소가 설정되지 않았습니다.");
  const url = new URL(config.apiUrl);
  url.searchParams.set("action", action);
  url.searchParams.set("_t", Date.now().toString());

  const response = await fetchWithTimeout(url.toString(), {
    method: "GET",
    cache: "no-store",
    redirect: "follow",
  }, timeoutMs);

  if (!response.ok) throw new Error(`API HTTP ${response.status}`);
  const data = await response.json();
  if (!data.ok) throw new Error(data.error || data.message || "API 요청 실패");
  return data;
}
async function apiPost(action, payload = {}, timeoutMs = 9000) {
  if (!config.apiUrl) throw new Error("Apps Script 주소가 설정되지 않았습니다.");

  const params = new URLSearchParams();
  params.set("action", action);
  Object.entries(payload).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      params.set(key, typeof value === "object" ? JSON.stringify(value) : String(value));
    }
  });

  const response = await fetchWithTimeout(config.apiUrl, {
    method: "POST",
    body: params,
    redirect: "follow",
  }, timeoutMs);

  if (!response.ok) throw new Error(`API HTTP ${response.status}`);
  const data = await response.json();
  if (!data.ok) throw new Error(data.error || data.message || "API 요청 실패");
  return data;
}
function setGate(mode, message = "") {
  gateMode = mode;
  const title = $("gateTitle");
  const text = $("gateMessage");
  const roles = $("gateRoleSelect");
  const form = $("gateForm");
  const memberLoginForm = $("memberLoginForm");
  const memberRegisterForm = $("memberRegisterForm");
  const memberForgotForm = $("memberForgotForm");
  const retryBtn = $("gateRetryBtn");
  const password = $("gatePassword");

  $("gateError").textContent = "";
  roles.classList.add("hidden");
  form.classList.add("hidden");
  memberLoginForm?.classList.add("hidden");
  memberRegisterForm?.classList.add("hidden");
  memberForgotForm?.classList.add("hidden");
  retryBtn.classList.add("hidden");
  password.value = "";

  if (mode === "loading") {
    title.textContent = "접속 확인";
    text.textContent = message || "설정을 불러오는 중입니다.";
  } else if (mode === "role") {
    title.textContent = "여우방";
    text.textContent = "";
    roles.classList.remove("hidden");
  } else if (mode === "memberLogin") {
    title.textContent = "여우방";
    text.textContent = "";
    memberLoginForm?.classList.remove("hidden");
    setTimeout(() => $("memberLoginInstagram")?.focus(), 0);
  } else if (mode === "memberForgot") {
    title.textContent = "여우방";
    text.textContent = "";
    memberForgotForm?.classList.remove("hidden");
    setTimeout(() => $("memberForgotNickname")?.focus(), 0);
  } else if (mode === "memberRegister") {
    title.textContent = "여우방";
    text.textContent = "";
    memberRegisterForm?.classList.remove("hidden");
    setTimeout(() => $("memberRegisterNickname")?.focus(), 0);
  } else if (mode === "access") {
    title.textContent = "이용하기";
    text.textContent = "";
    password.placeholder = "접속 비밀번호";
    form.classList.remove("hidden");
  } else if (mode === "admin") {
    title.textContent = "운영진";
    text.textContent = "";
    password.placeholder = "운영진 비밀번호";
    form.classList.remove("hidden");
  } else if (mode === "blocked") {
    title.textContent = "앱 잠금 중";
    text.textContent = "현재 일반 접속이 잠겨 있습니다.";
    form.classList.remove("hidden");
    password.classList.add("hidden");
    $("gateSubmitBtn").classList.add("hidden");
  } else if (mode === "error") {
    title.textContent = "연결 확인 필요";
    text.textContent = message || "연결에 실패했습니다.";
    retryBtn.classList.remove("hidden");
  }

  if (mode !== "blocked") {
    password.classList.remove("hidden");
    $("gateSubmitBtn").classList.remove("hidden");
  }
}

function showGate() {
  $("appGate").classList.remove("hidden");
  document.body.classList.add("gate-open");
}

function hideGate() {
  $("appGate").classList.add("hidden");
  document.body.classList.remove("gate-open");
}

function setAdminNavigation(enabled) {
  $("adminNavBtn")?.classList.toggle("hidden", !enabled);
  $("noticeNavBtn")?.classList.toggle("hidden", enabled);
}

function finishBootScreen() {
  if (window.__yeowoobangBootTimer) {
    clearTimeout(window.__yeowoobangBootTimer);
    window.__yeowoobangBootTimer = null;
  }
  const boot = document.getElementById("bootScreen");
  if (boot) boot.remove();
}

async function bootstrapAuth() {
  showGate();
  setGate("loading", "로그인 정보를 확인하는 중입니다.");

  let configResult = null;
  try {
    configResult = await apiGet("publicConfig", 5000);
    publicConfig = configResult;
    updateLockIndicators();
  } catch (_) {
    publicConfig = publicConfig || {
      appLocked: false,
      followLocked: false,
      matchLocked: false,
      matchVoteOpen: false,
      notice: "",
      securityVersion: ""
    };
  }

  const saved = readMemberSessionStorage();
  if (saved?.token && !publicConfig?.appLocked) {
    try {
      const result = await apiPost("memberSession", { token: saved.token }, 9000);
      await completeMemberLogin(result, false);
      return;
    } catch (_) {
      clearMemberSessionStorage();
    }
  }

  setGate("role");
}

function chooseGeneralAccess() {
  if (publicConfig?.appLocked) {
    setGate("blocked");
    return;
  }
  setGate("memberLogin");
}

function chooseAdminAccess() {
  setGate("admin");
}

function readMemberSessionStorage() {
  try {
    const raw = localStorage.getItem(MEMBER_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function saveMemberSessionStorage(data) {
  try {
    localStorage.setItem(MEMBER_SESSION_KEY, JSON.stringify(data));
  } catch (_) {}
}

function clearMemberSessionStorage() {
  try { localStorage.removeItem(MEMBER_SESSION_KEY); } catch (_) {}
}

function setMemberHeader(member) {
  const badge = $("memberBadge");
  const menu = $("memberMenuBtn");
  if (!badge || !menu) return;

  if (!member || adminLoggedIn) {
    badge.classList.add("hidden");
    menu.classList.add("hidden");
    return;
  }

  $("memberBadgeName").textContent = member.nickname || "회원";
  $("memberBadgeId").textContent = member.instagramId ? `@${member.instagramId}` : "";
  badge.classList.remove("hidden");
  menu.classList.remove("hidden");
}

async function completeMemberLogin(result, showToast = true) {
  if (!result?.token || !result?.member) throw new Error("로그인 정보를 확인할 수 없습니다.");

  memberSession = { token: result.token, member: result.member };
  saveMemberSessionStorage(memberSession);
  accessGranted = true;
  adminLoggedIn = false;
  adminPasswordValue = "";
  try { sessionStorage.setItem("yeowoobangRole", "member"); } catch (_) {}
  setAdminNavigation(false);
  setMemberHeader(result.member);
  hideGate();
  await loadAfterAuth();
  await loadMemberFollowProgress();
  showView("followView");
  if (showToast) toast(`${result.member.nickname || "회원"}님, 반가워요 🦊`);
}

async function loginMemberFromGate() {
  const instagramId = normalize($("memberLoginInstagram")?.value || "");
  const password = $("memberLoginPassword")?.value || "";
  if (!instagramId || !password) {
    $("gateError").textContent = "인스타 아이디와 비밀번호를 입력해 주세요.";
    return;
  }

  const btn = $("memberLoginBtn");
  try {
    btn.disabled = true;
    $("gateError").textContent = "";
    const result = await apiPost("memberLogin", { instagramId, password }, 15000);
    $("memberLoginPassword").value = "";
    await completeMemberLogin(result, true);
  } catch (error) {
    $("gateError").textContent = error.message || "로그인에 실패했습니다.";
  } finally {
    btn.disabled = false;
  }
}

async function registerMemberFromGate() {
  const nickname = String($("memberRegisterNickname")?.value || "").trim();
  const instagramId = normalize($("memberRegisterInstagram")?.value || "");
  const password = $("memberRegisterPassword")?.value || "";
  const confirm = $("memberRegisterPasswordConfirm")?.value || "";

  if (!nickname || !instagramId || !password || !confirm) {
    $("gateError").textContent = "모든 항목을 입력해 주세요.";
    return;
  }
  if (password.length < 6) {
    $("gateError").textContent = "비밀번호는 6자 이상으로 설정해 주세요.";
    return;
  }
  if (password !== confirm) {
    $("gateError").textContent = "비밀번호 확인이 일치하지 않습니다.";
    return;
  }

  const btn = $("memberRegisterBtn");
  try {
    btn.disabled = true;
    $("gateError").textContent = "";
    const result = await apiPost("registerMemberAccount", { nickname, instagramId, password }, 20000);
    await completeMemberLogin(result, false);
    toast("계정 등록이 완료되었습니다. 🦊");
  } catch (error) {
    $("gateError").textContent = error.message || "계정 등록에 실패했습니다.";
  } finally {
    btn.disabled = false;
  }
}


function openMemberDrawer() {
  if (!memberSession?.member) return;
  $("drawerMemberName").textContent = `${memberSession.member.nickname || "회원"}님`;
  $("drawerMemberInstagram").textContent = memberSession.member.instagramId ? `@${memberSession.member.instagramId}` : "";
  $("memberDrawerBackdrop")?.classList.remove("hidden");
  $("memberDrawer")?.classList.remove("hidden");
  document.body.classList.add("drawer-open");
}
function closeMemberDrawer() {
  $("memberDrawerBackdrop")?.classList.add("hidden");
  $("memberDrawer")?.classList.add("hidden");
  document.body.classList.remove("drawer-open");
}
function openAccountModal(id) { closeMemberDrawer(); $(id)?.classList.remove("hidden"); document.body.classList.add("account-modal-open"); }
function closeAccountModal(id) { $(id)?.classList.add("hidden"); if (!document.querySelector('.account-modal:not(.hidden)')) document.body.classList.remove("account-modal-open"); }

async function openMyPage() {
  if (!memberSession?.token) return;
  openAccountModal("myPageModal");
  ["myPageNickname","myPageInsta","myPageJoinDate","myPageMemberId"].forEach(id => { if($(id)) $(id).textContent = "불러오는 중..."; });
  try {
    const data = await apiPost("getMyPage", {token:memberSession.token}, 15000);
    const m=data.member||{}, f=data.follow||{}, mt=data.match||{};
    $("myPageName").textContent=m.nickname||"회원";
    $("myPageInstagram").textContent=m.instagramId?`@${m.instagramId}`:"";
    $("myPageNickname").textContent=m.nickname||"-";
    $("myPageInsta").textContent=m.instagramId?`@${m.instagramId}`:"-";
    $("myPageJoinDate").textContent=m.joinDate||"등록 전";
    $("myPageMemberId").textContent=m.memberId??"-";
    $("myPageFollowText").textContent=`${Number(f.completed||0).toLocaleString()} / ${Number(f.total||0).toLocaleString()}명`;
    $("myPageFollowPercent").textContent=`${Number(f.percent||0)}% · 오늘 ${Number(f.todayCount||0)}명`;
    $("myPageFollowBar").style.width=`${Math.max(0,Math.min(100,Number(f.percent||0)))}%`;
    $("myPageMatchText").textContent=mt.submitted?`${mt.status} 제출`:(mt.open?"아직 미제출":"기간 아님");
    $("myPageMatchDate").textContent=mt.submittedAt?`최근 제출 ${mt.submittedAt}`:`${mt.title||"맞팔확인"}`;
  } catch(e) { toast(e.message||"마이페이지를 불러오지 못했습니다."); }
}

async function changeMemberPasswordFromUi() {
  const currentPassword=$("currentMemberPassword")?.value||"";
  const newPassword=$("newMemberPassword")?.value||"";
  const confirm=$("newMemberPasswordConfirm")?.value||"";
  const msg=$("changePasswordMessage");
  if(!currentPassword||!newPassword||!confirm){if(msg)msg.textContent="모든 항목을 입력해 주세요.";return;}
  if(newPassword.length<6){if(msg)msg.textContent="새 비밀번호는 6자 이상으로 설정해 주세요.";return;}
  if(newPassword!==confirm){if(msg)msg.textContent="새 비밀번호 확인이 일치하지 않습니다.";return;}
  try{
    const r=await apiPost("changeMemberPassword",{token:memberSession.token,currentPassword,newPassword},20000);
    if(msg)msg.textContent=r.message||"비밀번호가 변경되었습니다.";
    $("currentMemberPassword").value=$("newMemberPassword").value=$("newMemberPasswordConfirm").value="";
    toast("비밀번호가 변경되었습니다.");
  }catch(e){if(msg)msg.textContent=e.message||"비밀번호 변경에 실패했습니다.";}
}

async function resetMemberPasswordFromGate(){
  const nickname=String($("memberForgotNickname")?.value||"").trim();
  const instagramId=normalize($("memberForgotInstagram")?.value||"");
  const memberId=String($("memberForgotId")?.value||"").trim();
  const newPassword=$("memberForgotPassword")?.value||"";
  const confirm=$("memberForgotPasswordConfirm")?.value||"";
  if(!nickname||!instagramId||!memberId||!newPassword||!confirm){$("gateError").textContent="모든 항목을 입력해 주세요.";return;}
  if(newPassword.length<6){$("gateError").textContent="새 비밀번호는 6자 이상으로 설정해 주세요.";return;}
  if(newPassword!==confirm){$("gateError").textContent="새 비밀번호 확인이 일치하지 않습니다.";return;}
  const btn=$("memberForgotBtn");
  try{btn.disabled=true;$("gateError").textContent="";const r=await apiPost("resetMemberPassword",{nickname,instagramId,memberId,newPassword},20000);toast(r.message||"새 비밀번호가 설정되었습니다.");setGate("memberLogin");$("memberLoginInstagram").value=instagramId;}
  catch(e){$("gateError").textContent=e.message||"비밀번호 재설정에 실패했습니다.";}
  finally{btn.disabled=false;}
}

function logoutMember() {
  memberSession = null;
  memberTodayFollowCount = null;
  memberFollowProgressLoaded = false;
  clearMemberSessionStorage();
  accessGranted = false;
  matchGranted = false;
  followGranted = false;
  setMemberHeader(null);
  showGate();
  setGate("role");
  toast("로그아웃했습니다.");
}

function backToRoleSelect() {
  setGate("role");
}

async function submitGatePassword() {
  const password = $("gatePassword").value.trim();
  if (!password) {
    $("gateError").textContent = "비밀번호를 입력해 주세요.";
    return;
  }

  try {
    $("gateSubmitBtn").disabled = true;

    if (gateMode === "access") {
      const authResult = await apiPost("verifyAccessPassword", { password });
      if (authResult.publicConfig) publicConfig = authResult.publicConfig;
      accessGranted = true;
      adminLoggedIn = false;
      adminPasswordValue = "";
      try { sessionStorage.setItem("yeowoobangRole", "member"); } catch (_) {}
      setAdminNavigation(false);
      hideGate();
      await loadAfterAuth();

      showView("followView");
      return;
    }

    if (gateMode === "admin") {
      const adminAuth = await apiPost("adminLogin", { password });
      if (adminAuth.publicConfig) publicConfig = adminAuth.publicConfig;
      adminLoggedIn = true;
      memberSession = null;
      clearMemberSessionStorage();
      setMemberHeader(null);
      adminPasswordValue = password;
      try { sessionStorage.setItem("yeowoobangRole", "admin"); } catch (_) {}
      updateFoxMode();
      accessGranted = true;
      matchGranted = true;
      followGranted = true;
      setAdminNavigation(true);
      hideGate();
      await loadAfterAuth();
      showView("adminView");
      showAdminPanel();
    loadAdminDashboardV72();
      loadAdminLogs();
      toast("운영진으로 접속했습니다.");
    }
  } catch (error) {
    $("gateError").textContent =
      gateMode === "admin"
        ? "운영진 비밀번호가 올바르지 않습니다."
        : "접속 비밀번호가 올바르지 않습니다.";
  } finally {
    $("gateSubmitBtn").disabled = false;
  }
}

async function loadAfterAuth() {
  const restored = restoreFollowListCache();

  // 먼저 화면을 바로 열고 최신 데이터는 뒤에서 갱신합니다.
  if (!restored) {
    loadRoomList(false).catch(() => {});
  } else {
    setTimeout(() => loadRoomList(false).catch(() => {}), 400);
  }

  setTimeout(() => refreshPublicConfig(false).catch(() => {}), 700);
  scheduleNoticeLoad(1800);
  checkVersionUpdate();
}
async function refreshPublicConfig(recheck = true) {
  const previousSecurity = securityVersion || publicConfig?.securityVersion || "";
  publicConfig = await apiGet("publicConfig");
  updateLockIndicators();
  applyFollowLock();
  applyMatchLock();
  loadMatchVoteStatus().catch(()=>{});
  checkVersionUpdate();

  const nextSecurity = publicConfig?.securityVersion || "";
  if (recheck && previousSecurity && nextSecurity && previousSecurity !== nextSecurity && !adminLoggedIn) {
    securityVersion = nextSecurity;
    accessGranted = false;
    appLockGranted = false;
    matchGranted = false;
    followGranted = false;
    toast("보안 설정이 변경되어 다시 로그인합니다.");
    setAdminNavigation(false);
    await bootstrapAuth();
    return;
  }
  securityVersion = nextSecurity;
}

function checkVersionUpdate() {
  if (!publicConfig?.forceUpdate) return;
  const serverVersion = String(publicConfig.version || "").trim().toUpperCase();
  if (!serverVersion || serverVersion === APP_VERSION) return;
  $("updateMessage").textContent = `현재 ${APP_VERSION} · 최신 ${serverVersion}`;
  $("updateOverlay").classList.remove("hidden");
}

function updateLockIndicators() {
  const appLocked = Boolean(publicConfig?.appLocked);
  const matchLocked = !Boolean(publicConfig?.matchVoteOpen);
  const followLocked = Boolean(publicConfig?.followLocked);

  if ($("appLockState")) {
    $("appLockState").textContent = appLocked ? "잠금 중" : "사용 가능";
    $("appLockState").className = `lock-state ${appLocked ? "locked" : "unlocked"}`;
  }

  if ($("matchLockState")) {
    $("matchLockState").textContent = matchLocked ? "기간 아님" : "진행중";
    $("matchLockState").className = `lock-state ${matchLocked ? "locked" : "unlocked"}`;
  }

  if ($("followLockState")) {
    $("followLockState").textContent = followLocked ? "잠금 중" : "사용 가능";
    $("followLockState").className = `lock-state ${followLocked ? "locked" : "unlocked"}`;
  }
}

function applyFollowLock() {
  const locked = Boolean(publicConfig?.followLocked) && !followGranted && !adminLoggedIn;
  $("followLockCard")?.classList.toggle("hidden", !locked);
  $("followContent")?.classList.toggle("hidden", locked);
}

async function unlockFollow() {
  const password = $("followPassword").value.trim();
  if (!password) {
    $("followUnlockMsg").textContent = "비밀번호를 입력해 주세요.";
    return;
  }

  try {
    await apiPost("verifyFollowPassword", { password });
    followGranted = true;
    $("followUnlockMsg").textContent = "";
    $("followPassword").value = "";
    applyFollowLock();
    toast("팔로우리스트 잠금이 해제되었습니다.");
  } catch (_) {
    $("followUnlockMsg").textContent = "팔로우리스트 비밀번호가 올바르지 않습니다.";
  }
}

function isMatchPeriodOpen() {
  const status = window.__matchVoteStatus || {};
  return adminLoggedIn
    ? Boolean(publicConfig?.matchVoteOpen)
    : Boolean(status.open ?? publicConfig?.matchVoteOpen);
}

function applyMatchLock() {
  // V70: 맞팔 투표와 ZIP 맞팔분석은 동일한 맞팔확인 기간에 함께 열리고 닫힙니다.
  $("matchContent")?.classList.remove("hidden");
  updateMatchVoteUi();
  updateMatchAnalysisUi();
}

function updateMatchAnalysisUi() {
  const open = isMatchPeriodOpen();
  const signedIn = Boolean(memberSession?.token) || adminLoggedIn;
  const enabled = open && signedIn;

  const badge = $("matchAnalysisBadge");
  if (badge) {
    badge.textContent = open ? "진행중" : "기간 아님";
    badge.className = `lock-state ${open ? "unlocked" : "locked"}`;
  }

  const message = $("matchAnalysisMessage");
  if (message) {
    if (!signedIn) message.textContent = "회원 로그인 후 맞팔분석을 이용할 수 있습니다.";
    else if (!open) message.textContent = "지금은 맞팔분석 기간이 아닙니다. (관리자가 기간을 지정하면 열립니다)";
    else message.textContent = "단톡방 명단을 불러온 뒤 인스타그램 ZIP 파일을 선택해 주세요.";
  }

  const reload = $("reloadRoomBtn");
  const zip = $("zipFile");
  const analyzeButton = $("analyzeBtn");
  if (reload) reload.disabled = !enabled;
  if (zip) zip.disabled = !enabled;
  if (analyzeButton) analyzeButton.disabled = !enabled;
  document.querySelector('label[for="zipFile"]')?.classList.toggle("disabled", !enabled);

  if (!open) {
    if ($("roomState")) $("roomState").textContent = "기간 아님";
    if ($("status")) $("status").textContent = "맞팔확인 기간이 시작되면 분석 기능이 자동으로 열립니다.";
  } else if (!signedIn) {
    if ($("roomState")) $("roomState").textContent = "로그인 필요";
    if ($("status")) $("status").textContent = "회원 로그인 후 맞팔분석을 이용해 주세요.";
  } else if (!matchRoomList.length) {
    if ($("roomState")) $("roomState").textContent = "대기";
    if ($("status")) $("status").textContent = "단톡방 명단을 불러온 뒤 ZIP 파일을 선택해 주세요.";
  }
}

async function loadMatchVoteStatus() {
  if (!memberSession?.token || adminLoggedIn) { updateMatchVoteUi(); return; }
  try {
    const data = await apiPost("getMatchVoteStatus", {token:memberSession.token}, 12000);
    window.__matchVoteStatus = data;
  } catch (e) { window.__matchVoteStatus = {open:Boolean(publicConfig?.matchVoteOpen), error:e.message}; }
  updateMatchVoteUi();
}

function updateMatchVoteUi() {
  const card=$("matchVoteCard"); if(!card) return;
  const st=window.__matchVoteStatus||{};
  const open=adminLoggedIn ? Boolean(publicConfig?.matchVoteOpen) : Boolean(st.open ?? publicConfig?.matchVoteOpen);
  $("matchVoteTitle").textContent=(st.title||publicConfig?.matchVoteTitle||"맞팔확인 기간")+" · 본인의 팔로우 진행 상태를 선택해주세요.";
  $("matchVoteBadge").textContent=open?"진행중":"기간 아님";
  $("matchVoteBadge").className=`lock-state ${open?"unlocked":"locked"}`;
  [$("matchVoteDoneBtn"),$("matchVoteDelayBtn")].forEach(b=>{if(b)b.disabled=!open||!memberSession?.token});
  const msg=$("matchVoteMessage");
  if(!memberSession?.token) msg.textContent="회원 로그인 후 투표할 수 있습니다.";
  else if(st.submission?.status) msg.textContent=`제출 완료 · ${st.submission.status}`;
  else msg.textContent=open?"완료 또는 지연을 선택해주세요.":"지금은 맞팔확인 기간이 아닙니다. (관리자가 기간을 지정하면 열립니다)";
  updateMatchAnalysisUi();
}

async function submitMatchVote(status){
  if(!memberSession?.token) return toast("회원 로그인이 필요합니다.");
  try{const data=await apiPost("submitMatchVote",{token:memberSession.token,status},12000);toast(data.message||"저장되었습니다.");await loadMatchVoteStatus();}
  catch(e){toast(e.message||"제출에 실패했습니다.");}
}

function sheetUrl() {
  return `https://docs.google.com/spreadsheets/d/${config.sheetId}/edit`;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && quoted && next === '"') {
      cell += '"';
      i++;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (cell || row.length) {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      }
      if (char === "\r" && next === "\n") i++;
    } else {
      cell += char;
    }
  }

  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function rowsToAuditSource(rows) {
  const list = [];
  rows.forEach((row, index) => {
    const joined = row.join(" ");
    if (index === 0 && (joined.includes("번호") || joined.includes("닉네임") || joined.includes("아이디"))) return;
    if (!row.some((cell) => String(cell || "").trim())) return;

    list.push({
      no: String(row[0] || "").trim(),
      name: String(row[1] || "").trim(),
      idRaw: String(row[2] || "").trim(),
      id: normalize(row[2] || ""),
    });
  });
  return list;
}

function rowsToRoom(rows) {
  const list = [];
  rows.forEach((row, index) => {
    const joined = row.join(" ");
    if (index === 0 && (joined.includes("번호") || joined.includes("닉네임") || joined.includes("아이디"))) return;

    const id = normalize(row[2] || row[1] || row[0]);
    if (validUsername(id)) {
      list.push({
        no: row[0] || list.length + 1,
        name: row[1] || "",
        id,
      });
    }
  });

  const seen = new Set();
  return list.filter((item) => !seen.has(item.id) && seen.add(item.id));
}

async function loadRoomList(show = false) {
  setSheetState("불러오는 중");
  let lastError = "";

  try {
    const data = await apiGet("followList");
    roomAuditSource = (data.members || []).map((item) => ({
      no: String(item.no || "").trim(),
      name: String(item.name || "").trim(),
      idRaw: String(item.id || "").trim(),
      id: normalize(item.id),
    }));
    roomList = (data.members || []).map((item, index) => ({
      no: item.no || index + 1,
      name: item.name || "",
      id: normalize(item.id),
    })).filter((item) => validUsername(item.id));

    if (!roomList.length) throw new Error("API 명단 0명");

    setSheetState("정상");
    updateFollowStats();
    renderGroupTabs();
    renderCopyBatches();
    renderFollowList();
    renderResumeCard();
    saveFollowListCache(roomList);
    if (adminLoggedIn) renderRosterAudit();
    if (show) toast("명단 새로고침 완료");
    return;
  } catch (error) {
    lastError = error.message;
  }

  const urls = [];
  if (config.sheetId) {
    const sheet = encodeURIComponent(config.sheetName || "Sheet1");
    urls.push(`https://docs.google.com/spreadsheets/d/${config.sheetId}/gviz/tq?tqx=out:csv&sheet=${sheet}&t=${Date.now()}`);
    urls.push(`https://docs.google.com/spreadsheets/d/${config.sheetId}/export?format=csv&sheet=${sheet}&t=${Date.now()}`);
  }
  urls.push(`${config.fallbackCsv || "room-list.csv"}?t=${Date.now()}`);

  for (const url of urls) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const parsedRows = parseCsv(await response.text());
      const list = rowsToRoom(parsedRows);
      if (!list.length) throw new Error("0명");
      roomAuditSource = rowsToAuditSource(parsedRows);
      roomList = list;
      setSheetState("백업");
      updateFollowStats();
      renderGroupTabs();
      renderCopyBatches();
      renderFollowList();
      renderResumeCard();
      saveFollowListCache(roomList);
      if (adminLoggedIn) renderRosterAudit();
      if (show) toast("백업 명단으로 불러왔습니다.");
      return;
    } catch (error) {
      lastError = error.message;
    }
  }

  setSheetState("오류");
  $("followState").textContent = `명단을 불러오지 못했습니다. (${lastError})`;
  if (show) toast("명단 불러오기 실패");
}


async function loadMatchRoomList(show = false, force = false) {
  if (!isMatchPeriodOpen()) {
    updateMatchAnalysisUi();
    throw new Error("지금은 맞팔분석 기간이 아닙니다.");
  }
  if (!memberSession?.token && !adminLoggedIn) {
    updateMatchAnalysisUi();
    throw new Error("회원 로그인이 필요합니다.");
  }
  if (!force && matchRoomList.length) {
    if ($("roomState")) {
      $("roomState").textContent = `${matchRoomList.length}명 준비 완료`;
    }
    return matchRoomList;
  }

  if ($("roomState")) {
    $("roomState").textContent = "불러오는 중";
  }

  try {
    const data = await apiGet("matchList");

    matchRoomList = (data.members || [])
      .map((item, index) => ({
        no: item.no || index + 1,
        name: item.name || "",
        id: normalize(item.id),
      }))
      .filter((item) => validUsername(item.id));

    if (!matchRoomList.length) {
      throw new Error("맞팔확인용 명단이 비어 있습니다.");
    }

    if ($("roomState")) {
      $("roomState").textContent = `${matchRoomList.length}명 준비 완료`;
    }

    if (show) {
      toast(`맞팔확인용 명단 ${matchRoomList.length}명 새로고침 완료`);
    }

    return matchRoomList;
  } catch (error) {
    matchRoomList = [];

    if ($("roomState")) {
      $("roomState").textContent = "불러오기 오류";
    }

    if ($("status")) {
      $("status").textContent = `맞팔확인용 명단을 불러오지 못했습니다. (${error.message})`;
    }

    if (show) {
      toast("맞팔확인용 명단 불러오기 실패");
    }

    throw error;
  }
}

function setSheetState(state) {
  if ($("adminApiState")) {
    $("adminApiState").textContent = state;
  }
}

function updateFollowStats() {
  const groups = Math.ceil(roomList.length / 500);
  $("followTotal").textContent = `${roomList.length}명`;
  $("groupTotal").textContent = `${groups}조`;
  $("lastRefresh").textContent = new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
  $("adminTotal").textContent = `${roomList.length}명`;
  $("adminGroups").textContent = `${groups}조`;
  $("followState").textContent = `전체 ${roomList.length}명 · 500명씩 ${groups}개 조`;
}


const FOLLOW_COPY_BATCH_SIZE = 40;

function currentFollowGroupItems() {
  if (currentGroup > 0) {
    return roomList.slice((currentGroup - 1) * 500, currentGroup * 500);
  }
  return roomList;
}

function renderCopyBatches() {
  const card = $("copyBatchCard");
  const container = $("copyBatchButtons");
  if (!card || !container) return;

  const items = currentFollowGroupItems();
  const totalBatches = Math.ceil(items.length / FOLLOW_COPY_BATCH_SIZE);

  $("copyBatchGroup").textContent = currentGroup > 0 ? `${currentGroup}조` : "전체";

  if (!items.length || !totalBatches) {
    card.classList.add("hidden");
    container.innerHTML = "";
    return;
  }

  if (currentCopyBatch >= totalBatches) currentCopyBatch = 0;

  container.innerHTML = Array.from({ length: totalBatches }, (_, batchIndex) => {
    const startIndex = batchIndex * FOLLOW_COPY_BATCH_SIZE;
    const endIndex = Math.min(startIndex + FOLLOW_COPY_BATCH_SIZE, items.length);
    const first = items[startIndex];
    const last = items[endIndex - 1];

    const startLabel = first?.no || startIndex + 1;
    const endLabel = last?.no || endIndex;
    const isNext = batchIndex === currentCopyBatch;

    return `
      <button
        class="copy-batch-btn ${isNext ? "next" : ""}"
        type="button"
        data-copy-batch="${batchIndex}"
        aria-label="${escapeHtml(startLabel)}번부터 ${escapeHtml(endLabel)}번까지 복사"
      >
        <span>${escapeHtml(startLabel)}~${escapeHtml(endLabel)}</span>
        <small>${endIndex - startIndex}명</small>
      </button>
    `;
  }).join("");

  $("copyBatchGuide").textContent =
    currentGroup > 0
      ? `${currentGroup}조 명단을 40명 단위로 복사합니다.`
      : "전체 명단을 40명 단위로 복사합니다.";

  card.classList.remove("hidden");

  requestAnimationFrame(() => {
    container.querySelector(".copy-batch-btn.next")?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  });
}

async function copyFollowBatch(batchIndex) {
  const items = currentFollowGroupItems();
  const start = batchIndex * FOLLOW_COPY_BATCH_SIZE;
  const batch = items.slice(start, start + FOLLOW_COPY_BATCH_SIZE);

  if (!batch.length) {
    toast("복사할 명단이 없습니다.");
    return;
  }

  try {
    await writeClipboardText(
      batch
        .map((item, index) => {
          const no = String(item.no || start + index + 1).trim();
          const name = String(item.name || "").trim();
          const id = String(item.id || "").trim();
          return `${no}. ${name} @${id}`;
        })
        .join("\n")
    );

    const totalBatches = Math.ceil(items.length / FOLLOW_COPY_BATCH_SIZE);
    currentCopyBatch = batchIndex + 1 < totalBatches ? batchIndex + 1 : 0;

    const firstNo = batch[0]?.no || start + 1;
    const lastNo = batch[batch.length - 1]?.no || start + batch.length;

    renderCopyBatches();
    toast(`${firstNo}~${lastNo} · ${batch.length}명 복사 완료`);
  } catch (error) {
    toast(error.message || "40명 복사 실패");
  }
}

function renderGroupTabs() {
  const total = Math.max(1, Math.ceil(roomList.length / 500));
  $("groupTabs").innerHTML = ["전체", ...Array.from({ length: total }, (_, i) => `${i + 1}조`)]
    .map((text, index) => `<button class="group-tab ${index === currentGroup ? "active" : ""}" data-group="${index}">${text}</button>`)
    .join("");

  document.querySelectorAll(".group-tab").forEach((button) => {
    button.onclick = () => {
      currentGroup = Number(button.dataset.group);
      currentCopyBatch = 0;
      renderGroupTabs();
      renderCopyBatches();
      renderFollowList();
    };
  });
}

function followFiltered() {
  const query = String($("followSearch").value || "").trim().toLowerCase();
  let items = roomList;
  if (currentGroup > 0) items = items.slice((currentGroup - 1) * 500, currentGroup * 500);

  return query
    ? items.filter((item) =>
        String(item.no).includes(query) ||
        item.id.includes(normalize(query)) ||
        String(item.name).toLowerCase().includes(query))
    : items;
}

function renderFollowList() {
  const items = followFiltered();
  $("followList").innerHTML = items.length
    ? items.map((item) => `
      <div class="follow-item" data-follow-id="${escapeHtml(item.id)}">
        <span class="follow-no">${escapeHtml(item.no)}</span>
        <span class="follow-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
        <a class="follow-id" href="https://www.instagram.com/${encodeURIComponent(item.id)}/" target="_blank" rel="noopener" title="@${escapeHtml(item.id)}">@${escapeHtml(item.id)}</a>
        <a class="insta-btn" href="https://www.instagram.com/${encodeURIComponent(item.id)}/" target="_blank" rel="noopener" data-save-follow="${escapeHtml(item.id)}" aria-label="인스타그램 열기">↗ 열기</a>
      </div>`).join("")
    : '<div class="empty-state">검색 결과가 없습니다.</div>';
}


let inviteAdminLoggedIn=false,inviteAdminPasswordValue="",inviteAdminItemsCache=[],inviteAdminFilter="ALL",inviteMeVerified=false,inviteVerifiedInstagram="",inviteVerifiedName="";
function setInviteMode(mode){const m=$("inviteMemberMode"),a=$("inviteAdminMode"),mt=$("inviteMemberTab"),at=$("inviteAdminTab");if(mode==="admin"){mt.classList.remove("active");at.classList.add("active");m.classList.add("hidden");a.classList.remove("hidden")}else{at.classList.remove("active");mt.classList.add("active");a.classList.add("hidden");m.classList.remove("hidden")}}
async function checkInviteMe(){const name=$("inviteeName").value.trim(),instagram=$("inviteeInstagram").value.trim(),msg=$("inviteRegisterMsg");if(!name||!instagram){msg.textContent="내 닉네임과 인스타 아이디를 입력해주세요.";return}msg.textContent="내 정보 확인 중...";try{const d=await apiPost("inviteMemberLookup",{name,instagram});inviteMeVerified=!!d.member;if(!inviteMeVerified)throw new Error("회원명단에서 닉네임과 인스타 아이디가 일치하지 않습니다.");inviteVerifiedName=name;inviteVerifiedInstagram=instagram;if($("inviteStartFollowBtn"))$("inviteStartFollowBtn").disabled=false;msg.textContent="회원정보 확인 완료";renderInviteMyStatus(d.items||[])}catch(e){inviteMeVerified=false;inviteVerifiedName="";inviteVerifiedInstagram="";if($("inviteStartFollowBtn"))$("inviteStartFollowBtn").disabled=true;msg.textContent=e.message||"회원정보를 확인하지 못했습니다.";renderInviteMyStatus([])}}
async function startFollowFromOne(){if(!inviteMeVerified||!inviteVerifiedInstagram){toast("먼저 내 정보를 확인해주세요.");return}const b=$("inviteStartFollowBtn");if(b)b.disabled=true;try{await apiPost("markFollowStarted",{name:inviteVerifiedName,instagram:inviteVerifiedInstagram});toast("팔로우리스트 1번 시작이 기록됐어요.");showView("followView");setTimeout(()=>window.scrollTo({top:0,behavior:"smooth"}),100)}catch(e){toast(e.message||"시작 기록에 실패했습니다.")}finally{if(b)b.disabled=false}}
function renderInviteMyStatus(items){const a=items||[];$("inviteMyRequestCount").textContent=a.length;$("inviteMyApprovedCount").textContent=a.filter(x=>x.status==="APPROVED").length;$("inviteMyPendingCount").textContent=a.filter(x=>x.status==="PENDING").length;$("inviteMyList").innerHTML=a.length?a.map(x=>`<div class="invite-my-row"><span>${escapeHtml(x.inviterName||"")}</span><span>${escapeHtml(x.inviterInstagram||"")}</span><span>${escapeHtml((x.createdAt||"").slice(0,10))}</span><span>${x.status==="APPROVED"?"승인":x.status==="REJECTED"?"거절":"대기"}</span></div>`).join(""):'<p class="state-text">등록 기록이 없습니다.</p>'}
async function registerInviteIntegrated(){const msg=$("inviteRegisterMsg"),p={inviteeName:$("inviteeName").value.trim(),inviteeInstagram:$("inviteeInstagram").value.trim(),inviterName:$("inviterName").value.trim(),inviterInstagram:$("inviterInstagram").value.trim()};if(!p.inviteeName||!p.inviteeInstagram||!p.inviterName||!p.inviterInstagram){msg.textContent="모든 정보를 입력해주세요.";return}if(!inviteMeVerified){await checkInviteMe();if(!inviteMeVerified)return}msg.textContent="초대 등록 요청 중...";try{const d=await apiPost("registerInvite",p);msg.textContent=d.message||"초대 등록 요청이 완료되었습니다.";$("inviterName").value="";$("inviterInstagram").value="";await checkInviteMe()}catch(e){msg.textContent=e.message||"등록하지 못했습니다."}}
function openInviteAdminLogin(){$("inviteAdminLoginBox").classList.remove("hidden");$("inviteAdminPassword").value="";$("inviteAdminLoginMsg").textContent=""}
function closeInviteAdminLogin(){$("inviteAdminLoginBox").classList.add("hidden")}
async function loginInviteAdmin(){const password=$("inviteAdminPassword").value;if(!password){$("inviteAdminLoginMsg").textContent="비밀번호를 입력해주세요.";return}try{await apiPost("inviteAdminLogin",{password});inviteAdminLoggedIn=true;inviteAdminPasswordValue=password;closeInviteAdminLogin();setInviteMode("admin");await Promise.allSettled([loadInviteAdmin(),loadInviteSummary()])}catch(e){$("inviteAdminLoginMsg").textContent=e.message||"비밀번호가 올바르지 않습니다."}}
function logoutInviteAdmin(){inviteAdminLoggedIn=false;inviteAdminPasswordValue="";setInviteMode("member")}
function inviteStatusText(s){return s==="APPROVED"?"승인 완료":s==="REJECTED"?"거절":s==="CANCELLED"?"승인 취소":"승인 대기"}
function renderInviteAdminList(){const q=($("inviteAdminSearch")?.value||"").trim().toLowerCase();let a=inviteAdminItemsCache.slice();if(inviteAdminFilter!=="ALL")a=a.filter(x=>x.status===inviteAdminFilter);if(q)a=a.filter(x=>[x.inviteeName,x.inviteeInstagram,x.inviterName,x.inviterInstagram].join(" ").toLowerCase().includes(q));$("inviteAdminList").innerHTML=a.length?a.map(x=>`<div class="invite-admin-item ${x.expelTarget?"expel":""}"><strong>${escapeHtml(x.inviteeName)} · ${escapeHtml(x.inviteeInstagram)}</strong><div class="route">초대한 사람 → <b>${escapeHtml(x.inviterName)}</b> · ${escapeHtml(x.inviterInstagram)}</div><div class="meta">${escapeHtml(x.createdAt||"")} · ${inviteStatusText(x.status)}</div>${x.status==="APPROVED"?`<div class="joinMeta"><span class="invite-pill">입장 D+${Number(x.daysSinceJoin||0)}</span><span class="invite-pill ${x.followStarted?"good":x.expelTarget?"warn":""}">${x.followStarted?`1번 시작 완료 · ${escapeHtml(x.followStartedAt||"")}`:"1번 시작 전"}</span>${x.canCancel?`<span class="invite-pill">승인 취소 가능 · ${escapeHtml(x.cancelDeadline||"")}까지</span>`:'<span class="invite-pill warn">7일 경과 · 승인 취소 불가</span>'}</div>`:""}${x.status==="CANCELLED"?`<div class="joinMeta"><span class="invite-pill warn">취소일 · ${escapeHtml(x.cancelledAt||"")}</span>${x.cancelReason?`<span class="invite-pill">${escapeHtml(x.cancelReason)}</span>`:""}</div>`:""}${x.status==="PENDING"?`<div class="invite-admin-actions"><button class="outline success-outline" data-invite-approve="${escapeHtml(x.id)}">승인</button><button class="outline danger-outline" data-invite-reject="${escapeHtml(x.id)}">거절</button></div>`:""}${x.status==="APPROVED"&&x.canCancel?`<div class="invite-admin-actions"><button class="outline danger-outline" data-invite-cancel="${escapeHtml(x.id)}" data-invite-name="${escapeHtml(x.inviteeName)}">승인 취소</button></div>`:""}</div>`).join(""):'<p class="state-text">표시할 기록이 없습니다.</p>'}
async function loadInviteAdmin(){if(!inviteAdminLoggedIn)return;const d=await apiPost("getInviteAdmin",{inviteAdminPassword:inviteAdminPasswordValue});inviteAdminItemsCache=d.items||[];$("invitePendingCount").textContent=inviteAdminItemsCache.filter(x=>x.status==="PENDING").length;$("inviteApprovedCount").textContent=inviteAdminItemsCache.filter(x=>x.status==="APPROVED").length;$("inviteRejectedCount").textContent=inviteAdminItemsCache.filter(x=>x.status==="REJECTED").length;if($("inviteCancelledCount"))$("inviteCancelledCount").textContent=inviteAdminItemsCache.filter(x=>x.status==="CANCELLED").length;if($("inviteExpelCount"))$("inviteExpelCount").textContent=inviteAdminItemsCache.filter(x=>x.expelTarget).length;renderInviteAdminList()}
async function loadInviteSummary(){if(!inviteAdminLoggedIn)return;const d=await apiPost("getInviteSummary",{inviteAdminPassword:inviteAdminPasswordValue}),a=d.items||[];$("inviteSummaryList").innerHTML=a.length?a.map(x=>`<div class="invite-summary-row"><span class="numNick"><span class="badgeNo">${escapeHtml(String(x.no||""))}</span>${escapeHtml(x.nickname||"")}</span><span>${x.invite||0}</span><span>${x.previous||0}</span><span class="total">${x.total||0}</span></div>`).join(""):'<p class="state-text">회원 데이터가 없습니다.</p>'}
async function changeInviteStatus(id,status,reason=""){try{await apiPost("updateInviteStatus",{inviteAdminPassword:inviteAdminPasswordValue,id,status,reason});toast(status==="APPROVED"?"초대 승인 및 자동 반영 완료":status==="CANCELLED"?"승인 취소 완료 · 팔로우리스트와 초대 실적을 되돌렸어요.":"초대 거절 완료");await Promise.allSettled([loadInviteAdmin(),loadInviteSummary(),loadRoomList(true)])}catch(e){toast(e.message||"처리하지 못했습니다.")}}
async function cancelInviteApproval(id,name){if(!confirm(`${name||"해당 회원"}의 승인을 취소할까요?\n\n팔로우리스트에서 삭제되고, 초대 실적과 누적도 1명 차감됩니다.`))return;const reason=prompt("승인 취소 사유를 입력해주세요.","7일 이내 퇴장");if(reason===null)return;await changeInviteStatus(id,"CANCELLED",reason.trim()||"7일 이내 퇴장")}




const FOX_PUBLIC_URL = "https://script.google.com/macros/s/AKfycbxnp91TwjUuE8kM_0TldXa32Tr2tc9WurG1WgpVcrmmExkcSAtSpmrzuBVWuJ9Qgk2_mQ/exec";
const FOX_ADMIN_URL = "https://script.google.com/macros/s/AKfycbxnp91TwjUuE8kM_0TldXa32Tr2tc9WurG1WgpVcrmmExkcSAtSpmrzuBVWuJ9Qgk2_mQ/exec?admin=1";

function isOperatorMode_() {
  // 운영진 로그인 상태를 한 가지 변수에만 의존하지 않도록 보강합니다.
  // 일부 로그인 경로에서는 하단 운영진 메뉴가 먼저 활성화될 수 있습니다.
  const adminNavVisible = !!$("adminNavBtn") && !$("adminNavBtn").classList.contains("hidden");
  let savedRole = "";
  try { savedRole = sessionStorage.getItem("yeowoobangRole") || ""; } catch (_) {}
  return Boolean(adminLoggedIn || adminPasswordValue || adminNavVisible || savedRole === "admin");
}

function updateFoxMode() {
  const title = $("foxModeTitle");
  const desc = $("foxModeDesc");
  const badge = $("foxModeBadge");
  const link = $("foxModeLink");
  const notice = $("foxAdminNotice");
  if (!title || !desc || !badge || !link) return;

  if (isOperatorMode_()) {
    title.textContent = "🚗 여우방 폭스바겐 운영진";
    desc.textContent = "폭스바겐 협찬 등록 · 수정 · 삭제 · 참여 현황을 관리합니다.";
    badge.textContent = "운영진용";
    badge.classList.add("admin");
    link.href = FOX_ADMIN_URL;
    link.textContent = "폭스바겐 운영진 입장하기";
    if (notice) notice.classList.remove("hidden");
  } else {
    title.textContent = "🚗 여우방 폭스바겐";
    desc.textContent = "기존 폭스바겐 선착순 프로그램을 이용합니다.";
    badge.textContent = "회원용";
    badge.classList.remove("admin");
    link.href = FOX_PUBLIC_URL;
    link.textContent = "폭스바겐 입장하기";
    if (notice) notice.classList.add("hidden");
  }
}

function showView(id) {
  if (id === "foxView") updateFoxMode();
  document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === id));
  document.querySelectorAll(".nav-btn").forEach((button) => button.classList.toggle("active", button.dataset.view === id));

  if (id === "followView") {
    applyFollowLock();
  }

  if (id === "matchView") {
    applyMatchLock();
    const canAnalyze = isMatchPeriodOpen() && (Boolean(memberSession?.token) || adminLoggedIn);
    if (canAnalyze && !matchRoomList.length) {
      loadMatchRoomList(false).catch(() => {});
    }
  }

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function findFiles(zip) {
  const files = Object.keys(zip.files).filter((path) => !zip.files[path].dir);
  return {
    followers: files.filter((path) => /followers_\d+\.(html|json)$/i.test(path.replace(/\\/g, "/").split("/").pop())),
    following: files.find((path) => /^following\.(html|json)$/i.test(path.replace(/\\/g, "/").split("/").pop())),
  };
}

function extractHtml(text) {
  const ids = [];
  let match;
  let regex = /href=["']https?:\/\/(?:www\.)?instagram\.com\/(?:_u\/)?([A-Za-z0-9._]+)\/?[^"']*["']/gi;
  while ((match = regex.exec(text))) ids.push(match[1]);

  if (!ids.length) {
    regex = /https?:\/\/(?:www\.)?instagram\.com\/(?:_u\/)?([A-Za-z0-9._]+)/gi;
    while ((match = regex.exec(text))) ids.push(match[1]);
  }
  return unique(ids);
}

function walkJson(value, output) {
  if (value == null) return;
  if (typeof value === "string") {
    const id = normalize(value);
    if (validUsername(id)) output.push(id);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => walkJson(item, output));
    return;
  }
  if (typeof value === "object") Object.values(value).forEach((item) => walkJson(item, output));
}

function extractJson(text) {
  const output = [];
  try { walkJson(JSON.parse(text), output); } catch (_) {}
  return unique(output);
}

async function parseInstagramZip(file) {
  if (!file) throw new Error("ZIP 파일을 선택해 주세요.");

  const JSZipLibrary = await loadJsZipLibrary();
  const zip = await JSZipLibrary.loadAsync(file);
  const paths = findFiles(zip);

  if (!paths.followers.length) throw new Error("followers_1 파일을 찾지 못했습니다.");
  if (!paths.following) throw new Error("following 파일을 찾지 못했습니다.");

  let followers = [];
  for (const path of paths.followers) {
    const text = await zip.files[path].async("string");
    followers.push(...(path.endsWith(".json") ? extractJson(text) : extractHtml(text)));
  }

  const followingText = await zip.files[paths.following].async("string");
  const following = paths.following.endsWith(".json") ? extractJson(followingText) : extractHtml(followingText);

  return { followers: unique(followers), following };
}

function classify(followers, following, baseList = matchRoomList) {
  const followerSet = new Set(followers);
  const followingSet = new Set(following);

  const all = baseList.map((person) => ({
    ...person,
    status:
      followerSet.has(person.id) && followingSet.has(person.id) ? "mutual" :
      !followerSet.has(person.id) && followingSet.has(person.id) ? "onlyMe" :
      followerSet.has(person.id) && !followingSet.has(person.id) ? "fansOnly" :
      "neither",
  }));

  result = {
    all,
    mutual: all.filter((item) => item.status === "mutual"),
    onlyMe: all.filter((item) => item.status === "onlyMe"),
    fansOnly: all.filter((item) => item.status === "fansOnly"),
    neither: all.filter((item) => item.status === "neither"),
  };
}

async function analyze() {
  if (!isMatchPeriodOpen()) {
    updateMatchAnalysisUi();
    toast("지금은 맞팔분석 기간이 아닙니다.");
    return;
  }
  if (!memberSession?.token && !adminLoggedIn) {
    updateMatchAnalysisUi();
    toast("회원 로그인이 필요합니다.");
    return;
  }

  const button = $("analyzeBtn");
  try {
    button.disabled = true;
    button.textContent = window.JSZip ? "분석 중..." : "분석 준비 중...";
    if (!matchRoomList.length) await loadMatchRoomList(false);
    button.textContent = "분석 중...";
    const parsed = await parseInstagramZip($("zipFile").files[0]);
    classify(parsed.followers, parsed.following, matchRoomList);
    updateSummary();
    showTab("all");
    $("summarySection").classList.remove("hidden");
    $("resultsSection").classList.remove("hidden");
    $("status").textContent = `분석 완료 · 맞팔확인용 명단 ${matchRoomList.length}명 기준`;
    if(memberSession?.token){
      apiPost("saveMatchAnalysis",{token:memberSession.token,counts:{total:result.all.length,mutual:result.mutual.length,onlyMe:result.onlyMe.length,fansOnly:result.fansOnly.length,neither:result.neither.length}},12000).catch(()=>{});
    }
    toast("분석 완료");
  } catch (error) {
    $("status").textContent = `오류: ${error.message}`;
    toast("분석 실패");
  } finally {
    button.innerHTML = '맞팔 분석 시작 <span>→</span>';
    updateMatchAnalysisUi();
  }
}

function percent(value, total) {
  return total ? `${((value / total) * 100).toFixed(1)}%` : "0%";
}

function updateSummary() {
  const total = result.all.length;
  for (const key of ["mutual", "onlyMe", "fansOnly", "neither"]) {
    $(`${key}Count`).textContent = `${result[key].length}명`;
    $(`${key}Rate`).textContent = percent(result[key].length, total);
    $(`tab${key[0].toUpperCase() + key.slice(1)}`).textContent = result[key].length;
  }
  $("tabAll").textContent = total;
  $("rateText").innerHTML = `단톡방 맞팔률 <strong>${percent(result.mutual.length, total)}</strong> · ${result.mutual.length}/${total}명`;
}

function statusLabel(status) {
  return {
    mutual: "맞팔 완료",
    onlyMe: "나만 팔로우 함",
    fansOnly: "상대가 팔로우만 함",
    neither: "서로 팔로우 안 함",
  }[status];
}

function showTab(tab) {
  currentTab = tab;
  document.querySelectorAll(".tab").forEach((button) => button.classList.toggle("active", button.dataset.tab === tab));
  renderMatchList();
}

function matchFiltered() {
  const query = String($("searchInput").value || "").trim().toLowerCase();
  const items = result[currentTab] || [];
  return query
    ? items.filter((item) => item.id.includes(normalize(query)) || String(item.name).toLowerCase().includes(query))
    : items;
}

function renderMatchList() {
  const items = matchFiltered();
  $("list").innerHTML = items.length
    ? items.map((item, index) => `
      <div class="item">
        <span class="item-no">${index + 1}</span>
        <div class="item-person">
          <strong class="item-name">${escapeHtml(item.name)}</strong>
          <a class="id" href="https://www.instagram.com/${encodeURIComponent(item.id)}/" target="_blank" rel="noopener">@${escapeHtml(item.id)}</a>
        </div>
        <span class="badge ${item.status}">${statusLabel(item.status)}</span>
        <a class="insta" href="https://www.instagram.com/${encodeURIComponent(item.id)}/" target="_blank" rel="noopener" aria-label="인스타그램 열기">↗ 열기</a>
      </div>`).join("")
    : '<div class="empty-state">결과가 없습니다.</div>';
}

async function writeClipboardText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();

  const copied = document.execCommand("copy");
  textarea.remove();

  if (!copied) {
    throw new Error("클립보드 복사에 실패했습니다.");
  }
}

function copyTargetItems() {
  return currentTab === "all"
    ? [...result.onlyMe, ...result.neither]
    : matchFiltered();
}

async function copyCurrent() {
  const items = copyTargetItems();
  if (!items.length) return toast("복사할 명단이 없습니다.");

  try {
    const text = items
      .map((item, index) => `${index + 1}. ${item.name} @${item.id} - ${statusLabel(item.status)}`)
      .join("\n");

    await writeClipboardText(text);
    toast(`${items.length}명 명단 복사 완료`);
  } catch (error) {
    toast(error.message || "복사 실패");
  }
}

async function copyMentions() {
  const items = copyTargetItems();
  if (!items.length) return toast("복사할 멘션이 없습니다.");

  try {
    const text = items
      .map((item) => `@${item.id}`)
      .join("\n");

    await writeClipboardText(text);
    toast(`${items.length}명 멘션 복사 완료`);
  } catch (error) {
    toast(error.message || "멘션 복사 실패");
  }
}

function resetAnalysis() {
  $("zipFile").value = "";
  $("fileName").textContent = "인스타그램 ZIP 파일 선택";
  $("summarySection").classList.add("hidden");
  $("resultsSection").classList.add("hidden");
}

async function loadNotices(notify = true) {
  try {
    const data = await apiGet("notices");
    const notices = data.notices || [];
    const nextSignature = JSON.stringify(notices.map(item => [item.noticeId, item.createdAt, item.content]));
    if (notify && noticeSignature && nextSignature !== noticeSignature && notices.length) {
      $("noticeCard").classList.remove("hidden");
      toast("새 공지가 등록되었습니다.");
    }
    noticeSignature = nextSignature;
    renderNotices(notices);
  } catch (_) {
    renderNotices([]);
  }
}

function renderNotices(notices) {
  $("adminNotices").textContent = `${notices.length}개`;
  $("noticeCard").classList.toggle("hidden", !notices.length);

  $("noticeList").innerHTML = notices
    .map((notice) => `<div class="notice-item"><p>${escapeHtml(notice.content)}</p></div>`)
    .join("");

  $("noticePageList").innerHTML = notices.length
    ? notices.map((notice) => `
      <article class="notice-page-item">
        <div class="notice-page-time">${escapeHtml(notice.createdAt || "")}</div>
        <p>${escapeHtml(notice.content)}</p>
      </article>`).join("")
    : '<p class="state-text">등록된 공지가 없습니다.</p>';

  $("adminNoticeList").innerHTML = notices.length
    ? notices.map((notice) => `
      <div class="notice-row">
        <div>
          <strong>${escapeHtml(notice.createdAt)}</strong>
          <div class="subtext">${escapeHtml(notice.content)}</div>
        </div>
        <button data-notice-id="${escapeHtml(notice.noticeId)}" type="button">삭제</button>
      </div>`).join("")
    : '<p class="state-text">등록된 공지가 없습니다.</p>';

  document.querySelectorAll("[data-notice-id]").forEach((button) => {
    button.onclick = () => deleteNotice(button.dataset.noticeId);
  });
}

async function loadAdminLogs() {
  if (!adminLoggedIn || !adminPasswordValue) return;
  try {
    const data = await apiPost("getAdminLogs", { adminPassword: adminPasswordValue });
    const logs = data.logs || [];
    $("adminLogList").innerHTML = logs.length
      ? logs.map(log => `<div class="log-row"><strong>${escapeHtml(log.createdAt)}</strong><span>${escapeHtml(log.action)}</span><small>${escapeHtml(log.detail)}</small></div>`).join("")
      : '<p class="state-text">저장된 로그가 없습니다.</p>';
  } catch (error) {
    $("adminLogList").innerHTML = `<p class="error-text">${escapeHtml(error.message)}</p>`;
  }
}

function rosterAuditMembers() {
  const source = roomAuditSource.length
    ? roomAuditSource
    : roomList.map((item) => ({ no: String(item.no || "").trim(), name: item.name || "", idRaw: item.id || "", id: normalize(item.id) }));

  return source.map((item) => ({
    no: String(item.no || "").trim(),
    name: String(item.name || "").trim(),
    idRaw: String(item.idRaw ?? item.id ?? "").trim(),
    id: normalize(item.idRaw ?? item.id ?? ""),
  }));
}

function rosterSnapshot(members = rosterAuditMembers()) {
  return {
    savedAt: Date.now(),
    members: members.map((item) => ({ no: item.no, name: item.name, id: item.id })),
  };
}

function readRosterBaseline() {
  const data = readStorageJson(ROSTER_BASELINE_KEY, null);
  if (!data || !Array.isArray(data.members)) return null;
  return data;
}

function duplicateGroups(items, keyFn) {
  const groups = new Map();
  items.forEach((item) => {
    const key = keyFn(item);
    if (!key) return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });
  return [...groups.entries()]
    .filter(([, members]) => members.length > 1)
    .map(([key, members]) => ({ key, members }));
}

function calculateRosterAudit() {
  const current = rosterAuditMembers();
  const baseline = readRosterBaseline();

  const duplicateIds = duplicateGroups(current.filter((x) => validUsername(x.id)), (x) => x.id);
  const duplicateNos = duplicateGroups(current, (x) => x.no);
  const duplicateNames = duplicateGroups(current, (x) => x.name.trim().toLowerCase())
    .filter((group) => new Set(group.members.map((x) => x.id)).size > 1);
  const missingIds = current.filter((x) => !x.idRaw.trim());
  const invalidIds = current.filter((x) => x.idRaw.trim() && !validUsername(x.id));
  const missingNos = current.filter((x) => !x.no);
  const missingNames = current.filter((x) => !x.name);

  const newMembers = [];
  const removedMembers = [];
  const changedIds = [];

  if (baseline) {
    const currentNoGroups = duplicateGroups(current, (x) => x.no);
    const baselineNormalized = (baseline.members || []).map((x) => ({
      no: String(x.no || "").trim(),
      name: String(x.name || "").trim(),
      id: normalize(x.id),
    }));
    const baselineNoGroups = duplicateGroups(baselineNormalized, (x) => x.no);
    const badCurrentNos = new Set(currentNoGroups.map((g) => g.key));
    const badBaselineNos = new Set(baselineNoGroups.map((g) => g.key));

    const currentByNo = new Map(current.filter((x) => x.no && !badCurrentNos.has(x.no)).map((x) => [x.no, x]));
    const baseByNo = new Map(baselineNormalized.filter((x) => x.no && !badBaselineNos.has(x.no)).map((x) => [x.no, x]));

    currentByNo.forEach((item, no) => {
      const old = baseByNo.get(no);
      if (!old) newMembers.push(item);
      else if (old.id && item.id && old.id !== item.id) changedIds.push({ no, name: item.name || old.name, before: old.id, after: item.id });
    });
    baseByNo.forEach((item, no) => { if (!currentByNo.has(no)) removedMembers.push(item); });
  }

  const issueCount = duplicateIds.length + duplicateNos.length + duplicateNames.length + missingIds.length + invalidIds.length + missingNos.length + missingNames.length;
  return { current, baseline, newMembers, removedMembers, changedIds, duplicateIds, duplicateNos, duplicateNames, missingIds, invalidIds, missingNos, missingNames, issueCount };
}

function auditMemberText(item) {
  const no = item.no ? `${item.no}. ` : "";
  const name = item.name || "(닉네임 없음)";
  const id = item.id ? ` @${item.id}` : " (아이디 없음)";
  return `${no}${name}${id}`;
}

function auditSectionHtml(title, items, formatter = auditMemberText) {
  if (!items.length) return "";
  return `<section class="audit-detail-section"><h4>${escapeHtml(title)} <span>${items.length}</span></h4>${items.map((item) => `<div class="audit-detail-row">${escapeHtml(formatter(item))}</div>`).join("")}</section>`;
}

function renderRosterAudit() {
  if (!$("rosterAuditDetails")) return;
  const audit = calculateRosterAudit();
  lastRosterAudit = audit;

  $("auditNewCount").textContent = `${audit.newMembers.length}명`;
  $("auditRemovedCount").textContent = `${audit.removedMembers.length}명`;
  $("auditChangedCount").textContent = `${audit.changedIds.length}명`;
  $("auditIssueCount").textContent = `${audit.issueCount}건`;

  if (!audit.baseline) {
    $("rosterBaselineState").textContent = "기준 명단이 없습니다. 현재 명단을 기준으로 저장하면 이후 변경사항을 감지합니다.";
  } else {
    const date = new Date(audit.baseline.savedAt || 0);
    $("rosterBaselineState").textContent = `기준 저장: ${date.toLocaleString("ko-KR")} · ${audit.baseline.members.length}명`;
  }

  const sections = [
    auditSectionHtml("🆕 신규 회원", audit.newMembers),
    auditSectionHtml("🔴 삭제된 회원", audit.removedMembers),
    auditSectionHtml("🟠 아이디 변경 의심", audit.changedIds, (x) => `${x.no}. ${x.name}  @${x.before} → @${x.after}`),
    auditSectionHtml("⚠️ 동일 아이디 중복", audit.duplicateIds, (g) => `@${g.key} · ${g.members.map((x) => `${x.no || "?"}.${x.name || "?"}`).join(" / ")}`),
    auditSectionHtml("⚠️ 회원번호 중복", audit.duplicateNos, (g) => `${g.key}번 · ${g.members.map((x) => `${x.name || "?"} @${x.id || "?"}`).join(" / ")}`),
    auditSectionHtml("⚠️ 닉네임 중복(아이디 다름)", audit.duplicateNames, (g) => `${g.members[0]?.name || g.key} · ${g.members.map((x) => `@${x.id || "?"}`).join(" / ")}`),
    auditSectionHtml("⚠️ 아이디 누락", audit.missingIds),
    auditSectionHtml("⚠️ 아이디 형식 오류", audit.invalidIds, (x) => `${x.no || "?"}. ${x.name || "?"} · ${x.idRaw}`),
    auditSectionHtml("⚠️ 회원번호 누락", audit.missingNos),
    auditSectionHtml("⚠️ 닉네임 누락", audit.missingNames),
  ].filter(Boolean).join("");

  $("rosterAuditDetails").innerHTML = sections || `<div class="audit-ok">✅ 명단 이상 없음</div>`;
}

function saveRosterBaseline() {
  if (!adminLoggedIn) return toast("운영진 로그인이 필요합니다.");
  const snapshot = rosterSnapshot();
  writeStorageJson(ROSTER_BASELINE_KEY, snapshot);
  renderRosterAudit();
  toast(`현재 명단 ${snapshot.members.length}명을 기준으로 저장했습니다.`);
}

async function copyRosterAudit() {
  const audit = lastRosterAudit || calculateRosterAudit();
  const lines = ["[여우방 명단 자동 점검]", `신규 ${audit.newMembers.length}명 / 삭제 ${audit.removedMembers.length}명 / 아이디 변경 의심 ${audit.changedIds.length}명 / 중복·오류 ${audit.issueCount}건`];
  if (audit.newMembers.length) lines.push("", "[신규 회원]", ...audit.newMembers.map(auditMemberText));
  if (audit.removedMembers.length) lines.push("", "[삭제된 회원]", ...audit.removedMembers.map(auditMemberText));
  if (audit.changedIds.length) lines.push("", "[아이디 변경 의심]", ...audit.changedIds.map((x) => `${x.no}. ${x.name} @${x.before} → @${x.after}`));
  if (audit.duplicateIds.length) lines.push("", "[동일 아이디 중복]", ...audit.duplicateIds.map((g) => `@${g.key} : ${g.members.map((x) => `${x.no || "?"}.${x.name || "?"}`).join(" / ")}`));
  if (audit.duplicateNos.length) lines.push("", "[회원번호 중복]", ...audit.duplicateNos.map((g) => `${g.key}번 : ${g.members.map((x) => `${x.name || "?"} @${x.id || "?"}`).join(" / ")}`));
  if (audit.duplicateNames.length) lines.push("", "[닉네임 중복]", ...audit.duplicateNames.map((g) => `${g.members[0]?.name || g.key} : ${g.members.map((x) => `@${x.id || "?"}`).join(" / ")}`));
  if (audit.missingIds.length) lines.push("", "[아이디 누락]", ...audit.missingIds.map(auditMemberText));
  if (audit.invalidIds.length) lines.push("", "[아이디 형식 오류]", ...audit.invalidIds.map((x) => `${x.no || "?"}. ${x.name || "?"} ${x.idRaw}`));
  if (audit.missingNos.length) lines.push("", "[회원번호 누락]", ...audit.missingNos.map(auditMemberText));
  if (audit.missingNames.length) lines.push("", "[닉네임 누락]", ...audit.missingNames.map(auditMemberText));
  if (lines.length === 2) lines.push("", "✅ 명단 이상 없음");
  try { await writeClipboardText(lines.join("\n")); toast("명단 점검 결과를 복사했습니다."); }
  catch (error) { toast(error.message || "점검 결과 복사 실패"); }
}

async function adminLogin() {
  const password = $("adminPassword").value.trim();
  if (!password) return;

  try {
    await apiPost("adminLogin", { password });
    adminLoggedIn = true;
    adminPasswordValue = password;
    try { sessionStorage.setItem("yeowoobangRole", "admin"); } catch (_) {}
    updateFoxMode();
    $("adminLoginMsg").textContent = "";
    showAdminPanel();
    renderRosterAudit();
    loadAdminLogs();
    matchGranted = true;
    followGranted = true;
    applyFollowLock();
    applyMatchLock();
    toast("운영진 로그인 완료");
  } catch (_) {
    $("adminLoginMsg").textContent = "운영진 비밀번호가 올바르지 않습니다.";
  }
}

function showAdminPanel() {
  $("adminPanel").classList.remove("hidden");
  $("adminLoginCard").classList.add("hidden");
  updateLockIndicators();
}

function adminLogout() {
  adminLoggedIn = false;
  adminPasswordValue = "";
  try { sessionStorage.setItem("yeowoobangRole", "member"); } catch (_) {}
  updateFoxMode();
  accessGranted = false;
  matchGranted = false;
  followGranted = false;
  $("adminPanel").classList.add("hidden");
  $("adminLoginCard").classList.remove("hidden");
  $("adminPassword").value = "";
  setAdminNavigation(false);
  applyFollowLock();
  applyMatchLock();
  bootstrapAuth();
}

async function runAdminAction(action, payload, successMessage) {
  if (!adminLoggedIn || !adminPasswordValue) {
    toast("운영진 로그인이 필요합니다.");
    return null;
  }

  try {
    const data = await apiPost(action, { adminPassword: adminPasswordValue, ...payload });
    toast(successMessage);
    await Promise.allSettled([refreshPublicConfig(false), loadNotices(false), loadAdminLogs()]);
    return data;
  } catch (error) {
    toast(error.message || "변경 실패");
    return null;
  }
}

async function saveNotice() {
  const content = $("noticeBody").value.trim();
  if (!content) return toast("공지 내용을 입력해 주세요.");

  const data = await runAdminAction("addNotice", { content }, "공지 저장 완료");
  if (data) {
    $("noticeBody").value = "";
    renderNotices(data.notices || []);
  }
}

async function deleteNotice(noticeId) {
  const data = await runAdminAction("deleteNotice", { noticeId }, "공지 삭제 완료");
  if (data) renderNotices(data.notices || []);
}





if ($("openSettingsSheetBtn")) $("openSettingsSheetBtn").onclick = () => window.open(sheetUrl(), "_blank");
if($("inviteMemberTab"))$("inviteMemberTab").onclick=()=>setInviteMode("member");if($("inviteAdminTab"))$("inviteAdminTab").onclick=()=>{if(inviteAdminLoggedIn){setInviteMode("admin");Promise.allSettled([loadInviteAdmin(),loadInviteSummary()])}else openInviteAdminLogin()};if($("inviteCheckMeBtn"))$("inviteCheckMeBtn").onclick=checkInviteMe;if($("inviteStartFollowBtn"))$("inviteStartFollowBtn").onclick=startFollowFromOne;if($("inviteRegisterBtn"))$("inviteRegisterBtn").onclick=registerInviteIntegrated;if($("inviteAdminPassword"))$("inviteAdminPassword").addEventListener("input",e=>{e.target.value=e.target.value.replace(/\D/g,"")});if($("inviteAdminLoginBtn"))$("inviteAdminLoginBtn").onclick=loginInviteAdmin;if($("inviteAdminCancelBtn"))$("inviteAdminCancelBtn").onclick=closeInviteAdminLogin;if($("inviteAdminLogoutBtn"))$("inviteAdminLogoutBtn").onclick=logoutInviteAdmin;if($("refreshInviteAdminBtn"))$("refreshInviteAdminBtn").onclick=loadInviteAdmin;if($("refreshInviteSummaryBtn"))$("refreshInviteSummaryBtn").onclick=loadInviteSummary;if($("inviteAdminSearch"))$("inviteAdminSearch").oninput=renderInviteAdminList;document.querySelectorAll("[data-invite-filter]").forEach(b=>b.onclick=()=>{inviteAdminFilter=b.dataset.inviteFilter;document.querySelectorAll("[data-invite-filter]").forEach(x=>x.classList.toggle("active",x===b));renderInviteAdminList()});document.addEventListener("click",e=>{const a=e.target.closest("[data-invite-approve]"),r=e.target.closest("[data-invite-reject]"),c=e.target.closest("[data-invite-cancel]");if(a)changeInviteStatus(a.dataset.inviteApprove,"APPROVED");if(r)changeInviteStatus(r.dataset.inviteReject,"REJECTED");if(c)cancelInviteApproval(c.dataset.inviteCancel,c.dataset.inviteName||"")});
document.querySelectorAll(".nav-btn").forEach((button) => {
  button.onclick = () => showView(button.dataset.view);
});

$("generalAccessBtn").onclick = chooseGeneralAccess;
$("adminAccessBtn").onclick = chooseAdminAccess;
$("memberLoginBtn").onclick = loginMemberFromGate;
$("openMemberRegisterBtn").onclick = () => { $("gateError").textContent = ""; setGate("memberRegister"); };
$("openMemberForgotBtn").onclick = () => { $("gateError").textContent = ""; setGate("memberForgot"); };
$("backFromForgotBtn").onclick = () => { $("gateError").textContent = ""; setGate("memberLogin"); };
$("memberForgotBtn").onclick = resetMemberPasswordFromGate;
$("memberLoginBackBtn").onclick = backToRoleSelect;
$("backToMemberLoginBtn").onclick = () => { $("gateError").textContent = ""; setGate("memberLogin"); };
$("memberRegisterBtn").onclick = registerMemberFromGate;
$("memberMenuBtn").onclick = openMemberDrawer;
$("memberLoginPassword").onkeydown = (event) => { if (event.key === "Enter") loginMemberFromGate(); };
$("memberRegisterPasswordConfirm").onkeydown = (event) => { if (event.key === "Enter") registerMemberFromGate(); };
$("gateBackBtn").onclick = backToRoleSelect;
$("gateSubmitBtn").onclick = submitGatePassword;
$("gatePassword").onkeydown = (event) => { if (event.key === "Enter") submitGatePassword(); };
$("gateRetryBtn").onclick = bootstrapAuth;

$("followSearch").oninput = renderFollowList;
$("refreshFollowBtn").onclick = () => loadRoomList(true);
$("reloadRoomBtn").onclick = () => loadMatchRoomList(true, true);

$("resumeBtn").onclick = resumeLastFollowPosition;
$("resumeResetBtn").onclick = clearLastFollowPosition;

$("followList").addEventListener("click", (event) => {
  const link = event.target.closest("[data-save-follow]");
  if (!link) return;

  const id = normalize(link.dataset.saveFollow);
  const item = roomList.find((person) => person.id === id);
  if (item) saveLastFollowPosition(item);
});

$("copyBatchButtons").addEventListener("click", (event) => {
  const button = event.target.closest("[data-copy-batch]");
  if (!button) return;

  const batchIndex = Number(button.dataset.copyBatch);
  if (Number.isInteger(batchIndex) && batchIndex >= 0) {
    copyFollowBatch(batchIndex);
  }
});

$("followUnlockBtn").onclick = unlockFollow;
$("followPassword").onkeydown = (event) => { if (event.key === "Enter") unlockFollow(); };

$("matchVoteDoneBtn")?.addEventListener("click",()=>submitMatchVote("완료"));
$("matchVoteDelayBtn")?.addEventListener("click",()=>submitMatchVote("지연"));
$("matchPassword")?.addEventListener("keydown", (event) => { if (event.key === "Enter" && typeof unlockMatch === "function") unlockMatch(); });

$("zipFile").onchange = () => {
  $("fileName").textContent = $("zipFile").files[0]?.name || "인스타그램 ZIP 파일 선택";
};
$("analyzeBtn").onclick = analyze;
$("resetBtn").onclick = resetAnalysis;
$("searchInput").oninput = renderMatchList;
$("copyBtn").onclick = copyCurrent;
$("mentionBtn").onclick = copyMentions;

document.querySelectorAll(".tab").forEach((button) => {
  button.onclick = () => showTab(button.dataset.tab);
});

$("adminLoginBtn").onclick = adminLogin;
$("adminPassword").onkeydown = (event) => { if (event.key === "Enter") adminLogin(); };
$("adminLogoutBtn").onclick = adminLogout;
$("openSheetBtn").onclick = () => window.open(sheetUrl(), "_blank");
$("adminRefreshBtn").onclick = async () => {
  await Promise.allSettled([refreshPublicConfig(false), loadRoomList(true), loadMatchRoomList(true, true), loadNotices(false), loadAdminLogs(), loadInviteAdmin()]);
  renderRosterAudit();
  toast("전체 새로고침 완료");
};

$("lockAppBtn").onclick = () => runAdminAction("setAppLock", { locked: true }, "앱을 잠갔습니다.");
$("unlockAppBtn").onclick = () => runAdminAction("setAppLock", { locked: false }, "앱 잠금을 해제했습니다.");
$("lockFollowBtn").onclick = () => runAdminAction("setFollowLock", { locked: true }, "팔로우리스트를 잠갔습니다.");
$("unlockFollowBtn").onclick = () => runAdminAction("setFollowLock", { locked: false }, "팔로우리스트 잠금을 해제했습니다.");
$("lockMatchBtn").onclick = () => runAdminAction("setMatchVoteOpen", { open: false }, "맞팔확인 기간을 종료했습니다.");
$("unlockMatchBtn").onclick = () => runAdminAction("setMatchVoteOpen", { open: true }, "맞팔확인 기간을 시작했습니다.");


$("saveNoticeBtn").onclick = saveNotice;
$("closeNoticeBtn").onclick = () => $("noticeCard").classList.add("hidden");
$("refreshNoticeBtn").onclick = loadNotices;
$("refreshLogsBtn").onclick = loadAdminLogs;
$("refreshRosterAuditBtn")?.addEventListener("click", () => { renderRosterAudit(); toast("명단 점검을 다시 실행했습니다."); });
$("saveRosterBaselineBtn")?.addEventListener("click", saveRosterBaseline);
$("copyRosterAuditBtn")?.addEventListener("click", copyRosterAudit);
$("updateNowBtn").onclick = async () => {
  if ("serviceWorker" in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map(reg => reg.update().catch(() => {})));
  }
  const url = new URL(location.href);
  url.searchParams.set("v", Date.now().toString());
  location.replace(url.toString());
};

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
});

$("installBtn").onclick = async () => {
  if (installPrompt) {
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
  } else {
    toast("브라우저 메뉴에서 홈 화면에 추가를 눌러주세요.");
  }
};

const THEME_KEY="yeowoobang:theme:v1";
function applyTheme(theme){const dark=theme==="dark";document.documentElement.dataset.theme=dark?"dark":"light";localStorage.setItem(THEME_KEY,dark?"dark":"light");const b=$("themeToggleBtn");if(b)b.textContent=dark?"☀️":"🌙";document.querySelector('meta[name="theme-color"]')?.setAttribute("content",dark?"#111318":"#ffffff");}
function initTheme(){let t=localStorage.getItem(THEME_KEY);if(!t)t=window.matchMedia?.('(prefers-color-scheme: dark)').matches?'dark':'light';applyTheme(t);}
initTheme();
$("themeToggleBtn")?.addEventListener("click",()=>applyTheme(document.documentElement.dataset.theme==="dark"?"light":"dark"));

window.addEventListener("DOMContentLoaded", async () => {
  showGate();
  setGate("role");
  renderResumeCard();
  updateFoxMode();
  finishBootScreen();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js?v=730").catch(() => {});
  }

  // 로컬 설정과 서버 상태는 백그라운드에서 읽습니다.
  loadConfig()
    .then(() => bootstrapAuth())
    .catch(() => bootstrapAuth());

  setInterval(async () => {
    if (!document.hidden && accessGranted) {
      try { await refreshPublicConfig(true); } catch (_) {}
    }
  }, 30000);

  setInterval(async () => {
    if (!document.hidden && accessGranted) {
      await loadNotices(true).catch(() => {});
    }
  }, 120000);
});


$("memberDrawerBackdrop")?.addEventListener("click", closeMemberDrawer);
$("memberDrawerCloseBtn")?.addEventListener("click", closeMemberDrawer);
$("openMyPageBtn")?.addEventListener("click", openMyPage);
$("openPasswordChangeBtn")?.addEventListener("click",()=>openAccountModal("passwordChangeModal"));
$("myPagePasswordBtn")?.addEventListener("click",()=>{closeAccountModal("myPageModal");openAccountModal("passwordChangeModal");});
$("changeMemberPasswordBtn")?.addEventListener("click",changeMemberPasswordFromUi);
$("drawerNoticeBtn")?.addEventListener("click",()=>{closeMemberDrawer();showView("noticeView");});
$("openFaqBtn")?.addEventListener("click",()=>openAccountModal("faqModal"));
$("openInquiryBtn")?.addEventListener("click",()=>openAccountModal("inquiryModal"));
$("drawerLogoutBtn")?.addEventListener("click",()=>{closeMemberDrawer();logoutMember();});
$("inquiryInstagramBtn")?.addEventListener("click",()=>window.open("https://www.instagram.com/tlso_94/","_blank","noopener"));
document.querySelectorAll("[data-close-account-modal]").forEach(btn=>btn.addEventListener("click",()=>closeAccountModal(btn.dataset.closeAccountModal)));
document.querySelectorAll(".account-modal").forEach(modal=>modal.addEventListener("click",e=>{if(e.target===modal)closeAccountModal(modal.id)}));


/* V72 활동기록 / 운영진 대시보드 */
async function openActivityHistory(){
  if(!memberSession?.token)return toast('회원 로그인이 필요합니다.');
  openAccountModal('activityModal');
  const list=$('activityList'), hist=$('analysisHistoryList');
  list.innerHTML='<p class="state-text">기록을 불러오는 중입니다.</p>';
  try{
    const [a,h]=await Promise.all([apiPost('getMyActivity',{token:memberSession.token},12000),apiPost('getMyAnalysisHistory',{token:memberSession.token},12000)]);
    list.innerHTML=(a.items||[]).length?(a.items||[]).map(x=>`<div class="v72-activity-row"><strong>${escapeHtml(x.type||'활동')}</strong><div>${escapeHtml(x.content||'')}</div><small>${escapeHtml(x.at||'')}</small></div>`).join(''):'<p class="state-text">아직 활동기록이 없습니다.</p>';
    hist.innerHTML=(h.items||[]).length?(h.items||[]).map(x=>`<div class="v72-activity-row"><strong>${escapeHtml(x.at||'')}</strong><div>맞팔 ${x.mutual} · 내가팔로우 ${x.onlyMe} · 나만팔로우 ${x.fansOnly} · 서로안함 ${x.neither}</div><small>전체 ${x.total}명</small></div>`).join(''):'<p class="state-text">아직 저장된 분석기록이 없습니다.</p>';
  }catch(e){list.innerHTML=`<p class="error-text">${escapeHtml(e.message||'불러오지 못했습니다.')}</p>`;}
}
async function loadAdminDashboardV72(){
  if(!adminLoggedIn)return;
  try{const d=await apiPost('getAdminDashboard',{adminPassword:adminPasswordValue},12000);
    $('dashLoggedToday').textContent=`${d.loggedToday||0}명`;$('dashMatchDone').textContent=`${d.matchDone||0}명`;$('dashMatchDelay').textContent=`${d.matchDelay||0}명`;$('dashMatchMissing').textContent=`${d.matchMissing||0}명`;$('dashInvitePending').textContent=`${d.invitePending||0}명`;$('dashAccounts').textContent=`${d.accounts||0}명`;
  }catch(_){ }
}
async function searchAdminMembersV72(){
  if(!adminLoggedIn)return; const q=$('adminMemberSearch')?.value.trim()||''; const box=$('adminMemberList');
  if(!q){box.innerHTML='<p class="state-text">검색어를 입력해주세요.</p>';return;}
  box.innerHTML='<p class="state-text">검색 중...</p>';
  try{const d=await apiPost('getAdminMembers',{adminPassword:adminPasswordValue,query:q},12000);const items=d.items||[];
    box.innerHTML=items.length?items.map(x=>`<div class="v72-member-row"><div><strong>${escapeHtml(x.nickname)} · @${escapeHtml(x.instagramId)}</strong><div class="meta">MemberID ${escapeHtml(x.memberId)} · 회원 ${escapeHtml(x.memberStatus)} · 계정 ${escapeHtml(x.account?.status||'미등록')}${x.account?.last?` · 최근 ${escapeHtml(x.account.last)}`:''} · 폭스 ${escapeHtml(x.foxStatus||'정상')}</div></div><div class="v72-member-actions">${x.account?`<button class="outline ${x.account.status==='정상'?'danger-outline':'success-outline'}" data-v72-member="${escapeHtml(x.memberId)}" data-v72-status="${x.account.status==='정상'?'정지':'정상'}">${x.account.status==='정상'?'정지':'복구'}</button>`:''}<div class="v73-fox-actions"><button class="outline" onclick="setFoxPenaltyV73('${escapeHtml(x.memberId)}','정상')">폭스 정상</button><button class="outline danger-outline" onclick="setFoxPenaltyV73('${escapeHtml(x.memberId)}','제재')">제재</button><button class="outline danger-outline" onclick="setFoxPenaltyV73('${escapeHtml(x.memberId)}','영구금지')">영구금지</button></div></div></div>`).join(''):'<p class="state-text">검색 결과가 없습니다.</p>';
    box.querySelectorAll('[data-v72-member]').forEach(b=>b.onclick=async()=>{if(!confirm(`이 계정을 ${b.dataset.v72Status} 상태로 변경할까요?`))return;try{await apiPost('setMemberAccountStatus',{adminPassword:adminPasswordValue,memberId:b.dataset.v72Member,status:b.dataset.v72Status},12000);toast('계정 상태를 변경했습니다.');await searchAdminMembersV72();await loadAdminDashboardV72();}catch(e){toast(e.message||'변경 실패');}});
  }catch(e){box.innerHTML=`<p class="error-text">${escapeHtml(e.message||'검색 실패')}</p>`;}
}
$('openActivityBtn')?.addEventListener('click',()=>{closeMemberDrawer();openActivityHistory();});
$('adminMemberSearchBtn')?.addEventListener('click',searchAdminMembersV72);
$('adminMemberSearch')?.addEventListener('keydown',e=>{if(e.key==='Enter')searchAdminMembersV72();});

// 서비스워커 새 버전 감지 시 사용자에게 안내
if('serviceWorker' in navigator){navigator.serviceWorker.addEventListener('controllerchange',()=>{if(sessionStorage.getItem('yw:v73:reloaded'))return;sessionStorage.setItem('yw:v73:reloaded','1');toast('새 버전이 적용되었습니다.');});}

/* =========================================================
 * V73 운영 안정화
 * ======================================================= */
let v73MatchReport={done:[],delay:[],missing:[]};
let v73ReportType='missing';
async function loadV73OpsStatus(){
  if(!adminLoggedIn)return;
  try{const d=await apiPost('getV73OpsStatus',{adminPassword:adminPasswordValue},12000);
    if($('adminRoleBadge'))$('adminRoleBadge').textContent=d.role||'방장';
    if($('v73Version'))$('v73Version').textContent=d.version||'V73';
    if($('v73LastBackup'))$('v73LastBackup').textContent=d.lastBackup||'없음';
  }catch(_){ }
}
async function createBackupV73Ui(){
  if(!adminLoggedIn)return toast('운영진 로그인이 필요합니다.');
  const b=$('createBackupV73Btn'); if(b)b.disabled=true;
  try{const d=await apiPost('createBackupV73',{adminPassword:adminPasswordValue},30000);toast(`백업 완료 · ${d.name||''}`);await loadV73OpsStatus();}
  catch(e){toast(e.message||'백업 실패');}finally{if(b)b.disabled=false;}
}
async function loadMatchReportV73(){
  if(!adminLoggedIn)return;
  const box=$('matchReportV73'); if(box)box.classList.remove('hidden');
  try{const d=await apiPost('getMatchSubmissionReportV73',{adminPassword:adminPasswordValue},15000);v73MatchReport=d;
    $('v73DoneCount').textContent=d.counts?.done||0;$('v73DelayCount').textContent=d.counts?.delay||0;$('v73MissingCount').textContent=d.counts?.missing||0;renderMatchReportV73();
  }catch(e){$('matchReportV73List').innerHTML=`<p class="error-text">${escapeHtml(e.message||'불러오기 실패')}</p>`;}
}
function renderMatchReportV73(){
  const items=v73MatchReport[v73ReportType]||[], list=$('matchReportV73List');
  list.innerHTML=items.length?items.map(x=>`<div class="v72-member-row"><div><strong>${escapeHtml(x.nickname)} · @${escapeHtml(x.instagramId)}</strong><div class="meta">MemberID ${escapeHtml(x.memberId)}</div></div></div>`).join(''):'<p class="state-text">해당 회원이 없습니다.</p>';
}
async function copyMatchReportV73(){
  const items=v73MatchReport[v73ReportType]||[]; if(!items.length)return toast('복사할 명단이 없습니다.');
  await navigator.clipboard.writeText(items.map(x=>`${x.nickname}\t@${x.instagramId}`).join('\n'));toast(`${items.length}명 복사했습니다.`);
}
async function setFoxPenaltyV73(memberId,status){
  if(!confirm(`폭스바겐 상태를 '${status}'로 변경할까요?`))return;
  try{await apiPost('setVolkswagenPenaltyV73',{adminPassword:adminPasswordValue,memberId,status},12000);toast('폭스바겐 상태를 변경했습니다.');await searchAdminMembersV72();}catch(e){toast(e.message||'변경 실패');}
}
$('createBackupV73Btn')?.addEventListener('click',createBackupV73Ui);
$('loadMatchReportV73Btn')?.addEventListener('click',loadMatchReportV73);
$('copyMatchReportV73Btn')?.addEventListener('click',copyMatchReportV73);
document.querySelectorAll('[data-v73-report]').forEach(b=>b.addEventListener('click',()=>{v73ReportType=b.dataset.v73Report;renderMatchReportV73();}));

/* =========================================================
 * V74 회원 통합관리
 * ======================================================= */
let v74Members=[];
async function loadV74Members(query='',newOnly=false){
  if(!adminLoggedIn)return toast('운영진 로그인이 필요합니다.');
  const box=$('v74MemberResults'); box.innerHTML='<p class="state-text">불러오는 중...</p>';
  try{const d=await apiPost('getV74MemberOps',{adminPassword:adminPasswordValue,query},15000);v74Members=(d.items||[]).filter(x=>!newOnly||(x.day!==null&&x.day<=7&&x.memberStatus==='승인완료'));renderV74Members();}
  catch(e){box.innerHTML=`<p class="error-text">${escapeHtml(e.message||'불러오기 실패')}</p>`;}
}
function renderV74Members(){
  const box=$('v74MemberResults');
  box.innerHTML=v74Members.length?v74Members.map(x=>`<div class="v72-member-row v74-member"><div><strong>${escapeHtml(x.nickname)} · @${escapeHtml(x.instagramId)}</strong><div class="meta">MemberID ${escapeHtml(x.memberId)}${x.day!==null?` · D+${x.day}`:''} · 회원 ${escapeHtml(x.memberStatus)} · 맞팔 ${escapeHtml(x.matchStatus)} · 폭스 ${escapeHtml(x.foxStatus)}</div><div class="meta">계정 ${escapeHtml(x.account?.status||'미등록')}${x.lastLogin?` · 최근로그인 ${escapeHtml(x.lastLogin)}`:''}</div><textarea id="memo-${escapeHtml(x.memberId)}" class="v74-memo" placeholder="운영진 메모">${escapeHtml(x.memo||'')}</textarea></div><div class="v72-member-actions"><button class="outline" onclick="saveV74Memo('${escapeHtml(x.memberId)}')">메모 저장</button><button class="outline success-outline" onclick="setV74Lifecycle('${escapeHtml(x.memberId)}','승인완료')">정상</button><button class="outline danger-outline" onclick="setV74Lifecycle('${escapeHtml(x.memberId)}','탈퇴')">탈퇴</button><button class="outline danger-outline" onclick="setV74Lifecycle('${escapeHtml(x.memberId)}','강퇴')">강퇴</button></div></div>`).join(''):'<p class="state-text">해당 회원이 없습니다.</p>';
}
async function saveV74Memo(id){try{await apiPost('saveMemberMemoV74',{adminPassword:adminPasswordValue,memberId:id,memo:$(`memo-${id}`)?.value||''},12000);toast('운영진 메모를 저장했습니다.');}catch(e){toast(e.message||'저장 실패');}}
async function setV74Lifecycle(id,status){if(!confirm(`회원 상태를 '${status}'로 변경할까요?\n탈퇴/강퇴 시 로그인도 즉시 정지됩니다.`))return;try{await apiPost('setMemberLifecycleV74',{adminPassword:adminPasswordValue,memberId:id,status},12000);toast(`회원 상태를 ${status}로 변경했습니다.`);await loadV74Members($('v74MemberSearch')?.value.trim()||'');}catch(e){toast(e.message||'변경 실패');}}
async function loadV74Issues(){const box=$('v74IssueResults');box.classList.remove('hidden');box.innerHTML='<p class="state-text">검사 중...</p>';try{const d=await apiPost('getDataIssuesV74',{adminPassword:adminPasswordValue},15000);box.innerHTML=`<p class="subtext">오류 ${d.count||0}건</p>`+((d.items||[]).length?(d.items||[]).map(x=>`<div class="v72-member-row"><div><strong>🚨 ${escapeHtml(x.type)}</strong><div class="meta">${x.row}행 · ${escapeHtml(x.detail)}</div></div></div>`).join(''):'<p class="state-text">발견된 데이터 오류가 없습니다. ✅</p>');}catch(e){box.innerHTML=`<p class="error-text">${escapeHtml(e.message||'검사 실패')}</p>`;}}
$('v74MemberSearchBtn')?.addEventListener('click',()=>loadV74Members($('v74MemberSearch')?.value.trim()||''));
$('v74MemberSearch')?.addEventListener('keydown',e=>{if(e.key==='Enter')loadV74Members(e.target.value.trim())});
$('v74NewMembersBtn')?.addEventListener('click',()=>loadV74Members('',true));
$('v74DataIssuesBtn')?.addEventListener('click',loadV74Issues);
