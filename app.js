/* Штаб КМД — CRM Андрея. Данные: таблица docs (col, id, data jsonb) в Supabase.
   Без настроек в config.js работает демо-режим на seed.json (только локально). */
(function(){
"use strict";
const CFG = window.CRM_CONFIG || {};
const COLS = ["config","clients","deals","tasks","videos","plan"];
const S = {config:{},clients:{},deals:{},tasks:{},videos:{},plan:{}};
const UI = {area:"all", showClosed:false, q:"", showDone:false, showAllOut:false, dragging:false};
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
    sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey);
    const {data:{session}} = await sb.auth.getSession();
    if(!session){ showLogin(); return; }
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
  $("#login").hidden=false;
  $("#loginForm").onsubmit = async e => {
    e.preventDefault(); $("#lErr").hidden=true;
    const {error} = await sb.auth.signInWithPassword({email:$("#lEmail").value.trim(), password:$("#lPass").value});
    if(error){ $("#lErr").textContent="Не вышло войти: проверьте почту и пароль."; $("#lErr").hidden=false; return; }
    $("#login").hidden=true; await startSupabase();
  };
}
async function startSupabase(){
  setSync("загрузка…");
  const {data, error} = await sb.from("docs").select("col,id,data").range(0,9999);
  if(error){ setSync("нет связи с базой","bad"); toast("База не отвечает: "+error.message); return; }
  COLS.forEach(c=>S[c]={});
  data.forEach(r=>{ if(S[r.col]) S[r.col][r.id]=r.data; });
  render();
  sb.channel("docs-live").on("postgres_changes",{event:"*",schema:"public",table:"docs"}, p=>{
    if(p.eventType==="DELETE") apply(p.old.col,p.old.id,null); else apply(p.new.col,p.new.id,p.new.data);
  }).subscribe(st=>{ setSync(st==="SUBSCRIBED"?"онлайн":"переподключение…", st==="SUBSCRIBED"?"":"bad"); });
  document.addEventListener("visibilitychange", async ()=>{ if(document.visibilityState==="visible") {
    const r = await sb.from("docs").select("col,id,data").range(0,9999);
    if(!r.error){ COLS.forEach(c=>S[c]={}); r.data.forEach(x=>{ if(S[x.col]) S[x.col][x.id]=x.data; }); queueRender(); }
  }});
}
function saveDemo(){ try{ localStorage.setItem("crm-demo", JSON.stringify(S)); }catch(e){} }
async function save(col,id,data){
  data = Object.assign({}, data, {updatedAt: nowIso()}); delete data.id;
  S[col][id]=data; queueRender();
  if(demo){ saveDemo(); return true; }
  const {error} = await sb.from("docs").upsert({col,id,data,updated_at:data.updatedAt});
  if(error){ toast("Не сохранилось: "+error.message); return false; }
  return true;
}
async function remove(col,id){
  delete S[col][id]; queueRender();
  if(demo){ saveDemo(); return; }
  const {error} = await sb.from("docs").delete().eq("col",col).eq("id",id);
  if(error) toast("Не удалилось: "+error.message);
}
function strip(o){ const c=Object.assign({},o); delete c.id; return c; }

/* ---------- render ---------- */
function queueRender(){ if(renderQueued) return; renderQueued=true; requestAnimationFrame(()=>{ renderQueued=false; if(!UI.dragging) render(); }); }
function view(){ const h=(location.hash||"#today").slice(1); return ["today","board","clients","marketing"].includes(h)?h:"today"; }
function render(){
  const v=view();
  document.querySelectorAll("[data-v]").forEach(a=>a.classList.toggle("on",a.dataset.v===v));
  const el=$("#view"); const y=window.scrollY;
  const bw = el.querySelector(".board-wrap"); const bx = bw? bw.scrollLeft : 0;
  el.innerHTML = (demo? '<div class="banner">Демо-режим: данные хранятся только в этом браузере. После подключения базы всё будет общим для телефона, компьютера и Claude.</div>':"") +
    ({today:vToday,board:vBoard,clients:vClients,marketing:vMarketing})[v]();
  const nb = el.querySelector(".board-wrap"); if(nb) nb.scrollLeft=bx;
  window.scrollTo(0,y);
  initSortables();
  if(drawerState) refreshDrawerLists();
}

