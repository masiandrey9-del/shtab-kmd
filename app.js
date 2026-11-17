/* Штаб КМД — CRM Андрея. Данные: таблица docs (col, id, data jsonb) в Supabase.
   Без настроек в config.js работает демо-режим на seed.json (только локально). */
(function(){
"use strict";
const CFG = window.CRM_CONFIG || {};
const COLS = ["config","clients","deals","tasks","videos","plan","products","templates","inbox","notes","metrics"];
const S = {config:{},clients:{},deals:{},tasks:{},videos:{},plan:{},products:{},templates:{},inbox:{},notes:{},metrics:{}};
const UI = {area:"all", showClosed:false, q:"", showDone:false, showAllOut:false, dragging:false, period:"all", ptab:"services", openP:"", ckind:"main"};
const DEFAULT_DEAL_STAGES = [
  {id:"new",name:"Новое обращение"},{id:"files",name:"Ждём файлы / документы"},{id:"pricing",name:"Считаем цену"},
  {id:"kp",name:"КП отправлено"},{id:"prepay",name:"Предоплата, старт"},{id:"work",name:"В работе (КМ / КМД)"},
  {id:"done",name:"Сдано, ждём оплату"},{id:"paid",name:"Оплачено"},{id:"pause",name:"Пауза"},{id:"lost",name:"Отказ"}];
const DEFAULT_VIDEO_STAGES = [{id:"idea",name:"Идея"},{id:"script",name:"Сценарий"},{id:"voice",name:"Голос записан"},
  {id:"edit",name:"Монтаж"},{id:"ready",name:"Готов к выходу"},{id:"out",name:"Опубликован"}];
const CLOSED = new Set(["paid","lost","pause"]);
const TONE = {new:"hot",files:"",pricing:"hot",kp:"hot",prepay:"work",work:"work",done:"work",paid:"ok",pause:"off",lost:"off",
  idea:"",script:"",voice:"",edit:"work",ready:"hot",out:"ok"};
const PLAN_ST = [["plan","План"],["ready","Готово"],["out","Вышло"]];
const CLIENT_KINDS = [["lead","Обращение"],["client","Клиент"],["regular","Постоянный"],["partner","Партнёр"],["cold","Холодный"],["lost","Не наш"]];
const CHANNELS = ["Telegram","МАКС","WhatsApp","Instagram","ВКонтакте","Звонок","Почта","Авито","Встреча","Другое"];

const $ = (s,el=document)=>el.querySelector(s);
const esc = s => String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const pad = n => String(n).padStart(2,"0");
const ymd = d => d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());
const today = () => ymd(new Date());
const addDays = (s,n) => { const d=new Date(s+"T12:00:00"); d.setDate(d.getDate()+n); return ymd(d); };
const WD = ["вс","пн","вт","ср","чт","пт","сб"];
const fmtD = s => { if(!s) return ""; const d=new Date(s+"T12:00:00"); return pad(d.getDate())+"."+pad(d.getMonth()+1)+" "+WD[d.getDay()]; };
const money = n => (n? Math.round(n).toLocaleString("ru-RU").replace(/,/g," ")+" ₽" : "—");
const newId = p => p+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
const nowIso = () => new Date().toISOString();
const dealStages = () => (S.config.main && S.config.main.dealStages) || DEFAULT_DEAL_STAGES;
const videoStages = () => (S.config.main && S.config.main.videoStages) || DEFAULT_VIDEO_STAGES;
const stageName = (id, list) => (list.find(x=>x.id===id)||{name:id||"—"}).name;
const list = col => Object.entries(S[col]).map(([id,d])=>Object.assign({id},d));

function dueClass(d){ if(!d) return ""; const t=today(); if(d<t) return "over"; if(d===t) return "today"; if(d===addDays(t,1)) return "tom"; return ""; }
function dueLabel(d){ if(!d) return "без срока"; const t=today(); if(d===t) return "сегодня"; if(d===addDays(t,1)) return "завтра";
  if(d<t){ const n=Math.round((new Date(t)-new Date(d))/864e5); return fmtD(d)+" · −"+n+" дн."; } return fmtD(d); }

/* ---------- backend ---------- */
let sb = null, demo = false, renderQueued = false;
function setSync(text, cls){ const el=$("#sync"); el.textContent=text; el.className="sync "+(cls||""); }
function apply(col,id,data){ if(!S[col]) return; if(data==null) delete S[col][id]; else S[col][id]=data; queueRender(); }

async function boot(){
  if(CFG.supabaseUrl && CFG.supabaseKey && window.supabase){
    sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {auth:{persistSession:true, autoRefreshToken:true}});
    const {data:{session}} = await sb.auth.getSession();
    if(!session){ showLogin(); return; }
    if(await needMfa()){ showMfa(); return; }
    await startSupabase();
  } else {
    demo = true;
    let st=null; try{ st=JSON.parse(localStorage.getItem("crm-demo")||"null"); }catch(e){}
    if(!st){ try{ st=await (await fetch("seed.json")).json(); }catch(e){ st={}; } }
    COLS.forEach(c=>S[c]=st[c]||{});
    setSync("демо-режим","demo");
    render();
  }
}
function showLogin(){
  $("#login").hidden=false; $("#loginForm").hidden=false; $("#mfaForm").hidden=true;
  $("#loginForm").onsubmit = async e => {
    e.preventDefault(); $("#lErr").hidden=true;
    const btn=e.target.querySelector("button[type=submit]"); btn.disabled=true;
    const {error} = await sb.auth.signInWithPassword({email:$("#lEmail").value.trim(), password:$("#lPass").value});
    btn.disabled=false; $("#lPass").value="";
    if(error){ $("#lErr").textContent = /rate|many/i.test(error.message)? "Слишком много попыток. Подождите несколько минут." : "Не вышло войти: проверьте почту и пароль."; $("#lErr").hidden=false; return; }
    if(await needMfa()){ showMfa(); return; }
    $("#login").hidden=true; await startSupabase();
  };
}
/* Вход с кодом из приложения (2FA): если он включён, без кода база данные не отдаёт. */
async function needMfa(){
  try{ const {data,error}=await sb.auth.mfa.getAuthenticatorAssuranceLevel(); if(error) return false;
    return data.nextLevel==="aal2" && data.currentLevel!=="aal2"; }catch(e){ return false; }
}
function showMfa(){
  $("#login").hidden=false; $("#loginForm").hidden=true; $("#mfaForm").hidden=false; $("#lCode").value=""; $("#lCode").focus();
  $("#mfaCancel").onclick=logout;
  $("#mfaForm").onsubmit = async e => {
    e.preventDefault(); $("#mErr").hidden=true;
    const {data:f}=await sb.auth.mfa.listFactors(); const fac=((f&&f.totp)||[]).find(x=>x.status==="verified");
    if(!fac){ $("#login").hidden=true; await startSupabase(); return; }
    const {error}=await sb.auth.mfa.challengeAndVerify({factorId:fac.id, code:$("#lCode").value.trim()});
    if(error){ $("#mErr").textContent="Код не подошёл. Введите свежий код из приложения."; $("#mErr").hidden=false; return; }
    $("#login").hidden=true; await startSupabase();
  };
}
async function logout(){ try{ await sb.auth.signOut(); }catch(e){} try{ localStorage.removeItem("crm-notified"); }catch(e){} location.replace(location.pathname); }
let started=false;
async function loadAll(){
  const {data, error} = await sb.from("docs").select("col,id,data").range(0,9999);
  if(error){
    setSync("нет связи с базой","bad");
    if(/jwt|token|auth/i.test(error.message)){ showLogin(); } else toast("База не отвечает: "+error.message);
    return false;
  }
  COLS.forEach(c=>S[c]={});
  data.forEach(r=>{ if(S[r.col]) S[r.col][r.id]=r.data; });
  queueRender();
  return true;
}
async function startSupabase(){
  setSync("загрузка…");
  if(!(await loadAll())) return;
  if(started) return; started=true;
  sb.auth.onAuthStateChange(ev=>{ if(ev==="SIGNED_OUT") location.replace(location.pathname); });
  sb.channel("docs-live").on("postgres_changes",{event:"*",schema:"public",table:"docs"}, p=>{
    if(p.eventType==="DELETE") apply(p.old.col,p.old.id,null); else apply(p.new.col,p.new.id,p.new.data);
  }).subscribe(st=>{ setSync(st==="SUBSCRIBED"?"онлайн":"переподключение…", st==="SUBSCRIBED"?"":"bad"); });
  document.addEventListener("visibilitychange", ()=>{ if(document.visibilityState==="visible") loadAll(); });
  window.addEventListener("online", ()=>loadAll());
  startNotifier();
}
function saveDemo(){ try{ localStorage.setItem("crm-demo", JSON.stringify(S)); }catch(e){} }
async function save(col,id,data){
  data = Object.assign({}, data, {updatedAt: nowIso()}); delete data.id;
  S[col][id]=data; queueRender();
  if(demo){ saveDemo(); return true; }
  const {error} = await sb.from("docs").upsert({col,id,data,updated_at:data.updatedAt});
  if(error){ toast("Не сохранилось: "+(navigator.onLine?error.message:"нет интернета")); loadAll(); return false; }
  return true;
}
async function remove(col,id){
  delete S[col][id]; queueRender();
  if(demo){ saveDemo(); return; }
  const {error} = await sb.from("docs").delete().eq("col",col).eq("id",id);
  if(error){ toast("Не удалилось: "+error.message); loadAll(); }
}
function strip(o){ const c=Object.assign({},o); delete c.id; return c; }

/* ---------- render ---------- */
function queueRender(){ if(renderQueued) return; renderQueued=true; requestAnimationFrame(()=>{ renderQueued=false; if(!UI.dragging) render(); }); }
function view(){ const h=(location.hash||"#today").slice(1); return ["today","board","clients","money","marketing","products"].includes(h)?h:"today"; }
function render(){
  const v=view();
  document.querySelectorAll("[data-v]").forEach(a=>a.classList.toggle("on",a.dataset.v===v));
  const el=$("#view"); const y=window.scrollY;
  const bw = el.querySelector(".board-wrap"); const bx = bw? bw.scrollLeft : 0;
  el.innerHTML = (demo? '<div class="banner">Демо-режим: данные хранятся только в этом браузере. После подключения базы всё будет общим для телефона, компьютера и Claude.</div>':"") +
    ({today:vToday,board:vBoard,clients:vClients,money:vMoney,marketing:vMarketing,products:vProducts})[v]();
  const nb = el.querySelector(".board-wrap"); if(nb) nb.scrollLeft=bx;
  window.scrollTo(0,y);
  initSortables();
  if(drawerState) refreshDrawerLists();
}

function taskRow(t){
  const deal = t.dealId && S.deals[t.dealId]; const cl = t.clientId && S.clients[t.clientId]; const vid = t.videoId && S.videos[t.videoId];
  const links = [];
  if(cl) links.push(`<a class="t-link" data-act="client" data-id="${esc(t.clientId)}">${esc(cl.name)}</a>`);
  if(deal) links.push(`<a class="t-link" data-act="deal" data-id="${esc(t.dealId)}">${esc(short(deal.title,38))}</a>`);
  if(vid) links.push(`<a class="t-link" data-act="video" data-id="${esc(t.videoId)}">${vid.num?"№"+vid.num+" ":""}${esc(vid.title)}</a>`);
  return `<div class="task ${t.done?"done":""}">
    <input type="checkbox" class="chk" data-act="toggle" data-id="${esc(t.id)}" ${t.done?"checked":""} aria-label="Выполнено">
    <div class="t-body" data-act="task" data-id="${esc(t.id)}">
      <div class="t-title">${t.time&&!t.done?`<span class="t-time">${esc(t.time)}</span>`:""}${esc(t.title)}</div>
      <div class="t-meta">${links.join(" · ")}
        ${t.area==="marketing"?'<span class="tag mk">маркетинг</span>':""}
        ${t.waiting?'<span class="tag wait">ждём клиента</span>':""}
        ${t.draft?'<span class="tag">есть черновик</span>':""}
        ${t.by==="claude"?'<span class="tag claude">Claude</span>':""}</div>
      ${cl?reachLine(cl):""}
    </div>
    <span class="due ${t.done?"":dueClass(t.due)}">${t.done?"готово":esc(dueLabel(t.due))}</span>
  </div>`;
}

