'use strict';

/* ───────── Rutas por rol ───────── */
const rutasUsuario = {
  inicio:   { titulo: 'Inicio',           fn: renderInicio },
  reservar: { titulo: 'Reservar cita',    fn: renderReservar },
  citas:    { titulo: 'Mis citas',        fn: renderMisCitas }
};

const rutasAdmin = {
  resumen:   { titulo: 'Resumen',            fn: renderResumen },
  citas:     { titulo: 'Citas',              fn: renderCitasAdmin },
  validar:   { titulo: 'Validar QR',         fn: renderValidar },
  cortes:    { titulo: 'Cortes y precios',   fn: renderCortes },
  locales:   { titulo: 'Locales',            fn: renderLocales },
  barberos:  { titulo: 'Barberos y horarios', fn: renderBarberos },
  clientes:  { titulo: 'Clientes',           fn: renderClientes },
  usuarios:  { titulo: 'Usuarios',           fn: renderUsuarios },
  pagos:     { titulo: 'Formas de pago',     fn: renderMetodos },
  chat:      { titulo: 'Chat con clientes',  fn: renderChatAdmin },
  config:    { titulo: 'Configuración',      fn: renderConfig }
};

const esAdmin = () => state.me && state.me.rol === 'Admin';

/* ───────── Pantalla de acceso ───────── */
async function renderAuth() {
  let info = { negocio: 'Barbería', descuentoPremiumPct: 0 };
  try { info = await api('/info'); } catch { /* usar valores por defecto */ }
  document.title = info.negocio;

  $('#app').innerHTML = `
    <div class="auth">
      <section class="auth-hero">
        <h1>${esc(info.negocio)}</h1>
        <p>Reserve su cita sin llamadas ni esperas.</p>
        <ul class="perks">
          <li>Elija local, barbero, corte y horario</li>
          <li>Ticket en PDF con código QR</li>
          <li>Chat de ayuda en tiempo real con el encargado</li>
          ${info.descuentoPremiumPct > 0 ? `<li>${info.descuentoPremiumPct}% de descuento para clientes premium</li>` : ''}
        </ul>
      </section>
      <section class="auth-box">
        <div class="auth-card">
          <div class="tabs" role="tablist">
            <button class="active" data-tab="login" role="tab">Iniciar sesión</button>
            <button data-tab="registro" role="tab">Crear cuenta</button>
          </div>
          <p class="form-error" id="auth-error" hidden></p>

          <form id="form-login" autocomplete="on">
            ${field('Correo electrónico', '<input name="email" type="email" required autocomplete="username">')}
            ${field('Contraseña', '<input name="password" type="password" required autocomplete="current-password">')}
            <button class="btn primary" style="width:100%" type="submit">Entrar</button>
          </form>

          <form id="form-registro" autocomplete="on" hidden>
            ${field('Nombre completo', '<input name="nombre" required maxlength="80" autocomplete="name">')}
            ${field('Correo electrónico', '<input name="email" type="email" required autocomplete="email">')}
            ${field('Teléfono (opcional)', '<input name="telefono" maxlength="30" autocomplete="tel">')}
            ${field('Contraseña', '<input name="password" type="password" required minlength="8" autocomplete="new-password">', 'Mínimo 8 caracteres.')}
            <button class="btn primary" style="width:100%" type="submit">Crear mi cuenta</button>
          </form>
        </div>
      </section>
    </div>`;

  const err = $('#auth-error');
  $$('.tabs button').forEach(b => (b.onclick = () => {
    $$('.tabs button').forEach(x => x.classList.toggle('active', x === b));
    $('#form-login').hidden = b.dataset.tab !== 'login';
    $('#form-registro').hidden = b.dataset.tab !== 'registro';
    err.hidden = true;
  }));

  const enviar = (formId, ruta) => {
    $(formId).onsubmit = async e => {
      e.preventDefault();
      err.hidden = true;
      const btn = $('button[type=submit]', e.target);
      btn.disabled = true;
      try {
        state.me = await api(ruta, 'POST', Object.fromEntries(new FormData(e.target)));
        await iniciarApp();
      } catch (ex) {
        err.textContent = ex.message; err.hidden = false;
      } finally { btn.disabled = false; }
    };
  };
  enviar('#form-login', '/auth/login');
  enviar('#form-registro', '/auth/registro');
}