function taskRow(t){
  const deal = t.dealId && S.deals[t.dealId]; const cl = t.clientId && S.clients[t.clientId]; const vid = t.videoId && S.videos[t.videoId];
  const links = [];
  if(cl) links.push(`<a class="t-link" data-act="client" data-id="${t.clientId}">${esc(cl.name)}</a>`);
  if(deal) links.push(`<a class="t-link" data-act="deal" data-id="${t.dealId}">${esc(short(deal.title,38))}</a>`);
  if(vid) links.push(`<a class="t-link" data-act="video" data-id="${t.videoId}">${vid.num?"№"+vid.num+" ":""}${esc(vid.title)}</a>`);
  return `<div class="task ${t.done?"done":""}">
    <input type="checkbox" class="chk" data-act="toggle" data-id="${t.id}" ${t.done?"checked":""} aria-label="Выполнено">
    <div class="t-body" data-act="task" data-id="${t.id}">
      <div class="t-title">${esc(t.title)}</div>
      <div class="t-meta">${links.join(" · ")}
        ${t.area==="marketing"?'<span class="tag mk">маркетинг</span>':""}
        ${t.waiting?'<span class="tag wait">ждём клиента</span>':""}
        ${t.by==="claude"?'<span class="tag claude">Claude</span>':""}</div>
    </div>
    <span class="due ${t.done?"":dueClass(t.due)}">${t.done?"готово":esc(dueLabel(t.due))}</span>
  </div>`;
}
const short = (s,n) => { s=String(s||""); return s.length>n? s.slice(0,n-1)+"…" : s; };

function taskGroups(tasks){
  const t=today(), tom=addDays(t,1), wk=addDays(t,7);
  const g={over:[],today:[],tom:[],week:[],later:[],none:[]};
  tasks.filter(x=>!x.done).forEach(x=>{
    if(!x.due) g.none.push(x); else if(x.due<t) g.over.push(x); else if(x.due===t) g.today.push(x);
    else if(x.due===tom) g.tom.push(x); else if(x.due<=wk) g.week.push(x); else g.later.push(x);
  });
  Object.values(g).forEach(a=>a.sort((a,b)=>(a.due||"9").localeCompare(b.due||"9")||String(a.title).localeCompare(b.title)));
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
  return `<article class="card" data-id="${d.id}" data-act="deal">
    <div class="c-client">${esc(cl?cl.name:"Без клиента")}</div>
    <div class="c-title">${esc(d.title)}</div>
    <div class="c-foot">${d.amount?`<span class="sum">${money(d.amount)}</span>`:""}
      ${nt?`<span class="due ${dueClass(nt.due)}" title="${esc(nt.title)}">${esc(dueLabel(nt.due))}</span>`:""}
      ${nt&&nt.waiting?'<span class="who">ждём клиента</span>':(d.whose==="Андрей"||d.whose==="Я")?'<span class="who">ход наш</span>':""}</div>
  </article>`;
}

