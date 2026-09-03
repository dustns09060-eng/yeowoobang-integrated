/* V120 재접속 즉시복원 + 로그인 체감속도 최적화 */
const $ = (id) => document.getElementById(id);

let roomList = [];
let roomAuditSource = [];
let matchRoomList = [];
let result = { all: [], mutual: [], onlyMe: [], fansOnly: [], neither: [], unavailable: [] };
let currentTab = "all";
let matchRequestIdentity = "";
let matchRequestIdentityName = "";
let matchRequestPeriod = { active:false, startAt:"", endAt:"" };
let matchRequestData = { received:[], sent:[] };
let matchRequestTab = "received";
let pendingMatchRequestTarget = "";
let currentGroup = 0;
let currentCopyBatch = 0;
let installPrompt = null;
let adminLoggedIn = false;
let adminPasswordValue = "";
let adminModeToken = "";
let adminMemberRole = "";
let adminProfile = null;
let publicConfig = null;
let accessGranted = false;
let appLockGranted = false;
let matchGranted = false;
let followGranted = false;
let gateMode = "loading";
let memberSession = null;
let memberAuthGenerationV133 = 0; // V133: 오래된 세션 검증 요청이 새 로그인을 덮어쓰는 것 방지
const MEMBER_SESSION_KEY = "yeowoobang:memberSession:v1";
let securityVersion = "";
let noticeSignature = "";
const APP_VERSION = "V188";
window.YEOWOOBANG_BUILD = "V188";

let config = {
  version: "V102",
  appName: "여우방 통합 프로그램",
  apiUrl: "https://script.google.com/macros/s/AKfycbww39Xk_v0C8NgyXMUH76F4dEr63aPNgE_KG5tpzMh1UKM31YA05E2E_ZmyKHk5RCA/exec",
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

const V183_SPEED = {
  roomLoadedAt: 0,
  roomInFlight: null,
  inviteLoadedAt: 0,
  inviteInFlight: null,
  publicConfigLoadedAt: 0,
  publicConfigInFlight: null,
  matchRequestConfigLoadedAt: 0,
  matchRequestConfigInFlight: null,
  notificationsLoadedAt: 0,
  notificationsInFlight: null,
};

const V183_TTL = {
  room: 5 * 60 * 1000,
  invite: 2 * 60 * 1000,
  publicConfig: 2 * 60 * 1000,
  matchRequestConfig: 60 * 1000,
  notifications: 3 * 60 * 1000,
};

function freshV183(ts, ttl){
  return Boolean(ts && (Date.now() - ts) < ttl);
}

function idleV183(fn, timeout = 1800){
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(() => fn(), { timeout });
  } else {
    setTimeout(fn, Math.min(timeout, 1200));
  }
}

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
  return canonicalizeFollowProgress(saved);
}

function safeTodayFollowCount(value) {
  const n = Number(value);
  const max = Math.max(Array.isArray(roomList) ? roomList.length : 0, 5000);
  return Number.isInteger(n) && n >= 0 && n <= max ? n : null;
}

function safeProgressTimestamp(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? Date.now() : value.getTime();
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value < 1e12 ? value * 1000 : value;
    return ms > 946684800000 && ms < 4102444800000 ? ms : Date.now();
  }
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return safeProgressTimestamp(numeric);
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

function canonicalizeFollowProgress(progress) {
  if (!progress) return null;
  const id = normalize(progress.id);
  if (!validUsername(id)) return null;
  const matched = roomList.find(person => normalize(person.id) === id);
  if (matched) {
    const index = roomList.indexOf(matched);
    return {
      group: index >= 0 ? Math.floor(index / 500) + 1 : Math.max(1, Number(progress.group) || 1),
      no: String(matched.no || progress.no || ""),
      name: String(matched.name || progress.name || ""),
      id,
      timestamp: safeProgressTimestamp(progress.timestamp)
    };
  }
  return {
    group: Math.max(1, Math.min(99, Number(progress.group) || 1)),
    no: /^\d{1,5}$/.test(String(progress.no || "")) ? String(progress.no) : "",
    name: String(progress.name || "").length <= 40 && !/GMT[+-]\d{4}|^\w{3} \w{3} \d{1,2} \d{4}/.test(String(progress.name || "")) ? String(progress.name) : "",
    id,
    timestamp: safeProgressTimestamp(progress.timestamp)
  };
}

