/* Formulario de campo para líderes · Sanidad Vegetal La Sultana
 * Guarda todo en el teléfono y lo envía a la hoja cuando hay señal.
 * Habla con el puente de Apps Script v1.3:
 *   GET  ?action=captura&pin=XXXXXX
 *   POST {pin, items:[{uid, tipo:'registro'|'novedad', ...}]}
 */
(function () {
  'use strict';

  const K = { cfg: 'captura_cfg', sesion: 'captura_sesion', cola: 'captura_cola', enviados: 'captura_enviados', ultimo: 'captura_ultimo' };
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
      sesion = { pin: pin, lider: r.lider, lotes: r.lotes || [], labores: r.labores || [], estados: r.estados || [], tipos: r.tipos || [], actualizado: Date.now() };
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
    return lista.length ? lista : fijas;
  }
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
      b.innerHTML = '<b>' + loteCorto(l.lote) + '</b><small>' + has(l.has) + ' ha</small>' +
        (/guin/i.test(l.material) ? '<span class="marca-g" aria-hidden="true">G</span>' : '');
      c.appendChild(b);
    });
  }

  function pintarDetalle() {
    const d = $('l-detalle');
    const etiqueta = CANTIDAD[$('l-labor').value];
    // conservar lo que ya se escribió
    const previo = {};
    d.querySelectorAll('.detalle-fila').forEach((f) => {
      previo[f.dataset.id] = { tramo: f.querySelector('[name=tramo]').value, cantidad: (f.querySelector('[name=cantidad]') || {}).value };
    });
    d.innerHTML = '';
    d.hidden = fl.lotes.length === 0;
    fl.lotes.forEach((id) => {
      const l = lotePorId(id); if (!l) return;
      const f = el('div', { class: 'detalle-fila' + (etiqueta ? '' : ' sin-cantidad'), 'data-id': id });
      const p = previo[id] || {};
      f.innerHTML =
        '<div class="detalle-lote" title="' + l.id + '">' + loteCorto(l.lote) + '</div>' +
        '<label class="campo"><span>Líneas</span><input name="tramo" type="text" autocomplete="off" placeholder="Ej: 1 a 56"></label>' +
        (etiqueta ? '<label class="campo"><span>' + etiqueta + '</span><input name="cantidad" type="number" inputmode="numeric" min="0" step="1" placeholder="0"></label>' : '');
      f.querySelector('[name=tramo]').value = p.tramo || '';
      if (etiqueta && p.cantidad) f.querySelector('[name=cantidad]').value = p.cantidad;
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
  $('l-labor').addEventListener('change', pintarDetalle);

  $('f-labor').addEventListener('submit', async (ev) => {
    ev.preventDefault();
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
    const nuevos = filas.map((f) => {
      const l = lotePorId(f.dataset.id);
      const cant = etiqueta ? Math.max(0, Math.round(Number(f.querySelector('[name=cantidad]').value))) : '';
      return {
        uid: uid(), tipo: 'registro', fecha: fecha, labor: labor, lote: l.id, estado: fl.estado,
        tramo: f.querySelector('[name=tramo]').value.trim(), cantidad: cant, observaciones: obs,
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
      if (labor === 'Control PC' && !/guin/i.test(l.material)) avisos.push(nom + ' es Híbrido. El control de PC se hace en Guineensis.');
      if (it.estado === 'Terminado' && labor !== 'Control PC') {
        const prev = yaTerminado(labor, it.lote, fecha);
        if (prev) avisos.push(nom + ' ya lo enviaste como Terminado el ' + fechaCorta(prev.fecha) + '.');
      }
      return '<b>' + esc(nom) + '</b><br>' + esc(it.estado) + (etiqueta ? ', ' + it.cantidad + ' ' + etiqueta.toLowerCase() : '') +
        (it.tramo ? ', líneas ' + esc(it.tramo) : '');
    });
    const okConf = await confirmar(labor + ', ' + fechaCorta(fecha), lineasConf, avisos);
    if (!okConf) return;

    cola = cola.concat(nuevos);
    if (!guardar(K.cola, cola)) return;
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
    if (enviando || !sesion || !urlPuente()) return;
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
    irA('envios');
    if (cola.length) enviar(true);
  });

  // ---------- Pestañas y menú ----------
  function irA(nombre) {
    document.querySelectorAll('.panel').forEach((p) => { p.hidden = p.dataset.panel !== nombre; });
    document.querySelectorAll('.pestanas button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.ir === nombre)));
    if (nombre === 'envios') pintarEnvios();
    window.scrollTo(0, 0);
  }
  document.querySelector('.pestanas').addEventListener('click', (ev) => {
    const b = ev.target.closest('button'); if (b) irA(b.dataset.ir);
  });

  $('btn-menu').addEventListener('click', () => {
    const f = new Date(sesion.actualizado);
    $('menu-info').textContent = sesion.lotes.length + ' lotes, actualizados el ' + f.toLocaleDateString('es-CO') + ' a las ' + f.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) + '.';
    $('menu').showModal();
  });
  $('btn-actualizar').addEventListener('click', async () => {
    $('menu').close();
    const r = await actualizarLotes();
    avisar(r === true ? 'Lotes actualizados.' : r);
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
      Object.assign(sesion, { lider: r.lider, lotes: r.lotes || sesion.lotes, labores: r.labores || sesion.labores,
        estados: r.estados || sesion.estados, tipos: r.tipos || sesion.tipos, actualizado: Date.now() });
      guardar(K.sesion, sesion);
      pintarCabecera();
      fl.lotes = fl.lotes.filter((id) => lotePorId(id));
      if (fl.proyecto && !proyectos().includes(fl.proyecto)) fl.proyecto = '';
      pintarLabor(); pintarDetalle(); pintarNovedad();
      return true;
    } catch (e) {
      return 'No hubo respuesta. Intenta de nuevo.';
    }
  }

  // ---------- Arranque ----------
  function pintarCabecera() {
    $('lider-nombre').textContent = sesion.lider.nombre;
    $('lider-labor').textContent = sesion.lider.labor;
  }
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
    irA('labor');
    enviar();
    // lotes al día una vez por día
    if (Date.now() - (sesion.actualizado || 0) > 12 * 3600 * 1000) actualizarLotes();
  }

  window.addEventListener('online', () => { ultimoFallo = ''; enviar(); });
  window.addEventListener('offline', () => { if (cola.length) { ultimoFallo = 'sin-senal'; pintarEstado(); } });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && sesion) enviar(); });
  setInterval(() => { if (sesion && cola.length) enviar(); }, 60000);

  if (sesion && sesion.pin && sesion.lider) iniciarApp(); else mostrarIngreso();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
