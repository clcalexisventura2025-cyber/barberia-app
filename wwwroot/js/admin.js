'use strict';

function topButton(text, fn) {
  const b = document.createElement('button');
  b.className = 'btn primary'; b.textContent = text; b.onclick = fn;
  $('#top-actions').appendChild(b);
}

const estadoActivo = (a, si = 'Activo', no = 'Inactivo') =>
  `<span class="tag ${a ? 'ok' : 'neutral'}">${a ? si : no}</span>`;

/* ───────── Resumen ───────── */
async function renderResumen() {
  const r = await api('/admin/resumen');
  view.innerHTML = `
    <div class="kpis">
      <div class="card kpi"><small>Citas de hoy</small><strong>${r.citasHoy}</strong></div>
      <div class="card kpi"><small>Atendidas hoy</small><strong>${r.atendidasHoy}</strong></div>
      <div class="card kpi brass"><small>Monto atendido hoy</small><strong>${money(r.montoAtendidoHoy)}</strong></div>
      <div class="card kpi red"><small>Citas por venir</small><strong>${r.proximas}</strong></div>
      <div class="card kpi"><small>Clientes</small><strong>${r.clientes}</strong></div>
      <div class="card kpi brass"><small>Clientes premium</small><strong>${r.premium}</strong></div>
    </div>
    <div class="card">
      <h3>Agenda de hoy</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>Hora</th><th>Cliente</th><th>Barbero</th><th>Corte</th><th>Local</th><th>Estado</th></tr></thead>
        <tbody>${r.agendaHoy.map(c => `
          <tr><td>${ftime(c.inicio)}</td>
          <td>${esc(c.cliente)} ${c.premium ? '<span class="tag premium">Premium</span>' : ''}</td>
          <td>${esc(c.barbero)}</td><td>${esc(c.corte)}</td><td>${esc(c.local)}</td>
          <td><span class="tag ${estadoTag(c.estado)}">${c.estado}</span></td></tr>`).join('')
          || '<tr><td colspan="6" class="empty">No hay citas para hoy.</td></tr>'}
        </tbody></table></div>
    </div>`;
}

/* ───────── Citas ───────── */
async function renderCitasAdmin() {
  const locales = await api('/admin/locales');
  view.innerHTML = `
    <div class="card">
      <div class="toolbar">
        <div><label class="muted">Fecha</label><input type="date" id="f-fecha" value="${hoyISO()}"></div>
        <div><label class="muted">Local</label><select id="f-local"><option value="">Todos</option>${optionsHtml(locales.map(l => ({ value: l.id, label: l.nombre })))}</select></div>
        <div><label class="muted">Estado</label><select id="f-estado"><option value="">Todos</option><option>Reservada</option><option>Atendida</option><option>Cancelada</option></select></div>
        <button class="btn ghost" id="f-todas">Ver todas las fechas</button>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Fecha y hora</th><th>Cliente</th><th>Local</th><th>Barbero</th><th>Corte</th><th>Pago</th><th class="num">Total</th><th>Estado</th><th></th></tr></thead>
        <tbody id="citas-rows"></tbody>
      </table></div>
    </div>`;

  async function cargar() {
    const q = new URLSearchParams();
    if ($('#f-fecha').value) q.set('fecha', $('#f-fecha').value);
    if ($('#f-local').value) q.set('localId', $('#f-local').value);
    if ($('#f-estado').value) q.set('estado', $('#f-estado').value);
    const lista = await api('/admin/citas?' + q);
    $('#citas-rows').innerHTML = lista.map(c => `
      <tr>
        <td>${fdateShort(c.inicio)} ${ftime(c.inicio)}</td>
        <td>${esc(c.cliente)} ${c.premium ? '<span class="tag premium">Premium</span>' : ''}<div class="muted">${esc(c.telefono || '')}</div></td>
        <td>${esc(c.local)}</td><td>${esc(c.barbero)}</td><td>${esc(c.corte)}</td><td>${esc(c.metodo)}</td>
        <td class="num">${money(c.total)}</td>
        <td><span class="tag ${estadoTag(c.estado)}">${c.estado}</span></td>
        <td class="actions">
          <a class="btn ghost small" href="/api/citas/${c.id}/ticket">Ticket</a>
          ${c.estado === 'Reservada' ? `<button class="btn danger small" data-cancelar="${c.id}">Cancelar</button>` : ''}
        </td>
      </tr>`).join('') || '<tr><td colspan="9" class="empty">No hay citas con esos filtros.</td></tr>';
  }

  ['f-fecha', 'f-local', 'f-estado'].forEach(id => ($('#' + id).onchange = () => cargar().catch(e => toast(e.message))));
  $('#f-todas').onclick = () => { $('#f-fecha').value = ''; cargar().catch(e => toast(e.message)); };
  view.onclick = async e => {
    const id = e.target.dataset.cancelar;
    if (!id || !confirm('¿Cancelar esta cita? El horario quedará libre.')) return;
    try { await api(`/citas/${id}/cancelar`, 'POST'); toast('Cita cancelada'); cargar(); }
    catch (err) { toast(err.message); }
  };
  await cargar();
}

