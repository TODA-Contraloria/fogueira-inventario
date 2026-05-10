// ====================================================
// FOGUEIRA PWA - Cliente API
// ----------------------------------------------------
// Encapsula todas las llamadas al Apps Script backend.
// Cambios 09/05/2026: funciones de conciliación móvil.
// ====================================================

const API_URL = 'https://script.google.com/macros/s/AKfycbz77caU1oxYtguWK5FlFmXZ-3MDeRohMw66hkcCTPH8elcPtiKG1CZtoV6Dyr45DOe_/exec';

/**
 * Llamada genérica al API.
 * Usa text/plain para evitar CORS preflight en Apps Script.
 */
async function llamarApi(accion, params = {}) {
    const response = await fetch(API_URL + '?api=v1', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ accion, params }),
        redirect: 'follow'
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return await response.json();
}

// ====================================================
// AUTH
// ====================================================
async function apiLogin(usuario, password) {
    return await llamarApi('login', { usuario, password });
}
async function apiValidarSesion(token) {
    return await llamarApi('validarSesion', { token });
}
async function apiCerrarSesion(token) {
    return await llamarApi('cerrarSesion', { token });
}
async function apiPing() {
    return await llamarApi('ping');
}

// ====================================================
// INVSOFT - SESIONES
// ====================================================
async function apiListarSesiones(token, filtros = {}) {
    return await llamarApi('invsoft.listarSesiones', { token, filtros });
}
async function apiDetalleSesion(token, folio) {
    return await llamarApi('invsoft.detalleSesion', { token, folio });
}
async function apiAsignarGrupo(token, folio, grupo) {
    return await llamarApi('invsoft.asignarGrupo', { token, folio, grupo });
}

// ====================================================
// INVSOFT - CONTEOS
// ====================================================
async function apiObtenerProductos(token, folio, grupo) {
    return await llamarApi('invsoft.obtenerProductos', { token, folio, grupo });
}
async function apiGuardarConteo(token, folio, grupo, clave, cantidad, observacion = '') {
    return await llamarApi('invsoft.guardarConteo', {
        token, folio, grupo, clave, cantidad, observacion
    });
}
async function apiAgregarFueraCatalogo(token, folio, grupo, descripcion, cantidad, unidad = '', observacion = '') {
    return await llamarApi('invsoft.fueraCatalogo', {
        token, folio, grupo, descripcion, cantidad, unidad, observacion
    });
}
async function apiFinalizarGrupo(token, folio, grupo) {
    return await llamarApi('invsoft.finalizarGrupo', { token, folio, grupo });
}

// ====================================================
// INVSOFT - CONCILIACIÓN (09/05/2026)
// ====================================================
async function apiObtenerConciliacion(token, folio) {
    return await llamarApi('invsoft.obtenerConciliacion', { token, folio });
}
async function apiGuardarResolucion(token, folio, clave, cantidad, comentario) {
    return await llamarApi('invsoft.guardarResolucion', {
        token, folio, clave, cantidad, comentario
    });
}
async function apiAsignarCostoManual(token, folio, clave, costo_unitario, comentario = '') {
    return await llamarApi('invsoft.asignarCostoManual', {
        token, folio, clave, costo_unitario, comentario
    });
}
async function apiCerrarInventario(token, folio) {
    return await llamarApi('invsoft.cerrarInventario', { token, folio });
}
async function apiGenerarReporte(token, folio) {
    return await llamarApi('invsoft.generarReporte', { token, folio });
}
