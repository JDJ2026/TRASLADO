/**
 * JDJ San Juan 2026 — registro.
 * 
 */

(function (global) {
  'use strict';
  const doc = global.document;
  const PANTALLAS = Object.freeze({
    inicio: 'flex', registro: 'block', recuperar: 'block', asignacion: 'block',
    'login-encargado': 'block', encargado: 'block', dashboard: 'block',
    itinerario: 'block', ayuda: 'block'
  });
  const cargas = new Map();
  const botonesOcupados = new WeakMap();
  const avisos = [];
  let iniciado = false;
  let pantallaActual = null;
  let avisoActual = null;
  let focoAntesDeAvisos = null;
  let focoAntesDeCarga = null;

  function elemento(id, obligatorio) {
    const encontrado = typeof id === 'string' ? doc.getElementById(id) : id;
    if (!encontrado && obligatorio !== false) throw new Error('Falta un elemento de interfaz: ' + String(id));
    return encontrado || null;
  }
  function texto(ref, valor) {
    const nodo = elemento(ref, false);
    if (!nodo) return false;
    nodo.textContent = String(valor == null ? '' : valor);
    return true;
  }
  function limpiar(ref) {
    const nodo = elemento(ref, false);
    if (nodo) nodo.replaceChildren();
  }
  // Retirar el foco ANTES de ocultar o volver inerte su contenedor.
  // Evita que aria-hidden deje un botón enfocado fuera del árbol accesible.
  function retirarFocoDentro(nodo) {
    const actual = doc.activeElement;
    if (nodo && actual && nodo.contains(actual) && typeof actual.blur === 'function') actual.blur();
  }
  function sincronizarFondo() {
    const bloqueado = cargas.size > 0 || Boolean(avisoActual);
    Object.keys(PANTALLAS).forEach(nombre => {
      const nodo = elemento('pantalla-' + nombre, false);
      if (!nodo) return;
      const oculta = nombre !== pantallaActual;
      if (oculta || bloqueado) retirarFocoDentro(nodo);
      nodo.inert = oculta || bloqueado;
      nodo.setAttribute('aria-hidden', String(oculta || bloqueado));
    });
  }
  function enfocar(nodo) {
    if (!nodo || !nodo.isConnected || nodo.closest('[hidden], [inert]') || nodo.disabled) return false;
    try { nodo.focus({preventScroll: true}); } catch (_) { nodo.focus(); }
    return doc.activeElement === nodo;
  }
  function enfocarPantalla() {
    const pantalla = elemento('pantalla-' + pantallaActual, false);
    if (!pantalla || cargas.size || avisoActual) return;
    const destino = pantalla.querySelector('h1, h2') || pantalla;
    if (!destino.hasAttribute('tabindex')) destino.setAttribute('tabindex', '-1');
    enfocar(destino);
  }

  function iniciar() {
    if (iniciado) return;
    if (!doc || !doc.body) throw new Error('Inicializa JDJ_UI después de cargar el HTML.');
    Object.keys(PANTALLAS).forEach(nombre => elemento('pantalla-' + nombre));
    const modal = elemento('modal-notificacion-jdj');
    const aceptar = elemento('btn-cerrar-notificacion-jdj');
    elemento('notificacion-titulo'); elemento('notificacion-mensaje');
    const loader = elemento('loader-global');
    elemento('loader-titulo'); elemento('loader-mensaje');
    let cancelar = elemento('btn-cancelar-notificacion-jdj', false);
    if (!cancelar) {
      cancelar = doc.createElement('button');
      cancelar.id = 'btn-cancelar-notificacion-jdj';
      cancelar.type = 'button';
      cancelar.className = 'notificacion-jdj-boton notificacion-jdj-cancelar';
      cancelar.textContent = 'Cancelar';
      aceptar.parentNode.appendChild(cancelar);
    }
    cancelar.hidden = true;
    aceptar.addEventListener('click', () => cerrarAviso(true));
    cancelar.addEventListener('click', () => cerrarAviso(false));
    modal.addEventListener('click', e => { if (e.target === modal) cerrarAviso(false); });
    doc.addEventListener('keydown', controlarTecladoModal);
    retirarFocoDentro(modal);
    modal.classList.remove('activo'); modal.style.display = 'none'; modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
    loader.classList.remove('activo'); loader.style.display = 'none'; loader.hidden = true;
    loader.setAttribute('aria-hidden', 'true');
    doc.body.classList.remove('loader-activo');
    iniciado = true;
    ocultarSplash();
  }

  function ocultarSplash() {
    const splash = elemento('splash-jdj', false);
    if (!splash) return;
    splash.classList.remove('splash-visible', 'splash-saliendo');
    splash.setAttribute('aria-hidden', 'true');
    splash.hidden = true;
    splash.style.display = 'none';
  }
  function mostrar(nombre, opciones) {
    iniciar();
    if (!Object.prototype.hasOwnProperty.call(PANTALLAS, nombre)) throw new Error('Pantalla desconocida.');
    const anterior = pantallaActual;
    // Una confirmación de otra pantalla no debe ejecutar una acción tardía.
    cancelarAvisos();
    Object.keys(PANTALLAS).forEach(clave => {
      const nodo = elemento('pantalla-' + clave);
      if (clave !== nombre) retirarFocoDentro(nodo);
      nodo.hidden = clave !== nombre;
      nodo.style.display = clave === nombre ? PANTALLAS[clave] : 'none';
    });
    pantallaActual = nombre;
    sincronizarFondo();
    global.scrollTo({top: 0, behavior: 'auto'});
    if (!opciones || opciones.enfocar !== false) enfocarPantalla();
    global.dispatchEvent(new global.CustomEvent('jdj:pantalla-cambiada', {detail: {anterior: anterior, actual: nombre}}));
  }

  function renderizarCarga() {
    const loader = elemento('loader-global');
    const activa = cargas.size > 0;
    if (!activa) retirarFocoDentro(loader);
    loader.hidden = !activa;
    loader.style.display = activa ? 'flex' : 'none';
    loader.classList.toggle('activo', activa);
    loader.setAttribute('aria-hidden', String(!activa));
    doc.body.classList.toggle('loader-activo', activa);
    if (activa) {
      const ultima = Array.from(cargas.values()).pop();
      texto('loader-titulo', ultima.titulo);
      texto('loader-mensaje', ultima.mensaje);
    }
    sincronizarFondo();
  }
  /** Devuelve una función para finalizar ESTA carga, sin ocultar otras cargas. */
  function cargar(titulo, mensaje) {
    iniciar();
    if (!cargas.size) focoAntesDeCarga = doc.activeElement;
    const id = Symbol('carga');
    cargas.set(id, {titulo: titulo || 'Cargando…', mensaje: mensaje || 'Espera un momento.'});
    renderizarCarga();
    let finalizada = false;
    return function finalizar() {
      if (finalizada) return;
      finalizada = true;
      cargas.delete(id);
      renderizarCarga();
      if (!cargas.size && !avisoActual) {
        if (!enfocar(focoAntesDeCarga)) enfocarPantalla();
        focoAntesDeCarga = null;
      }
    };
  }

  function cambiarTextoBoton(ref, valor) {
    const boton = elemento(ref, false);
    if (!boton) return;
    const etiqueta = boton.querySelector('[data-boton-texto], .btn-texto, .control-boton-texto, .control-confirmar-texto, .dashboard-nav-texto') ||
      Array.from(boton.querySelectorAll('span')).find(span => !span.querySelector('svg, img, i') && !span.classList.contains('mini-loader'));
    if (etiqueta) { etiqueta.textContent = String(valor); return; }
    const nodoTexto = Array.from(boton.childNodes).find(nodo => nodo.nodeType === 3 && nodo.textContent.trim());
    if (nodoTexto) nodoTexto.textContent = String(valor);
    else if (!boton.children.length) boton.textContent = String(valor);
  }
  /** Restaura el estado original del botón y cierra la carga incluso ante errores. */
  function conCarga(opciones, trabajo) {
    const o = opciones || {};
    const boton = elemento(o.boton, false);
    if (boton && botonesOcupados.has(boton)) return botonesOcupados.get(boton);
    if (typeof trabajo !== 'function') return Promise.reject(new Error('Falta la operación de interfaz.'));
    const anterior = boton ? {disabled: boton.disabled, busy: boton.getAttribute('aria-busy'),
      cargando: boton.classList.contains('boton-cargando')} : null;
    const finalizar = cargar(o.titulo, o.mensaje);
    if (boton) { boton.disabled = true; boton.classList.add('boton-cargando'); boton.setAttribute('aria-busy', 'true'); }
    const promesa = Promise.resolve().then(trabajo).finally(() => {
      if (boton) {
        boton.disabled = anterior.disabled;
        boton.classList.toggle('boton-cargando', anterior.cargando);
        if (anterior.busy === null) boton.removeAttribute('aria-busy'); else boton.setAttribute('aria-busy', anterior.busy);
        botonesOcupados.delete(boton);
      }
      finalizar();
    });
    if (boton) botonesOcupados.set(boton, promesa);
    return promesa;
  }

  function abrirSiguienteAviso() {
    if (avisoActual || !avisos.length) return;
    avisoActual = avisos.shift();
    const modal = elemento('modal-notificacion-jdj');
    const aceptar = elemento('btn-cerrar-notificacion-jdj');
    const cancelar = elemento('btn-cancelar-notificacion-jdj');
    texto('notificacion-titulo', avisoActual.titulo);
    texto('notificacion-mensaje', avisoActual.mensaje);
    texto(aceptar, avisoActual.aceptar);
    cancelar.hidden = !avisoActual.confirmacion;
    cancelar.style.display = avisoActual.confirmacion ? '' : 'none';
    modal.hidden = false; modal.style.display = 'flex'; modal.classList.add('activo');
    modal.setAttribute('aria-hidden', 'false');
    sincronizarFondo();
    // En una confirmación el foco inicial está en Cancelar.
    enfocar(avisoActual.confirmacion ? cancelar : aceptar);
  }
  function encolarAviso(titulo, mensaje, confirmacion, aceptar) {
    iniciar();
    if (!avisoActual && !avisos.length) focoAntesDeAvisos = doc.activeElement;
    const promesa = new Promise(resolve => avisos.push({titulo: String(titulo), mensaje: String(mensaje),
      confirmacion: confirmacion, aceptar: aceptar || (confirmacion ? 'Confirmar' : 'Entendido'), resolver: resolve}));
    abrirSiguienteAviso();
    return promesa;
  }
  function cerrarAviso(aceptado) {
    if (!avisoActual) return;
    const actual = avisoActual;
    avisoActual = null;
    const modal = elemento('modal-notificacion-jdj');
    retirarFocoDentro(modal);
    modal.classList.remove('activo'); modal.style.display = 'none'; modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
    sincronizarFondo();
    actual.resolver(Boolean(aceptado));
    if (avisos.length) abrirSiguienteAviso();
    else {
      if (!enfocar(focoAntesDeAvisos)) enfocarPantalla();
      focoAntesDeAvisos = null;
    }
  }
  function cancelarAvisos() {
    const pendientes = avisos.splice(0);
    pendientes.forEach(aviso => aviso.resolver(false));
    if (avisoActual) cerrarAviso(false);
  }
  function controlarTecladoModal(e) {
    if (!avisoActual) return;
    if (e.key === 'Escape') { e.preventDefault(); cerrarAviso(false); return; }
    if (e.key !== 'Tab') return;
    const modal = elemento('modal-notificacion-jdj');
    const destinos = Array.from(modal.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'))
      .filter(nodo => !nodo.hidden && nodo.getClientRects().length > 0);
    const primero = destinos[0], ultimo = destinos[destinos.length - 1];
    if (!primero) { e.preventDefault(); return; }
    if (!modal.contains(doc.activeElement) || (e.shiftKey && doc.activeElement === primero) || (!e.shiftKey && doc.activeElement === ultimo)) {
      e.preventDefault(); enfocar(e.shiftKey ? ultimo : primero);
    }
  }

  function tipoVehiculo(valor) {
    const tipos = {bus: 'Bus', microbus: 'Microbús', liviano: 'Vehículo liviano', motocicleta: 'Motocicleta'};
    const clave = String(valor).trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(tipos, clave) ? tipos[clave] : 'Vehículo';
  }
  function estadoTexto(valor) {
    const estados = {ASIGNADO: 'Reservado', INGRESADO: 'Ingresado', VENCIDO: 'Vencido', RETIRADO: 'Retirado'};
    return Object.prototype.hasOwnProperty.call(estados, valor) ? estados[valor] : 'Por verificar';
  }
  function mensajeError(error) {
    if (!error || error.name !== 'JDJError') return 'Ocurrió un problema. Intenta nuevamente; si persiste, contacta a soporte.';
    return String(error.message || 'No se pudo completar la operación.') +
      (error.referencia ? '\nReferencia: ' + String(error.referencia).slice(0, 120) : '');
  }
  function actualizarIconos() {
    if (global.lucide && typeof global.lucide.createIcons === 'function') {
      try { global.lucide.createIcons(); return true; } catch (_) { /* etiquetas de texto siguen disponibles */ }
    }
    return false;
  }

  global.JDJ_UI = Object.freeze({
    iniciar: iniciar, elemento: elemento, texto: texto, limpiar: limpiar,
    mostrar: mostrar, pantallaActual: () => pantallaActual,
    cargar: cargar, conCarga: conCarga, cambiarTextoBoton: cambiarTextoBoton,
    avisar: (titulo, mensaje) => encolarAviso(titulo, mensaje, false),
    confirmar: (titulo, mensaje, aceptar) => encolarAviso(titulo, mensaje, true, aceptar),
    mostrarError: error => encolarAviso('No pudimos completar la operación', mensajeError(error), false),
    cancelarAvisos: cancelarAvisos, tipoVehiculo: tipoVehiculo,
    estadoTexto: estadoTexto, mensajeError: mensajeError, actualizarIconos: actualizarIconos
  });
})(globalThis);