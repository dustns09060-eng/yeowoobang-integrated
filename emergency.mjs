import {classify,parseExportJson,parseExportHtml} from './emergency-parse.mjs';
const URL='https://budapzphwvgonbfbszdg.supabase.co/functions/v1/yw261-emergency';
const KEY='sb_publishable_VskXpXeltU_M3C8GLyCowA_0hItnIhY';
const $=id=>document.getElementById(id),notice=x=>{$('notice').textContent=x;};
let token='',member=null,roster=[],parsed=null,limit=60,requestCursor=null,notificationCursor=null,lastOpen='';
const labels={mutual:'맞팔',onlyMe:'나만 팔로우',fansOnly:'상대만 팔로우',neither:'서로 안 함'};
async function call(action,data={}){
 const r=await fetch(URL,{method:'POST',cache:'no-store',headers:{apikey:KEY,'Content-Type':'application/json'},body:JSON.stringify({...data,action,token}),signal:AbortSignal.timeout(40000)});
 const d=await r.json().catch(()=>({}));if(!r.ok||!d.ok)throw new Error(d.error||'응답을 확인하지 못했습니다. 요청·등록 결과는 목록이나 로그인으로 확인해 주세요.');return d;
}
let busy=false;
async function run(fn){if(busy)return;busy=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);notice('처리 중입니다…');try{await fn();}catch(e){notice(e.name==='TimeoutError'?'응답이 늦어 결과를 확인하지 못했습니다. 등록은 로그인으로, 요청은 보낸 목록으로 확인해 주세요.':e.message);}finally{busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);}}
function button(text,fn){const b=document.createElement('button');b.textContent=text;b.addEventListener('click',()=>run(fn));return b;}
function item(text){const d=document.createElement('div');d.className='item';const p=document.createElement('p');p.textContent=text;d.append(p);return d;}
async function login(action){const password=$('password').value;try{const d=await call(action,{instagram:$('instagram').value.trim(),password,nickname:$('nickname').value.trim()});token=d.token;member=d.member;$('auth').hidden=true;$('app').hidden=false;$('identity').textContent=member.nickname+' · @'+member.instagramId;notice('로그인했습니다. 명단 새로고침을 눌러 주세요.');}finally{$('password').value='';}}
$('loginForm').addEventListener('submit',e=>{e.preventDefault();run(()=>login('login'));});
$('register').onclick=()=>{if($('loginForm').reportValidity())run(()=>login('register'));};
$('logout').onclick=()=>run(async()=>{try{await call('logout');}finally{token='';member=null;roster=[];parsed=null;requestCursor=null;notificationCursor=null;lastOpen='';$('summary').textContent='';$('unread').textContent='';$('zipFile').value='';$('search').value='';$('filter').value='all';$('direction').value='received';for(const id of ['rosterMore','requestsMore','notificationsMore'])$(id).hidden=true;for(const id of ['roster','requests','notifications'])$(id).replaceChildren();$('app').hidden=true;$('auth').hidden=false;notice('로그아웃했습니다.');}});
async function loadRoster(){const d=await call('getSecureFollowList');roster=d.members;limit=60;renderRoster();notice('현재 명단 '+roster.length+'명을 확인했습니다.');}
$('loadRoster').onclick=()=>run(loadRoster);
function renderRoster(){
 const result=parsed?classify(roster,parsed.followers,parsed.following):roster.map(x=>({...x,status:''}));
 const q=$('search').value.trim().toLowerCase(),f=$('filter').value;
 const rows=result.filter(x=>x.id!==member?.instagramId&&(f==='all'||x.status===f)&&(!q||(x.id+' '+x.name).toLowerCase().includes(q)));
 $('summary').textContent=parsed?Object.entries(labels).map(([k,v])=>v+' '+result.filter(x=>x.id!==member?.instagramId&&x.status===k).length+'명').join(' · '):'파일 분석 전에는 맞팔 상태가 표시되지 않습니다.';
 $('roster').replaceChildren();for(const x of rows.slice(0,limit)){
  const d=item((x.no?x.no+' · ':'')+x.name+' · @'+x.id+(labels[x.status]?' · '+labels[x.status]:''));
  const a=document.createElement('a');a.textContent='팔로우리스트 열기';a.href='https://www.instagram.com/'+encodeURIComponent(x.id)+'/';a.target='_blank';a.rel='noopener noreferrer';a.className='open'+(lastOpen===x.id?' last':'');
  a.onclick=()=>{lastOpen=x.id;document.querySelectorAll('.open.last').forEach(el=>el.classList.remove('last'));a.classList.add('last');};d.append(a);
  if(x.status==='onlyMe'){const row=document.createElement('div');row.className='row';row.append(button('맞팔요청 보내기',async()=>{const r=await call('sendMatchRequest',{to:x.id});notice(r.duplicate?'이미 보낸 요청입니다.':'맞팔요청을 보냈습니다.');}));d.append(row);}
  $('roster').append(d);
 }$('rosterMore').hidden=rows.length<=limit;
}
$('search').oninput=()=>{limit=60;renderRoster();};$('filter').onchange=()=>{limit=60;renderRoster();};$('rosterMore').onclick=()=>{limit+=60;renderRoster();};
async function zipLibrary(){if(window.JSZip)return window.JSZip;await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';s.onload=resolve;s.onerror=()=>reject(new Error('ZIP 분석 도구를 불러오지 못했습니다.'));document.head.append(s);});return window.JSZip;}
$('analyze').onclick=()=>run(async()=>{
 const f=$('zipFile').files[0];if(!f||f.size>50*1024*1024)throw new Error('50MB 이하의 인스타그램 ZIP을 선택해 주세요.');
 await loadRoster();const ZIP=await zipLibrary(),zip=await ZIP.loadAsync(f);
 const paths=Object.keys(zip.files).filter(p=>!zip.files[p].dir),followers=paths.filter(p=>/(?:^|\/)followers_\d+\.(json|html)$/i.test(p)),following=paths.filter(p=>/(?:^|\/)following\.(json|html)$/i.test(p));
 if(!followers.length||following.length!==1)throw new Error('팔로워·팔로잉 파일을 찾지 못했습니다. 한 계정의 자료를 선택해 주세요.');
 async function read(p){if(zip.files[p]._data?.uncompressedSize>20*1024*1024)throw new Error('분석 파일이 너무 큽니다.');const t=await zip.files[p].async('string');if(t.length>20*1024*1024)throw new Error('분석 파일이 너무 큽니다.');return /\.json$/i.test(p)?parseExportJson(t):parseExportHtml(t);}
 const a=[];for(const p of followers)a.push(...await read(p));parsed={followers:a,following:await read(following[0])};limit=60;renderRoster();notice('맞팔확인을 완료했습니다. 나만 팔로우한 회원에게 요청할 수 있습니다.');
});
async function requests(more=false){const d=await call('getMatchRequests',{direction:$('direction').value,...(more?requestCursor:{})});if(!more)$('requests').replaceChildren();for(const x of d.items){const el=item((x.fromName||x.fromInstagram)+' → '+(x.toName||x.toInstagram)+' · '+(x.status==='READ'?'확인 완료':'확인 전')+' · '+new Date(x.createdAt).toLocaleString('ko-KR'));if($('direction').value==='received'&&x.status==='NEW')el.append(button('맞팔 확인 완료',async()=>{await call('completeMatchRequestV215',{requestId:x.id});await requests();}));$('requests').append(el);}if(!more&&!d.items.length)$('requests').textContent='요청이 없습니다.';requestCursor=d.nextCursor;$('requestsMore').hidden=!d.hasMore;notice('요청 목록을 확인했습니다.');}
$('requestsReload').onclick=()=>run(()=>requests());$('requestsMore').onclick=()=>run(()=>requests(true));$('direction').onchange=()=>run(()=>requests());
async function notifications(more=false){const d=await call('getNotificationsV76',more?notificationCursor:{});if(!more)$('notifications').replaceChildren();for(const x of d.items){const el=item((x.read?'':'● ')+(x.title||'알림')+' · '+x.content+' · '+new Date(x.createdAt).toLocaleString('ko-KR'));if(!x.read)el.append(button('읽음',async()=>{await call('markNotificationReadV76',{key:x.key});await notifications();}));$('notifications').append(el);}if(!more&&!d.items.length)$('notifications').textContent='알림이 없습니다.';$('unread').textContent=d.unread?'('+d.unread+')':'';notificationCursor=d.nextCursor;$('notificationsMore').hidden=!d.hasMore;notice('알림을 확인했습니다.');}
$('notificationsReload').onclick=()=>run(()=>notifications());$('notificationsMore').onclick=()=>run(()=>notifications(true));$('readAll').onclick=()=>run(async()=>{await call('markAllNotificationsReadV76');await notifications();});
