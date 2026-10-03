'use strict';

/* ───────── Conexión SignalR compartida ───────── */
let hub = null;
let chatEstado = 'conectando';           // conectando | conectado | desconectado
let onChatEstado = null;                  // callback para refrescar el indicador
let onMensajeGlobal = null;               // callback global (contadores, widget)

function setChatEstado(e) {
  chatEstado = e;
  if (onChatEstado) onChatEstado(e);
}

async function conectarChat() {
  if (hub) return;
  hub = new signalR.HubConnectionBuilder()
    .withUrl('/hubs/chat')
    .withAutomaticReconnect()
    .build();

  hub.on('mensaje', m => {
    if (onMensajeGlobal) onMensajeGlobal(m);
    if (state.viewChat) state.viewChat(m);
  });
  hub.onreconnecting(() => setChatEstado('conectando'));
  hub.onreconnected(() => setChatEstado('conectado'));
  hub.onclose(() => setChatEstado('desconectado'));

  try {
    await hub.start();
    setChatEstado('conectado');
  } catch {
    setChatEstado('desconectado');
  }
}

async function desconectarChat() {
  if (hub) { try { await hub.stop(); } catch { /* ignorar */ } }
  hub = null;
}

const hubMsg = err => (err && err.message ? err.message.replace(/^.*HubException:\s*/, '') : 'No se pudo enviar el mensaje.');

const estadoTexto = { conectando: 'Conectando…', conectado: 'En línea', desconectado: 'Sin conexión' };

function burbuja(m, esMio) {
  return `<div class="msg ${esMio ? 'mine' : ''}">${esc(m.texto)}<small>${esc(m.emisor)} · ${ftime(m.fecha)}</small></div>`;
}

function scrollAbajo(el) { el.scrollTop = el.scrollHeight; }

/* ───────── Widget flotante del cliente ───────── */
function montarChatCliente() {
  const cont = document.createElement('div');
  cont.id = 'chat-widget';
  cont.innerHTML = `
    <button class="chat-fab" id="chat-open" aria-label="Abrir chat de ayuda">Chat de ayuda<span class="dot" id="chat-dot" hidden>0</span></button>
    <section class="chat-panel" id="chat-panel" hidden aria-label="Chat de ayuda">
      <div class="chat-head">
        <div><h3>Chat de ayuda</h3><span class="chat-status" id="chat-status"></span></div>
        <button id="chat-close" aria-label="Cerrar chat">×</button>
      </div>
      <div class="thread" id="chat-thread"></div>
      <form class="chat-form" id="chat-form" autocomplete="off">
        <input id="chat-input" maxlength="1000" placeholder="Escriba su mensaje al encargado">
        <button class="btn primary" type="submit">Enviar</button>
      </form>
    </section>`;
  document.body.appendChild(cont);

  const panel = $('#chat-panel'), fab = $('#chat-open'), thread = $('#chat-thread'), dot = $('#chat-dot');
  let noLeidos = 0, cargado = false;

  const pintarEstado = () => { $('#chat-status').textContent = estadoTexto[chatEstado]; };
  onChatEstado = pintarEstado;
  pintarEstado();

  async function abrir() {
    panel.hidden = false; fab.hidden = true;
    noLeidos = 0; dot.hidden = true;
    if (!cargado) {
      const hist = await api('/chat');
      thread.innerHTML = hist.length
        ? hist.map(m => burbuja(m, !m.deAdmin)).join('')
        : '<p class="empty">Escriba su duda y el encargado le responderá por aquí.</p>';
      cargado = true;
    }
    scrollAbajo(thread);
    $('#chat-input').focus();
  }

  fab.onclick = () => abrir().catch(e => toast(e.message));
  $('#chat-close').onclick = () => { panel.hidden = true; fab.hidden = false; };

  onMensajeGlobal = m => {
    if (cargado) {
      if (thread.querySelector('.empty')) thread.innerHTML = '';
      thread.insertAdjacentHTML('beforeend', burbuja(m, !m.deAdmin));
      scrollAbajo(thread);
    }
    if (panel.hidden && m.deAdmin) {
      noLeidos++; dot.textContent = noLeidos; dot.hidden = false;
    }
  };

  $('#chat-form').onsubmit = async e => {
    e.preventDefault();
    const input = $('#chat-input');
    const texto = input.value.trim();
    if (!texto) return;
    if (!hub || chatEstado !== 'conectado') return toast('Sin conexión con el chat. Intente de nuevo en un momento.');
    try {
      await hub.invoke('Enviar', texto);
      input.value = '';
    } catch (err) { toast(hubMsg(err)); }
  };
}

function desmontarChatCliente() {
  $('#chat-widget')?.remove();
  onChatEstado = null; onMensajeGlobal = null;
}