/* ───────── Validar QR ───────── */
async function renderValidar() {
  view.innerHTML = `
    <div class="card validar">
      <h3>Validar cita al llegar el cliente</h3>
      <p class="muted">Escanee el QR del ticket con un lector, use la cámara o escriba el código.</p>
      <form id="validar-form" autocomplete="off">
        <div class="row">
          <input id="codigo" placeholder="BRB-XXXXXXXX" maxlength="20" autofocus>
          <button class="btn primary" type="submit">Validar</button>
        </div>
      </form>
      <div style="margin-top:10px"><button class="btn ghost small" id="btn-cam" type="button">Escanear con la cámara</button></div>
      <video class="cam" id="cam" playsinline muted hidden></video>
      <div id="resultado"></div>
    </div>`;

  const input = $('#codigo'), video = $('#cam');
  let stream = null, escaneando = false;

  function detener() {
    escaneando = false;
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = null; video.hidden = true;
  }
  state.limpiar = detener;

  async function validar() {
    const codigo = input.value.trim();
    const out = $('#resultado');
    try {
      const c = await api('/admin/citas/validar', 'POST', { codigo });
      out.innerHTML = `
        <div class="result ok">
          <strong>Cita validada: marcada como atendida.</strong>
          <dl>
            <dt>Cliente</dt><dd>${esc(c.cliente)} ${c.premium ? '<span class="tag premium">Premium</span>' : ''}</dd>
            <dt>Hora</dt><dd>${ftime(c.inicio)}</dd>
            <dt>Local</dt><dd>${esc(c.local)}</dd>
            <dt>Barbero</dt><dd>${esc(c.barbero)}</dd>
            <dt>Corte</dt><dd>${esc(c.corte)}</dd>
            <dt>Forma de pago</dt><dd>${esc(c.metodo)}</dd>
            <dt>Total a cobrar</dt><dd><strong>${money(c.total)}</strong></dd>
          </dl>
        </div>`;
      input.value = '';
    } catch (err) {
      out.innerHTML = `<div class="result bad">${esc(err.message)}</div>`;
    }
    input.focus();
  }

  $('#validar-form').onsubmit = e => { e.preventDefault(); validar(); };

  $('#btn-cam').onclick = async () => {
    if (stream) return detener();
    if (!('BarcodeDetector' in window)) {
      return toast('Este navegador no puede escanear con la cámara. Use un lector de QR o escriba el código.');
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    } catch {
      return toast('No se pudo usar la cámara. Revise el permiso (requiere HTTPS o localhost).');
    }
    video.srcObject = stream; video.hidden = false;
    await video.play();
    const detector = new BarcodeDetector({ formats: ['qr_code'] });
    escaneando = true;
    const ciclo = async () => {
      if (!escaneando) return;
      try {
        const codigos = await detector.detect(video);
        if (codigos.length) { detener(); input.value = codigos[0].rawValue; validar(); return; }
      } catch { /* seguir intentando */ }
      setTimeout(ciclo, 300);
    };
    ciclo();
  };
}