/* ---------- где общаемся с клиентом ---------- */
function reachParts(c){
  if(!c) return [];
  const out=[], seen=new Set(); const add=(txt,href)=>{ const k=txt.toLowerCase(); if(!txt||seen.has(k)) return; seen.add(k); out.push({txt,href}); };
  const src = [c.where, c.where?"":c.messenger, c.phone, c.email].filter(Boolean).join("\n");
  const ch = [c.where,c.messenger,c.lastChannel,c.source].filter(Boolean).join(" ");
  for(const raw of src.split(/[\n,;]+/)){
    const line=raw.trim(); if(!line) continue;
    const ig=/instagram|инст|\bIG\b|директ/i.test(line), tg=/telegram|телег|\bTG\b|тг/i.test(line);
    const nick=(line.match(/@([A-Za-z0-9_.]{3,})/)||line.match(/(?:^|\s)([A-Za-z0-9_.]{3,})\s*$/)||[])[1];
    const mail=(line.match(/[\w.+-]+@[\w-]+\.[\w.]+/)||[])[0];
    const tel=(line.match(/(\+7|8)[\d\s()\-]{9,}/)||[])[0];
    if(mail){ add(line,"mailto:"+mail); continue; }
    if(tel && !/[A-Za-z]{3}/.test(line.replace(tel,""))){ add(line,"tel:"+tel.replace(/[^\d+]/g,"")); continue; }
    if(nick && !/директ/i.test(line) && (tg || (!ig && /telegram|тг/i.test(ch) && line.startsWith("@")))){ add(line,"https://t.me/"+nick.replace(/^@/,"")); continue; }
    if(ig && /директ/i.test(line)){ add(line,"https://www.instagram.com/direct/inbox/"); continue; }
    if(nick && (ig || /instagram/i.test(ch)) && !/директ/i.test(line)){ add(line,"https://instagram.com/"+nick.replace(/^@/,"")); continue; }
    add(line,"");
  }
  return out;
}
function reachLine(c, cls){
  const ps=reachParts(c); if(!ps.length) return "";
  return `<div class="${cls||"t-reach"}">💬 ${ps.slice(0,3).map(p=>p.href?`<a href="${esc(p.href)}" target="_blank" rel="noopener" data-act="ext">${esc(short(p.txt,40))}</a>`:`<span>${esc(short(p.txt,40))}</span>`).join(" · ")}</div>`;
}
const short = (s,n) => { s=String(s||""); return s.length>n? s.slice(0,n-1)+"…" : s; };

function taskGroups(tasks){
  const t=today(), tom=addDays(t,1), wk=addDays(t,7);
  const g={over:[],today:[],tom:[],week:[],later:[],none:[]};
  tasks.filter(x=>!x.done).forEach(x=>{
    if(!x.due) g.none.push(x); else if(x.due<t) g.over.push(x); else if(x.due===t) g.today.push(x);
    else if(x.due===tom) g.tom.push(x); else if(x.due<=wk) g.week.push(x); else g.later.push(x);
  });
  Object.values(g).forEach(a=>a.sort((a,b)=>(a.due||"9").localeCompare(b.due||"9")||(a.time||"99").localeCompare(b.time||"99")||String(a.title).localeCompare(b.title)));
  return g;
}
function taskSection(title, arr, cls, collapsedAfter){
  if(!arr.length) return "";
  const lim = collapsedAfter && !UI["open_"+title] ? collapsedAfter : 1e9;
  const rows = arr.slice(0,lim).map(taskRow).join("");
  const more = arr.length>lim ? `<button class="more" data-act="expand" data-k="${esc(title)}">Показать ещё ${arr.length-lim}</button>`:"";
  return `<h2 class="sec ${cls||""}">${title} <span class="n">${arr.length}</span></h2><div class="tasks">${rows}${more}</div>`;
}
function quickAdd(area){
  return `<form class="quick" data-form="quick" data-area="${area}">
    <input type="text" name="title" placeholder="Новая задача: что сделать" aria-label="Новая задача" required>
    <input type="date" name="due" value="${today()}" aria-label="Срок">
    <input type="time" name="time" aria-label="Время напоминания" title="Время: бот напомнит в Телеграм">
    <button class="btn primary" type="submit">Добавить</button></form>`;
}

function vToday(){
  const all = list("tasks").filter(x=> UI.area==="all" || x.area===UI.area);
  const g = taskGroups(all);
  const deals = list("deals");
  const open = deals.filter(d=>!CLOSED.has(d.stage));
  const kpSum = open.filter(d=>["kp","pricing"].includes(d.stage)).reduce((s,d)=>s+(+d.amount||0),0);
  const owed = deals.filter(d=>d.stage==="done").reduce((s,d)=>s+Math.max(0,(+d.amount||0)-(+d.paid||0)),0);
  const doneToday = all.filter(x=>x.done && (x.doneAt||"").slice(0,10)===today());
  const d = new Date();
  return `<div class="h-row"><h1 class="page">Сегодня, ${d.getDate()} ${["января","февраля","марта","апреля","мая","июня","июля","августа","сентября","октября","ноября","декабря"][d.getMonth()]}</h1>
    <div class="chips" role="group" aria-label="Фильтр">${[["all","Все"],["clients","Клиенты"],["marketing","Маркетинг"]].map(([k,l])=>`<button class="chip ${UI.area===k?"on":""}" data-act="area" data-k="${k}">${l}</button>`).join("")}</div></div>
  <div class="strip">
    <div><div class="k">Просрочено</div><div class="v ${g.over.length?"bad":""}">${g.over.length}</div></div>
    <div><div class="k">Сегодня</div><div class="v acc">${g.today.length}</div></div>
    <div><div class="k">КП на руках</div><div class="v">${money(kpSum)}</div></div>
    <div><div class="k">Ждём оплату</div><div class="v">${money(owed)}</div></div>
  </div>
  ${quickAdd(UI.area==="marketing"?"marketing":"clients")}
  ${taskSection("Сегодня", g.today, "today")}
  ${taskSection("Завтра", g.tom)}
  ${taskSection("Просрочено", g.over, "bad", 6)}
  ${taskSection("На неделе", g.week)}
  ${taskSection("Позже", g.later, "", 5)}
  ${taskSection("Без срока", g.none, "", 5)}
  ${doneToday.length? `<h2 class="sec">Сделано сегодня <span class="n">${doneToday.length}</span></h2><div class="tasks">${doneToday.map(taskRow).join("")}</div>`:""}
  ${(!g.today.length&&!g.tom.length&&!g.over.length&&!g.week.length)?'<div class="tasks"><div class="empty">На ближайшую неделю задач нет. Добавьте задачу выше или попросите Claude.</div></div>':""}`;
}

function nextTask(filterFn){
  return list("tasks").filter(t=>!t.done && filterFn(t)).sort((a,b)=>(a.due||"9").localeCompare(b.due||"9"))[0];
}
function vBoard(){
  const stages = dealStages().filter(s=>UI.showClosed || !CLOSED.has(s.id));
  const deals = list("deals");
  const cols = stages.map(s=>{
    const ds = deals.filter(d=>d.stage===s.id).sort((a,b)=>(a.order??1e9)-(b.order??1e9)||String(b.updatedAt).localeCompare(String(a.updatedAt)));
    const sum = ds.reduce((x,d)=>x+(+d.amount||0),0);
    return `<section class="col" data-tone="${TONE[s.id]||""}"><div class="col-h"><b>${esc(s.name)}</b><span>${ds.length}${sum?" · "+money(sum):""}</span></div>
      <div class="col-list" data-sort="deals" data-stage="${s.id}">${ds.map(dealCard).join("")}</div></section>`;
  }).join("");
  const closedN = deals.filter(d=>CLOSED.has(d.stage)).length;
  return `<div class="h-row"><h1 class="page">Воронка объектов</h1>
    <div class="chips"><button class="chip ${UI.showClosed?"on":""}" data-act="closed">Оплачено, пауза, отказ (${closedN})</button>
    <button class="btn sm" data-act="newDeal">+ Объект</button></div></div>
    <p class="muted" style="margin:-6px 0 12px;font-size:13.5px">Перетащите карточку в другую колонку, чтобы сменить этап. На телефоне: нажмите и подержите карточку.</p>
    <div class="board-wrap"><div class="board">${cols}</div></div>`;
}
function dealCard(d){
  const cl = S.clients[d.clientId]; const nt = nextTask(t=>t.dealId===d.id);
  return `<article class="card" data-id="${esc(d.id)}" data-act="deal">
    <div class="c-client">${esc(cl?cl.name:"Без клиента")}</div>
    <div class="c-title">${esc(d.title)}</div>
    <div class="c-foot">${d.amount?`<span class="sum">${money(d.amount)}</span>`:""}
      ${nt?`<span class="due ${dueClass(nt.due)}" title="${esc(nt.title)}">${esc(dueLabel(nt.due))}</span>`:""}
      ${nt&&nt.waiting?'<span class="who">ждём клиента</span>':(d.whose==="Андрей"||d.whose==="Я")?'<span class="who">ход наш</span>':""}</div>
  </article>`;
}

function vClients(){
  const q = UI.q.toLowerCase();
  const kindOk = c => UI.ckind==="cold" ? c.kind==="cold" : UI.ckind==="all" ? true : c.kind!=="cold";
  const cls = list("clients").filter(kindOk).filter(c=> !q || [c.name,c.where,c.company,c.source,c.contact,c.about,c.city,c.phone,c.messenger,c.email,c.inn,c.theirClients,c.firstMessage,c.notes,c.tags].join(" ").toLowerCase().includes(q) ||
    list("deals").some(d=>d.clientId===c.id && String(d.title).toLowerCase().includes(q)));
  const rows = cls.map(c=>{
    const ds = list("deals").filter(d=>d.clientId===c.id);
    const nt = nextTask(t=>t.clientId===c.id);
    const active = ds.some(d=>!CLOSED.has(d.stage));
    return {c,ds,nt,active};
  }).sort((a,b)=> (b.active-a.active) || (a.nt?a.nt.due||"9":"99").localeCompare(b.nt?b.nt.due||"9":"99") || a.c.name.localeCompare(b.c.name));
  const coldN=list("clients").filter(c=>c.kind==="cold").length;
  return `<div class="h-row"><h1 class="page">Клиенты <span class="muted mono" style="font-size:16px">${cls.length}</span></h1>
    <div class="chips"><button class="chip ${UI.ckind==="main"?"on":""}" data-act="ckind" data-k="main">Клиенты и обращения</button><button class="chip ${UI.ckind==="cold"?"on":""}" data-act="ckind" data-k="cold">Обзвон (${coldN})</button>
    <button class="btn primary sm" data-act="newClient">+ Клиент</button></div></div>
    ${UI.ckind==="cold"?'<p class="hint" style="margin:-6px 0 10px">Компании для звонков. Откройте карточку, запишите итог звонка в «Переписку» и поставьте задачу «перезвонить» со временем: бот напомнит.</p>':""}
    <div class="searchbar"><input type="search" id="q" placeholder="Поиск: имя, город, телефон, объект" value="${esc(UI.q)}" aria-label="Поиск клиентов"></div>
    <div class="clist"><div class="crow crow-h"><div>Клиент</div><div>Откуда / контакт</div><div>Объекты и этапы</div><div>Ближайшее</div></div>
    ${rows.map(({c,ds,nt})=>`<div class="crow" data-act="client" data-id="${esc(c.id)}">
      <div class="nm">${esc(c.name)}${(c.company||c.city)?`<div class="src">${esc(short([c.company,c.city].filter(Boolean).join(" · "),48))}</div>`:""}</div>
      <div class="src">${esc(c.source||"")}${reachParts(c).length?"<br>💬 "+esc(short(reachParts(c).map(p=>p.txt).join(" · "),60)):(c.contact?"<br>"+esc(short(c.contact,48)):"")}</div>
      <div class="pills">${ds.map(d=>`<span class="pill" data-tone="${TONE[d.stage]||""}" title="${esc(d.title)}">${esc(stageName(d.stage,dealStages()))}</span>`).join("")||'<span class="muted">нет объектов</span>'}</div>
      <div>${nt?`<span class="due ${dueClass(nt.due)}">${esc(dueLabel(nt.due))}</span>`:'<span class="muted" style="font-size:13px">—</span>'}</div>
    </div>`).join("") || '<div class="empty">Никого не нашлось.</div>'}</div>`;
}