function vClients(){
  const q = UI.q.toLowerCase();
  const cls = list("clients").filter(c=> !q || [c.name,c.company,c.source,c.contact,c.about].join(" ").toLowerCase().includes(q) ||
    list("deals").some(d=>d.clientId===c.id && String(d.title).toLowerCase().includes(q)));
  const rows = cls.map(c=>{
    const ds = list("deals").filter(d=>d.clientId===c.id);
    const nt = nextTask(t=>t.clientId===c.id);
    const active = ds.some(d=>!CLOSED.has(d.stage));
    return {c,ds,nt,active};
  }).sort((a,b)=> (b.active-a.active) || (a.nt?a.nt.due||"9":"99").localeCompare(b.nt?b.nt.due||"9":"99") || a.c.name.localeCompare(b.c.name));
  return `<div class="h-row"><h1 class="page">Клиенты <span class="muted mono" style="font-size:16px">${list("clients").length}</span></h1>
    <button class="btn primary sm" data-act="newClient">+ Клиент</button></div>
    <div class="searchbar"><input type="search" id="q" placeholder="Поиск: имя, объект, контакт" value="${esc(UI.q)}" aria-label="Поиск клиентов"></div>
    <div class="clist"><div class="crow crow-h"><div>Клиент</div><div>Откуда / контакт</div><div>Объекты и этапы</div><div>Ближайшее</div></div>
    ${rows.map(({c,ds,nt})=>`<div class="crow" data-act="client" data-id="${c.id}">
      <div class="nm">${esc(c.name)}${c.company?`<div class="src">${esc(short(c.company,40))}</div>`:""}</div>
      <div class="src">${esc(c.source||"")}${c.contact?"<br>"+esc(short(c.contact,48)):""}</div>
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
  return `<article class="card vcard" data-id="${v.id}" data-act="video">
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
let drawerState=null;
function openDrawer(kind,id,preset){ drawerState={kind,id,preset:preset||{}}; drawRender(); $("#drawer").hidden=false; $("#scrim").hidden=false; document.body.style.overflow="hidden"; }
function closeDrawer(){ drawerState=null; $("#drawer").hidden=true; $("#scrim").hidden=true; document.body.style.overflow=""; }
function opt(list,val,empty){ return (empty!=null?`<option value="">${esc(empty)}</option>`:"")+list.map(([v,l])=>`<option value="${esc(v)}" ${v===val?"selected":""}>${esc(l)}</option>`).join(""); }
function fld(label,html){ return `<label class="f">${label}</label>${html}`; }
const inp = (name,val,type="text",extra="") => `<input type="${type}" id="f_${name}" name="${name}" value="${esc(val==null?"":val)}" ${extra}>`;
const area = (name,val,rows) => `<textarea id="f_${name}" name="${name}" rows="${rows||4}">${esc(val||"")}</textarea>`;
const clientOpts = sel => opt(list("clients").sort((a,b)=>a.name.localeCompare(b.name)).map(c=>[c.id,c.name]), sel, "— без клиента —");

function drawRender(){
  const {kind,id,preset}=drawerState; const isNew=!id; const D=$("#drawer");
  const doc = isNew ? Object.assign({},preset) : Object.assign({id}, S[kind==="plan"?"plan":kind+"s"][id]||{});
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
      fld("Заметки", area("notes",doc.notes,5))+
      (isNew?"":`<h2 class="sec">Задачи по объекту</h2><div class="sub" id="dl_tasks"></div>
        <div class="addline"><button class="btn sm" data-act="newTaskFor" data-deal="${id}" data-client="${doc.clientId||""}">+ Задача</button></div>
        <h2 class="sec">История</h2><div class="addline"><input type="text" id="f_lognew" placeholder="Пометка: что произошло"><button class="btn sm" data-act="addLog">Добавить</button></div>
        <ul class="log" id="dl_log"></ul>`);
  }
  if(kind==="client"){
    eyebrow="Клиент"; title=isNew?"Новый клиент":esc(doc.name);
    body = fld("Имя",inp("name",doc.name,"text","required"))+
      `<div class="grid2">${fld("Компания",inp("company",doc.company))}${fld("Откуда пришёл",inp("source",doc.source,"text",'list="srcList"'))}</div>
       <datalist id="srcList"><option>Instagram</option><option>Telegram</option><option>МАКС</option><option>ВКонтакте</option><option>Почта</option><option>Биржа stroy-control1</option><option>Сарафан</option></datalist>`+
      fld("Контакты",inp("contact",doc.contact))+
      fld("Чем занимается",area("about",doc.about,2))+
      fld("Заметки",area("notes",doc.notes,3))+
      (isNew?"":`<h2 class="sec">Объекты</h2><div class="sub" id="dl_deals"></div>
        <div class="addline"><button class="btn sm" data-act="newDealFor" data-client="${id}">+ Объект</button></div>
        <h2 class="sec">Задачи</h2><div class="sub" id="dl_tasks"></div>
        <div class="addline"><button class="btn sm" data-act="newTaskFor" data-client="${id}">+ Задача</button></div>`)+
      fld("История переписки",area("history",doc.history,8));
  }
  if(kind==="task"){
    eyebrow = doc.by==="claude"?"Задача · поставил Claude":"Задача"; title=isNew?"Новая задача":esc(doc.title);
    const deals = list("deals").filter(d=>!doc.clientId || d.clientId===doc.clientId);
    body = fld("Что сделать",area("title",doc.title,2))+
      `<div class="grid2">${fld("Срок",inp("due",doc.due,"date"))}${fld("Раздел",`<select id="f_area" name="area">${opt([["clients","Клиенты"],["marketing","Маркетинг"]],doc.area||"clients")}</select>`)}</div>`+
      fld("Клиент",`<select id="f_clientId" name="clientId">${clientOpts(doc.clientId)}</select>`)+
      fld("Объект",`<select id="f_dealId" name="dealId">${opt(deals.map(d=>[d.id,(S.clients[d.clientId]||{}).name+": "+short(d.title,50)]),doc.dealId,"— без объекта —")}</select>`)+
      fld("Ролик",`<select id="f_videoId" name="videoId">${opt(list("videos").sort((a,b)=>(b.num||0)-(a.num||0)).map(v=>[v.id,(v.num?"№"+v.num+" ":"")+v.title]),doc.videoId,"— без ролика —")}</select>`)+
      `<label class="f" style="display:flex;gap:8px;align-items:center;text-transform:none;letter-spacing:0;font:15px var(--f-body);color:var(--ink)"><input type="checkbox" id="f_waiting" name="waiting" ${doc.waiting?"checked":""}> Ждём ответа клиента</label>`+
      fld("Пометка",area("note",doc.note,3));
  }
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
  D.innerHTML = `<div class="d-head"><div style="flex:1;min-width:0"><div class="eyebrow">${eyebrow}</div><h3>${title}</h3></div>
      <button class="btn ghost sm" data-act="close" aria-label="Закрыть">✕</button></div>
    <form class="d-body" id="dform">${body}</form>
    <div class="d-foot">${isNew?"":`<button class="btn ghost danger left" data-act="askDel">Удалить</button>`}<span id="delbox"></span>
      <button class="btn" data-act="close">Отмена</button><button class="btn primary" data-act="save">Сохранить</button></div>`;
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
    dl.innerHTML = ds.map(d=>`<div class="srow" data-act="deal" data-id="${d.id}"><div class="l"><b>${esc(d.title)}</b><span>${d.amount?money(d.amount)+" · ":""}${d.paid?"оплачено "+money(d.paid):""}</span></div>
      <span class="pill" data-tone="${TONE[d.stage]||""}">${esc(stageName(d.stage,dealStages()))}</span></div>`).join("") || '<div class="empty">Объектов нет.</div>'; }
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
async function drawerSave(){
  const {kind,id}=drawerState; const col = kind==="plan"?"plan":kind+"s";
  const f = readForm(); const old = id? S[col][id] : null;
  if(kind==="client" && !f.name){ toast("Впишите имя клиента"); return; }
  if((kind==="task"||kind==="deal") && !f.title){ toast("Впишите, что сделать"); return; }
  const nid = id || newId(kind[0]);
  let doc = Object.assign({}, old||drawerState.preset||{}, f);
  delete doc.lognew;
  if(kind==="deal"){
    doc.log = (old&&old.log)||[];
    if(!old) doc.log=[{at:today(),by:"Андрей",text:"Объект создан"}];
    else if(old.stage!==doc.stage) doc.log=doc.log.concat([{at:today(),by:"Андрей",text:"Этап: "+stageName(old.stage,dealStages())+" → "+stageName(doc.stage,dealStages())}]);
  }
  if(kind==="task" && !old){ doc.by="andrey"; doc.done=false; doc.createdAt=nowIso(); }
  if(kind==="client" && !old){ doc.createdAt=nowIso(); }
  if(await save(col,nid,doc)){ toast("Сохранено"); closeDrawer(); }
}

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
  else if(act==="save"){ e.preventDefault(); drawerSave(); }
  else if(act==="askDel"){ e.preventDefault(); $("#delbox").innerHTML=`<span class="confirm">Удалить насовсем? <button class="btn sm danger" data-act="doDel">Да, удалить</button></span>`; }
  else if(act==="doDel"){ e.preventDefault(); const {kind,id:did}=drawerState; await remove(kind==="plan"?"plan":kind+"s",did); closeDrawer(); toast("Удалено"); }
  else if(act==="addLog"){ e.preventDefault(); const inpEl=$("#f_lognew"); const txt=inpEl.value.trim(); if(!txt) return; const d=S.deals[drawerState.id];
    await save("deals",drawerState.id,Object.assign({},d,{log:(d.log||[]).concat([{at:today(),by:"Андрей",text:txt}])})); inpEl.value=""; refreshDrawerLists(); }
});
document.addEventListener("submit", async e=>{
  const f=e.target; if(f.dataset.form!=="quick") return; e.preventDefault();
  const title=f.title.value.trim(); if(!title) return;
  await save("tasks",newId("t"),{title,due:f.due.value,done:false,area:f.dataset.area,clientId:"",dealId:"",videoId:"",by:"andrey",waiting:false,note:"",createdAt:nowIso()});
  toast("Задача добавлена");
});
document.addEventListener("input", e=>{ if(e.target.id==="q"){ UI.q=e.target.value; const pos=e.target.selectionStart; render(); const q=$("#q"); q.focus(); q.setSelectionRange(pos,pos); } });
$("#scrim").onclick=closeDrawer;
document.addEventListener("keydown", e=>{ if(e.key==="Escape" && drawerState) closeDrawer(); });
$("#quickAdd").onclick=()=>openDrawer("task",null,{due:today(),area:view()==="marketing"?"marketing":"clients"});
window.addEventListener("hashchange", render);
let toastT; function toast(m){ const t=$("#toast"); t.textContent=m; t.hidden=false; clearTimeout(toastT); toastT=setTimeout(()=>t.hidden=true,2400); }
window.addEventListener("load", ()=>{ if("serviceWorker" in navigator && !demo) navigator.serviceWorker.register("sw.js").catch(()=>{}); });
boot();
})();