/* ───────── Catálogos genéricos (CRUD) ───────── */
const resumenHorario = h => {
  if (!h || !h.length) return '<span class="muted">Sin horario</span>';
  const corto = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const grupos = {};
  [...h].sort((a, b) => ((a.dia + 6) % 7) - ((b.dia + 6) % 7) || a.inicio.localeCompare(b.inicio)).forEach(x => {
    const k = `${x.inicio}–${x.fin}`;
    (grupos[k] = grupos[k] || []).push(corto[x.dia]);
  });
  return Object.entries(grupos).map(([k, dias]) => `${[...new Set(dias)].join(', ')} ${k}`).join('<br>');
};

const filaHorario = (h = { dia: 1, inicio: '09:00', fin: '18:00' }) => `
  <div class="horario-row">
    <select data-h="dia">${optionsHtml(DIAS.map((d, i) => ({ value: i, label: d })), h.dia)}</select>
    <input type="time" data-h="inicio" value="${esc(h.inicio)}" required>
    <input type="time" data-h="fin" value="${esc(h.fin)}" required>
    <button type="button" class="btn danger small" data-quitar>Quitar</button>
  </div>`;

function campoHtml(c, v, esNuevo) {
  const nameAttr = `name="${c.name}"`;
  const req = c.required && (!c.soloNuevo || esNuevo) ? 'required' : '';
  switch (c.type) {
    case 'textarea':
      return field(c.label, `<textarea ${nameAttr} rows="3" maxlength="${c.max || 300}">${esc(v ?? '')}</textarea>`, c.help);
    case 'number':
      return field(c.label, `<input ${nameAttr} type="number" step="${c.step || 1}" min="${c.min ?? ''}" max="${c.max ?? ''}" required value="${esc(v ?? c.default ?? '')}">`, c.help);
    case 'select':
      return field(c.label, `<select ${nameAttr}>${optionsHtml(c.opciones, v ?? c.default)}</select>`, c.help);
    case 'checkbox':
      return `<div class="field"><label class="check"><input type="checkbox" ${nameAttr} ${(v ?? c.default) ? 'checked' : ''}> ${c.label}</label></div>`;
    case 'foto':
      return `<div class="field"><label>${c.label}</label>
        <div class="foto-field">
          <div class="photo" data-preview="${c.name}" ${photoStyle(v)}>${v ? '' : 'Sin foto'}</div>
          <div style="flex:1"><input type="file" accept="image/jpeg,image/png,image/webp" data-foto="${c.name}">
          <input type="hidden" ${nameAttr} value="${esc(v ?? '')}"></div>
        </div><small>JPG, PNG o WEBP, máximo 5 MB.</small></div>`;
    case 'horario':
      return `<div class="field"><label>${c.label}</label>
        <div data-horario="${c.name}">${(v || []).map(filaHorario).join('')}</div>
        <button type="button" class="btn ghost small" data-agregar>Agregar horario</button>
        <small>Puede agregar varios bloques por día (por ejemplo, con pausa de almuerzo).</small></div>`;
    default: {
      const extra = c.type === 'password' ? 'autocomplete="new-password"' : '';
      return field(c.label, `<input ${nameAttr} type="${c.type || 'text'}" ${extra} maxlength="${c.max || 100}" ${req} value="${esc(v ?? '')}">`, c.help);
    }
  }
}

function leerCampos(form, campos) {
  const out = {};
  for (const c of campos) {
    if (c.type === 'checkbox') out[c.name] = form.elements[c.name].checked;
    else if (c.type === 'number') out[c.name] = form.elements[c.name].value === '' ? 0 : +form.elements[c.name].value;
    else if (c.type === 'horario') {
      out[c.name] = $$('[data-horario="' + c.name + '"] .horario-row', form).map(r => ({
        dia: +$('[data-h=dia]', r).value, inicio: $('[data-h=inicio]', r).value, fin: $('[data-h=fin]', r).value
      }));
    } else if (c.int) out[c.name] = +form.elements[c.name].value;
    else out[c.name] = form.elements[c.name].value;
  }
  return out;
}