function vMarketing(){
  const tasks = list("tasks").filter(t=>t.area==="marketing");
  const g = taskGroups(tasks);
  const open = [...g.over,...g.today,...g.tom,...g.week,...g.later,...g.none];
  const t=today(), from=addDays(t,-7);
  const plan = list("plan").filter(p=>!p.date || p.date>=from).sort((a,b)=>(a.date||"9").localeCompare(b.date||"9"));
  const vids = list("videos");
  const vcols = videoStages().map(s=>{
    let vs = vids.filter(v=>v.stage===s.id).sort((a,b)=> s.id==="out" ? (b.num||0)-(a.num||0) : (a.order??1e9)-(b.order??1e9)||(a.num||0)-(b.num||0));
    const total=vs.length; let more="";
    if(s.id==="out" && !UI.showAllOut && vs.length>6){ vs=vs.slice(0,6); more=`<button class="more" data-act="allOut">Ещё ${total-6}</button>`; }
    return `<section class="col" data-tone="${TONE[s.id]||""}"><div class="col-h"><b>${esc(s.name)}</b><span>${total}</span></div>
      <div class="col-list" data-sort="videos" data-stage="${s.id}">${vs.map(videoCard).join("")}</div>${more}</section>`;
  }).join("");
  return `<div class="h-row"><h1 class="page">Маркетинг</h1><div class="chips"><button class="btn sm" data-act="newVideo">+ Ролик</button><button class="btn sm" data-act="newPlan">+ В медиаплан</button></div></div>
  ${vMetrics()}
  <div class="mk-grid">
    <div><h2 class="sec" style="margin-top:4px">Задачи <span class="n">${open.length}</span></h2>
      ${quickAdd("marketing")}
      <div class="tasks">${open.map(taskRow).join("")||'<div class="empty">Задач по маркетингу нет.</div>'}</div></div>
    <div><h2 class="sec" style="margin-top:4px">Медиаплан <span class="n">${plan.length}</span></h2>
      <div class="plan">${plan.map(p=>{ const v=p.videoId&&S.videos[p.videoId];
        return `<div class="prow ${p.date&&p.date<t?"past":""}"><div class="pd">${p.date?fmtD(p.date).slice(0,5):"—"}<small>${esc(p.slot||(p.date?fmtD(p.date).slice(6):""))}</small></div>
        <div class="pt" data-act="plan" data-id="${p.id}"><b>${esc(p.title)}</b><div class="pk">${esc(p.kind||"")}${v?" · "+(v.num?"№"+v.num+" ":"")+esc(v.title):""}</div></div>
        <button class="st" data-act="planSt" data-id="${p.id}" data-s="${p.status||"plan"}">${esc((PLAN_ST.find(x=>x[0]===(p.status||"plan"))||PLAN_ST[0])[1])}</button></div>`; }).join("")||'<div class="empty">Медиаплан пуст.</div>'}</div></div>
  </div>
  <h2 class="sec">Ролики</h2>
  <div class="board-wrap"><div class="board">${vcols}</div></div>`;
}
function videoCard(v){
  const nt = nextTask(t=>t.videoId===v.id);
  return `<article class="card vcard" data-id="${esc(v.id)}" data-act="video">
    <div class="c-client">${v.num?`<span class="num">№${v.num}</span>`:""}${esc(v.title)}</div>
    ${v.notes?`<div class="c-title">${esc(v.notes)}</div>`:""}
    <div class="c-foot">${v.date?`<span class="due">${esc(fmtD(v.date))}</span>`:""}${nt?`<span class="due ${dueClass(nt.due)}" title="${esc(nt.title)}">${esc(short(nt.title,22))}</span>`:""}</div>
  </article>`;
}

/* ---------- drag & drop ---------- */
let sortables=[];
function initSortables(){
  sortables.forEach(s=>s.destroy()); sortables=[];
  if(!window.Sortable) return;
  document.querySelectorAll("[data-sort]").forEach(el=>{
    sortables.push(Sortable.create(el,{group:el.dataset.sort, animation:150, delay:180, delayOnTouchOnly:true, ghostClass:"sortable-ghost", chosenClass:"sortable-chosen",
      onStart:()=>{UI.dragging=true;},
      onEnd: async ev=>{
        UI.dragging=false;
        const col = el.dataset.sort, id = ev.item.dataset.id, to = ev.to.dataset.stage, from = ev.from.dataset.stage;
        const items = [...ev.to.children].map(c=>c.dataset.id);
        const doc = S[col][id]; if(!doc){ render(); return; }
        if(to!==from){
          const upd = Object.assign({}, doc, {stage:to, order:ev.newIndex});
          if(col==="deals"){ upd.log = (doc.log||[]).concat([{at:today(),by:"Андрей",text:"Этап: "+stageName(from,dealStages())+" → "+stageName(to,dealStages())}]); }
          if(col==="videos" && to==="out" && !doc.date) upd.date=today();
          await save(col,id,upd);
          toast((col==="deals"?"Объект":"Ролик")+" → "+stageName(to, col==="deals"?dealStages():videoStages()));
        } else if(ev.oldIndex!==ev.newIndex){
          for(let i=0;i<items.length;i++){ const d=S[col][items[i]]; if(d && d.order!==i) await save(col,items[i],Object.assign({},d,{order:i})); }
        }
        render();
      }}));
  });
}

/* ---------- drawer ---------- */
let drawerState=null, drawerStack=[];
const KIND_NAME={task:"задаче",client:"клиенту",deal:"объекту",video:"ролику",plan:"плану",product:"услуге",template:"шаблону"};
function openDrawer(kind,id,preset){
  if(drawerState && !$("#drawer").hidden && !(drawerState.kind===kind && drawerState.id===id && id)) drawerStack.push(drawerState);
  drawerState={kind,id,preset:preset||{}}; drawRender(); const b=$("#drawer .d-body"); if(b) b.scrollTop=0; $("#drawer").hidden=false; $("#scrim").hidden=false; document.body.style.overflow="hidden"; }
function drawerBack(){ if(!drawerStack.length){ closeDrawer(); return; } drawerState=drawerStack.pop(); drawRender(); }
function closeDrawer(){ if(recOn&&rec){ try{rec.stop();}catch(e){} } drawerState=null; drawerStack=[]; $("#drawer").hidden=true; $("#scrim").hidden=true; document.body.style.overflow=""; }
function opt(list,val,empty){ return (empty!=null?`<option value="">${esc(empty)}</option>`:"")+list.map(([v,l])=>`<option value="${esc(v)}" ${v===val?"selected":""}>${esc(l)}</option>`).join(""); }
function fld(label,html){ return `<label class="f">${label}</label>${html}`; }
const inp = (name,val,type="text",extra="") => `<input type="${type}" id="f_${name}" name="${name}" value="${esc(val==null?"":val)}" ${extra}>`;
const area = (name,val,rows) => `<textarea id="f_${name}" name="${name}" rows="${rows||4}">${esc(val||"")}</textarea>`;
const clientOpts = sel => opt(list("clients").sort((a,b)=>a.name.localeCompare(b.name)).map(c=>[c.id,c.name]), sel, "— без клиента —");

