/* V106 backend adapter
   현재 UI를 갈아엎지 않고 백엔드만 단계적으로 교체하기 위한 어댑터.
   mode=APPS_SCRIPT에서는 기존 V105/V104 동작 유지.
*/
window.YW_BACKEND_V106 = {
  async config(){
    const r = await fetch("./backend-config-v106.json?v=1060",{cache:"no-store"});
    return await r.json();
  },
  async callFunction(name,payload={}){
    const c = await this.config();
    if(c.mode !== "SUPABASE") throw new Error("아직 DB 전환 모드가 아닙니다.");
    const base=(c.functionsBase || `${c.supabaseUrl}/functions/v1`).replace(/\/+$/,"");
    const res=await fetch(`${base}/${name}`,{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify(payload),
      cache:"no-store"
    });
    const text=await res.text();
    let data={};
    try{data=JSON.parse(text)}catch(_){throw new Error("DB 서버 응답 형식 오류")}
    if(!data.ok)throw new Error(data.error||"DB 요청 실패");
    return data;
  }
};