/* ───────── Estructura por rol ───────── */
function shellUsuario() {
  const m = state.me;
  $('#app').innerHTML = `
    <header class="topnav">
      <a class="brand" href="#/inicio">${esc(state.negocio)}</a>
      <nav id="menu">
        <a href="#/inicio" data-r="inicio">Inicio</a>
        <a href="#/reservar" data-r="reservar">Reservar cita</a>
        <a href="#/citas" data-r="citas">Mis citas</a>
      </nav>
      <div class="who">
        ${m.premium ? `<span class="tag premium">Premium${m.descuentoPct ? ' · −' + m.descuentoPct + '%' : ''}</span>` : ''}
        <span>${esc(m.nombre)}</span>
        <button class="btn ghost small" id="salir" style="color:#fff;border-color:#4A5878">Salir</button>
      </div>
    </header>
    <main class="view" id="view"></main>`;
  montarChatCliente();
}

function shellAdmin() {
  const m = state.me;
  const item = (r, txt, extra = '') => `<a href="#/${r}" data-r="${r}">${txt}${extra}</a>`;
  $('#app').innerHTML = `
    <div class="admin-shell">
      <aside class="side" id="side">
        <a class="brand" href="#/resumen">${esc(state.negocio)}</a>
        <small>Panel de administración</small>
        <nav id="menu">
          ${item('resumen', 'Resumen')}
          ${item('citas', 'Citas')}
          ${item('validar', 'Validar QR')}
          ${item('cortes', 'Cortes y precios')}
          ${item('locales', 'Locales')}
          ${item('barberos', 'Barberos y horarios')}
          ${item('clientes', 'Clientes')}
          ${item('usuarios', 'Usuarios')}
          ${item('pagos', 'Formas de pago')}
          ${item('chat', 'Chat con clientes', '<span class="dot" id="badge-chat" hidden>0</span>')}
          ${item('config', 'Configuración')}
        </nav>
        <div class="who"><span>${esc(m.nombre)}</span><button class="btn ghost small" id="salir" style="color:#fff;border-color:#4A5878">Salir</button></div>
      </aside>
      <div class="admin-main">
        <header class="admin-top">
          <button class="burger" id="burger" aria-label="Abrir menú">☰</button>
          <h1 id="title"></h1>
          <div class="actions" id="top-actions"></div>
        </header>
        <main class="view" id="view"></main>
      </div>
    </div>`;
  $('#burger').onclick = () => $('#side').classList.toggle('open');
  montarChatAdminGlobal();
}

/* ───────── Enrutador ───────── */
async function navigate() {
  if (!state.me) return;
  const rutas = esAdmin() ? rutasAdmin : rutasUsuario;
  const defecto = esAdmin() ? 'resumen' : 'inicio';
  const nombre = rutas[location.hash.replace('#/', '')] ? location.hash.replace('#/', '') : defecto;
  const ruta = rutas[nombre];

  $$('#menu a').forEach(a => a.classList.toggle('active', a.dataset.r === nombre));
  if (state.limpiar) { state.limpiar(); state.limpiar = null; }
  state.viewChat = null;

  view = $('#view');
  view.onclick = null; view.onchange = null;
  view.innerHTML = '<p class="empty">Cargando…</p>';
  if (esAdmin()) {
    $('#title').textContent = ruta.titulo;
    $('#top-actions').innerHTML = '';
    $('#side').classList.remove('open');
  }
  window.scrollTo(0, 0);

  try {
    await ruta.fn();
  } catch (e) {
    view.innerHTML = `<div class="card empty">No se pudo cargar la información. ${esc(e.message)}</div>`;
  }
}

async function iniciarApp() {
  try { state.negocio = (await api('/info')).negocio; } catch { state.negocio = 'Barbería'; }
  document.title = state.negocio;

  if (esAdmin()) shellAdmin(); else shellUsuario();

  $('#salir').onclick = async () => {
    try { await api('/auth/logout', 'POST'); } finally { location.hash = ''; location.reload(); }
  };

  conectarChat();                       // sin await: la interfaz no espera al chat
  navigate();
}

window.addEventListener('hashchange', navigate);

/* ───────── Arranque ───────── */
(async () => {
  try {
    state.me = await api('/auth/me');
    await iniciarApp();
  } catch {
    state.me = null;
    await renderAuth();
  }
})();