function drawRender(){
  const {kind,id,preset}=drawerState; const isNew=!id; const D=$("#drawer");
  const doc = isNew ? Object.assign({},preset) : Object.assign({id}, (S[colOf(kind)]||{})[id]||{});
  let eyebrow="", title="", body="", side="";
  if(kind==="deal"){
    const cl=S.clients[doc.clientId];
    eyebrow = cl? esc(cl.name) : "Объект"; title = isNew? "Новый объект" : esc(doc.title);
    body = fld("Клиент",`<select id="f_clientId" name="clientId">${clientOpts(doc.clientId)}</select>`)+
      fld("Что за объект / что нужно", area("title",doc.title,2))+
      fld("Этап",`<select id="f_stage" name="stage">${opt(dealStages().map(s=>[s.id,s.name]),doc.stage||"new")}</select>`)+
      `<div class="grid2">${fld("Сумма, ₽",inp("amount",doc.amount||"","number","inputmode=numeric"))}${fld("Оплачено, ₽",inp("paid",doc.paid||"","number","inputmode=numeric"))}
       ${fld("Чей ход",`<select id="f_whose" name="whose">${opt([["Андрей","Наш"],["Клиент","Клиента"]],doc.whose==="Я"?"Андрей":doc.whose,"—")}</select>`)}${fld("Последний контакт",inp("lastContact",doc.lastContact,"date"))}</div>`+
      fld("Следующий шаг", area("nextAction",doc.nextAction,2))+
      (isNew?"":`<div id="payBox">${paymentsBlock(doc,id)}</div>`)+
      fld("Заметки", area("notes",doc.notes,5))+
      (isNew?"":`<h2 class="sec">Задачи по объекту</h2><div class="sub" id="dl_tasks"></div>
        <div class="addline"><button class="btn sm" data-act="newTaskFor" data-deal="${id}" data-client="${doc.clientId||""}">+ Задача</button></div>
        <h2 class="sec">История</h2><div class="addline"><input type="text" id="f_lognew" placeholder="Пометка: что произошло"><button class="btn sm" data-act="addLog">Добавить</button></div>
        <ul class="log" id="dl_log"></ul>`);
  }
  if(kind==="client"){
    eyebrow="Клиент"+(doc.kind?" · "+esc((CLIENT_KINDS.find(k=>k[0]===doc.kind)||["",doc.kind])[1]):""); title=isNew?"Новый клиент":esc(doc.name);
    const ds = isNew?[]:list("deals").filter(d=>d.clientId===id);
    const sumAll = ds.reduce((x,d)=>x+(+d.amount||0),0), paidAll = ds.reduce((x,d)=>x+(+d.paid||0),0);
    body = (isNew?"":`<div class="facts">
        <div><span>Город</span><b>${esc(doc.city||"—")}</b></div><div><span>Откуда</span><b>${esc(doc.source||"—")}</b></div>
        <div><span>Первый контакт</span><b>${doc.firstContact?esc(fmtD(doc.firstContact)):"—"}</b></div>
        <div><span>Объектов</span><b>${ds.length}${sumAll?" · "+money(sumAll):""}</b></div><div><span>Оплачено</span><b>${money(paidAll)}</b></div></div>`)+
      (isNew?"":reachLine(doc,"reach-box"))+
      fld("Где общаемся и как найти",inp("where",doc.where,"text",'placeholder="Telegram @ник / Instagram ник / телефон / почта"'))+
      `<div class="grid2">${fld("Имя",inp("name",doc.name,"text","required"))}${fld("Тип",`<select id="f_kind" name="kind">${opt(CLIENT_KINDS,doc.kind||"lead")}</select>`)}</div>`+
      `<div class="grid2">${fld("Компания",inp("company",doc.company))}${fld("Город",inp("city",doc.city))}</div>`+
      `<div class="grid2">${fld("Откуда пришёл",inp("source",doc.source,"text",'list="srcList"'))}${fld("Первый контакт",inp("firstContact",doc.firstContact,"date"))}</div>
       <datalist id="srcList"><option>Instagram</option><option>Telegram</option><option>МАКС</option><option>ВКонтакте</option><option>Авито</option><option>Профи.ру</option><option>Сайт</option><option>Почта</option><option>Звонок</option><option>Биржа stroy-control1</option><option>Сарафан</option></datalist>`+
      fld("Что написал в первый раз",area("firstMessage",doc.firstMessage,3))+
      `<div class="grid2">${fld("Телефон",inp("phone",doc.phone,"tel"))}${fld("Мессенджер / ник",inp("messenger",doc.messenger,"text",'placeholder="@ник, МАКС, Instagram"'))}</div>`+
      `<div class="grid2">${fld("Почта / сайт",inp("email",doc.email))}${fld("ИНН / реквизиты",inp("inn",doc.inn))}</div>`+
      fld("Другие контакты",inp("contact",doc.contact))+
      fld("Чем занимается",area("about",doc.about,2))+
      fld("Его заказчики / для кого работает",area("theirClients",doc.theirClients,2))+
      fld("Метки",inp("tags",doc.tags,"text",'placeholder="через запятую: завод, ГИП, срочно"'))+
      fld("Заметки",area("notes",doc.notes,3))+
      (isNew?"":`<h2 class="sec">Объекты</h2><div class="sub" id="dl_deals"></div>
        <div class="addline"><button class="btn sm" data-act="newDealFor" data-client="${esc(id)}">+ Объект</button></div>
        <h2 class="sec">Задачи</h2><div class="sub" id="dl_tasks"></div>
        <div class="addline"><button class="btn sm" data-act="newTaskFor" data-client="${esc(id)}">+ Задача</button></div>
        <h2 class="sec">Переписка и события</h2>
        <div class="addline wrap"><select id="f_lch" aria-label="Канал">${opt(CHANNELS.map(c=>[c,c]),doc.lastChannel||CHANNELS[0])}</select>
          <select id="f_ldir" aria-label="Кто писал">${opt([["in","Клиент написал"],["out","Мы ответили"],["note","Пометка"]],"in")}</select></div>
        <div class="addline"><textarea id="f_lnew" rows="2" placeholder="Что написал / что ответили (можно вставить текст целиком)"></textarea><button class="btn sm" data-act="addCLog">Добавить</button></div>
        <ul class="log" id="dl_clog"></ul>`)+
      fld("Старая история переписки (текстом)",area("history",doc.history,6));
  }
  if(kind==="task"){
    eyebrow = doc.by==="claude"?"Задача · поставил Claude":"Задача"; title=isNew?"Новая задача":esc(doc.title);
    const deals = list("deals").filter(d=>!doc.clientId || d.clientId===doc.clientId);
    const tcl = doc.clientId&&S.clients[doc.clientId], tdl = doc.dealId&&S.deals[doc.dealId];
    body = (tcl?`<div class="reach-box"><b>${esc(tcl.name)}</b> — где общаемся:${reachLine(tcl,"reach-in")||' <span class="muted">не указано, впишите в карточке клиента</span>'}</div>`:"")+
      (isNew?"":`<div class="d-acts">${tcl?`<button class="btn sm" data-act="client" data-id="${esc(doc.clientId)}">👤 Карточка клиента</button>`:""}${tdl?`<button class="btn sm" data-act="deal" data-id="${esc(doc.dealId)}">📁 Объект</button>`:""}<button class="btn sm primary" data-act="newTaskFor" data-client="${esc(doc.clientId||"")}" data-deal="${esc(doc.dealId||"")}">+ Новая задача${tcl?" по клиенту":""}</button></div>`)+
      fld("Что сделать",area("title",doc.title,2))+
      `<div class="grid2">${fld("Срок",inp("due",doc.due,"date"))}${fld("Время напоминания",inp("time",doc.time,"time"))}</div>`+
      `<p class="hint">${doc.time?(doc.remindedAt?"Напоминание уже пришло в Телеграм. Поменяете срок или время, придёт снова.":"Бот напомнит в Телеграм в это время."):"Укажите время, и бот напомнит в Телеграм."}</p>`+
      fld("Раздел",`<select id="f_area" name="area">${opt([["clients","Клиенты"],["marketing","Маркетинг"]],doc.area||"clients")}</select>`)+
      fld("Клиент",`<select id="f_clientId" name="clientId">${clientOpts(doc.clientId)}</select>`)+
      fld("Объект",`<select id="f_dealId" name="dealId">${opt(deals.map(d=>[d.id,(S.clients[d.clientId]||{}).name+": "+short(d.title,50)]),doc.dealId,"— без объекта —")}</select>`)+
      fld("Ролик",`<select id="f_videoId" name="videoId">${opt(list("videos").sort((a,b)=>(b.num||0)-(a.num||0)).map(v=>[v.id,(v.num?"№"+v.num+" ":"")+v.title]),doc.videoId,"— без ролика —")}</select>`)+
      `<label class="f" style="display:flex;gap:8px;align-items:center;text-transform:none;letter-spacing:0;font:15px var(--f-body);color:var(--ink)"><input type="checkbox" id="f_waiting" name="waiting" ${doc.waiting?"checked":""}> Ждём ответа клиента</label>`+
      fld("Пометка",area("note",doc.note,3))+
      fld("Черновик сообщения клиенту",area("draft",doc.draft,4))+
      (doc.draft?`<div class="addline"><button class="btn sm" data-act="copyDraft">Скопировать черновик</button></div>`:"");
  }
  if(kind==="voice"){ eyebrow="Голосовой ввод"; title="Задача или мысль голосом"; body=voiceBody(); }
  if(kind==="product"){ eyebrow="Услуга"; title=isNew?"Новая услуга":esc(doc.name);
    body=`<div class="grid2">${fld("Название",inp("name",doc.name))}${fld("Раздел",inp("group",doc.group||"Металлоконструкции"))}</div>`+
      `<div class="grid2">${fld("Цена (коротко)",inp("price",doc.price,"text",'placeholder="от 25 000 ₽"'))}${fld("Срок",inp("term",doc.term))}</div>`+
      fld("Кратко (одна фраза)",area("short",doc.short,2))+fld("Подробно: что делаем и что получает клиент",area("full",doc.full,7))+
      fld("Прайс: каждая строка «позиция | цена | примечание»",area("pricesText",(doc.prices||[]).map(r=>[r.item,r.price,r.note||""].join(" | ")).join("\n"),5))+
      fld("Не входит",area("notIncluded",doc.notIncluded,2))+fld("Порядок",inp("order",doc.order||"","number")); }
  if(kind==="template"){ eyebrow="Шаблон"; title=isNew?"Новый шаблон":esc(doc.title);
    body=`<div class="grid2">${fld("Название",inp("title",doc.title))}${fld("Группа",inp("group",doc.group||"Ответы клиентам"))}</div>`+fld("Текст",area("text",doc.text,10))+fld("Порядок",inp("order",doc.order||"","number")); }
  if(kind==="settings"){ eyebrow="Настройки"; title="Безопасность и уведомления"; body='<div id="setBody"><p class="muted">Загрузка…</p></div>'; }
  if(kind==="video"){
    eyebrow="Ролик"; title=isNew?"Новый ролик":(doc.num?"№"+doc.num+" ":"")+esc(doc.title);
    body = `<div class="grid2">${fld("Номер",inp("num",doc.num||"","number"))}${fld("Этап",`<select id="f_stage" name="stage">${opt(videoStages().map(s=>[s.id,s.name]),doc.stage||"idea")}</select>`)}</div>`+
      fld("Название",inp("title",doc.title))+
      `<div class="grid2">${fld("Дата выхода",inp("date",doc.date,"date"))}${fld("Площадки",inp("platforms",doc.platforms||"IG, TG, Threads"))}</div>`+
      fld("Папка на ПК",inp("folder",doc.folder))+
      fld("Заметки, цифры",area("notes",doc.notes,4))+
      (isNew?"":`<h2 class="sec">Задачи по ролику</h2><div class="sub" id="dl_tasks"></div>
        <div class="addline"><button class="btn sm" data-act="newTaskFor" data-video="${id}">+ Задача</button></div>`);
  }
  if(kind==="plan"){
    eyebrow="Медиаплан"; title=isNew?"Новая запись":esc(doc.title);
    body = `<div class="grid2">${fld("Дата",inp("date",doc.date||today(),"date"))}${fld("Формат",inp("kind",doc.kind||"Reels","text",'list="kindList"'))}</div>
      <datalist id="kindList"><option>Reels</option><option>Карусель</option><option>Пост</option><option>Сторис</option><option>Монтаж</option><option>Реклама ВК</option></datalist>`+
      fld("Что выходит",inp("title",doc.title))+
      fld("Ролик",`<select id="f_videoId" name="videoId">${opt(list("videos").sort((a,b)=>(b.num||0)-(a.num||0)).map(v=>[v.id,(v.num?"№"+v.num+" ":"")+v.title]),doc.videoId,"— не выбран —")}</select>`)+
      fld("Статус",`<select id="f_status" name="status">${opt(PLAN_ST,doc.status||"plan")}</select>`)+
      fld("Пометка",area("note",doc.note,3));
  }
  const prev = drawerStack[drawerStack.length-1];
  D.innerHTML = `${prev?`<button class="d-back" data-act="back">← Назад к ${KIND_NAME[prev.kind]||"предыдущему"}</button>`:""}<div class="d-head"><div style="flex:1;min-width:0"><div class="eyebrow">${eyebrow}</div><h3>${title}</h3></div>
      <button class="btn ghost sm" data-act="close" aria-label="Закрыть">✕</button></div>
    <form class="d-body" id="dform">${body}</form>
    <div class="d-foot">${(kind==="settings"||kind==="voice")?`<button class="btn" data-act="close">Закрыть</button>`:`${isNew?"":`<button class="btn ghost danger left" data-act="askDel">Удалить</button>`}<span id="delbox"></span>
      <button class="btn" data-act="cancel">Отмена</button><button class="btn primary" data-act="save">Сохранить</button>`}</div>`;
  if(kind==="settings"){ renderSettings(); return; }
  if(kind==="voice"){ const ta=$("#f_vtext"); ta.oninput=showParse; setTimeout(()=>ta.focus(),50); return; }
  refreshDrawerLists();
  const f=$("#dform"); f.onsubmit=e=>{e.preventDefault(); drawerSave();};
  if(kind==="task"){ $("#f_clientId").onchange=e=>{ const c=e.target.value; const ds=list("deals").filter(d=>!c||d.clientId===c);
    $("#f_dealId").innerHTML=opt(ds.map(d=>[d.id,(S.clients[d.clientId]||{}).name+": "+short(d.title,50)]),"","— без объекта —"); }; }
}
function refreshDrawerLists(){
  if(!drawerState || !drawerState.id) return;
  const {kind,id}=drawerState;
  const tl=$("#dl_tasks");
  if(tl){ const ts=list("tasks").filter(t=> kind==="deal"?t.dealId===id : kind==="client"?t.clientId===id : t.videoId===id)
      .sort((a,b)=>(a.done-b.done)||(a.due||"9").localeCompare(b.due||"9"));
    tl.innerHTML = ts.map(taskRow).join("") || '<div class="empty">Задач нет.</div>'; tl.className="tasks"; }
  const dl=$("#dl_deals");
  if(dl){ const ds=list("deals").filter(d=>d.clientId===id);
    dl.innerHTML = ds.map(d=>`<div class="srow" data-act="deal" data-id="${d.id}"><div class="l"><b>${esc(d.title)}</b><span>${[d.amount?money(d.amount):"",d.paid?"оплачено "+money(d.paid):""].filter(Boolean).join(" · ")}</span></div>
      <span class="pill" data-tone="${TONE[d.stage]||""}">${esc(stageName(d.stage,dealStages()))}</span></div>`).join("") || '<div class="empty">Объектов нет.</div>'; }
  const cg=$("#dl_clog");
  if(cg){ const c=S.clients[id]||{}; const items=(c.log||[]).map(l=>Object.assign({src:"c"},l));
    list("deals").filter(d=>d.clientId===id).forEach(d=>(d.log||[]).forEach(l=>items.push(Object.assign({src:"d",deal:short(d.title,30)},l))));
    items.sort((a,b)=>String(b.at).localeCompare(String(a.at)));
    cg.innerHTML = items.map(l=>`<li class="${l.dir==="in"?"in":l.dir==="out"?"out":""}"><span class="who">${esc(fmtD(String(l.at).slice(0,10)))} · ${esc(l.by||"")}${l.ch?" · "+esc(l.ch):""}${l.deal?" · "+esc(l.deal):""}</span>${l.dir==="in"?"<b>Клиент:</b> ":l.dir==="out"?"<b>Мы:</b> ":""}<span class="pre-line">${esc(l.text)}</span></li>`).join("") || '<li class="muted">Пока пусто.</li>'; }
  const lg=$("#dl_log");
  if(lg){ const d=S.deals[id]||{}; lg.innerHTML = (d.log||[]).slice().reverse().map(l=>`<li><span class="who">${esc(fmtD(l.at))} · ${esc(l.by||"")}</span>${esc(l.text)}</li>`).join("") || '<li class="muted">Пока пусто.</li>'; }
}
function readForm(){
  const f=$("#dform"); const o={};
  f.querySelectorAll("input[name],select[name],textarea[name]").forEach(el=>{
    if(el.type==="checkbox") o[el.name]=el.checked; else if(el.type==="number") o[el.name]= el.value===""? 0 : +el.value; else o[el.name]=el.value.trim();
  });
  return o;
}
function colOf(kind){ return kind==="plan"?"plan":kind==="voice"?"notes":kind+"s"; }
async function drawerSave(){
  const {kind,id}=drawerState; const col = colOf(kind);
  const f = readForm(); const old = id? S[col][id] : null;
  if(kind==="client" && !f.name){ toast("Впишите имя клиента"); return; }
  if((kind==="task"||kind==="deal") && !f.title){ toast("Впишите, что сделать"); return; }
  const nid = id || newId(kind[0]);
  let doc = Object.assign({}, old||drawerState.preset||{}, f);
  delete doc.lognew;
  if(kind==="product"){ doc.prices=String(doc.pricesText||"").split("\n").map(l=>l.split("|").map(x=>x.trim())).filter(a=>a[0]).map(a=>({item:a[0],price:a[1]||"",note:a[2]||""})); delete doc.pricesText; }
  if(kind==="product" && !doc.name){ toast("Впишите название"); return; }
  if(kind==="template" && !doc.text){ toast("Впишите текст"); return; }
  if(kind==="deal"){
    doc.log = (old&&old.log)||[];
    if(!old) doc.log=[{at:today(),by:"Андрей",text:"Объект создан"}];
    else if(old.stage!==doc.stage) doc.log=doc.log.concat([{at:today(),by:"Андрей",text:"Этап: "+stageName(old.stage,dealStages())+" → "+stageName(doc.stage,dealStages())}]);
  }
  if(kind==="task" && !old){ doc.by="andrey"; doc.done=false; doc.createdAt=nowIso(); }
  if(kind==="task" && old && (old.due!==doc.due || (old.time||"")!==(doc.time||""))) doc.remindedAt="";
  if(kind==="client" && !old){ doc.createdAt=nowIso(); }
  if(await save(col,nid,doc)){ toast("Сохранено"); if(drawerStack.length) drawerBack(); else closeDrawer(); }
}

