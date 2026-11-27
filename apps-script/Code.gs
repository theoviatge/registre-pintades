/* Registre des pintades : feuille Google « Pintades – synchro » partagée entre les téléphones.
 *
 * À coller dans Extensions > Apps Script de la feuille, puis :
 *   1. Déployer > Nouveau déploiement > type « Application Web »,
 *      « Exécuter en tant que : moi », « Qui a accès : tout le monde ». Autoriser l'accès demandé.
 *   2. Choisir la fonction « installerSauvegarde » en haut et cliquer « Exécuter » (une seule fois) :
 *      une sauvegarde part alors chaque soir par mail.
 *
 * Le code d'accès des téléphones est dans la case A2 de l'onglet caché « _reglages ».
 * L'onglet caché « _sync » sert à la synchronisation : ne pas le modifier à la main.
 * Les onglets « Lots », « Départs » et « Mortalités » se refont tout seuls à chaque saisie (lecture seule).
 */
const SYNC = "_sync";
const REGLAGES = "_reglages";
const HEAD = ["seq", "col", "id", "deleted", "data", "device", "modifie"];

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
function feuille_(nom, entete, cacher) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(nom);
  if (!sh) {
    sh = ss.insertSheet(nom);
    if (entete) sh.getRange(1, 1, 1, entete.length).setValues([entete]).setFontWeight("bold");
    sh.setFrozenRows(1);
    if (cacher) sh.hideSheet();
  }
  return sh;
}
function code_() {
  const sh = feuille_(REGLAGES, ["Code d'accès des téléphones"], true);
  let c = String(sh.getRange("A2").getValue() || "").trim();
  if (!c) { c = "pintades-" + Math.random().toString(36).slice(2, 8); sh.getRange("A2").setValue(c); }
  return c;
}
function lignes_() {
  const sh = feuille_(SYNC, HEAD, true);
  const n = sh.getLastRow() - 1;
  return { sh: sh, rows: n > 0 ? sh.getRange(2, 1, n, HEAD.length).getValues() : [] };
}
function vrai_(v) { return v === true || String(v).toLowerCase() === "true"; }
function docs_(rows) {
  const out = {};
  rows.forEach(r => {
    if (vrai_(r[3])) return;
    let d = null; try { d = JSON.parse(r[4]); } catch (e) {}
    if (d) (out[r[1]] || (out[r[1]] = [])).push({ id: String(r[2]), data: d });
  });
  return out;
}

/* GET ?cle=…&depuis=N : tout ce qui a changé depuis N */
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (String(p.cle || "") !== code_()) return out_({ ok: false, erreur: "cle" });
  const depuis = Number(p.depuis) || 0;
  const rows = lignes_().rows;
  let seq = 0;
  const docs = [];
  rows.forEach(r => {
    const s = Number(r[0]) || 0;
    if (s > seq) seq = s;
    if (s <= depuis) return;
    let data = null; try { data = r[4] ? JSON.parse(r[4]) : null; } catch (err) {}
    docs.push({ col: String(r[1]), id: String(r[2]), deleted: vrai_(r[3]), data: data });
  });
  return out_({ ok: true, seq: seq, docs: docs });
}

/* POST {cle, device, ops:[{col, id, deleted, data}]} */
function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return out_({ ok: false, erreur: "requete" }); }
  if (String(body.cle || "") !== code_()) return out_({ ok: false, erreur: "cle" });
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const t = lignes_(), sh = t.sh, rows = t.rows;
    let seq = rows.reduce((m, r) => Math.max(m, Number(r[0]) || 0), 0);
    const pos = {};
    rows.forEach((r, i) => { pos[r[1] + "/" + r[2]] = i; });
    const now = new Date();
    (body.ops || []).forEach(o => {
      if (!o || !o.col || !o.id) return;
      seq++;
      const row = [seq, String(o.col), String(o.id), !!o.deleted, o.deleted ? "" : JSON.stringify(o.data || {}), String(body.device || ""), now];
      const k = row[1] + "/" + row[2];
      if (k in pos) rows[pos[k]] = row; else { pos[k] = rows.length; rows.push(row); }
    });
    if (rows.length) sh.getRange(2, 1, rows.length, HEAD.length).setNumberFormat("@").setValues(rows.map(r => r.map(String)));
    lisible_(rows);
    return out_({ ok: true, seq: seq });
  } finally {
    lock.releaseLock();
  }
}

