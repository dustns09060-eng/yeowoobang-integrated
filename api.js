const API=window.YEOWOO_CONFIG.API_URL;
function jsonp(action,params={}){
  return new Promise((resolve,reject)=>{
    if(!API||API.includes('PASTE_')) return reject(new Error('config.js에 Apps Script /exec 주소를 입력해주세요.'));
    const cb='ywcb_'+Date.now()+'_'+Math.random().toString(36).slice(2);
    const q=new URLSearchParams({action,callback:cb,...Object.fromEntries(Object.entries(params).map(([k,v])=>[k,typeof v==='object'?JSON.stringify(v):String(v??'')]))});
    const s=document.createElement('script'); let timer=setTimeout(()=>done(new Error('서버 응답 시간이 초과되었습니다.')),30000);
    function done(err,data){clearTimeout(timer);delete window[cb];s.remove();err?reject(err):resolve(data)}
    window[cb]=d=>done(null,d);s.onerror=()=>done(new Error('API 연결 실패'));s.src=API+'?'+q.toString();document.body.appendChild(s);
  });
}
function postViaForm(action,data={}){
  // Apps Script ContentService와 GitHub Pages 간 CORS 영향을 피하기 위해
  // 변경 작업도 JSONP 요청으로 전달하며, 서버에서 모든 검증/Lock을 수행합니다.
  return jsonp(action,data);
}