function renderResumeCard() {
  const card = $("resumeCard");
  if (!card) return;

  const last = getLastFollowPosition();
  const daily = getDailyVisitData();

  const serverCount = memberSession ? safeTodayFollowCount(memberTodayFollowCount) : null;
  $("todayVisitCount").textContent = `오늘 ${serverCount !== null ? serverCount : daily.ids.length}명`;

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
      { const c = safeTodayFollowCount(result?.todayCount); if (c !== null) memberTodayFollowCount = c; }
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
    memberTodayFollowCount = safeTodayFollowCount(result?.todayCount);

    if (result?.progress?.id) {
      const progress = canonicalizeFollowProgress(result.progress);
      if (progress) writeStorageJson(FOLLOW_PROGRESS_KEY, progress);
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

    { const c = safeTodayFollowCount(result?.todayCount); if (c !== null) memberTodayFollowCount = c; }

    if (result?.progress?.timestamp) {
      const current = getLastFollowPosition();
      if (current?.id === normalize(data.id)) {
        current.timestamp = safeProgressTimestamp(result.progress.timestamp);
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
  // V118: 로그인된 현재 탭(sessionStorage)에서만 잠깐 캐시합니다.
  // 브라우저를 닫거나 로그아웃하면 사라지며 localStorage에는 명단을 저장하지 않습니다.
  try { localStorage.removeItem(FOLLOW_LIST_CACHE_KEY); } catch (_) {}
  if (!memberSession?.token || !Array.isArray(list) || !list.length) return false;
  try {
    sessionStorage.setItem(FOLLOW_LIST_CACHE_KEY, JSON.stringify({
      savedAt: Date.now(),
      memberId: String(memberSession?.member?.memberId || memberSession?.member?.id || ""),
      list
    }));
    return true;
  } catch (_) {
    return false;
  }
}

function restoreFollowListCache() {
  // 로그인 성공 뒤에만 같은 탭의 직전 명단을 즉시 표시합니다.
  try { localStorage.removeItem(FOLLOW_LIST_CACHE_KEY); } catch (_) {}
  if (!memberSession?.token) return false;
  try {
    const raw = sessionStorage.getItem(FOLLOW_LIST_CACHE_KEY);
    if (!raw) return false;
    const saved = JSON.parse(raw);
    if (!saved || !Array.isArray(saved.list) || !saved.list.length) return false;
    if (Date.now() - Number(saved.savedAt || 0) > FOLLOW_LIST_CACHE_MAX_AGE) {
      sessionStorage.removeItem(FOLLOW_LIST_CACHE_KEY);
      return false;
    }
    const currentMemberId = String(memberSession?.member?.memberId || memberSession?.member?.id || "");
    if (saved.memberId && currentMemberId && saved.memberId !== currentMemberId) {
      sessionStorage.removeItem(FOLLOW_LIST_CACHE_KEY);
      return false;
    }
    roomList = saved.list;
    setSheetState("캐시 표시 · 최신 확인 중");
    updateFollowStats();
    renderGroupTabs();
    renderCopyBatches();
    renderFollowList();
    renderResumeCard();
    updateFollowWatermarkV104?.();
    return true;
  } catch (_) {
    try { sessionStorage.removeItem(FOLLOW_LIST_CACHE_KEY); } catch (_) {}
    return false;
  }
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
  } catch (error) {
    if (error?.name === "AbortError" || String(error?.message || "").toLowerCase().includes("aborted")) {
      const timeoutError = new Error("서버 응답이 늦어 다시 시도해주세요.");
      timeoutError.code = "TIMEOUT";
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

const FIXED_API_URL_V182 = "https://script.google.com/macros/s/AKfycbww39Xk_v0C8NgyXMUH76F4dEr63aPNgE_KG5tpzMh1UKM31YA05E2E_ZmyKHk5RCA/exec";

async function loadConfig() {
  // V182: API 주소는 현재 운영 중인 Apps Script /exec 주소로 고정합니다.
  // config.json에 과거 apiUrl이 남아 있어도 로그인/맞팔/초대별 API를 덮어쓰지 못합니다.
  config.apiUrl = FIXED_API_URL_V182;

  try {
    const response = await fetchWithTimeout("config.json?v=1820", { cache: "no-store" }, 2500);
    if (response.ok) {
      const remoteConfig = await response.json();

      // apiUrl만 제외하고 나머지 설정은 기존처럼 반영
      if (remoteConfig && typeof remoteConfig === "object") {
        const { apiUrl: _ignoredOldApiUrl, ...safeConfig } = remoteConfig;
        config = { ...config, ...safeConfig, apiUrl: FIXED_API_URL_V182 };
      }
    }
  } catch (_) {
    // config.json 로드 실패 시에도 고정 API 주소로 정상 진행
    config.apiUrl = FIXED_API_URL_V182;
  }
}
async function apiGet(action, timeoutMs = 15000) {
  if (!config.apiUrl) throw new Error("Apps Script 주소가 설정되지 않았습니다.");

  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const url = new URL(config.apiUrl);
    url.searchParams.set("action", action);
    url.searchParams.set("_t", Date.now().toString());
    try {
      const response = await fetchWithTimeout(url.toString(), {
        method: "GET",
        cache: "no-store",
        redirect: "follow",
      }, timeoutMs);

      if (!response.ok) throw new Error(`API HTTP ${response.status}`);
      const data = await response.json();
      if (!data.ok) throw new Error(data.error || data.message || "API 요청 실패");
      return data;
    } catch (error) {
      lastError = error;
      if (error?.code !== "TIMEOUT" || attempt === 1) break;
      await new Promise(resolve => setTimeout(resolve, 700));
    }
  }
  throw lastError || new Error("API 요청 실패");
}
async function apiPost(action, payload = {}, timeoutMs = 9000) {
  if (!config.apiUrl) throw new Error("Apps Script 주소가 설정되지 않았습니다.");

  const requestBody = {
    action,
    ...payload
  };
  if (adminLoggedIn && adminModeToken && !requestBody.adminModeToken) {
    requestBody.adminModeToken = adminModeToken;
  }

  const response = await fetchWithTimeout(config.apiUrl, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
    body: JSON.stringify(requestBody),
    cache: "no-store",
    redirect: "follow",
  }, timeoutMs);

  if (!response.ok) throw new Error(`API HTTP ${response.status}`);

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (_) {
    const preview = String(text || "").replace(/\s+/g, " ").slice(0, 120);
    throw new Error(preview
      ? `서버 응답 형식을 확인해주세요. (${preview})`
      : "서버에서 빈 응답을 받았습니다.");
  }

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
  const adminSimpleLoginForm = $("adminSimpleLoginForm");
  const memberRegisterForm = $("memberRegisterForm");
  const newMemberInviteForm = $("newMemberInviteForm");
  const memberForgotForm = $("memberForgotForm");
  const operatorLoginForm = $("operatorLoginForm");
  const retryBtn = $("gateRetryBtn");
  const password = $("gatePassword");

  $("gateError").textContent = "";
  roles.classList.add("hidden");
  form.classList.add("hidden");
  memberLoginForm?.classList.add("hidden");
  adminSimpleLoginForm?.classList.add("hidden");
  memberRegisterForm?.classList.add("hidden");
  newMemberInviteForm?.classList.add("hidden");
  memberForgotForm?.classList.add("hidden");
  operatorLoginForm?.classList.add("hidden");
  retryBtn.classList.add("hidden");
  password.value = "";

  if (mode === "loading") {
    title.textContent = "접속 확인";
    text.textContent = message || "설정을 불러오는 중입니다.";
  } else if (mode === "role") {
    title.textContent = "여우방";
    text.textContent = "";
    roles.classList.remove("hidden");
  } else if (mode === "adminSimple") {
    title.textContent = "여우방";
    text.textContent = "";
    adminSimpleLoginForm?.classList.remove("hidden");
    setTimeout(() => $("adminInstagram")?.focus(), 0);
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
  } else if (mode === "newMemberInvite") {
    title.textContent = "여우방";
    text.textContent = "";
    newMemberInviteForm?.classList.remove("hidden");
    setTimeout(() => $("newMemberNickname")?.focus(), 0);
  } else if (mode === "memberRegister") {
    title.textContent = "여우방";
    text.textContent = "";
    memberRegisterForm?.classList.remove("hidden");
    setTimeout(() => $("memberRegisterNickname")?.focus(), 0);
  } else if (mode === "operatorLogin") {
    title.textContent = "운영진";
    text.textContent = "";
    operatorLoginForm?.classList.remove("hidden");
    setTimeout(() => $("operatorInstagram")?.focus(), 0);
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
  updateAdminModeButton();
}

function updateAdminModeButton() {
  const btn = $("adminModeBtn");
  if (!btn) return;
  const eligibleMember = Boolean(memberSession?.member?.adminEligible);
  const visible = adminLoggedIn || eligibleMember;
  btn.classList.toggle("hidden", !visible);
  if (!visible) return;
  btn.textContent = adminLoggedIn ? "일반모드" : "⚙️ 운영진모드";
  btn.classList.toggle("active-admin-mode", adminLoggedIn);
  btn.title = adminLoggedIn ? "운영진모드 종료" : "운영진모드로 전환";
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
    V183_SPEED.publicConfigLoadedAt = Date.now();
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
  if (saved?.token && saved?.member && !publicConfig?.appLocked) {
    // V120: 이미 로그인된 회원은 서버 응답을 기다리지 않고 화면부터 즉시 복원합니다.
    memberSession = saved;
    accessGranted = true;
    followGranted = true;
    matchGranted = true;
    adminLoggedIn = false;
    try { sessionStorage.setItem("yeowoobangRole", "member"); } catch (_) {}
    setAdminNavigation(false);
    setMemberHeader(saved.member);
    hideGate();
    showView("homeView");
    restoreFollowListCache();

    void loadAfterAuth();
    void loadMemberFollowProgress();
    window.setTimeout(() => {
      if (memberSession?.token) void loadNotificationsV76();
    }, 1200);

    // V133: 기존 저장 세션 검증은 백그라운드에서 하되,
    // 그 사이 사용자가 새로 로그인했다면 오래된 결과가 새 세션을 지우지 못하게 합니다.
    const validatingTokenV133 = saved.token;
    const validatingGenerationV133 = memberAuthGenerationV133;
    void (async () => {
      try {
        const result = await apiPost("memberSession", { token: validatingTokenV133 }, 9000);
        if (!result?.token || !result?.member) throw new Error("SESSION_EXPIRED");

        if (
          memberAuthGenerationV133 !== validatingGenerationV133 ||
          memberSession?.token !== validatingTokenV133
        ) return;

        memberSession = { token: result.token, member: result.member };
        saveMemberSessionStorage(memberSession);
        setMemberHeader(result.member);
      } catch (_) {
        // 새 로그인/새 세션으로 이미 바뀌었으면 이 오래된 실패는 무시
        if (
          memberAuthGenerationV133 !== validatingGenerationV133 ||
          memberSession?.token !== validatingTokenV133
        ) return;

        memberSession = null;
        clearMemberSessionStorage();
        try { sessionStorage.removeItem(FOLLOW_LIST_CACHE_KEY); } catch (_) {}
        accessGranted = false;
        followGranted = false;
        matchGranted = false;
        showGate();
        setGate("memberLogin");
        $("gateError").textContent = "로그인 시간이 만료되었습니다. 다시 로그인해 주세요.";
      }
    })();
    return;
  }

  setGate("role");
}

function chooseGeneralAccess() {
  // V131: 일반모드는 운영진 인증과 완전히 분리하고, 저장된 회원 세션이 있으면 즉시 복원합니다.
  adminLoggedIn = false;
  adminPasswordValue = "";
  adminModeToken = "";
  adminMemberRole = "";
  adminProfile = null;
  try { sessionStorage.setItem("yeowoobangRole", "member"); } catch (_) {}
  setAdminNavigation(false);
  if ($("gateError")) $("gateError").textContent = "";
  if (publicConfig?.appLocked) {
    setGate("blocked");
    return;
  }

  const saved = memberSession?.token ? memberSession : readMemberSessionStorage();
  if (saved?.token && saved?.member) {
    memberSession = saved;
    accessGranted = true;
    followGranted = true;
    matchGranted = true;
    setMemberHeader(saved.member);
    hideGate();
    showView("homeView");
    restoreFollowListCache();
    void loadAfterAuth();
    void loadMemberFollowProgress();
    return;
  }
  setGate("memberLogin");
}

function chooseAdminAccess() {
  setGate("operatorLogin");
}

// V131: 늦게 도착한 운영진 인증 오류가 일반회원 로그인 화면을 덮어쓰지 못하게 차단합니다.
const gateErrorNodeV131 = $("gateError");
if (gateErrorNodeV131 && window.MutationObserver) {
  new MutationObserver(() => {
    if (gateMode === "memberLogin" && /운영진|관리자/.test(gateErrorNodeV131.textContent || "")) {
      gateErrorNodeV131.textContent = "";
    }
  }).observe(gateErrorNodeV131, { childList: true, characterData: true, subtree: true });
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

  if (!member) {
    badge.classList.add("hidden");
    menu.classList.add("hidden");
    updateAdminModeButton();
    return;
  }

  $("memberBadgeName").textContent = member.nickname || "회원";
  $("memberBadgeId").textContent = member.instagramId ? `@${member.instagramId}` : "";
  badge.classList.remove("hidden");
  menu.classList.toggle("hidden", adminLoggedIn);
  updateAdminModeButton();
}

function setAdminHeader(profile) {
  const badge = $("memberBadge");
  const menu = $("memberMenuBtn");
  if (!badge) return;
  if (!profile) {
    badge.classList.add("hidden");
    menu?.classList.add("hidden");
    updateAdminModeButton();
    return;
  }
  $("memberBadgeName").textContent = `${profile.name || "운영진"} · ${profile.role || "운영진"}`;
  $("memberBadgeId").textContent = profile.instagramId ? `@${profile.instagramId}` : "";
  badge.classList.remove("hidden");
  menu?.classList.add("hidden");
  updateAdminModeButton();
}

async function completeMemberLogin(result, showToast = true) {
  if (!result?.token || !result?.member) throw new Error("로그인 정보를 확인할 수 없습니다.");

  memberAuthGenerationV133++;
  const loginGenerationV133 = memberAuthGenerationV133;
  memberSession = { token: result.token, member: result.member };
  saveMemberSessionStorage(memberSession);
  accessGranted = true;
  followGranted = true;
  matchGranted = true;
  adminLoggedIn = false;
  adminPasswordValue = "";
  adminModeToken = "";
  adminMemberRole = "";
  adminProfile = null;
  try { sessionStorage.setItem("yeowoobangRole", "member"); } catch (_) {}
  setAdminNavigation(false);
  setMemberHeader(result.member);
  hideGate();

  // V118: 메인 화면을 먼저 보여주고, 네트워크 작업은 뒤에서 병렬 처리합니다.
  showView("homeView");
  void loadAfterAuth();
  void loadMemberFollowProgress();
  window.setTimeout(() => {
    if (memberSession?.token) void loadNotificationsV76();
  }, 1200);

  // V133: 로그인 직후 예전 비동기 작업이 게이트를 다시 띄워도 현재 세션이 살아있으면 복구
  window.setTimeout(() => {
    if (
      memberAuthGenerationV133 === loginGenerationV133 &&
      memberSession?.token === result.token
    ) {
      hideGate();
      if (!document.querySelector(".view.active")) showView("homeView");
    }
  }, 700);

  if (showToast) toast(`${result.member.nickname || "회원"}님, 반가워요 🦊`);
}

async function loginMemberFromGate() {
  // V133: 지금부터 시작하는 로그인보다 먼저 출발한 세션 검증은 결과를 무시
  memberAuthGenerationV133++;
  const instagramId = normalize($("memberLoginInstagram")?.value || "");
  const password = $("memberLoginPassword")?.value || "";
  if (!instagramId || !password) {
    $("gateError").textContent = "인스타 아이디와 비밀번호를 입력해 주세요.";
    return;
  }

  const btn = $("memberLoginBtn");
  try {
    btn.disabled = true;
    btn.dataset.originalText = btn.dataset.originalText || btn.textContent || "로그인";
    btn.textContent = "회원 확인 중…";
    $("gateError").textContent = "안전하게 로그인하고 있어요. 잠시만 기다려 주세요.";
    // V107: Supabase가 활성화된 경우 먼저 서버 인증/회원상태를 검증합니다.
    // 검증 후에는 기존 Apps Script 세션도 발급받아 기존 기능을 그대로 유지합니다.
    let result;
    if (window.YW_SUPABASE_AUTH_V107 && await window.YW_SUPABASE_AUTH_V107.enabled()) {
      const supabaseResult = await window.YW_SUPABASE_AUTH_V107.signIn(instagramId, password);
      const sm = supabaseResult.member || {};
      if (String(sm.status || '').toLowerCase() !== 'active') {
        throw new Error('현재 로그인할 수 없는 회원 상태입니다.');
      }
      btn.textContent = "프로그램 여는 중…";
      $("gateError").textContent = "회원 확인 완료 · 프로그램을 여는 중이에요.";
      result = await apiPost("supabaseMemberSessionV114", {
        accessToken: supabaseResult.access_token
      }, 20000);
    } else {
      // 비상용 레거시 폴백. Supabase 설정이 꺼진 경우에만 사용됩니다.
      result = await apiPost("memberLogin", { instagramId, password }, 15000);
    }
    $("memberLoginPassword").value = "";
    await completeMemberLogin(result, true);
  } catch (error) {
    const raw = String(error?.message || "");
    // V154: 로그인 화면에서는 팔로우리스트 회원 존재와 프로그램 계정 존재를 혼동하지 않도록 안내한다.
    // 계정을 만든 적이 없는 회원은 '계정 등록'으로 이동해야 하며, 기존 계정만 비밀번호 찾기를 사용한다.
    if (/비밀번호|password|invalid login|invalid credentials|credentials/i.test(raw)) {
      $("gateError").textContent = "프로그램 계정을 만든 적이 없다면 ‘계정 등록’을 먼저 해주세요. 이미 계정을 만든 회원이라면 비밀번호를 확인하거나 ‘비밀번호를 잊으셨나요?’를 이용해 주세요.";
    } else {
      $("gateError").textContent = raw || "로그인에 실패했습니다.";
    }
  } finally {
    btn.disabled = false;
    if (btn.dataset.originalText) btn.textContent = btn.dataset.originalText;
  }
}



async function adminSimpleLoginFromGate() {
  const instagram = normalize($("adminInstagram")?.value || "");
  const password = String($("adminPassword")?.value || "").trim();
  if (!instagram || !password) {
    $("gateError").textContent = "운영진 인스타 아이디와 공동비밀번호를 입력해 주세요.";
    return;
  }
  const btn = $("adminSimpleLoginBtn");
  try {
    btn.disabled = true;
    btn.textContent = "확인 중...";
    $("gateError").textContent = "";
    const result = await apiPost("adminSimpleLogin", { instagram, password }, 15000);
    if (!result?.ok || !result?.admin) throw new Error(result?.message || "운영진 로그인에 실패했습니다.");
    memberSession = null;
    clearMemberSessionStorage();
    updateFollowWatermarkV104?.();
    await activateAdminMode(result, password);
  } catch (error) {
    if (gateMode === "adminSimple") {
      $("gateError").textContent = error.message || "운영진 로그인에 실패했습니다.";
    }
  } finally {
    btn.disabled = false;
    btn.textContent = "운영진 모드 입장";
  }
}

async function registerNewMemberInviteFromGate() {
  const inviteeName = String($("newMemberNickname")?.value || "").trim();
  const inviteeInstagram = normalize($("newMemberInstagram")?.value || "");
  const inviterName = String($("newMemberInviterNickname")?.value || "").trim();
  const inviterInstagram = normalize($("newMemberInviterInstagram")?.value || "");

  if (!inviteeName || !inviteeInstagram || !inviterName || !inviterInstagram) {
    $("gateError").textContent = "내 정보와 초대한 회원 정보를 모두 입력해 주세요.";
    return;
  }
  if (inviteeInstagram === inviterInstagram) {
    $("gateError").textContent = "본인을 초대자로 등록할 수 없습니다.";
    return;
  }

  const btn = $("newMemberInviteSubmitBtn");
  try {
    btn.disabled = true;
    $("gateError").textContent = "";
    btn.textContent = "등록 확인 중...";

    const result = await apiPost("registerInvite", {
      inviteeName,
      inviteeInstagram,
      inviterName,
      inviterInstagram
    }, 20000);

    btn.textContent = "✅ 등록 완료 · 승인 대기";
    $("gateError").classList.add("new-member-success");
    $("gateError").textContent =
      result?.message ||
      "초대별 등록 요청이 완료되었습니다. 운영진 승인 후 기존회원 계정 등록이 가능합니다.";

    ["newMemberNickname","newMemberInstagram","newMemberInviterNickname","newMemberInviterInstagram"]
      .forEach(id => { const el=$(id); if(el) el.disabled=true; });

  } catch (error) {
    btn.disabled = false;
    btn.textContent = "초대별 등록 요청";
    $("gateError").classList.remove("new-member-success");
    $("gateError").textContent = error.message || "신규회원 등록 요청에 실패했습니다.";
  }
}

function resetNewMemberInviteGate() {
  ["newMemberNickname","newMemberInstagram","newMemberInviterNickname","newMemberInviterInstagram"]
    .forEach(id => { const el=$(id); if(el){ el.value=""; el.disabled=false; } });
  const btn=$("newMemberInviteSubmitBtn");
  if(btn){ btn.disabled=false; btn.textContent="초대별 등록 요청"; }
  $("gateError")?.classList.remove("new-member-success");
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
  if (!/^\d{4,6}$/.test(password)) {
    $("gateError").textContent = "최초 비밀번호는 숫자 4~6자리로 설정해 주세요.";
    return;
  }
  if (password !== confirm) {
    $("gateError").textContent = "비밀번호 확인이 일치하지 않습니다.";
    return;
  }

  const btn = $("memberRegisterBtn");
  try {
    btn.disabled = true;
    btn.textContent = "회원 확인 중...";
    $("gateError").textContent = "";

    // V155: 팔로우리스트 전체를 회원계정 시트에 미리 생성해 둔 과정에서
    // 비밀번호해시/Salt/최초등록일이 비어 있는 placeholder 행이 실제 계정으로 오인되는 문제를 방지합니다.
    // 실제 계정이 있는 회원은 서버에서 그대로 차단하고, 빈 placeholder만 제거한 뒤 최초 가입을 진행합니다.
    btn.textContent = "계정 상태 확인 중...";
    try {
      await apiPost("prepareMemberAccountRegistrationV155", { nickname, instagramId }, 15000);
    } catch (prepareError) {
      const msg = String(prepareError?.message || "");
      if (/알 수 없는|지원하지|unknown|not found|action/i.test(msg)) {
        throw new Error("계정 등록 서버 패치가 아직 적용되지 않았습니다. 운영진에게 문의해 주세요.");
      }
      throw prepareError;
    }

    // 기존 가입 로직은 그대로 사용합니다.
    let result;
    if (window.YW_SUPABASE_AUTH_V107 && await window.YW_SUPABASE_AUTH_V107.enabled()) {
      const supabaseResult = await window.YW_SUPABASE_AUTH_V107.registerExistingMember(
        nickname, instagramId, password
      );
      btn.textContent = "프로그램 연결 중...";
      result = await apiPost("supabaseMemberSessionV114", {
        accessToken: supabaseResult.access_token
      }, 20000);
    } else {
      // Supabase를 의도적으로 끈 경우의 비상용 폴백
      result = await apiPost("registerMemberAccount", { nickname, instagramId, password }, 20000);
    }

    await completeMemberLogin(result, false);
    toast("최초 계정 등록이 완료되었습니다. 🦊");
  } catch (error) {
    $("gateError").textContent = error.message || "계정 등록에 실패했습니다.";
  } finally {
    btn.disabled = false;
    btn.textContent = "최초 계정 만들고 시작하기";
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

async function changeMemberPasswordFromUi() {
  const currentPassword=$("currentMemberPassword")?.value||"";
  const newPassword=$("newMemberPassword")?.value||"";
  const confirm=$("newMemberPasswordConfirm")?.value||"";
  const msg=$("changePasswordMessage");
  if(!currentPassword||!newPassword||!confirm){if(msg)msg.textContent="모든 항목을 입력해 주세요.";return;}
  if(!/^\d{4,6}$/.test(newPassword)){if(msg)msg.textContent="새 비밀번호는 숫자 4~6자리로 설정해 주세요.";return;}
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
  if(!/^\d{4,6}$/.test(newPassword)){$("gateError").textContent="새 비밀번호는 숫자 4~6자리로 설정해 주세요.";return;}
  if(newPassword!==confirm){$("gateError").textContent="새 비밀번호 확인이 일치하지 않습니다.";return;}
  const btn=$("memberForgotBtn");
  try{btn.disabled=true;$("gateError").textContent="프로그램 계정을 만든 적이 없다면 비밀번호 찾기가 아니라 ‘계정 등록’을 이용해 주세요. 기존 계정의 비밀번호 재설정은 운영진에게 문의해 주세요.";return;}
  catch(e){$("gateError").textContent=e.message||"비밀번호 재설정에 실패했습니다.";}
  finally{btn.disabled=false;}
}

function logoutMember() {
  adminProfile = null;
  memberSession = null;
  memberTodayFollowCount = null;
  memberFollowProgressLoaded = false;
  clearMemberSessionStorage();
  try { sessionStorage.removeItem(FOLLOW_LIST_CACHE_KEY); } catch (_) {}
  accessGranted = false;
  matchGranted = false;
  followGranted = false;
  setMemberHeader(null);
  $("notificationBtn")?.classList.add("hidden");
  $("notificationBadge")?.classList.add("hidden");
  showGate();
  setGate("role");
  toast("로그아웃했습니다.");
}

function backToRoleSelect() {
  setGate("role");
}

function openAdminModeModal() {
  if (adminLoggedIn) {
    exitAdminModeToMember();
    return;
  }
  if (memberSession?.member && !memberSession.member.adminEligible) {
    toast("운영진으로 등록된 인스타 아이디가 아닙니다.");
    return;
  }
  if ($("adminModeInstagram")) {
    $("adminModeInstagram").value = memberSession?.member?.instagramId || "";
    $("adminModeInstagram").readOnly = Boolean(memberSession?.member?.instagramId);
  }
  $("adminModePassword").value = "";
  $("adminModeMessage").textContent = "";
  $("adminModeModal").classList.remove("hidden");
  document.body.classList.add("account-modal-open");
  setTimeout(()=>$("adminModePassword")?.focus(),0);
}

function closeAdminModeModal() {
  $("adminModeModal")?.classList.add("hidden");
  if (!document.querySelector('.account-modal:not(.hidden)')) document.body.classList.remove("account-modal-open");
}

async function activateAdminMode(r, password) {
  adminLoggedIn = true;
  adminPasswordValue = password;
  adminModeToken = r.adminModeToken || "";
  adminMemberRole = r.role || r.operator?.role || "운영진";
  adminProfile = r.operator || { instagramId:"", name:"운영진", role:adminMemberRole };
  try { sessionStorage.setItem("yeowoobangRole", "admin"); } catch (_) {}
  accessGranted = true; matchGranted = true; followGranted = true;
  if (r.publicConfig) publicConfig = r.publicConfig;
  setAdminNavigation(true);
  setAdminHeader(adminProfile);
applyFollowLock(); applyMatchLock();
  hideGate();
  await loadAfterAuth();
  showView("adminView");
  showAdminPanel();
  renderRosterAudit();
  await Promise.allSettled([loadAdminDashboardV72(),loadV73OpsStatus(),loadAdminLogs(),loadAdminTaskboxV76()]);
  toast(`${adminProfile.name || "운영진"}님 · ${adminMemberRole} 운영진모드`);
}

async function loginOperatorFromGate() {
  const instagramId = normalize($("operatorInstagram")?.value || "");
  const password = $("operatorPassword")?.value || "";
  if (!instagramId || !password) { $("gateError").textContent = "운영진 인스타 아이디와 공동비밀번호를 입력해 주세요."; return; }
  const btn = $("operatorLoginBtn");
  try {
    btn.disabled = true; $("gateError").textContent = "";
    const r = await apiPost("adminSimpleLogin", { instagram: instagramId, password }, 15000);
    // V131: 운영진모드로 들어가도 기존 일반회원 세션은 지우지 않습니다.
    // 운영진모드 종료 시 바로 일반모드/팔로우리스트로 복귀할 수 있습니다.
    await activateAdminMode(r, password);
    $("operatorPassword").value = "";
  } catch (e) {
    if (gateMode === "operatorLogin") {
      $("gateError").textContent = e.message || "운영진 로그인에 실패했습니다.";
    }
  } finally { btn.disabled = false; }
}

async function enterAdminModeFromMember() {
  const instagramId = normalize($("adminModeInstagram")?.value || memberSession?.member?.instagramId || "");
  const password = $("adminModePassword")?.value || "";
  if (!instagramId || !password) { $("adminModeMessage").textContent = "운영진 인스타 아이디와 공동비밀번호를 입력해 주세요."; return; }
  const btn=$("adminModeConfirmBtn");
  try {
    btn.disabled=true; $("adminModeMessage").textContent="";
    const payload={instagramId,password};
    if(memberSession?.token) payload.token=memberSession.token;
    const r=await apiPost("adminSimpleLogin",{instagram:instagramId,password},15000);
    closeAdminModeModal();
    await activateAdminMode(r,password);
  } catch(e) {
    $("adminModeMessage").textContent=e.message||"운영진모드 전환에 실패했습니다.";
  } finally { btn.disabled=false; }
}

function exitAdminModeToMember() {
  adminLoggedIn=false;
  adminPasswordValue="";
  adminModeToken="";
  adminMemberRole="";
  adminProfile=null;
  setAdminNavigation(false);
$("adminPanel")?.classList.add("hidden");
  $("adminLoginCard")?.classList.add("hidden");

  if (memberSession?.token) {
    try { sessionStorage.setItem("yeowoobangRole","member"); } catch(_){}
    accessGranted=true; matchGranted=true; followGranted=true;
    setMemberHeader(memberSession.member);
  updateFollowWatermarkV104?.();
    applyFollowLock(); applyMatchLock();
    showView("followView");
    toast("일반모드로 돌아왔습니다.");
    return;
  }

  try { sessionStorage.removeItem("yeowoobangRole"); } catch(_){}
  accessGranted=false; matchGranted=false; followGranted=false;
  setAdminHeader(null);
  showGate();
  setGate("role");
  toast("운영진모드를 종료했습니다.");
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
        ? "운영진 공동비밀번호가 올바르지 않습니다."
        : "접속 비밀번호가 올바르지 않습니다.";
  } finally {
    $("gateSubmitBtn").disabled = false;
  }
}

async function loadAfterAuth() {
  const restored = restoreFollowListCache();

  // V183: 로그인 직후에는 홈을 먼저 보여주고 무거운 2707명 명단 요청은 뒤로 미룹니다.
  // 캐시가 있으면 즉시 사용하고, 최신화는 브라우저가 한가할 때만 진행합니다.
  if (restored) {
    V183_SPEED.roomLoadedAt = Date.now();
  }

  idleV183(() => {
    if (memberSession?.token && !freshV183(V183_SPEED.roomLoadedAt, V183_TTL.room)) {
      loadRoomList(false).catch(() => {});
    }
  }, restored ? 3500 : 1800);

  idleV183(() => refreshPublicConfig(false).catch(() => {}), 2200);
  scheduleNoticeLoad(2600);
  checkVersionUpdate();
}
async function refreshPublicConfig(recheck = true, force = false) {
  if (!force && publicConfig && freshV183(V183_SPEED.publicConfigLoadedAt, V183_TTL.publicConfig)) {
    return publicConfig;
  }
  if (V183_SPEED.publicConfigInFlight) return V183_SPEED.publicConfigInFlight;

  V183_SPEED.publicConfigInFlight = (async () => {
    const previousSecurity = securityVersion || publicConfig?.securityVersion || "";
    publicConfig = await apiGet("publicConfig");
    V183_SPEED.publicConfigLoadedAt = Date.now();
  updateLockIndicators();
  syncFollowLockAdminV99?.();
  syncMatchPeriodAdminV101?.();
  applyFollowLock();
  applyMatchLock();
  // V130: 맞팔투표 기능 미사용
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
    return publicConfig;
  })();

  try {
    return await V183_SPEED.publicConfigInFlight;
  } finally {
    V183_SPEED.publicConfigInFlight = null;
  }
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
    const scheduled=Boolean(publicConfig?.matchPeriodScheduled);
    $("matchLockState").textContent = matchLocked
      ? (scheduled ? "예약 대기/종료" : "기간 아님")
      : (scheduled ? "예약 진행중" : "진행중");
    $("matchLockState").className = `lock-state ${matchLocked ? "locked" : "unlocked"}`;
  }

  if ($("followLockState")) {
    $("followLockState").textContent = followLocked ? "잠금 중" : "사용 가능";
    $("followLockState").className = `lock-state ${followLocked ? "locked" : "unlocked"}`;
  }
}

function applyFollowLock() {
  const signedIn=Boolean(memberSession?.token)||adminLoggedIn;
  const locked=Boolean(publicConfig?.followLocked);
  const blocked=signedIn && locked && !adminLoggedIn;

  $("followContent")?.classList.toggle("hidden", !signedIn || blocked);
  $("followLockedCard")?.classList.toggle("hidden", !blocked);

  if(blocked){
    const scheduled=Boolean(publicConfig?.followScheduledLocked);
    $("followLockedMessage").textContent=scheduled
      ?"운영진이 설정한 예약 잠금 시간입니다."
      :"운영진이 팔로우리스트 이용을 잠시 잠갔습니다.";
    const s=publicConfig?.followLockStartAt||"";
    const e=publicConfig?.followLockEndAt||"";
    $("followLockedPeriod").textContent=scheduled && s && e
      ? `${formatFollowLockDateV99(s)} ~ ${formatFollowLockDateV99(e)}`
      :"";
  }
}

function formatFollowLockDateV99(value){
  if(!value)return "";
  const d=new Date(value);
  if(isNaN(d.getTime()))return String(value);
  return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
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
  // 맞팔 확인 투표 기능 제거됨
  updateMatchAnalysisUi();
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

async function submitMatchVote(status) {
  // 맞팔 확인 투표 기능 제거됨
  return;
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

    const no = String(row[0] || "").trim();
    const name = String(row[1] || "").trim();
    const idRaw = String(row[2] || "").trim();
    const id = normalize(idRaw);

    if (!no) return;
    if (String(no) === "1826") {
      list.push({ no, name:name || "챤쥰맘", idRaw:"", id:"", status:"SUSPENDED", statusLabel:"계정정지" });
      return;
    }
    if (!name || !id || !validUsername(id)) return;
    list.push({ no, name, idRaw, id, status:"ACTIVE", statusLabel:"" });
  });
  return list;
}

function rowsToRoom(rows) {
  const list = [];
  rows.forEach((row, index) => {
    const joined = row.join(" ");
    if (index === 0 && (joined.includes("번호") || joined.includes("닉네임") || joined.includes("아이디"))) return;

    const no = String(row[0] || "").trim();
    const name = String(row[1] || "").trim();
    const id = normalize(row[2] || "");

    if (!no) return;
    if (String(no) === "1826") {
      list.push({ no, name: name || "챤쥰맘", id: "", status:"SUSPENDED", statusLabel:"계정정지" });
      return;
    }
    if (!name || !id || !validUsername(id)) return;
    list.push({ no, name, id, status:"ACTIVE", statusLabel:"" });
  });

  const seen = new Set();
  return list.filter((item) => {
    const key=item.status==="SUSPENDED"?`SUSPENDED:${item.no}`:item.id;
    return !seen.has(key) && seen.add(key);
  });
}

async function loadRoomList(show = false, forceV183 = false) {
  const force = Boolean(forceV183 || show);

  if (!force && roomList.length && freshV183(V183_SPEED.roomLoadedAt, V183_TTL.room)) {
    setSheetState("정상");
    updateFollowStats();
    return roomList;
  }

  if (!force && V183_SPEED.roomInFlight) {
    return V183_SPEED.roomInFlight;
  }

  const taskV183 = (async () => {
    setSheetState("불러오는 중");

    if (!memberSession?.token) {
    roomList = [];
    setSheetState("로그인 필요");
    renderGroupTabs();
    renderCopyBatches();
    renderFollowList();
    if (show) toast("회원 로그인 후 팔로우리스트를 이용해주세요.");
    return;
  }

  try {
    const data = await apiPost("getSecureFollowList", { token: memberSession.token }, 20000);
    const apiMembers = Array.isArray(data.members)
      ? data.members
      : (Array.isArray(data.items)
          ? data.items.map(x => ({
              no:x.no,
              name:x.name || x.nickname || "",
              id:x.id || x.instagramId || x.instagram || "",
              status:x.status || "ACTIVE",
              statusLabel:x.statusLabel || ""
            }))
          : []);

    roomList = apiMembers.filter(item => {
      const name=String(item.name||"").trim();
      const id=normalize(item.id||"");
      const status=String(item.status||"ACTIVE");
      if (!name) return false;
      if (status === "SUSPENDED") return true;
      return Boolean(id && validUsername(id));
    }).map((item,index)=>({
      no:item.no || index+1,
      name:String(item.name||"").trim(),
      id:normalize(item.id||""),
      status:String(item.status||"ACTIVE"),
      statusLabel:String(item.statusLabel||"")
    }));

    if (!roomList.length) throw new Error("팔로우리스트를 불러오지 못했습니다.");

    saveFollowListCache(roomList);
    V183_SPEED.roomLoadedAt = Date.now();

    // 맞팔분석 기준 명단도 같은 최신 회원명단으로 즉시 동기화
    matchRoomList = roomList.map(item => {
      const id = normalize(item.id || "");
      const available = Boolean(id && validUsername(id));
      return {
        no: item.no,
        name: item.name,
        id: available ? id : "",
        statusSource: String(item.status || ""),
        statusLabelSource: String(item.statusLabel || ""),
        matchAvailable: available
      };
    });
    if ($("roomState") && matchRoomList.length) $("roomState").textContent = `${matchRoomList.length}명`;

    setSheetState("정상");
    updateFollowStats();
    renderGroupTabs();
    renderCopyBatches();
    renderFollowList();
    renderResumeCard();
    updateFollowWatermarkV104();
    if (adminLoggedIn) renderRosterAudit();
    if (show) toast("명단 새로고침 완료");
  } catch (error) {
    // V118: 이미 로그인 후 캐시 명단을 표시 중이면 0명으로 덮어쓰지 않습니다.
    if (roomList.length) {
      setSheetState("기존 명단 표시 · 새로고침 실패");
      if (show) toast(error.message || "최신 명단 확인이 늦어 기존 명단을 표시합니다.");
      return;
    }
    roomList=[];
    setSheetState("접근 제한");
    renderGroupTabs();
    renderCopyBatches();
    renderFollowList();
    toast(error.message || "팔로우리스트를 불러오지 못했습니다.");
  }
  return roomList;
  })();

  if (!force) V183_SPEED.roomInFlight = taskV183;
  try {
    return await taskV183;
  } finally {
    if (!force && V183_SPEED.roomInFlight === taskV183) {
      V183_SPEED.roomInFlight = null;
    }
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
    if (memberSession?.token) {
      apiPost("logFollowUsage", {
        token: memberSession.token,
        eventType: "COPY_40",
        detail: `${firstNo}~${lastNo} · ${batch.length}명`
      }, 8000).catch(() => {});
    }
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
async function publishInvitePriorityV110(){if(!inviteAdminLoggedIn)return toast("초대관리 관리자 인증이 필요합니다.");if(!confirm("이번 달 초대 실적을 기준으로 앞번호를 확정 반영할까요?\n\n• 10명 이상만 대상\n• 초대 많은 순으로 31번부터\n• 현재 1~30번 회원은 이동하지 않음\n\n월 초대 마감/발표 시에만 실행해주세요."))return;const b=$("publishInvitePriorityBtn"),m=$("publishInvitePriorityMsg");if(b)b.disabled=true;if(m)m.textContent="반영 중...";try{const d=await apiPost("publishInvitePriorityV110",{inviteAdminPassword:inviteAdminPasswordValue},30000);const moved=(d.items||[]).length,fixed=(d.fixedItems||[]).length;if(m)m.textContent=`반영 완료 · 31번부터 ${moved}명 배치${fixed?` · 기존 1~30번 ${fixed}명 유지`:""}`;toast("이번 달 앞번호 발표 반영이 완료됐습니다.");await Promise.allSettled([loadInviteSummary(),loadRoomList(true)]);}catch(e){if(m)m.textContent=e.message||"반영 실패";toast(e.message||"반영하지 못했습니다.");}finally{if(b)b.disabled=false;}}
async function loadInviteSummary(){if(!inviteAdminLoggedIn)return;const d=await apiPost("getInviteSummary",{inviteAdminPassword:inviteAdminPasswordValue}),a=d.items||[];$("inviteSummaryList").innerHTML=a.length?a.map((x,i)=>`<div class="invite-summary-wrap"><button class="invite-summary-row invite-summary-button" type="button" data-admin-invite-detail="${i}"><span class="numNick"><span class="badgeNo">${escapeHtml(String(x.no||""))}</span>${escapeHtml(x.nickname||"")}</span><span>${x.invite||0}</span><span>${x.previous||0}</span><span class="total">${x.total||0} ▾</span></button><div id="adminInviteDetail${i}" class="invite-summary-detail hidden">${(x.invitees||[]).length?x.invitees.map(n=>`<span>${escapeHtml(n)}</span>`).join(""):'<p class="state-text">기록된 초대 회원 닉네임이 없습니다.</p>'}</div></div>`).join(""):'<p class="state-text">회원 데이터가 없습니다.</p>';$("inviteSummaryList").querySelectorAll("[data-admin-invite-detail]").forEach(b=>b.onclick=()=>$("adminInviteDetail"+b.dataset.adminInviteDetail)?.classList.toggle("hidden"));}

let inviteRankModeV92="monthly";
let inviteRankDataV92=[];

function currentInviteMonthLabelV92(){
  const d=new Date();
  return `${d.getMonth()+1}월`;
}

function rankInviteItemsV92(items,mode){
  const key=mode==="monthly"?"invite":"total";
  return [...items]
    .map(x=>({...x,score:Number(x[key]||0)}))
    .filter(x=>x.nickname||x.instagram)
    .sort((a,b)=>{
      if(b.score!==a.score)return b.score-a.score;
      if(Number(b.total||0)!==Number(a.total||0))return Number(b.total||0)-Number(a.total||0);
      return String(a.nickname||"").localeCompare(String(b.nickname||""),"ko");
    })
    .map((x,i)=>({...x,rank:i+1}));
}

function renderInviteRankV92(){
  const top3=$("inviteTop3"), list=$("inviteRankList");
  if(!top3||!list)return;

  const medal=rank=>rank===1?"🥇":rank===2?"🥈":rank===3?"🥉":`#${rank}`;
  const mode=inviteRankModeV92;
  const label=mode==="monthly"?`${currentInviteMonthLabelV92()} 초대`:"총누적";
  const ranked=rankInviteItemsV92(inviteRankDataV92,mode);
  const active=ranked.filter(x=>x.score>0);
  const top10=active.slice(0,10);
  const podium=top10.slice(0,3);
  const rest=top10.slice(3);

  $("inviteRankSummaryLabel").textContent=`${label} 랭킹`;
  $("inviteRankSummaryCount").textContent=active.length?`1위 ${active[0].score}명`:"0명";

  $("inviteMonthlyTab")?.classList.toggle("active",mode==="monthly");
  $("inviteTotalTab")?.classList.toggle("active",mode==="total");

  if(!active.length){
    top3.innerHTML=`<p class="state-text">아직 ${label} 실적이 없습니다. 첫 번째 랭커가 되어보세요! 🎮</p>`;
    list.innerHTML="";
  }else{
    top3.innerHTML=podium.map(x=>`
      <button class="invite-podium rank-${x.rank}" type="button" data-rank-id="${escapeHtml(String(x.instagram||x.nickname||""))}">
        <span class="podium-medal">${medal(x.rank)}</span>
        <b>${escapeHtml(x.nickname||"")}</b>
        <strong>${x.score}명</strong>
        <small>${x.rank}위</small>
      </button>`).join("");

    list.innerHTML=rest.map(x=>`
      <button class="invite-game-rank-row" type="button" data-rank-id="${escapeHtml(String(x.instagram||x.nickname||""))}">
        <span class="game-rank-no">${x.rank}</span>
        <span class="game-rank-name">
          <b>${escapeHtml(x.nickname||"")}</b>
          <small>${x.instagram?`@${escapeHtml(normalize(x.instagram))}`:""}</small>
        </span>
        <strong>${x.score}명</strong>
        <span class="rank-chevron">›</span>
      </button>`).join("");
  }

  const host=$("inviteLeaderboardDetailHost");
  const openDetail=(id)=>{
    const x=inviteRankDataV92.find(v=>String(v.instagram||v.nickname||"")===String(id));
    if(!x||!host)return;
    const monthRank=rankInviteItemsV92(inviteRankDataV92,"monthly").find(v=>String(v.instagram||v.nickname||"")===String(id));
    const totalRank=rankInviteItemsV92(inviteRankDataV92,"total").find(v=>String(v.instagram||v.nickname||"")===String(id));
    const chips=(x.invitees||[]).length
      ? `<div class="invitee-chip-list">${x.invitees.map(n=>`<span>${escapeHtml(n)}</span>`).join("")}</div>`
      : '<p class="state-text">현재 프로그램에 기록된 초대 회원 닉네임이 없습니다.</p>';

    host.innerHTML=`
      <div class="invite-rank-detail">
        <div class="invite-rank-detail-head">
          <div>
            <b>${escapeHtml(x.nickname||"")}</b>
            <span>📅 이번달 ${Number(x.invite||0)}명 · ${monthRank?.rank||"-"}위</span>
            <span>🏆 총누적 ${Number(x.total||0)}명 · ${totalRank?.rank||"-"}위</span>
          </div>
          <button id="closeInviteRankDetail" class="outline small" type="button">닫기</button>
        </div>
        ${chips}
        ${Number(x.previous||0)>0?`<p class="state-text">이전 누적 ${Number(x.previous||0)}명은 기존 집계값으로, 개별 닉네임 기록이 없을 수 있어요.</p>`:""}
      </div>`;
    $("closeInviteRankDetail").onclick=()=>{host.innerHTML="";};
    host.scrollIntoView({behavior:"smooth",block:"nearest"});
  };

  top3.querySelectorAll("[data-rank-id]").forEach(b=>b.onclick=()=>openDetail(b.dataset.rankId));
  list.querySelectorAll("[data-rank-id]").forEach(b=>b.onclick=()=>openDetail(b.dataset.rankId));
}


function renderInviteBenefitTargetsV176(){
  const label=$("inviteBenefitMonthLabel");
  if(label) label.textContent=currentInviteMonthLabelV92();

  const mine=normalize(memberSession?.member?.instagramId||"");
  const groups={10:[],20:[],40:[]};

  [...inviteRankDataV92].forEach(x=>{
    const invite=Math.max(0,Number(x.invite||0));
    const previous=Math.max(0,Number(x.previous||0));

    // 이번 달 달성한 가장 높은 단계 하나만 선택
    let tier=0;
    if(invite>=40) tier=40;
    else if(invite>=20) tier=20;
    else if(invite>=10) tier=10;

    if(!tier) return;

    // 이전에 이미 같은 단계 이상 혜택을 달성했다면 이번 달 대상에서 제외
    if(previous>=tier) return;

    groups[tier].push(x);
  });

  const render=(tier,id)=>{
    const el=$(id);
    if(!el)return;

    const items=groups[tier]
      .slice()
      .sort((a,b)=>{
        const ai=Number(a.invite||0), bi=Number(b.invite||0);
        if(bi!==ai)return bi-ai;
        return String(a.nickname||"").localeCompare(String(b.nickname||""),"ko");
      });

    if(!items.length){
      el.textContent="아직 대상자가 없어요.";
      return;
    }

    el.innerHTML=items.map(x=>{
      const instagram=normalize(x.instagram||x.instagramId||"");
      const nickname=String(x.nickname||"회원").trim()||"회원";
      const isMe=mine&&instagram===mine;
      return `<span class="benefit-person ${isMe?'me':''}">`+
        `${escapeHtml(nickname)} ${Number(x.invite||0)}명`+
        `${isMe?' · 나':''}`+
      `</span>`;
    }).join("");
  };

  render(10,"inviteBenefit10");
  render(20,"inviteBenefit20");
  render(40,"inviteBenefit40");
}

async function loadInviteLeaderboard(forceV183 = false){
  const top3=$("inviteTop3"), list=$("inviteRankList");
  if(!top3||!list)return;

  if (!forceV183 && inviteRankDataV92.length && freshV183(V183_SPEED.inviteLoadedAt, V183_TTL.invite)) {
    renderInviteRankV92();
    renderInviteBenefitTargetsV176();
    return;
  }

  if (!forceV183 && V183_SPEED.inviteInFlight) return V183_SPEED.inviteInFlight;

  const taskV183 = (async () => {
  try{
    $("inviteMonthlyLabel").textContent=currentInviteMonthLabelV92();
    const d=await apiGet("getInviteLeaderboard",30000);
    V183_SPEED.inviteLoadedAt = Date.now();
    inviteRankDataV92=(d.items||[]).map(x=>({
      ...x,
      invite:Number(x.invite||0),
      previous:Number(x.previous||0),
      total:Number(x.total||0)
    }));

    renderInviteRankV92();

    const memberId=normalize(memberSession?.member?.instagramId||"");
    const memberNick=String(memberSession?.member?.nickname||"").trim();
    const mine=inviteRankDataV92.find(x=>
      (memberId && normalize(x.instagram)===memberId) ||
      (!memberId && memberNick && String(x.nickname||"").trim()===memberNick)
    );

    const monthlyRank=mine?rankInviteItemsV92(inviteRankDataV92,"monthly").find(x=>String(x.instagram||x.nickname||"")===String(mine.instagram||mine.nickname||"")):null;
    const totalRank=mine?rankInviteItemsV92(inviteRankDataV92,"total").find(x=>String(x.instagram||x.nickname||"")===String(mine.instagram||mine.nickname||"")):null;

    if(mine){
      $("inviteMyMonthlyRankText").textContent=`${monthlyRank?.rank||"-"}위 · ${Number(mine.invite||0)}명`;
      $("inviteMyTotalRankText").textContent=`${totalRank?.rank||"-"}위 · ${Number(mine.total||0)}명`;
      $("inviteMyRankSub").textContent=
        (monthlyRank?.rank<=10||totalRank?.rank<=10)
          ?"TOP 10에 올라와 있어요! 🔥"
          :"TOP 10까지 조금만 더 힘내요!";
      updateInviteMission(Number(mine.total||0));
      renderInviteBenefitTargetsV176();
    }else{
      $("inviteMyMonthlyRankText").textContent=memberSession?.token?"아직 실적 없음":"로그인 후 확인";
      $("inviteMyTotalRankText").textContent=memberSession?.token?"아직 실적 없음":"로그인 후 확인";
      $("inviteMyRankSub").textContent=memberSession?.token?"첫 초대를 달성하면 순위가 표시됩니다.":"회원 로그인 계정 기준으로 표시됩니다.";
      updateInviteMission(0);
      renderInviteBenefitTargetsV176();
    }

  }catch(e){
    top3.innerHTML='<p class="state-text">초대 랭킹을 불러오지 못했습니다.</p>';
    list.innerHTML=`<div class="invite-rank-error"><b>데이터 연결을 확인해주세요.</b><span>${escapeHtml(e.message||"")}</span></div>`;
    if($("inviteMyMonthlyRankText"))$("inviteMyMonthlyRankText").textContent="확인 불가";
    if($("inviteMyTotalRankText"))$("inviteMyTotalRankText").textContent="확인 불가";
    updateInviteMission(0);
  }
  })();

  if (!forceV183) V183_SPEED.inviteInFlight = taskV183;
  try {
    return await taskV183;
  } finally {
    if (!forceV183 && V183_SPEED.inviteInFlight === taskV183) {
      V183_SPEED.inviteInFlight = null;
    }
  }
}

function updateInviteMission(total){
  const count=Math.max(0,Number(total||0));
  const milestones=[10,20,40];
  let next=milestones.find(n=>count<n);
  const prev=next===10?0:next===20?10:next===40?20:40;
  const max=next||40;
  let pct;

  if(!next){
    pct=100;
    $("inviteNextBenefitText").textContent="최고 단계 40명 혜택을 달성했어요! 🏆";
    $("inviteProgressNumbers").textContent=`${count}명 달성`;
  }else{
    pct=Math.max(0,Math.min(100,((count-prev)/(next-prev))*100));
    $("inviteNextBenefitText").textContent=`${next}명 달성까지 ${next-count}명 남았어요!`;
    $("inviteProgressNumbers").textContent=`${count} / ${next}명`;
  }

  $("inviteMissionCount").textContent=`${count}명`;
  $("inviteProgressBar").style.width=`${pct}%`;

  document.querySelectorAll(".invite-milestones article").forEach(card=>{
    const target=Number(card.dataset.milestone||0);
    card.classList.toggle("done",count>=target);
    card.classList.toggle("next",next===target);
  });
}

async function changeInviteStatus(id,status,reason=""){try{await apiPost("updateInviteStatus",{inviteAdminPassword:inviteAdminPasswordValue,id,status,reason});toast(status==="APPROVED"?"초대 승인 및 자동 반영 완료":status==="CANCELLED"?"승인 취소 완료 · 팔로우리스트와 초대 실적을 되돌렸어요.":"초대 거절 완료");await Promise.allSettled([loadInviteAdmin(),loadInviteSummary(),loadRoomList(true)])}catch(e){toast(e.message||"처리하지 못했습니다.")}}
async function cancelInviteApproval(id,name){if(!confirm(`${name||"해당 회원"}의 승인을 취소할까요?\n\n팔로우리스트에서 삭제되고, 초대 실적과 누적도 1명 차감됩니다.`))return;const reason=prompt("승인 취소 사유를 입력해주세요.","7일 이내 퇴장");if(reason===null)return;await changeInviteStatus(id,"CANCELLED",reason.trim()||"7일 이내 퇴장")}





function isOperatorMode_() {
  // 운영진 로그인 상태를 한 가지 변수에만 의존하지 않도록 보강합니다.
  // 일부 로그인 경로에서는 하단 운영진 메뉴가 먼저 활성화될 수 있습니다.
  const adminNavVisible = !!$("adminNavBtn") && !$("adminNavBtn").classList.contains("hidden");
  let savedRole = "";
  try { savedRole = sessionStorage.getItem("yeowoobangRole") || ""; } catch (_) {}
  return Boolean(adminLoggedIn || adminPasswordValue || adminNavVisible || savedRole === "admin");
}

function showView(id) {
  if (id === "myPageView") {
    setTimeout(() => loadUnifiedMyInfoV142().catch(() => {}), 0);
  }
  if (id === "homeView" && $("homeMemberName")) {
    $("homeMemberName").textContent = memberSession?.member?.nickname || adminProfile?.name || "회원";
  }
  document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === id));
  document.querySelectorAll(".nav-btn").forEach((button) => button.classList.toggle("active", button.dataset.view === id));

  if (id === "followView") {
    applyFollowLock();
    if (memberSession?.token && (!roomList.length || !freshV183(V183_SPEED.roomLoadedAt, V183_TTL.room))) {
      loadRoomList(false).catch(() => {});
    }
  }

  if (id === "matchView") {
    applyMatchLock();
    prefillMatchRequestIdentity();
    loadMatchRequestConfig().catch(()=>{});
    const canAnalyze = isMatchPeriodOpen() && (Boolean(memberSession?.token) || adminLoggedIn);
    if (canAnalyze) {
      loadMatchRoomList(false, false).catch(() => {});
    }
  }

  if (id === "inviteView") loadInviteLeaderboard().catch(()=>{});
  window.scrollTo({ top: 0, behavior: "smooth" });
}


async function loadMatchRoomList(showToast = false, force = false) {
  const roomState = $("roomState");

  try {
    if (roomState) roomState.textContent = "불러오는 중";

    // 맞팔분석 기준 명단은 회원에게 허용된 현재 팔로우리스트와 동일하게 사용합니다.
    // 명단이 아직 없거나 강제 새로고침이면 서버에서 먼저 최신 팔로우리스트를 불러옵니다.
    if (force || !roomList.length) {
      await loadRoomList(Boolean(showToast && force));
    }

    if (!roomList.length) {
      throw new Error("단톡방 명단을 불러오지 못했습니다.");
    }

    matchRoomList = roomList.map(item => {
      const id = normalize(item?.id || "");
      const available = Boolean(id && validUsername(id));
      return {
        no: item.no,
        name: String(item.name || "").trim(),
        id: available ? id : "",
        statusSource: String(item.status || ""),
        statusLabelSource: String(item.statusLabel || ""),
        matchAvailable: available
      };
    });

    if (!matchRoomList.length) {
      throw new Error("맞팔분석에 사용할 회원 명단이 없습니다.");
    }

    if (roomState) roomState.textContent = `${matchRoomList.length}명`;
    if ($("status")) {
      $("status").textContent = `단톡방 명단 ${matchRoomList.length}명 불러오기 완료 · 인스타그램 ZIP 파일을 선택해 주세요.`;
    }
    if (showToast) toast(`단톡방 명단 ${matchRoomList.length}명 불러오기 완료`);
    return matchRoomList;
  } catch (error) {
    matchRoomList = [];
    if (roomState) roomState.textContent = "불러오기 실패";
    if ($("status")) $("status").textContent = `명단 오류: ${error.message || "불러오지 못했습니다."}`;
    if (showToast) toast(error.message || "단톡방 명단을 불러오지 못했습니다.");
    throw error;
  }
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

  const all = baseList.map((person) => {
    const id = normalize(person.id || "");
    const available = Boolean(person.matchAvailable !== false && id && validUsername(id));

    if (!available) {
      return {
        ...person,
        id: "",
        matchAvailable: false,
        status: "unavailable"
      };
    }

    return {
      ...person,
      id,
      matchAvailable: true,
      status:
        followerSet.has(id) && followingSet.has(id) ? "mutual" :
        !followerSet.has(id) && followingSet.has(id) ? "onlyMe" :
        followerSet.has(id) && !followingSet.has(id) ? "fansOnly" :
        "neither",
    };
  });

  result = {
    all,
    mutual: all.filter((item) => item.status === "mutual"),
    onlyMe: all.filter((item) => item.status === "onlyMe"),
    fansOnly: all.filter((item) => item.status === "fansOnly"),
    neither: all.filter((item) => item.status === "neither"),
    unavailable: all.filter((item) => item.status === "unavailable"),
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
    {
      const unavailableCount = Array.isArray(result.unavailable) ? result.unavailable.length : 0;
      $("status").textContent = `분석 완료 · 맞팔확인용 명단 ${matchRoomList.length}명 기준` +
        (unavailableCount ? ` · 확인불가 ${unavailableCount}명` : "");
    }
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
  const unavailableCount = Array.isArray(result.unavailable) ? result.unavailable.length : 0;
  const analyzableTotal = Math.max(0, total - unavailableCount);

  for (const key of ["mutual", "onlyMe", "fansOnly", "neither"]) {
    $(`${key}Count`).textContent = `${result[key].length}명`;
    $(`${key}Rate`).textContent = percent(result[key].length, analyzableTotal);
    $(`tab${key[0].toUpperCase() + key.slice(1)}`).textContent = result[key].length;
  }
  $("tabAll").textContent = total;
  $("rateText").innerHTML =
    `단톡방 맞팔률 <strong>${percent(result.mutual.length, analyzableTotal)}</strong> · ` +
    `${result.mutual.length}/${analyzableTotal}명` +
    (unavailableCount ? ` · 확인불가 ${unavailableCount}명` : "");
}

function statusLabel(status) {
  return {
    mutual: "맞팔 완료",
    onlyMe: "나만 팔로우 함",
    fansOnly: "상대만 팔로우 함",
    neither: "서로 팔로우 안 함",
    unavailable: "확인불가",
  }[status] || "확인불가";
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
    ? items.filter((item) => String(item.id || "").includes(normalize(query)) || String(item.name || "").toLowerCase().includes(query))
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
          ${item.status === "unavailable"
            ? `<span class="id">${escapeHtml(item.statusLabelSource || "아이디 없음/계정정지")}</span>`
            : `<a class="id" href="https://www.instagram.com/${encodeURIComponent(item.id)}/" target="_blank" rel="noopener">@${escapeHtml(item.id)}</a>`}
        </div>
        <span class="badge ${item.status}">${statusLabel(item.status)}</span>
        <div class="match-item-actions">
          ${item.status === "unavailable"
            ? `<span class="muted">분석 제외</span>`
            : `<a class="insta" href="https://www.instagram.com/${encodeURIComponent(item.id)}/" target="_blank" rel="noopener" aria-label="인스타그램 열기">↗ 열기</a>
               ${item.status === "mutual" ? "" : `<button class="match-request-send-btn" type="button" data-match-request-to="${escapeHtml(item.id)}" ${matchRequestPeriod.active ? "" : "disabled"}>맞팔 요청</button>`}`}
        </div>
      </div>`).join("")
    : '<div class="empty-state">결과가 없습니다.</div>';
  document.querySelectorAll("[data-match-request-to]").forEach((button) => {
    button.onclick = () => beginMatchRequest(button.dataset.matchRequestTo);
  });
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


function matchRequestDateText(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString("ko-KR", { month:"numeric", day:"numeric", hour:"2-digit", minute:"2-digit" });
}
async function loadMatchRequestConfig(forceV183 = false) {
  if (!forceV183 && freshV183(V183_SPEED.matchRequestConfigLoadedAt, V183_TTL.matchRequestConfig)) {
    return matchRequestPeriod;
  }
  if (!forceV183 && V183_SPEED.matchRequestConfigInFlight) {
    return V183_SPEED.matchRequestConfigInFlight;
  }

  const taskV183 = (async () => {
  try {
    const data=await apiGet("getMatchRequestConfig",8000);
    matchRequestPeriod=data.period||{active:false,startAt:"",endAt:""};
    V183_SPEED.matchRequestConfigLoadedAt = Date.now();
  } catch (_) { matchRequestPeriod={active:false,startAt:"",endAt:""}; }
  const badge=$("matchRequestPeriodBadge");
  if(badge){badge.textContent=matchRequestPeriod.active?"요청 가능":"기간 아님";badge.className=`lock-state ${matchRequestPeriod.active?"unlocked":"locked"}`;}
  if($("matchRequestAdminBadge")){ $("matchRequestAdminBadge").textContent=matchRequestPeriod.active?"진행중":"기간 아님"; $("matchRequestAdminBadge").className=`lock-state ${matchRequestPeriod.active?"unlocked":"locked"}`; }
  const text=$("matchRequestPeriodText");
  if(text) text.textContent=matchRequestPeriod.startAt&&matchRequestPeriod.endAt?`${matchRequestDateText(matchRequestPeriod.startAt)} ~ ${matchRequestDateText(matchRequestPeriod.endAt)} · ${matchRequestPeriod.active?"현재 요청 가능":"현재 요청 불가"}`:"운영진이 맞팔 요청 기간을 설정하면 요청 기능이 열립니다.";
  if($("matchRequestStartAt")) $("matchRequestStartAt").value=matchRequestPeriod.startAt?new Date(matchRequestPeriod.startAt).toISOString().slice(0,16):"";
  if($("matchRequestEndAt")) $("matchRequestEndAt").value=matchRequestPeriod.endAt?new Date(matchRequestPeriod.endAt).toISOString().slice(0,16):"";
  if(result.all.length) renderMatchList();
  return matchRequestPeriod;
  })();

  if (!forceV183) V183_SPEED.matchRequestConfigInFlight = taskV183;
  try {
    return await taskV183;
  } finally {
    if (!forceV183 && V183_SPEED.matchRequestConfigInFlight === taskV183) {
      V183_SPEED.matchRequestConfigInFlight = null;
    }
  }
}

/* =========================================================
   V181 - 맞팔 요청 로그인 회원 ID 자동 인식
   일부 세션은 instagramId 대신 instagram_username 등의 키를 쓸 수 있어
   여러 키를 모두 확인하고, 맞팔 요청 버튼 클릭 시 자동 검증합니다.
   ========================================================= */
function currentMemberInstagramV181(){
  const m = memberSession?.member || {};
  return normalize(
    m.instagramId ||
    m.instagram_username ||
    m.instagram ||
    m.username ||
    ""
  );
}

async function ensureMatchRequestIdentityV181(target=""){
  if(matchRequestIdentity) return true;

  const sessionId = currentMemberInstagramV181();
  if(!sessionId) return false;

  try{
    const data = await apiPost(
      "verifyMatchRequestIdentity",
      { instagramId: sessionId },
      10000
    );

    matchRequestIdentity = normalize(
      data?.member?.instagramId ||
      data?.member?.instagram_username ||
      sessionId
    );
    matchRequestIdentityName = String(
      data?.member?.nickname ||
      memberSession?.member?.nickname ||
      ""
    );

    if($("matchRequestMyInstagram")){
      $("matchRequestMyInstagram").value = `@${matchRequestIdentity}`;
    }

    $("matchRequestIdentityBox")?.classList.add("hidden");
    $("matchRequestVerifiedBox")?.classList.remove("hidden");

    if($("matchRequestVerifiedText")){
      $("matchRequestVerifiedText").textContent =
        `${matchRequestIdentityName || "회원"} · @${matchRequestIdentity}`;
    }

    await loadMatchRequests();
    renderMatchList();

    if(target){
      await sendMatchRequest(target);
    }
    return true;
  }catch(e){
    console.warn("V181 맞팔 요청 회원 ID 자동 확인 실패", e);
    return false;
  }
}

function prefillMatchRequestIdentity() {
  if(matchRequestIdentity) return;
  const id=currentMemberInstagramV181();
  if(id && $("matchRequestMyInstagram")) $("matchRequestMyInstagram").value=`@${id}`;
}
async function verifyMatchRequestIdentity() {
  const input=normalize(currentMemberInstagramV181()||$("matchRequestMyInstagram")?.value||"");
  if(!input) return toast("내 인스타 아이디를 입력해주세요.");
  try{
    const data=await apiPost("verifyMatchRequestIdentity",{instagramId:input},10000);
    matchRequestIdentity=normalize(data.member?.instagramId||data.member?.instagram_username||input);
    matchRequestIdentityName=String(data.member?.nickname||"");
    $("matchRequestIdentityBox")?.classList.add("hidden");
    $("matchRequestVerifiedBox")?.classList.remove("hidden");
    if($("matchRequestVerifiedText")) $("matchRequestVerifiedText").textContent=`${matchRequestIdentityName||"회원"} · @${matchRequestIdentity}`;
    await loadMatchRequests();
    renderMatchList();
    if(pendingMatchRequestTarget){const target=pendingMatchRequestTarget;pendingMatchRequestTarget="";await sendMatchRequest(target);}
  }catch(e){if($("matchRequestIdentityMsg"))$("matchRequestIdentityMsg").textContent=e.message||"아이디를 확인하지 못했습니다.";toast(e.message||"아이디 확인 실패");}
}
function changeMatchRequestIdentity(){matchRequestIdentity="";matchRequestIdentityName="";$("matchRequestIdentityBox")?.classList.remove("hidden");$("matchRequestVerifiedBox")?.classList.add("hidden");if($("matchRequestList"))$("matchRequestList").innerHTML='<p class="state-text">내 아이디를 확인하면 요청 내역이 표시됩니다.</p>';prefillMatchRequestIdentity();renderMatchList();}
async function beginMatchRequest(target){
  if(!matchRequestPeriod.active)return toast("현재는 맞팔 요청 가능 기간이 아닙니다.");

  target=normalize(target);
  if(!target)return;

  if(matchRequestIdentity){
    return void sendMatchRequest(target);
  }

  // 로그인된 회원 ID가 있으면 별도 '내 아이디 확인' 단계 없이 자동 확인 후 요청
  const sessionId=currentMemberInstagramV181();
  if(sessionId){
    const ok=await ensureMatchRequestIdentityV181(target);
    if(ok)return;
  }

  // 정말 ID가 없는 경우에만 수동 확인 영역 안내
  pendingMatchRequestTarget=target;
  prefillMatchRequestIdentity();
  $("matchRequestSection")?.scrollIntoView({behavior:"smooth",block:"start"});
  $("matchRequestMyInstagram")?.focus();
  toast("로그인 회원의 인스타 아이디를 확인할 수 없습니다. 내 아이디를 확인해주세요.");
}
async function sendMatchRequest(target){
  target=normalize(target);
  const from=normalize(matchRequestIdentity||currentMemberInstagramV181());

  if(!target)return;
  if(!from)return toast("로그인 회원의 인스타 아이디를 확인할 수 없습니다.");
  if(target===from)return toast("본인에게는 요청할 수 없습니다.");
  if(!confirm(`@${target}님에게 맞팔 확인 요청을 보낼까요?`))return;

  try{
    const data=await apiPost("sendMatchRequest",{
      from,
      to:target,
      // V188 이전 서버와도 호환
      instagramId:from,
      targetInstagram:target,
      fromInstagram:from,
      toInstagram:target
    },10000);
    toast(data.message||"맞팔 요청을 보냈습니다.");
    await loadMatchRequests();
  }catch(e){
    toast(e.message||"맞팔 요청을 보내지 못했습니다.");
  }
}
async function loadMatchRequests(){
  if(!matchRequestIdentity)return;
  try{
    const data=await apiPost("getMatchRequests",{instagramId:matchRequestIdentity,instagram:matchRequestIdentity},10000);
    const normalizeItemV188=x=>({
      ...x,
      fromInstagram:normalize(x.fromInstagram||x.from||""),
      toInstagram:normalize(x.toInstagram||x.to||""),
      fromName:String(x.fromName||x.senderName||""),
      toName:String(x.toName||x.targetName||"")
    });
    matchRequestData={
      received:(data.received||[]).map(normalizeItemV188),
      sent:(data.sent||[]).map(normalizeItemV188)
    };
    if($("receivedRequestCount"))$("receivedRequestCount").textContent=matchRequestData.received.filter(x=>x.status!=="READ").length;
    if($("sentRequestCount"))$("sentRequestCount").textContent=matchRequestData.sent.length;
    renderMatchRequestList();
  }
  catch(e){if($("matchRequestList"))$("matchRequestList").innerHTML=`<p class="state-text">${escapeHtml(e.message||"요청 내역을 불러오지 못했습니다.")}</p>`;}
}
function showMatchRequestTab(tab){matchRequestTab=tab;document.querySelectorAll(".match-request-tab").forEach(b=>b.classList.toggle("active",b.dataset.requestTab===tab));renderMatchRequestList();}
function renderMatchRequestList(){
  const box=$("matchRequestList");if(!box)return;
  const items=matchRequestData[matchRequestTab]||[];
  box.innerHTML=items.length?items.map(x=>{
    const received=matchRequestTab==="received";const read=x.status==="READ"||!!x.readAt;
    return `<div class="match-request-row"><div><strong>${received?`${escapeHtml(x.fromName||"")} · @${escapeHtml(x.fromInstagram||"")}`:`${escapeHtml(x.toName||"")} · @${escapeHtml(x.toInstagram||"")}`}</strong><span>${received?`요청 ${escapeHtml(x.createdAt||"")}`:(read?`확인함 · ${escapeHtml(x.readAt||"")}`:"확인 전")}</span></div>${received?`<div class="match-request-row-actions"><a class="insta" href="https://www.instagram.com/${encodeURIComponent(x.fromInstagram)}/" target="_blank" rel="noopener">↗ 열기</a>${read?'<span class="request-read-label">확인함</span>':`<button class="outline small" data-read-request="${escapeHtml(x.id)}" type="button">확인하기</button>`}</div>`:`<span class="request-status ${read?"read":"unread"}">${read?"확인함":"확인 전"}</span>`}</div>`;
  }).join(""):'<p class="state-text">표시할 맞팔 요청이 없습니다.</p>';
  box.querySelectorAll("[data-read-request]").forEach(b=>b.onclick=()=>markMatchRequestRead(b.dataset.readRequest));
}
async function markMatchRequestRead(id){try{await apiPost("markMatchRequestRead",{requestId:id,instagramId:matchRequestIdentity},10000);await loadMatchRequests();toast("맞팔 요청을 확인했습니다.");}catch(e){toast(e.message||"확인 처리 실패");}}
async function saveMatchRequestPeriod(){
  const startValue=$("matchRequestStartAt")?.value||"",endValue=$("matchRequestEndAt")?.value||"";
  if(!startValue||!endValue)return toast("시작일과 종료일을 모두 입력해주세요.");
  const data=await runAdminAction("setMatchRequestPeriod",{startAt:new Date(startValue).toISOString(),endAt:new Date(endValue).toISOString()},"맞팔 요청 기간을 저장했습니다.");
  if(data){matchRequestPeriod=data.period||matchRequestPeriod;await loadMatchRequestConfig();}
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
  // V130: 번호 칸의 "부계" 같은 비숫자 표시는 정상 허용합니다.
  // 실제 회원번호 중복 검사는 숫자 번호끼리만 수행합니다.
  const duplicateNos = duplicateGroups(current.filter((x) => /^\d+$/.test(String(x.no || "").trim())), (x) => x.no);
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
    const currentNoGroups = duplicateGroups(current.filter((x) => /^\d+$/.test(String(x.no || "").trim())), (x) => x.no);
    const baselineNormalized = (baseline.members || []).map((x) => ({
      no: String(x.no || "").trim(),
      name: String(x.name || "").trim(),
      id: normalize(x.id),
    }));
    const baselineNoGroups = duplicateGroups(baselineNormalized.filter((x) => /^\d+$/.test(String(x.no || "").trim())), (x) => x.no);
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
    $("adminLoginMsg").textContent = "운영진 공동비밀번호가 올바르지 않습니다.";
  }
}

function showAdminPanel() {
  $("adminPanel").classList.remove("hidden");
  $("adminLoginCard").classList.add("hidden");
  updateLockIndicators();
}

function adminLogout() {
  if (memberSession?.token) { exitAdminModeToMember(); return; }
  adminLoggedIn = false; adminPasswordValue = ""; adminModeToken = ""; adminMemberRole = ""; adminProfile = null;
  setAdminNavigation(false);
  setAdminHeader(null);
  bootstrapAuth();
}

async function runAdminAction(action, payload, successMessage) {
  if (!adminLoggedIn || !adminModeToken) {
    toast("운영진모드 전환이 필요합니다.");
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
if($("inviteMemberTab"))$("inviteMemberTab").onclick=()=>setInviteMode("member");if($("inviteAdminTab"))$("inviteAdminTab").onclick=()=>{if(inviteAdminLoggedIn){setInviteMode("admin");Promise.allSettled([loadInviteAdmin(),loadInviteSummary()])}else openInviteAdminLogin()};if($("inviteCheckMeBtn"))$("inviteCheckMeBtn").onclick=checkInviteMe;if($("inviteStartFollowBtn"))$("inviteStartFollowBtn").onclick=startFollowFromOne;if($("inviteRegisterBtn"))$("inviteRegisterBtn").onclick=registerInviteIntegrated;if($("inviteAdminPassword"))$("inviteAdminPassword").addEventListener("input",e=>{e.target.value=e.target.value.replace(/\D/g,"")});if($("inviteAdminLoginBtn"))$("inviteAdminLoginBtn").onclick=loginInviteAdmin;if($("inviteAdminCancelBtn"))$("inviteAdminCancelBtn").onclick=closeInviteAdminLogin;if($("inviteAdminLogoutBtn"))$("inviteAdminLogoutBtn").onclick=logoutInviteAdmin;if($("refreshInviteAdminBtn"))$("refreshInviteAdminBtn").onclick=loadInviteAdmin;if($("refreshInviteSummaryBtn"))$("refreshInviteSummaryBtn").onclick=loadInviteSummary;if($("publishInvitePriorityBtn"))$("publishInvitePriorityBtn").onclick=publishInvitePriorityV110;if($("inviteAdminSearch"))$("inviteAdminSearch").oninput=renderInviteAdminList;document.querySelectorAll("[data-invite-filter]").forEach(b=>b.onclick=()=>{inviteAdminFilter=b.dataset.inviteFilter;document.querySelectorAll("[data-invite-filter]").forEach(x=>x.classList.toggle("active",x===b));renderInviteAdminList()});document.addEventListener("click",e=>{const a=e.target.closest("[data-invite-approve]"),r=e.target.closest("[data-invite-reject]"),c=e.target.closest("[data-invite-cancel]");if(a)changeInviteStatus(a.dataset.inviteApprove,"APPROVED");if(r)changeInviteStatus(r.dataset.inviteReject,"REJECTED");if(c)cancelInviteApproval(c.dataset.inviteCancel,c.dataset.inviteName||"")});
document.querySelectorAll("[data-home-view]").forEach((button) => {
  button.onclick = () => showView(button.dataset.homeView);
});
if ($("homePumasiBtn")) {
  $("homePumasiBtn").onclick = () => {
    const configured = window.YEOWOOBANG_PUMASI_URL || "";
    if (configured) window.location.href = configured;
    else toast("품앗이 연결 주소를 등록하면 바로 이동할 수 있어요.");
  };
}

document.querySelectorAll(".nav-btn").forEach((button) => {
  button.onclick = () => showView(button.dataset.view);
});

$("generalAccessBtn").onclick = chooseGeneralAccess;
$("adminAccessBtn").onclick = chooseAdminAccess;
if ($("operatorLoginBtn")) $("operatorLoginBtn").onclick = loginOperatorFromGate;
if ($("operatorLoginBackBtn")) $("operatorLoginBackBtn").onclick = backToRoleSelect;
if ($("operatorPassword")) $("operatorPassword").onkeydown = (event) => { if (event.key === "Enter") loginOperatorFromGate(); };
$("memberLoginBtn").onclick = loginMemberFromGate;
if ($("openNewMemberInviteBtn")) $("openNewMemberInviteBtn").onclick = () => {
  resetNewMemberInviteGate();
  $("gateError").textContent = "";
  setGate("newMemberInvite");
};
$("openMemberRegisterBtn").onclick = () => { $("gateError").textContent = ""; setGate("memberRegister"); };
$("openMemberForgotBtn").onclick = () => { $("gateError").textContent = ""; setGate("memberForgot"); };
$("backFromForgotBtn").onclick = () => { $("gateError").textContent = ""; setGate("memberLogin"); };
$("memberForgotBtn").onclick = resetMemberPasswordFromGate;
$("memberLoginBackBtn").onclick = backToRoleSelect;
$("backToMemberLoginBtn").onclick = () => { $("gateError").textContent = ""; setGate("memberLogin"); };
$("memberRegisterBtn").onclick = registerMemberFromGate;

if ($("adminSimpleLoginBtn")) $("adminSimpleLoginBtn").onclick = adminSimpleLoginFromGate;
if ($("backFromAdminSimpleBtn")) $("backFromAdminSimpleBtn").onclick = () => {
  $("gateError").textContent = "";
  setGate("memberLogin");
};
if ($("adminPassword")) $("adminPassword").onkeydown = (event) => {
  if (event.key === "Enter") adminSimpleLoginFromGate();
};
if ($("newMemberInviteSubmitBtn")) $("newMemberInviteSubmitBtn").onclick = registerNewMemberInviteFromGate;
if ($("backFromNewMemberInviteBtn")) $("backFromNewMemberInviteBtn").onclick = () => {
  $("gateError").classList.remove("new-member-success");
  $("gateError").textContent = "";
  setGate("memberLogin");
};
if ($("newMemberInviterInstagram")) $("newMemberInviterInstagram").onkeydown = (event) => {
  if (event.key === "Enter") registerNewMemberInviteFromGate();
};
if ($("adminModeBtn")) $("adminModeBtn").onclick = openAdminModeModal;
if ($("adminModeCancelBtn")) $("adminModeCancelBtn").onclick = closeAdminModeModal;
if ($("adminModeConfirmBtn")) $("adminModeConfirmBtn").onclick = enterAdminModeFromMember;
if ($("adminModePassword")) $("adminModePassword").onkeydown = (event) => { if (event.key === "Enter") enterAdminModeFromMember(); };
if ($("adminModeInstagram")) $("adminModeInstagram").onkeydown = (event) => { if (event.key === "Enter") $("adminModePassword")?.focus(); };
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


$("matchVoteDoneBtn")?.addEventListener("click",()=>submitMatchVote("완료"));
$("matchVoteDelayBtn")?.addEventListener("click",()=>submitMatchVote("지연"));

$("zipFile").onchange = () => {
  $("fileName").textContent = $("zipFile").files[0]?.name || "인스타그램 ZIP 파일 선택";
};
$("analyzeBtn").onclick = analyze;
$("resetBtn").onclick = resetAnalysis;
$("searchInput").oninput = renderMatchList;
$("copyBtn").onclick = copyCurrent;
$("mentionBtn").onclick = copyMentions;
$("verifyMatchRequestIdentityBtn")?.addEventListener("click",verifyMatchRequestIdentity);
$("changeMatchRequestIdentityBtn")?.addEventListener("click",changeMatchRequestIdentity);
$("matchRequestMyInstagram")?.addEventListener("keydown",e=>{if(e.key==="Enter")verifyMatchRequestIdentity();});
document.querySelectorAll(".match-request-tab").forEach(b=>b.addEventListener("click",()=>showMatchRequestTab(b.dataset.requestTab)));
$("saveMatchRequestPeriodBtn")?.addEventListener("click",saveMatchRequestPeriod);

$("refreshInviteLeaderboardBtn")?.addEventListener("click",()=>loadInviteLeaderboard(true));

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
$("lockMatchBtn").onclick = () => setMatchVoteOpenV101(false);
$("unlockMatchBtn").onclick = () => setMatchVoteOpenV101(true);


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
finishBootScreen();

  // V187: Android 앱(WebView)에서는 PWA Service Worker를 사용하지 않습니다.
  // 예전 서비스워커가 오래된 app.js/index.html을 계속 제공하는 현상을 방지합니다.
  const isAndroidAppV187 = new URLSearchParams(location.search).get("app") === "android";
  if ("serviceWorker" in navigator) {
    if (isAndroidAppV187) {
      navigator.serviceWorker.getRegistrations()
        .then(regs => Promise.all(regs.map(reg => reg.unregister())))
        .catch(() => {});
      if (window.caches) {
        caches.keys()
          .then(keys => Promise.all(keys.map(key => caches.delete(key))))
          .catch(() => {});
      }
    } else {
      navigator.serviceWorker.register("sw.js?v=1870").catch(() => {});
    }
  }

  // V118: app.js에 API 주소가 내장되어 있으므로 config.json을 기다리지 않고 즉시 인증을 시작합니다.
  void loadConfig();
  void bootstrapAuth();

  setInterval(async () => {
    if (!document.hidden && accessGranted) {
      try { await refreshPublicConfig(true); } catch (_) {}
    }
  }, 900000);

  setInterval(async () => {
    if (!document.hidden && accessGranted) {
      await loadNotices(true).catch(() => {});
    }
  }, 600000);
});


$("changeMemberPasswordBtn")?.addEventListener("click",changeMemberPasswordFromUi);
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
    box.innerHTML=items.length?items.map(x=>`<div class="v72-member-row"><div><strong>${escapeHtml(x.nickname)} · @${escapeHtml(x.instagramId)}</strong><div class="meta">MemberID ${escapeHtml(x.memberId)} · 회원 ${escapeHtml(x.memberStatus)} · 계정 ${escapeHtml(x.account?.status||'미등록')}${x.account?.last?` · 최근 ${escapeHtml(x.account.last)}`:''}</div></div><div class="v72-member-actions">${x.account?`<button class="outline ${x.account.status==='정상'?'danger-outline':'success-outline'}" data-v72-member="${escapeHtml(x.memberId)}" data-v72-status="${x.account.status==='정상'?'정지':'정상'}">${x.account.status==='정상'?'정지':'복구'}</button><button class="outline danger-outline" data-v162-reset="${escapeHtml(x.memberId)}" data-v162-name="${escapeHtml(x.nickname)}">테스트 초기화</button>`:''}</div></div>`).join(''):'<p class="state-text">검색 결과가 없습니다.</p>';
    box.querySelectorAll('[data-v72-member]').forEach(b=>b.onclick=async()=>{if(!confirm(`이 계정을 ${b.dataset.v72Status} 상태로 변경할까요?`))return;try{await apiPost('setMemberAccountStatus',{adminPassword:adminPasswordValue,memberId:b.dataset.v72Member,status:b.dataset.v72Status},12000);toast('계정 상태를 변경했습니다.');await searchAdminMembersV72();await loadAdminDashboardV72();}catch(e){toast(e.message||'변경 실패');}});
    box.querySelectorAll('[data-v162-reset]').forEach(b=>b.onclick=async()=>{
      const name=b.dataset.v162Name||'이 회원';
      if(!confirm(`${name}님의 프로그램 계정만 최초 가입 전 상태로 초기화할까요?\n\n• 팔로우리스트 번호/닉네임/아이디 유지\n• 초대/맞팔/팔로우 기록 유지\n• 비밀번호/계정가입 정보만 초기화\n\n초기화 후에는 다시 계정 등록을 해야 합니다.`))return;
      b.disabled=true;
      try{
        const d=await apiPost('resetTestMemberAccountV162',{adminPassword:adminPasswordValue,memberId:b.dataset.v162Reset},15000);
        toast(d.message||'테스트 계정을 초기화했습니다.');
        await searchAdminMembersV72();
        await loadAdminDashboardV72();
      }catch(e){toast(e.message||'초기화 실패');}
      finally{b.disabled=false;}
    });
  }catch(e){box.innerHTML=`<p class="error-text">${escapeHtml(e.message||'검색 실패')}</p>`;}
}
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

$('createBackupV73Btn')?.addEventListener('click',createBackupV73Ui);
$('loadMatchReportV73Btn')?.addEventListener('click',loadMatchReportV73);
$('copyMatchReportV73Btn')?.addEventListener('click',copyMatchReportV73);
document.querySelectorAll('[data-v73-report]').forEach(b=>b.addEventListener('click',()=>{v73ReportType=b.dataset.v73Report;renderMatchReportV73();}));

/* =========================================================
 * V75 회원 통합관리
 * ======================================================= */
let v74Members=[];
async function loadV75Members(query='',newOnly=false){
  if(!adminLoggedIn)return toast('운영진 로그인이 필요합니다.');
  const box=$('v74MemberResults'); box.innerHTML='<p class="state-text">불러오는 중...</p>';
  try{const d=await apiPost('getV75MemberOps',{adminPassword:adminPasswordValue,query},15000);v74Members=(d.items||[]).filter(x=>!newOnly||(x.day!==null&&x.day<=7&&x.memberStatus==='승인완료'));renderV75Members();}
  catch(e){box.innerHTML=`<p class="error-text">${escapeHtml(e.message||'불러오기 실패')}</p>`;}
}
function renderV75Members(){
  const box=$('v74MemberResults');
  box.innerHTML=v74Members.length?v74Members.map(x=>`<div class="v72-member-row v74-member"><div><strong>${escapeHtml(x.nickname)} · @${escapeHtml(x.instagramId)}</strong><div class="meta">MemberID ${escapeHtml(x.memberId)}${x.day!==null?` · D+${x.day}`:''} · 회원 ${escapeHtml(x.memberStatus)} · 맞팔 ${escapeHtml(x.matchStatus)}</div><div class="meta">계정 ${escapeHtml(x.account?.status||'미등록')}${x.lastLogin?` · 최근로그인 ${escapeHtml(x.lastLogin)}`:''}</div><textarea id="memo-${escapeHtml(x.memberId)}" class="v74-memo" placeholder="운영진 메모">${escapeHtml(x.memo||'')}</textarea></div><div class="v72-member-actions"><button class="outline" onclick="saveV75Memo('${escapeHtml(x.memberId)}')">메모 저장</button><button class="outline success-outline" onclick="setV75Lifecycle('${escapeHtml(x.memberId)}','승인완료')">정상</button><button class="outline danger-outline" onclick="setV75Lifecycle('${escapeHtml(x.memberId)}','탈퇴')">탈퇴</button><button class="outline danger-outline" onclick="setV75Lifecycle('${escapeHtml(x.memberId)}','강퇴')">강퇴</button></div></div>`).join(''):'<p class="state-text">해당 회원이 없습니다.</p>';
}
async function saveV75Memo(id){try{await apiPost('saveMemberMemoV75',{adminPassword:adminPasswordValue,memberId:id,memo:$(`memo-${id}`)?.value||''},12000);toast('운영진 메모를 저장했습니다.');}catch(e){toast(e.message||'저장 실패');}}
async function setV75Lifecycle(id,status){if(!confirm(`회원 상태를 '${status}'로 변경할까요?\n탈퇴/강퇴 시 로그인도 즉시 정지됩니다.`))return;try{await apiPost('setMemberLifecycleV75',{adminPassword:adminPasswordValue,memberId:id,status},12000);toast(`회원 상태를 ${status}로 변경했습니다.`);await loadV75Members($('v74MemberSearch')?.value.trim()||'');}catch(e){toast(e.message||'변경 실패');}}
async function loadV75Issues(){const box=$('v74IssueResults');box.classList.remove('hidden');box.innerHTML='<p class="state-text">검사 중...</p>';try{const d=await apiPost('getDataIssuesV75',{adminPassword:adminPasswordValue},15000);box.innerHTML=`<p class="subtext">오류 ${d.count||0}건</p>`+((d.items||[]).length?(d.items||[]).map(x=>`<div class="v72-member-row"><div><strong>🚨 ${escapeHtml(x.type)}</strong><div class="meta">${x.row}행 · ${escapeHtml(x.detail)}</div></div></div>`).join(''):'<p class="state-text">발견된 데이터 오류가 없습니다. ✅</p>');}catch(e){box.innerHTML=`<p class="error-text">${escapeHtml(e.message||'검사 실패')}</p>`;}}
$('v74MemberSearchBtn')?.addEventListener('click',()=>loadV75Members($('v74MemberSearch')?.value.trim()||''));
$('v74MemberSearch')?.addEventListener('keydown',e=>{if(e.key==='Enter')loadV75Members(e.target.value.trim())});
$('v74NewMembersBtn')?.addEventListener('click',()=>loadV75Members('',true));
$('v74DataIssuesBtn')?.addEventListener('click',loadV75Issues);


/* =========================================================
 * V76 알림센터 · 운영진 업무함 · 회원 상세페이지
 * ======================================================= */
let v76Notifications=[];

function setNotificationBadgeV76(count){
  const btn=$("notificationBtn"), badge=$("notificationBadge");
  if(!btn||!badge)return;
  if(memberSession?.token)btn.classList.remove("hidden"); else btn.classList.add("hidden");
  const n=Number(count||0);
  badge.textContent=n>99?'99+':String(n);
  badge.classList.toggle("hidden",n<1);
}

async function loadNotificationsV76(forceV183 = false){
  if(!memberSession?.token){setNotificationBadgeV76(0);return;}

  if (!forceV183 && freshV183(V183_SPEED.notificationsLoadedAt, V183_TTL.notifications)) {
    setNotificationBadgeV76(v76Notifications.filter(x=>!x.read).length);
    return v76Notifications;
  }

  if (!forceV183 && V183_SPEED.notificationsInFlight) {
    return V183_SPEED.notificationsInFlight;
  }

  const taskV183=(async()=>{
    try{
      const d=await apiPost('getNotificationsV76',{token:memberSession.token},12000);
      v76Notifications=d.items||[];
      V183_SPEED.notificationsLoadedAt=Date.now();
      setNotificationBadgeV76(d.unread||0);
      renderNotificationsV76();
      return v76Notifications;
    }catch(_){
      setNotificationBadgeV76(0);
      return v76Notifications;
    }
  })();

  if(!forceV183)V183_SPEED.notificationsInFlight=taskV183;
  try{
    return await taskV183;
  }finally{
    if(!forceV183&&V183_SPEED.notificationsInFlight===taskV183){
      V183_SPEED.notificationsInFlight=null;
    }
  }
}

function renderNotificationsV76(){
  const box=$("notificationList"); if(!box)return;
  if(!v76Notifications.length){box.innerHTML='<div class="notification-empty">새 알림이 없어요 🦊</div>';return;}
  box.innerHTML=v76Notifications.map(x=>`<button class="notification-item ${x.read?'read':'unread'}" type="button" data-notification-key="${escapeHtml(x.key)}" data-notification-type="${escapeHtml(x.type||'')}"><span class="notification-icon">${escapeHtml(x.icon||'🔔')}</span><span class="notification-copy"><strong>${escapeHtml(x.title||'알림')}</strong><span>${escapeHtml(x.message||'')}</span><small>${escapeHtml(x.createdAt||'')}</small></span>${x.read?'':'<i class="notification-dot"></i>'}</button>`).join('');
  box.querySelectorAll('[data-notification-key]').forEach(el=>el.addEventListener('click',async()=>{
    const key=el.dataset.notificationKey,type=el.dataset.notificationType;
    try{await apiPost('markNotificationReadV76',{token:memberSession.token,key},8000);}catch(_){}
    const item=v76Notifications.find(x=>x.key===key); if(item)item.read=true;
    setNotificationBadgeV76(v76Notifications.filter(x=>!x.read).length); renderNotificationsV76();
    closeNotificationModalV76();
    if(type==='match')showView('matchView'); else if(type==='notice')showView('noticeView'); else if(type==='invite')showView('inviteView');
  }));
}

function openNotificationModalV76(){
  if(!memberSession?.token)return toast('회원 로그인이 필요합니다.');
  $("notificationModal")?.classList.remove('hidden'); document.body.classList.add('account-modal-open');
  void loadNotificationsV76();
}
function closeNotificationModalV76(){
  $("notificationModal")?.classList.add('hidden');
  if(!document.querySelector('.account-modal:not(.hidden)'))document.body.classList.remove('account-modal-open');
}
async function markAllNotificationsReadV76(){
  if(!memberSession?.token)return;
  try{await apiPost('markAllNotificationsReadV76',{token:memberSession.token},12000);v76Notifications.forEach(x=>x.read=true);setNotificationBadgeV76(0);renderNotificationsV76();toast('모든 알림을 읽음 처리했습니다.');}catch(e){toast(e.message||'처리하지 못했습니다.');}
}

async function loadAdminTaskboxV76(){
  if(!adminLoggedIn)return;
  const box=$("v76TaskList"); if(!box)return;
  box.innerHTML='<p class="state-text">업무를 확인하는 중...</p>';
  try{
    const d=await apiPost('getAdminTaskboxV76',{adminPassword:adminPasswordValue},15000);
    $("v76TaskTotal").textContent=`${d.total||0}건`;
    box.innerHTML=(d.tasks||[]).map(x=>`<button class="v76-task-card" type="button" data-v76-task="${escapeHtml(x.target||'')}"><span>${escapeHtml(x.icon||'📌')}</span><strong>${Number(x.count||0)}</strong><small>${escapeHtml(x.label||'')}</small></button>`).join('');
    box.querySelectorAll('[data-v76-task]').forEach(b=>b.addEventListener('click',()=>handleAdminTaskV76(b.dataset.v76Task)));
  }catch(e){box.innerHTML=`<p class="error-text">${escapeHtml(e.message||'업무함을 불러오지 못했습니다.')}</p>`;}
}
function handleAdminTaskV76(target){
  if(target==='match'){void loadMatchReportV73();document.getElementById('matchReportV73')?.scrollIntoView({behavior:'smooth',block:'center'});}
  else if(target==='issues'){void loadV75Issues();document.getElementById('v74IssueResults')?.scrollIntoView({behavior:'smooth',block:'center'});}
  else if(target==='members'){document.getElementById('v74MemberSearch')?.scrollIntoView({behavior:'smooth',block:'center'});}
  else if(target==='invite'){toast('초대별 관리자 메뉴에서 승인대기 목록을 확인해 주세요.');}
}

async function loadMemberDetailV76(){
  if(!adminLoggedIn)return toast('운영진모드 전환이 필요합니다.');
  const id=String($("v76DetailId")?.value||'').trim(), box=$("v76DetailResult");
  if(!id){box.innerHTML='<p class="error-text">MemberID를 입력해 주세요.</p>';return;}
  box.innerHTML='<p class="state-text">회원 정보를 불러오는 중...</p>';
  try{
    const d=await apiPost('getMemberDetailV76',{adminPassword:adminPasswordValue,memberId:id},15000),m=d.member||{};
    const p=m.followProgress;
    const acts=(m.activities||[]).slice(0,8).map(a=>`<div class="v76-detail-activity"><strong>${escapeHtml(a.type||'활동')}</strong><span>${escapeHtml(a.content||'')}</span><small>${escapeHtml(a.at||'')}</small></div>`).join('')||'<p class="state-text">최근 활동기록이 없습니다.</p>';
    box.innerHTML=`<div class="v76-detail-card"><div class="v76-detail-head"><div><strong>${escapeHtml(m.nickname||'')} · @${escapeHtml(m.instagramId||'')}</strong><span>MemberID ${escapeHtml(m.memberId||'')}</span></div><span class="lock-state ${m.memberStatus==='승인완료'?'unlocked':'locked'}">${escapeHtml(m.memberStatus||'')}</span></div><div class="v76-detail-grid"><div><span>가입일</span><strong>${escapeHtml(m.joinDate||'-')}</strong></div><div><span>최근 로그인</span><strong>${escapeHtml(m.lastLogin||m.accountLastLogin||'-')}</strong></div><div><span>계정</span><strong>${escapeHtml(m.accountStatus||'미등록')}</strong></div><div><span>맞팔 제출</span><strong>${escapeHtml(m.matchStatus||'미제출')}</strong></div><div><span>오늘 팔로우</span><strong>${Number(m.todayFollowCount||0)}명</strong></div><div><span>이어보기</span><strong>${p?`${escapeHtml(p.no||'')}번 · ${escapeHtml(p.name||'')}`:'기록 없음'}</strong></div><div><span>초대 실적</span><strong>승인 ${Number(m.inviteStats?.approved||0)} · 대기 ${Number(m.inviteStats?.pending||0)}</strong></div></div>${m.memo?`<div class="v76-detail-memo"><strong>📝 운영진 메모</strong><p>${escapeHtml(m.memo)}</p></div>`:''}<h4>최근 활동</h4><div class="v76-detail-activities">${acts}</div></div>`;
  }catch(e){box.innerHTML=`<p class="error-text">${escapeHtml(e.message||'회원 정보를 불러오지 못했습니다.')}</p>`;}
}

$("notificationBtn")?.addEventListener('click',openNotificationModalV76);
$("notificationCloseBtn")?.addEventListener('click',closeNotificationModalV76);
$("notificationReadAllBtn")?.addEventListener('click',markAllNotificationsReadV76);
$("notificationModal")?.addEventListener('click',e=>{if(e.target?.id==='notificationModal')closeNotificationModalV76();});
$("v76TaskRefreshBtn")?.addEventListener('click',loadAdminTaskboxV76);
$("v76DetailBtn")?.addEventListener('click',loadMemberDetailV76);
$("v76DetailId")?.addEventListener('keydown',e=>{if(e.key==='Enter')loadMemberDetailV76();});
setInterval(()=>{if(memberSession?.token&&!document.hidden)void loadNotificationsV76();},15*60*1000);

// V87 숫자 비밀번호 입력 제어
const V87_NUMERIC_PASSWORD_IDS=["adminPassword","memberLoginPassword","memberForgotPassword","memberForgotPasswordConfirm","memberRegisterPassword","memberRegisterPasswordConfirm","operatorPassword","adminModePassword","currentMemberPassword","newMemberPassword","newMemberPasswordConfirm"];
window.addEventListener("DOMContentLoaded",()=>V87_NUMERIC_PASSWORD_IDS.forEach(id=>{const el=$(id);if(!el)return;el.setAttribute("inputmode","numeric");el.setAttribute("pattern","[0-9]*");el.setAttribute("minlength","4");el.setAttribute("maxlength","6");el.addEventListener("input",()=>{el.value=String(el.value||"").replace(/\D/g,"").slice(0,6);});}));


/* V90 - 실제 팔로우리스트 회원 판별
   A열 번호만 예약되어 있고 B/C가 빈 행은 회원으로 표시하지 않습니다. */
function isActualFollowMemberV90(row){
  if(!row) return false;
  const nickname=String(row.nickname ?? row.nick ?? row.name ?? "").trim();
  const instagram=String(row.instagramId ?? row.instagram ?? row.insta ?? row.username ?? "").trim();
  return !!(nickname && instagram);
}

$("inviteMonthlyTab")?.addEventListener("click",()=>{ inviteRankModeV92="monthly"; renderInviteRankV92(); });
$("inviteTotalTab")?.addEventListener("click",()=>{ inviteRankModeV92="total"; renderInviteRankV92(); });


/* V95 계정정지 회원 안전처리 */
function canOpenInstagramV95(item){
  return !!(item && item.status !== "SUSPENDED" && item.id);
}


/* V99 팔로우리스트 잠금 운영진 제어 */
function syncFollowLockAdminV99(){
  if($("followLockStartAdmin") && document.activeElement!==$("followLockStartAdmin")){
    $("followLockStartAdmin").value=toLocalDateTimeInputV99(publicConfig?.followLockStartAt||"");
  }
  if($("followLockEndAdmin") && document.activeElement!==$("followLockEndAdmin")){
    $("followLockEndAdmin").value=toLocalDateTimeInputV99(publicConfig?.followLockEndAt||"");
  }
}
function toLocalDateTimeInputV99(v){
  if(!v)return "";
  const d=new Date(v); if(isNaN(d.getTime()))return "";
  const p=n=>String(n).padStart(2,"0");
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
async function setFollowLockV99(locked){
  if(!adminLoggedIn){toast("운영진모드에서 설정해주세요.");return}
  try{
    await apiPost("setFollowLock",{adminPassword:adminPasswordValue,locked:Boolean(locked)},15000);
    await refreshPublicConfig(false);
    syncFollowLockAdminV99();
    toast(locked?"팔로우리스트를 잠갔습니다.":"팔로우리스트를 열었습니다.");
  }catch(e){toast(e.message||"팔로우리스트 잠금 설정에 실패했습니다.")}
}
async function saveFollowLockPeriodV99(clear=false){
  if(!adminLoggedIn){toast("운영진모드에서 설정해주세요.");return}
  const start=clear?"":($("followLockStartAdmin")?.value||"");
  const end=clear?"":($("followLockEndAdmin")?.value||"");
  if(!clear && (!start||!end)){toast("시작과 종료 시간을 모두 입력해주세요.");return}
  try{
    await apiPost("setFollowLockPeriod",{adminPassword:adminPasswordValue,startAt:start,endAt:end},15000);
    await refreshPublicConfig(false);
    syncFollowLockAdminV99();
    toast(clear?"팔로우리스트 예약 잠금을 해제했습니다.":"팔로우리스트 예약 잠금을 저장했습니다.");
  }catch(e){toast(e.message||"예약 잠금 설정에 실패했습니다.")}
}
$("lockFollowBtn")?.addEventListener("click",()=>setFollowLockV99(true));
$("unlockFollowBtn")?.addEventListener("click",()=>setFollowLockV99(false));
$("saveFollowLockPeriodBtn")?.addEventListener("click",()=>saveFollowLockPeriodV99(false));
$("clearFollowLockPeriodBtn")?.addEventListener("click",()=>saveFollowLockPeriodV99(true));


/* V101 맞팔확인 기간 / 예약기간 */
function toLocalDateTimeInputV101(value){
  if(!value)return "";
  const d=new Date(value);
  if(isNaN(d.getTime()))return "";
  const p=n=>String(n).padStart(2,"0");
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function syncMatchPeriodAdminV101(){
  if($("matchPeriodStartAdmin") && document.activeElement!==$("matchPeriodStartAdmin")){
    $("matchPeriodStartAdmin").value=toLocalDateTimeInputV101(publicConfig?.matchPeriodStartAt||"");
  }
  if($("matchPeriodEndAdmin") && document.activeElement!==$("matchPeriodEndAdmin")){
    $("matchPeriodEndAdmin").value=toLocalDateTimeInputV101(publicConfig?.matchPeriodEndAt||"");
  }
  if($("matchPeriodReserveBadge")){
    $("matchPeriodReserveBadge").textContent=publicConfig?.matchPeriodScheduled ? "예약 설정됨" : "예약 없음";
    $("matchPeriodReserveBadge").classList.toggle("active",Boolean(publicConfig?.matchPeriodScheduled));
  }
}

async function setMatchVoteOpenV101(open){
  if(!adminLoggedIn || !adminModeToken){
    toast("운영진모드로 다시 전환해주세요.");
    return;
  }
  try{
    await apiPost("setMatchVoteOpen",{
      adminModeToken,
      adminPassword:adminPasswordValue,
      open:Boolean(open)
    },15000);
    await refreshPublicConfig(false);
    syncMatchPeriodAdminV101();
    toast(open?"맞팔확인 기간을 시작했습니다.":"맞팔확인 기간을 종료했습니다.");
  }catch(e){
    toast(e.message||"맞팔확인 기간 변경에 실패했습니다.");
  }
}

async function saveMatchPeriodV101(clear=false){
  if(!adminLoggedIn || !adminModeToken){
    toast("운영진모드로 다시 전환해주세요.");
    return;
  }
  const start=clear ? "" : ($("matchPeriodStartAdmin")?.value||"");
  const end=clear ? "" : ($("matchPeriodEndAdmin")?.value||"");
  if(!clear && (!start||!end)){
    toast("예약 시작과 종료 시간을 모두 입력해주세요.");
    return;
  }
  try{
    await apiPost("setMatchPeriod",{
      adminModeToken,
      adminPassword:adminPasswordValue,
      startAt:start,
      endAt:end
    },15000);
    await refreshPublicConfig(false);
    syncMatchPeriodAdminV101();
    toast(clear?"맞팔확인 예약을 해제했습니다.":"맞팔확인 예약을 저장했습니다.");
  }catch(e){
    toast(e.message||"맞팔확인 예약 설정에 실패했습니다.");
  }
}
$("saveMatchPeriodBtn")?.addEventListener("click",()=>saveMatchPeriodV101(false));
$("clearMatchPeriodBtn")?.addEventListener("click",()=>saveMatchPeriodV101(true));


/* V104 팔로우리스트 개인 워터마크 */
function updateFollowWatermarkV104(){
  let wm=document.getElementById("followSecurityWatermarkV104");
  if(!wm){
    wm=document.createElement("div");
    wm.id="followSecurityWatermarkV104";
    wm.setAttribute("aria-hidden","true");
    document.body.appendChild(wm);
  }
  const id=memberSession?.member?.instagramId || "";
  if(!id){
    wm.classList.remove("show");
    wm.textContent="";
    return;
  }
  const stamp=new Date().toLocaleString("ko-KR",{month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"});
  wm.textContent=Array(16).fill(`@${id} · ${stamp}`).join("     ");
  wm.classList.add("show");
}


// V139 하단 실제 메뉴
document.addEventListener("click", async (e) => {
  const util = e.target.closest("[data-util-view]");
  if (util) { showView(util.dataset.utilView); return; }

  if (e.target.closest("#myPageLogoutBtn")) {
    if (!confirm("로그아웃할까요?")) return;
    memberAuthGenerationV133++;
    memberSession = null;
    clearMemberSessionStorage();
    try { sessionStorage.removeItem(FOLLOW_LIST_CACHE_KEY); } catch (_) {}
    accessGranted=false; followGranted=false; matchGranted=false;
    showGate(); setGate("memberLogin"); toast("로그아웃되었습니다."); return;
  }

  if (e.target.closest("#inquiryCopyBtn")) {
    const text=`[여우방 프로그램 문의]\n닉네임: ${memberSession?.member?.nickname||""}\n인스타 아이디: ${currentMemberInstagramV181()||""}\n사용 기기:\n문제 발생 메뉴:\n문의 내용:`;
    try { await navigator.clipboard.writeText(text); toast("문의 양식을 복사했어요."); }
    catch (_) { toast("문의 양식을 복사하지 못했어요."); }
    return;
  }

  if (e.target.closest("#moreThemeBtn")) {
    const btn = $("themeToggle") || $("themeToggleBtn") || $("darkModeBtn");
    if (btn) btn.click(); else document.body.classList.toggle("dark-mode");
  }
});




// V142 내정보 완전 통합
async function loadUnifiedMyInfoV142() {
  const local = memberSession?.member || {};
  const nick = local.nickname || adminProfile?.name || "회원";
  const rawInsta = local.instagram_username || local.instagramId || "";
  const insta = rawInsta ? `@${String(rawInsta).replace(/^@/,"")}` : "-";
  const isAdmin = !!(adminProfile || local.is_admin || local.role === "admin" || local.role === "operator");

  if ($("myInfoProfileName")) $("myInfoProfileName").textContent = nick;
  if ($("myInfoProfileInstagram")) $("myInfoProfileInstagram").textContent = insta === "-" ? "" : insta;
  if ($("myInfoRoleChip")) $("myInfoRoleChip").textContent = isAdmin ? "운영진" : "회원";
  if ($("myInfoNickname")) $("myInfoNickname").textContent = nick;
  if ($("myInfoInstagram")) $("myInfoInstagram").textContent = insta;
  if ($("myInfoRole")) $("myInfoRole").textContent = isAdmin ? "운영진" : "일반회원";
  if ($("myInfoAdminBtn")) $("myInfoAdminBtn").style.display = isAdmin ? "" : "none";

  if (!memberSession?.token) {
    if ($("myInfoMemberId")) $("myInfoMemberId").textContent = "-";
    if ($("myInfoFollowStatus")) $("myInfoFollowStatus").textContent = "로그인 필요";
    return;
  }

  try {
    const data = await apiPost("getMyPage", {token: memberSession.token}, 15000);
    const m = data.member || {}, f = data.follow || {};
    if ($("myInfoMemberId")) $("myInfoMemberId").textContent = m.memberId ?? "-";
    if ($("myInfoFollowStatus")) {
      $("myInfoFollowStatus").textContent = f.started ? "기존회원" : (f.status || "시작 상태 확인");
    }
  } catch (_) {
    if ($("myInfoMemberId")) $("myInfoMemberId").textContent = local.memberId ?? "-";
    if ($("myInfoFollowStatus")) $("myInfoFollowStatus").textContent = "확인 필요";
  }
}

document.addEventListener("click", (e) => {
  if (e.target.closest("#myInfoActivityBtn")) {
    openActivityHistory();
    return;
  }
  if (e.target.closest("#myInfoPasswordBtn")) {
    openAccountModal("passwordChangeModal");
    return;
  }
  if (e.target.closest("#myInfoThemeBtn")) {
    const btn = $("themeToggle") || $("themeToggleBtn") || $("darkModeBtn");
    if (btn) btn.click();
    else document.body.classList.toggle("dark-mode");
    return;
  }
  if (e.target.closest("#myInfoAdminBtn")) {
    const btn = $("adminModeBtn") || $("operatorModeBtn") || $("adminSwitchBtn");
    if (btn) btn.click();
    else openAccountModal("adminModeModal");
    return;
  }
  if (e.target.closest("#myPageLogoutBtn")) {
    if (!confirm("로그아웃할까요?")) return;
    logoutMember();
  }
});

// V143 복구: 더보기 로그아웃
document.addEventListener("click", (e) => {
  if (e.target.closest("#moreLogoutBtn")) {
    if (!confirm("로그아웃할까요?")) return;
    if (typeof logoutMember === "function") logoutMember();
  }
});


/* =========================================================
   V165 - Android 뒤로가기 최종 동작
   1) 서브 화면 → 홈
   2) 홈 → Android에서 종료 확인창
   ========================================================= */
window.androidBackActionV165 = function() {
  try {
    // 열려 있는 모달/메뉴가 있으면 먼저 닫습니다.
    const visibleModal = document.querySelector(".account-modal:not(.hidden)");
    if (visibleModal) {
      visibleModal.classList.add("hidden");
      document.body.classList.remove("account-modal-open");
      return "HANDLED";
    }

    const inviteLogin = document.getElementById("inviteAdminLoginBox");
    if (inviteLogin && !inviteLogin.classList.contains("hidden")) {
      inviteLogin.classList.add("hidden");
      return "HANDLED";
    }

    const moreMenu = document.getElementById("headerMoreMenu");
    if (moreMenu && !moreMenu.classList.contains("hidden")) {
      moreMenu.classList.add("hidden");
      return "HANDLED";
    }

    // 로그인 전 화면에서는 기존 화면 단계만 한 단계 뒤로 이동합니다.
    const gate = document.getElementById("appGate");
    if (gate && !gate.classList.contains("hidden")) {
      const visibleForm = document.querySelector(
        "#memberForgotForm:not(.hidden), " +
        "#memberRegisterForm:not(.hidden), " +
        "#operatorLoginForm:not(.hidden), " +
        "#gateForm:not(.hidden)"
      );

      if (visibleForm) {
        if (typeof setGate === "function") setGate("memberLogin");
        return "HANDLED";
      }

      const memberLogin = document.getElementById("memberLoginForm");
      if (memberLogin && !memberLogin.classList.contains("hidden")) {
        if (typeof backToRoleSelect === "function") backToRoleSelect();
        return "HANDLED";
      }

      return "EXIT";
    }

    // 로그인 후: 맞팔확인/팔로우리스트/초대별/공지/더보기/내정보 등
    // 어떤 서브 화면이든 뒤로가기 1회면 메인 홈으로 이동합니다.
    const activeView = document.querySelector(".view.active");
    if (activeView && activeView.id !== "homeView") {
      if (typeof showView === "function") {
        showView("homeView");
        return "HANDLED";
      }
    }

    // 이미 메인 홈이면 Android가 종료 확인창을 띄웁니다.
    return "EXIT";
  } catch (_) {
    return "EXIT";
  }
};


/* V174: 맞팔 전체 2707명 유지 / 아이디 없음·계정정지는 확인불가 분리 */


/* =========================================================
   V178 - Android 뒤로가기 보강
   - 일반 서브뷰(.view.active) -> 홈
   - 로그인/가입/비밀번호 화면 -> 이전 로그인 화면
   - 외부 품앗이 페이지는 Android WebView history에서 처리
   ========================================================= */
window.androidBackActionV178 = function(){
  try{
    // 로그인 게이트가 보이는 상태
    const gate = document.getElementById("gate");
    const gateVisible = gate && !gate.classList.contains("hidden");

    if(gateVisible){
      if(["memberRegister","memberForgot","adminSimple","newMemberInvite","operatorLogin"].includes(gateMode)){
        setGate("memberLogin");
        return "HANDLED";
      }
      if(gateMode === "memberLogin"){
        setGate("role");
        return "HANDLED";
      }
    }

    // 실제 화면 전환은 .view.active 기준
    const activeView = document.querySelector(".view.active");
    if(activeView && activeView.id && activeView.id !== "homeView"){
      showView("homeView");
      window.scrollTo({top:0, behavior:"auto"});
      return "HOME";
    }

    return "EXIT";
  }catch(e){
    return "EXIT";
  }
};

// 구버전 Android 앱에서도 새 로직 사용
window.androidBackActionV167 = window.androidBackActionV178;
window.androidBackActionV165 = window.androidBackActionV178;