/* ───────── Bandeja del administrador ───────── */
async function renderChatAdmin() {
  const [convs, clientes] = await Promise.all([api('/admin/chat/conversaciones'), api('/admin/chat/clientes')]);
  const noLeidos = new Set();
  let actual = null;

  state.chatNoLeidos = 0;
  actualizarBadgeChat();

  view.innerHTML = `
    <div class="inbox">
      <div class="inbox-list" id="inbox-list"></div>
      <div class="inbox-thread">
        <div class="head" id="inbox-head">Seleccione una conversación</div>
        <div class="thread" id="inbox-thread"><p class="empty">Aquí verá los mensajes de sus clientes.</p></div>
        <form class="chat-form" id="inbox-form" autocomplete="off">
          <input id="inbox-input" maxlength="1000" placeholder="Escriba una respuesta" disabled>
          <button class="btn primary" type="submit" disabled>Enviar</button>
        </form>
      </div>
    </div>
    <p class="muted" id="inbox-estado" style="margin-top:8px"></p>`;

  const lista = $('#inbox-list'), thread = $('#inbox-thread');
  const pintarEstado = () => { $('#inbox-estado').textContent = 'Chat: ' + estadoTexto[chatEstado]; };
  onChatEstado = pintarEstado; pintarEstado();

  const pintarLista = () => {
    lista.innerHTML = convs.map(c => `
      <button data-id="${c.clienteId}" class="${c.clienteId === actual ? 'sel' : ''}">
        <strong>${esc(c.cliente)}</strong> ${c.premium ? '<span class="tag premium">Premium</span>' : ''}
        ${noLeidos.has(c.clienteId) ? '<span class="dot">nuevo</span>' : ''}
        <small>${c.ultimoDeAdmin ? 'Usted: ' : ''}${esc(c.ultimoTexto)}</small>
      </button>`).join('') || '<p class="empty">Aún no hay conversaciones.</p>';
  };
  pintarLista();

  async function abrirConv(id) {
    actual = id; noLeidos.delete(id); actualizarBadgeChat();
    const hist = await api('/admin/chat/' + id);
    const c = convs.find(x => x.clienteId === id);
    $('#inbox-head').textContent = c ? c.cliente : 'Cliente';
    thread.innerHTML = hist.map(m => burbuja(m, m.deAdmin)).join('') || '<p class="empty">Sin mensajes.</p>';
    scrollAbajo(thread);
    $('#inbox-input').disabled = false; $('#inbox-form button').disabled = false;
    $('#inbox-input').focus();
    pintarLista();
  }

  lista.onclick = e => {
    const b = e.target.closest('button[data-id]');
    if (b) abrirConv(+b.dataset.id).catch(err => toast(err.message));
  };

  state.viewChat = m => {
    let c = convs.find(x => x.clienteId === m.clienteId);
    if (!c) {
      const cli = clientes.find(x => x.id === m.clienteId);
      c = { clienteId: m.clienteId, cliente: cli ? cli.nombre : m.emisor, premium: false };
      convs.unshift(c);
    }
    c.ultimoTexto = m.texto; c.ultimaFecha = m.fecha; c.ultimoDeAdmin = m.deAdmin;
    convs.sort((a, b) => new Date(b.ultimaFecha) - new Date(a.ultimaFecha));

    if (m.clienteId === actual) {
      thread.querySelector('.empty')?.remove();
      thread.insertAdjacentHTML('beforeend', burbuja(m, m.deAdmin));
      scrollAbajo(thread);
    } else if (!m.deAdmin) {
      noLeidos.add(m.clienteId);
    }
    pintarLista();
  };

  $('#inbox-form').onsubmit = async e => {
    e.preventDefault();
    const input = $('#inbox-input');
    const texto = input.value.trim();
    if (!texto || actual === null) return;
    if (!hub || chatEstado !== 'conectado') return toast('Sin conexión con el chat. Intente de nuevo en un momento.');
    try {
      await hub.invoke('Responder', actual, texto);
      input.value = '';
    } catch (err) { toast(hubMsg(err)); }
  };
}

/* Contador global de mensajes nuevos para el menú del admin */
function actualizarBadgeChat() {
  const b = $('#badge-chat');
  if (!b) return;
  b.textContent = state.chatNoLeidos;
  b.hidden = state.chatNoLeidos === 0;
}

function montarChatAdminGlobal() {
  onMensajeGlobal = m => {
    // Si el admin está en la bandeja el mensaje ya se maneja ahí; fuera de ella suma al contador.
    if (!m.deAdmin && !state.viewChat) {
      state.chatNoLeidos++;
      actualizarBadgeChat();
    }
  };
}