/* ---------- настройки: 2FA, уведомления, выход ---------- */
let enrolling=null;
async function renderSettings(){
  const box=$("#setBody"); if(!box) return;
  let mfa='';
  try{
    const {data}=await sb.auth.mfa.listFactors(); const on=((data&&data.totp)||[]).filter(f=>f.status==="verified");
    const {data:u}=await sb.auth.getUser();
    mfa = on.length
      ? `<p><b class="ok-t">Включён.</b> При входе сайт спросит код из приложения. Без кода база ничего не покажет, даже если кто-то узнает пароль.</p>
         <button class="btn sm" data-act="mfaOff" data-id="${esc(on[0].id)}">Отключить вход с кодом</button>`
      : `<p>Сейчас вход только по паролю. Включите код из приложения (Google Authenticator, Яндекс Ключ и т.п.): тогда одного пароля для входа будет мало.</p>
         <button class="btn primary sm" data-act="mfaOn">Включить вход с кодом</button><div id="mfaBox"></div>`;
    mfa = `<p class="muted" style="font-size:13px">Вы вошли как ${esc(u&&u.user?u.user.email:"")}</p>`+mfa;
  }catch(e){ mfa='<p class="err">Не удалось проверить: '+esc(e.message)+'</p>'; }
  const perm = ("Notification" in window)? Notification.permission : "none";
  box.innerHTML = `<h2 class="sec">Вход с кодом (2FA)</h2>${mfa}
    <h2 class="sec">Напоминания</h2>
    <p>У задачи со временем бот присылает напоминание в Телеграм в назначенную минуту, даже если сайт закрыт.</p>
    <p>${perm==="granted"?"Уведомления на этом устройстве включены: пока сайт открыт, он тоже напомнит.":perm==="denied"?"Уведомления на этом устройстве запрещены в настройках браузера.":perm==="none"?"Этот браузер не умеет показывать уведомления.":'Можно включить уведомления и на этом устройстве (работают, пока сайт открыт). <button class="btn sm" data-act="notifOn">Включить</button>'}</p>
    <h2 class="sec">Выход</h2><p>На чужом устройстве обязательно выходите.</p>
    <button class="btn danger sm" data-act="logout">Выйти с этого устройства</button>`;
}
async function mfaEnroll(){
  const box=$("#mfaBox"); box.innerHTML='<p class="muted">Готовлю код…</p>';
  const {data:l}=await sb.auth.mfa.listFactors();
  for(const f of ((l&&l.all)||[]).filter(f=>f.status!=="verified")) await sb.auth.mfa.unenroll({factorId:f.id});
  const {data,error}=await sb.auth.mfa.enroll({factorType:"totp", friendlyName:"Штаб КМД "+today()});
  if(error){ box.innerHTML='<p class="err">Не вышло: '+esc(error.message)+'</p>'; return; }
  enrolling=data.id;
  box.innerHTML=`<ol class="steps"><li>Откройте приложение-аутентификатор и отсканируйте код:</li></ol>
    <img class="qr" alt="QR-код для приложения" src="${esc(data.totp.qr_code)}">
    <p class="muted" style="font-size:13px">Если сканировать нечем, введите ключ вручную: <span class="mono">${esc(data.totp.secret)}</span></p>
    <ol class="steps" start="2"><li>Впишите 6 цифр, которые покажет приложение:</li></ol>
    <div class="addline"><input id="f_mfacode" inputmode="numeric" maxlength="6" placeholder="123456" autocomplete="one-time-code"><button class="btn primary sm" data-act="mfaVerify">Подтвердить</button></div>`;
}
async function mfaVerify(){
  const code=($("#f_mfacode").value||"").trim();
  const {error}=await sb.auth.mfa.challengeAndVerify({factorId:enrolling, code});
  if(error){ toast("Код не подошёл, попробуйте свежий"); return; }
  enrolling=null; toast("Вход с кодом включён"); renderSettings();
}
async function mfaOff(fid){
  const {error}=await sb.auth.mfa.unenroll({factorId:fid});
  if(error){ toast("Не вышло: "+error.message); return; }
  await sb.auth.refreshSession(); toast("Вход с кодом отключён"); renderSettings();
}
async function notifOn(){ try{ await Notification.requestPermission(); }catch(e){} renderSettings(); }
/* Уведомления на устройстве, пока сайт открыт: задачи на сегодня со временем. Телеграм шлёт база сама. */
function startNotifier(){
  const tick=()=>{
    if(!("Notification" in window) || Notification.permission!=="granted") return;
    let seen={}; try{ seen=JSON.parse(localStorage.getItem("crm-notified")||"{}"); }catch(e){}
    const d=new Date(), t=today(), hm=pad(d.getHours())+":"+pad(d.getMinutes()), from=pad(Math.max(0,d.getHours()-2))+":"+pad(d.getMinutes());
    list("tasks").filter(x=>!x.done && x.due===t && x.time && x.time<=hm && x.time>=from).forEach(x=>{
      const key=x.id+"|"+x.due+"|"+x.time; if(seen[key]) return; seen[key]=1;
      const cl=x.clientId&&S.clients[x.clientId]; const body=(cl?cl.name+": ":"")+x.title;
      const show=r=> r? r.showNotification("Штаб КМД · "+x.time,{body,tag:key,icon:"icon-192.png"}) : new Notification("Штаб КМД · "+x.time,{body,tag:key});
      const safe=r=>{ try{ show(r); }catch(e){} };
      if(navigator.serviceWorker && navigator.serviceWorker.controller) navigator.serviceWorker.ready.then(safe).catch(()=>safe()); else safe();
    });
    try{ localStorage.setItem("crm-notified",JSON.stringify(seen)); }catch(e){}
  };
  tick(); setInterval(tick,30000);
}

