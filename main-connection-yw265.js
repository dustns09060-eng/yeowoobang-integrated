// Main-screen transport only. No server secrets; do not fall back to exhausted GAS authentication.
(function(){
 const url='https://budapzphwvgonbfbszdg.supabase.co/functions/v1/yw261-emergency';
 const key='sb_publishable_VskXpXeltU_M3C8GLyCowA_0hItnIhY';
 const actions=new Set(['resetMemberPassword','memberLogin','registerMemberAccount','memberSession','getSecureFollowList','sendMatchRequest','getMatchRequests','getMatchRequestsPageYW261','getNotificationsV76','getNotificationsPageYW261','completeMatchRequestV215','markNotificationReadV76','markAllNotificationsReadV76','verifyMatchRequestIdentity','getFollowProgress','saveFollowProgress','clearFollowProgress','getMyPage','logLoginActivityV256_2','logFollowUsage','getMyActivity','saveMatchAnalysis','getMyAnalysisHistory','changeMemberPassword']);
 const notify=x=>({...x,type:x.type==='MATCH_REQUEST_RECEIVED'?'MATCH_REQUEST':x.type});
 async function post(action,payload,token){
  const c=new AbortController(),timer=setTimeout(()=>c.abort(),45000);
  try{
   const r=await fetch(url,{method:'POST',cache:'no-store',headers:{apikey:key,'Content-Type':'application/json'},signal:c.signal,body:JSON.stringify({...payload,action,token})});
   const d=await r.json().catch(()=>null);
   if(!r.ok||!d?.ok){const e=new Error(d?.error||'처리 결과를 확인하지 못했습니다. 목록을 새로고침해 주세요.');e.status=r.status;throw e;}return d;
  }catch(e){if(e instanceof TypeError)throw new Error(action==='resetPassword'?'서버 응답을 받지 못했습니다. 재설정을 반복하지 말고 새 비밀번호로 로그인을 확인해 주세요.':'서버와 연결할 수 없습니다. HTTPS 주소로 다시 접속해 주세요.');if(e.name==='AbortError')throw new Error('응답이 늦습니다. 등록은 로그인으로, 요청은 보낸 목록으로 결과를 확인해 주세요.');throw e;}finally{clearTimeout(timer);}
 }
 window.YW_MAIN_CONNECTION={
  handles:action=>actions.has(action),
  logout:token=>post('logout',{},token).catch(()=>{}),
  async call(action,payload={},currentToken=()=> ''){
   if(action==='resetMemberPassword')return post('resetPassword',{instagram:payload.instagramId,nickname:payload.nickname,password:payload.newPassword},'');
   if(action==='changeMemberPassword')throw new Error('비밀번호 변경은 현재 복구 중입니다. 운영진에게 문의해 주세요.');
   const auth=action==='memberLogin'||action==='registerMemberAccount',token=payload.token||currentToken();
   if(!auth&&!/^[a-f0-9]{64}$/.test(token))throw new Error('새 연결을 사용하려면 다시 로그인해 주세요.');
   const request=async(a,p={})=>{const d=await post(a,p,token);if(!auth&&currentToken()!==token)throw new Error('로그인 상태가 변경되었습니다.');return d;};
   if(auth)return post(action==='memberLogin'?'login':'register',{instagram:payload.instagramId,password:payload.password,nickname:payload.nickname},'');
   if(action==='memberSession'||action==='verifyMatchRequestIdentity')return {...await request('memberSession'),token};
   if(action==='getMatchRequests'){
    const received=await request(action,{direction:'received'}),sent=await request(action,{direction:'sent'});
    return {ok:true,received:received.items,sent:sent.items,sentStates:sent.sentStates,receivedUnread:received.totalCount,sentCount:sent.totalCount,cursors:{received:received.nextCursor,sent:sent.nextCursor}};
   }
   if(action==='getMatchRequestsPageYW261')return request('getMatchRequests',payload);
   if(action==='getNotificationsV76'||action==='getNotificationsPageYW261'){
    const d=await request('getNotificationsV76',payload);return {...d,items:d.items.map(notify)};
   }
   return request(action,payload);
  }
 };
})();
