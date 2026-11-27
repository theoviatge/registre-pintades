// Registre des pintades : version GitHub synchronisée avec Google Sheets (Apps Script).
// Chaque saisie est gardée dans le téléphone puis envoyée à la feuille « Pintades – synchro » (dossier SYNCHRONISATION du Drive).
// Sans réseau, les saisies attendent et partent toutes seules au retour du réseau.
// Les autres téléphones récupèrent les nouveautés toutes les 15 secondes.
window.MODE_SHEETS = true;
(function () {
  // Lien de réglage possible : …/registre-pintades/#synchro=ADRESSE_EXEC&code=CODE
  try {
    const h = new URLSearchParams(location.hash.slice(1));
    if (h.get("synchro")) localStorage.setItem("pintades-url", h.get("synchro"));
    if (h.get("code")) localStorage.setItem("pintades-cle", h.get("code"));
    if (h.get("synchro") || h.get("code")) history.replaceState(null, "", location.pathname + location.search);
  } catch (_) {}
  const URL_SYNC = (function () { try { return localStorage.getItem("pintades-url"); } catch (_) { return null; } })() || window.SYNC_URL || "";
  const LS = k => { try { return localStorage.getItem(k); } catch (_) { return null; } };
  const LSset = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (_) {} };
  let device = LS("pintades-appareil");
  if (!device) { device = "tel-" + Math.random().toString(36).slice(2, 10); LSset("pintades-appareil", device); }

  // ---------- stockage dans le téléphone ----------
  let dbp = null;
  const idb = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open("registre-pintades-sheets", 1);
    r.onupgradeneeded = () => { const d = r.result; for (const s of ["docs", "meta", "blobs"]) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
  const run = async (store, mode, fn) => { const d = await idb(); return new Promise((res, rej) => { const t = d.transaction(store, mode); const out = fn(t.objectStore(store)); t.oncomplete = () => res(out && "result" in out ? out.result : out); t.onerror = () => rej(t.error); }); };
  const getAll = store => run(store, "readonly", s => { const out = []; const c = s.openCursor(); c.onsuccess = () => { const k = c.result; if (k) { out.push([k.key, k.value]); k.continue(); } }; return out; });

  const cols = {}, subs = {};
  let seq = 0, outbox = [];
  let loaded = null;
  const load = () => loaded || (loaded = (async () => {
    for (const [k, v] of await getAll("docs")) { const i = k.indexOf("/"); (cols[k.slice(0, i)] || (cols[k.slice(0, i)] = {}))[k.slice(i + 1)] = v; }
    for (const [k, v] of await getAll("meta")) { if (k === "seq") seq = v; if (k === "outbox") outbox = v || []; }
  })());
  const saveMeta = () => run("meta", "readwrite", s => { s.put(seq, "seq"); s.put(outbox, "outbox"); });
  const emit = c => { const m = cols[c] || {}; const snap = { docs: Object.entries(m).map(([id, d]) => ({ id, data: () => JSON.parse(JSON.stringify(d)) })), metadata: { fromCache: false } }; (subs[c] || []).forEach(cb => { try { cb(snap); } catch (e) { console.error(e); } }); };

  // ---------- échanges avec la feuille ----------
  let etat = "attente", derniereErreur = "";
  const majConn = () => { const c = document.getElementById("conn"); if (c && typeof state !== "undefined" && state.db) { c.textContent = connTexte(); c.className = "status" + (etat === "ok" && !outbox.length ? "" : " err"); } };
  const connTexte = () => {
    const att = outbox.length ? ` · ${outbox.length} saisie${outbox.length > 1 ? "s" : ""} en attente` : "";
    if (!navigator.onLine) return "Sans réseau" + (att || " · à jour au dernier passage");
    if (!URL_SYNC) return "Feuille Google à relier" + att;
    if (etat === "erreur") return "Feuille injoignable" + att;
    if (outbox.length) return "Envoi en cours" + att;
    return "Synchronisé · Google Sheets";
  };
  window.connTexte = connTexte;
  const cle = () => LS("pintades-cle") || "";

  async function envoyer() {
    while (outbox.length) {
      const lot = outbox.slice(0, 100);
      const r = await fetch(URL_SYNC, { method: "POST", body: JSON.stringify({ cle: cle(), device, ops: lot }) });
      const j = await r.json();
      if (!j.ok) throw Object.assign(new Error(j.erreur || "refus"), { code: j.erreur });
      outbox = outbox.slice(lot.length); await saveMeta(); majConn();
    }
  }
  async function recevoir() {
    const r = await fetch(URL_SYNC + (URL_SYNC.includes("?") ? "&" : "?") + "cle=" + encodeURIComponent(cle()) + "&depuis=" + seq);
    const j = await r.json();
    if (!j.ok) throw Object.assign(new Error(j.erreur || "refus"), { code: j.erreur });
    const enAttente = new Set(outbox.map(o => o.col + "/" + o.id)), touches = new Set();
    if (j.docs.length) await run("docs", "readwrite", s => {
      for (const d of j.docs) {
        const k = d.col + "/" + d.id;
        if (enAttente.has(k)) continue;              // une saisie de ce téléphone pas encore envoyée garde la main
        const m = cols[d.col] || (cols[d.col] = {});
        if (d.deleted) { delete m[d.id]; s.delete(k); } else { m[d.id] = d.data; s.put(d.data, k); }
        touches.add(d.col);
      }
    });
    seq = j.seq; await saveMeta();
    touches.forEach(emit);
  }
  let enCours = null, relance = false;
  async function synchro() {
    if (enCours) { relance = true; return enCours; }
    enCours = (async () => {
      try {
        if (!URL_SYNC) { etat = "erreur"; derniereErreur = "pas de feuille"; return; }
        if (!navigator.onLine) { etat = "horsligne"; return; }
        await envoyer(); await recevoir(); etat = "ok"; derniereErreur = "";
      } catch (e) {
        etat = "erreur"; derniereErreur = (e && (e.code || e.message)) || "erreur";
        if (e && e.code === "cle") { LSset("pintades-cle", null); demanderCle("Code refusé par la feuille : vérifiez-le."); }
        console.warn("Synchro", e);
      } finally { majConn(); }
    })();
    await enCours; enCours = null;
    if (relance) { relance = false; return synchro(); }
  }
  addEventListener("online", synchro); addEventListener("offline", majConn);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) synchro(); });
  setInterval(() => { if (!document.hidden) synchro(); }, 15000);
  window.syncMaintenant = synchro;

  // ---------- code d'accès (une fois par appareil) ----------
  let cleP = null;
  function demanderCle(msg) {
    return new Promise(resolve => {
      if (document.getElementById("gsCle")) return;
      const st = document.createElement("style");
      st.textContent = "#gsCle{position:fixed;inset:0;z-index:100;background:var(--bg,#f3f4f1);display:flex;align-items:center;justify-content:center;padding:16px}#gsCle form{width:100%;max-width:360px;display:flex;flex-direction:column;gap:12px}#gsCle h1{margin:0}";
      document.head.append(st);
      const box = document.createElement("div"); box.id = "gsCle";
      box.innerHTML = `\x3cform novalidate>\x3ch1>Registre des pintades\x3c/h1>
        \x3cdiv class="sub">Entrez le code d'accès de la feuille Google. Une seule fois par appareil.\x3c/div>
        \x3clabel class="field">\x3cspan>Code d'accès\x3c/span>\x3cinput name="cle" autocomplete="off" autocapitalize="off" spellcheck="false">\x3c/label>
        \x3cbutton class="btn primary" type="submit">Valider\x3c/button>\x3cdiv class="status err">${msg || ""}\x3c/div>\x3c/form>`;
      document.body.append(box);
      const f = box.querySelector("form"), err = box.querySelector(".status");
      f.addEventListener("submit", async e => {
        e.preventDefault();
        const v = f.cle.value.trim(); if (!v) return;
        const b = f.querySelector("button"); b.disabled = true; b.textContent = "Vérification…"; err.textContent = "";
        try {
          const r = await fetch(URL_SYNC + (URL_SYNC.includes("?") ? "&" : "?") + "cle=" + encodeURIComponent(v) + "&depuis=999999999");
          const j = await r.json();
          if (!j.ok) throw new Error("cle");
          LSset("pintades-cle", v); box.remove(); resolve(); synchro();
        } catch (x) {
          err.textContent = x && x.message === "cle" ? "Code incorrect." : "Feuille injoignable : il faut du réseau la première fois.";
          b.disabled = false; b.textContent = "Valider";
        }
      });
    });
  }
  const pret = () => cleP || (cleP = cle() || !URL_SYNC ? Promise.resolve() : demanderCle());

  // ---------- interface attendue par l'appli ----------
  const enfiler = async (c, id, data, deleted) => {
    await load();
    const m = cols[c] || (cols[c] = {});
    if (deleted) delete m[id]; else m[id] = data;
    await run("docs", "readwrite", s => deleted ? s.delete(c + "/" + id) : s.put(data, c + "/" + id));
    outbox = outbox.filter(o => !(o.col === c && o.id === id)); outbox.push({ col: c, id, deleted: !!deleted, data: deleted ? null : data });
    await saveMeta(); emit(c); majConn();
    clearTimeout(enfiler.t); enfiler.t = setTimeout(synchro, 300);
  };
  const newId = () => { const a = "abcdefghijklmnopqrstuvwxyz0123456789"; let s = ""; for (const x of crypto.getRandomValues(new Uint8Array(20))) s += a[x % 36]; return s; };
  const docRef = (c, id) => ({
    id,
    onSnapshot(cb) {
      const fire = () => { const d = cols[c]?.[id]; try { cb({ id, exists: !!d, data: () => d && JSON.parse(JSON.stringify(d)) }); } catch (e) { console.error(e); } };
      const w = () => fire(); (subs[c] || (subs[c] = [])).push(w); load().then(fire); return () => { subs[c] = subs[c].filter(x => x !== w); };
    },
    async get() { await load(); const d = cols[c]?.[id]; return { id, exists: !!d, data: () => d && JSON.parse(JSON.stringify(d)) }; },
    async set(data) { await enfiler(c, id, JSON.parse(JSON.stringify(data)), false); },
    async update(data) { await load(); await enfiler(c, id, Object.assign({}, cols[c]?.[id] || {}, JSON.parse(JSON.stringify(data))), false); },
    async delete() { await enfiler(c, id, null, true); },
  });
  const db = {
    doc(path) { const [c, id] = String(path).split("/"); return docRef(c, id); },
    collection(c) {
      return {
        onSnapshot(cb) { (subs[c] || (subs[c] = [])).push(cb); load().then(() => emit(c)); return () => { subs[c] = subs[c].filter(x => x !== cb); }; },
        doc(id) {
          id = id ? String(id) : newId();
          return {
            id,
            async get() { await load(); const d = cols[c]?.[id]; return { id, exists: !!d, data: () => d && JSON.parse(JSON.stringify(d)) }; },
            async set(data) { await enfiler(c, id, JSON.parse(JSON.stringify(data)), false); },
            async update(data) { await load(); await enfiler(c, id, Object.assign({}, cols[c]?.[id] || {}, JSON.parse(JSON.stringify(data))), false); },
            async delete() { await enfiler(c, id, null, true); },
          };
        },
      };
    },
  };
  const assets = {
    async upload(blob, opts = {}) {
      const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), x => x.toString(16).padStart(2, "0")).join("");
      const buf = await blob.arrayBuffer();
      await run("blobs", "readwrite", s => s.put({ type: opts.type || blob.type || "application/octet-stream", data: buf }, id));
      return { id, url: "_blob/" + id };
    },
  };
  const downloads = {
    async save({ filename, data }) {
      const blob = data instanceof Blob ? data : new Blob([data], { type: /\.pdf$/i.test(filename) ? "application/pdf" : /\.csv$/i.test(filename) ? "text/csv" : /\.json$/i.test(filename) ? "application/json" : "application/octet-stream" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename; document.body.append(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 5000);
    },
  };
  const user = { id: async () => device, can: async () => true, profiles: async () => ({}) };
  window.claude = { use: async n => {
    if (n === "db") { await load(); await pret(); synchro(); return db; }
    return ({ assets, downloads, user })[n] || null;
  } };

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(e => console.warn("Service worker", e));
})();
