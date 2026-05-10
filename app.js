// ====================================================
// FOGUEIRA PWA - Lógica principal
// ----------------------------------------------------
// Orquesta el flujo: login → sesiones → captura → fin
// CAMBIO 09/05/2026: agregada vista de conciliación móvil
// ====================================================

const STORAGE_KEY = 'fogueira_pwa_sesion';
const STORAGE_BORRADOR = 'fogueira_pwa_borrador';
const STORAGE_COLA = 'fogueira_pwa_cola_sync';

// ====================================================
// ESTADO GLOBAL
// ====================================================
let sesionActual = null;        // {token, usuario, nombre, rol, expira}
let folioActivo = null;          // INV-XXXXX-XXX (captura)
let grupoActivo = null;          // 'G1' | 'G2'
let productos = [];              // Array de todos los productos a contar
let conteosLocales = {};         // {clave: {cantidad, observacion, sincronizado, timestamp}}
let busquedaTexto = '';
let filtroActual = 'TODOS';      // TODOS | PENDIENTES | CAPTURADOS | PRIORITARIOS

// Conciliación
let folioConc = null;            // folio que se está conciliando
let conciliacionData = null;     // respuesta de apiObtenerConciliacion
let busquedaConc = '';
let filtroConc = 'ATENCION';     // ATENCION | PENDIENTES | TODOS

// ====================================================
// HELPERS DOM
// ====================================================
function $(id) { return document.getElementById(id); }
function $$(sel) { return document.querySelectorAll(sel); }

function show(id) {
    const el = $(id); if (el) el.style.setProperty('display', 'flex', 'important');
}
function hide(id) {
    const el = $(id); if (el) el.style.setProperty('display', 'none', 'important');
}

function mostrarVista(vistaId) {
    ['vista-login', 'vista-sesiones', 'vista-captura', 'vista-conciliacion'].forEach(v => hide(v));
    show(vistaId);
}

function showAlert(elementId, mensaje, tipo = 'error') {
    const el = $(elementId);
    if (!el) return;
    el.textContent = mensaje;
    el.className = 'alerta ' + tipo + ' visible';
}
function hideAlert(elementId) {
    const el = $(elementId);
    if (el) el.classList.remove('visible');
}

function obtenerGrupoDelRol(rol) {
    if (rol === 'CONTEO_G1') return 'G1';
    if (rol === 'CONTEO_G2') return 'G2';
    return null;
}

function fmtFecha(ts) {
    if (!ts) return '-';
    return new Date(ts).toLocaleString('es-MX', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
    });
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ====================================================
// CONEXIÓN
// ====================================================
function actualizarConexion() {
    const ind = $('indicador-conexion');
    const txt = $('texto-conexion');
    if (!ind || !txt) return;
    if (navigator.onLine) {
        ind.classList.remove('offline');
        txt.textContent = 'En línea';
    } else {
        ind.classList.add('offline');
        txt.textContent = 'Sin conexión';
    }
    procesarColaSync();
}
window.addEventListener('online', actualizarConexion);
window.addEventListener('offline', actualizarConexion);

// ====================================================
// LOGIN
// ====================================================
async function hacerLogin() {
    const usuario = $('usuario').value.trim();
    const password = $('password').value;

    if (!usuario || !password) {
        showAlert('alerta-login', 'Ingresa usuario y contraseña', 'error');
        return;
    }
    if (!navigator.onLine) {
        showAlert('alerta-login', 'Sin conexión. El login requiere internet.', 'error');
        return;
    }

    const btn = $('btn-login');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>Validando...';
    hideAlert('alerta-login');

    try {
        const r = await apiLogin(usuario, password);
        if (r.ok) {
            sesionActual = r.data;
            localStorage.setItem(STORAGE_KEY, JSON.stringify(sesionActual));
            await irASesiones();
        } else {
            showAlert('alerta-login', r.mensaje || r.error || 'Error', 'error');
        }
    } catch (e) {
        showAlert('alerta-login', 'Error de red: ' + e.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Iniciar Sesión';
    }
}

async function hacerLogout() {
    if (!confirm('¿Cerrar sesión?\n\nLos conteos no sincronizados se perderán.')) return;

    if (sesionActual && navigator.onLine) {
        try { await apiCerrarSesion(sesionActual.token); } catch(e){}
    }

    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_BORRADOR);
    localStorage.removeItem(STORAGE_COLA);
    sesionActual = null;
    folioActivo = null;
    grupoActivo = null;
    productos = [];
    conteosLocales = {};
    folioConc = null;
    conciliacionData = null;

    $('btn-logout-header').style.display = 'none';
    $('usuario').value = '';
    $('password').value = '';
    hideAlert('alerta-login');
    mostrarVista('vista-login');
}

// ====================================================
// SESIONES
// ====================================================
async function irASesiones() {
    mostrarVista('vista-sesiones');
    $('btn-logout-header').style.display = 'inline-block';

    const grupo = obtenerGrupoDelRol(sesionActual.rol);
    $('us-nombre').textContent = sesionActual.nombre;
    $('us-rol').textContent = sesionActual.rol;
    $('us-grupo').textContent = grupo || sesionActual.rol;

    await cargarSesiones();
}