function conectarFotos(form) {
  $$('[data-foto]', form).forEach(inp => {
    inp.onchange = async () => {
      const file = inp.files[0];
      if (!file) return;
      const fd = new FormData();
      fd.append('file', file);
      try {
        const r = await fetch('/api/admin/upload', { method: 'POST', body: fd });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || 'No se pudo subir la imagen.');
        form.elements[inp.dataset.foto].value = j.url;
        const prev = $(`[data-preview="${inp.dataset.foto}"]`, form);
        prev.style.backgroundImage = `url('${j.url}')`; prev.textContent = '';
      } catch (err) { modalError(err.message); inp.value = ''; }
    };
  });
}

function crudView(cfg) {
  return async function () {
    const items = await api('/admin/' + cfg.recurso);
    topButton(cfg.nuevo, () => abrirForm(null));

    view.innerHTML = `<div class="card"><div class="table-wrap"><table>
      <thead><tr>${cfg.columnas.map(c => `<th>${c.label}</th>`).join('')}<th></th></tr></thead>
      <tbody>${items.map(i => `<tr>${cfg.columnas.map(c => `<td>${c.render(i)}</td>`).join('')}
        <td class="actions"><button class="btn ghost small" data-editar="${i.id}">Editar</button></td></tr>`).join('')
        || `<tr><td colspan="${cfg.columnas.length + 1}" class="empty">${cfg.vacio}</td></tr>`}</tbody>
    </table></div></div>`;

    view.onclick = e => {
      const id = e.target.dataset.editar;
      if (id) abrirForm(items.find(i => i.id === +id));
    };

    async function abrirForm(item) {
      const campos = [];
      for (const c of cfg.campos) campos.push({ ...c, opciones: typeof c.opciones === 'function' ? await c.opciones() : c.opciones });
      const html = campos.map(c => campoHtml(c, item ? item[c.name] : undefined, !item)).join('');

      openModal(item ? cfg.editar : cfg.nuevo, html, async form => {
        const data = leerCampos(form, campos);
        if (item) await api(`/admin/${cfg.recurso}/${item.id}`, 'PUT', data);
        else await api('/admin/' + cfg.recurso, 'POST', data);
        toast('Cambios guardados');
        navigate();
      });

      const form = $('#modal-form');
      conectarFotos(form);
      $('#modal-body').onclick = e => {
        if (e.target.hasAttribute('data-agregar')) {
          $('[data-horario]', form).insertAdjacentHTML('beforeend', filaHorario());
        } else if (e.target.hasAttribute('data-quitar')) {
          e.target.closest('.horario-row').remove();
        }
      };
    }
  };
}

const thumb = url => `<span class="thumb" ${photoStyle(url)}></span>`;

const renderCortes = crudView({
  recurso: 'cortes', nuevo: 'Nuevo corte', editar: 'Editar corte',
  vacio: 'Aún no hay cortes. Cree el primero con “Nuevo corte”.',
  columnas: [
    { label: 'Foto', render: i => thumb(i.fotoUrl) },
    { label: 'Corte', render: i => `<strong>${esc(i.nombre)}</strong><div class="muted">${esc(i.descripcion || '')}</div>` },
    { label: 'Duración', render: i => i.duracionMin + ' min' },
    { label: 'Precio', render: i => money(i.precio) },
    { label: 'Estado', render: i => estadoActivo(i.activo, 'Disponible', 'No disponible') }
  ],
  campos: [
    { name: 'nombre', label: 'Nombre del corte', required: true, max: 80 },
    { name: 'descripcion', label: 'Descripción', type: 'textarea' },
    { name: 'precio', label: 'Precio (USD)', type: 'number', step: '0.01', min: '0.01' },
    { name: 'duracionMin', label: 'Duración (minutos)', type: 'number', step: '5', min: '5', max: '480', default: 30,
      help: 'La cita ocupa este tiempo en la agenda del barbero.' },
    { name: 'fotoUrl', label: 'Foto del corte', type: 'foto' },
    { name: 'activo', label: 'Disponible para reservar', type: 'checkbox', default: true }
  ]
});

