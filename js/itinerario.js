/**
 * Guardar como js/itinerario.js. Requiere api.js, ui.js y el HTML nuevo.
 * Las actividades vienen de Sheets: no se incluyen actividades inventadas.
 * Sábado y domingo tienen pestañas propias. Si Sheets incluye otras fechas,
 * se muestran como pestañas adicionales para no ocultar información.
 * No inicia al cargar; no consulta en segundo plano ni cada pocos segundos.
 */
(function (global) {
  'use strict';
  const OFICIALES = ['2026-11-21', '2026-11-22'];
  const colores = ['azul', 'verde', 'amarillo', 'rojo', 'naranja'];
  const doc = global.document;
  let api, ui, iniciado = false, cargando = false, actividades = null;
  let seleccionada = OFICIALES[0], fechas = OFICIALES.slice(), botones = [];
  let ultimaCarga = 0, actualizadoEn = null;
  const el = id => ui.elemento(id);
  const visible = () => ui.pantallaActual() === 'itinerario';
  function nodo(tag, clase, texto) {
    const n = doc.createElement(tag); n.className = clase || '';
    if (texto !== undefined) n.textContent = String(texto);
    return n;
  }
  function fechaValida(fecha) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return false;
    const d = new Date(fecha + 'T00:00:00Z');
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === fecha;
  }
  function fechaLocal(fecha) { return new Date(fecha + 'T12:00:00-06:00'); }
  function horaTexto(hora) {
    const [h, m] = hora.split(':').map(Number);
    return (h % 12 || 12) + ':' + String(m).padStart(2, '0') + (h < 12 ? ' a. m.' : ' p. m.');
  }
  function normalizar(datos) {
    if (!datos || !Array.isArray(datos.actividades)) throw new api.Error('RESPUESTA_INVALIDA', 'No se pudo verificar la agenda.');
    return datos.actividades.map((a, indice) => {
      if (!a || !fechaValida(a.fecha) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(a.hora) ||
          typeof a.actividad !== 'string' || !a.actividad.trim() ||
          (a.horaFin && (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(a.horaFin) || a.horaFin < a.hora))) {
        throw new api.Error('RESPUESTA_INVALIDA', 'Hay una actividad con fecha u horario no válido. Intenta actualizar la agenda.');
      }
      return {fecha: a.fecha, hora: a.hora, horaFin: a.horaFin || '', actividad: a.actividad,
        lugar: String(a.lugar || ''), descripcion: String(a.descripcion || ''), orden: indice};
    }).sort((a, b) => a.fecha.localeCompare(b.fecha) || a.hora.localeCompare(b.hora) || a.orden - b.orden);
  }
  function iniciar() {
    if (iniciado) return;
    api = global.JDJ_API; ui = global.JDJ_UI;
    if (!api || !ui) throw new Error('Carga api.js y ui.js antes del itinerario.');
    ['itinerario-pestanas', 'lista-itinerario', 'itinerario-dia', 'itinerario-mes',
      'itinerario-dia-semana', 'itinerario-total', 'itinerario-actualizacion', 'btn-actualizar-itinerario'].forEach(id => el(id));
    el('btn-actualizar-itinerario').addEventListener('click', () => actualizar(true));
    const lista = el('lista-itinerario'); lista.setAttribute('role', 'tabpanel');
    el('itinerario-pestanas').setAttribute('role', 'tablist');
    el('itinerario-pestanas').setAttribute('aria-label', 'Días de la jornada');
    try {
      const cache = JSON.parse(global.sessionStorage.getItem('jdj:agenda-publica:v2') || 'null');
      if (cache && Date.now() >= cache.guardado && Date.now() - cache.guardado < 60000) {
        actividades = normalizar(cache.datos); ultimaCarga = cache.guardado; actualizadoEn = cache.datos.actualizadoEn;
      }
    } catch (_) { /* Continuar sin caché local. */ }
    iniciado = true;
  }
  function abrir() {
    iniciar(); ui.mostrar('itinerario');
    if (actividades !== null) { pintar(); mostrarActualizacion(); }
    if (actividades === null || Date.now() - ultimaCarga >= 60000) actualizar(false);
  }
  function pintar() {
    fechas = Array.from(new Set(OFICIALES.concat(actividades.map(a => a.fecha)))).sort();
    if (!fechas.includes(seleccionada)) seleccionada = OFICIALES[0];
    const grupo = el('itinerario-pestanas'); grupo.replaceChildren(); botones = [];
    fechas.forEach((fecha, indice) => {
      const formato = OFICIALES.includes(fecha) ? {weekday: 'long', day: 'numeric'} : {day: 'numeric', month: 'short'};
      const etiqueta = new Intl.DateTimeFormat('es-GT', Object.assign({timeZone: 'America/Guatemala'}, formato)).format(fechaLocal(fecha));
      const b = nodo('button', 'itinerario-pestana', etiqueta); b.type = 'button';
      b.id = 'agenda-dia-' + fecha;
      b.setAttribute('role', 'tab'); b.setAttribute('aria-controls', 'lista-itinerario');
      b.addEventListener('click', () => elegir(fecha));
      b.addEventListener('keydown', e => {
        let destino;
        if (e.key === 'ArrowRight') destino = (indice + 1) % fechas.length;
        else if (e.key === 'ArrowLeft') destino = (indice - 1 + fechas.length) % fechas.length;
        else if (e.key === 'Home') destino = 0;
        else if (e.key === 'End') destino = fechas.length - 1;
        else return;
        e.preventDefault(); elegir(fechas[destino]); botones[destino].focus();
      });
      botones.push(b); grupo.appendChild(b);
    });
    pintarDia();
  }
  function elegir(fecha) { seleccionada = fecha; pintarDia(); }
  function pintarDia() {
    botones.forEach((b, i) => {
      const activo = fechas[i] === seleccionada;
      b.setAttribute('aria-selected', String(activo)); b.setAttribute('tabindex', activo ? '0' : '-1');
      b.classList.toggle('activo', activo);
    });
    const dia = fechaLocal(seleccionada);
    ui.texto('itinerario-dia', seleccionada.slice(-2));
    ui.texto('itinerario-mes', new Intl.DateTimeFormat('es-GT', {timeZone: 'America/Guatemala', month: 'short'}).format(dia).toUpperCase());
    ui.texto('itinerario-dia-semana', new Intl.DateTimeFormat('es-GT', {timeZone: 'America/Guatemala', weekday: 'long'}).format(dia));
    const delDia = actividades.filter(a => a.fecha === seleccionada);
    ui.texto('itinerario-total', delDia.length);
    const lista = el('lista-itinerario'); lista.replaceChildren();
    lista.setAttribute('aria-labelledby', 'agenda-dia-' + seleccionada);
    delDia.forEach((a, i) => {
      const tarjeta = nodo('article', 'itinerario-actividad itinerario-actividad-' + colores[i % colores.length]);
      const horario = nodo('div', 'itinerario-hora');
      horario.appendChild(nodo('span', '', horaTexto(a.hora) + (a.horaFin ? ' – ' + horaTexto(a.horaFin) : '')));
      tarjeta.appendChild(horario);
      const contenido = nodo('div', 'itinerario-actividad-contenido');
      contenido.appendChild(nodo('h3', '', a.actividad));
      contenido.appendChild(nodo('p', 'itinerario-lugar', a.lugar || 'Lugar por confirmar'));
      if (a.descripcion) contenido.appendChild(nodo('p', 'itinerario-descripcion', a.descripcion));
      tarjeta.appendChild(contenido); lista.appendChild(tarjeta);
    });
    if (!delDia.length) lista.appendChild(nodo('p', 'itinerario-vacio', 'Todavía no hay actividades publicadas para este día.'));
  }
  function mostrarActualizacion() {
    const fecha = new Date(actualizadoEn);
    ui.texto('itinerario-actualizacion', Number.isFinite(fecha.getTime()) ? 'Agenda consultada a las ' +
      new Intl.DateTimeFormat('es-GT', {timeZone: 'America/Guatemala', hour: 'numeric', minute: '2-digit'}).format(fecha) : 'Agenda consultada.');
  }
  async function actualizar(manual) {
    if (cargando || !visible()) return;
    cargando = true; el('btn-actualizar-itinerario').disabled = true;
    el('btn-actualizar-itinerario').setAttribute('aria-busy', 'true');
    el('lista-itinerario').setAttribute('aria-busy', 'true');
    const finCarga = actividades === null ? ui.cargar('Cargando itinerario', 'Estamos consultando la agenda de la jornada.') : null;
    ui.texto('itinerario-actualizacion', 'Consultando la agenda…');
    try {
      const datos = await api.itinerario();
      const nuevas = normalizar(datos);
      if (actividades === null) {
        const partes = new Intl.DateTimeFormat('es-GT', {timeZone: 'America/Guatemala', year: 'numeric', month: '2-digit', day: '2-digit'})
          .formatToParts(new Date(datos.servidorAhora || Date.now()));
        const valor = tipo => partes.find(p => p.type === tipo).value;
        const hoy = valor('year') + '-' + valor('month') + '-' + valor('day');
        if (OFICIALES.includes(hoy)) seleccionada = hoy;
      }
      actividades = nuevas; ultimaCarga = Date.now(); actualizadoEn = datos.actualizadoEn;
      try { global.sessionStorage.setItem('jdj:agenda-publica:v2', JSON.stringify({guardado: ultimaCarga, datos: datos})); } catch (_) { /* memoria */ }
      if (!visible()) return;
      pintar();
      mostrarActualizacion();
    } catch (error) {
      if (!visible()) return;
      ui.texto('itinerario-actualizacion', actividades === null ? 'No se pudo cargar la agenda. Pulsa Actualizar para reintentar.' :
        'No se pudo actualizar. Se conserva la última agenda consultada.');
      if (manual) ui.mostrarError(error);
    } finally {
      cargando = false; el('btn-actualizar-itinerario').disabled = false;
      el('btn-actualizar-itinerario').removeAttribute('aria-busy'); el('lista-itinerario').removeAttribute('aria-busy');
      if (finCarga) finCarga();
    }
  }
  global.JDJ_ITINERARIO = Object.freeze({iniciar: iniciar, abrir: abrir});
})(globalThis);
