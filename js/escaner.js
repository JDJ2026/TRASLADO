/**
 * JDJ San Juan 2026 — escaner.
 * 
 */
(function (global) {
  'use strict';
  let lector = null, abierto = false, generacion = 0;
  let cola = Promise.resolve();
  function serializar(trabajo) {
    const resultado = cola.then(trabajo);
    cola = resultado.catch(() => {});
    return resultado;
  }
  async function cerrar() {
    if (!lector) return;
    // Si stop falla no descartar la referencia: permitir reintentar la limpieza.
    if (abierto) { await lector.stop(); abierto = false; }
    lector.clear();
    lector = null;
    const nodo = global.document.getElementById('lector-qr');
    if (nodo) { nodo.hidden = true; nodo.style.display = 'none'; }
  }
  function detener() {
    generacion++;
    return serializar(cerrar);
  }
  function iniciar(opciones) {
    const o = opciones || {};
    const turno = ++generacion;
    if (typeof o.alDetectar !== 'function' || typeof o.permitido !== 'function') {
      return Promise.reject(new Error('Faltan las funciones de control del escáner.'));
    }
    return serializar(async () => {
      await cerrar();
      if (turno !== generacion || !o.permitido()) return false;
      if (typeof global.Html5Qrcode !== 'function') throw new Error('El escáner no está disponible. Ingresa el código manualmente.');
      const nodo = global.document.getElementById('lector-qr');
      if (!nodo) throw new Error('Falta el contenedor del escáner.');
      nodo.hidden = false; nodo.style.display = 'block';
      lector = new global.Html5Qrcode('lector-qr');
      let detectado = false;
      try {
        await lector.start({facingMode: 'environment'}, {fps: 8, qrbox: {width: 220, height: 220}}, texto => {
          if (detectado || turno !== generacion || !o.permitido()) return;
          const codigo = String(texto).trim().toUpperCase();
          if (!/^JDJ-[A-Z0-9]{6}$/.test(codigo)) return;
          detectado = true;
          // Serializar el cierre también si la detección ocurre durante start.
          serializar(async () => {
            await cerrar();
            if (turno === generacion && o.permitido()) await o.alDetectar(codigo);
          }).catch(() => {
            if (typeof o.alError === 'function') o.alError('No se pudo completar la lectura. Usa el código manual.');
          });
        }, () => { /* Un cuadro sin QR no constituye un error de cámara. */ });
        abierto = true;
        if (turno !== generacion || !o.permitido()) { await cerrar(); return false; }
        return true;
      } catch (error) {
        if (!abierto && lector) {
          try { lector.clear(); lector = null; } catch (_) { /* conservar para otro cierre */ }
        }
        nodo.hidden = true; nodo.style.display = 'none';
        throw new Error('No fue posible abrir o detener la cámara. Revisa sus permisos o usa el código manual.');
      }
    });
  }
  function detenerAlSalir() {
    detener().catch(() => { /* El panel informará si un nuevo intento tampoco puede cerrar la cámara. */ });
  }
  global.addEventListener('pagehide', detenerAlSalir);
  global.document.addEventListener('visibilitychange', () => { if (global.document.hidden) detenerAlSalir(); });
  global.addEventListener('jdj:pantalla-cambiada', e => {
    if (!e.detail || e.detail.actual !== 'encargado') detenerAlSalir();
  });
  global.JDJ_ESCANER = Object.freeze({iniciar: iniciar, detener: detener, activo: () => abierto});
})(globalThis);