const renderLocales = crudView({
  recurso: 'locales', nuevo: 'Nuevo local', editar: 'Editar local',
  vacio: 'Aún no hay locales. Cree el primero con “Nuevo local”.',
  columnas: [
    { label: 'Foto', render: i => thumb(i.fotoUrl) },
    { label: 'Local', render: i => `<strong>${esc(i.nombre)}</strong><div class="muted">${esc(i.direccion)}</div>` },
    { label: 'Teléfono', render: i => esc(i.telefono || '—') },
    { label: 'Horario', render: i => esc(i.horario || '—') },
    { label: 'Estado', render: i => estadoActivo(i.activo) }
  ],
  campos: [
    { name: 'nombre', label: 'Nombre', required: true, max: 80 },
    { name: 'direccion', label: 'Dirección', required: true, max: 200 },
    { name: 'telefono', label: 'Teléfono', max: 30 },
    { name: 'horario', label: 'Horario de atención (texto informativo)', max: 120, help: 'Ejemplo: Lun–Sáb 9:00–19:00' },
    { name: 'fotoUrl', label: 'Foto del local', type: 'foto' },
    { name: 'activo', label: 'Activo', type: 'checkbox', default: true }
  ]
});

const renderBarberos = crudView({
  recurso: 'barberos', nuevo: 'Nuevo barbero', editar: 'Editar barbero',
  vacio: 'Aún no hay barberos. Cree el primero con “Nuevo barbero”.',
  columnas: [
    { label: 'Barbero', render: i => `<strong>${esc(i.nombre)}</strong>` },
    { label: 'Local', render: i => esc(i.local) },
    { label: 'Horario semanal', render: i => resumenHorario(i.horario) },
    { label: 'Estado', render: i => estadoActivo(i.activo) }
  ],
  campos: [
    { name: 'nombre', label: 'Nombre', required: true, max: 80 },
    { name: 'localId', label: 'Local', type: 'select', int: true,
      opciones: async () => (await api('/admin/locales')).map(l => ({ value: l.id, label: l.nombre })) },
    { name: 'horario', label: 'Horario semanal', type: 'horario' },
    { name: 'activo', label: 'Activo', type: 'checkbox', default: true }
  ]
});

const renderMetodos = crudView({
  recurso: 'metodos-pago', nuevo: 'Nueva forma de pago', editar: 'Editar forma de pago',
  vacio: 'Aún no hay formas de pago.',
  columnas: [
    { label: 'Forma de pago', render: i => `<strong>${esc(i.nombre)}</strong>` },
    { label: 'Estado', render: i => estadoActivo(i.activo, 'Disponible', 'No disponible') }
  ],
  campos: [
    { name: 'nombre', label: 'Nombre', required: true, max: 40 },
    { name: 'activo', label: 'Disponible para elegir en las citas', type: 'checkbox', default: true }
  ]
});

const renderUsuarios = crudView({
  recurso: 'usuarios', nuevo: 'Nuevo usuario', editar: 'Editar usuario',
  vacio: 'No hay usuarios.',
  columnas: [
    { label: 'Nombre', render: i => `<strong>${esc(i.nombre)}</strong>` },
    { label: 'Correo', render: i => esc(i.email) },
    { label: 'Rol', render: i => `<span class="tag ${i.rol === 'Admin' ? 'warn' : 'neutral'}">${i.rol === 'Admin' ? 'Administrador' : 'Usuario'}</span>` },
    { label: 'Estado', render: i => estadoActivo(i.activo) }
  ],
  campos: [
    { name: 'nombre', label: 'Nombre completo', required: true, max: 80 },
    { name: 'email', label: 'Correo electrónico', type: 'email', required: true, max: 120 },
    { name: 'telefono', label: 'Teléfono', max: 30 },
    { name: 'rol', label: 'Rol', type: 'select', default: 'Usuario',
      opciones: [{ value: 'Usuario', label: 'Usuario (cliente)' }, { value: 'Admin', label: 'Administrador' }] },
    { name: 'password', label: 'Contraseña', type: 'password', required: true, soloNuevo: true, max: 100,
      help: 'Mínimo 8 caracteres. Al editar, déjela vacía para no cambiarla.' },
    { name: 'activo', label: 'Cuenta activa', type: 'checkbox', default: true }
  ]
});