async function cargarSesiones() {
    const lista = $('lista-sesiones');
    lista.innerHTML = '<div class="spinner-grande"></div>';
    hideAlert('alerta-sesiones');

    if (!navigator.onLine) {
        showAlert('alerta-sesiones', 'Sin conexión. No se puede cargar la lista.', 'error');
        lista.innerHTML = '';
        return;
    }

    try {
        const r = await apiListarSesiones(sesionActual.token);
        if (!r.ok) {
            showAlert('alerta-sesiones', r.mensaje || r.error || 'Error', 'error');
            lista.innerHTML = '';
            return;
        }

        // Incluir EN_CONCILIACION (NUEVO 09/05/2026)
        const activas = (r.sesiones || []).filter(s =>
            s.estatus === 'ABIERTA' ||
            s.estatus === 'EN_PROGRESO' ||
            s.estatus === 'EN_CONCILIACION'
        );

        if (activas.length === 0) {
            lista.innerHTML = '<div class="empty-state">No hay sesiones activas.</div>';
            return;
        }

        const grupo = obtenerGrupoDelRol(sesionActual.rol);
        lista.innerHTML = activas.map(s => renderSesion(s, grupo)).join('');

        $$('.tarjeta-sesion').forEach(t => {
            t.addEventListener('click', () => {
                const folio = t.dataset.folio;
                const estatus = t.dataset.estatus;
                if (estatus === 'EN_CONCILIACION') {
                    irAConciliar(folio);
                } else {
                    entrarASesion(folio);
                }
            });
        });
    } catch (e) {
        showAlert('alerta-sesiones', 'Error: ' + e.message, 'error');
        lista.innerHTML = '';
    }
}

function renderSesion(s, miGrupo) {
    const g1Class = !s.g1_usuario ? 'libre' : (s.g1_usuario === sesionActual.usuario ? 'activo' : 'tomado');
    const g2Class = !s.g2_usuario ? 'libre' : (s.g2_usuario === sesionActual.usuario ? 'activo' : 'tomado');
    const g1Fin = s.g1_finalizado_at ? ' ✓' : '';
    const g2Fin = s.g2_finalizado_at ? ' ✓' : '';

    const accion = s.estatus === 'EN_CONCILIACION'
        ? '<div class="accion-conciliar">→ CONCILIAR</div>'
        : '';

    return `
        <div class="tarjeta-sesion" data-folio="${s.folio}" data-estatus="${s.estatus}">
            <div class="top-row">
                <span class="folio">${s.folio}</span>
                <span class="estatus ${s.estatus}">${s.estatus}</span>
            </div>
            <div class="almacen">📍 ${s.almacen_nombre}</div>
            <div class="meta">
                <span>${s.total_productos} productos</span>
                <span>·</span>
                <span>${s.tipo_sesion}</span>
            </div>
            <div class="grupos">
                <span class="grupo-tag ${g1Class}">G1: ${s.g1_usuario || 'libre'}${g1Fin}</span>
                <span class="grupo-tag ${g2Class}">G2: ${s.g2_usuario || 'libre'}${g2Fin}</span>
            </div>
            ${accion}
        </div>
    `;
}

// ====================================================
// ENTRAR A SESIÓN (CONTEO)
// ====================================================
async function entrarASesion(folio) {
    const grupo = obtenerGrupoDelRol(sesionActual.rol);

    if (!grupo) {
        alert('Tu rol (' + sesionActual.rol + ') no captura inventario.\nSolo G1 y G2 pueden contar.');
        return;
    }

    const lista = $('lista-sesiones');
    lista.innerHTML = '<div class="spinner-grande"></div>';

    try {
        const rAsig = await apiAsignarGrupo(sesionActual.token, folio, grupo);
        if (!rAsig.ok) {
            alert('No se pudo entrar:\n' + (rAsig.mensaje || rAsig.error));
            await cargarSesiones();
            return;
        }

        const rProd = await apiObtenerProductos(sesionActual.token, folio, grupo);
        if (!rProd.ok) {
            alert('No se pudieron cargar productos:\n' + (rProd.mensaje || rProd.error));
            await cargarSesiones();
            return;
        }

        folioActivo = folio;
        grupoActivo = grupo;
        productos = [];
        conteosLocales = {};

        (rProd.priorizados || []).forEach(p => productos.push({...p, prioritario: true}));
        (rProd.otros || []).forEach(p => productos.push({...p, prioritario: false}));
        (rProd.fuera_catalogo || []).forEach(p => productos.push({...p, prioritario: false, es_fuera_catalogo: true}));

        productos.forEach(p => {
            if (p.ya_capturado) {
                conteosLocales[p.clave] = {
                    cantidad: p.cantidad_propia,
                    observacion: p.observacion_propia || '',
                    sincronizado: true,
                    timestamp: Date.now()
                };
            }
        });

        guardarBorrador();

        $('cap-folio').textContent = folio;
        $('cap-almacen').textContent = rProd.sesion.almacen_nombre;
        $('cap-grupo').textContent = grupo;

        mostrarVista('vista-captura');
        renderProductos();

    } catch (e) {
        alert('Error: ' + e.message);
        await cargarSesiones();
    }
}

