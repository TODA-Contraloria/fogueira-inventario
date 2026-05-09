// ====================================================
// FOGUEIRA PWA - Lógica principal
// ----------------------------------------------------
// Orquesta el flujo: login → sesiones → captura → fin
// ====================================================

const STORAGE_KEY = 'fogueira_pwa_sesion';
const STORAGE_BORRADOR = 'fogueira_pwa_borrador';
const STORAGE_COLA = 'fogueira_pwa_cola_sync';

// ====================================================
// ESTADO GLOBAL
// ====================================================
let sesionActual = null;        // {token, usuario, nombre, rol, expira}
let folioActivo = null;          // INV-XXXXX-XXX
let grupoActivo = null;          // 'G1' | 'G2'
let productos = [];              // Array de todos los productos a contar
let conteosLocales = {};         // {clave: {cantidad, observacion, sincronizado, timestamp}}
let busquedaTexto = '';
let filtroActual = 'TODOS';      // TODOS | PENDIENTES | CAPTURADOS | PRIORITARIOS

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
    ['vista-login', 'vista-sesiones', 'vista-captura'].forEach(v => hide(v));
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
        
        const activas = (r.sesiones || []).filter(s => 
            s.estatus === 'ABIERTA' || s.estatus === 'EN_PROGRESO'
        );
        
        if (activas.length === 0) {
            lista.innerHTML = '<div class="empty-state">No hay sesiones activas para contar.</div>';
            return;
        }
        
        const grupo = obtenerGrupoDelRol(sesionActual.rol);
        lista.innerHTML = activas.map(s => renderSesion(s, grupo)).join('');
        
        $$('.tarjeta-sesion').forEach(t => {
            t.addEventListener('click', () => entrarASesion(t.dataset.folio));
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
    
    return `
        <div class="tarjeta-sesion" data-folio="${s.folio}">
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
        </div>
    `;
}

// ====================================================
// ENTRAR A SESIÓN
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
        // Asignar grupo (idempotente: si ya estás, no falla)
        const rAsig = await apiAsignarGrupo(sesionActual.token, folio, grupo);
        if (!rAsig.ok) {
            alert('No se pudo entrar:\n' + (rAsig.mensaje || rAsig.error));
            await cargarSesiones();
            return;
        }
        
        // Cargar productos
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
        
        // Combinar priorizados + otros + fuera_catalogo
        (rProd.priorizados || []).forEach(p => productos.push({...p, prioritario: true}));
        (rProd.otros || []).forEach(p => productos.push({...p, prioritario: false}));
        (rProd.fuera_catalogo || []).forEach(p => productos.push({...p, prioritario: false, es_fuera_catalogo: true}));
        
        // Hidratar conteosLocales con los ya capturados desde servidor
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
        
        // Guardar borrador para offline
        guardarBorrador();
        
        // Cargar info de sesión en header de captura
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
    
    // Filtrar
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
    
    // Ordenar: prioritarios primero, después alfabético
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
        
        const cantidad = c ? c.cantidad : '';
        
        return `
            return `
    <div class="${claseFila}" data-clave="${p.clave}">
        <div class="prod-info" onclick="abrirCaptura('${p.clave}')">
            <div class="prod-desc">${badgePri}${badgeFcat}${escapeHtml(p.descripcion)}${p.unidad ? ' · ' + escapeHtml(p.unidad) : ''}</div>
            <div class="prod-meta">
                <span class="prod-clave">${p.clave}</span>
                ${p.grupo_producto ? `<span class="prod-grupo">${escapeHtml(p.grupo_producto)}</span>` : ''}
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

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
    
    // Guardar en local inmediatamente
    conteosLocales[clave] = {
        cantidad: cantidad,
        observacion: observacion,
        sincronizado: false,
        timestamp: Date.now()
    };
    guardarBorrador();
    
    cerrarModalCaptura();
    renderProductos();
    
    // Encolar para sync
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
        
        // Agregar al array de productos
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
    // Eliminar versiones anteriores del mismo conteo (última gana)
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
                    // Error específico → mantener en cola
                    nuevaCola.push(item);
                }
            }
        } catch (e) {
            // Error de red → mantener en cola
            nuevaCola.push(item);
        }
    }
    
    escribirCola(nuevaCola);
    guardarBorrador();
    renderProductos();
    sincronizando = false;
}

// Cada 15s intenta sincronizar
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
// FILTROS Y BÚSQUEDA
// ====================================================
function setBusqueda(valor) {
    busquedaTexto = valor;
    renderProductos();
}
function setFiltro(filtro) {
    filtroActual = filtro;
    $$('.btn-filtro').forEach(b => b.classList.toggle('activo', b.dataset.filtro === filtro));
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

// ====================================================
// INICIO
// ====================================================
async function inicio() {
    actualizarConexion();
    
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(()=>{});
    }
    
    // Restaurar sesión
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
        // Restaurar borrador si hay
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
    
    // Validar contra servidor
    try {
        const r = await apiValidarSesion(sesionActual.token);
        if (r.ok) {
            sesionActual.expira = r.data.expira;
            localStorage.setItem(STORAGE_KEY, JSON.stringify(sesionActual));
            
            // Si hay borrador activo, restaurarlo
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
        // Sin red durante validación → usar borrador si existe
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

// Eventos al cargar
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
    $$('.btn-filtro').forEach(b => {
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
    
    inicio();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupApp);
} else {
    setupApp();
}

// Hacer accesibles las funciones inline (onclick="...")
window.abrirCaptura = abrirCaptura;