/* ───────── Clientes ───────── */
async function renderClientes() {
  const clientes = await api('/admin/clientes');
  view.innerHTML = `
    <div class="card">
      <div class="toolbar"><input type="search" id="buscar" placeholder="Buscar por nombre o correo" style="min-width:280px"></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Cliente</th><th>Teléfono</th><th>Citas</th><th>Última atendida</th><th>Tipo</th><th></th></tr></thead>
        <tbody id="rows"></tbody>
      </table></div>
    </div>`;

  const pintar = () => {
    const q = $('#buscar').value.toLowerCase();
    $('#rows').innerHTML = clientes.filter(c => (c.nombre + ' ' + c.email).toLowerCase().includes(q)).map(c => `
      <tr>
        <td><strong>${esc(c.nombre)}</strong> ${c.activo ? '' : '<span class="tag bad">Desactivado</span>'}<div class="muted">${esc(c.email)}</div></td>
        <td>${esc(c.telefono || '—')}</td>
        <td>${c.citas}</td>
        <td>${c.ultimaCita ? fdateShort(c.ultimaCita) : '—'}</td>
        <td>${c.premium ? '<span class="tag premium">Premium</span>' : '<span class="tag neutral">Regular</span>'}</td>
        <td class="actions"><button class="btn ${c.premium ? 'ghost' : 'dark'} small" data-premium="${c.id}">${c.premium ? 'Quitar premium' : 'Hacer premium'}</button></td>
      </tr>`).join('') || '<tr><td colspan="6" class="empty">No hay clientes que coincidan.</td></tr>';
  };
  pintar();
  $('#buscar').oninput = pintar;

  view.onclick = async e => {
    const id = e.target.dataset.premium;
    if (!id) return;
    const c = clientes.find(x => x.id === +id);
    const nuevo = !c.premium;
    if (!confirm(nuevo ? `¿Marcar a ${c.nombre} como cliente premium?` : `¿Quitar el estado premium a ${c.nombre}?`)) return;
    try {
      await api(`/admin/clientes/${id}/premium`, 'PUT', { premium: nuevo });
      c.premium = nuevo; pintar();
      toast(nuevo ? 'Cliente premium activado' : 'Premium retirado');
    } catch (err) { toast(err.message); }
  };
}

/* ───────── Configuración ───────── */
async function renderConfig() {
  const c = await api('/admin/config');
  view.innerHTML = `
    <div class="card" style="max-width:560px">
      <h3>Configuración del negocio</h3>
      <form id="cfg-form">
        ${field('Nombre del negocio', `<input name="nombreNegocio" required maxlength="60" value="${esc(c.nombreNegocio)}">`, 'Aparece en la portada y en el ticket.')}
        ${field('Descuento para clientes premium (%)', `<input name="descuentoPremiumPct" type="number" min="0" max="100" step="0.5" required value="${c.descuentoPremiumPct}">`, 'Se aplica a todos los cortes al reservar. Las citas ya creadas conservan su precio.')}
        ${field('Intervalo entre horarios', `<select name="pasoMinutos">${optionsHtml([5, 10, 15, 20, 30, 60].map(m => ({ value: m, label: m + ' minutos' })), c.pasoMinutos)}</select>`, 'Cada cuántos minutos se ofrece un horario de inicio.')}
        <button class="btn primary" type="submit">Guardar configuración</button>
      </form>
    </div>`;

  $('#cfg-form').onsubmit = async e => {
    e.preventDefault();
    const f = e.target.elements;
    try {
      await api('/admin/config', 'PUT', {
        nombreNegocio: f.nombreNegocio.value,
        descuentoPremiumPct: +f.descuentoPremiumPct.value,
        pasoMinutos: +f.pasoMinutos.value
      });
      toast('Configuración guardada');
    } catch (err) { toast(err.message); }
  };
}
