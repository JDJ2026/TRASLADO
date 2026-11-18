/**
 * Guardar como js/encargado.js. Requiere api.js, ui.js y escaner.js.
 * app.js lo iniciará con el nuevo HTML. No inicia automáticamente.
 * No guarda PIN ni autoriza operaciones por el estado de la pantalla:
 * la API vuelve a verificar la sesión y el registro en el servidor.
 */
(function (global) {
  'use strict';
  let api, ui, escaner, iniciado = false, seleccionado = null;
  let revision = 0, buscando = false, confirmando = false, camaraPendiente = false;
  const ids = ['form-login-encargado', 'usuario-encargado', 'pin-encargado', 'mensaje-login',
    'btn-login-ingresar', 'encargado-sesion-nombre', 'btn-cerrar-sesion', 'codigo-busqueda',
    'btn-buscar-codigo', 'resultado-busqueda', 'encargado-nombre', 'encargado-tipo',
    'encargado-codigo-parqueo', 'encargado-nombre-parqueo', 'encargado-estado',
    'btn-confirmar-ingreso', 'btn-confirmar-salida', 'btn-escanear-qr', 'mensaje-escaner'];
  const el = id => ui.elemento(id);
  const autorizado = () => Boolean(api.sesionActual());
  const enPanel = () => autorizado() && ui.pantallaActual() === 'encargado' && !global.document.hidden;
  function ocultarResultado() {
    seleccionado = null;
    const nodo = el('resultado-busqueda'); nodo.hidden = true; nodo.style.display = 'none';
    el('btn-confirmar-ingreso').disabled = true; el('btn-confirmar-salida').disabled = true;
  }
  function iniciar() {
    if (iniciado) return;
    api = global.JDJ_API; ui = global.JDJ_UI; escaner = global.JDJ_ESCANER;
    if (!api || !ui || !escaner) throw new Error('Faltan los módulos del panel de encargados.');
    ids.forEach(id => el(id));
    el('form-login-encargado').addEventListener('submit', ingresar);
    el('btn-buscar-codigo').addEventListener('click', () => buscarCodigo(el('codigo-busqueda').value));
    el('codigo-busqueda').addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); buscarCodigo(el('codigo-busqueda').value); }
    });
    el('btn-confirmar-ingreso').addEventListener('click', () => confirmar('ingreso'));
    el('btn-confirmar-salida').addEventListener('click', () => confirmar('salida'));
    el('btn-escanear-qr').addEventListener('click', alternarCamara);
    el('btn-cerrar-sesion').addEventListener('click', salir);
    global.addEventListener('jdj:pantalla-cambiada', e => {
      revision++;
      if (e.detail.actual !== 'encargado') {
        ocultarResultado(); ui.cambiarTextoBoton('btn-escanear-qr', 'Escanear código QR');
      }
    });
    global.document.addEventListener('visibilitychange', () => {
      if (global.document.hidden) { revision++; ocultarResultado(); }
    });
    global.addEventListener('jdj:sesion-cambiada', () => {
      if (!autorizado() && ['encargado', 'dashboard'].includes(ui.pantallaActual())) {
        revision++; ocultarResultado();
        escaner.detener().catch(() => {});
        ui.mostrar('login-encargado');
        ui.texto('mensaje-login', 'Inicia sesión para continuar.');
      }
    });
    ocultarResultado(); iniciado = true;
  }
  function abrir() {
    iniciar(); ocultarResultado();
    const sesion = api.sesionActual();
    ui.texto('mensaje-login', '');
    if (!sesion) { ui.mostrar('login-encargado'); return; }
    ui.texto('encargado-sesion-nombre', sesion.nombre);
    ui.mostrar('encargado');
  }
  async function ingresar(e) {
    e.preventDefault();
    if (!el('form-login-encargado').reportValidity()) return;
    const turno = revision;
    ui.texto('mensaje-login', '');
    const usuario = el('usuario-encargado').value, pin = el('pin-encargado').value;
    // Limpiar el campo cuanto antes; el PIN no se guarda en este controlador.
    el('pin-encargado').value = '';
    try {
      await ui.conCarga({boton: 'btn-login-ingresar', titulo: 'Verificando acceso'}, () => api.iniciarSesion(usuario, pin));
      if (turno === revision && ui.pantallaActual() === 'login-encargado') abrir();
    } catch (error) { ui.texto('mensaje-login', ui.mensajeError(error)); }
  }
  async function buscarCodigo(entrada) {
    if (!enPanel() || buscando || confirmando) return;
    const codigo = String(entrada || '').trim().toUpperCase();
    if (!/^JDJ-[A-Z0-9]{6}$/.test(codigo)) {
      ui.avisar('Revisa el código', 'Escribe un código completo con el formato JDJ-ABC123.', {tipo: 'advertencia'}); return;
    }
    const turno = revision;
    buscando = true; ocultarResultado();
    el('codigo-busqueda').value = codigo;
    try {
      const datos = await ui.conCarga({boton: 'btn-buscar-codigo', titulo: 'Buscando vehículo'}, () => api.buscar(codigo));
      if (turno !== revision || !enPanel()) return;
      if (!datos.encontrado) { ui.avisar('Código no encontrado', 'Revisa el código o pide al piloto que recupere su comprobante.', {tipo: 'advertencia'}); return; }
      if (datos.codigo !== codigo || !['ASIGNADO', 'INGRESADO', 'VENCIDO', 'RETIRADO'].includes(datos.estado)) {
        throw new api.Error('RESPUESTA_INVALIDA', 'No se pudo verificar el registro.');
      }
      seleccionado = datos;
      pintarResultado();
    } catch (error) { if (turno === revision && enPanel()) ui.mostrarError(error); }
    finally { buscando = false; }
  }
  function pintarResultado() {
    if (!seleccionado) return;
    const datos = seleccionado;
    ui.texto('encargado-nombre', datos.nombre);
    ui.texto('encargado-tipo', ui.tipoVehiculo(datos.tipoVehiculo));
    ui.texto('encargado-codigo-parqueo', datos.codigoParqueo);
    ui.texto('encargado-nombre-parqueo', datos.nombreParqueo);
    ui.texto('encargado-estado', datos.salidaSolicitada && datos.estado === 'INGRESADO' ? 'Salida solicitada' : ui.estadoTexto(datos.estado));
    el('resultado-busqueda').hidden = false; el('resultado-busqueda').style.display = 'block';
    el('btn-confirmar-ingreso').disabled = datos.estado !== 'ASIGNADO';
    const permiteSalida = datos.estado === 'INGRESADO' && datos.salidaSolicitada === true;
    el('btn-confirmar-salida').hidden = !permiteSalida;
    el('btn-confirmar-salida').style.display = permiteSalida ? '' : 'none';
    el('btn-confirmar-salida').disabled = !permiteSalida;
  }
  async function confirmar(tipo) {
    if (!enPanel() || !seleccionado || confirmando || buscando) return;
    if (seleccionado.estado !== (tipo === 'ingreso' ? 'ASIGNADO' : 'INGRESADO')) return;
    if (tipo === 'salida' && seleccionado.salidaSolicitada !== true) return;
    confirmando = true;
    const codigo = seleccionado.codigo, turno = revision;
    const texto = tipo === 'ingreso' ? 'Confirma únicamente si el vehículo llegó al parqueo ' + seleccionado.nombreParqueo + '.' :
      'Confirma únicamente cuando el vehículo se haya retirado. Esto liberará su espacio.';
    try {
      if (!await ui.confirmar(tipo === 'ingreso' ? '¿Confirmar ingreso?' : '¿Confirmar salida?', texto)) return;
      if (!enPanel() || turno !== revision || !seleccionado || seleccionado.codigo !== codigo) return;
      const datos = await ui.conCarga({boton: tipo === 'ingreso' ? 'btn-confirmar-ingreso' : 'btn-confirmar-salida',
        titulo: tipo === 'ingreso' ? 'Registrando ingreso' : 'Registrando salida'},
        () => tipo === 'ingreso' ? api.confirmarIngreso(codigo) : api.confirmarSalida(codigo));
      if (turno !== revision || !enPanel() || !seleccionado || seleccionado.codigo !== codigo) return;
      if (datos.codigo !== codigo || datos.estado !== (tipo === 'ingreso' ? 'INGRESADO' : 'RETIRADO')) {
        throw new api.Error('RESPUESTA_INVALIDA', 'Verifica nuevamente el registro antes de continuar.');
      }
      seleccionado = Object.assign({}, seleccionado, datos);
      pintarResultado();
      ui.avisar('Operación confirmada', tipo === 'ingreso' ? 'El ingreso quedó registrado.' : 'La salida quedó registrada y el espacio fue liberado.', {tipo: 'exito'});
    } catch (error) {
      if (turno === revision && enPanel()) {
        // Si el resultado es incierto, exigir una búsqueda nueva antes de otra acción.
        ocultarResultado(); ui.mostrarError(error);
      }
    } finally { confirmando = false; }
  }
  async function alternarCamara() {
    if (!enPanel() || camaraPendiente || confirmando) return;
    camaraPendiente = true;
    try {
      if (escaner.activo()) await escaner.detener();
      else await escaner.iniciar({permitido: enPanel,
        alDetectar: async codigo => {
          ui.cambiarTextoBoton('btn-escanear-qr', 'Escanear código QR');
          ui.texto('mensaje-escaner', 'Código leído. Revisa los datos antes de confirmar.');
          await buscarCodigo(codigo);
        }, alError: mensaje => ui.texto('mensaje-escaner', mensaje)});
      ui.cambiarTextoBoton('btn-escanear-qr', escaner.activo() ? 'Detener cámara' : 'Escanear código QR');
    } catch (_) { ui.texto('mensaje-escaner', 'No se pudo abrir la cámara. Revisa sus permisos o ingresa el código manualmente.'); }
    finally { camaraPendiente = false; }
  }
  async function salir() {
    revision++; ocultarResultado();
    // Cerrar sesión localmente sin esperar a que termine la cámara o la red.
    const cierre = api.cerrarSesion();
    ui.mostrar('inicio');
    try { await escaner.detener(); } catch (_) { /* conservar acceso manual */ }
    await cierre;
  }
  global.JDJ_ENCARGADO = Object.freeze({iniciar: iniciar, abrir: abrir, buscarCodigo: buscarCodigo});
})(globalThis);
