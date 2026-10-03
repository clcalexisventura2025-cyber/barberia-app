'use strict';

/* ───────── Utilidades ───────── */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const money = n => new Intl.NumberFormat('es-SV', { style: 'currency', currency: 'USD' }).format(n || 0);
const fdate = d => new Date(d).toLocaleDateString('es-SV', { weekday: 'long', day: 'numeric', month: 'long' });
const fdateShort = d => new Date(d).toLocaleDateString('es-SV');
const ftime = d => new Date(d).toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' });
const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const hoyISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/* Estado global de la sesión */
const state = { me: null, viewChat: null, chatNoLeidos: 0 };
let view = null;                         // contenedor de la vista actual (#view)

async function api(path, method = 'GET', body) {
  const r = await fetch('/api' + path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  if (r.status === 401 && !path.startsWith('/auth/')) {
    location.reload();                       // sesión vencida: volver al acceso
    throw new Error('Su sesión expiró. Inicie sesión de nuevo.');
  }
  if (!r.ok) {
    let msg = 'Ocurrió un error. Intente de nuevo.';
    try { const j = await r.json(); msg = j.error || j.title || msg; } catch { /* sin cuerpo */ }
    throw new Error(msg);
  }
  if (r.status === 204) return null;
  return (r.headers.get('content-type') || '').includes('json') ? r.json() : null;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 2800);
}

/* ───────── Modal reutilizable ───────── */
const modal = $('#modal');
let onModalSubmit = null;

function openModal(title, bodyHtml, submit, okText = 'Guardar') {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = bodyHtml;
  $('#modal-ok').textContent = okText;
  $('#modal-error').hidden = true;
  onModalSubmit = submit;
  modal.showModal();
  const first = $('#modal-body input:not([type=hidden]):not([type=file]), #modal-body select, #modal-body textarea');
  if (first) first.focus();
}

function modalError(msg) {
  const box = $('#modal-error');
  box.textContent = msg; box.hidden = false;
}

$('#modal-cancel').onclick = () => modal.close();
$('#modal-form').onsubmit = async e => {
  e.preventDefault();
  const ok = $('#modal-ok');
  ok.disabled = true;
  try {
    await onModalSubmit(e.target);
    modal.close();
  } catch (err) {
    modalError(err.message);
  } finally {
    ok.disabled = false;
  }
};

const field = (label, input, help = '') =>
  `<div class="field"><label>${label}</label>${input}${help ? `<small>${help}</small>` : ''}</div>`;

const optionsHtml = (items, sel) =>
  items.map(i => `<option value="${esc(i.value)}" ${String(i.value) === String(sel) ? 'selected' : ''}>${esc(i.label)}</option>`).join('');

const photoStyle = url => (url ? `style="background-image:url('${esc(url)}')"` : '');