/* ---------- источники, деньги, конверсии ---------- */
const CH_ORDER = ["Instagram","Telegram","Сайт","ВКонтакте","МАКС","Авито","Обзвон","Сарафан","Почта","Другое","Не указан"];
function channel(src){
  let s = String(src||"").split("→")[0].split("(")[0].trim().toLowerCase();
  if(!s || /^уточн/.test(s)) return "Не указан";
  if(/inst|инст|рилс|reels/.test(s)) return "Instagram";
  if(/tele|телег|^tg/.test(s)) return "Telegram";
  if(/сайт|site|витрин/.test(s)) return "Сайт";
  if(/вк|vk|вконт/.test(s)) return "ВКонтакте";
  if(/макс|max/.test(s)) return "МАКС";
  if(/авито|avito/.test(s)) return "Авито";
  if(/обзвон|звон|холод/.test(s)) return "Обзвон";
  if(/сараф|рекоменд|знаком/.test(s)) return "Сарафан";
  if(/почт|mail/.test(s)) return "Почта";
  return "Другое";
}
const KP_STAGES = new Set(["kp","prepay","work","done","paid"]);
const MONTHS = ["янв","фев","мар","апр","май","июн","июл","авг","сен","окт","ноя","дек"];
function dealPayments(d){
  if(Array.isArray(d.payments) && d.payments.length) return d.payments.filter(p=>+p.amount);
  if(+d.paid>0) return [{date:(d.lastContact||String(d.updatedAt||"").slice(0,10)||today()), amount:+d.paid, kind:"оплата"}];
  return [];
}
function periodFrom(){ const t=today(); if(UI.period==="month") return t.slice(0,8)+"01"; if(UI.period==="30") return addDays(t,-30); if(UI.period==="90") return addDays(t,-90); return ""; }
function inPeriod(d){ const f=periodFrom(); return !f || (d && String(d).slice(0,10)>=f); }
function clientDate(c){ return c.firstContact || String(c.createdAt||"").slice(0,10); }
function moneyData(){
  const cls=list("clients"), deals=list("deals");
  const rows={}; const R=ch=> rows[ch] || (rows[ch]={ch,req:0,cl:0,kp:0,paidN:0,sum:0});
  const reqKeys=new Set();
  // обращения = клиенты (кроме обзвона) + люди из «Входящих», которых нет в клиентах
  cls.filter(c=>c.kind!=="cold" && inPeriod(clientDate(c))).forEach(c=>{
    const r=R(channel(c.source)); r.req++; reqKeys.add("c:"+c.id);
    const ds=deals.filter(d=>d.clientId===c.id);
    if(ds.length) r.cl++;
    if(ds.some(d=>KP_STAGES.has(d.stage) || (+d.amount>0 && d.stage!=="new"))) r.kp++;
    if(ds.some(d=>dealPayments(d).length)) r.paidN++;
  });
  const seen=new Set();
  list("inbox").filter(m=>inPeriod(m.date)).forEach(m=>{
    if(m.clientId && S.clients[m.clientId]) return;
    const k=String(m.who||"").toLowerCase().trim(); if(!k || seen.has(k)) return; seen.add(k);
    R(channel(m.source)).req++;
  });
  // деньги: по дате оплаты
  const pays=[]; deals.forEach(d=>{ const c=S.clients[d.clientId]||{}; dealPayments(d).forEach(p=>pays.push({date:p.date,amount:+p.amount,ch:channel(c.source),client:c.name||"",deal:d.title})); });
  pays.filter(p=>inPeriod(p.date)).forEach(p=>{ R(p.ch).sum+=p.amount; });
  const order = Object.values(rows).sort((a,b)=> (b.sum-a.sum)||(b.req-a.req)||CH_ORDER.indexOf(a.ch)-CH_ORDER.indexOf(b.ch));
  const tot = order.reduce((t,r)=>({req:t.req+r.req,cl:t.cl+r.cl,kp:t.kp+r.kp,paidN:t.paidN+r.paidN,sum:t.sum+r.sum}),{req:0,cl:0,kp:0,paidN:0,sum:0});
  const owed = deals.filter(d=>["prepay","work","done"].includes(d.stage)).reduce((s,d)=>s+Math.max(0,(+d.amount||0)-dealPayments(d).reduce((x,p)=>x+p.amount,0)),0);
  return {rows:order, tot, pays, owed};
}
const pct = (a,b) => b? Math.round(a*100/b)+"%" : "—";
const chartW = () => { const v=$("#view"); return Math.max(280, Math.min(760, (v?v.clientWidth:360)-34)); };
function barsV(data, opt){
  opt=opt||{}; const W=opt.w||chartW(), H=opt.h||190, padL=6, padB=26, padT=18;
  const max=Math.max(1,...data.map(d=>d.value)); const n=data.length||1; const slot=(W-padL)/n; const bw=Math.max(6,Math.min(46,slot*0.62));
  const y=v=>padT+(H-padT-padB)*(1-v/max);
  const grid=[0.5,1].map(f=>`<line x1="0" x2="${W}" y1="${y(max*f)}" y2="${y(max*f)}" class="g"/>`).join("")+`<line x1="0" x2="${W}" y1="${H-padB}" y2="${H-padB}" class="ax"/>`;
  const bars=data.map((d,i)=>{ const x=padL+slot*i+(slot-bw)/2, top=y(d.value), h=Math.max(0,H-padB-top);
    const r=Math.min(4,bw/2,h);
    const path = h>0? `M${x},${H-padB} V${top+r} Q${x},${top} ${x+r},${top} H${x+bw-r} Q${x+bw},${top} ${x+bw},${top+r} V${H-padB} Z` : "";
    return `<g data-tip="${esc(d.tip||(d.label+": "+d.value))}"><rect x="${padL+slot*i}" y="${padT-10}" width="${slot}" height="${H-padT-padB+10}" fill="transparent"/>${path?`<path d="${path}" class="bar"/>`:""}
      ${d.show?`<text x="${x+bw/2}" y="${top-5}" text-anchor="middle" class="vl">${esc(d.show)}</text>`:""}
      <text x="${x+bw/2}" y="${H-8}" text-anchor="middle" class="xl">${esc(d.label)}</text></g>`; }).join("");
  return `<svg class="viz" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opt.label||"")}">${grid}${bars}</svg>`;
}
function lineChart(pts, opt){
  opt=opt||{}; const W=opt.w||chartW(), H=opt.h||170, padL=8, padR=40, padB=26, padT=18;
  if(pts.length<2) return '<p class="muted">Мало точек для графика.</p>';
  const max=Math.max(...pts.map(p=>p.v))*1.1, min=0;
  const t0=new Date(pts[0].d).getTime(), t1=new Date(pts[pts.length-1].d).getTime();
  const x=p=>padL+(W-padL-padR)*((new Date(p.d).getTime()-t0)/Math.max(1,t1-t0)); const y=v=>padT+(H-padT-padB)*(1-(v-min)/(max-min));
  const path=pts.map((p,i)=>(i?"L":"M")+x(p).toFixed(1)+","+y(p.v).toFixed(1)).join(" ");
  const last=pts[pts.length-1];
  return `<svg class="viz" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opt.label||"")}">
    <line x1="0" x2="${W}" y1="${H-padB}" y2="${H-padB}" class="ax"/><line x1="0" x2="${W}" y1="${y(max/2)}" y2="${y(max/2)}" class="g"/>
    <path d="${path}" class="ln"/>
    ${pts.map(p=>`<g data-tip="${esc(fmtD(p.d).slice(0,5)+": "+p.v.toLocaleString("ru-RU")+(opt.unit||""))}"><circle cx="${x(p)}" cy="${y(p.v)}" r="14" fill="transparent"/><circle cx="${x(p)}" cy="${y(p.v)}" r="4" class="dot"/></g>`).join("")}
    <text x="${x(last)+8}" y="${y(last.v)+4}" class="vl" text-anchor="start">${last.v.toLocaleString("ru-RU")}</text>
    ${pts.map((p,i)=> (i===0||i===pts.length-1||pts.length<=6)?`<text x="${x(p)}" y="${H-8}" text-anchor="${i===0?"start":i===pts.length-1?"end":"middle"}" class="xl">${esc(fmtD(p.d).slice(0,5))}</text>`:"").join("")}
  </svg>`;
}
function barsH(items, fmt){
  const max=Math.max(1,...items.map(i=>i.value));
  return `<div class="hbars">${items.map(i=>`<div class="hb" data-tip="${esc(i.tip||i.label)}"><span class="hl">${esc(i.label)}</span><span class="ht"><span class="hf" style="width:${Math.max(i.value?2:0,i.value*100/max)}%"></span></span><span class="hv">${esc(fmt?fmt(i.value):i.value)}</span></div>`).join("")}</div>`;
}
function vMoney(){
  const M=moneyData(); const t=M.tot;
  const thisM=today().slice(0,7); const allPays=M.pays;
  const monthSum=allPays.filter(p=>String(p.date).slice(0,7)===thisM).reduce((s,p)=>s+p.amount,0);
  const months=[]; { const d=new Date(); d.setDate(1); for(let i=5;i>=0;i--){ const m=new Date(d.getFullYear(), d.getMonth()-i, 1); months.push(m.getFullYear()+"-"+pad(m.getMonth()+1)); } }
  const byM=months.map(m=>{ const v=allPays.filter(p=>String(p.date).slice(0,7)===m).reduce((s,p)=>s+p.amount,0); const mi=+m.slice(5)-1;
    return {label:MONTHS[mi], value:v, show:v?Math.round(v/1000)+"к":"", tip:MONTHS[mi]+" "+m.slice(0,4)+": "+money(v)}; });
  const paidClients=new Set(list("deals").filter(d=>dealPayments(d).length).map(d=>d.clientId)).size;
  const avg = paidClients? Math.round(allPays.reduce((s,p)=>s+p.amount,0)/paidClients) : 0;
  const funnel=[["Обращения",t.req],["Есть объект",t.cl],["Отправили КП",t.kp],["Оплатили",t.paidN]];
  const per = [["all","Всё время"],["month","Этот месяц"],["30","30 дней"],["90","90 дней"]];
  return `<div class="h-row"><h1 class="page">Деньги и источники</h1>
    <div class="chips">${per.map(([k,l])=>`<button class="chip ${(UI.period||"all")===k?"on":""}" data-act="period" data-k="${k}">${l}</button>`).join("")}</div></div>
  <div class="strip">
    <div><div class="k">Получено${UI.period&&UI.period!=="all"?" за период":""}</div><div class="v acc">${money(t.sum)}</div></div>
    <div><div class="k">В этом месяце</div><div class="v">${money(monthSum)}</div></div>
    <div><div class="k">Ждём по работам</div><div class="v">${money(M.owed)}</div></div>
    <div><div class="k">Средний чек</div><div class="v">${money(avg)}</div></div>
  </div>
  <div class="mk-grid" style="margin-top:14px">
    <section class="panel"><h2 class="sec" style="margin-top:0">Деньги по месяцам</h2>${barsV(byM,{label:"Получено по месяцам",w:Math.min(chartW(), 520)})}</section>
    <section class="panel"><h2 class="sec" style="margin-top:0">Откуда пришли деньги</h2>
      ${t.sum? barsH(M.rows.filter(r=>r.sum).map(r=>({label:r.ch,value:r.sum,tip:r.ch+": "+money(r.sum)+", оплатили "+r.paidN})), money) : '<p class="muted">За этот период оплат нет.</p>'}
      <h2 class="sec">Воронка, все источники</h2>
      ${barsH(funnel.map(([l,v],i)=>({label:l,value:v,tip:l+": "+v+(i?" ("+pct(v,funnel[i-1][1])+" от предыдущего шага)":"")})), v=>v)}
      <p class="hint">Из обращения в оплату: <b>${pct(t.paidN,t.req)}</b>. Из КП в оплату: <b>${pct(t.paidN,t.kp)}</b>.</p>
    </section>
  </div>
  <h2 class="sec">Конверсия по каждому источнику</h2>
  <div class="tbl-wrap"><table class="tbl">
    <thead><tr><th>Источник</th><th>Обращений</th><th>Есть объект</th><th>КП</th><th>Оплатили</th><th>Конверсия в оплату</th><th>Получено</th><th>₽ на обращение</th></tr></thead>
    <tbody>${M.rows.map(r=>`<tr><td><b>${esc(r.ch)}</b></td><td>${r.req}</td><td>${r.cl} <small>${pct(r.cl,r.req)}</small></td><td>${r.kp} <small>${pct(r.kp,r.req)}</small></td><td>${r.paidN}</td>
      <td><span class="cv"><span style="width:${r.req?Math.round(r.paidN*100/r.req):0}%"></span></span> ${pct(r.paidN,r.req)}</td><td>${money(r.sum)}</td><td>${r.req&&r.sum?money(r.sum/r.req):"—"}</td></tr>`).join("")}</tbody>
    <tfoot><tr><td>Итого</td><td>${t.req}</td><td>${t.cl}</td><td>${t.kp}</td><td>${t.paidN}</td><td>${pct(t.paidN,t.req)}</td><td>${money(t.sum)}</td><td>${t.req&&t.sum?money(t.sum/t.req):"—"}</td></tr></tfoot>
  </table></div>
  <p class="hint">Обращения: все клиенты (кроме обзвона) и люди из «Входящих», которые писали, но не стали клиентами. Источник берётся из поля «Откуда пришёл» в карточке клиента. Оплаты вносятся в карточке объекта.</p>
  <h2 class="sec">Последние оплаты</h2>
  <div class="tasks">${allPays.slice().sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,12).map(p=>`<div class="srow2"><span class="mono">${esc(fmtD(String(p.date).slice(0,10)).slice(0,5))}</span><span class="grow"><b>${esc(p.client)}</b> <span class="muted">${esc(short(p.deal,50))}</span></span><span class="mono">${money(p.amount)}</span><span class="pill">${esc(p.ch)}</span></div>`).join("")||'<div class="empty">Оплат пока нет.</div>'}</div>`;
}

/* ---------- продукты, шаблоны ---------- */
function vProducts(){
  const tab=UI.ptab||"services";
  const tabs=[["services","Услуги и цены"],["templates","Шаблоны ответов"],["script","Скрипт звонка"]];
  let body="";
  if(tab==="services"){
    const ps=list("products").sort((a,b)=>(a.order||99)-(b.order||99));
    const groups=[...new Set(ps.map(p=>p.group||"Услуги"))];
    body = groups.map(g=>`<h2 class="sec">${esc(g)}</h2><div class="plist">${ps.filter(p=>(p.group||"Услуги")===g).map(p=>{ const open=UI.openP===p.id;
      return `<article class="prod ${open?"open":""}"><button class="prod-h" data-act="pOpen" data-id="${esc(p.id)}" aria-expanded="${open}">
        <span class="pn">${esc(p.name)}</span><span class="pp">${esc(p.price||"")}</span><span class="ps">${esc(p.short||"")}</span></button>
        ${open?`<div class="prod-b">
          ${p.term?`<p><b>Срок:</b> ${esc(p.term)}</p>`:""}
          ${p.full?`<div class="pre-line">${esc(p.full)}</div>`:""}
          ${(p.prices||[]).length?`<h3>Прайс</h3><table class="tbl small"><tbody>${p.prices.map(r=>`<tr><td>${esc(r.item)}</td><td class="nw"><b>${esc(r.price)}</b></td><td class="muted">${esc(r.note||"")}</td></tr>`).join("")}</tbody></table>`:""}
          ${p.notIncluded?`<p class="muted"><b>Не входит:</b> ${esc(p.notIncluded)}</p>`:""}
          <div class="addline"><button class="btn sm" data-act="copyProd" data-id="${esc(p.id)}">Скопировать описание для клиента</button><button class="btn ghost sm" data-act="editProd" data-id="${esc(p.id)}">Изменить</button></div>
        </div>`:""}</article>`; }).join("")}</div>`).join("") || '<div class="empty">Услуг пока нет.</div>';
    const rules = (S.config.main && S.config.main.priceRules) || "";
    body += (rules?`<h2 class="sec">Общие правила цены</h2><div class="panel pre-line">${esc(rules)}</div>`:"")+`<div class="addline"><button class="btn sm" data-act="newProd">+ Услуга</button></div>`;
  } else {
    const grp = tab==="script" ? "Скрипт звонка" : null;
    const ts=list("templates").filter(t=> grp? t.group===grp : t.group!=="Скрипт звонка").sort((a,b)=>(a.order||99)-(b.order||99));
    body = `<div class="tpl-list">${ts.map(t=>`<article class="tpl"><div class="tpl-h"><b>${esc(t.title)}</b>${t.group&&!grp?`<span class="pill">${esc(t.group)}</span>`:""}</div>
      <div class="pre-line tpl-t">${esc(t.text)}</div>
      <div class="addline">${grp?"":`<button class="btn primary sm" data-act="copyTpl" data-id="${esc(t.id)}">Скопировать</button>`}<button class="btn ghost sm" data-act="editTpl" data-id="${esc(t.id)}">Изменить</button></div></article>`).join("")||'<div class="empty">Пусто.</div>'}</div>
      <div class="addline"><button class="btn sm" data-act="newTpl" data-g="${grp?esc(grp):""}">+ ${grp?"Шаг скрипта":"Шаблон"}</button></div>`;
  }
  return `<div class="h-row"><h1 class="page">Наши продукты</h1></div>
    <div class="seg" role="tablist">${tabs.map(([k,l])=>`<button role="tab" aria-selected="${tab===k}" class="${tab===k?"on":""}" data-act="ptab" data-k="${k}">${l}</button>`).join("")}</div>${body}`;
}
function productText(p){
  return [p.name+(p.price?" — "+p.price:""), p.term?"Срок: "+p.term:"", p.full||p.short||"", (p.prices||[]).map(r=>"• "+r.item+": "+r.price+(r.note?" ("+r.note+")":"")).join("\n")].filter(Boolean).join("\n\n");
}
async function copyText(t){ try{ await navigator.clipboard.writeText(t); }catch(e){ const a=document.createElement("textarea"); a.value=t; document.body.appendChild(a); a.select(); document.execCommand("copy"); a.remove(); } toast("Скопировано"); }