// ====================================================
// CAPTURA - RENDER
// ====================================================
function renderProductos() {
    const cont = $('lista-productos');
    if (!cont) return;

    let lista = productos.slice();

    if (busquedaTexto) {
        const tokens = busquedaTexto.toLowerCase().split(/\s+/).filter(t => t.length > 0);
        lista = lista.filter(p => {
            const texto = (p.descripcion + ' ' + p.clave + ' ' + (p.grupo_producto || '')).toLowerCase();
            return tokens.every(t => texto.includes(t));
        });
    }

    if (filtroActual === 'PENDIENTES') {
        lista = lista.filter(p => !conteosLocales[p.clave]);
    } else if (filtroActual === 'CAPTURADOS') {
        lista = lista.filter(p => !!conteosLocales[p.clave]);
    } else if (filtroActual === 'PRIORITARIOS') {
        lista = lista.filter(p => p.prioritario);
    }

    lista.sort((a, b) => {
        if (a.prioritario !== b.prioritario) return a.prioritario ? -1 : 1;
        return (a.descripcion || '').localeCompare(b.descripcion || '');
    });

    if (lista.length === 0) {
        cont.innerHTML = '<div class="empty-state">Sin resultados</div>';
        actualizarContadores();
        return;
    }

    cont.innerHTML = lista.map(p => {
        const c = conteosLocales[p.clave];
        const capturado = !!c;
        const sincronizado = c ? c.sincronizado : false;
        const claseFila = 'producto-fila' +
            (p.prioritario ? ' prioritario' : '') +
            (capturado ? ' capturado' : '') +
            (capturado && !sincronizado ? ' pendiente-sync' : '') +
            (p.es_fuera_catalogo ? ' fcat' : '');

        const badgePri = p.prioritario ? '<span class="badge-pri">PRIO</span>' : '';
        const badgeFcat = p.es_fuera_catalogo ? '<span class="badge-fcat">FCAT</span>' : '';
        const badgeSync = capturado ?
            (sincronizado ? '<span class="badge-ok">✓</span>' : '<span class="badge-pendiente">⏳</span>') : '';
        const badgeGrupo = p.grupo_producto ? '<span class="prod-grupo">' + escapeHtml(p.grupo_producto) + '</span>' : '';
        const unidadInline = p.unidad ? ' · ' + escapeHtml(p.unidad) : '';

        const cantidad = c ? c.cantidad : '';

        return `
            <div class="${claseFila}" data-clave="${p.clave}">
                <div class="prod-info" onclick="abrirCaptura('${p.clave}')">
                    <div class="prod-desc">${badgePri}${badgeFcat}${escapeHtml(p.descripcion)}${unidadInline}</div>
                    <div class="prod-meta">
                        <span class="prod-clave">${p.clave}</span>
                        ${badgeGrupo}
                        ${badgeSync}
                    </div>
                </div>
                <div class="prod-cantidad" onclick="abrirCaptura('${p.clave}')">
                    ${cantidad !== '' ? cantidad : '<span class="placeholder">—</span>'}
                </div>
            </div>
        `;
    }).join('');

    actualizarContadores();
}

function actualizarContadores() {
    const totalCapturados = Object.keys(conteosLocales).length;
    const totalProductos = productos.length;
    const pendientesSync = Object.values(conteosLocales).filter(c => !c.sincronizado).length;

    $('contador-progreso').textContent = totalCapturados + ' / ' + totalProductos;
    $('contador-pendientes').textContent = pendientesSync;

    if (pendientesSync > 0) {
        $('badge-pendientes').style.display = 'inline-flex';
    } else {
        $('badge-pendientes').style.display = 'none';
    }
}

// ====================================================
// CAPTURA - MODAL DE INGRESO
// ====================================================
function abrirCaptura(clave) {
    const p = productos.find(x => x.clave === clave);
    if (!p) return;

    const c = conteosLocales[clave];

    $('modal-cap-desc').textContent = p.descripcion;
    $('modal-cap-clave').textContent = p.clave + ' · ' + (p.unidad || '');
    $('modal-cap-input').value = c ? c.cantidad : '';
    $('modal-cap-obs').value = c ? (c.observacion || '') : '';
    $('modal-cap-input').dataset.clave = clave;

    $('modal-captura').classList.add('visible');
    setTimeout(() => $('modal-cap-input').focus(), 100);
}

function cerrarModalCaptura() {
    $('modal-captura').classList.remove('visible');
}

async function guardarCaptura() {
    const input = $('modal-cap-input');
    const clave = input.dataset.clave;
    const cantidadStr = input.value.trim();
    const observacion = $('modal-cap-obs').value.trim();

    if (cantidadStr === '') {
        alert('Ingresa una cantidad. Si quieres anular, deja en 0.');
        return;
    }

    const cantidad = Number(cantidadStr);
    if (isNaN(cantidad) || cantidad < 0) {
        alert('Cantidad inválida.');
        return;
    }

    conteosLocales[clave] = {
        cantidad: cantidad,
        observacion: observacion,
        sincronizado: false,
        timestamp: Date.now()
    };
    guardarBorrador();

    cerrarModalCaptura();
    renderProductos();

    encolarSync({ tipo: 'conteo', clave, cantidad, observacion });
    procesarColaSync();
}

// ====================================================
// FUERA DE CATÁLOGO
// ====================================================
function abrirFCat() {
    $('fcat-desc').value = '';
    $('fcat-cant').value = '';
    $('fcat-unidad').value = '';
    $('fcat-obs').value = '';
    $('modal-fcat').classList.add('visible');
    setTimeout(() => $('fcat-desc').focus(), 100);
}
function cerrarFCat() {
    $('modal-fcat').classList.remove('visible');
}

