/**
 * JDJ San Juan 2026 — dashboard.
 * 
 */
(function (global) {
  'use strict';
  let api, ui, iniciado = false, ocupado = false, pagina = 0, siguiente = null;
  let revision = 0, timer = null, tieneDatos = false;
  const doc = global.document;
  const ids = ['btn-actualizar-dashboard', 'dash-capacidad', 'dash-asignados', 'dash-ingresados',
    'dash-disponibles', 'dash-porcentaje-general', 'dash-barra-general-progreso',
    'dash-espacios-general', 'dash-total-parqueos', 'lista-parqueos-dashboard',
    'dashboard-actualizacion', 'dashboard-avisos', 'lista-solicitudes-salida', 'solicitudes-resumen',
    'btn-solicitudes-anterior', 'btn-solicitudes-siguiente'];
  const el = id => ui.elemento(id);
  const visible = () => ui.pantallaActual() === 'dashboard' && !doc.hidden && Boolean(api.sesionActual());
  function suspender() {
    revision++;
    if (timer !== null) global.clearTimeout(timer);
    timer = null;
  }
  function programar(demora) {
    if (!visible()) return;
    if (timer !== null) global.clearTimeout(timer);
    timer = global.setTimeout(() => { timer = null; actualizar(false); }, demora);
  }
  function iniciar() {
    if (iniciado) return;
    api = global.JDJ_API; ui = global.JDJ_UI;
    if (!api || !ui || !global.JDJ_ENCARGADO) throw new Error('Faltan los módulos del dashboard.');
    ids.forEach(id => el(id));
    el('btn-actualizar-dashboard').addEventListener('click', () => actualizar(true));
    el('btn-solicitudes-anterior').addEventListener('click', () => {
      if (!ocupado && pagina > 0) { pagina = Math.max(0, pagina - 50); actualizar(true); }
    });
    el('btn-solicitudes-siguiente').addEventListener('click', () => {
      if (!ocupado && siguiente !== null) { pagina = siguiente; actualizar(true); }
    });
    global.addEventListener('jdj:pantalla-cambiada', () => {
      suspender(); if (visible()) programar(0);
    });
    global.addEventListener('jdj:sesion-cambiada', () => {
      if (!api.sesionActual()) { suspender(); limpiarPrivados(); }
    });
    global.addEventListener('pagehide', suspender);
    doc.addEventListener('visibilitychange', () => { suspender(); if (visible()) programar(0); });
    iniciado = true;
  }
  function abrir() {
    iniciar();
    if (!api.sesionActual()) { global.JDJ_ENCARGADO.abrir(); return; }
    pagina = 0; ui.mostrar('dashboard');
  }
  function nodo(tag, clase, texto) {
    const n = doc.createElement(tag); n.className = clase || '';
    if (texto !== undefined) n.textContent = String(texto);
    return n;
  }
  function contador(valor) { return Number.isSafeInteger(valor) && valor >= 0; }
  function validarCupos(datos) {
    if (!datos || !Array.isArray(datos.parqueos) || !datos.resumen ||
        !['capacidad', 'asignados', 'ingresados', 'disponibles'].every(k => contador(datos.resumen[k]))) {
      throw new api.Error('RESPUESTA_INVALIDA', 'No se pudieron verificar los totales de parqueos.');
    }
    const sumas = {capacidad: 0, asignados: 0, ingresados: 0, disponibles: 0};
    const codigos = new Set();
    datos.parqueos.forEach(p => {
      if (!p || typeof p.codigo !== 'string' || codigos.has(p.codigo) ||
          !Object.keys(sumas).every(k => contador(p[k])) ||
          p.disponibles !== Math.max(0, p.capacidad - p.asignados - p.ingresados)) {
        throw new api.Error('RESPUESTA_INVALIDA', 'Hay datos de capacidad inconsistentes. Actualiza nuevamente.');
      }
      codigos.add(p.codigo); Object.keys(sumas).forEach(k => { sumas[k] += p[k]; });
    });
    if (!Object.keys(sumas).every(k => sumas[k] === datos.resumen[k])) {
      throw new api.Error('RESPUESTA_INVALIDA', 'Los totales no coinciden con el detalle de parqueos.');
    }
  }
  function tarjeta(p) {
    const ocupados = p.asignados + p.ingresados;
    const porcentaje = p.capacidad > 0 ? Math.round(ocupados / p.capacidad * 100) : 0;
    const estado = p.disponibles === 0 ? 'lleno' : porcentaje >= 85 ? 'precaucion' : 'disponible';
    const a = nodo('article', 'dashboard-parqueo estado-' + estado);
    const superior = nodo('div', 'dashboard-parqueo-superior');
    const titulo = nodo('div', 'dashboard-parqueo-titulo');
    titulo.appendChild(nodo('h3', '', p.nombre));
    titulo.appendChild(nodo('p', '', p.codigo + ' · ' + ui.tipoVehiculo(p.tipoVehiculo)));
    superior.appendChild(titulo);
    superior.appendChild(nodo('strong', 'dashboard-porcentaje', porcentaje + '%'));
    a.appendChild(superior);
    const barra = nodo('div', 'dashboard-barra-parqueo');
    const progreso = nodo('div', 'dashboard-barra-parqueo-progreso');
    progreso.style.width = Math.min(100, porcentaje) + '%';
    barra.setAttribute('aria-hidden', 'true'); barra.appendChild(progreso); a.appendChild(barra);
    a.appendChild(nodo('p', 'dashboard-parqueo-cifras', 'Capacidad: ' + p.capacidad + ' · Reservados: ' + p.asignados +
      ' · Ingresados: ' + p.ingresados + ' · Disponibles: ' + p.disponibles));
    if (ocupados > p.capacidad) a.appendChild(nodo('p', 'dashboard-alerta', 'Ocupación superior a capacidad. Requiere revisión del equipo.'));
    return a;
  }
  function pintarCupos(datos) {
    validarCupos(datos);
    const r = datos.resumen;
    ['capacidad', 'asignados', 'ingresados', 'disponibles'].forEach(k => ui.texto('dash-' + k, r[k]));
    const porcentaje = r.capacidad ? Math.round((r.asignados + r.ingresados) / r.capacidad * 100) : 0;
    ui.texto('dash-porcentaje-general', porcentaje + '%');
    el('dash-barra-general-progreso').style.width = Math.min(100, porcentaje) + '%';
    ui.texto('dash-espacios-general', r.disponibles + ' espacios disponibles');
    ui.texto('dash-total-parqueos', datos.parqueos.length);
    const lista = el('lista-parqueos-dashboard'); lista.replaceChildren();
    datos.parqueos.forEach(p => lista.appendChild(tarjeta(p)));
    if (!datos.parqueos.length) lista.appendChild(nodo('p', '', 'No hay parqueos activos configurados.'));
    ui.texto('dashboard-avisos', Array.isArray(datos.advertencias) ? datos.advertencias.join('\n') : '');
    const fecha = new Date(datos.actualizadoEn);
    ui.texto('dashboard-actualizacion', Number.isFinite(fecha.getTime()) ? 'Datos de las ' +
      new Intl.DateTimeFormat('es-GT', {timeZone: 'America/Guatemala', hour: 'numeric', minute: '2-digit', second: '2-digit'}).format(fecha) : 'Actualizado.');
    tieneDatos = true;
  }
  function pintarSolicitudes(datos) {
    if (!datos || !contador(datos.total) || datos.desde !== pagina || !Array.isArray(datos.solicitudes) || datos.solicitudes.length > 50 ||
        (datos.siguiente !== null && (!contador(datos.siguiente) || datos.siguiente <= pagina))) {
      throw new api.Error('RESPUESTA_INVALIDA', 'No se pudieron verificar las solicitudes de salida.');
    }
    datos.solicitudes.forEach(s => {
      if (!s || !/^JDJ-[A-Z0-9]{6}$/.test(s.codigo)) throw new api.Error('RESPUESTA_INVALIDA', 'Una solicitud tiene un código inválido.');
    });
    siguiente = datos.siguiente;
    const lista = el('lista-solicitudes-salida'); lista.replaceChildren();
    datos.solicitudes.forEach(s => {
      const a = nodo('article', 'solicitud-salida');
      a.appendChild(nodo('strong', '', s.codigo + ' · ' + s.nombre));
      a.appendChild(nodo('p', '', s.nombreParqueo + ' · ' + ui.tipoVehiculo(s.tipoVehiculo)));
      const boton = nodo('button', 'btn-principal', 'Revisar vehículo'); boton.type = 'button';
      boton.addEventListener('click', async () => {
        if (!visible()) return;
        global.JDJ_ENCARGADO.abrir();
        await global.JDJ_ENCARGADO.buscarCodigo(s.codigo);
      });
      a.appendChild(boton); lista.appendChild(a);
    });
    if (!datos.total) lista.appendChild(nodo('p', '', 'No hay solicitudes de salida pendientes.'));
    ui.texto('solicitudes-resumen', datos.total + ' solicitudes pendientes' +
      (datos.total ? ' · Mostrando ' + (pagina + 1) + '–' + (pagina + datos.solicitudes.length) : ''));
    el('btn-solicitudes-anterior').disabled = pagina === 0;
    el('btn-solicitudes-siguiente').disabled = siguiente === null;
  }
  async function actualizar(manual) {
    if (!visible() || ocupado) return;
    ocupado = true; const turno = revision;
    el('btn-actualizar-dashboard').disabled = true;
    try {
      const resultados = await Promise.allSettled([api.dashboard(), api.solicitudesSalida(pagina)]);
      if (turno !== revision || !visible()) return;
      let error = null;
      try {
        if (resultados[0].status === 'rejected') throw resultados[0].reason;
        pintarCupos(resultados[0].value);
      } catch (e) {
        error = e;
        ui.texto('dashboard-actualizacion', tieneDatos ? 'Sin actualización: los últimos datos pueden haber cambiado.' : 'No se pudieron cargar los parqueos.');
      }
      try {
        if (resultados[1].status === 'rejected') throw resultados[1].reason;
        let datos = resultados[1].value;
        // Si se retiraron solicitudes y desapareció la página, volver a la primera.
        if (contador(datos.total) && pagina > 0 && pagina >= datos.total) {
          pagina = 0; datos = await api.solicitudesSalida(0);
          if (turno !== revision || !visible()) return;
        }
        pintarSolicitudes(datos);
      } catch (e) {
        error = error || e;
        ui.texto('solicitudes-resumen', 'No se pudo actualizar la lista. Revisa de nuevo antes de actuar.');
        // Una tarjeta anterior no debe aparentar que sigue pendiente.
        el('lista-solicitudes-salida').replaceChildren(); siguiente = null;
        el('btn-solicitudes-siguiente').disabled = true;
      }
      if (manual && error && visible()) ui.mostrarError(error);
    } finally {
      ocupado = false;
      el('btn-actualizar-dashboard').disabled = false;
      if (visible()) programar(turno !== revision ? 0 : 45000 + Math.random() * 5000);
    }
  }
  function limpiarPrivados() {
    el('lista-solicitudes-salida').replaceChildren(); siguiente = null; pagina = 0;
    ui.texto('solicitudes-resumen', 'Inicia sesión para consultar solicitudes.');
  }
  global.JDJ_DASHBOARD = Object.freeze({iniciar: iniciar, abrir: abrir, suspender: suspender});
})(globalThis);