/* ---------- метрики соцсетей ---------- */
function vMetrics(){
  const m=S.metrics.instagram; if(!m) return "";
  const fol=(m.followers||[]).slice().sort((a,b)=>a.d.localeCompare(b.d));
  const reels=(m.reels||[]); const wk={};
  reels.forEach(r=>{ const d=new Date(r.d+"T12:00:00"); const k=addDays(r.d, -((d.getDay()+6)%7)); const w=wk[k]||(wk[k]={views:0,subs:0,n:0}); w.views+=+r.views||0; w.subs+=+r.subs||0; w.n++; });
  const weeks=Object.keys(wk).sort().slice(-8);
  const w2=Math.min(chartW(),520);
  return `<div class="mk-grid" style="margin:4px 0 6px">
    <section class="panel"><h2 class="sec" style="margin-top:0">Подписчики Instagram</h2>${lineChart(fol.map(f=>({d:f.d,v:+f.v})),{label:"Подписчики Instagram",w:w2})}</section>
    <section class="panel"><h2 class="sec" style="margin-top:0">Просмотры роликов по неделям</h2>${barsV(weeks.map(k=>({label:fmtD(k).slice(0,5),value:wk[k].views,show:wk[k].views>=1000?Math.round(wk[k].views/1000)+"к":String(wk[k].views),tip:"Неделя с "+fmtD(k).slice(0,5)+": "+wk[k].views.toLocaleString("ru-RU")+" просмотров, "+wk[k].subs+" подписок, роликов "+wk[k].n})),{label:"Просмотры по неделям",w:w2,h:170})}
      <p class="hint">Цифры обновляет Claude после снятия статистики${m.updated?", последний раз "+esc(fmtD(m.updated).slice(0,5)):""}.</p></section></div>`;
}

/* ---------- голос ---------- */
const NUMW={"ноль":0,"один":1,"одну":1,"два":2,"две":2,"три":3,"четыре":4,"пять":5,"шесть":6,"семь":7,"восемь":8,"девять":9,"десять":10,"одиннадцать":11,"двенадцать":12,"тринадцать":13,"четырнадцать":14,"пятнадцать":15,"шестнадцать":16,"семнадцать":17,"восемнадцать":18,"девятнадцать":19,"двадцать":20,"тридцать":30,"сорок":40,"пятьдесят":50};
const WDAY={"понедельник":1,"вторник":2,"среду":3,"среда":3,"четверг":4,"пятницу":5,"пятница":5,"субботу":6,"суббота":6,"воскресенье":0};
const MONG={"января":1,"февраля":2,"марта":3,"апреля":4,"мая":5,"июня":6,"июля":7,"августа":8,"сентября":9,"октября":10,"ноября":11,"декабря":12};
function wordsToNum(s){ return s.replace(/(двадцать|тридцать|сорок|пятьдесят)\s+(один|одну|два|две|три|четыре|пять|шесть|семь|восемь|девять)(?=[\s,.!?:;]|$)/gi,(m,a,b)=>NUMW[a.toLowerCase()]+NUMW[b.toLowerCase()])
  .replace(/(?<=^|[\s,.])(ноль|один|одну|два|две|три|четыре|пять|шесть|семь|восемь|девять|десять|одиннадцать|двенадцать|тринадцать|четырнадцать|пятнадцать|шестнадцать|семнадцать|восемнадцать|девятнадцать|двадцать|тридцать|сорок|пятьдесят)(?=[\s,.!?:;]|$)/gi,m=>NUMW[m.toLowerCase()]); }
/* Разбор фразы: «завтра в 10 позвонить Ивану», «в пятницу в 15:30 …», «через 2 часа …», «20 ноября …» */
function parseVoice(raw){
  let s=" "+wordsToNum(raw.replace(/ё/g,"е"))+" "; const now=new Date(); let due="", time="";
  const cut=re=>{ const m=s.match(re); if(m) s=s.replace(m[0]," "); return m; };
  let m;
  if((m=cut(/\sчерез\s+(\d+|пол)?\s*(минут[уы]?|час(?:а|ов)?|полчаса)(?=[\s,.!?:;]|$)/i))){ const n=m[1]==="пол"||/полчаса/i.test(m[2])?30:(+m[1]||1); const mins=/мин|пол/i.test(m[2])?n:n*60; const d=new Date(now.getTime()+mins*6e4); due=ymd(d); time=pad(d.getHours())+":"+pad(d.getMinutes()); }
  if((m=cut(/\sчерез\s+(\d+|неделю)\s*(дн(?:я|ей)|день|недел[июь])?/i))){ const n=m[1]==="неделю"?7:(+m[1])*(/недел/i.test(m[2]||"")?7:1); due=addDays(today(),n); }
  if((m=cut(/\s(послезавтра)(?=[\s,.!?:;]|$)/i))) due=addDays(today(),2);
  else if((m=cut(/\s(завтра)(?=[\s,.!?:;]|$)/i))) due=addDays(today(),1);
  else if((m=cut(/\s(сегодня)(?=[\s,.!?:;]|$)/i))) due=today();
  if((m=cut(/\s(?:в|во)\s+(понедельник|вторник|среду|четверг|пятницу|субботу|воскресенье)(?=[\s,.!?:;]|$)/i))){ const w=WDAY[m[1].toLowerCase()]; let d=new Date(); let k=(w-d.getDay()+7)%7||7; due=addDays(today(),k); }
  if((m=cut(/\s(\d{1,2})[.\/](\d{1,2})(?:[.\/](\d{2,4}))?(?=[\s,.!?:;]|$)/))){ let y=now.getFullYear(); const d=new Date(y,+m[2]-1,+m[1]); if(ymd(d)<today()) d.setFullYear(y+1); due=ymd(d); }
  else if((m=cut(/\s(\d{1,2})(?:-?го)?\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)(?=[\s,.!?:;]|$)/i))){ let y=now.getFullYear(); const d=new Date(y,MONG[m[2].toLowerCase()]-1,+m[1]); if(ymd(d)<today()) d.setFullYear(y+1); due=ymd(d); }
  if((m=cut(/\s(?:в|к)\s+(\d{1,2})(?:[:.\s](\d{2}))?\s*(?:час(?:а|ов)?)?\s*(утра|дня|вечера|ночи)?(?=\s)/i)) && +m[1]<=23){ let h=+m[1]; const mm=m[2]?+m[2]:0; const part=(m[3]||"").toLowerCase();
    if((part==="дня"||part==="вечера") && h<12) h+=12; if(part==="ночи" && h===12) h=0; if(!part && h>=1 && h<=7) h+=12; time=pad(h)+":"+pad(Math.min(59,mm)); }
  else if((m=cut(/\s(утром)(?=[\s,.!?:;]|$)/i))) time="09:00"; else if((m=cut(/\s(вечером)(?=[\s,.!?:;]|$)/i))) time="18:00"; else if((m=cut(/\s(днем|днём)(?=[\s,.!?:;]|$)/i))) time="13:00";
  if(time && !due){ due = time<=pad(now.getHours())+":"+pad(now.getMinutes()) ? addDays(today(),1) : today(); }
  cut(/\s(напомни(?:ть)?(?:\s+мне)?|поставь\s+задачу|задача)(?=[\s,.!?:;]|$)[,:]?/i);
  let title=s.replace(/\s+/g," ").replace(/^[\s,.:–-]+|[\s,.:–-]+$/g,"").trim();
  if(title) title=title[0].toUpperCase()+title.slice(1);
  let clientId=""; const low=raw.toLowerCase();
  list("clients").forEach(c=>{ const nm=String(c.name||"").split(/[\s(—-]/)[0]; if(nm.length>=4 && !clientId){ const stem=nm.toLowerCase().slice(0,Math.max(4,nm.length-2)); if(low.includes(stem)) clientId=c.id; } });
  return {title, due, time, clientId};
}
let rec=null, recOn=false;
function voiceBody(){
  const sup = !!(window.SpeechRecognition||window.webkitSpeechRecognition);
  const notes=list("notes").sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,8);
  return `<p class="muted" style="margin-top:12px">Скажите задачу или мысль. Пример: «завтра в 10 позвонить Василию про кран». Время и дату я пойму сам, остальное разберёт Claude.</p>
    ${sup?`<button class="mic ${recOn?"on":""}" type="button" data-act="mic" aria-pressed="${recOn}"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg><span>${recOn?"Слушаю… нажмите, чтобы остановить":"Нажмите и говорите"}</span></button>`
      :`<p class="banner">Этот браузер не распознаёт речь сам. Нажмите в поле ниже и используйте микрофон на клавиатуре телефона.</p>`}
    <label class="f" for="f_vtext">Текст</label><textarea id="f_vtext" rows="4" placeholder="Здесь появится то, что вы сказали. Можно поправить."></textarea>
    <div id="vparse" class="vparse"></div>
    <div class="addline wrap"><button class="btn primary" data-act="vTask">Сохранить как задачу</button><button class="btn" data-act="vNote">Просто мысль, Claude разберёт</button></div>
    <h2 class="sec">Последние записи</h2>
    <ul class="log">${notes.map(n=>`<li><span class="who">${esc(fmtD(String(n.createdAt).slice(0,10)).slice(0,5))} ${esc(String(n.createdAt).slice(11,16))}${n.processed?" · разобрано":" · ждёт разбора"}</span>${esc(n.text)}${n.result?`<br><span class="muted">${esc(n.result)}</span>`:""}</li>`).join("")||'<li class="muted">Пока пусто.</li>'}</ul>`;
}
function showParse(){
  const box=$("#vparse"); if(!box) return; const t=$("#f_vtext").value.trim(); if(!t){ box.innerHTML=""; return; }
  const p=parseVoice(t); const cl=p.clientId&&S.clients[p.clientId];
  box.innerHTML=`<div><span>Задача</span><b>${esc(p.title||"—")}</b></div><div><span>Когда</span><b>${p.due?esc(dueLabel(p.due)):"без срока"}${p.time?" в "+esc(p.time):""}</b></div>${cl?`<div><span>Клиент</span><b>${esc(cl.name)}</b></div>`:""}${p.time?'<div class="ok-t">Бот напомнит в Телеграм</div>':""}`;
}
function micToggle(){
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition; if(!SR) return;
  if(recOn && rec){ rec.stop(); return; }
  rec=new SR(); rec.lang="ru-RU"; rec.interimResults=true; rec.continuous=true;
  const ta=$("#f_vtext"); const base=ta.value? ta.value.trim()+" " : "";
  rec.onresult=e=>{ let fin="", tmp=""; for(let i=0;i<e.results.length;i++){ const r=e.results[i]; if(r.isFinal) fin+=r[0].transcript; else tmp+=r[0].transcript; } ta.value=(base+fin+tmp).trim(); showParse(); };
  rec.onerror=e=>{ if(e.error==="not-allowed") toast("Разрешите доступ к микрофону для сайта"); else if(e.error!=="no-speech" && e.error!=="aborted") toast("Распознавание: "+e.error); };
  rec.onend=()=>{ recOn=false; const b=document.querySelector("[data-act=mic]"); if(b){ b.classList.remove("on"); b.setAttribute("aria-pressed","false"); b.querySelector("span").textContent="Нажмите и говорите"; } };
  try{ rec.start(); recOn=true; const b=document.querySelector("[data-act=mic]"); b.classList.add("on"); b.setAttribute("aria-pressed","true"); b.querySelector("span").textContent="Слушаю… нажмите, чтобы остановить"; }catch(e){ toast("Микрофон занят, попробуйте ещё раз"); }
}
async function voiceSave(asTask){
  if(recOn && rec) rec.stop();
  const text=$("#f_vtext").value.trim(); if(!text){ toast("Сначала скажите или впишите текст"); return; }
  const nid=newId("n"); const note={text, createdAt:nowIso(), processed:false, by:"andrey"};
  if(asTask){
    const p=parseVoice(text); const tid=newId("t");
    await save("tasks",tid,{title:p.title||text, due:p.due||today(), time:p.time||"", done:false, area:"clients", clientId:p.clientId||"", dealId:"", videoId:"", by:"andrey", waiting:false, note:"Голосом: "+text, createdAt:nowIso()});
    note.taskId=tid; note.result="Создана задача"+(p.time?" с напоминанием "+dueLabel(p.due||today())+" в "+p.time:"");
  }
  await save("notes",nid,note);
  toast(asTask? "Задача сохранена" : "Сохранено, Claude разберёт");
  $("#f_vtext").value=""; showParse(); const D=$("#drawer .d-body"); if(D) D.innerHTML=voiceBody();
}

