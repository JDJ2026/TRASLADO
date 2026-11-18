/**
 * JDJ San Juan 2026 — api.
 * 
 */
(function (global) {
  'use strict';

  // Conserva esta URL si actualizas la implementación existente de Apps Script.
  const URL_API = 'https://script.google.com/macros/s/AKfycbxjC8nPNznRr0WmeSye3vdOnE-SPUju2KAwb8o673ujyED7TPCDQ2pbSpEJyrYhF4KYbQ/exec';
  const TIEMPO_LECTURA_MS = 30000;
  const TIEMPO_ESCRITURA_MS = 60000;
  const lecturasEnCurso = new Map();
  const PREFIJO = 'jdj:v2:' + URL_API.split('/').slice(-2, -1)[0] + ':';
  const memoria = Object.create(null);
  let conexionPendiente = null;
  let versionComprobada = false;
  let registroEnCurso = null;
  let loginEnCurso = false;
  let generacionSesion = 0;
  let sesion = leer('sesion');

  class JDJError extends Error {
    constructor(codigo, mensaje, opciones) {
      super(mensaje);
      this.name = 'JDJError';
      this.codigo = codigo;
      Object.assign(this, opciones || {});
    }
  }

  function leer(clave) {
    let texto = null;
    if (Object.prototype.hasOwnProperty.call(memoria, clave)) texto = memoria[clave];
    else {
      try { texto = global.sessionStorage.getItem(PREFIJO + clave); } catch (_) { /* memoria */ }
    }
    try { return texto ? JSON.parse(texto) : null; } catch (_) { return null; }
  }
  function guardar(clave, valor) {
    const texto = JSON.stringify(valor);
    memoria[clave] = texto;
    try { global.sessionStorage.setItem(PREFIJO + clave, texto); } catch (_) { /* memoria */ }
  }
  function borrar(clave) {
    // La marca nula evita releer un valor viejo si removeItem falla.
    memoria[clave] = null;
    try { global.sessionStorage.removeItem(PREFIJO + clave); } catch (_) { /* memoria */ }
  }
  function notificarSesion() {
    if (typeof global.dispatchEvent === 'function' && typeof global.CustomEvent === 'function') {
      global.dispatchEvent(new global.CustomEvent('jdj:sesion-cambiada'));
    }
  }
  function limpiarSesion() {
    const habiaSesion = Boolean(sesion);
    sesion = null;
    borrar('sesion');
    if (habiaSesion) notificarSesion();
  }
  function sesionVigente() {
    if (!sesion || typeof sesion.token !== 'string' || !/^[a-f0-9]{64}$/.test(sesion.token) ||
        typeof sesion.usuario !== 'string' || typeof sesion.nombre !== 'string' ||
        !Number.isFinite(sesion.limiteLocal) || Date.now() >= sesion.limiteLocal) {
      limpiarSesion();
      return null;
    }
    return sesion;
  }
  function sesionActual() {
    const actual = sesionVigente();
    return actual ? {usuario: actual.usuario, nombre: actual.nombre, venceEn: actual.venceEn} : null;
  }

  function uuid() {
    const crypto = global.crypto;
    if (crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    if (!crypto || typeof crypto.getRandomValues !== 'function') {
      throw new JDJError('NAVEGADOR_NO_COMPATIBLE', 'Abre la página en un navegador actualizado para registrarte.');
    }
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' +
      hex.slice(16, 20) + '-' + hex.slice(20);
  }
  function texto(valor, campo, maximo) {
    if (typeof valor !== 'string' || valor.length > maximo || !valor.trim()) {
      throw new JDJError('DATOS_INVALIDOS', 'Revisa el campo ' + campo + '.');
    }
    return valor.normalize('NFC').trim();
  }
  function telefono(valor) {
    let numero = texto(valor, 'celular', 32).replace(/[ ()-]/g, '');
    if (/^\+?502\d{8}$/.test(numero)) numero = numero.replace(/^\+?502/, '');
    if (!/^\d{8}$/.test(numero)) throw new JDJError('DATOS_INVALIDOS', 'Ingresa un celular de ocho dígitos.');
    return numero;
  }
  function codigo(valor) {
    const normalizado = texto(valor, 'código', 32).toUpperCase();
    if (!/^JDJ-[A-Z0-9]{6}$/.test(normalizado)) {
      throw new JDJError('DATOS_INVALIDOS', 'El código debe tener el formato JDJ-ABC123.');
    }
    return normalizado;
  }
  function normalizarRegistro(datos) {
    if (!datos || typeof datos !== 'object') throw new JDJError('DATOS_INVALIDOS', 'Completa los datos del registro.');
    const nombre = texto(datos.nombre, 'nombre', 120).replace(/\s+/g, ' ');
    const tipo = texto(datos.tipo, 'vehículo', 24).toLowerCase();
    const fechaSalida = texto(datos.fechaSalida, 'día de salida', 10);
    if (nombre.length < 2 || /^[=+@\-]/.test(nombre) || /[<>\u0000-\u001f\u007f-\u009f]/.test(nombre)) {
      throw new JDJError('DATOS_INVALIDOS', 'Ingresa un nombre válido.');
    }
    if (!['bus', 'microbus', 'liviano', 'motocicleta'].includes(tipo)) {
      throw new JDJError('DATOS_INVALIDOS', 'Selecciona un tipo de vehículo válido.');
    }
    if (!['2026-11-21', '2026-11-22'].includes(fechaSalida)) {
      throw new JDJError('DATOS_INVALIDOS', 'Selecciona salida el sábado 21 o el domingo 22.');
    }
    return {nombre: nombre, telefono: telefono(datos.telefono), tipo: tipo, fechaSalida: fechaSalida};
  }

  const esperar = ms => new Promise(resolve => global.setTimeout(resolve, ms));

  /** Dos intentos como máximo. Solo acciones expresamente indicadas admiten reintento. */
  async function transportar(accion, datos, opciones) {
    const o = opciones || {};
    const maximo = o.reintentar ? 2 : 1;
    for (let intento = 0; intento < maximo; intento++) {
      let controlador;
      let temporizador;
      let envioIntentado = false;
      try {
        if (typeof global.fetch !== 'function' || typeof global.AbortController !== 'function') {
          throw new JDJError('NAVEGADOR_NO_COMPATIBLE', 'Usa un navegador actualizado para abrir la página.');
        }
        controlador = new global.AbortController();
        temporizador = global.setTimeout(() => controlador.abort(), o.escritura ? TIEMPO_ESCRITURA_MS : TIEMPO_LECTURA_MS);
        const config = {method: o.get ? 'GET' : 'POST', signal: controlador.signal,
          redirect: 'follow', credentials: 'omit', cache: 'no-store'};
        let url = URL_API;
        if (o.get) {
          const parametros = new URLSearchParams(Object.assign({accion: accion}, datos || {}));
          url += '?' + parametros.toString();
        } else {
          config.headers = {'Content-Type': 'text/plain;charset=utf-8'};
          config.body = JSON.stringify(Object.assign({accion: accion}, datos || {}));
        }
        envioIntentado = true;
        const respuesta = await global.fetch(url, config);
        if (!respuesta.ok) {
          throw new JDJError('ERROR_HTTP', 'No se pudo acceder al servidor. Intenta nuevamente.',
            {reintentable: respuesta.status === 429 || respuesta.status >= 500,
              resultadoDesconocido: Boolean(o.escritura)});
        }
        let resultado;
        try { resultado = await respuesta.json(); }
        catch (error) {
          if (error.name === 'AbortError') throw error;
          throw new JDJError('RESPUESTA_INVALIDA', 'El servidor no devolvió una respuesta válida.',
            {reintentable: true, resultadoDesconocido: Boolean(o.escritura)});
        }
        if (!resultado || resultado.apiVersion !== 2 || typeof resultado.exito !== 'boolean') {
          versionComprobada = false;
          throw new JDJError('VERSION_INCOMPATIBLE', 'La página necesita la API v2. Todavía falta actualizar la implementación de Apps Script.',
            {resultadoDesconocido: Boolean(o.escritura)});
        }
        if (!resultado.exito) {
          if (resultado.codigoError === 'SESION_INVALIDA' && o.tokenUsado && sesion && sesion.token === o.tokenUsado) limpiarSesion();
          throw new JDJError(resultado.codigoError || 'OPERACION_RECHAZADA',
            resultado.mensaje || 'No se pudo completar la operación.', {
              referencia: resultado.referencia || null,
              reintentable: resultado.reintentable === true,
              reintentarEnMs: Math.min(5000, Math.max(500, Number(resultado.reintentarEnMs) || 1000)),
              resultadoDesconocido: Boolean(o.escritura && resultado.codigoError === 'ERROR_INTERNO')
            });
        }
        return resultado;
      } catch (original) {
        const error = original instanceof JDJError ? original : new JDJError(
          original && original.name === 'AbortError' ? 'TIEMPO_AGOTADO' : 'ERROR_RED',
          original && original.name === 'AbortError'
            ? (o.escritura ? 'La respuesta no llegó a tiempo. Estamos verificando si el cambio se guardó.' : 'La consulta está tardando. Revisa tu conexión e intenta nuevamente.')
            : 'No pudimos conectar. Revisa tu conexión e intenta nuevamente.',
          {reintentable: true, resultadoDesconocido: Boolean(o.escritura && envioIntentado)}
        );
        // Desarmar el timeout ANTES de esperar el reintento.
        if (temporizador !== undefined) global.clearTimeout(temporizador);
        if (error.reintentable && intento + 1 < maximo && (!o.escritura || !error.resultadoDesconocido)) {
          await esperar((error.reintentarEnMs || 800) + Math.floor(Math.random() * 300));
          continue;
        }
        throw error;
      } finally {
        if (temporizador !== undefined) global.clearTimeout(temporizador);
      }
    }
  }

  async function comprobarVersion() {
    if (versionComprobada) return {exito: true, apiVersion: 2};
    if (!conexionPendiente) {
      conexionPendiente = transportar('probar', {}, {get: true, reintentar: true})
        .then(resultado => { versionComprobada = true; return resultado; })
        .finally(() => { conexionPendiente = null; });
    }
    return conexionPendiente;
  }
  async function publico(accion, datos, get, escritura) {
    // El sondeo de estado ya tiene su propio intervalo/backoff: no duplicarlo aquí.
    const opciones = {get: Boolean(get), reintentar: !escritura && accion !== 'estado', escritura: Boolean(escritura)};
    if (escritura) return transportar(accion, datos, opciones);
    const clave = accion + ':' + JSON.stringify(datos || {});
    if (lecturasEnCurso.has(clave)) return lecturasEnCurso.get(clave);
    const pendiente = transportar(accion, datos, opciones).finally(() => lecturasEnCurso.delete(clave));
    lecturasEnCurso.set(clave, pendiente);
    return pendiente;
  }
  async function protegido(accion, datos, escritura) {
    const actual = sesionVigente();
    if (!actual) throw new JDJError('SESION_INVALIDA', 'Inicia sesión como encargado.');
    const token = actual.token;
    try {
      return await transportar(accion, Object.assign({}, datos, {token: token}), {
        escritura: Boolean(escritura), reintentar: true, tokenUsado: token
      });
    } catch (error) {
      if (!escritura || !error.resultadoDesconocido) throw error;
      // No volver a escribir a ciegas: buscar el mismo código y comprobar el resultado.
      try {
        const verificado = await transportar('buscar', {codigo: datos.codigo, token: token}, {tokenUsado: token});
        const esperado = accion === 'confirmar' ? 'INGRESADO' : 'RETIRADO';
        if (verificado.encontrado && verificado.codigo === datos.codigo && verificado.estado === esperado) {
          return Object.assign({}, verificado, {respuestaRecuperada: true});
        }
      } catch (_) { /* no inferir que una escritura falló si no se puede verificar */ }
      throw new JDJError('OPERACION_PENDIENTE',
        'No recibimos la confirmación del servidor. El cambio podría estar guardado. Busca de nuevo este código antes de repetir la acción.',
        {resultadoDesconocido: true});
    }
  }

  async function iniciarSesion(usuario, pin) {
    if (loginEnCurso) throw new JDJError('OPERACION_EN_CURSO', 'Estamos verificando tu acceso.');
    const datos = {usuario: texto(usuario, 'usuario', 64).toLowerCase(), pin: texto(pin, 'PIN', 128)};
    loginEnCurso = true;
    const generacion = ++generacionSesion;
    try {
      // No reintentar login automáticamente: evitar consumir intentos por errores de credenciales.
      const resultado = await transportar('login', datos, {});
      if (generacion !== generacionSesion) throw new JDJError('ACCESO_CANCELADO', 'El acceso fue cancelado.');
      const restante = Date.parse(resultado.venceEn) - Date.parse(resultado.servidorAhora);
      if (!/^[a-f0-9]{64}$/.test(resultado.token || '') || !Number.isFinite(restante) || restante <= 0 ||
          typeof resultado.usuario !== 'string' || typeof resultado.nombre !== 'string') {
        throw new JDJError('RESPUESTA_INVALIDA', 'No se pudo validar la sesión del encargado.');
      }
      sesion = {token: resultado.token, usuario: resultado.usuario, nombre: resultado.nombre,
        venceEn: resultado.venceEn, limiteLocal: Date.now() + Math.min(restante, 21600000)};
      guardar('sesion', sesion);
      notificarSesion();
      return {exito: true, usuario: sesion.usuario, nombre: sesion.nombre, venceEn: sesion.venceEn};
    } finally { loginEnCurso = false; }
  }
  async function cerrarSesion() {
    generacionSesion++;
    const anterior = sesionVigente();
    limpiarSesion();
    if (!anterior) return {exito: true, servidorConfirmado: true};
    try {
      await transportar('logout', {token: anterior.token}, {});
      return {exito: true, servidorConfirmado: true};
    } catch (_) {
      // Cerrar localmente aunque no haya red; el token remoto vencerá en el servidor.
      return {exito: true, servidorConfirmado: false};
    }
  }

  async function registrarInterno(datos, clave) {
    let solicitud = leer('solicitud');
    const idValido = solicitud && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(solicitud.id || '');
    if (idValido && solicitud.clave !== clave && solicitud.estado === 'pendiente') {
      throw new JDJError('SOLICITUD_PENDIENTE', 'Primero recupera tu comprobante con el celular anterior para saber si la reserva se guardó.');
    }
    if (!idValido || solicitud.clave !== clave) solicitud = {id: uuid(), clave: clave, estado: 'pendiente'};
    guardar('solicitud', solicitud);
    try {
      const resultado = await transportar('registrar', Object.assign({}, datos, {solicitudId: solicitud.id}),
        {escritura: true, reintentar: true});
      solicitud.estado = 'confirmada';
      solicitud.incierta = false;
      guardar('solicitud', solicitud);
      return resultado;
    } catch (error) {
      if (error.resultadoDesconocido || solicitud.incierta) {
        solicitud.incierta = true;
        try {
          const verificado = await transportar('verificarReserva', {solicitudId: solicitud.id, telefono: datos.telefono}, {});
          if (verificado.encontrado && verificado.codigo) {
            solicitud.estado = 'confirmada'; solicitud.incierta = false; guardar('solicitud', solicitud);
            return Object.assign({}, verificado, {respuestaRecuperada: true});
          }
        } catch (_) { /* conservar la solicitud para un reintento con el MISMO ID */ }
        guardar('solicitud', solicitud);
        throw new JDJError('OPERACION_PENDIENTE',
          'No hemos podido confirmar la respuesta. Tu solicitud se conserva y podría haberse guardado. Recupera el comprobante con este mismo celular; no uses otro número.',
          {resultadoDesconocido: true});
      }
      solicitud.estado = 'rechazada'; guardar('solicitud', solicitud);
      if (error.codigo === 'TELEFONO_ACTIVO') {
        try {
          const existente = await recuperar(datos.telefono);
          if (['ASIGNADO', 'INGRESADO'].includes(existente.estado)) {
            return Object.assign({}, existente, {registroExistente: true});
          }
        } catch (_) { /* mostrar el rechazo original si no se puede recuperar */ }
      }
      throw error;
    }
  }
  function registrar(entrada) {
    let datos;
    try { datos = normalizarRegistro(entrada); } catch (error) { return Promise.reject(error); }
    const clave = JSON.stringify(datos);
    if (registroEnCurso) {
      return registroEnCurso.clave === clave ? registroEnCurso.promesa : Promise.reject(
        new JDJError('OPERACION_EN_CURSO', 'Espera a que termine el registro actual.')
      );
    }
    const promesa = registrarInterno(datos, clave).finally(() => {
      if (registroEnCurso && registroEnCurso.promesa === promesa) registroEnCurso = null;
    });
    registroEnCurso = {clave: clave, promesa: promesa};
    return promesa;
  }
  function nuevaSolicitud() {
    if (registroEnCurso) throw new JDJError('OPERACION_EN_CURSO', 'Espera a que termine el registro actual.');
    const anterior = leer('solicitud');
    if (anterior && anterior.estado === 'pendiente') {
      throw new JDJError('SOLICITUD_PENDIENTE', 'Recupera tu comprobante antes de iniciar otra solicitud.');
    }
    borrar('solicitud');
  }
  async function recuperar(numero) {
    const normalizado = telefono(numero);
    const resultado = await publico('recuperar', {telefono: normalizado}, false);
    // La recuperación resuelve una reserva incierta solo para ese mismo celular.
    // Si el servidor no encontró nada, lanza OPERACION_RECHAZADA y conserva el ID.
    const solicitud = leer('solicitud');
    if (solicitud) {
      try {
        const datos = JSON.parse(solicitud.clave);
        if (datos.telefono === normalizado) {
          solicitud.estado = resultado.estado === 'ASIGNADO' || resultado.estado === 'INGRESADO' ? 'confirmada' : 'rechazada';
          guardar('solicitud', solicitud);
        }
      } catch (_) { /* no interpretar almacenamiento inválido */ }
    }
    return resultado;
  }

  // API de la interfaz. No expone el token en sesionActual ni en el resultado del login.
  global.JDJ_API = Object.freeze({
    Error: JDJError,
    probar: comprobarVersion,
    sesionActual: sesionActual,
    iniciarSesion: iniciarSesion,
    cerrarSesion: cerrarSesion,
    registrar: registrar,
    nuevaSolicitud: nuevaSolicitud,
    recuperar: recuperar,
    estado: valor => publico('estado', {codigo: codigo(valor)}, true),
    itinerario: () => publico('itinerario', {}, true),
    buscar: valor => protegido('buscar', {codigo: codigo(valor)}, false),
    confirmarIngreso: valor => protegido('confirmar', {codigo: codigo(valor)}, true),
    solicitarSalida: async (valor, numero) => {
      const c = codigo(valor), t = telefono(numero);
      try { return await publico('solicitarSalida', {codigo: c, telefono: t}, false, true); }
      catch (error) {
        if (!error.resultadoDesconocido) throw error;
        try {
          const verificado = await recuperar(t);
          if (verificado.codigo === c && (verificado.salidaSolicitada || verificado.estado === 'RETIRADO')) return verificado;
        } catch (_) { /* resultado incierto */ }
        throw new JDJError('OPERACION_PENDIENTE', 'La solicitud podría haberse guardado. Actualiza el comprobante antes de enviarla otra vez.', {resultadoDesconocido: true});
      }
    },
    confirmarSalida: valor => protegido('confirmarSalida', {codigo: codigo(valor)}, true),
    dashboard: () => protegido('dashboard', {}, false),
    solicitudesSalida: desde => {
      const inicio = desde == null ? 0 : desde;
      if (!Number.isSafeInteger(inicio) || inicio < 0) return Promise.reject(new JDJError('DATOS_INVALIDOS', 'Página de solicitudes no válida.'));
      return protegido('solicitudesSalida', {desde: inicio}, false);
    }
  });
})(globalThis); 
