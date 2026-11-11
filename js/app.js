/* Formulario de campo para líderes · Sanidad Vegetal La Sultana
 * Guarda todo en el teléfono y lo envía a la hoja cuando hay señal.
 * v1.14 (10/11/2026): la palma marcada o ya trabajada sale del listado (Deshacer / Ver también las marcadas); marcas del equipo al día al abrir el lote.
 * v1.13 (10/11/2026): PIN de operario: ve las cuatro labores, marca palmas y las marcas van al libro (MARCAS EQUIPO); el líder incluye las marcas del equipo en su reporte.
 * v1.5 (02/11/2026): Strategus por línea - palma; palmas con posible error de escritura en el listado de censo.
 * v1.4 (02/11/2026): listado de casos por lote (línea - palma) para Control PC, Censo y Strategus.
 * Habla con el puente de Apps Script v2.9:
 *   GET  ?action=captura&pin=XXXXXX
 *   GET  ?action=casos&pin=XXXXXX   (listados de casos, se guardan para usar sin señal)
 *   POST {pin, items:[{uid, tipo:'registro'|'novedad', ...}]}
 */
(function () {
  'use strict';

  const K = { cfg: 'captura_cfg', sesion: 'captura_sesion', cola: 'captura_cola', enviados: 'captura_enviados', ultimo: 'captura_ultimo',
             casos: 'captura_casos', marcas: 'captura_marcas' };
  const CANTIDAD = { 'Control PC': 'Cirugías', 'Control Strategus': 'Controles / galerías' };
  const MAX_ENVIADOS = 150;
  const LIMITE_CANTIDAD = 300;   // cirugías o controles por lote en un día
  let modoCambioPin = false;
  const $ = (id) => document.getElementById(id);

  // ---------- Almacenamiento ----------
  function leer(k, def) {
    try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch (e) { return def; }
  }
  function guardar(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { avisar('El teléfono no tiene espacio para guardar'); return false; }
  }

  let cfg = leer(K.cfg, {});
  let sesion = leer(K.sesion, null);
  let cola = leer(K.cola, []);
  let enviados = leer(K.enviados, []);
  let ultimo = leer(K.ultimo, {});
  let enviando = false;
  let ultimoFallo = '';

  function urlPuente() { return (window.PUENTE_URL || cfg.url || '').trim(); }

  // ---------- Utilidades ----------
  function hoy() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function fechaCorta(iso) {
    const p = String(iso).split('-');
    return p.length === 3 ? p[2] + '/' + p[1] : iso;
  }
  function uid() {
    return 'F' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function proyectoCorto(p) { return String(p).replace(/^Altagracia\s*/i, 'Alt '); }
  function loteCorto(l) {
    const s = String(l).replace(/^LOTE\s*/i, '').trim();
    return /^\d+$/.test(s) ? String(Number(s)) : s;
  }
  function has(n) { return Number(n).toLocaleString('es-CO', { maximumFractionDigits: 1 }); }
  function el(tag, attrs, html) {
    const e = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => { if (k === 'text') e.textContent = v; else e.setAttribute(k, v); });
    if (html) e.innerHTML = html;
    return e;
  }

  let tAviso;
  function avisar(msg) {
    const a = $('aviso');
    a.textContent = msg;
    a.classList.add('visible');
    clearTimeout(tAviso);
    tAviso = setTimeout(() => a.classList.remove('visible'), 3200);
  }

  async function pedir(url, opciones, ms) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms || 25000);
    try {
      const r = await fetch(url, Object.assign({ signal: ctl.signal, redirect: 'follow' }, opciones || {}));
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } finally { clearTimeout(t); }
  }

  // ---------- Ingreso con PIN ----------
  let pin = '';
  function pintarPin() {
    [...$('pin-puntos').children].forEach((s, i) => s.classList.toggle('lleno', i < pin.length));
  }
  function errorIngreso(msg) {
    $('ingreso-error').textContent = msg;
    const p = $('pin-puntos');
    p.classList.remove('sacude'); void p.offsetWidth; p.classList.add('sacude');
    pin = ''; pintarPin();
  }

  async function intentarIngreso() {
    const url = $('cfg-url').value.trim() || urlPuente();
    if (!url) {
      $('ingreso-config').open = true;
      errorIngreso('Falta la dirección de conexión. Pídela al coordinador.');
      return;
    }
    if (!navigator.onLine) { errorIngreso('Necesitas señal para entrar la primera vez.'); return; }
    $('teclado').classList.add('ocupado');
    $('ingreso-error').textContent = 'Revisando…';
    try {
      const r = await pedir(url + (url.includes('?') ? '&' : '?') + 'action=captura&pin=' + encodeURIComponent(pin));
      if (!r.ok) { errorIngreso(r.error === 'PIN no válido o inactivo' ? 'PIN incorrecto o desactivado.' : (r.error || 'No se pudo entrar.')); return; }
      if (!window.PUENTE_URL) { cfg.url = url; guardar(K.cfg, cfg); }
      const antes = sesion && sesion.lider ? sesion.lider.nombre : '';
      sesion = { pin: pin, lider: r.lider, lotes: r.lotes || [], labores: r.labores || [], estados: r.estados || [], tipos: r.tipos || [], pcSiembraDesde: r.pcSiembraDesde || 0, actualizado: Date.now() };
      guardar(K.sesion, sesion);
      pin = ''; pintarPin();
      $('ingreso-error').textContent = '';
      const eraCambio = modoCambioPin;
      modoCambioPin = false;
      ultimoFallo = '';
      iniciarApp();
      if (eraCambio) {
        avisar(antes && antes !== r.lider.nombre ? 'Entraste como ' + r.lider.nombre + '. Enviando lo pendiente.' : 'PIN actualizado. Enviando lo pendiente.');
        enviar(true);
      }
    } catch (e) {
      errorIngreso('No hubo respuesta. Revisa la señal e intenta otra vez.');
    } finally {
      $('teclado').classList.remove('ocupado');
    }
  }

  $('teclado').addEventListener('click', (ev) => {
    const b = ev.target.closest('button'); if (!b) return;
    const k = b.dataset.k;
    if (k === 'borrar') pin = pin.slice(0, -1);
    else if (pin.length < 6) pin += k;
    $('ingreso-error').textContent = '';
    pintarPin();
    if (pin.length === 6) intentarIngreso();
  });
  document.addEventListener('keydown', (ev) => {
    if ($('v-ingreso').hidden || ev.target.tagName === 'INPUT') return;
    if (/^\d$/.test(ev.key) && pin.length < 6) { pin += ev.key; pintarPin(); if (pin.length === 6) intentarIngreso(); }
    if (ev.key === 'Backspace') { pin = pin.slice(0, -1); pintarPin(); }
  });

  // ---------- Datos de la sesión ----------
  function proyectos() {
    const vistos = [];
    sesion.lotes.forEach((l) => { if (!vistos.includes(l.proyecto)) vistos.push(l.proyecto); });
    return vistos;
  }
  function lotesDe(p) { return sesion.lotes.filter((l) => l.proyecto === p); }
  function lotePorId(id) { return sesion.lotes.find((l) => l.id === id); }
  function labores() {
    const fijas = ['Censo Enfermedades', 'Monitoreo Plagas', 'Control PC', 'Control Strategus', 'Recolección PC', 'Lectura freatímetros', 'Otra labor'];
    const lista = (sesion.labores || []).filter((x) => x && fijas.includes(x));
    const todas = lista.length ? lista : fijas;
    // cada líder solo trabaja su labor (más "Otra labor"); coordinador o "Puede registrar cualquier labor" ven todas
    if (veTodo()) return todas;
    if (esOperario()) return ['Control PC', 'Censo Enfermedades', 'Monitoreo Plagas', 'Control Strategus'];
    const suya = sesion.lider && sesion.lider.labor;
    return todas.includes(suya) ? [suya].concat(todas.includes('Otra labor') ? ['Otra labor'] : []) : todas;
  }
  function esConsulta() { return !!(sesion && sesion.lider && /consulta/i.test(sesion.lider.notas || '')); }
  function esOperario() { return !!(sesion && sesion.lider && /operario/i.test(sesion.lider.notas || '')); }
  function soloMarca() { return esConsulta() || esOperario(); }   // no reporta labor ni novedades
  function veTodo() { return !!(sesion && sesion.lider && (/coordinador/i.test(sesion.lider.labor + ' ' + sesion.lider.nombre) || /cualquier/i.test(sesion.lider.notas || ''))); }
  function estados() { return (sesion.estados && sesion.estados.length) ? sesion.estados : ['Terminado', 'En avance', 'Revisión']; }
  function tipos() { return (sesion.tipos && sesion.tipos.length) ? sesion.tipos : ['Foco PC', 'Plaga', 'Strategus', 'Clima / día perdido', 'Seguridad', 'Otro']; }

  // ---------- Confirmación antes de guardar ----------
  function confirmar(sub, lineas, avisos) {
    return new Promise((ok) => {
      const d = $('confirmar');
      $('conf-sub').textContent = sub;
      const ul = $('conf-lista');
      ul.innerHTML = '';
      lineas.forEach((l) => ul.appendChild(el('li', {}, l)));
      const av = $('conf-avisos');
      av.innerHTML = '';
      av.hidden = !avisos.length;
      avisos.forEach((a) => av.appendChild(el('p', { text: '⚠ ' + a })));
      d.returnValue = '';
      d.addEventListener('close', () => ok(d.returnValue === 'ok'), { once: true });
      d.showModal();
    });
  }
  function esc(t) { return String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function diasAtras(fecha) {
    return Math.round((new Date(hoy() + 'T12:00:00') - new Date(fecha + 'T12:00:00')) / 86400000);
  }
  function yaTerminado(labor, loteId, fecha) {
    const mes = fecha.slice(0, 7);
    return cola.concat(enviados).find((x) => x.tipo === 'registro' && x.labor === labor && x.lote === loteId &&
      x.estado === 'Terminado' && String(x.fecha || '').slice(0, 7) === mes);
  }

  // ---------- Formulario de labor ----------
  const fl = { proyecto: '', lotes: [], estado: '' };

  function pintarLabor() {
    $('l-fecha').value = $('l-fecha').value || hoy();
    $('l-fecha').max = hoy();

    const sel = $('l-labor');
    sel.innerHTML = '';
    labores().forEach((l) => sel.appendChild(el('option', { value: l, text: l })));
    sel.value = ultimo.labor && labores().includes(ultimo.labor) ? ultimo.labor : (labores().includes(sesion.lider.labor) ? sesion.lider.labor : labores()[0]);

    const cp = $('l-proyectos');
    cp.innerHTML = '';
    proyectos().forEach((p) => {
      const b = el('button', { type: 'button', 'data-p': p, 'aria-pressed': 'false', text: proyectoCorto(p) });
      cp.appendChild(b);
    });
    if (!fl.proyecto && ultimo.proyecto && proyectos().includes(ultimo.proyecto)) fl.proyecto = ultimo.proyecto;
    marcarProyecto();

    const ce = $('l-estados');
    ce.innerHTML = '';
    estados().forEach((e) => ce.appendChild(el('button', { type: 'button', 'data-e': e, 'aria-pressed': String(fl.estado === e), text: e })));
  }

  function marcarProyecto() {
    [...$('l-proyectos').children].forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.p === fl.proyecto)));
    pintarLotes();
  }

  function pintarLotes() {
    const c = $('l-lotes');
    c.innerHTML = '';
    if (!fl.proyecto) return;
    lotesDe(fl.proyecto).forEach((l) => {
      const b = el('button', { type: 'button', class: 'lote', 'data-id': l.id, 'aria-pressed': String(fl.lotes.includes(l.id)),
        'aria-label': l.lote + ', ' + has(l.has) + ' hectáreas, ' + l.material });
      const lc = listaDe($('l-labor').value, l.id);
      b.innerHTML = '<b>' + loteCorto(l.lote) + '</b><small>' + has(l.has) + ' ha</small>' +
        (/guin/i.test(l.material) ? '<span class="marca-g" aria-hidden="true">G</span>' : '') +
        (lc && lc.length ? '<span class="casos-n" title="palmas en el listado">' + lc.length + '</span>' : '');
      c.appendChild(b);
    });
  }

  function pintarDetalle() {
    const d = $('l-detalle');
    const etiqueta = CANTIDAD[$('l-labor').value];
    // conservar lo que ya se escribió
    const previo = {};
    d.querySelectorAll('.detalle-fila').forEach((f) => {
      previo[f.dataset.id] = { tramo: (f.querySelector('[name=tramo]') || {}).value, cantidad: (f.querySelector('[name=cantidad]') || {}).value };
    });
    d.innerHTML = '';
    d.hidden = fl.lotes.length === 0;
    fl.lotes.forEach((id) => {
      const l = lotePorId(id); if (!l) return;
      const soloVer = soloMarca();
      const f = el('div', { class: 'detalle-fila' + (etiqueta && !soloVer ? '' : ' sin-cantidad'), 'data-id': id });
      const p = previo[id] || {};
      f.innerHTML =
        '<div class="detalle-lote" title="' + l.id + '">' + loteCorto(l.lote) + '</div>' +
        (soloVer ? '' : '<label class="campo"><span>Líneas</span><input name="tramo" type="text" autocomplete="off" placeholder="Ej: 1 a 56"></label>' +
        (etiqueta ? '<label class="campo"><span>' + etiqueta + '</span><input name="cantidad" type="number" inputmode="numeric" min="0" step="1" placeholder="0"></label>' : ''));
      if (!soloVer) {
        f.querySelector('[name=tramo]').value = p.tramo || '';
        if (etiqueta && p.cantidad) f.querySelector('[name=cantidad]').value = p.cantidad;
      }
      const labor = $('l-labor').value;
      if (LISTA[labor]) {
        const lista = listaDe(labor, id);
        const b = el('button', { type: 'button', class: 'detalle-casos', 'data-id': id });
        if (!lista) { b.classList.add('vacio'); b.textContent = casos ? 'Sin listado para este lote' : 'Sin listado: actualice los casos con señal'; }
        else if (!lista.length && !eqDe(labor, id).length) { b.classList.add('vacio'); b.textContent = (LISTA[labor] === 'st' ? 'Sin palmas en el listado' : 'Sin palmas con PC en el sistema') + ' · toque para anotar una'; }
        else {
          const k = pendientesM(marcasDe(labor, id)).length;
          const tl = LISTA[labor];
          const sinCir = tl === 'pc' ? lista.filter((x) => x[2] > 0).length : tl === 'st' ? lista.filter((x) => x[3] !== 0).length : -1;
          const ne = eqNoMias(labor, id).length;
          b.textContent = '📋 Ver listado: ' + lista.length + ' palmas' + (sinCir >= 0 ? ' · ' + sinCir + (tl === 'st' ? ' sin control' : ' sin cirugía') : '') + (k ? ' · ✓ ' + k + ' ' + (esConsulta() ? 'marcadas' : marcaTxt(labor)) : '') + (ne ? ' · 👥 ' + ne + ' del equipo' : '');
        }
        f.appendChild(b);
      }
      d.appendChild(f);
    });
  }

  $('l-proyectos').addEventListener('click', (ev) => {
    const b = ev.target.closest('button'); if (!b) return;
    if (fl.proyecto !== b.dataset.p) { fl.proyecto = b.dataset.p; fl.lotes = []; pintarDetalle(); }
    marcarProyecto();
  });
  $('l-lotes').addEventListener('click', (ev) => {
    const b = ev.target.closest('.lote'); if (!b) return;
    const id = b.dataset.id;
    fl.lotes = fl.lotes.includes(id) ? fl.lotes.filter((x) => x !== id) : fl.lotes.concat(id);
    b.setAttribute('aria-pressed', String(fl.lotes.includes(id)));
    pintarDetalle();
  });
  $('l-estados').addEventListener('click', (ev) => {
    const b = ev.target.closest('button'); if (!b) return;
    fl.estado = b.dataset.e;
    [...$('l-estados').children].forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.e === fl.estado)));
  });
  $('l-labor').addEventListener('change', () => { pintarLotes(); pintarDetalle(); pintarStrat(); });
  $('l-detalle').addEventListener('click', (ev) => {
    const b = ev.target.closest('.detalle-casos'); if (!b) return;
    abrirCasos($('l-labor').value, b.dataset.id);
  });

  $('f-labor').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (soloMarca()) return;
    const err = $('l-error');
    const fecha = $('l-fecha').value;
    const labor = $('l-labor').value;
    const etiqueta = CANTIDAD[labor];
    err.textContent = '';
    if (!fecha) return (err.textContent = 'Falta la fecha.');
    if (fecha > hoy()) return (err.textContent = 'La fecha no puede ser después de hoy.');
    if (!fl.lotes.length) return (err.textContent = 'Toca al menos un lote.');
    if (!fl.estado) return (err.textContent = 'Elige el estado: ' + estados().join(', ') + '.');

    const filas = [...$('l-detalle').querySelectorAll('.detalle-fila')];
    if (etiqueta) {
      const vacia = filas.find((f) => f.querySelector('[name=cantidad]').value === '');
      if (vacia) {
        vacia.querySelector('[name=cantidad]').focus();
        return (err.textContent = 'Escribe las ' + etiqueta.toLowerCase() + ' del lote ' + vacia.querySelector('.detalle-lote').textContent + ' (0 si no hubo).');
      }
    }
    const obs = $('l-obs').value.trim();
    const marcadas = {};
    const nuevos = filas.map((f) => {
      const l = lotePorId(f.dataset.id);
      const cant = etiqueta ? Math.max(0, Math.round(Number(f.querySelector('[name=cantidad]').value))) : '';
      // palmas marcadas en el listado (las agregadas a mano van en observaciones)
      let palmas = '', obsLote = obs;
      if (LISTA[labor] && marcas[claveM(labor, l.id)]) {
        const mm = marcas[claveM(labor, l.id)];
        const pend = pendientesM(mm);
        marcadas[l.id] = pend;
        palmas = pend.join(',');
        const extra = pend.filter((k) => mm.m[k].x).map((k) => 'L' + k.replace('-', '-P'));
        if (extra.length) obsLote = (obs ? obs + ' · ' : '') + (labor === 'Monitoreo Plagas' ? 'Palmas con plaga fuera de la lista: ' : ({ pc: 'Cirugías fuera de la lista: ', sis: 'Palmas nuevas con PC: ', st: 'Strategus fuera de la lista: ' })[LISTA[labor]]) + extra.join(', ');
        const deEq = pend.filter((k) => mm.m[k].eq).map((k) => mm.m[k].eq);
        if (deEq.length) {
          const quien = {};
          deEq.forEach((n) => { quien[n] = (quien[n] || 0) + 1; });
          obsLote = (obsLote ? obsLote + ' · ' : '') + 'Marcas del equipo: ' + Object.keys(quien).map((n) => n + ' ' + quien[n]).join(', ');
        }
      }
      return {
        uid: uid(), tipo: 'registro', fecha: fecha, labor: labor, lote: l.id, estado: fl.estado,
        tramo: f.querySelector('[name=tramo]').value.trim(), cantidad: cant, observaciones: obsLote, palmas: palmas,
        _txt: labor + ', ' + proyectoCorto(l.proyecto) + ' lote ' + loteCorto(l.lote),
        _sub: fechaCorta(fecha) + ', ' + fl.estado + (etiqueta ? ', ' + cant + ' ' + etiqueta.toLowerCase() : ''),
        _creado: Date.now()
      };
    });
    // resumen y avisos antes de guardar
    const avisos = [];
    const dAtras = diasAtras(fecha);
    if (dAtras > 3) avisos.push('La fecha es de hace ' + dAtras + ' días. ¿Es correcta?');
    const lineasConf = nuevos.map((it) => {
      const l = lotePorId(it.lote);
      const nom = 'Lote ' + loteCorto(l.lote) + ' (' + proyectoCorto(l.proyecto) + ')';
      if (etiqueta && it.cantidad > LIMITE_CANTIDAD) avisos.push(nom + ': ' + it.cantidad + ' ' + etiqueta.toLowerCase() + ' es mucho para un día. Revisa el número.');
      const nm = (marcadas[it.lote] || []).length;
      if (labor === 'Control PC' && nm && nm !== it.cantidad) avisos.push(nom + ': marcaste ' + nm + ' palmas con cirugía en el listado y escribiste ' + it.cantidad + ' cirugías.');
      if (labor === 'Control PC' && !/guin/i.test(l.material)) avisos.push(nom + ' es Híbrido. El control de PC se hace en Guineensis.');
      else if (labor === 'Control PC' && sesion.pcSiembraDesde && Number(l.siembra) >= sesion.pcSiembraDesde) avisos.push(nom + ' es siembra ' + l.siembra + '. Esos lotes aún no entran en control de PC.');
      if (it.estado === 'Terminado' && labor !== 'Control PC') {
        const prev = yaTerminado(labor, it.lote, fecha);
        if (prev) avisos.push(nom + ' ya lo enviaste como Terminado el ' + fechaCorta(prev.fecha) + '.');
      }
      return '<b>' + esc(nom) + '</b><br>' + esc(it.estado) + (etiqueta ? ', ' + it.cantidad + ' ' + etiqueta.toLowerCase() : '') +
        (it.tramo ? ', líneas ' + esc(it.tramo) : '') +
        (nm ? '<br>' + nm + ' palmas ' + marcaTxt(labor) + ' en el listado' : '');
    });
    const okConf = await confirmar(labor + ', ' + fechaCorta(fecha), lineasConf, avisos);
    if (!okConf) return;

    cola = cola.concat(nuevos);
    if (!guardar(K.cola, cola)) return;
    // las palmas enviadas quedan en gris en el listado
    Object.keys(marcadas).forEach((id) => {
      const mm = marcas[claveM(labor, id)];
      marcadas[id].forEach((k) => { if (mm && mm.m[k]) mm.m[k].s = 1; });
    });
    guardar(K.marcas, marcas);
    ultimo = { labor: labor, proyecto: fl.proyecto };
    guardar(K.ultimo, ultimo);

    // listo para el siguiente lote: se quedan fecha, labor, proyecto y estado
    fl.lotes = [];
    $('l-obs').value = '';
    pintarLotes(); pintarDetalle();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    avisar(nuevos.length === 1 ? 'Labor guardada.' : nuevos.length + ' lotes guardados.');
    pintarEstado();
    enviar();
  });

  // ---------- Listado de casos por lote (línea - palma) ----------
  // Control PC: palmas con PC del último censo sin cirugía en esta ronda. Censo: todas las palmas con PC en el sistema.
  const LISTA = { 'Control PC': 'pc', 'Censo Enfermedades': 'sis', 'Control Strategus': 'st', 'Monitoreo Plagas': 'st' };
  const MARCA_LAB = { 'Control PC': 'con cirugía', 'Censo Enfermedades': 'revisadas', 'Control Strategus': 'controladas', 'Monitoreo Plagas': 'verificadas' };
  function marcaTxt(labor) { return MARCA_LAB[labor] || 'marcadas'; }
  // Marcas de los operarios que llegaron al libro (MARCAS EQUIPO): [línea, palma, persona, 'dd/mm', nueva]
  function eqDe(labor, id) { const e = casos && casos.datos && casos.datos.eq; return (e && e[labor] && e[labor][id]) || []; }
  function yo() { return sesion && sesion.lider ? sesion.lider.nombre : ''; }
  function eqNoMias(labor, id) {
    const mm = marcasDe(labor, id);
    return eqDe(labor, id).filter((x) => x[2] !== yo() && !mm.m[x[0] + '-' + x[1]]);
  }
  function hoyMarcadas(labor) {
    const ini = new Date(hoy() + 'T00:00:00').getTime();
    let n = 0;
    Object.keys(marcas).forEach((k) => {
      if (k.split('|')[0] !== labor) return;
      const mm = marcas[k];
      Object.keys(mm.m).forEach((p) => { if ((mm.m[p].t || 0) >= ini) n++; });
    });
    return n;
  }
  const DIAS_MARCAS = 15;
  let casos = leer(K.casos, null);      // { hora, datos }
  let marcas = leer(K.marcas, {});      // 'labor|lote' -> { censo, t0, m: { 'línea-palma': { s: 0 marcada | 1 enviada, x: 1 si se agregó a mano } } }
  let abierto = null;                   // { labor, id }

  // ---------- Avance de la semana (igual que el DASHBOARD) ----------
  function num(n, d) { return Number(n || 0).toLocaleString('es-CO', { maximumFractionDigits: d === undefined ? 1 : d }); }
  function pintarSemana() {
    const box = $('semana');
    const S = casos && casos.datos && casos.datos.semana;
    if (!S || !S.labores || !S.labores.length) { box.hidden = true; return; }
    const libre = veTodo() || esOperario();
    const lab = libre ? ($('l-labor').value || S.labores[0].labor) : sesion.lider.labor;
    const o = S.labores.find((x) => x.labor === lab) || (libre ? null : S.labores[0]);
    if (!o) { box.hidden = true; return; }
    box.hidden = false;
    const pc = o.labor === 'Control PC';
    let h = '<div class="sem-cab"><b>' + esc(o.labor) + (o.mes ? ' · ' + esc(o.mes) : '') + '</b></div>';
    if (esOperario()) {
      const n = hoyMarcadas(o.labor);
      h += '<div class="sem-fila grande sem-mio"><span>Hoy usted marcó</span><b>' + n + (n === 1 ? ' palma' : ' palmas') +
        (o.labor === 'Control PC' ? ' <small>(meta: ' + num(o.meta || 40, 0) + ' cirugías)</small>' : '') + '</b></div>';
      h += '<hr class="sem-sep">';
    }
    let clase = '';
    if (o.programadoMes !== undefined) {
      h += '<div class="sem-fila"><span>Meta al cierre de esta semana (sáb ' + esc(S.sabado || S.hasta) + ')</span><b>' + Math.round((o.esperadoCierre || 0) * 100) + ' % = ' + num(o.metaCierreHa, 0) + ' ha</b></div>';
      h += '<div class="sem-fila grande"><span>Mes</span><b>' + num(o.hechoMes, 0) + ' de ' + num(o.programadoMes, 0) + ' ha · ' + Math.round((o.pctMes || 0) * 100) + ' %</b></div>';
      h += '<div class="sem-barra"><i style="width:' + Math.min(100, Math.round((o.pctMes || 0) * 100)) + '%"></i><em style="left:' + Math.min(100, Math.round((o.esperadoCierre || 0) * 100)) + '%"></em></div>';
      if (o.falta > 0) {
        h += '<div class="sem-fila grande"><span>Le faltan</span><b>' + num(o.falta, 0) + ' ha para cumplir meta</b></div>';
        if (o.necesitaPorPersonaDia) {
          h += '<div class="sem-fila"><span>Necesita</span><b>' + num(o.necesitaPorPersonaDia) + ' ha por persona/día <small>(meta normal: ' + num(o.metaHaPersonaDia, 0) + ')</small></b></div>';
          h += '<p class="sem-nota">' + o.personas + ' personas · ' + o.quedanDias + (o.quedanDias === 1 ? ' día hábil que queda' : ' días hábiles que quedan') + ' en la semana</p>';
        }
        clase = o.necesitaPorPersonaDia && o.necesitaPorPersonaDia <= o.metaHaPersonaDia * 1.2 ? 'sem-medio' : 'sem-bajo';
        if (o.necesitaPorPersonaDia && o.necesitaPorPersonaDia <= o.metaHaPersonaDia) clase = 'sem-medio';
      } else {
        h += '<div class="sem-fila grande"><span>Va adelantado</span><b>' + num(-o.falta, 0) + ' ha sobre la meta</b></div>';
        clase = 'sem-ok';
      }
    }
    h += '<hr class="sem-sep">';
    if (pc) {
      const cumpl = o.diasCumplidos || 0, dias = (o.dias || []).length;
      h += '<div class="sem-fila"><span>Esta semana: ha de lotes cerrados</span><b>' + num(o.ha) + ' ha</b></div>';
      if (dias) h += '<div class="sem-fila"><span>Días cumplidos (≥ ' + num(o.meta, 0) + ' cirugías por persona o lote cerrado)</span><b>' + cumpl + ' de ' + dias + '</b></div>';
      h += '<div class="sem-fila"><span>Cirugías en la semana</span><b>' + num(o.cirugias, 0) + '</b></div>';
      if (o.dias && o.dias.length) h += '<div class="sem-dias">' + o.dias.map((d) => '<span class="' + (d.cumplido ? 'ok' : (d.personas ? 'no' : 'sin')) + '">' + esc(d.dia.slice(0, 2)) + '<small>' + (d.personas ? num(d.promedio, 0) : '—') + '</small></span>').join('') + '</div>';
      if (o.cirugiasPend) h += '<p class="sem-nota">+ ' + num(o.cirugiasPend, 0) + ' cirugías enviadas por aprobar</p>';
    } else {
      h += '<div class="sem-fila"><span>Esta semana (' + esc(S.desde) + ' al ' + esc(S.hasta) + '): lleva</span><b>' + num(o.ha, 0) + ' de ' + num(o.metaSemana, 0) + ' ha</b></div>';
      if (o.pendientes) h += '<p class="sem-nota">+ ' + o.pendientes + ' reporte(s) enviado(s) por aprobar</p>';
    }
    box.className = 'semana' + (clase ? ' ' + clase : '');
    h += '<p class="sem-estado">' + (S.diasTranscurridos ? 'Cuenta lo aprobado por el coordinador' : 'La semana empieza el lunes ' + esc(S.desde) + '. ¡Buena semana!') + '</p>';
    box.innerHTML = h;
  }
  $('l-labor').addEventListener('change', () => { if (veTodo() || esOperario()) pintarSemana(); });

  async function cargarCasos() {
    if (!navigator.onLine || !sesion || !urlPuente()) return false;
    try {
      const r = await pedir(urlPuente() + (urlPuente().includes('?') ? '&' : '?') + 'action=casos&pin=' + encodeURIComponent(sesion.pin), null, 90000);
      if (!r || !r.ok) return false;
      casos = { hora: Date.now(), datos: r };
      guardar(K.casos, casos);
      pintarLotes(); pintarDetalle(); pintarStrat(); pintarSemana();
      if (abierto) pintarCasos();
      return true;
    } catch (e) { return false; }
  }
  function datosLote(id) { return casos && casos.datos && casos.datos.lotes ? casos.datos.lotes[id] || null : null; }
  function listaDe(labor, id) {
    const t = LISTA[labor]; if (!t || !casos) return null;
    const d = datosLote(id);
    return d ? filasDe(d, t) : [];
  }
  // Control PC: todas las palmas del sistema (pcs). Si el servidor es viejo, solo las pendientes (pc)
  function filasDe(d, t) {
    if (!d) return [];
    if (t === 'pc') return d.pcs || (d.pc || []).map((x) => [x[0], x[1], x[2] ? 2 : 1]);
    if (t === 'st') return d.sts || (d.st || []).map((x) => [x[0], x[1], x[2], 1]);
    return d[t] || [];
  }
  function claveM(labor, id) { return labor + '|' + id; }
  function marcasDe(labor, id) {
    const k = claveM(labor, id), d = datosLote(id), censo = d ? d.censo : '';
    let m = marcas[k];
    // las marcas valen para una ronda: se borran si llega un censo nuevo o pasan 15 días
    if (m && (m.censo !== censo || Date.now() - m.t0 > DIAS_MARCAS * 86400000)) { delete marcas[k]; m = null; guardar(K.marcas, marcas); }
    return m || { censo: censo, t0: Date.now(), m: {} };
  }
  function pendientesM(mm) { return Object.keys(mm.m).filter((k) => mm.m[k].s === 0); }

  function abrirCasos(labor, id) {
    abierto = { labor: labor, id: id };
    $('casos-ocultar').checked = false;
    $('casos-nl').value = ''; $('casos-np').value = '';
    $('casos-aviso').hidden = true;
    pintarCasos();
    $('casos').showModal();
    $('casos-cuerpo').scrollTop = 0;
    traerMarcasLote(id);
  }
  // Marcas del equipo de este lote, al día (liviano). Así lo que marcó un compañero sale del listado.
  async function traerMarcasLote(id) {
    if (!navigator.onLine || !casos || !casos.datos || !urlPuente()) return;
    try {
      const r = await pedir(urlPuente() + '?action=marcas&pin=' + encodeURIComponent(sesion.pin) + '&lote=' + encodeURIComponent(id), null, 20000);
      if (!r || !r.ok || !r.eq) return;
      const E = casos.datos.eq = casos.datos.eq || {};
      Object.keys(MARCA_LAB).forEach((lab) => {
        if (r.eq[lab] && r.eq[lab].length) (E[lab] = E[lab] || {})[id] = r.eq[lab];
        else if (E[lab]) delete E[lab][id];
      });
      guardar(K.casos, casos);
      if (abierto && abierto.id === id) pintarCasos();
    } catch (e) { /* sin señal: se queda con lo último descargado */ }
  }
  // Avisos dentro del listado (con Deshacer cuando aplica)
  let tAvisoC, deshacerFn = null;
  const recien = {};   // palmas recién marcadas: se ven en verde un momento antes de salir del listado
  function avisarCasos(msg, deshacer) {
    $('casos-aviso-txt').textContent = msg;
    deshacerFn = deshacer || null;
    $('casos-deshacer').hidden = !deshacer;
    $('casos-aviso').hidden = false;
    clearTimeout(tAvisoC);
    tAvisoC = setTimeout(() => { $('casos-aviso').hidden = true; deshacerFn = null; }, deshacer ? 6000 : 3500);
  }
  $('casos-deshacer').addEventListener('click', () => { const f = deshacerFn; deshacerFn = null; $('casos-aviso').hidden = true; if (f) f(); });
  function salirDelListado(k) {
    clearTimeout(recien[k]);
    recien[k] = setTimeout(() => {
      delete recien[k];
      if (!abierto || $('casos-ocultar').checked) return;
      const b = $('casos-cuerpo').querySelector('.palma[data-k="' + k + '"]');
      if (!b || !(b.classList.contains('hecha') || b.classList.contains('enviada'))) return;
      const cont = b.parentNode, fila = cont.parentNode;
      b.remove();
      if (!cont.children.length) fila.remove();
      if (!$('casos-cuerpo').querySelector('.palma')) pintarCasos();
    }, 1500);
  }

  function pintarCasos() {
    const labor = abierto.labor, id = abierto.id, tipo = LISTA[labor], esPC = tipo === 'pc', esST = tipo === 'st';
    const l = lotePorId(id), d = datosLote(id) || { censo: '', pc: [], sis: [], st: [] };
    const mm = marcasDe(labor, id);
    const lista = filasDe(d, tipo);
    const ya = {};
    lista.forEach((x) => { ya[x[0] + '-' + x[1]] = 1; });
    const extras = Object.keys(mm.m).filter((k) => mm.m[k].x && !ya[k]).map((k) => { ya[k] = 1; return k.split('-').map(Number).concat([-1]); });
    // marcas del equipo: quién marcó cada palma (las nuevas fuera de lista también se muestran)
    const eq = {};
    eqDe(labor, id).forEach((x) => {
      const k = x[0] + '-' + x[1];
      (eq[k] = eq[k] || []).push(x[2] + ' ' + x[3]);
      if (!ya[k]) { ya[k] = 1; extras.push([x[0], x[1], -1]); }
    });
    const eqOtros = eqNoMias(labor, id);
    const todas = lista.concat(extras);
    const porLinea = {};
    todas.forEach((x) => { (porLinea[x[0]] = porLinea[x[0]] || []).push(x); });
    const hechas = todas.filter((x) => mm.m[x[0] + '-' + x[1]]).length;
    const deEquipo = todas.filter((x) => { const k = x[0] + '-' + x[1]; return !mm.m[k] && eq[k]; }).length;
    const yaRonda = (x) => (esPC && x[2] === 0) || (esST && x[3] === 0);      // ya con cirugía / control en esta ronda
    const faltan = todas.filter((x) => { const k = x[0] + '-' + x[1]; return !mm.m[k] && !eq[k] && !yaRonda(x); }).length;

    $('casos-titulo').textContent = proyectoCorto(l.proyecto) + ' · Lote ' + loteCorto(l.lote) + ' — ' + labor;
    $('casos-sub').textContent = esPC ? (casos && casos.datos.pcFuente === 'PC LIDERES' ? 'Palmas con PC reportadas (listado oficial SIGAIND)' : 'Palmas con PC en el sistema (censo y control) · último censo ' + (d.censo || '—'))
                               : esST ? (labor === 'Monitoreo Plagas' ? 'Censo de plagas · palmas con Strategus del lote para verificar' : 'Censo de plagas · todas las palmas con Strategus del lote')
                                      : 'Palmas con PC en el sistema · último censo ' + (d.censo || '—');
    $('casos-cuenta').textContent = 'Faltan ' + faltan + ' de ' + todas.length + ' palmas · ' + (esOperario() ? 'usted marcó ' + hechas : hechas + ' ' + (esConsulta() ? 'marcadas en mi lista' : 'marcadas para su reporte')) +
      (deEquipo ? ' · 👥 ' + deEquipo + ' del equipo' : '');
    const bEq = $('casos-equipo');
    bEq.hidden = soloMarca() || !eqOtros.length;
    bEq.textContent = 'Incluir en mi reporte las ' + eqOtros.length + ' marcadas por el equipo';
    $('casos-ley').textContent = esPC ? '★ reincidente o grave: atender primero · al marcar una palma sale del listado' : esST ? '★ 3 o más adultos: atender primero · al marcar una palma sale del listado'
                                      : '★ grave · punteado: cirugía sin censo · ✎ posible error de escritura: dar de alta';
    $('casos-nueva-txt').textContent = esConsulta() ? 'Palma que no está en la lista: escriba línea y palma para anotarla en su lista. Avísele al líder.'
                                     : esOperario() ? 'Palma que no está en la lista: escriba línea y palma. Le llega al líder como palma nueva.'
                                     : labor === 'Monitoreo Plagas' ? 'Palma con plaga que no está en la lista: escriba línea y palma. Se reporta en observaciones.' : esPC ? 'Palma con PC que no está en la lista: escriba línea y palma. Cuenta como palma con cirugía.'
                                     : esST ? 'Palma con Strategus que no está en la lista: escriba línea y palma. Se reporta en observaciones.'
                                            : 'Palma nueva con PC: escriba línea y palma. Se reporta en observaciones.';
    const verTodas = $('casos-ocultar').checked;      // "Ver también las marcadas"
    const soloMarcaP = soloMarca();
    const oculta = (x) => {
      const k = x[0] + '-' + x[1];
      if (verTodas || recien[k]) return false;
      if (mm.m[k] || yaRonda(x)) return true;
      if (!eq[k]) return false;
      // marcada por el equipo: el operario ya no la ve; el líder la ve en azul hasta incluirla en su reporte
      return soloMarcaP || eq[k].some((q) => q.indexOf(yo() + ' ') === 0);
    };
    const tope = $('casos-cuerpo').scrollTop;
    const c = $('casos-cuerpo');
    c.innerHTML = '';
    const lineas = Object.keys(porLinea).map(Number).sort((a, b) => a - b);
    let pintadas = 0;
    lineas.forEach((ln) => {
      const ps = porLinea[ln].sort((a, b) => a[1] - b[1]);
      const visibles = ps.filter((x) => !oculta(x));
      if (!visibles.length) return;
      const fila = el('div', { class: 'casos-linea' });
      fila.appendChild(el('b', {}, 'Línea ' + ln + '<small>' + (verTodas ? ps.length + (ps.length === 1 ? ' palma' : ' palmas') : (visibles.length === 1 ? 'falta 1' : 'faltan ' + visibles.length)) + '</small>'));
      const cont = el('div', { class: 'casos-palmas' });
      visibles.forEach((x) => {
        const k = x[0] + '-' + x[1], st = mm.m[k];
        let cls = 'palma';
        if ((esPC && x[2] === 2) || (tipo === 'sis' && x[2] === 2) || (esST && x[2] >= 3 && x[3] !== 0)) cls += ' grave';
        if ((esPC && x[2] === 0) || (esST && x[3] === 0)) cls += ' en-control';
        if (tipo === 'sis' && x[2] === 0) cls += ' sin-censo';
        if (tipo === 'sis' && x[2] === 3) cls += ' error';
        if (x[2] === -1) cls += ' extra';
        if (st) cls += st.s === 1 ? ' enviada' : ' hecha';
        else if (eq[k]) cls += eq[k].some((q) => q.indexOf(yo() + ' ') === 0) ? ' enviada' : ' equipo';
        const b = el('button', { type: 'button', class: cls, 'data-k': k, 'aria-label': 'Línea ' + x[0] + ' palma ' + x[1], text: String(x[1]) });
        if (eq[k]) b.title = 'Marcada por ' + eq[k].join(', ');
        cont.appendChild(b);
        pintadas++;
      });
      fila.appendChild(cont);
      c.appendChild(fila);
    });
    if (!pintadas) c.appendChild(el('p', { class: 'casos-vacio', text: todas.length ? 'No falta ninguna palma en este lote. 👏 Para revisar o corregir, active "Ver también las marcadas".' : 'No hay palmas en el listado de este lote.' }));
    c.scrollTop = tope;
  }

  function guardarMarca(mm) {
    marcas[claveM(abierto.labor, abierto.id)] = mm;
    guardar(K.marcas, marcas);
  }
  $('casos-cuerpo').addEventListener('click', (ev) => {
    const b = ev.target.closest('.palma'); if (!b) return;
    const mm = marcasDe(abierto.labor, abierto.id), k = b.dataset.k;
    const eqK = eqDe(abierto.labor, abierto.id).filter((x) => x[0] + '-' + x[1] === k);
    const mia = eqK.some((x) => x[2] === yo());
    if (esOperario()) {
      if ((mm.m[k] && mm.m[k].s === 1) || (!mm.m[k] && mia)) {
        if (!confirm('¿Quitar su marca de la línea ' + k.replace('-', ', palma ') + '? Se le avisa al libro.')) return;
        anularMarca(abierto.labor, abierto.id, k);
        delete mm.m[k]; guardarMarca(mm); pintarCasos(); pintarSemana(); return;
      }
      const otros = eqK.filter((x) => x[2] !== yo());
      if (!mm.m[k] && otros.length) return avisarCasos('Ya la marcó ' + otros.map((x) => x[2] + ' el ' + x[3]).join(', ') + '.');
    } else if (mm.m[k] && mm.m[k].s === 1) return avisarCasos('Esa palma ya se envió en un reporte.');
    const labor = abierto.labor, id = abierto.id;
    const quitar = () => {
      const m2 = marcasDe(labor, id);
      delete m2.m[k]; clearTimeout(recien[k]); delete recien[k];
      marcas[claveM(labor, id)] = m2; guardar(K.marcas, marcas);
      if (abierto) pintarCasos();
      if (esOperario()) pintarSemana();
    };
    if (mm.m[k]) { quitar(); $('casos-aviso').hidden = true; return; }
    mm.m[k] = { s: 0, t: Date.now() };
    const otro = eqK.find((x) => x[2] !== yo());
    if (otro && !soloMarca()) { mm.m[k].eq = otro[2]; if (otro[4]) mm.m[k].x = 1; }
    guardarMarca(mm);
    salirDelListado(k);
    pintarCasos();
    avisarCasos('✓ Línea ' + k.replace('-', ', palma ') + ' marcada', quitar);
    if (esOperario()) pintarSemana();
  });
  $('casos-ocultar').addEventListener('change', pintarCasos);
  $('casos-agregar').addEventListener('click', () => {
    const ln = Math.round(Number($('casos-nl').value)), pm = Math.round(Number($('casos-np').value));
    if (!(ln >= 1 && ln <= 300) || !(pm >= 1 && pm <= 80)) return avisarCasos('Revisa la línea (1 a 300) y la palma (1 a 80).');
    const mm = marcasDe(abierto.labor, abierto.id), k = ln + '-' + pm;
    if (mm.m[k] && mm.m[k].s === 1) return avisarCasos('Esa palma ya se envió en un reporte.');
    const d = datosLote(abierto.id) || {};
    const lista = filasDe(d, LISTA[abierto.labor]);
    const enLista = lista.some((x) => x[0] === ln && x[1] === pm);
    mm.m[k] = enLista ? { s: 0, t: Date.now() } : { s: 0, x: 1, t: Date.now() };
    guardarMarca(mm);
    $('casos-nl').value = ''; $('casos-np').value = '';
    salirDelListado(k);
    avisarCasos(enLista ? 'Esa palma ya estaba en la lista: quedó marcada.' : '✓ Palma agregada y marcada: línea ' + ln + ', palma ' + pm + '.');
    pintarCasos();
    if (esOperario()) pintarSemana();
  });
  // Líder: pasa a su reporte las palmas que marcó el equipo
  $('casos-equipo').addEventListener('click', () => {
    const mm = marcasDe(abierto.labor, abierto.id);
    const otros = eqNoMias(abierto.labor, abierto.id);
    otros.forEach((x) => { const o = { s: 0, t: Date.now(), eq: x[2] }; if (x[4]) o.x = 1; mm.m[x[0] + '-' + x[1]] = o; });
    guardarMarca(mm);
    avisarCasos(otros.length + ' palmas del equipo quedaron marcadas para su reporte.');
    pintarCasos();
  });
  // Operario: lo marcado se envía al libro (MARCAS EQUIPO) al cerrar el listado
  function enviarMarcasOperario(labor, id) {
    const mm = marcasDe(labor, id);
    const pend = pendientesM(mm);
    if (!pend.length) return 0;
    const l = lotePorId(id);
    const lista = pend.filter((k) => !mm.m[k].x), nuevas = pend.filter((k) => mm.m[k].x);
    cola.push({ uid: uid(), tipo: 'marca', accion: 'marcar', fecha: hoy(), labor: labor, lote: id, palmas: lista.join(','), nuevas: nuevas.join(','),
      _txt: 'Marcas ' + labor + ', ' + proyectoCorto(l.proyecto) + ' lote ' + loteCorto(l.lote), _sub: fechaCorta(hoy()) + ', ' + pend.length + (pend.length === 1 ? ' palma' : ' palmas'), _creado: Date.now() });
    pend.forEach((k) => { mm.m[k].s = 1; });
    marcas[claveM(labor, id)] = mm;
    guardar(K.marcas, marcas); guardar(K.cola, cola);
    pintarEstado(); enviar();
    return pend.length;
  }
  function anularMarca(labor, id, k) {
    const l = lotePorId(id);
    cola.push({ uid: uid(), tipo: 'marca', accion: 'anular', fecha: hoy(), labor: labor, lote: id, palmas: k, nuevas: '',
      _txt: 'Quitar marca ' + labor + ', ' + proyectoCorto(l.proyecto) + ' lote ' + loteCorto(l.lote), _sub: 'Línea ' + k.replace('-', ', palma '), _creado: Date.now() });
    guardar(K.cola, cola); pintarEstado(); enviar();
  }
  $('casos-listo').addEventListener('click', () => {
    const labor = abierto.labor, id = abierto.id;
    const pend = pendientesM(marcasDe(labor, id));
    if (esOperario()) { const n = enviarMarcasOperario(labor, id); if (n) avisar(n + (n === 1 ? ' palma marcada' : ' palmas marcadas') + '. Se envían al libro.'); pintarSemana(); }
    $('casos').close();
    abierto = null;
    pintarDetalle();
    // llena cirugías y líneas con lo marcado (se puede corregir a mano)
    const f = $('l-detalle').querySelector('.detalle-fila[data-id="' + CSS.escape(id) + '"]');
    if (f && pend.length && !soloMarca()) {
      const ls = pend.map((k) => Number(k.split('-')[0]));
      const tr = f.querySelector('[name=tramo]');
      if (!tr.value) tr.value = Math.min.apply(null, ls) + ' a ' + Math.max.apply(null, ls);
      const ca = f.querySelector('[name=cantidad]');
      if (ca && LISTA[labor] === 'pc') ca.value = pend.length;
    }
  });
  $('casos').addEventListener('cancel', () => { if (abierto && esOperario()) enviarMarcasOperario(abierto.labor, abierto.id); abierto = null; pintarDetalle(); });

  // Strategus: lotes con presencia por controlar, por prioridad (toque para elegir el lote)
  function pintarStrat() {
    const box = $('l-strat');
    const dd = casos && casos.datos ? casos.datos : {};
    const lista = dd.stLotes || (dd.strategus || []).map((x) => ({ id: x.id, total: x.palmas, pend: x.palmas, individuos: x.individuos, fecha: x.fecha, dias: x.dias, avance: x.avance }));
    box.hidden = !sesion || $('l-labor').value !== 'Control Strategus' || !lista.length;
    if (box.hidden) return;
    $('l-strat-sub').textContent = 'Primero los que tienen palmas sin control. Toque uno para elegirlo.';
    const c = $('l-strat-lista');
    c.innerHTML = '';
    lista.forEach((x, i) => {
      const l = lotePorId(x.id); if (!l) return;
      const b = el('button', { type: 'button', 'data-id': x.id });
      b.innerHTML = '<span class="n">' + (i + 1) + '</span><span><b>' + esc(proyectoCorto(l.proyecto)) + ' · Lote ' + esc(loteCorto(l.lote)) + '</b>' +
        '<small>' + (x.pend ? x.pend + ' sin control de ' + x.total + (x.total === 1 ? ' palma' : ' palmas') + (x.individuos ? ' · ' + x.individuos + ' adultos' : '') + ' · desde ' + esc(x.fecha) + ' (' + x.dias + ' días)' + (x.avance ? ' · en avance' : '')
                         : 'Ya controlado · ' + x.total + (x.total === 1 ? ' palma' : ' palmas') + ' para revisar') + '</small></span>';
      if (!x.pend) b.classList.add('st-hecho');
      c.appendChild(b);
    });
  }
  $('l-strat-lista').addEventListener('click', (ev) => {
    const b = ev.target.closest('button'); if (!b) return;
    const l = lotePorId(b.dataset.id); if (!l) return;
    fl.proyecto = l.proyecto;
    if (!fl.lotes.includes(l.id)) fl.lotes = (fl.lotes.length && lotePorId(fl.lotes[0]).proyecto === l.proyecto ? fl.lotes : []).concat(l.id);
    marcarProyecto(); pintarDetalle();
    $('l-detalle').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  // ---------- Formulario de novedad ----------
  const fn = { tipo: '' };
  function pintarNovedad() {
    $('n-fecha').value = $('n-fecha').value || hoy();
    $('n-fecha').max = hoy();
    const ct = $('n-tipos');
    ct.innerHTML = '';
    tipos().forEach((t) => ct.appendChild(el('button', { type: 'button', 'data-t': t, 'aria-pressed': String(fn.tipo === t), text: t })));
    const sp = $('n-proyecto');
    sp.innerHTML = '<option value="">Ninguno</option>';
    proyectos().forEach((p) => sp.appendChild(el('option', { value: p, text: proyectoCorto(p) })));
    pintarLotesNovedad();
  }
  function pintarLotesNovedad() {
    const p = $('n-proyecto').value;
    const sl = $('n-lote');
    sl.innerHTML = '<option value="">Ninguno</option>';
    sl.disabled = !p;
    if (p) lotesDe(p).forEach((l) => sl.appendChild(el('option', { value: l.id, text: 'Lote ' + loteCorto(l.lote) })));
  }
  $('n-proyecto').addEventListener('change', pintarLotesNovedad);
  $('n-tipos').addEventListener('click', (ev) => {
    const b = ev.target.closest('button'); if (!b) return;
    fn.tipo = b.dataset.t;
    [...$('n-tipos').children].forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.t === fn.tipo)));
  });
  $('f-novedad').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const err = $('n-error');
    err.textContent = '';
    const fecha = $('n-fecha').value;
    const desc = $('n-desc').value.trim();
    if (!fecha) return (err.textContent = 'Falta la fecha.');
    if (fecha > hoy()) return (err.textContent = 'La fecha no puede ser después de hoy.');
    if (!fn.tipo) return (err.textContent = 'Elige el tipo de novedad.');
    if (!desc) { $('n-desc').focus(); return (err.textContent = 'Cuenta qué pasó.'); }
    const loteId = $('n-lote').value;
    const l = loteId ? lotePorId(loteId) : null;
    const avisosN = diasAtras(fecha) > 3 ? ['La fecha es de hace ' + diasAtras(fecha) + ' días. ¿Es correcta?'] : [];
    const okN = await confirmar('Novedad, ' + fechaCorta(fecha), ['<b>' + esc(fn.tipo) + '</b>' +
      (l ? ' en ' + esc(proyectoCorto(l.proyecto) + ' lote ' + loteCorto(l.lote)) : '') + '<br>' + esc(desc)], avisosN);
    if (!okN) return;
    cola.push({
      uid: uid(), tipo: 'novedad', fecha: fecha, tipoNovedad: fn.tipo, lote: loteId,
      descripcion: desc, accion: $('n-accion').value.trim(),
      _txt: 'Novedad: ' + fn.tipo + (l ? ', ' + proyectoCorto(l.proyecto) + ' lote ' + loteCorto(l.lote) : ''),
      _sub: fechaCorta(fecha) + ', ' + desc.slice(0, 60), _creado: Date.now()
    });
    if (!guardar(K.cola, cola)) return;
    fn.tipo = '';
    $('n-desc').value = ''; $('n-accion').value = '';
    $('n-proyecto').value = ''; pintarNovedad();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    avisar('Novedad guardada.');
    pintarEstado();
    enviar();
  });

  // ---------- Envío a la hoja ----------
  function limpio(it) {
    const o = {};
    Object.keys(it).forEach((k) => { if (k[0] !== '_') o[k] = it[k]; });
    return o;
  }

  async function enviar(forzar) {
    if (enviando || !sesion || !urlPuente() || esConsulta()) return;
    if (forzar) cola.forEach((it) => delete it._error);
    const lote = cola.filter((it) => !it._error).slice(0, 40);
    if (!lote.length) { pintarEstado(); return; }
    if (!navigator.onLine) { ultimoFallo = 'sin-senal'; pintarEstado(); return; }
    enviando = true; pintarEstado();
    try {
      const r = await pedir(urlPuente(), {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ pin: sesion.pin, items: lote.map(limpio) })
      }, 45000);
      if (!r.ok) {
        ultimoFallo = /pin/i.test(r.error || '') ? 'pin' : 'hoja';
        if (ultimoFallo === 'pin') avisar('Tu PIN ya no sirve. Toca la franja roja para escribir el nuevo.');
        return;
      }
      ultimoFallo = '';
      const ok = new Set(r.procesados || []);
      const errores = {};
      (r.errores || []).forEach((e) => { errores[e.uid] = e.error; });
      const ahora = Date.now();
      const salen = cola.filter((it) => ok.has(it.uid));
      cola = cola.filter((it) => !ok.has(it.uid));
      cola.forEach((it) => { if (errores[it.uid]) it._error = errores[it.uid]; });
      enviados = salen.map((it) => ({ uid: it.uid, tipo: it.tipo, fecha: it.fecha, labor: it.labor, lote: it.lote, estado: it.estado,
        _txt: it._txt, _sub: it._sub, _enviado: ahora })).concat(enviados).slice(0, MAX_ENVIADOS);
      guardar(K.cola, cola); guardar(K.enviados, enviados);
      if (salen.some((it) => it.tipo !== 'marca')) setTimeout(cargarCasos, 1500);   // avance de la semana al día (las marcas de operario no lo cambian)
      if (salen.length && forzar) avisar(salen.length === 1 ? '1 envío llegó a la hoja.' : salen.length + ' envíos llegaron a la hoja.');
      if (cola.some((it) => !it._error)) setTimeout(() => enviar(), 500);
    } catch (e) {
      ultimoFallo = 'sin-senal';
    } finally {
      enviando = false;
      pintarEstado();
      pintarEnvios();
    }
  }

  function pintarEstado() {
    const b = $('estado-envio');
    const n = cola.length;
    const conError = cola.filter((it) => it._error).length;
    let estado = 'ok', txt = 'Todo enviado';
    if (enviando) { estado = 'enviando'; txt = 'Enviando…'; }
    else if (ultimoFallo === 'pin') { estado = 'error'; txt = 'Tu PIN cambió. Toca aquí para escribir el nuevo'; }
    else if (conError) { estado = 'error'; txt = conError === 1 ? '1 envío tiene un problema. Toca para ver' : conError + ' envíos tienen un problema. Toca para ver'; }
    else if (n && ultimoFallo === 'sin-senal') { estado = 'pendiente'; txt = 'Sin señal. Se envía solo cuando haya'; }
    else if (n && ultimoFallo === 'hoja') { estado = 'pendiente'; txt = 'La hoja no respondió. Se reintenta solo'; }
    else if (n) { estado = 'pendiente'; txt = 'Por enviar'; }
    b.dataset.estado = estado;
    $('estado-num').textContent = n;
    $('estado-txt').textContent = txt;
    const pn = $('pestana-num');
    pn.hidden = n === 0; pn.textContent = n;
  }

  function pintarEnvios() {
    const lc = $('lista-cola');
    lc.innerHTML = '';
    cola.slice().reverse().forEach((it) => {
      const li = el('li', { class: it._error ? 'con-error' : '' });
      li.appendChild(el('span', { class: 'item-titulo', text: it._txt || it.tipo }));
      const bb = el('button', { type: 'button', class: 'item-borrar', 'data-uid': it.uid, text: 'Borrar' });
      li.appendChild(bb);
      li.appendChild(el('span', { class: 'item-sub', text: it._sub || '' }));
      if (it._error) li.appendChild(el('span', { class: 'item-error', text: it._error }));
      lc.appendChild(li);
    });
    const le = $('lista-enviados');
    le.innerHTML = '';
    enviados.slice(0, 40).forEach((it) => {
      const li = el('li', { class: 'enviado' });
      li.appendChild(el('span', { class: 'item-titulo', text: it._txt }));
      li.appendChild(el('span', { class: 'item-sub', text: (it._sub || '') }));
      le.appendChild(li);
    });
  }

  $('lista-cola').addEventListener('click', (ev) => {
    const b = ev.target.closest('.item-borrar'); if (!b) return;
    const it = cola.find((x) => x.uid === b.dataset.uid); if (!it) return;
    if (!confirm('¿Borrar "' + it._txt + '"? No se enviará a la hoja.')) return;
    cola = cola.filter((x) => x.uid !== b.dataset.uid);
    guardar(K.cola, cola);
    pintarEnvios(); pintarEstado();
  });
  $('btn-enviar').addEventListener('click', () => {
    if (!cola.length) return avisar('No hay nada por enviar.');
    if (!navigator.onLine) return avisar('Sin señal. Se envía solo cuando haya.');
    enviar(true);
  });
  $('estado-envio').addEventListener('click', () => {
    if (ultimoFallo === 'pin') return pedirPinNuevo();
    if (esOperario()) {
      const err = cola.filter((it) => it._error);
      if (err.length) return alert(err.map((it) => it._txt + ': ' + it._error).join('\n'));
      if (cola.length) { avisar('Enviando ' + cola.length + '…'); enviar(true); } else avisar('Todas sus marcas llegaron al libro.');
      return;
    }
    irA('envios');
    if (cola.length) enviar(true);
  });

  // ---------- Pestañas y menú ----------
  function irA(nombre) {
    document.querySelectorAll('.panel').forEach((p) => { p.hidden = p.dataset.panel !== nombre; });
    document.querySelectorAll('.pestanas button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.ir === nombre)));
    if (nombre === 'envios') pintarEnvios();
    if (nombre === 'equipo') abrirEquipo();
    window.scrollTo(0, 0);
  }
  document.querySelector('.pestanas').addEventListener('click', (ev) => {
    const b = ev.target.closest('button'); if (b) irA(b.dataset.ir);
  });

  $('btn-menu').addEventListener('click', () => {
    const f = new Date(sesion.actualizado);
    $('menu-info').textContent = sesion.lotes.length + ' lotes, actualizados el ' + f.toLocaleDateString('es-CO') + ' a las ' + f.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) + '.' +
      (casos ? ' Listado de casos: censo hasta ' + (casos.datos.censoHasta || '—') + ', descargado ' + new Date(casos.hora).toLocaleString('es-CO', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) + '.' : ' Sin listado de casos todavía.');
    $('menu').showModal();
  });
  $('btn-actualizar').addEventListener('click', async () => {
    $('menu').close();
    const r = await actualizarLotes();
    avisar(r === true ? 'Lotes y casos actualizados.' : r);
  });
  $('btn-salir').addEventListener('click', () => {
    if (cola.length) {
      $('menu').close();
      if (ultimoFallo === 'pin') return pedirPinNuevo();
      avisar('Hay ' + cola.length + ' sin enviar. Envíalos antes de salir.'); irA('envios'); return;
    }
    if (!confirm('¿Salir? Para volver a entrar necesitas tu PIN y señal.')) return;
    $('menu').close();
    sesion = null;
    localStorage.removeItem(K.sesion);
    mostrarIngreso();
  });

  async function actualizarLotes() {
    if (!navigator.onLine) return 'Sin señal. Intenta en el campamento.';
    try {
      const r = await pedir(urlPuente() + '?action=captura&pin=' + encodeURIComponent(sesion.pin));
      if (!r.ok) { ultimoFallo = 'pin'; pintarEstado(); return 'Tu PIN ya no sirve. Toca la franja roja para escribir el nuevo.'; }
      Object.assign(sesion, { lider: r.lider, lotes: r.lotes || sesion.lotes, labores: r.labores || sesion.labores, pcSiembraDesde: r.pcSiembraDesde || sesion.pcSiembraDesde || 0,
        estados: r.estados || sesion.estados, tipos: r.tipos || sesion.tipos, actualizado: Date.now() });
      guardar(K.sesion, sesion);
      pintarCabecera();
      fl.lotes = fl.lotes.filter((id) => lotePorId(id));
      if (fl.proyecto && !proyectos().includes(fl.proyecto)) fl.proyecto = '';
      pintarLabor(); pintarDetalle(); pintarNovedad();
      await cargarCasos();
      return true;
    } catch (e) {
      return 'No hubo respuesta. Intenta de nuevo.';
    }
  }

  // ---------- Arranque ----------
  function pintarCabecera() {
    $('lider-nombre').textContent = sesion.lider.nombre;
    $('lider-labor').textContent = esOperario() ? 'Operario · ' + sesion.lider.labor : sesion.lider.labor + (esConsulta() ? ' · solo consulta' : '');
    document.body.classList.toggle('consulta', soloMarca());
    document.body.classList.toggle('operario', esOperario());
    const co = esCoord();
    $('tab-equipo').hidden = !co;
    document.querySelector('.pestanas').classList.toggle('cuatro', co);
  }

  // ---------- Vista del coordinador (pestaña Equipo) ----------
  function esCoord() { return !!(sesion && sesion.lider && /coordinador/i.test(sesion.lider.labor + ' ' + sesion.lider.nombre)); }
  let eqCargado = '';
  function nombreLote(id) { const l = lotePorId(id); return l ? proyectoCorto(l.proyecto) + ' · ' + loteCorto(l.lote) : String(id || 'Sin lote'); }
  function abrirEquipo() {
    if (!$('eq-fecha').value) $('eq-fecha').value = hoy();
    if (!$('eq-proy').options.length) {
      $('eq-proy').innerHTML = proyectos().map((p) => '<option value="' + esc(p) + '">' + esc(proyectoCorto(p)) + '</option>').join('');
      llenarEqLotes();
    }
    if (eqCargado !== $('eq-fecha').value) cargarEquipo();
  }
  function llenarEqLotes() {
    $('eq-lote').innerHTML = lotesDe($('eq-proy').value).map((l) => '<option value="' + esc(l.id) + '">' + esc(loteCorto(l.lote)) + '</option>').join('');
  }
  $('eq-proy').addEventListener('change', llenarEqLotes);
  $('eq-fecha').addEventListener('change', cargarEquipo);
  $('eq-cargar').addEventListener('click', cargarEquipo);
  async function cargarEquipo() {
    const box = $('eq-lista'), f = $('eq-fecha').value;
    eqCargado = f;
    if (!navigator.onLine) { box.innerHTML = '<p class="nota">Sin señal. La vista del equipo necesita conexión.</p>'; $('eq-resumen').textContent = ''; eqCargado = ''; return; }
    box.innerHTML = '<p class="nota">Cargando lo que reportó el equipo…</p>';
    try {
      const r = await pedir(urlPuente() + '?action=coord&pin=' + encodeURIComponent(sesion.pin) + '&fecha=' + encodeURIComponent(f.split('-').reverse().join('/')), null, 90000);
      if (!r || !r.ok) { box.innerHTML = '<p class="form-error">' + esc((r && r.error) || 'No se pudo cargar.') + '</p>'; eqCargado = ''; return; }
      const con = r.lideres.filter((l) => l.items.length).length;
      $('eq-resumen').textContent = r.fecha + ' · ' + con + ' con reporte · ' + r.sinReporte + ' sin reporte' + (r.porRevisar ? ' · ' + r.porRevisar + ' por revisar' : '');
      box.innerHTML = '';
      r.lideres.forEach((l) => {
        const c = el('div', { class: 'eq-card' + (l.items.length ? '' : ' eq-vacio') });
        let h = '<div class="eq-cab"><b>' + esc(l.nombre) + '</b><span>' + esc(l.labor || '') + '</span>' +
          '<span class="eq-n">' + (l.items.length ? l.items.length + (l.items.length === 1 ? ' reporte' : ' reportes') : 'Sin reporte') + '</span></div>';
        if (l.palmas) h += '<p class="eq-palmas">✓ ' + l.palmas + (l.palmas === 1 ? ' palma marcada' : ' palmas marcadas') + ' en la app</p>';
        l.items.forEach((it) => {
          h += '<div class="eq-item"><div><b>' + esc(nombreLote(it.lote)) + '</b>' + (it.revisar ? ' <span class="eq-tag">por revisar</span>' : '') +
            (l.labor !== it.labor ? ' <span class="eq-lab">' + esc(it.labor) + '</span>' : '') + '</div>' +
            '<small>' + [it.estado, it.tramo, it.cantidad !== null && it.cantidad !== undefined ? it.cantidad + ' ' + (CANTIDAD[it.labor] || '').toLowerCase() : '', it.palmas ? '✓ ' + it.palmas + (it.palmas === 1 ? ' palma' : ' palmas') : '']
              .filter((x) => x !== '' && x !== undefined).map(esc).join(' · ') + '</small>' +
            (it.obs ? '<small class="eq-obs">' + esc(it.obs) + '</small>' : '') + '</div>';
        });
        c.innerHTML = h;
        box.appendChild(c);
      });
      if (r.operarios && r.operarios.length) {
        const conM = r.operarios.filter((o) => o.total).length;
        box.appendChild(el('h2', { class: 'envios-titulo' }, 'Operarios: palmas marcadas en la app <small>' + conM + ' de ' + r.operarios.length + ' con marcas</small>'));
        r.operarios.forEach((o) => {
          const c = el('div', { class: 'eq-card eq-op' + (o.total ? '' : ' eq-vacio') });
          const pc = o.lotes.filter((L) => L.labor === 'Control PC').reduce((t, L) => t + L.n, 0);
          let h = '<div class="eq-cab"><b>' + esc(o.nombre) + '</b><span>' + esc(o.labor || '') + '</span><span class="eq-n">' +
            (o.total ? o.total + (o.total === 1 ? ' palma' : ' palmas') : 'Sin marcas') + '</span></div>';
          if (pc) h += '<p class="eq-palmas' + (pc >= (r.metaCirugias || 40) ? '' : ' eq-bajo') + '">Control PC: ' + pc + ' de ' + (r.metaCirugias || 40) + ' cirugías (meta)</p>';
          o.lotes.forEach((L) => {
            h += '<div class="eq-item"><div><b>' + esc(nombreLote(L.lote)) + '</b> <span class="eq-lab">' + esc(L.labor) + '</span>' +
              (L.dobles ? ' <span class="eq-tag">' + L.dobles + ' también marcadas por otro</span>' : '') + '</div><small>' +
              [L.n + (L.n === 1 ? ' palma' : ' palmas'), L.tramo ? 'líneas ' + L.tramo : '', L.nuevas ? L.nuevas + ' fuera de lista' : ''].filter(String).map(esc).join(' · ') + '</small></div>';
          });
          c.innerHTML = h;
          box.appendChild(c);
        });
      }
    } catch (e) { box.innerHTML = '<p class="form-error">No hubo respuesta. Intente de nuevo.</p>'; eqCargado = ''; }
  }
  $('eq-buscar').addEventListener('click', async () => {
    const out = $('eq-palma'), id = $('eq-lote').value, l = $('eq-l').value, p = $('eq-p').value;
    out.hidden = false;
    if (!id || !l || !p) { out.innerHTML = '<p class="form-error">Escriba lote, línea y palma.</p>'; return; }
    if (!navigator.onLine) { out.innerHTML = '<p class="nota">Sin señal.</p>'; return; }
    out.innerHTML = '<p class="nota">Buscando…</p>';
    try {
      const r = await pedir(urlPuente() + '?action=palma&pin=' + encodeURIComponent(sesion.pin) + '&lote=' + encodeURIComponent(id) + '&l=' + l + '&p=' + p, null, 90000);
      if (!r || !r.ok) { out.innerHTML = '<p class="form-error">' + esc((r && r.error) || 'No se pudo buscar.') + '</p>'; return; }
      let h = '<h3>' + esc(nombreLote(id)) + ' · L' + r.linea + ' P' + r.palma + '</h3><p class="eq-estado">' + esc(r.estado) + '</p>';
      h += '<p><b>Censos de PC:</b> ' + (r.censos.length ? r.censos.map((c) => esc(c.fecha) + ' ' + esc(c.estado.toLowerCase())).join(' · ') : 'ninguno') + '</p>';
      h += '<p><b>Cirugías:</b> ' + (r.cirugias.length ? r.cirugias.map(esc).join(' · ') : 'ninguna') + '</p>';
      h += '<p><b>Strategus:</b> ' + (r.strategus ? r.strategus.adultos + ' adultos · ' + (r.strategus.controlada ? 'ya controlada' : 'sin control') : 'no está en el censo de plagas') + '</p>';
      if (r.app.length) h += '<p><b>Marcada en la app:</b> ' + r.app.map((a) => esc(a.fecha) + ' ' + esc(a.labor) + ' (' + esc(a.lider) + ')').join(' · ') + '</p>';
      out.innerHTML = h;
    } catch (e) { out.innerHTML = '<p class="form-error">No hubo respuesta. Intente de nuevo.</p>'; }
  });
  function mostrarIngreso() {
    $('v-app').hidden = true;
    $('v-ingreso').hidden = false;
    pin = ''; pintarPin();
    $('ingreso-volver').hidden = !modoCambioPin;
    $('ingreso-sub').textContent = modoCambioPin
      ? 'Escribe tu PIN nuevo. ' + (cola.length === 1 ? 'Tu registro sin enviar se conserva.' : cola.length ? 'Tus ' + cola.length + ' registros sin enviar se conservan.' : '')
      : 'Escribe tu PIN de 6 números';
    $('ingreso-error').textContent = '';
    $('cfg-url').value = window.PUENTE_URL ? '' : (cfg.url || '');
    $('ingreso-config').hidden = !!window.PUENTE_URL;
  }
  function pedirPinNuevo() {
    modoCambioPin = true;
    mostrarIngreso();
  }
  $('ingreso-volver').addEventListener('click', () => {
    modoCambioPin = false;
    $('v-ingreso').hidden = true;
    $('v-app').hidden = false;
  });

  function iniciarApp() {
    $('v-ingreso').hidden = true;
    $('v-app').hidden = false;
    pintarCabecera();
    pintarLabor();
    pintarNovedad();
    pintarEstado();
    pintarStrat();
    irA('labor');
    enviar();
    pintarSemana();
    if (!casos || Date.now() - casos.hora > 30 * 60 * 1000) cargarCasos();
    // lotes al día una vez por día
    if (Date.now() - (sesion.actualizado || 0) > 12 * 3600 * 1000) actualizarLotes();
  }

  window.addEventListener('online', () => { ultimoFallo = ''; enviar(); if (sesion && (!casos || Date.now() - casos.hora > 3 * 3600 * 1000)) cargarCasos(); });
  window.addEventListener('offline', () => { if (cola.length) { ultimoFallo = 'sin-senal'; pintarEstado(); } });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && sesion) enviar(); });
  setInterval(() => { if (sesion && cola.length) enviar(); }, 60000);

  if (sesion && sesion.pin && sesion.lider) iniciarApp(); else mostrarIngreso();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
