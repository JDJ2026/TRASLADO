/**
 * JDJ San Juan 2026 — guardar como js/registro.js.
 * Requiere api.js, ui.js y el HTML actualizado que entregaremos después.
 * No inicia al cargar. app.js llamará a JDJ_REGISTRO.iniciar().
 *
 * Mantiene el código manual si la librería QR no está disponible.
 * Consulta automáticamente cada 30–35 segundos solo con el comprobante visible.
 * Los estados terminales se verifican mediante recuperación fresca: un estado
 * público cacheado no debe declarar vencida una reserva recién ingresada.
 */
(function (global) {
  'use strict';
  const doc = global.document;
  const ESTADOS = ['ASIGNADO', 'INGRESADO', 'VENCIDO', 'RETIRADO'];
  let api, ui, iniciado = false;
  let comprobante = null;
  let observadoEn = 0;
  const estadosNotificados = new Set();
  let relojServidor = 0, relojLocal = 0;
  let generacion = 0, timer = null, consultaTimer = null;
  let consultando = false, forzarSiguiente = false, chequeoVencimiento = false;
  let erroresConsulta = 0, qrGenerado = null, ultimaVerificacion = null;
  let operacionFormulario = false, operacionSalida = false;
  const ids = [
    'form-registro', 'nombre-piloto', 'telefono-piloto', 'tipo-vehiculo', 'fecha-salida',
    'btn-continuar-registro', 'form-recuperar', 'telefono-recuperar', 'btn-consultar-recuperar',
    'codigo-ingreso', 'tipo-asignado', 'codigo-parqueo', 'nombre-parqueo', 'qr-codigo',
    'asignacion-titulo', 'asignacion-eyebrow', 'asignacion-subtitulo', 'asignacion-estado',
    'comprobante-piloto', 'comprobante-fecha-salida', 'comprobante-mensaje', 'comprobante-actualizacion',
    'btn-maps', 'btn-waze', 'btn-solicitar-salida', 'btn-nueva-reserva', 'btn-actualizar-comprobante',
    'temporizador-reserva', 'temporizador-tiempo', 'temporizador-estado', 'temporizador-mensaje',
    'temporizador-progreso', 'temporizador-barra-relleno'
  ];
  const el = id => ui.elemento(id);
  const ahoraLocal = () => global.performance && typeof global.performance.now === 'function' ? global.performance.now() : Date.now();
  const ahoraServidor = () => relojServidor + (ahoraLocal() - relojLocal);
  const visible = () => comprobante && ui.pantallaActual() === 'asignacion' && !doc.hidden;
  const activo = () => visible() && ['ASIGNADO', 'INGRESADO'].includes(comprobante.estado);
  const vigente = () => comprobante && comprobante.estado === 'ASIGNADO' &&
    Number.isFinite(Date.parse(comprobante.venceEn)) && Date.parse(comprobante.venceEn) > ahoraServidor();
  function ver(ref, mostrar) { const nodo = el(ref); nodo.hidden = !mostrar; nodo.style.display = mostrar ? '' : 'none'; }
  function sincronizarReloj(datos) {
    const fecha = Date.parse(datos.servidorAhora);
    if (!Number.isFinite(fecha)) throw new api.Error('RESPUESTA_INVALIDA', 'No se recibió una hora válida del servidor.');
    relojServidor = fecha; relojLocal = ahoraLocal();
  }
  function suspender() {
    generacion++;
    if (timer !== null) global.clearTimeout(timer);
    if (consultaTimer !== null) global.clearTimeout(consultaTimer);
    timer = null; consultaTimer = null;
  }
  function iniciar() {
    if (iniciado) return;
    api = global.JDJ_API; ui = global.JDJ_UI;
    if (!api || !ui) throw new Error('Carga api.js y ui.js antes de registro.js.');
    ids.forEach(id => el(id));
    ui.iniciar();
    el('form-registro').addEventListener('submit', registrar);
    el('form-recuperar').addEventListener('submit', recuperar);
    el('btn-maps').addEventListener('click', () => abrirRuta('maps'));
    el('btn-waze').addEventListener('click', () => abrirRuta('waze'));
    el('btn-solicitar-salida').addEventListener('click', solicitarSalida);
    el('btn-nueva-reserva').addEventListener('click', nuevaReserva);
    el('btn-actualizar-comprobante').addEventListener('click', actualizarManual);
    doc.addEventListener('visibilitychange', () => {
      if (doc.hidden) suspender(); else reanudar(true);
    });
    global.addEventListener('jdj:pantalla-cambiada', () => {
      if (visible()) reanudar(true); else suspender();
    });
    global.addEventListener('pagehide', suspender);
    global.addEventListener('pageshow', () => reanudar(true));
    el('temporizador-tiempo').setAttribute('aria-live', 'off');
    iniciado = true;
  }
  function abrirRegistro() { iniciar(); ui.mostrar('registro'); }
  function abrirRecuperar(numero) {
    iniciar();
    if (numero) el('telefono-recuperar').value = String(numero);
    ui.mostrar('recuperar');
  }
  function verComprobante() {
    iniciar();
    if (comprobante) ui.mostrar('asignacion'); else abrirRecuperar();
  }

  async function registrar(e) {
    e.preventDefault();
    if (operacionFormulario || !el('form-registro').reportValidity()) return;
    operacionFormulario = true;
    const numero = el('telefono-piloto').value;
    try {
      const datos = await ui.conCarga({boton: 'btn-continuar-registro', titulo: 'Buscando tu parqueo',
        mensaje: 'Estamos guardando tu reserva. Evita enviar otro registro.'}, () => api.registrar({
          nombre: el('nombre-piloto').value, telefono: numero,
          tipo: el('tipo-vehiculo').value, fechaSalida: el('fecha-salida').value
        }));
      presentar(datos, false, true);
      el('form-registro').reset();
    } catch (error) {
      if (error.codigo === 'TELEFONO_ACTIVO' || error.resultadoDesconocido) abrirRecuperar(numero);
      ui.mostrarError(error);
    } finally { operacionFormulario = false; }
  }
  async function recuperar(e) {
    e.preventDefault();
    if (operacionFormulario || !el('form-recuperar').reportValidity()) return;
    operacionFormulario = true;
    try {
      const datos = await ui.conCarga({boton: 'btn-consultar-recuperar', titulo: 'Recuperando comprobante',
        mensaje: 'Buscamos el registro asociado a tu celular.'}, () => api.recuperar(el('telefono-recuperar').value));
      presentar(datos, true, true);
    } catch (error) { ui.mostrarError(error); }
    finally { operacionFormulario = false; }
  }

  function notificarEstado() {
    if (!visible() || !comprobante || !['INGRESADO', 'RETIRADO'].includes(comprobante.estado)) return;
    const clave = comprobante.codigo + ':' + comprobante.estado;
    if (estadosNotificados.has(clave)) return;
    estadosNotificados.add(clave);
    if (comprobante.estado === 'INGRESADO') ui.avisar('¡Tu vehículo ya ingresó!',
      'El encargado confirmó el ingreso en ' + comprobante.nombreParqueo + '. Tu espacio está ocupado. Cuando te retires, solicita la salida desde este comprobante.', {tipo: 'exito'});
    else ui.avisar('Salida confirmada', 'El encargado confirmó la salida de tu vehículo. Gracias por participar en JDJ San Juan 2026.', {tipo: 'exito'});
  }
  function presentar(datos, recuperado, navegar) {
    if (!datos || !/^JDJ-[A-Z0-9]{6}$/.test(datos.codigo || '') || !ESTADOS.includes(datos.estado) ||
        !/^\d{8}$/.test(datos.telefono || '') || typeof datos.nombre !== 'string' ||
        typeof datos.codigoParqueo !== 'string' || !datos.codigoParqueo.trim() ||
        typeof datos.nombreParqueo !== 'string' || !datos.nombreParqueo.trim()) {
      throw new api.Error('RESPUESTA_INVALIDA', 'No se pudo verificar el comprobante. Intenta recuperarlo nuevamente.');
    }
    sincronizarReloj(datos);
    suspender();
    comprobante = Object.assign({}, datos);
    qrGenerado = null;
    observadoEn = Date.parse(datos.servidorAhora);
    ultimaVerificacion = datos.servidorAhora;
    chequeoVencimiento = false; erroresConsulta = 0; forzarSiguiente = false;
    ui.texto('codigo-ingreso', datos.codigo);
    ui.texto('codigo-parqueo', datos.codigoParqueo);
    ui.texto('nombre-parqueo', datos.nombreParqueo);
    ui.texto('tipo-asignado', ui.tipoVehiculo(datos.tipoVehiculo));
    ui.texto('comprobante-piloto', datos.nombre);
    ui.texto('comprobante-fecha-salida', datos.fechaSalida === '2026-11-21' ? 'Sábado 21 de noviembre' :
      datos.fechaSalida === '2026-11-22' ? 'Domingo 22 de noviembre' : 'No indicada en este registro');
    ui.texto('asignacion-eyebrow', recuperado ? 'TU COMPROBANTE JDJ' : 'REGISTRO COMPLETADO');
    renderizarEstado();
    if (navegar) ui.mostrar('asignacion'); else reanudar(false);
    notificarEstado();
  }
  function renderizarEstado() {
    if (!comprobante) return;
    const estado = comprobante.estado;
    const titulos = {ASIGNADO: '¡Parqueo asignado!', INGRESADO: '¡Ingreso confirmado!',
      VENCIDO: 'Tu reserva ha vencido', RETIRADO: 'Salida confirmada'};
    const mensajes = {
      ASIGNADO: 'Tu espacio está reservado. Presenta el QR o el código al encargado cuando llegues.',
      INGRESADO: comprobante.salidaSolicitada ? 'Tu solicitud de salida está pendiente. El encargado confirmará cuando tu vehículo se retire.' :
        'Tu ingreso está registrado. Solicita la salida cuando estés listo para retirar tu vehículo.',
      VENCIDO: 'El plazo de llegada terminó. Puedes registrarte nuevamente con el mismo celular.',
      RETIRADO: 'El encargado confirmó tu salida. Este registro se conserva en el historial.'
    };
    ui.texto('asignacion-titulo', titulos[estado]);
    ui.texto('asignacion-subtitulo', estado === 'ASIGNADO' ? 'Tu llegada a JDJ San Juan 2026, organizada.' : ui.estadoTexto(estado));
    ui.texto('comprobante-mensaje', mensajes[estado]);
    const badge = el('asignacion-estado');
    const punto = badge.querySelector('.estado-punto') || doc.createElement('span');
    punto.className = 'estado-punto';
    badge.replaceChildren(punto, doc.createTextNode(' ' + (comprobante.salidaSolicitada && estado === 'INGRESADO' ? 'Salida solicitada' : ui.estadoTexto(estado))));
    badge.setAttribute('data-estado', estado);
    ver('btn-solicitar-salida', estado === 'INGRESADO');
    el('btn-solicitar-salida').disabled = Boolean(comprobante.salidaSolicitada);
    ui.cambiarTextoBoton('btn-solicitar-salida', comprobante.salidaSolicitada ? 'Salida solicitada' : 'Solicitar salida');
    ver('btn-nueva-reserva', estado === 'VENCIDO' || estado === 'RETIRADO');
    mostrarHoraActualizacion();
    actualizarVigencia();
  }
  function mostrarHoraActualizacion(textoAlternativo) {
    if (textoAlternativo) { ui.texto('comprobante-actualizacion', textoAlternativo); return; }
    const fecha = new Date(ultimaVerificacion);
    ui.texto('comprobante-actualizacion', Number.isFinite(fecha.getTime()) ? 'Última verificación: ' +
      new Intl.DateTimeFormat('es-GT', {timeZone: 'America/Guatemala', hour: 'numeric', minute: '2-digit'}).format(fecha) : 'Pendiente de verificación.');
  }
  function generarQR() {
    if (qrGenerado === comprobante.codigo) return;
    const nodo = el('qr-codigo'); nodo.replaceChildren();
    if (typeof global.QRCode === 'function') {
      try {
        const opciones = {text: comprobante.codigo, width: 220, height: 220};
        if (global.QRCode.CorrectLevel) opciones.correctLevel = global.QRCode.CorrectLevel.H;
        new global.QRCode(nodo, opciones);
        qrGenerado = comprobante.codigo;
        return;
      } catch (_) { nodo.replaceChildren(); }
    }
    nodo.textContent = 'QR no disponible. Presenta el código escrito debajo.';
    qrGenerado = comprobante.codigo;
  }
  function actualizarVigencia() {
    if (!comprobante) return;
    const estado = comprobante.estado;
    const restante = Date.parse(comprobante.venceEn) - ahoraServidor();
    const mostrarQR = estado === 'INGRESADO' || vigente();
    const contenedor = el('qr-codigo').closest('.asignacion-qr-contenedor') || el('qr-codigo');
    contenedor.hidden = !mostrarQR; contenedor.style.display = mostrarQR ? '' : 'none';
    if (mostrarQR) generarQR();
    const coordenadas = typeof comprobante.latitud === 'number' && Number.isFinite(comprobante.latitud) &&
      Math.abs(comprobante.latitud) <= 90 && typeof comprobante.longitud === 'number' &&
      Number.isFinite(comprobante.longitud) && Math.abs(comprobante.longitud) <= 180;
    ['btn-maps', 'btn-waze'].forEach(id => { el(id).disabled = !mostrarQR || !coordenadas; });
    ver('temporizador-reserva', estado === 'ASIGNADO' || estado === 'VENCIDO');
    if (estado !== 'ASIGNADO' && estado !== 'VENCIDO') return;
    const segundos = estado !== 'VENCIDO' && Number.isFinite(restante) ? Math.max(0, Math.ceil(restante / 1000)) : 0;
    const horas = Math.floor(segundos / 3600);
    const mm = String(Math.floor(segundos / 60) % 60).padStart(2, '0');
    const ss = String(segundos % 60).padStart(2, '0');
    ui.texto('temporizador-tiempo', (horas ? String(horas).padStart(2, '0') + ':' : '') + mm + ':' + ss);
    const duracion = Number(comprobante.duracionMinutos) * 60000;
    const porcentaje = estado !== 'VENCIDO' && Number.isFinite(restante) && duracion > 0 ? Math.max(0, Math.min(100, restante / duracion * 100)) : 0;
    el('temporizador-progreso').setAttribute('aria-valuenow', String(Math.round(porcentaje)));
    el('temporizador-barra-relleno').style.width = porcentaje + '%';
    el('temporizador-reserva').classList.toggle('vencido', estado === 'VENCIDO');
    el('temporizador-reserva').classList.toggle('urgente', estado === 'ASIGNADO' && restante > 0 && restante <= 300000);
    ui.texto('temporizador-estado', estado === 'VENCIDO' ? 'RESERVA VENCIDA' :
      restante > 0 ? 'RESERVA ACTIVA' : 'VERIFICACIÓN PENDIENTE');
    ui.texto('temporizador-mensaje', estado === 'VENCIDO' ? 'Este QR ya no permite confirmar ingreso.' :
      restante > 0 ? 'Llega antes de que termine el plazo para conservar tu reserva.' :
        'Necesitamos comprobar la vigencia con el servidor. Usa Actualizar comprobante si no hay conexión.');
    if (estado === 'ASIGNADO' && Number.isFinite(restante) && restante <= 0 && !chequeoVencimiento && activo()) {
      chequeoVencimiento = true;
      programarConsulta(0, true);
    }
  }

  function reanudar(inmediato) {
    suspender();
    if (!visible()) return;
    const edad = ahoraServidor() - Date.parse(ultimaVerificacion);
    const refrescar = Boolean(inmediato) && (edad > 10000 || (comprobante.estado === 'ASIGNADO' && !vigente()));
    if (activo()) programarConsulta(refrescar ? 0 : 30000 + Math.random() * 5000, refrescar);
    // El tick puede adelantar la consulta si acaba de terminar el plazo.
    tick();
  }
  function tick() {
    if (!visible()) return;
    actualizarVigencia();
    if (comprobante.estado === 'ASIGNADO') timer = global.setTimeout(tick, 1000);
  }
  function programarConsulta(demora, fresca) {
    if (!activo()) return;
    forzarSiguiente = forzarSiguiente || Boolean(fresca);
    if (consultaTimer !== null) global.clearTimeout(consultaTimer);
    consultaTimer = global.setTimeout(() => { consultaTimer = null; consultar(); }, demora);
  }
  function aplicarEstado(datos) {
    if (!datos || datos.codigo !== comprobante.codigo || !ESTADOS.includes(datos.estado)) {
      throw new api.Error('RESPUESTA_INVALIDA', 'No pudimos verificar este comprobante.');
    }
    const marca = Date.parse(datos.actualizadoEn || datos.servidorAhora);
    sincronizarReloj(datos);
    const permitidos = {ASIGNADO: ESTADOS, INGRESADO: ['INGRESADO', 'RETIRADO'], VENCIDO: ['VENCIDO'], RETIRADO: ['RETIRADO']};
    if ((Number.isFinite(marca) && marca < observadoEn) || !permitidos[comprobante.estado].includes(datos.estado)) return;
    comprobante = Object.assign({}, comprobante, datos);
    observadoEn = Number.isFinite(marca) ? marca : observadoEn;
    ultimaVerificacion = datos.servidorAhora;
    renderizarEstado();
    notificarEstado();
  }
  async function consultar() {
    if (!activo() || consultando) return;
    consultando = true;
    const codigo = comprobante.codigo, numero = comprobante.telefono, turno = generacion;
    let fresca = forzarSiguiente || (comprobante.estado === 'ASIGNADO' && !vigente());
    forzarSiguiente = false;
    try {
      let datos = fresca ? await api.recuperar(numero) : await api.estado(codigo);
      if (turno !== generacion || !visible() || comprobante.codigo !== codigo) return;
      if (!datos.encontrado && !datos.estado) throw new api.Error('REGISTRO_NO_ENCONTRADO', 'No se pudo localizar el comprobante.');
      // La API pública puede conservar un estado anterior hasta diez segundos.
      // Antes de concluir vencimiento/salida, comprobar el registro actual por celular.
      if (!fresca && ['VENCIDO', 'RETIRADO'].includes(datos.estado)) {
        datos = await api.recuperar(numero); fresca = true;
        if (turno !== generacion || !visible() || comprobante.codigo !== codigo) return;
      }
      if (fresca && datos.codigo !== codigo) presentar(datos, true, false);
      else aplicarEstado(datos);
      erroresConsulta = 0;
    } catch (_) {
      if (turno === generacion && visible() && comprobante.codigo === codigo) {
        erroresConsulta++;
        mostrarHoraActualizacion('No pudimos verificar el estado. Conserva tu código y vuelve a intentar.');
      }
    } finally {
      consultando = false;
      if (activo()) programarConsulta(forzarSiguiente ? 0 : erroresConsulta ? Math.min(120000, 30000 * Math.pow(2, erroresConsulta)) : 30000 + Math.random() * 5000, false);
    }
  }

  async function actualizarManual() {
    if (!comprobante || consultando) return;
    consultando = true;
    const codigo = comprobante.codigo, turno = generacion;
    try {
      const datos = await ui.conCarga({boton: 'btn-actualizar-comprobante', titulo: 'Verificando comprobante'},
        () => api.recuperar(comprobante.telefono));
      if (turno !== generacion || !visible() || comprobante.codigo !== codigo) return;
      presentar(datos, true, false);
    } catch (error) { ui.mostrarError(error); }
    finally { consultando = false; if (activo()) programarConsulta(30000, false); }
  }
  async function solicitarSalida() {
    if (!comprobante || comprobante.estado !== 'INGRESADO' || comprobante.salidaSolicitada || operacionSalida) return;
    operacionSalida = true;
    const codigo = comprobante.codigo, numero = comprobante.telefono;
    try {
      const aceptado = await ui.confirmar('¿Solicitar salida?', 'El encargado recibirá el aviso y confirmará cuando tu vehículo se retire.', 'Solicitar salida');
      if (!aceptado || !visible() || comprobante.codigo !== codigo || comprobante.estado !== 'INGRESADO') return;
      const datos = await ui.conCarga({boton: 'btn-solicitar-salida', titulo: 'Enviando solicitud de salida'},
        () => api.solicitarSalida(codigo, numero));
      if (comprobante.codigo === codigo) {
        aplicarEstado(datos);
        if (datos.estado === 'INGRESADO') ui.avisar('Solicitud de salida enviada', 'El encargado recibió tu solicitud. El cupo se liberará cuando confirme el retiro del vehículo.', {tipo: 'exito'});
      }
    } catch (error) { ui.mostrarError(error); }
    finally { operacionSalida = false; }
  }
  async function nuevaReserva() {
    if (!comprobante || !['VENCIDO', 'RETIRADO'].includes(comprobante.estado)) return;
    try {
      api.nuevaSolicitud();
      const anterior = comprobante;
      abrirRegistro();
      el('nombre-piloto').value = anterior.nombre;
      el('telefono-piloto').value = anterior.telefono;
      el('tipo-vehiculo').value = anterior.tipoVehiculo;
      el('fecha-salida').value = '';
    } catch (error) { ui.mostrarError(error); }
  }
  function abrirRuta(tipo) {
    if (!comprobante || (comprobante.estado !== 'INGRESADO' && !vigente()) || el(tipo === 'maps' ? 'btn-maps' : 'btn-waze').disabled) return;
    const destino = comprobante.latitud + ',' + comprobante.longitud;
    const url = new URL(tipo === 'maps' ? 'https://www.google.com/maps/dir/' : 'https://www.waze.com/ul');
    if (tipo === 'maps') { url.searchParams.set('api', '1'); url.searchParams.set('destination', destino); url.searchParams.set('travelmode', 'driving'); }
    else { url.searchParams.set('ll', destino); url.searchParams.set('navigate', 'yes'); }
    global.open(url.toString(), '_blank', 'noopener,noreferrer');
  }

  global.JDJ_REGISTRO = Object.freeze({iniciar: iniciar, abrirRegistro: abrirRegistro,
    abrirRecuperar: abrirRecuperar, verComprobante: verComprobante,
    suspender: suspender, hayComprobante: () => Boolean(comprobante)});
})(globalThis);