async function guardarFCat() {
    const desc = $('fcat-desc').value.trim();
    const cantidad = Number($('fcat-cant').value);
    const unidad = $('fcat-unidad').value.trim();
    const obs = $('fcat-obs').value.trim();

    if (!desc || desc.length < 3) {
        alert('Descripción muy corta (mín. 3 caracteres).');
        return;
    }
    if (!cantidad || cantidad <= 0) {
        alert('Cantidad inválida.');
        return;
    }

    if (!navigator.onLine) {
        alert('Producto fuera de catálogo requiere conexión.\nNo puede guardarse offline.');
        return;
    }

    try {
        const r = await apiAgregarFueraCatalogo(
            sesionActual.token, folioActivo, grupoActivo,
            desc, cantidad, unidad, obs
        );
        if (!r.ok) {
            alert('Error: ' + (r.mensaje || r.error));
            return;
        }

        productos.push({
            clave: r.clave_temporal,
            descripcion: desc,
            unidad: unidad,
            es_fuera_catalogo: true,
            prioritario: false,
            ya_capturado: true
        });
        conteosLocales[r.clave_temporal] = {
            cantidad: cantidad,
            observacion: obs,
            sincronizado: true,
            timestamp: Date.now()
        };
        guardarBorrador();
        cerrarFCat();
        renderProductos();
    } catch (e) {
        alert('Error de red: ' + e.message);
    }
}

// ====================================================
// COLA DE SINCRONIZACIÓN
// ====================================================
function leerCola() {
    try { return JSON.parse(localStorage.getItem(STORAGE_COLA) || '[]'); }
    catch (e) { return []; }
}
function escribirCola(cola) {
    localStorage.setItem(STORAGE_COLA, JSON.stringify(cola));
}
function encolarSync(item) {
    const cola = leerCola();
    const filtrada = cola.filter(c => !(c.tipo === item.tipo && c.clave === item.clave));
    filtrada.push({...item, encolado_at: Date.now()});
    escribirCola(filtrada);
    actualizarContadores();
}

let sincronizando = false;
async function procesarColaSync() {
    if (sincronizando) return;
    if (!navigator.onLine) return;
    if (!sesionActual || !folioActivo || !grupoActivo) return;

    const cola = leerCola();
    if (cola.length === 0) return;

    sincronizando = true;
    let nuevaCola = [];

    for (const item of cola) {
        try {
            if (item.tipo === 'conteo') {
                const r = await apiGuardarConteo(
                    sesionActual.token, folioActivo, grupoActivo,
                    item.clave, item.cantidad, item.observacion || ''
                );
                if (r.ok) {
                    if (conteosLocales[item.clave]) {
                        conteosLocales[item.clave].sincronizado = true;
                    }
                } else {
                    nuevaCola.push(item);
                }
            }
        } catch (e) {
            nuevaCola.push(item);
        }
    }

    escribirCola(nuevaCola);
    guardarBorrador();
    renderProductos();
    sincronizando = false;
}

setInterval(procesarColaSync, 15000);