/* Onglets lisibles, refaits à chaque saisie */
function lisible_(rows) {
  const d = docs_(rows);
  const lots = (d.lots || []).map(x => x.data).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const numLot = {};
  (d.lots || []).forEach(x => { numLot[x.id] = x.data.numero; });
  const ecrire = (nom, entete, lignes) => {
    const sh = feuille_(nom, entete, false);
    sh.clearContents();
    sh.getRange(1, 1, 1, entete.length).setValues([entete]).setFontWeight("bold");
    if (lignes.length) sh.getRange(2, 1, lignes.length, entete.length).setValues(lignes);
  };
  ecrire("Lots", ["N° lot", "Éleveur", "Date d'entrée", "Nombre entré", "Fiche ICA à jour", "Terminé le", "Remarque"],
    lots.map(l => [l.numero || "", l.eleveur || "", l.date || "", l.nombre || "", l.icaFait ? "oui" : "non", l.cloture || "", l.note || ""]));
  ecrire("Départs", ["Date", "Nombre", "Abattoir", "Répartition par lot"],
    (d.departs || []).map(x => x.data).sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .map(m => [m.date || "", m.nombre || "", m.abattoir || "", m.repartition ? Object.keys(m.repartition).map(k => (numLot[k] || k) + " : " + m.repartition[k]).join(", ") : "du plus ancien lot"]));
  ecrire("Mortalités", ["Date", "Nombre", "Lot", "Cause"],
    (d.morts || []).map(x => x.data).sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .map(m => [m.date || "", m.nombre || "", m.lotId ? (numLot[m.lotId] || m.lotId) : "du plus ancien lot", m.cause || ""]));
}

/* Sauvegarde par mail : un fichier .json à remettre dans l'appli (Lots › Données › Importer un fichier) */
function sauvegardeQuotidienne() {
  const rows = lignes_().rows;
  const seq = rows.reduce((m, r) => Math.max(m, Number(r[0]) || 0), 0);
  const props = PropertiesService.getScriptProperties();
  if (String(seq) === props.getProperty("dernierMail")) return; // rien de neuf depuis la dernière sauvegarde
  const d = docs_(rows);
  const jour = Utilities.formatDate(new Date(), "Europe/Paris", "yyyy-MM-dd");
  const out = { registre: "pintades", exporteLe: new Date().toISOString(), lots: d.lots || [], departs: d.departs || [], morts: d.morts || [], config: d.config || [] };
  const fichier = Utilities.newBlob(JSON.stringify(out), "application/json", "pintades-sauvegarde-" + jour + ".json");
  MailApp.sendEmail({
    to: Session.getEffectiveUser().getEmail(),
    subject: "Sauvegarde registre des pintades – " + jour,
    body: "Sauvegarde automatique : " + out.lots.length + " lots, " + out.departs.length + " départs, " + out.morts.length + " mortalités.\n" +
      "Pour la remettre dans l'appli : Lots › Données › Importer un fichier, et choisir ce fichier .json.",
    attachments: [fichier]
  });
  props.setProperty("dernierMail", String(seq));
}

/* À lancer une fois depuis l'éditeur : sauvegarde chaque soir vers 20 h, et une tout de suite */
function installerSauvegarde() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === "sauvegardeQuotidienne").forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("sauvegardeQuotidienne").timeBased().everyDays(1).atHour(20).inTimezone("Europe/Paris").create();
  code_();
  lisible_(lignes_().rows);
  sauvegardeQuotidienne();
}
