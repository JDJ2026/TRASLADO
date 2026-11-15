/**
 * JDJ San Juan 2026 — app.js.
 * 
 */
(function (global) {
  'use strict';
  const SOPORTE_WHATSAPP = '50241151019'; // Mismo número del proyecto original.
  const doc = global.document;
  let iniciado = false, intentoIniciado = false, timerSesion = null;
  const privada = nombre => nombre === 'encargado' || nombre === 'dashboard';


  function limpiarTimerSesion() {
    if (timerSesion !== null) global.clearTimeout(timerSesion);
    timerSesion = null;
  }


  function vigilarSesion() {
    limpiarTimerSesion();
    if (doc.hidden || !privada(global.JDJ_UI.pantallaActual())) return;
    if (!global.JDJ_API.sesionActual()) { global.JDJ_ENCARGADO.abrir(); return; }
    // Solo lectura local: no genera peticiones a Google.
    timerSesion = global.setTimeout(vigilarSesion, 60000);
  }


  function mostrarConexion() {
    const aviso = doc.getElementById('conexion-aviso');
    if (!aviso) return;
    const sinConexion = global.navigator && global.navigator.onLine === false;
    aviso.textContent = sinConexion ? 'Sin conexión detectada. Conserva tu código; los registros y confirmaciones necesitan internet.' : '';
    aviso.hidden = !sinConexion;
    aviso.style.display = sinConexion ? '' : 'none';
  }


  function enlazar(id, trabajo) {
    const boton = global.JDJ_UI.elemento(id);
    boton.addEventListener('click', () => {
      Promise.resolve().then(trabajo).catch(error => global.JDJ_UI.mostrarError(error));
    });
  }


  function iniciar() {
    if (iniciado || intentoIniciado) return;
    intentoIniciado = true;
    const modulos = ['JDJ_API', 'JDJ_UI', 'JDJ_REGISTRO', 'JDJ_ESCANER', 'JDJ_ENCARGADO', 'JDJ_DASHBOARD', 'JDJ_ITINERARIO'];
    if (!modulos.every(nombre => global[nombre])) throw new Error('Faltan módulos de la interfaz JDJ.');
    const ui = global.JDJ_UI;


    // Validar antes de enlazar botones para evitar una interfaz a medio iniciar.
    ['btn-registrar', 'btn-recuperar', 'btn-encargado', 'btn-itinerario', 'btn-ayuda',
      'btn-volver-registro', 'btn-volver-recuperar', 'btn-volver-login', 'btn-volver-inicio',
      'btn-volver-itinerario', 'btn-volver-ayuda', 'btn-inicio-asignacion',
      'btn-dashboard', 'btn-volver-encargado', 'btn-whatsapp-ayuda'].forEach(id => ui.elemento(id));
    ui.iniciar();


    global.JDJ_REGISTRO.iniciar(); global.JDJ_ENCARGADO.iniciar();
    global.JDJ_DASHBOARD.iniciar(); global.JDJ_ITINERARIO.iniciar();
    enlazar('btn-registrar', () => global.JDJ_REGISTRO.abrirRegistro());
    enlazar('btn-recuperar', () => global.JDJ_REGISTRO.abrirRecuperar());
    enlazar('btn-encargado', () => global.JDJ_ENCARGADO.abrir());
    enlazar('btn-itinerario', () => global.JDJ_ITINERARIO.abrir());
    enlazar('btn-ayuda', () => ui.mostrar('ayuda'));


    ['btn-volver-registro', 'btn-volver-recuperar', 'btn-volver-login', 'btn-volver-inicio',
      'btn-volver-itinerario', 'btn-volver-ayuda', 'btn-inicio-asignacion'].forEach(id => enlazar(id, () => ui.mostrar('inicio')));
    enlazar('btn-dashboard', () => global.JDJ_DASHBOARD.abrir());
    enlazar('btn-volver-encargado', () => global.JDJ_ENCARGADO.abrir());


    // Abrir directamente dentro del clic conserva el gesto del usuario.
    ui.elemento('btn-whatsapp-ayuda').addEventListener('click', () => {
      const url = new URL('https://wa.me/' + SOPORTE_WHATSAPP);
      url.searchParams.set('text', 'Hola, necesito ayuda con el sistema de parqueos de JDJ San Juan 2026.');
      global.open(url.toString(), '_blank', 'noopener,noreferrer');
    });


    global.addEventListener('jdj:pantalla-cambiada', vigilarSesion);
    global.addEventListener('jdj:sesion-cambiada', vigilarSesion);
    global.addEventListener('online', mostrarConexion);
    global.addEventListener('offline', mostrarConexion);
    global.addEventListener('pagehide', limpiarTimerSesion);
    global.addEventListener('pageshow', () => { mostrarConexion(); vigilarSesion(); });
    doc.addEventListener('visibilitychange', vigilarSesion);
    iniciado = true;
    ui.mostrar('inicio'); ui.actualizarIconos(); mostrarConexion();
  }


  function iniciarConAviso() {
    try { iniciar(); }
    catch (_) {
      // No presentar excepciones técnicas ni dejar una pantalla de carga infinita.
      const splash = doc.getElementById('splash-jdj');
      if (splash) splash.style.display = 'none';
      const loader = doc.getElementById('loader-global');
      if (loader) { loader.style.display = 'none'; loader.setAttribute('aria-hidden', 'true'); }
      doc.body.classList.remove('loader-activo');
      const aviso = doc.createElement('p');
      aviso.className = 'inicio-error'; aviso.setAttribute('role', 'alert');
      aviso.textContent = 'No se pudo iniciar la página. Recarga e intenta nuevamente. Si continúa, comunícate con el equipo de Traslado.';
      doc.body.insertBefore(aviso, doc.body.firstChild);
    }
  }


  global.JDJ_APP = Object.freeze({iniciar: iniciarConAviso, listo: () => iniciado});
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', iniciarConAviso, {once: true});
  else iniciarConAviso();
})

(globalThis);