/* ---------- оплаты в объекте ---------- */
function paymentsBlock(d,id){
  const ps=Array.isArray(d.payments)?d.payments:[];
  return `<h2 class="sec">Оплаты</h2><div class="sub">${ps.map((p,i)=>`<div class="srow2"><span class="mono">${esc(fmtD(p.date).slice(0,5))}</span><span class="grow">${esc(p.kind||"оплата")}${p.note?` <span class="muted">${esc(p.note)}</span>`:""}</span><span class="mono">${money(p.amount)}</span><button class="btn ghost sm" data-act="payDel" data-i="${i}" aria-label="Удалить оплату">✕</button></div>`).join("")||(+d.paid?`<div class="empty">Оплачено ${money(d.paid)} (без дат). Добавьте оплаты с датами, чтобы они попали в графики.</div>`:'<div class="empty">Оплат нет.</div>')}</div>
    <div class="addline wrap"><input type="date" id="f_pdate" value="${today()}" aria-label="Дата оплаты"><input type="number" id="f_pamt" inputmode="numeric" placeholder="Сумма, ₽" aria-label="Сумма"><select id="f_pkind" aria-label="Тип оплаты">${opt([["Предоплата","Предоплата"],["Остаток","Остаток"],["Полная оплата","Полная оплата"],["Доплата","Доплата"]],"Предоплата")}</select><button class="btn sm" data-act="payAdd">+ Оплата</button></div>`;
}
async function payChange(fn){
  const id=drawerState.id; const d=Object.assign({},S.deals[id]); let ps=Array.isArray(d.payments)?d.payments.slice():[];
  if(!ps.length && +d.paid) ps=[{date:d.lastContact||today(),amount:+d.paid,kind:"оплата (без даты)"}];
  ps=fn(ps); d.payments=ps; d.paid=ps.reduce((s,p)=>s+(+p.amount||0),0);
  await save("deals",id,d); const f=$("#f_paid"); if(f) f.value=d.paid||""; const box=$("#payBox"); if(box) box.innerHTML=paymentsBlock(d,id);
}

/* ---------- всплывающие подсказки на графиках ---------- */
function tipAt(el,x,y){ const t=$("#tip"); t.textContent=el.dataset.tip; t.hidden=false; const w=t.offsetWidth; t.style.left=Math.max(8,Math.min(window.innerWidth-w-8,x-w/2))+"px"; t.style.top=Math.max(8,y-44)+"px"; }
document.addEventListener("pointermove",e=>{ const el=e.target.closest&&e.target.closest("[data-tip]"); if(el && e.pointerType==="mouse") tipAt(el,e.clientX,e.clientY); else if(e.pointerType==="mouse") $("#tip").hidden=true; });
document.addEventListener("pointerdown",e=>{ const el=e.target.closest&&e.target.closest("[data-tip]"); if(el && e.pointerType!=="mouse"){ tipAt(el,e.clientX,e.clientY); clearTimeout(tipAt.t); tipAt.t=setTimeout(()=>$("#tip").hidden=true,2200); } });
let rsT; window.addEventListener("resize",()=>{ clearTimeout(rsT); rsT=setTimeout(()=>{ if(["money","marketing"].includes(view())) render(); },200); });


/* ---------- events ---------- */
document.addEventListener("click", async e=>{
  const a = e.target.closest("[data-act]"); if(!a) return;
  const act=a.dataset.act, id=a.dataset.id;
  if(act==="toggle"){ e.stopPropagation(); const t=S.tasks[id]; if(!t) return;
    await save("tasks",id,Object.assign({},t,{done:a.checked,doneAt:a.checked?nowIso():""})); if(a.checked) toast("Готово ✓"); return; }
  if(a.tagName==="A" && !a.getAttribute("href")) e.preventDefault();
  if(act==="area"){ UI.area=a.dataset.k; render(); }
  else if(act==="expand"){ UI["open_"+a.dataset.k]=true; render(); }
  else if(act==="closed"){ UI.showClosed=!UI.showClosed; render(); }
  else if(act==="allOut"){ UI.showAllOut=true; render(); }
  else if(act==="deal"){ e.stopPropagation(); openDrawer("deal",id); }
  else if(act==="client"){ e.stopPropagation(); openDrawer("client",id); }
  else if(act==="video"){ e.stopPropagation(); openDrawer("video",id); }
  else if(act==="task"){ openDrawer("task",id); }
  else if(act==="plan"){ openDrawer("plan",id); }
  else if(act==="newDeal"){ openDrawer("deal",null,{stage:"new"}); }
  else if(act==="newClient"){ openDrawer("client",null,{}); }
  else if(act==="newVideo"){ openDrawer("video",null,{stage:"idea"}); }
  else if(act==="newPlan"){ openDrawer("plan",null,{status:"plan"}); }
  else if(act==="newDealFor"){ openDrawer("deal",null,{stage:"new",clientId:a.dataset.client}); }
  else if(act==="newTaskFor"){ const v=a.dataset.video; openDrawer("task",null,{due:today(),area:v?"marketing":"clients",clientId:a.dataset.client||"",dealId:a.dataset.deal||"",videoId:v||""}); }
  else if(act==="planSt"){ const p=S.plan[id]; const i=PLAN_ST.findIndex(x=>x[0]===(p.status||"plan")); await save("plan",id,Object.assign({},p,{status:PLAN_ST[(i+1)%PLAN_ST.length][0]})); }
  else if(act==="close"){ e.preventDefault(); closeDrawer(); }
  else if(act==="cancel"){ e.preventDefault(); if(drawerStack.length) drawerBack(); else closeDrawer(); }
  else if(act==="back"){ e.preventDefault(); drawerBack(); }
  else if(act==="save"){ e.preventDefault(); drawerSave(); }
  else if(act==="askDel"){ e.preventDefault(); $("#delbox").innerHTML=`<span class="confirm">Удалить насовсем? <button class="btn sm danger" data-act="doDel">Да, удалить</button></span>`; }
  else if(act==="doDel"){ e.preventDefault(); const {kind,id:did}=drawerState; await remove(colOf(kind),did); if(drawerStack.length) drawerBack(); else closeDrawer(); toast("Удалено"); }
  else if(act==="period"){ UI.period=a.dataset.k; render(); }
  else if(act==="ckind"){ UI.ckind=a.dataset.k; render(); }
  else if(act==="ptab"){ UI.ptab=a.dataset.k; render(); }
  else if(act==="pOpen"){ UI.openP = UI.openP===id? "" : id; render(); }
  else if(act==="copyProd"){ copyText(productText(S.products[id])); }
  else if(act==="editProd"){ openDrawer("product",id); }
  else if(act==="newProd"){ openDrawer("product",null,{group:"Металлоконструкции"}); }
  else if(act==="copyTpl"){ copyText(S.templates[id].text); }
  else if(act==="editTpl"){ openDrawer("template",id); }
  else if(act==="newTpl"){ openDrawer("template",null,{group:a.dataset.g||"Ответы клиентам"}); }
  else if(act==="mic"){ e.preventDefault(); micToggle(); }
  else if(act==="vTask"){ e.preventDefault(); voiceSave(true); }
  else if(act==="vNote"){ e.preventDefault(); voiceSave(false); }
  else if(act==="payAdd"){ e.preventDefault(); const amt=+$("#f_pamt").value; if(!amt){ toast("Впишите сумму"); return; }
    const date=$("#f_pdate").value||today(), kindP=$("#f_pkind").value; await payChange(ps=>ps.concat([{date,amount:amt,kind:kindP}])); toast("Оплата записана"); }
  else if(act==="payDel"){ e.preventDefault(); const i=+a.dataset.i; await payChange(ps=>ps.filter((_,j)=>j!==i)); }
  else if(act==="menu"){ openDrawer("settings","main"); }
  else if(act==="logout"){ e.preventDefault(); logout(); }
  else if(act==="copyDraft"){ e.preventDefault(); const t=$("#f_draft"); try{ await navigator.clipboard.writeText(t.value); toast("Скопировано"); }catch(err){ t.select(); document.execCommand("copy"); toast("Скопировано"); } }
  else if(act==="addCLog"){ e.preventDefault(); const t=$("#f_lnew"); const txt=t.value.trim(); if(!txt) return; const cid=drawerState.id; const c=S.clients[cid]; const ch=$("#f_lch").value;
    await save("clients",cid,Object.assign({},c,{lastChannel:ch,log:(c.log||[]).concat([{at:nowIso(),by:"Андрей",ch,dir:$("#f_ldir").value,text:txt}])})); t.value=""; refreshDrawerLists(); }
  else if(act==="mfaOn"){ e.preventDefault(); mfaEnroll(); }
  else if(act==="mfaVerify"){ e.preventDefault(); mfaVerify(); }
  else if(act==="mfaOff"){ e.preventDefault(); mfaOff(a.dataset.id); }
  else if(act==="notifOn"){ e.preventDefault(); notifOn(); }
  else if(act==="addLog"){ e.preventDefault(); const inpEl=$("#f_lognew"); const txt=inpEl.value.trim(); if(!txt) return; const d=S.deals[drawerState.id];
    await save("deals",drawerState.id,Object.assign({},d,{log:(d.log||[]).concat([{at:today(),by:"Андрей",text:txt}])})); inpEl.value=""; refreshDrawerLists(); }
});
document.addEventListener("submit", async e=>{
  const f=e.target; if(f.dataset.form!=="quick") return; e.preventDefault();
  const title=f.title.value.trim(); if(!title) return;
  await save("tasks",newId("t"),{title,due:f.due.value,time:f.time?f.time.value:"",done:false,area:f.dataset.area,clientId:"",dealId:"",videoId:"",by:"andrey",waiting:false,note:"",createdAt:nowIso()});
  toast("Задача добавлена");
});
document.addEventListener("input", e=>{ if(e.target.id==="q"){ UI.q=e.target.value; const pos=e.target.selectionStart; render(); const q=$("#q"); q.focus(); q.setSelectionRange(pos,pos); } });
$("#scrim").onclick=closeDrawer;
document.addEventListener("keydown", e=>{ if(e.key==="Escape" && drawerState) closeDrawer(); });
if($("#voiceBtn")) $("#voiceBtn").onclick=()=>{ if(demo){ openDrawer("voice","main"); return; } openDrawer("voice","main"); };
if($("#menuBtn")) $("#menuBtn").onclick=()=>{ if(demo){ toast("В демо-режиме настроек нет"); return; } openDrawer("settings","main"); };
$("#quickAdd").onclick=()=>openDrawer("task",null,{due:today(),area:view()==="marketing"?"marketing":"clients"});
window.addEventListener("hashchange", ()=>{ if(drawerState) closeDrawer(); render(); });
let toastT; function toast(m){ const t=$("#toast"); t.textContent=m; t.hidden=false; clearTimeout(toastT); toastT=setTimeout(()=>t.hidden=true,2400); }
window.addEventListener("load", ()=>{ if("serviceWorker" in navigator && !demo) navigator.serviceWorker.register("sw.js").catch(()=>{}); });
boot();
})();
