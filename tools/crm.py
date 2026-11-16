#!/usr/bin/env python3
"""Доступ Claude к базе «Штаб КМД» (Supabase, таблица docs).
Нужно: SUPABASE_URL (или CRM_SUPABASE_URL) и SUPABASE_SERVICE_KEY в окружении.

  crm.py dump [col]                    — всё (или одна коллекция) в JSON
  crm.py today                         — задачи: просрочено / сегодня / завтра (текст для сводки)
  crm.py get COL ID
  crm.py set COL ID '{json}'           — записать документ целиком
  crm.py patch COL ID '{json}'         — изменить поля (для deals можно "logAdd": "текст")
  crm.py stage DEAL_ID STAGE "пометка" — перенести объект на этап с записью в историю
  crm.py task "что сделать" YYYY-MM-DD [--client ID] [--deal ID] [--video ID] [--area marketing] [--wait]
  crm.py done TASK_ID
  crm.py delete COL ID
  crm.py import seed.json              — первичная загрузка (не перезаписывает существующие)
"""
import json, os, sys, urllib.request, urllib.parse, datetime, random, string

URL = (os.environ.get("CRM_SUPABASE_URL") or os.environ.get("SUPABASE_URL") or "").rstrip("/")
KEY = os.environ.get("SUPABASE_SERVICE_KEY") or ""
if not URL:
    try: URL = open(os.path.join(os.path.dirname(__file__), "supabase_url.txt")).read().strip().rstrip("/")
    except OSError: pass

def req(method, path, body=None, prefer=None):
    if not URL or not KEY: sys.exit("Нет SUPABASE_URL / SUPABASE_SERVICE_KEY")
    h = {"apikey": KEY, "Authorization": "Bearer " + KEY, "Content-Type": "application/json"}
    if prefer: h["Prefer"] = prefer
    data = json.dumps(body, ensure_ascii=False).encode() if body is not None else None
    r = urllib.request.Request(URL + "/rest/v1/" + path, data=data, method=method, headers=h)
    with urllib.request.urlopen(r, timeout=30) as resp:
        t = resp.read().decode()
        return json.loads(t) if t else None

def now(): return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
def msk_today():
    return (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=3)).date().isoformat()
def nid(p): return p + datetime.datetime.now().strftime("%y%m%d%H%M%S") + "".join(random.choices(string.ascii_lowercase, k=3))

def all_docs(col=None):
    q = "docs?select=col,id,data&limit=10000" + (f"&col=eq.{urllib.parse.quote(col)}" if col else "")
    out = {}
    for r in req("GET", q): out.setdefault(r["col"], {})[r["id"]] = r["data"]
    return out

def get(col, id):
    r = req("GET", f"docs?select=data&col=eq.{urllib.parse.quote(col)}&id=eq.{urllib.parse.quote(id)}")
    return r[0]["data"] if r else None

def put(col, id, data):
    data = dict(data); data["updatedAt"] = now()
    req("POST", "docs?on_conflict=col,id", [{"col": col, "id": id, "data": data, "updated_at": data["updatedAt"]}],
        prefer="resolution=merge-duplicates,return=minimal")

STAGES = {}
def stage_name(s):
    global STAGES
    if not STAGES:
        cfg = get("config", "main") or {}
        STAGES = {x["id"]: x["name"] for x in cfg.get("dealStages", [])}
    return STAGES.get(s, s)

def main(a):
    if not a: print(__doc__); return
    cmd = a[0]
    if cmd == "dump": print(json.dumps(all_docs(a[1] if len(a) > 1 else None), ensure_ascii=False, indent=1))
    elif cmd == "get": print(json.dumps(get(a[1], a[2]), ensure_ascii=False, indent=1))
    elif cmd == "set": put(a[1], a[2], json.loads(a[3])); print("ok")
    elif cmd == "patch":
        d = get(a[1], a[2]) or {}; p = json.loads(a[3]); log = p.pop("logAdd", None)
        d.update(p)
        if log: d["log"] = d.get("log", []) + [{"at": msk_today(), "by": "Claude", "text": log}]
        put(a[1], a[2], d); print("ok")
    elif cmd == "stage":
        d = get("deals", a[1]); old = d.get("stage"); d["stage"] = a[2]
        txt = f"Этап: {stage_name(old)} → {stage_name(a[2])}" + (f". {a[3]}" if len(a) > 3 else "")
        d["log"] = d.get("log", []) + [{"at": msk_today(), "by": "Claude", "text": txt}]
        put("deals", a[1], d); print(txt)
    elif cmd == "task":
        t = {"title": a[1], "due": a[2], "done": False, "area": "clients", "clientId": "", "dealId": "", "videoId": "",
             "by": "claude", "waiting": False, "note": "", "createdAt": now()}
        i = 3
        while i < len(a):
            k = a[i]
            if k == "--wait": t["waiting"] = True; i += 1; continue
            t[{"--client": "clientId", "--deal": "dealId", "--video": "videoId", "--area": "area", "--note": "note"}[k]] = a[i + 1]; i += 2
        if t["dealId"] and not t["clientId"]: t["clientId"] = (get("deals", t["dealId"]) or {}).get("clientId", "")
        tid = nid("t"); put("tasks", tid, t); print(tid)
    elif cmd == "done":
        d = get("tasks", a[1]); d["done"] = True; d["doneAt"] = now(); put("tasks", a[1], d); print("ok")
    elif cmd == "delete":
        req("DELETE", f"docs?col=eq.{urllib.parse.quote(a[1])}&id=eq.{urllib.parse.quote(a[2])}"); print("ok")
    elif cmd == "today":
        db = all_docs(); t = msk_today(); tom = (datetime.date.fromisoformat(t) + datetime.timedelta(days=1)).isoformat()
        cl = db.get("clients", {}); ts = [dict(v, id=k) for k, v in db.get("tasks", {}).items() if not v.get("done")]
        def line(x):
            c = cl.get(x.get("clientId"), {}).get("name", "")
            return f"• {c + ': ' if c else ''}{x['title']}" + (" (ждём клиента)" if x.get("waiting") else "") + (f" [{x['due']}]" if x.get("due") and x["due"] < t else "")
        for title, f in (("Просрочено", lambda x: x.get("due") and x["due"] < t), ("Сегодня", lambda x: x.get("due") == t), ("Завтра", lambda x: x.get("due") == tom)):
            rows = sorted([x for x in ts if f(x)], key=lambda x: x.get("due", ""))
            print(f"{title} ({len(rows)}):"); [print(line(x)) for x in rows]; print()
    elif cmd == "import":
        seed = json.load(open(a[1])); have = all_docs(); rows = []
        for col, docs in seed.items():
            for id, d in docs.items():
                if id in have.get(col, {}): continue
                rows.append({"col": col, "id": id, "data": d, "updated_at": now()})
        for i in range(0, len(rows), 200):
            req("POST", "docs", rows[i:i + 200], prefer="return=minimal")
        print("загружено", len(rows))
    else: print(__doc__)

if __name__ == "__main__": main(sys.argv[1:])