// ====================================================
// BORRADOR LOCAL
// ====================================================
function guardarBorrador() {
    if (!folioActivo) return;
    localStorage.setItem(STORAGE_BORRADOR, JSON.stringify({
        folio: folioActivo,
        grupo: grupoActivo,
        productos: productos,
        conteos: conteosLocales,
        timestamp: Date.now()
    }));
}
function cargarBorrador() {
    try {
        const raw = localStorage.getItem(STORAGE_BORRADOR);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch (e) { return null; }
}

// ====================================================
// FILTROS Y BÚSQUEDA (CAPTURA)
// ====================================================
function setBusqueda(valor) {
    busquedaTexto = valor;
    renderProductos();
}
function setFiltro(filtro) {
    filtroActual = filtro;
    $$('.btn-filtro[data-filtro]').forEach(b => b.classList.toggle('activo', b.dataset.filtro === filtro));
    renderProductos();
}

// ====================================================
// FINALIZAR GRUPO
// ====================================================
async function finalizarMiGrupo() {
    const pendientes = Object.values(conteosLocales).filter(c => !c.sincronizado).length;
    if (pendientes > 0) {
        alert('Tienes ' + pendientes + ' conteos sin sincronizar.\nEspera a que se sincronicen antes de finalizar.');
        return;
    }

    const totalCap = Object.keys(conteosLocales).length;
    const sinCapturar = productos.length - totalCap;

    let msg = `¿Finalizar tu conteo como ${grupoActivo}?\n\n`;
    msg += `Productos capturados: ${totalCap}\n`;
    if (sinCapturar > 0) {
        msg += `Productos NO capturados: ${sinCapturar}\n`;
        msg += `(quedarán en 0 / sin contar)\n\n`;
    }
    msg += `Esta acción NO se puede deshacer.`;

    if (!confirm(msg)) return;

    try {
        const r = await apiFinalizarGrupo(sesionActual.token, folioActivo, grupoActivo);
        if (!r.ok) {
            alert('Error: ' + (r.mensaje || r.error));
            return;
        }
        alert('✅ Grupo ' + grupoActivo + ' finalizado.\nEstado de la sesión: ' + r.sesion_estado);

        localStorage.removeItem(STORAGE_BORRADOR);
        localStorage.removeItem(STORAGE_COLA);
        folioActivo = null;
        grupoActivo = null;
        productos = [];
        conteosLocales = {};

        await irASesiones();
    } catch (e) {
        alert('Error de red: ' + e.message);
    }
}

// ====================================================
// VOLVER A SESIONES
// ====================================================
async function volverASesiones() {
    const pendientes = Object.values(conteosLocales).filter(c => !c.sincronizado).length;
    if (pendientes > 0) {
        if (!confirm(`Hay ${pendientes} conteos sin sincronizar.\nSi sales, se mantienen guardados localmente y sincronizarán cuando vuelvas.\n\n¿Salir igual?`)) {
            return;
        }
    }
    folioActivo = null;
    grupoActivo = null;
    productos = [];
    conteosLocales = {};
    await irASesiones();
}

function volverDeConciliacion() {
    folioConc = null;
    conciliacionData = null;
    busquedaConc = '';
    filtroConc = 'ATENCION';
    irASesiones();
}

// ====================================================
// CONCILIACIÓN (NUEVO 09/05/2026)
// ====================================================
async function irAConciliar(folio) {
    folioConc = folio;
    mostrarVista('vista-conciliacion');
    $('conc-folio').textContent = folio;
    $('conc-almacen').textContent = '...';
    $('conc-lista').innerHTML = '<div class="spinner-grande"></div>';
    $('conc-kpis').innerHTML = '';
    hideAlert('alerta-conciliacion');
    await cargarConciliacion();
}

async function cargarConciliacion() {
    if (!navigator.onLine) {
        showAlert('alerta-conciliacion', 'Sin conexión. La conciliación requiere internet.', 'error');
        return;
    }
    try {
        const r = await apiObtenerConciliacion(sesionActual.token, folioConc);
        if (!r.ok) {
            showAlert('alerta-conciliacion', r.mensaje || r.error || 'Error', 'error');
            $('conc-lista').innerHTML = '';
            return;
        }
        conciliacionData = r;
        $('conc-almacen').textContent = r.sesion.almacen_nombre;
        renderConciliacion();
    } catch (e) {
        showAlert('alerta-conciliacion', 'Error de red: ' + e.message, 'error');
        $('conc-lista').innerHTML = '';
    }
}

function kpiCard(label, value, clase, sub) {
    return `<div class="kpi-card ${clase || ''}">
        <div class="kpi-label">${escapeHtml(label)}</div>
        <div class="kpi-value">${value}</div>
        ${sub ? '<div class="kpi-label" style="margin-top:2px;font-weight:normal;">' + escapeHtml(sub) + '</div>' : ''}
    </div>`;
}

function tipoBadge(tipo) {
    const map = {
        'NINGUNA': '<span class="badge badge-verde">OK</span>',
        'G1_VS_G2': '<span class="badge badge-rojo">G1≠G2</span>',
        'VS_SOFT': '<span class="badge badge-naranja">vs Soft</span>',
        'AMBAS': '<span class="badge badge-rojo">G1≠G2+Soft</span>',
        'SOLO_UN_GRUPO': '<span class="badge badge-amarillo">Falta 1 grupo</span>',
        'FALTANTE_TOTAL': '<span class="badge badge-rojo">No contado</span>'
    };
    return map[tipo] || '';
}

function costoBadge(p) {
    if (p.costo_manual_asignado) {
        return '<span class="badge badge-dorado">💰 manual</span>';
    }
    if (p.requiere_costo_manual) {
        return '<span class="badge badge-rojo">⚠ sin costo</span>';
    }
    return '';
}

function renderConciliacion() {
    if (!conciliacionData) return;
    const c = conciliacionData;
    const k = c.kpis;

    // KPIs
    let kpisHTML = '';
    kpisHTML += kpiCard('Total', k.total, '', '');
    kpisHTML += kpiCard('Diferencia', k.con_diferencia, k.con_diferencia > 0 ? 'rojo' : 'verde', '');
    kpisHTML += kpiCard('Pendientes', k.pendientes_resolver, k.pendientes_resolver > 0 ? 'amarillo' : 'verde', '');
    kpisHTML += kpiCard('Cobertura', (k.cobertura_pct || 0) + '%', '', '');
    if ((k.requieren_costo_manual || 0) > 0) {
        kpisHTML += kpiCard('Sin costo', k.requieren_costo_manual, 'rojo', 'capturar');
    }
    if ((k.con_costo_manual || 0) > 0) {
        kpisHTML += kpiCard('$ manual', k.con_costo_manual, 'dorado', '');
    }
    $('conc-kpis').innerHTML = kpisHTML;

    // Lista
    let partidas = c.partidas.slice();
    if (filtroConc === 'ATENCION') {
        partidas = partidas.filter(p => p.requiere_atencion);
    } else if (filtroConc === 'PENDIENTES') {
        partidas = partidas.filter(p => p.requiere_atencion && !p.resuelto);
    }
    if (busquedaConc) {
        const q = busquedaConc.toLowerCase();
        partidas = partidas.filter(p =>
            (p.descripcion || '').toLowerCase().indexOf(q) !== -1 ||
            String(p.clave).toLowerCase().indexOf(q) !== -1
        );
    }
    // Ordenar: pendientes primero, después por valor descendente
    partidas.sort((a, b) => {
        const aPend = a.requiere_atencion && !a.resuelto;
        const bPend = b.requiere_atencion && !b.resuelto;
        if (aPend !== bPend) return aPend ? -1 : 1;
        return Math.abs(Number(b.valor_diferencia) || 0) - Math.abs(Number(a.valor_diferencia) || 0);
    });

    if (partidas.length === 0) {
        $('conc-lista').innerHTML = '<div class="empty-state">Sin partidas con el filtro aplicado.</div>';
    } else {
        $('conc-lista').innerHTML = partidas.map(p => renderPartida(p)).join('');
    }

    // Botón cerrar
    const btn = $('btn-cerrar-inv');
    if (btn) {
        const bloqueoCosto = (k.requieren_costo_manual || 0) > 0;
        if (k.pendientes_resolver === 0 && !bloqueoCosto) {
            btn.disabled = false;
            btn.textContent = 'Cerrar inventario';
        } else if (bloqueoCosto && k.pendientes_resolver === 0) {
            btn.disabled = true;
            btn.textContent = 'Faltan ' + k.requieren_costo_manual + ' costos';
        } else {
            btn.disabled = true;
            btn.textContent = 'Faltan ' + k.pendientes_resolver + ' por resolver';
        }
    }
}

function renderPartida(p) {
    let clase = 'partida-card';
    if (!p.requiere_atencion) clase += ' ok';
    else if (p.resuelto) clase += ' resuelto';
    else clase += ' dif';

    const fcatBadge = p.es_fuera_catalogo ? '<span class="badge badge-naranja" style="font-size:9px;">FCAT</span> ' : '';
    const estadoBadge = p.requiere_atencion
        ? (p.resuelto ? '<span class="badge badge-verde">RESUELTO</span>' : '<span class="badge badge-rojo">PENDIENTE</span>')
        : '<span class="badge badge-verde">OK</span>';

    const cBadge = costoBadge(p);
    const finalVal = p.cantidad_final !== null
        ? p.cantidad_final
        : (p.cantidad_sugerida !== null ? p.cantidad_sugerida : '—');

    return `
        <div class="${clase}">
            <div class="desc">${fcatBadge}${escapeHtml(p.descripcion)}</div>
            <div class="clave-row">
                <span>Clave ${p.clave}</span>
                <span>·</span>
                <span>${escapeHtml(p.unidad || '?')}</span>
            </div>
            <div class="conteos-grid">
                <div class="conteo-cell soft">
                    <div class="lbl">SOFT</div>
                    <div class="val">${p.existencia_soft}</div>
                </div>
                <div class="conteo-cell">
                    <div class="lbl">G1</div>
                    <div class="val">${p.cantidad_g1 !== null ? p.cantidad_g1 : '—'}</div>
                </div>
                <div class="conteo-cell">
                    <div class="lbl">G2</div>
                    <div class="val">${p.cantidad_g2 !== null ? p.cantidad_g2 : '—'}</div>
                </div>
                <div class="conteo-cell final">
                    <div class="lbl">FINAL</div>
                    <div class="val">${finalVal}</div>
                </div>
            </div>
            <div class="partida-bottom">
                <div class="partida-badges">
                    ${tipoBadge(p.tipo_diferencia)}
                    ${estadoBadge}
                    ${cBadge}
                </div>
                ${p.requiere_atencion ?
                    '<button class="btn-resolver" onclick="abrirResolucion(\'' + p.clave + '\')">' +
                    (p.resuelto ? 'Editar' : 'Resolver') + '</button>'
                : ''}
            </div>
        </div>
    `;
}

function setFiltroConc(filtro) {
    filtroConc = filtro;
    $$('.btn-filtro[data-filtro-conc]').forEach(b => b.classList.toggle('activo', b.dataset.filtroConc === filtro));
    renderConciliacion();
}

function setBusquedaConc(valor) {
    busquedaConc = valor;
    renderConciliacion();
}

// ====================================================
// MODAL RESOLUCIÓN
// ====================================================
let partidaActualResolucion = null;

function abrirResolucion(clave) {
    if (!conciliacionData) return;
    const p = conciliacionData.partidas.find(x => x.clave === clave);
    if (!p) return;

    partidaActualResolucion = p;

    $('res-prod-info').textContent = p.descripcion + ' · Clave ' + p.clave + ' · ' + (p.unidad || '?') +
        ((Number(p.ultimo_costo) || 0) > 0
            ? ' · Costo catálogo: $' + Number(p.ultimo_costo).toFixed(4)
            : ' · ⚠ Catálogo sin precio');

    $('res-soft').textContent = p.existencia_soft;
    $('res-g1').textContent = p.cantidad_g1 !== null ? p.cantidad_g1 : '—';
    $('res-g2').textContent = p.cantidad_g2 !== null ? p.cantidad_g2 : '—';

    // Botones rápidos
    let botones = '';
    if (p.cantidad_g1 !== null) {
        botones += '<button type="button" class="btn-rapido" onclick="document.getElementById(\'res-cant\').value=' + p.cantidad_g1 + ';">G1: ' + p.cantidad_g1 + '</button>';
    }
    if (p.cantidad_g2 !== null) {
        botones += '<button type="button" class="btn-rapido" onclick="document.getElementById(\'res-cant\').value=' + p.cantidad_g2 + ';">G2: ' + p.cantidad_g2 + '</button>';
    }
    botones += '<button type="button" class="btn-rapido" onclick="document.getElementById(\'res-cant\').value=' + p.existencia_soft + ';">Soft: ' + p.existencia_soft + '</button>';
    $('res-botones-rapidos').innerHTML = botones;

    // Cantidad inicial
    const cantInicial = p.cantidad_final !== null ? p.cantidad_final : (p.cantidad_sugerida !== null ? p.cantidad_sugerida : '');
    $('res-cant').value = cantInicial;

    // Comentario
    $('res-com').value = p.comentario_resolucion || '';

    // Campo costo manual condicional
    const necesitaCosto = (Number(p.ultimo_costo) || 0) <= 0.0001;
    const yaTiene = !!p.costo_manual_asignado;
    const cont = $('res-costo-container');

    if (necesitaCosto) {
        const fechaTxt = yaTiene && p.costo_manual_fecha
            ? new Date(p.costo_manual_fecha).toLocaleDateString('es-MX', {day:'2-digit',month:'2-digit',year:'2-digit'})
            : '';
        const labelTxt = yaTiene
            ? '💰 Costo unitario asignado (MXN)'
            : '⚠ Costo unitario (MXN) requerido';
        const helpTxt = yaTiene
            ? 'Asignado por <strong>' + escapeHtml(p.costo_manual_usuario || '?') + '</strong> el ' + fechaTxt + '. Editable.'
            : 'Catálogo Soft sin precio. Captura el valor unitario para valorar la diferencia. <strong>NO actualiza catálogo Soft</strong>; queda solo aquí para auditoría.';

        cont.innerHTML = `
            <div class="campo-costo-manual ${yaTiene ? 'asignado' : ''}">
                <label>${labelTxt}</label>
                <input type="number" id="res-costo" inputmode="decimal" step="any" min="0.01" placeholder="Ej: 25.50"
                       value="${yaTiene ? p.costo_manual_unitario : ''}">
                <div class="help">${helpTxt}</div>
            </div>
        `;
    } else {
        cont.innerHTML = '';
    }

    hideAlert('alerta-res');
    $('modal-resolucion').classList.add('visible');
    setTimeout(() => $('res-cant').focus(), 100);
}

function cerrarModalResolucion() {
    $('modal-resolucion').classList.remove('visible');
    partidaActualResolucion = null;
}

async function guardarResolucionMovil() {
    const p = partidaActualResolucion;
    if (!p) return;

    const cantStr = $('res-cant').value.trim();
    const com = $('res-com').value.trim();

    if (cantStr === '' || isNaN(Number(cantStr)) || Number(cantStr) < 0) {
        showAlert('alerta-res', 'Cantidad inválida.', 'error');
        return;
    }
    if (!com || com.length < 10) {
        showAlert('alerta-res', 'Comentario mín. 10 caracteres (lleva ' + com.length + ').', 'error');
        return;
    }

    const cant = Number(cantStr);
    const necesitaCosto = (Number(p.ultimo_costo) || 0) <= 0.0001;
    const hayDiferencia = Math.abs(cant - (Number(p.existencia_soft) || 0)) > 0.001;
    let costoNuevo = null;

    if (necesitaCosto && hayDiferencia) {
        const costoEl = $('res-costo');
        if (!costoEl) {
            showAlert('alerta-res', 'Falta campo de costo. Recarga.', 'error');
            return;
        }
        const costoStr = costoEl.value.trim();
        if (costoStr === '' || isNaN(Number(costoStr)) || Number(costoStr) <= 0) {
            showAlert('alerta-res', 'Captura un costo unitario mayor a $0.', 'error');
            return;
        }
        if (Number(costoStr) > 1000000) {
            showAlert('alerta-res', 'Costo fuera de rango razonable.', 'error');
            return;
        }
        costoNuevo = Number(costoStr);
    }

    const cambioCosto = costoNuevo !== null &&
        (!p.costo_manual_asignado ||
         Math.abs(costoNuevo - (Number(p.costo_manual_unitario) || 0)) > 0.0001);

    const btn = $('res-guardar');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>Guardando...';

    try {
        if (cambioCosto) {
            const r1 = await apiAsignarCostoManual(sesionActual.token, folioConc, p.clave, costoNuevo, '');
            if (!r1.ok) {
                showAlert('alerta-res', 'Error costo: ' + (r1.mensaje || r1.error), 'error');
                return;
            }
        }

        const r2 = await apiGuardarResolucion(sesionActual.token, folioConc, p.clave, cant, com);
        if (!r2.ok) {
            showAlert('alerta-res', r2.mensaje || r2.error, 'error');
            return;
        }

        cerrarModalResolucion();
        await cargarConciliacion();
    } catch (e) {
        showAlert('alerta-res', 'Error de red: ' + e.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Guardar';
    }
}

// ====================================================
// CERRAR INVENTARIO
// ====================================================
async function cerrarInventario() {
    if (!confirm('¿Confirmas el cierre de la sesión?\n\nUna vez cerrada NO se puede reabrir.')) return;

    const btn = $('btn-cerrar-inv');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>Cerrando...';

    try {
        const r = await apiCerrarInventario(sesionActual.token, folioConc);
        if (!r.ok) {
            alert('Error: ' + (r.mensaje || r.error));
            btn.disabled = false;
            btn.textContent = 'Cerrar inventario';
            return;
        }
        const valor = (r.valor_diferencia || 0).toLocaleString('es-MX', {minimumFractionDigits:2,maximumFractionDigits:2});
        alert('✅ Sesión cerrada.\n\nDiferencias: ' + r.productos_diferencia + '\nValor neto: $ ' + valor +
              '\n\nEl reporte está disponible en PEPS web.');
        volverDeConciliacion();
    } catch (e) {
        alert('Error de red: ' + e.message);
        btn.disabled = false;
        btn.textContent = 'Cerrar inventario';
    }
}

// ====================================================
// INICIO
// ====================================================
async function inicio() {
    actualizarConexion();

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(()=>{});
    }

    const guardado = localStorage.getItem(STORAGE_KEY);
    if (!guardado) {
        mostrarVista('vista-login');
        return;
    }

    try {
        sesionActual = JSON.parse(guardado);
    } catch (e) {
        localStorage.removeItem(STORAGE_KEY);
        mostrarVista('vista-login');
        return;
    }

    if (!navigator.onLine) {
        const bor = cargarBorrador();
        if (bor && bor.folio && bor.grupo) {
            folioActivo = bor.folio;
            grupoActivo = bor.grupo;
            productos = bor.productos;
            conteosLocales = bor.conteos;
            $('cap-folio').textContent = folioActivo;
            $('cap-almacen').textContent = '(offline)';
            $('cap-grupo').textContent = grupoActivo;
            $('btn-logout-header').style.display = 'inline-block';
            mostrarVista('vista-captura');
            renderProductos();
        } else {
            mostrarVista('vista-login');
        }
        return;
    }

    try {
        const r = await apiValidarSesion(sesionActual.token);
        if (r.ok) {
            sesionActual.expira = r.data.expira;
            localStorage.setItem(STORAGE_KEY, JSON.stringify(sesionActual));

            const bor = cargarBorrador();
            if (bor && bor.folio && bor.grupo) {
                folioActivo = bor.folio;
                grupoActivo = bor.grupo;
                productos = bor.productos;
                conteosLocales = bor.conteos;
                $('cap-folio').textContent = folioActivo;
                $('cap-almacen').textContent = '(restaurado)';
                $('cap-grupo').textContent = grupoActivo;
                $('btn-logout-header').style.display = 'inline-block';
                mostrarVista('vista-captura');
                renderProductos();
                procesarColaSync();
            } else {
                await irASesiones();
            }
        } else {
            localStorage.removeItem(STORAGE_KEY);
            sesionActual = null;
            mostrarVista('vista-login');
        }
    } catch (e) {
        const bor = cargarBorrador();
        if (bor && bor.folio) {
            folioActivo = bor.folio;
            grupoActivo = bor.grupo;
            productos = bor.productos;
            conteosLocales = bor.conteos;
            $('cap-folio').textContent = folioActivo;
            $('cap-almacen').textContent = '(offline)';
            $('cap-grupo').textContent = grupoActivo;
            $('btn-logout-header').style.display = 'inline-block';
            mostrarVista('vista-captura');
            renderProductos();
        } else {
            mostrarVista('vista-login');
        }
    }
}

// ====================================================
// SETUP
// ====================================================
function setupApp() {
    if (window.__fgInit) return;
    window.__fgInit = true;

    // Login
    $('btn-login').addEventListener('click', hacerLogin);
    $('password').addEventListener('keydown', e => {
        if (e.key === 'Enter') hacerLogin();
    });

    // Logout
    $('btn-logout-header').addEventListener('click', hacerLogout);

    // Captura
    $('btn-volver-sesiones').addEventListener('click', volverASesiones);
    $('input-busqueda').addEventListener('input', e => setBusqueda(e.target.value));
    $$('.btn-filtro[data-filtro]').forEach(b => {
        b.addEventListener('click', () => setFiltro(b.dataset.filtro));
    });
    $('btn-fcat').addEventListener('click', abrirFCat);
    $('btn-finalizar').addEventListener('click', finalizarMiGrupo);

    // Modal captura
    $('modal-cap-cancelar').addEventListener('click', cerrarModalCaptura);
    $('modal-cap-guardar').addEventListener('click', guardarCaptura);

    // Modal FCAT
    $('fcat-cancelar').addEventListener('click', cerrarFCat);
    $('fcat-guardar').addEventListener('click', guardarFCat);

    // Conciliación
    $('btn-volver-conc').addEventListener('click', volverDeConciliacion);
    $('conc-busq').addEventListener('input', e => setBusquedaConc(e.target.value));
    $$('.btn-filtro[data-filtro-conc]').forEach(b => {
        b.addEventListener('click', () => setFiltroConc(b.dataset.filtroConc));
    });
    $('btn-cerrar-inv').addEventListener('click', cerrarInventario);

    // Modal resolución
    $('res-cancelar').addEventListener('click', cerrarModalResolucion);
    $('res-guardar').addEventListener('click', guardarResolucionMovil);

    inicio();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupApp);
} else {
    setupApp();
}

// Hacer accesibles las funciones inline (onclick="...")
window.abrirCaptura = abrirCaptura;
window.abrirResolucion = abrirResolucion;
