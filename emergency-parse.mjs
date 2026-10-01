const normalize=x=>String(x||'').trim().replace(/^@/,'').toLowerCase();
const valid=x=>/^[a-z0-9_.]{1,30}$/.test(x);
export function parseExportJson(text){
 const data=JSON.parse(text),rows=Array.isArray(data)?data:data.relationships_following||data.relationships_followers;
 if(!Array.isArray(rows))throw new Error('인스타그램 팔로워·팔로잉 JSON 형식이 아닙니다.');
 const out=[];for(const r of rows){const entries=Array.isArray(r.string_list_data)?r.string_list_data:[];let found=false;for(const x of entries){const id=normalize(x.value);if(valid(id)){out.push(id);found=true;}}if(!found&&valid(normalize(r.title)))out.push(normalize(r.title));}
 return [...new Set(out)];
}
export function parseExportHtml(text){return [...new Set([...text.matchAll(/href=["']https?:\/\/(?:www\.)?instagram\.com\/(?:_u\/)?([a-zA-Z0-9_.]+)\/?[^"']*["']/g)].map(m=>normalize(m[1])))];}
export function classify(roster,followers,following){const a=new Set(followers.map(normalize)),b=new Set(following.map(normalize));return roster.map(x=>({...x,status:a.has(normalize(x.id))?(b.has(normalize(x.id))?'mutual':'fansOnly'):(b.has(normalize(x.id))?'onlyMe':'neither')}));}
