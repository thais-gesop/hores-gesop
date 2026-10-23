/* ===========================================================================
   Registre d'hores · GESOP
   Web estàtica + Supabase. Cada usuari només veu les seves hores (ho garanteix
   la base de dades amb Row Level Security); l'admin exporta l'Excel per a l'Odoo.
   =========================================================================== */
(() => {
  "use strict";

  const C = window.HORES_CONFIG || {};
  const app = document.getElementById("app");

  if (!window.supabase || !C.SUPABASE_URL || C.SUPABASE_URL.includes("XXXXXXXX")) {
    app.innerHTML = `<div class="login"><h1>Falta configurar</h1>
      <p>Omple <code>SUPABASE_URL</code> i <code>SUPABASE_ANON_KEY</code> al fitxer <code>config.js</code>.</p></div>`;
    return;
  }

  const sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: "hores-gesop-auth" }
  });

  const S = {
    user: null, perfil: null, pestanya: "meves",
    llistes: { projecte: [], tasca_projecte: [], tasca_estructura: [] },
    editant: null, mes: null, meves: [],
    exp: null, tots: null, usuaris: [], llTipus: "projecte", llInactius: false
  };

  // ------------------------------------------------------------------ utils
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const pad = (n) => String(n).padStart(2, "0");

  function parseHora(x) {
    if (x == null) return null;
    let s = String(x).trim().toLowerCase();
    if (!s) return null;
    s = s.replace(/h$/, "").replace("h", ":").replace(/[.,']/g, ":");
    let h, m;
    if (/^\d{1,2}$/.test(s)) { h = +s; m = 0; }
    else if (/^\d{3,4}$/.test(s)) { const n = +s; h = Math.floor(n / 100); m = n % 100; }
    else if (/^\d{1,2}:\d{2}$/.test(s)) { [h, m] = s.split(":").map(Number); }
    else return NaN;
    if (m > 59 || h > 24 || (h === 24 && m > 0)) return NaN;
    return h * 60 + m;
  }
  // Quantitat d'hores: "2", "2,5", "2.5", "2:30", "2h30", "2h", "45m", "45 min" -> minuts
  function parseDurada(x) {
    if (x == null) return null;
    let s = String(x).trim().toLowerCase().replace(/\s+/g, "");
    if (!s) return null;
    let min;
    let m;
    if ((m = s.match(/^(\d{1,2})(?:h|:)(\d{1,2})?(?:m|min)?$/))) min = +m[1] * 60 + (m[2] ? +m[2] : 0);
    else if ((m = s.match(/^(\d{1,4})(?:m|min)$/))) min = +m[1];
    else if ((m = s.match(/^(\d{1,2})(?:[.,](\d+))?h?$/))) min = Math.round(parseFloat(`${m[1]}.${m[2] || 0}`) * 60);
    else return NaN;
    if (m && s.includes(":") && m[2] && +m[2] > 59) return NaN;
    if (!(min > 0) || min > 1440) return NaN;
    return min;
  }
  const fmtHora = (min) => (min == null || isNaN(min)) ? "" : `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
  const fmtDurada = (min) => `${Math.floor(min / 60)}:${pad(min % 60)}`;
  const fmtDec = (n) => n.toFixed(2).replace(".", ",");
  const isoLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const avui = () => isoLocal(new Date());
  const fmtData = (iso) => iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "";
  const primerDiaMes = () => avui().slice(0, 8) + "01";
  const mesActual = () => avui().slice(0, 7);
  function mesSeguent(mes) { const [y, m] = mes.split("-").map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`; }
  function ultimsMesos(n) {
    const out = []; const d = new Date(); d.setDate(1);
    for (let i = 0; i < n; i++) { out.push(isoLocal(d).slice(0, 7)); d.setMonth(d.getMonth() - 1); }
    return out;
  }
  const MESOS = ["gener", "febrer", "març", "abril", "maig", "juny", "juliol", "agost", "setembre", "octubre", "novembre", "desembre"];
  const DIES = ["dg", "dl", "dt", "dc", "dj", "dv", "ds"];
  const dataDe = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };
  const sumaDies = (iso, n) => { const d = dataDe(iso); d.setDate(d.getDate() + n); return isoLocal(d); };
  const iniciSetmana = (iso) => sumaDies(iso, -((dataDe(iso).getDay() + 6) % 7));   // dilluns
  const iniciMes = (iso) => iso.slice(0, 8) + "01";
  const fiMes = (iso) => { const d = dataDe(iniciMes(iso)); d.setMonth(d.getMonth() + 1); d.setDate(0); return isoLocal(d); };
  function prefixProjecte(p) {
    const codi = (p || "").slice(0, 5);
    return /^.\d{4}$/.test(codi) ? `${codi} - ` : "";
  }
  function generaPwd(n = 10) {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
    const r = crypto.getRandomValues(new Uint32Array(n));
    return Array.from(r, (v) => chars[v % chars.length]).join("");
  }
  const LIMIT_MIN = Math.round((C.LIMIT_SETMANA_H ?? 40) * 60);
  const AVIS_MIN = Math.round((C.AVIS_H ?? (C.LIMIT_SETMANA_H ?? 40) * 0.9) * 60);
  const estatSetmana = (min) => min > LIMIT_MIN ? "passat" : (min >= AVIS_MIN ? "avis" : "ok");
  const LOGO = C.LOGO_URL || "https://gesop.net/wp-content/uploads/2025/12/LogoGesop_White.png";
  const logoHtml = (cls) => `<img class="${cls}" src="${esc(LOGO)}" alt="GESOP" onerror="this.outerHTML='<span class=&quot;${cls} logo-text&quot;>GESOP</span>'">`;
  const emailDe = (usuari) => `${usuari.trim().toLowerCase()}@${C.DOMINI}`;

  function missatgeError(e) {
    const m = (e && (e.message || e.error_description || e.msg)) || String(e);
    if (m.includes("SOLAPA")) return "Es solapa amb un altre registre del mateix dia.";
    if (m.includes("EXPORTAT")) return "Aquest registre ja s'ha pujat a l'Odoo i no es pot modificar.";
    if (m.includes("final_despres_inici")) return "L'hora final ha de ser posterior a la d'inici.";
    if (m.includes("row-level security")) return "No tens permís per fer això.";
    if (m.includes("Invalid login credentials")) return "Usuari o contrasenya incorrectes.";
    if (m.includes("already registered") || m.includes("already been registered")) return "Aquest usuari ja existeix.";
    if (m.includes("Failed to fetch")) return "No hi ha connexió amb el servidor. Torna-ho a provar.";
    return m;
  }

  function toast(msg, tipus = "") {
    const t = document.createElement("div");
    t.className = `toast ${tipus}`; t.textContent = msg;
    $("#toasts").appendChild(t);
    setTimeout(() => t.remove(), tipus === "error" ? 6500 : 3500);
  }

  function modal(titol, cosHtml, botons = [{ text: "Tanca" }]) {
    const m = $("#modal");
    $("#modal-titol").textContent = titol;
    $("#modal-cos").innerHTML = cosHtml;
    const cont = $("#modal-botons"); cont.innerHTML = "";
    botons.forEach((b) => {
      const el = document.createElement("button");
      el.textContent = b.text; if (b.cls) el.className = b.cls;
      el.onclick = async () => { if (b.onClick) { const r = await b.onClick(); if (r === false) return; } tancaModal(); };
      cont.appendChild(el);
    });
    m.classList.remove("ocult");
    const primer = $("#modal-cos input"); if (primer) primer.focus();
  }
  const tancaModal = () => $("#modal").classList.add("ocult");
  const confirma = (titol, text, boto = "D'acord", cls = "primari") =>
    new Promise((res) => modal(titol, `<p>${text}</p>`, [
      { text: "Cancel·la", onClick: () => res(false) },
      { text: boto, cls, onClick: () => res(true) }]));

  async function fetchAll(builder) {
    const mida = 1000; let desde = 0; const out = [];
    for (;;) {
      const { data, error } = await builder().range(desde, desde + mida - 1);
      if (error) throw error;
      out.push(...data);
      if (data.length < mida) break;
      desde += mida;
    }
    return out;
  }

  function descarregaFitxer(nom, contingut, tipus) {
    const blob = contingut instanceof Blob ? contingut : new Blob([contingut], { type: tipus });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = nom;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // ------------------------------------------------------------------ dades
  async function carregaLlistes() {
    const data = await fetchAll(() => sb.from("llistes").select("tipus,valor").eq("actiu", true).order("id"));
    const L = { projecte: [], tasca_projecte: [], tasca_estructura: [] };
    data.forEach((r) => L[r.tipus] && L[r.tipus].push(r.valor));
    const es = L.projecte.filter((p) => p === "ESTRUCTURA");
    L.projecte = es.concat(L.projecte.filter((p) => p !== "ESTRUCTURA").sort((a, b) => b.localeCompare(a, "ca")));
    S.llistes = L;
  }
  const tasquesDe = (proj) => !proj ? [] :
    (proj === "ESTRUCTURA" ? S.llistes.tasca_estructura : S.llistes.tasca_projecte);

  // ------------------------------------------------------------------ inici / login
  async function inici() {
    const { data } = await sb.auth.getSession();
    if (!data.session) return renderLogin();
    await despresLogin(data.session.user);
  }

  async function despresLogin(user) {
    S.user = user;
    const { data: perfil, error } = await sb.from("perfils").select("*").eq("id", user.id).maybeSingle();
    if (error || !perfil) { await sb.auth.signOut(); return renderLogin("No s'ha trobat el teu perfil. Parla amb l'administradora."); }
    if (!perfil.actiu) { await sb.auth.signOut(); return renderLogin("El teu usuari està desactivat o pendent d'activar."); }
    S.perfil = perfil;
    if (perfil.canviar_pwd) return renderCanviPwd(true);
    try { await carregaLlistes(); } catch (e) { toast(missatgeError(e), "error"); }
    S.mes = S.mes || mesActual();
    renderApp();
  }

  function renderLogin(msg = "") {
    app.innerHTML = `<div class="login-fons">${logoHtml("logo-login")}
      <form class="login" id="f-login" autocomplete="on">
        <h1>Registre d'hores</h1>
        <label for="l-user">Usuari</label>
        <input type="text" id="l-user" autocomplete="username" autocapitalize="none" required>
        <label for="l-pwd">Contrasenya</label>
        <input type="password" id="l-pwd" autocomplete="current-password" required>
        ${msg ? `<div class="error">${esc(msg)}</div>` : ""}
        <div class="fila-botons"><button class="primari" type="submit" style="width:100%">Entra</button></div>
      </form></div>`;
    $("#l-user").focus();
    $("#f-login").onsubmit = async (ev) => {
      ev.preventDefault();
      const btn = $("#f-login button"); btn.disabled = true;
      const { data, error } = await sb.auth.signInWithPassword({ email: emailDe($("#l-user").value), password: $("#l-pwd").value });
      if (error) { btn.disabled = false; return renderLogin(missatgeError(error)); }
      await despresLogin(data.user);
    };
  }

  function renderCanviPwd(forcat) {
    app.innerHTML = `<div class="login-fons">${logoHtml("logo-login")}
      <form class="login" id="f-pwd">
        <h1>${forcat ? "Tria una contrasenya nova" : "Canviar contrasenya"}</h1>
        ${forcat ? `<p class="pista">És el primer cop que entres o te l'han restablerta. Tria una contrasenya personal.</p>`
                 : `<label for="p-act">Contrasenya actual</label><input type="password" id="p-act" autocomplete="current-password">`}
        <label for="p-nova">Contrasenya nova (mínim 8 caràcters)</label>
        <input type="password" id="p-nova" autocomplete="new-password">
        <label for="p-nova2">Repeteix-la</label>
        <input type="password" id="p-nova2" autocomplete="new-password">
        <div id="p-err" class="error"></div>
        <div class="fila-botons">
          ${forcat ? "" : `<button type="button" id="p-cancel">Cancel·la</button>`}
          <button class="primari" type="submit">Desa</button>
        </div>
      </form></div>`;
    (forcat ? $("#p-nova") : $("#p-act")).focus();
    if (!forcat) $("#p-cancel").onclick = () => renderApp();
    $("#f-pwd").onsubmit = async (ev) => {
      ev.preventDefault();
      const err = (t) => { $("#p-err").textContent = t; };
      const nova = $("#p-nova").value, nova2 = $("#p-nova2").value;
      if (nova.length < 8) return err("Ha de tenir com a mínim 8 caràcters.");
      if (nova !== nova2) return err("Les dues contrasenyes no coincideixen.");
      if (!forcat) {
        const { error } = await sb.auth.signInWithPassword({ email: S.user.email, password: $("#p-act").value });
        if (error) return err("La contrasenya actual no és correcta.");
      }
      const { error } = await sb.auth.updateUser({ password: nova });
      if (error) return err(missatgeError(error));
      await sb.rpc("marca_pwd_canviada");
      S.perfil.canviar_pwd = false;
      toast("Contrasenya desada.", "ok");
      if (forcat) { try { await carregaLlistes(); } catch (e) { /* res */ } S.mes = mesActual(); }
      renderApp();
    };
  }

  // ------------------------------------------------------------------ estructura principal
  const PESTANYES_ADMIN = [["exportar", "Exportar a l'Odoo"], ["tots", "Tots els registres"], ["usuaris", "Usuaris"], ["llistes", "Llistes"]];

  function renderApp() {
    const adm = !!S.perfil.admin;
    const pest = [["meves", "Les meves hores"]].concat(adm ? PESTANYES_ADMIN : []);
    if (!pest.some(([k]) => k === S.pestanya)) S.pestanya = "meves";
    app.innerHTML = `
      <header class="capcalera">
        <div class="marca">${logoHtml("logo-cap")}<span class="titol-app">Registre d'hores</span></div>
        <div class="usuari-info">
          <span class="nom-usuari">${esc(S.perfil.empleat || S.perfil.usuari)}</span>
          <button class="petit" id="b-pwd">Contrasenya</button>
          <button class="petit perill" id="b-surt">Surt</button>
        </div>
      </header>
      ${pest.length > 1 ? `<nav class="pestanyes">${pest.map(([k, t]) =>
        `<button data-p="${k}" class="${k === S.pestanya ? "activa" : ""}">${t}</button>`).join("")}</nav>` : ""}
      <main id="contingut"></main>`;
    $("#b-pwd").onclick = () => renderCanviPwd(false);
    $("#b-surt").onclick = async () => { await sb.auth.signOut(); S.perfil = null; S.editant = null; renderLogin(); };
    $$(".pestanyes button").forEach((b) => b.onclick = () => { S.pestanya = b.dataset.p; renderApp(); });
    ({ meves: vistaMeves, exportar: vistaExportar, tots: vistaTots, usuaris: vistaUsuaris, llistes: vistaLlistes }[S.pestanya])();
  }

  // ------------------------------------------------------------------ LES MEVES HORES
  // Llegeix quantitat / inici / final del formulari i decideix què es desa
  function calculaTemps() {
    const qEl = $("#f-quant");
    const i = parseHora($("#f-ini").value), f = parseHora($("#f-fin").value);
    const q = qEl.readOnly ? null : parseDurada(qEl.value);
    if (Number.isNaN(i)) return { error: "Hora d'inici no vàlida" };
    if (Number.isNaN(f)) return { error: "Hora final no vàlida" };
    if (Number.isNaN(q)) return { error: "Quantitat no vàlida (p. ex. 2, 2,5 o 2:30)" };
    if (i != null && f != null) {
      if (f <= i) return { error: "L'hora final ha de ser posterior a la d'inici" };
      return { minuts: f - i, inici: i, final: f, auto: "quant" };
    }
    if (i != null && q != null) {
      if (i + q > 1440) return { error: "Amb aquesta quantitat se supera la mitjanit" };
      return { minuts: q, inici: i, final: i + q, auto: "final" };
    }
    if (f != null && q != null) {
      if (f - q < 0) return { error: "Amb aquesta quantitat l'inici quedaria abans de les 00:00" };
      return { minuts: q, inici: f - q, final: f, auto: "inici" };
    }
    if (q != null) return { minuts: q, inici: null, final: null };
    if (i != null || f != null) return { error: "Falta la quantitat o l'altra hora", buit: true };
    return { error: "Falta la quantitat d'hores", buit: true };
  }

  function vistaMeves() {
    const mesos = ultimsMesos(13);
    $("#contingut").innerHTML = `
      <div class="comptadors" id="comptadors">
        <div class="comptador"><div class="c-titol">Avui</div><div class="c-valor" id="c-avui">–</div><div class="c-sub" id="c-avui-sub"></div></div>
        <div class="comptador" id="c-set-caixa"><div class="c-titol">Aquesta setmana <span class="c-limit">· límit ${LIMIT_MIN / 60} h</span></div>
          <div class="c-valor" id="c-set">–</div>
          <div class="barra"><div class="barra-ple" id="c-set-barra"></div></div>
          <div class="c-sub" id="c-set-sub"></div></div>
        <div class="comptador"><div class="c-titol">Aquest mes</div><div class="c-valor" id="c-mes">–</div><div class="c-sub" id="c-mes-sub"></div></div>
      </div>
      <div class="graella">
        <section class="targeta" id="form-targeta">
          <h2 id="form-titol">Nou registre</h2>
          <label for="f-data">Data</label>
          <input type="date" id="f-data" value="${avui()}">
          <label for="f-proj">Projecte</label>
          <input type="text" id="f-proj" list="dl-proj" placeholder="Escriu per cercar…" autocomplete="off">
          <datalist id="dl-proj">${S.llistes.projecte.map((p) => `<option value="${esc(p)}">`).join("")}</datalist>
          <label for="f-tasca">Tasca</label>
          <select id="f-tasca"><option value="">— tria primer el projecte —</option></select>
          <label for="f-desc">Descripció</label>
          <input type="text" id="f-desc" maxlength="300">
          <label for="f-quant">Quantitat d'hores</label>
          <input type="text" id="f-quant" placeholder="p. ex. 2, 2,5 o 2:30" inputmode="decimal">
          <div class="separador-o"><span>o bé, opcionalment, l'horari</span></div>
          <div class="dues">
            <div><label for="f-ini">Hora d'inici</label><input type="text" id="f-ini" placeholder="p. ex. 9" inputmode="numeric"></div>
            <div><label for="f-fin">Hora final</label><input type="text" id="f-fin" placeholder="p. ex. 1330" inputmode="numeric"></div>
          </div>
          <div class="pista">Hores: 13, 1330 o 13:30. Si poses inici i quantitat, el final es calcula sol.</div>
          <div id="f-durada" class="resum-form"></div>
          <label for="f-obs">Observacions</label>
          <input type="text" id="f-obs" maxlength="300">
          <div class="fila-botons">
            <button class="primari" id="f-desa">Desa</button>
            <button id="f-neteja">Neteja</button>
          </div>
        </section>
        <section class="targeta">
          <div class="barra-filtres" style="justify-content:space-between">
            <h2 style="margin:0">Les meves hores</h2>
            <div style="min-width:160px"><select id="f-mes">
              ${mesos.map((m) => `<option value="${m}" ${m === S.mes ? "selected" : ""}>${m.slice(5)}/${m.slice(0, 4)}</option>`).join("")}
              <option value="tots" ${S.mes === "tots" ? "selected" : ""}>Tots</option>
            </select></div>
          </div>
          <div id="m-resum" class="resum"></div>
          <div class="taula-cont" id="m-taula"><div class="buit">Carregant…</div></div>
        </section>
      </div>`;

    const proj = $("#f-proj"), tasca = $("#f-tasca");
    const omplirTasques = (sel = "") => {
      const t = tasquesDe(S.llistes.projecte.includes(proj.value) ? proj.value : "");
      tasca.innerHTML = t.length ? `<option value="">— tria la tasca —</option>` + t.map((x) =>
        `<option value="${esc(x)}" ${x === sel ? "selected" : ""}>${esc(x)}</option>`).join("")
        : `<option value="">— tria primer el projecte —</option>`;
    };
    proj.addEventListener("input", () => omplirTasques(tasca.value));
    proj.addEventListener("change", () => omplirTasques(tasca.value));
    const durada = () => {
      const qEl = $("#f-quant");
      const i = parseHora($("#f-ini").value), f = parseHora($("#f-fin").value);
      // amb inici i final, la quantitat es calcula i no es pot editar
      if (i != null && f != null && !Number.isNaN(i) && !Number.isNaN(f) && f > i) {
        qEl.value = fmtDurada(f - i); qEl.readOnly = true; qEl.classList.add("calculat");
      } else if (qEl.readOnly) { qEl.value = ""; qEl.readOnly = false; qEl.classList.remove("calculat"); }
      const t = calculaTemps();
      let previ = "";
      const dt = $("#f-data").value;
      if (!t.error && dt && S.acum) {
        const exc = S.editant ? S.editant.id : null;
        const dia = sumaRang(dt, dt, exc) + t.minuts;
        const set = sumaRang(iniciSetmana(dt), sumaDies(iniciSetmana(dt), 6), exc) + t.minuts;
        const est = estatSetmana(set);
        previ = `<div class="pista">Amb aquest registre: el dia quedarà en <b>${fmtDurada(dia)} h</b> i la setmana en <b class="txt-${est}">${fmtDurada(set)} h</b></div>` +
          (est === "passat" ? `<div class="avis-limit passat">⚠ Amb aquest registre superaries les ${LIMIT_MIN / 60} h setmanals.</div>`
           : est === "avis" ? `<div class="avis-limit avis">Et quedes a prop del límit de ${LIMIT_MIN / 60} h setmanals.</div>` : "");
      }
      $("#f-durada").innerHTML = t.error ? (t.buit ? "" : `<span class="error">${esc(t.error)}</span>`)
        : `<b>${fmtDurada(t.minuts)} h</b>` + (t.inici != null ? ` <span class="pista">· ${fmtHora(t.inici)} → ${fmtHora(t.final)}</span>` : "") + previ;
    };
    ["#f-ini", "#f-fin", "#f-quant"].forEach((s) => $(s).addEventListener("input", durada));
    $("#f-data").addEventListener("change", () => carregaAcumulat());
    ["#f-desc", "#f-quant", "#f-ini", "#f-fin", "#f-obs"].forEach((s) =>
      $(s).addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); desa(); } }));
    $("#f-desa").onclick = desa;
    $("#f-neteja").onclick = () => netejaForm(false);
    $("#f-mes").onchange = (e) => { S.mes = e.target.value; carregaMeves(); };

    S._omplirTasques = omplirTasques; S._durada = durada;
    if (S.editant) carregaAlForm(S.editant, true);
    carregaMeves();
  }

  function netejaForm(conserva, inici = "") {
    S.editant = null;
    $("#form-titol").textContent = "Nou registre";
    $("#form-targeta").classList.remove("editant");
    if (!conserva) { $("#f-data").value = avui(); $("#f-proj").value = ""; S._omplirTasques(""); }
    $("#f-desc").value = ""; $("#f-ini").value = inici; $("#f-fin").value = ""; $("#f-obs").value = "";
    const q = $("#f-quant"); q.readOnly = false; q.classList.remove("calculat"); q.value = "";
    S._durada();
    (inici ? $("#f-fin") : $("#f-quant")).focus();
  }

  function carregaAlForm(r, editar) {
    S.editant = editar ? r : null;
    $("#form-titol").textContent = editar ? "Editant registre" : "Nou registre (copiat)";
    $("#form-targeta").classList.toggle("editant", !!editar);
    $("#f-data").value = editar ? r.data : avui();
    $("#f-proj").value = r.projecte; S._omplirTasques(r.tasca);
    $("#f-desc").value = r.descripcio || "";
    const q = $("#f-quant"); q.readOnly = false; q.classList.remove("calculat");
    $("#f-ini").value = fmtHora(r.inici); $("#f-fin").value = fmtHora(r.final);
    q.value = r.inici == null ? fmtDurada(r.minuts) : "";
    $("#f-obs").value = r.obs || "";
    S._durada();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function desa() {
    const btn = $("#f-desa");
    const r = {
      data: $("#f-data").value, projecte: $("#f-proj").value.trim(), tasca: $("#f-tasca").value,
      descripcio: $("#f-desc").value.trim() || null, obs: $("#f-obs").value.trim() || null
    };
    const t = calculaTemps();
    const err = [];
    if (!r.data) err.push("Falta la data");
    if (!r.projecte) err.push("Falta el projecte");
    else if (!S.llistes.projecte.includes(r.projecte)) err.push("El projecte no és de la llista");
    if (!r.tasca) err.push("Falta la tasca");
    if (t.error) err.push(t.error);
    if (err.length) return toast(err.join(" · "), "error");
    Object.assign(r, { minuts: t.minuts, inici: t.inici, final: t.final });

    btn.disabled = true;
    const q = S.editant
      ? sb.from("registres").update(r).eq("id", S.editant.id).select()
      : sb.from("registres").insert(r).select();
    const { data, error } = await q;
    btn.disabled = false;
    if (error) return toast(missatgeError(error), "error");
    if (S.editant && (!data || !data.length)) return toast("No s'ha pogut modificar (potser ja s'ha exportat).", "error");
    toast(S.editant ? "Registre modificat." : "Registre desat.", "ok");
    if (r.data.slice(0, 7) !== S.mes && S.mes !== "tots") { S.mes = r.data.slice(0, 7); $("#f-mes").value = S.mes; }
    netejaForm(true, r.final != null ? fmtHora(r.final) : "");   // amb horari, la següent fila comença on acaba aquesta
    carregaMeves();
  }

  // Acumulats: avui, setmana i mes actuals (+ setmana de la data del formulari, per a la previsió)
  function sumaRang(desde, fins, excepteId = null) {
    return (S.acum || []).filter((r) => r.data >= desde && r.data <= fins && r.id !== excepteId)
      .reduce((a, r) => a + r.minuts, 0);
  }
  async function carregaAcumulat() {
    const a = avui(), fd = ($("#f-data") && $("#f-data").value) || a;
    const desde = [iniciSetmana(a), iniciMes(a), iniciSetmana(fd)].sort()[0];
    const fins = [sumaDies(iniciSetmana(a), 6), fiMes(a), sumaDies(iniciSetmana(fd), 6)].sort().pop();
    try {
      S.acum = await fetchAll(() => sb.from("registres").select("id,data,minuts").eq("user_id", S.user.id)
        .gte("data", desde).lte("data", fins).order("id"));
    } catch (e) { return; }
    if (!$("#c-avui")) return;
    const ws = iniciSetmana(a), we = sumaDies(ws, 6);
    const d = dataDe(a);
    $("#c-avui").textContent = `${fmtDurada(sumaRang(a, a))} h`;
    $("#c-avui-sub").textContent = `${DIES[d.getDay()]} ${fmtData(a).slice(0, 5)}`;
    const setm = sumaRang(ws, we), est = estatSetmana(setm);
    $("#c-set").textContent = `${fmtDurada(setm)} h`;
    $("#c-set-caixa").className = `comptador ${est}`;
    $("#c-set-barra").style.width = `${Math.min(100, (setm / LIMIT_MIN) * 100)}%`;
    const queda = LIMIT_MIN - setm;
    $("#c-set-sub").textContent = `${fmtData(ws).slice(0, 5)} – ${fmtData(we).slice(0, 5)} · ` +
      (queda >= 0 ? `en queden ${fmtDurada(queda)} h` : `${fmtDurada(-queda)} h per sobre del límit`);
    $("#c-mes").textContent = `${fmtDurada(sumaRang(iniciMes(a), fiMes(a)))} h`;
    $("#c-mes-sub").textContent = `${MESOS[d.getMonth()]} ${d.getFullYear()}`;
    if (S._durada) S._durada();
  }

  async function carregaMeves() {
    carregaAcumulat();
    try {
      const data = await fetchAll(() => {
        let q = sb.from("registres").select("*").eq("user_id", S.user.id);
        if (S.mes !== "tots") q = q.gte("data", `${S.mes}-01`).lt("data", `${mesSeguent(S.mes)}-01`);
        return q.order("data", { ascending: false }).order("inici", { ascending: false });
      });
      S.meves = data;
    } catch (e) { return toast(missatgeError(e), "error"); }
    const d = S.meves;
    const tot = d.reduce((a, r) => a + r.minuts, 0);
    const pend = d.filter((r) => !r.exportat).length;
    $("#m-resum").innerHTML = `<b>${fmtDurada(tot)} h</b> en ${d.length} registres` +
      (d.length ? ` <span class="pista">· ${pend} pendents de pujar a l'Odoo</span>` : "");
    $("#m-taula").innerHTML = !d.length ? `<div class="buit">No hi ha registres en aquest període.</div>` : `
      <table><thead><tr><th>Data</th><th>Projecte</th><th>Tasca</th><th>Descripció</th><th>Inici</th><th>Final</th>
        <th>Hores</th><th>Obs.</th><th>Estat</th><th></th></tr></thead><tbody>
      ${d.map((r, i) => `<tr>
        <td>${fmtData(r.data)}</td><td>${esc(r.projecte)}</td><td>${esc(r.tasca)}</td><td>${esc(r.descripcio)}</td>
        <td>${fmtHora(r.inici)}</td><td>${fmtHora(r.final)}</td><td class="num"><b>${fmtDurada(r.minuts)}</b></td>
        <td>${esc(r.obs)}</td>
        <td>${r.exportat ? `<span class="etiqueta verda">A l'Odoo</span>` : `<span class="etiqueta groga">Pendent</span>`}</td>
        <td class="accions">
          ${r.exportat ? "" : `<button class="petit" data-a="edita" data-i="${i}" title="Edita">✏️</button>`}
          <button class="petit" data-a="copia" data-i="${i}" title="Copia per avui">📋</button>
          ${r.exportat ? "" : `<button class="petit perill" data-a="esborra" data-i="${i}" title="Esborra">🗑️</button>`}
        </td></tr>`).join("")}
      </tbody></table>`;
    $$("#m-taula button").forEach((b) => b.onclick = async () => {
      const r = S.meves[+b.dataset.i];
      if (b.dataset.a === "edita") carregaAlForm(r, true);
      else if (b.dataset.a === "copia") { carregaAlForm(r, false); toast("Copiat amb la data d'avui. Revisa les hores i desa."); }
      else if (b.dataset.a === "esborra") {
        const ok = await confirma("Esborrar registre",
          `Segur que vols esborrar el registre del ${fmtData(r.data)} (${fmtDurada(r.minuts)} h, ${esc(r.projecte)})?`, "Esborra", "perill");
        if (!ok) return;
        const { error } = await sb.from("registres").delete().eq("id", r.id);
        if (error) return toast(missatgeError(error), "error");
        if (S.editant && S.editant.id === r.id) netejaForm(true);
        toast("Registre esborrat.", "ok"); carregaMeves();
      }
    });
  }

  // ------------------------------------------------------------------ ADMIN · comú
  async function carregaUsuaris() {
    const { data, error } = await sb.from("perfils").select("*").order("admin", { ascending: false }).order("usuari");
    if (error) throw error;
    S.usuaris = data;
    return data;
  }
  const nomUsuari = (p) => p ? (p.empleat || p.usuari) : "";

  async function registresAdmin(desde, fins, ids, nomesPendents) {
    return fetchAll(() => {
      let q = sb.from("registres").select("*, perfils(usuari, empleat)").gte("data", desde).lte("data", fins);
      if (ids && ids.length) q = q.in("user_id", ids);
      if (nomesPendents) q = q.is("exportat", null);
      return q.order("data").order("id");
    });
  }

  function filesOdoo(regs) {
    return regs.slice().sort((a, b) =>
      a.data.localeCompare(b.data) || nomUsuari(a.perfils).localeCompare(nomUsuari(b.perfils), "ca") || (a.inici ?? 9999) - (b.inici ?? 9999) || a.id - b.id)
      .map((r) => ({
        Data: r.data, "Descripció": r.descripcio || "", Empleat: (r.perfils && r.perfils.empleat) || "",
        Tasca: prefixProjecte(r.projecte) + r.tasca, Projecte: r.projecte,
        Quantitat: r.minuts / 60, "Hora d’inici": r.inici == null ? null : r.inici / 60, "Hora final": r.final == null ? null : r.final / 60
      }));
  }

  function excelOdoo(files) {
    const cap = ["Data", "Descripció", "Empleat", "Tasca", "Projecte", "Quantitat", "Hora d’inici", "Hora final"];
    // la data va com a número de sèrie d'Excel (evita desfasaments de zona horària)
    const serial = (iso) => { const [y, m, d] = iso.split("-").map(Number); return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000; };
    const aoa = [cap].concat(files.map((f) =>
      [serial(f.Data), f["Descripció"], f.Empleat, f.Tasca, f.Projecte, f.Quantitat, f["Hora d’inici"], f["Hora final"]]));
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    for (let r = 1; r < aoa.length; r++) {
      const c0 = ws[XLSX.utils.encode_cell({ r, c: 0 })]; if (c0) c0.z = "dd/mm/yyyy";
      for (const c of [5, 6, 7]) { const cell = ws[XLSX.utils.encode_cell({ r, c })]; if (cell) cell.z = "0.00"; }
    }
    ws["!cols"] = [12, 28, 30, 42, 42, 11, 12, 11].map((w) => ({ wch: w }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Pujar a l'Odoo");
    return wb;
  }
  const marcaTemps = () => { const d = new Date(); return `${isoLocal(d).replace(/-/g, "")}_${pad(d.getHours())}${pad(d.getMinutes())}`; };

  function selectorPersones(id, seleccionats) {
    const us = S.usuaris.filter((u) => !u.admin || u.empleat);
    return `<div class="llista-persones" id="${id}">${us.map((u) => `
      <label class="check"><input type="checkbox" value="${u.id}" ${seleccionats.includes(u.id) ? "checked" : ""}> ${esc(nomUsuari(u))}</label>`).join("")}
      </div><div class="pista">Cap marcat = totes</div>`;
  }
  const llegeixPersones = (id) => $$(`#${id} input:checked`).map((i) => i.value);

  // ------------------------------------------------------------------ ADMIN · exportar
  async function vistaExportar() {
    S.exp = S.exp || { desde: primerDiaMes(), fins: avui(), ids: [], pendents: true, marca: true, regs: [] };
    try { await carregaUsuaris(); } catch (e) { return toast(missatgeError(e), "error"); }
    const E = S.exp;
    $("#contingut").innerHTML = `
      <div class="graella">
        <section class="targeta">
          <h2>Exportar a l'Odoo</h2>
          <div class="dues">
            <div><label for="x-desde">Des de</label><input type="date" id="x-desde" value="${E.desde}"></div>
            <div><label for="x-fins">Fins a</label><input type="date" id="x-fins" value="${E.fins}"></div>
          </div>
          <label>Persones</label>${selectorPersones("x-pers", E.ids)}
          <label class="check"><input type="checkbox" id="x-pend" ${E.pendents ? "checked" : ""}> Només registres pendents d'exportar</label>
          <label class="check"><input type="checkbox" id="x-marca" ${E.marca ? "checked" : ""}> Marca'ls com a exportats en descarregar</label>
          <div class="fila-botons"><button class="verd" id="x-baixa">⬇ Descarrega Excel per a l'Odoo</button></div>
          <hr style="margin:18px 0;border:none;border-top:1px solid var(--vora)">
          <div class="fila-botons" style="margin-top:0">
            <button class="petit" id="x-desmarca">Desmarca els exportats del període</button>
            <button class="petit" id="x-copia">Còpia de seguretat (tots els registres)</button>
          </div>
          <div class="pista">"Desmarca" serveix per tornar a exportar un període.</div>
        </section>
        <section class="targeta">
          <div id="x-resum" class="resum"></div>
          <div class="taula-cont" id="x-taula"><div class="buit">Carregant…</div></div>
        </section>
      </div>`;
    const llegeix = () => { E.desde = $("#x-desde").value; E.fins = $("#x-fins").value; E.ids = llegeixPersones("x-pers");
      E.pendents = $("#x-pend").checked; E.marca = $("#x-marca").checked; };
    const refresca = async () => {
      llegeix();
      if (!E.desde || !E.fins) return;
      try { E.regs = await registresAdmin(E.desde, E.fins, E.ids, E.pendents); } catch (e) { return toast(missatgeError(e), "error"); }
      const files = filesOdoo(E.regs);
      const hores = files.reduce((a, f) => a + f.Quantitat, 0);
      $("#x-resum").innerHTML = `<b>${files.length}</b> registres · <b>${fmtDec(hores)}</b> hores <span class="pista">· vista prèvia del fitxer per a l'Odoo</span>`;
      const mostra = files.slice(0, 300);
      $("#x-taula").innerHTML = !files.length ? `<div class="buit">No hi ha registres amb aquests filtres.</div>` : `
        <table><thead><tr><th>Data</th><th>Descripció</th><th>Empleat</th><th>Tasca</th><th>Projecte</th>
          <th>Quantitat</th><th>Hora d’inici</th><th>Hora final</th></tr></thead><tbody>
        ${mostra.map((f) => `<tr><td>${fmtData(f.Data)}</td><td>${esc(f["Descripció"])}</td><td>${esc(f.Empleat)}</td>
          <td>${esc(f.Tasca)}</td><td>${esc(f.Projecte)}</td><td class="num">${fmtDec(f.Quantitat)}</td>
          <td class="num">${f["Hora d’inici"] == null ? "" : fmtDec(f["Hora d’inici"])}</td><td class="num">${f["Hora final"] == null ? "" : fmtDec(f["Hora final"])}</td></tr>`).join("")}
        </tbody></table>${files.length > 300 ? `<div class="pista">Es mostren les primeres 300 files; l'Excel les inclou totes.</div>` : ""}`;
    };
    $$("#x-desde, #x-fins, #x-pend, #x-marca").forEach((el) => el.onchange = refresca);
    $$("#x-pers input").forEach((el) => el.onchange = refresca);
    $("#x-baixa").onclick = async () => {
      await refresca();
      if (!E.regs.length) return toast("No hi ha registres per exportar.", "error");
      const sense = E.regs.filter((r) => !(r.perfils && r.perfils.empleat));
      if (sense.length) toast(`Atenció: ${sense.length} registres són d'usuaris sense nom d'Odoo.`, "error");
      XLSX.writeFile(excelOdoo(filesOdoo(E.regs)), `Odoo_hores_${marcaTemps()}.xlsx`);
      if (E.marca) {
        const ids = E.regs.map((r) => r.id); const ara = new Date().toISOString();
        for (let i = 0; i < ids.length; i += 200) {
          const { error } = await sb.from("registres").update({ exportat: ara }).in("id", ids.slice(i, i + 200));
          if (error) { toast(missatgeError(error), "error"); break; }
        }
        toast(`${ids.length} registres marcats com a exportats.`, "ok");
        refresca();
      }
    };
    $("#x-desmarca").onclick = async () => {
      llegeix();
      let regs;
      try { regs = (await registresAdmin(E.desde, E.fins, E.ids, false)).filter((r) => r.exportat); } catch (e) { return toast(missatgeError(e), "error"); }
      if (!regs.length) return toast("No hi ha registres exportats en aquest període.");
      if (!await confirma("Desmarcar exportats", `${regs.length} registres del període tornaran a estar pendents. Continuar?`)) return;
      const ids = regs.map((r) => r.id);
      for (let i = 0; i < ids.length; i += 200) {
        const { error } = await sb.from("registres").update({ exportat: null }).in("id", ids.slice(i, i + 200));
        if (error) return toast(missatgeError(error), "error");
      }
      toast(`${ids.length} registres tornen a estar pendents.`, "ok"); refresca();
    };
    $("#x-copia").onclick = async () => {
      let regs;
      try { regs = await fetchAll(() => sb.from("registres").select("*, perfils(usuari, empleat)").order("data").order("id")); }
      catch (e) { return toast(missatgeError(e), "error"); }
      const aoa = [["id", "Data", "Usuari", "Empleat", "Projecte", "Tasca", "Descripció", "Inici", "Final", "Hores", "Obs", "Exportat", "Creat", "Modificat"]]
        .concat(regs.map((r) => [r.id, r.data, r.perfils?.usuari || "", r.perfils?.empleat || "", r.projecte, r.tasca, r.descripcio || "",
          fmtHora(r.inici), fmtHora(r.final), r.minuts / 60, r.obs || "", r.exportat || "", r.creat, r.modificat]));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Registres");
      XLSX.writeFile(wb, `Copia_hores_${marcaTemps()}.xlsx`);
    };
    refresca();
  }

  // ------------------------------------------------------------------ ADMIN · tots els registres
  async function vistaTots() {
    S.tots = S.tots || { desde: primerDiaMes(), fins: avui(), ids: [], regs: [] };
    try { await carregaUsuaris(); } catch (e) { return toast(missatgeError(e), "error"); }
    const T = S.tots;
    $("#contingut").innerHTML = `
      <section class="targeta">
        <div class="barra-filtres">
          <div><label for="t-desde">Des de</label><input type="date" id="t-desde" value="${T.desde}"></div>
          <div><label for="t-fins">Fins a</label><input type="date" id="t-fins" value="${T.fins}"></div>
          <div style="min-width:240px"><label for="t-pers">Persona</label>
            <select id="t-pers"><option value="">Totes</option>${S.usuaris.map((u) =>
              `<option value="${u.id}" ${T.ids[0] === u.id ? "selected" : ""}>${esc(nomUsuari(u))}</option>`).join("")}</select></div>
        </div>
        <div id="t-resum" class="resum"></div>
        <div class="taula-cont" id="t-taula"><div class="buit">Carregant…</div></div>
      </section>`;
    const refresca = async () => {
      T.desde = $("#t-desde").value; T.fins = $("#t-fins").value; T.ids = $("#t-pers").value ? [$("#t-pers").value] : [];
      try { T.regs = await registresAdmin(T.desde, T.fins, T.ids, false); } catch (e) { return toast(missatgeError(e), "error"); }
      const d = T.regs.slice().sort((a, b) => b.data.localeCompare(a.data) || b.id - a.id);
      const tot = d.reduce((a, r) => a + r.minuts, 0);
      $("#t-resum").innerHTML = `<b>${d.length}</b> registres · <b>${fmtDurada(tot)} h</b>`;
      $("#t-taula").innerHTML = !d.length ? `<div class="buit">No hi ha registres.</div>` : `
        <table><thead><tr><th>Data</th><th>Persona</th><th>Projecte</th><th>Tasca</th><th>Descripció</th><th>Inici</th><th>Final</th>
          <th>Hores</th><th>Obs.</th><th>Exportat</th><th></th></tr></thead><tbody>
        ${d.map((r) => `<tr><td>${fmtData(r.data)}</td><td>${esc(nomUsuari(r.perfils))}</td><td>${esc(r.projecte)}</td><td>${esc(r.tasca)}</td>
          <td>${esc(r.descripcio)}</td><td>${fmtHora(r.inici)}</td><td>${fmtHora(r.final)}</td><td class="num">${fmtDurada(r.minuts)}</td>
          <td>${esc(r.obs)}</td><td>${r.exportat ? fmtData(r.exportat.slice(0, 10)) : ""}</td>
          <td class="accions"><button class="petit perill" data-id="${r.id}" title="Esborra">🗑️</button></td></tr>`).join("")}
        </tbody></table>`;
      $$("#t-taula button").forEach((b) => b.onclick = async () => {
        const r = T.regs.find((x) => String(x.id) === b.dataset.id);
        if (!await confirma("Esborrar registre", `Esborrar el registre de ${esc(nomUsuari(r.perfils))} del ${fmtData(r.data)} (${fmtDurada(r.minuts)} h)?`, "Esborra", "perill")) return;
        const { error } = await sb.from("registres").delete().eq("id", r.id);
        if (error) return toast(missatgeError(error), "error");
        toast("Esborrat.", "ok"); refresca();
      });
    };
    $$("#t-desde, #t-fins, #t-pers").forEach((el) => el.onchange = refresca);
    refresca();
  }

  // ------------------------------------------------------------------ ADMIN · usuaris
  async function creaUsuari(usuari, nom) {
    usuari = (usuari || "").trim().toLowerCase(); nom = (nom || "").trim();
    if (!/^[a-z0-9._-]{2,30}$/.test(usuari)) throw new Error(`Usuari no vàlid: "${usuari}" (només lletres sense accents, números, punt o guió)`);
    const pwd = generaPwd();
    const tmp = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: `hores-tmp-${Date.now()}-${Math.random()}` }
    });
    const { data, error } = await tmp.auth.signUp({ email: emailDe(usuari), password: pwd });
    if (error) throw error;
    if (!data.user) throw new Error("Supabase no ha retornat l'usuari");
    if (!data.session) throw new Error("Cal desactivar 'Confirm email' a Supabase (Authentication > Providers > Email)");
    const { error: e2 } = await sb.from("perfils").update({ empleat: nom, actiu: true, canviar_pwd: true }).eq("id", data.user.id);
    if (e2) throw e2;
    return { usuari, nom, pwd };
  }

  function mostraContrasenyes(llista) {
    const csv = "﻿usuari;nom_odoo;contrasenya_temporal\r\n" + llista.map((r) => `${r.usuari};${r.nom};${r.pwd}`).join("\r\n");
    modal("Contrasenyes temporals", `
      <p>Copia-les ara: no es tornaran a mostrar. Cada usuari l'haurà de canviar quan entri.</p>
      <table><thead><tr><th>Usuari</th><th>Nom Odoo</th><th>Contrasenya</th></tr></thead><tbody>
      ${llista.map((r) => `<tr><td>${esc(r.usuari)}</td><td>${esc(r.nom)}</td><td><code class="pwd">${esc(r.pwd)}</code></td></tr>`).join("")}
      </tbody></table>`, [
      { text: "Descarrega CSV", onClick: () => { descarregaFitxer(`contrasenyes_${marcaTemps()}.csv`, csv, "text/csv;charset=utf-8"); return false; } },
      { text: "Fet", cls: "primari" }]);
  }

  async function vistaUsuaris() {
    try { await carregaUsuaris(); } catch (e) { return toast(missatgeError(e), "error"); }
    $("#contingut").innerHTML = `
      <div class="graella">
        <section class="targeta">
          <h2>Nou usuari</h2>
          <label for="u-usuari">Usuari (per entrar, sense espais ni accents)</label>
          <input type="text" id="u-usuari" autocapitalize="none" placeholder="p. ex. rocio">
          <label for="u-nom">Nom a l'Odoo (COGNOMS, NOM)</label>
          <input type="text" id="u-nom">
          <div class="fila-botons"><button class="primari" id="u-crea">Crea usuari</button></div>
          <hr style="margin:20px 0;border:none;border-top:1px solid var(--vora)">
          <h2>Crear diversos de cop</h2>
          <label for="u-bloc">Una línia per persona: <code>usuari;COGNOMS, NOM</code></label>
          <textarea id="u-bloc" placeholder="rocio;SEGURA ALE, ROCIO&#10;cesc;BIBILONI SALVÀ, FRANCESC"></textarea>
          <div class="fila-botons"><button class="primari" id="u-bloc-crea">Crea tots</button></div>
        </section>
        <section class="targeta">
          <h2>Usuaris</h2>
          <div class="taula-cont">
            <table><thead><tr><th>Usuari</th><th>Nom Odoo</th><th>Rol</th><th>Estat</th><th></th></tr></thead><tbody>
            ${S.usuaris.map((u) => `<tr>
              <td>${esc(u.usuari)}</td><td>${esc(u.empleat)}</td>
              <td>${u.admin ? `<span class="etiqueta">Admin</span>` : "Usuari"}</td>
              <td>${u.actiu ? `<span class="etiqueta verda">Actiu</span>` : `<span class="etiqueta">Desactivat</span>`}
                  ${u.canviar_pwd && u.actiu ? `<span class="etiqueta groga">Pendent de canviar contrasenya</span>` : ""}</td>
              <td class="accions">
                <button class="petit" data-a="nom" data-id="${u.id}">Nom</button>
                <button class="petit" data-a="pwd" data-id="${u.id}">Contrasenya</button>
                ${u.id === S.user.id ? "" : `<button class="petit ${u.actiu ? "perill" : ""}" data-a="actiu" data-id="${u.id}">${u.actiu ? "Desactiva" : "Activa"}</button>`}
              </td></tr>`).join("")}
            </tbody></table>
          </div>
          <div class="pista">Un usuari desactivat no pot entrar ni veure res, però les seves hores es conserven.</div>
        </section>
      </div>`;

    $("#u-crea").onclick = async (ev) => {
      ev.target.disabled = true;
      try {
        if (!$("#u-nom").value.trim()) throw new Error("Falta el nom tal com surt a l'Odoo.");
        const r = await creaUsuari($("#u-usuari").value, $("#u-nom").value);
        await vistaUsuaris(); mostraContrasenyes([r]);
      } catch (e) { toast(missatgeError(e), "error"); ev.target.disabled = false; }
    };
    $("#u-bloc-crea").onclick = async (ev) => {
      const linies = $("#u-bloc").value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (!linies.length) return toast("No hi ha cap línia.", "error");
      ev.target.disabled = true; ev.target.textContent = "Creant…";
      const ok = [], errors = [];
      for (const l of linies) {
        const [usuari, ...resta] = l.split(";");
        try { ok.push(await creaUsuari(usuari, resta.join(";"))); }
        catch (e) { errors.push(`${usuari}: ${missatgeError(e)}`); }
      }
      await vistaUsuaris();
      if (ok.length) mostraContrasenyes(ok);
      if (errors.length) toast(`No s'han pogut crear: ${errors.join(" · ")}`, "error");
    };
    $$("#contingut td.accions button").forEach((b) => b.onclick = async () => {
      const u = S.usuaris.find((x) => x.id === b.dataset.id);
      if (b.dataset.a === "nom") {
        modal(`Nom a l'Odoo de ${u.usuari}`, `<input type="text" id="m-nom" value="${esc(u.empleat)}">`, [
          { text: "Cancel·la" },
          { text: "Desa", cls: "primari", onClick: async () => {
            const { error } = await sb.from("perfils").update({ empleat: $("#m-nom").value.trim() }).eq("id", u.id);
            if (error) { toast(missatgeError(error), "error"); return false; }
            vistaUsuaris();
          } }]);
      } else if (b.dataset.a === "pwd") {
        if (!await confirma("Restablir contrasenya", `Es generarà una contrasenya temporal nova per a <b>${esc(u.usuari)}</b>.`, "Restableix")) return;
        const pwd = generaPwd();
        const { error } = await sb.rpc("admin_set_password", { uid: u.id, pwd });
        if (error) return toast(missatgeError(error), "error");
        await vistaUsuaris(); mostraContrasenyes([{ usuari: u.usuari, nom: u.empleat, pwd }]);
      } else if (b.dataset.a === "actiu") {
        const { error } = await sb.from("perfils").update({ actiu: !u.actiu }).eq("id", u.id);
        if (error) return toast(missatgeError(error), "error");
        vistaUsuaris();
      }
    });
  }

  // ------------------------------------------------------------------ ADMIN · llistes
  const TIPUS = [["projecte", "Projectes"], ["tasca_projecte", "Tasques de projecte"], ["tasca_estructura", "Tasques d'estructura"]];
  async function vistaLlistes() {
    let data;
    try {
      data = await fetchAll(() => {
        let q = sb.from("llistes").select("*").eq("tipus", S.llTipus);
        if (!S.llInactius) q = q.eq("actiu", true);
        return q.order("id");
      });
    } catch (e) { return toast(missatgeError(e), "error"); }
    if (S.llTipus === "projecte") data.sort((a, b) => (a.valor === "ESTRUCTURA" ? -1 : b.valor === "ESTRUCTURA" ? 1 : b.valor.localeCompare(a.valor, "ca")));
    $("#contingut").innerHTML = `
      <div class="graella">
        <section class="targeta">
          <h2>Afegir</h2>
          <label for="l-tipus">Llista</label>
          <select id="l-tipus">${TIPUS.map(([k, t]) => `<option value="${k}" ${k === S.llTipus ? "selected" : ""}>${t}</option>`).join("")}</select>
          <label for="l-valor">Valor</label>
          <input type="text" id="l-valor" placeholder="p. ex. G1940 - Enq.NouEstudi">
          <div class="fila-botons"><button class="primari" id="l-afegeix">Afegeix</button></div>
          <div class="pista">Els projectes han de començar pel codi (G1940 - …) perquè a l'Odoo surti el prefix a la tasca.</div>
        </section>
        <section class="targeta">
          <label class="check"><input type="checkbox" id="l-inactius" ${S.llInactius ? "checked" : ""}> Mostra també els desactivats</label>
          <div class="taula-cont"><table><thead><tr><th>Valor</th><th>Estat</th><th></th></tr></thead><tbody>
            ${data.map((r) => `<tr><td>${esc(r.valor)}</td>
              <td>${r.actiu ? `<span class="etiqueta verda">Actiu</span>` : `<span class="etiqueta">Desactivat</span>`}</td>
              <td class="accions"><button class="petit" data-id="${r.id}" data-actiu="${r.actiu}">${r.actiu ? "Desactiva" : "Activa"}</button></td></tr>`).join("")}
          </tbody></table></div>
          <div class="pista">Desactivar treu l'element dels desplegables; els registres antics no es toquen.</div>
        </section>
      </div>`;
    $("#l-tipus").onchange = (e) => { S.llTipus = e.target.value; vistaLlistes(); };
    $("#l-inactius").onchange = (e) => { S.llInactius = e.target.checked; vistaLlistes(); };
    const afegeix = async () => {
      const v = $("#l-valor").value.trim(); if (!v) return;
      const { error } = await sb.from("llistes").upsert({ tipus: S.llTipus, valor: v, actiu: true }, { onConflict: "tipus,valor" });
      if (error) return toast(missatgeError(error), "error");
      toast(`Afegit: ${v}`, "ok"); await carregaLlistes(); vistaLlistes();
    };
    $("#l-afegeix").onclick = afegeix;
    $("#l-valor").addEventListener("keydown", (e) => { if (e.key === "Enter") afegeix(); });
    $$("#contingut td.accions button").forEach((b) => b.onclick = async () => {
      const { error } = await sb.from("llistes").update({ actiu: b.dataset.actiu !== "true" }).eq("id", b.dataset.id);
      if (error) return toast(missatgeError(error), "error");
      await carregaLlistes(); vistaLlistes();
    });
  }

  // ------------------------------------------------------------------ engega
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") tancaModal(); });
  inici().catch((e) => { app.innerHTML = `<div class="login"><h1>Error</h1><p>${esc(missatgeError(e))}</p></div>`; });
})();
