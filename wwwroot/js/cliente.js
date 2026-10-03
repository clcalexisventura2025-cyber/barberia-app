'use strict';

const precioHtml = (precio, pct) => {
  if (!pct) return money(precio);
  const con = Math.round(precio * (1 - pct / 100) * 100) / 100;
  return `<s>${money(precio)}</s>${money(con)}`;
};

const estadoTag = e => ({ Reservada: 'neutral', Atendida: 'ok', Cancelada: 'bad' }[e] || 'neutral');

/* ───────── Inicio: información, locales y cortes ───────── */
async function renderInicio() {
  const d = await api('/info');
  const premium = state.me.premium;
  const pct = premium ? d.descuentoPremiumPct : 0;

  const perk = d.descuentoPremiumPct > 0
    ? (premium
      ? `<div class="perk"><strong>Cliente premium</strong><span>Tiene ${d.descuentoPremiumPct}% de descuento en todos sus cortes. Se aplica solo al reservar.</span></div>`
      : `<div class="perk"><strong>${d.descuentoPremiumPct}% de descuento</strong><span>Los clientes premium ahorran ese porcentaje en cada corte. Pregunte en el chat de ayuda cómo serlo.</span></div>`)
    : '';

  const locales = d.locales.map(l => `
    <article class="card item">
      <div class="photo" ${photoStyle(l.fotoUrl)}>${l.fotoUrl ? '' : 'Sin foto'}</div>
      <h3>${esc(l.nombre)}</h3>
      <div>${esc(l.direccion)}</div>
      <div class="meta">${l.telefono ? 'Tel. ' + esc(l.telefono) : ''}${l.horario ? ' · ' + esc(l.horario) : ''}</div>
      <div class="meta">${l.barberos.length ? 'Barberos: ' + l.barberos.map(esc).join(', ') : 'Sin barberos asignados'}</div>
    </article>`).join('') || '<div class="card empty">Aún no hay locales registrados.</div>';

  const cortes = d.cortes.map(c => `
    <article class="card item">
      <div class="photo" ${photoStyle(c.fotoUrl)}>${c.fotoUrl ? '' : 'Sin foto'}</div>
      <h3>${esc(c.nombre)}</h3>
      <div class="meta">${esc(c.descripcion || '')}</div>
      <div class="meta">Duración: ${c.duracionMin} min</div>
      <div class="price">${precioHtml(c.precio, pct)}</div>
    </article>`).join('') || '<div class="card empty">Aún no hay cortes disponibles.</div>';

  view.innerHTML = `
    <section class="hero">
      <h1>${esc(d.negocio)}</h1>
      <p>Elija su local, su barbero y su corte. Reserve la hora que le convenga y reciba un ticket con código QR.</p>
      <a class="btn primary" href="#/reservar">Reservar una cita</a>
    </section>
    ${perk}
    <h2 class="section-title">Nuestros locales</h2>
    <div class="grid cols">${locales}</div>
    <h2 class="section-title">Cortes y precios</h2>
    <div class="grid cols">${cortes}</div>`;
}

/* ───────── Reservar una cita ───────── */
async function renderReservar() {
  const [locales, cortes, metodos] = await Promise.all([api('/locales'), api('/cortes'), api('/metodos-pago')]);
  if (!locales.length || !cortes.length || !metodos.length) {
    view.innerHTML = '<div class="card empty">Por ahora no se pueden reservar citas: faltan locales, cortes o formas de pago disponibles. Escriba por el chat de ayuda.</div>';
    return;
  }

  const pct = state.me.premium ? state.me.descuentoPct : 0;
  const sel = { localId: locales[0].id, barberoId: null, corteId: null, fecha: hoyISO(), hora: null, metodoPagoId: metodos[0].id };
  let barberos = [], slots = null, enviando = false;

  async function cargarBarberos() {
    barberos = await api('/barberos?localId=' + sel.localId);
    if (!barberos.some(b => b.id === sel.barberoId)) sel.barberoId = barberos[0]?.id ?? null;
  }

  async function cargarSlots() {
    slots = null; sel.hora = null;
    if (!(sel.barberoId && sel.corteId && sel.fecha)) return;
    try {
      slots = await api(`/disponibilidad?barberoId=${sel.barberoId}&corteId=${sel.corteId}&fecha=${sel.fecha}`);
    } catch (e) { toast(e.message); slots = []; }
  }

  const corte = () => cortes.find(c => c.id === sel.corteId);
  const local = () => locales.find(l => l.id === sel.localId);
  const barbero = () => barberos.find(b => b.id === sel.barberoId);
  const metodo = () => metodos.find(m => m.id === sel.metodoPagoId);
  const listo = () => sel.localId && sel.barberoId && sel.corteId && sel.fecha && sel.hora && sel.metodoPagoId;

  function pintar() {
    const c = corte();
    const total = c ? Math.round(c.precio * (1 - pct / 100) * 100) / 100 : 0;

    const slotsHtml = slots === null
      ? '<p class="muted">Elija barbero y corte para ver los horarios.</p>'
      : slots.length
        ? `<div class="slots">${slots.map(h => `<button type="button" class="slot ${h === sel.hora ? 'sel' : ''}" data-hora="${h}">${h}</button>`).join('')}</div>`
        : '<p class="muted">No hay horarios libres para ese día. Pruebe con otra fecha u otro barbero.</p>';

    view.innerHTML = `
      <h1 class="section-title">Reservar una cita</h1>
      <div class="booking">
        <div>
          <section class="step">
            <h3>1. Local</h3>
            <div class="choice">${locales.map(l => `
              <button type="button" class="opt ${l.id === sel.localId ? 'sel' : ''}" data-local="${l.id}">
                <b>${esc(l.nombre)}</b><small>${esc(l.direccion)}</small>
              </button>`).join('')}</div>
          </section>

          <section class="step">
            <h3>2. Barbero</h3>
            ${barberos.length ? `<div class="choice">${barberos.map(b => `
              <button type="button" class="opt ${b.id === sel.barberoId ? 'sel' : ''}" data-barbero="${b.id}"><b>${esc(b.nombre)}</b></button>`).join('')}</div>`
              : '<p class="muted">Este local no tiene barberos disponibles por ahora.</p>'}
          </section>

          <section class="step">
            <h3>3. Corte</h3>
            <div class="choice">${cortes.map(x => `
              <button type="button" class="opt ${x.id === sel.corteId ? 'sel' : ''}" data-corte="${x.id}">
                <b>${esc(x.nombre)}</b>
                <small>${x.duracionMin} min</small>
                <span class="price">${precioHtml(x.precio, pct)}</span>
              </button>`).join('')}</div>
          </section>

          <section class="step">
            <h3>4. Fecha y hora</h3>
            <div class="field" style="max-width:240px"><input type="date" id="fecha" value="${sel.fecha}" min="${hoyISO()}"></div>
            ${slotsHtml}
          </section>

          <section class="step">
            <h3>5. Forma de pago</h3>
            <div class="field" style="max-width:300px">
              <select id="metodo">${optionsHtml(metodos.map(m => ({ value: m.id, label: m.nombre })), sel.metodoPagoId)}</select>
              <small>Solo se registra la forma elegida; el pago se realiza en el local.</small>
            </div>
          </section>
        </div>

        <aside class="card summary">
          <h3>Resumen</h3>
          <dl>
            <dt>Local</dt><dd>${local() ? esc(local().nombre) : '—'}</dd>
            <dt>Barbero</dt><dd>${barbero() ? esc(barbero().nombre) : '—'}</dd>
            <dt>Corte</dt><dd>${c ? esc(c.nombre) : '—'}</dd>
            <dt>Fecha</dt><dd>${sel.fecha ? fdate(sel.fecha + 'T00:00:00') : '—'}</dd>
            <dt>Hora</dt><dd>${sel.hora || '—'}</dd>
            <dt>Pago</dt><dd>${metodo() ? esc(metodo().nombre) : '—'}</dd>
            ${pct ? `<dt>Descuento premium</dt><dd>${pct}%</dd>` : ''}
          </dl>
          <div class="total"><span>Total</span><b>${c ? money(total) : '—'}</b></div>
          <button class="btn primary" style="width:100%" data-confirmar ${listo() && !enviando ? '' : 'disabled'}>Confirmar cita</button>
        </aside>
      </div>`;
  }

  view.onclick = async e => {
    const t = e.target.closest('[data-local],[data-barbero],[data-corte],[data-hora],[data-confirmar]');
    if (!t) return;

    if (t.dataset.local) { sel.localId = +t.dataset.local; await cargarBarberos(); await cargarSlots(); pintar(); }
    else if (t.dataset.barbero) { sel.barberoId = +t.dataset.barbero; await cargarSlots(); pintar(); }
    else if (t.dataset.corte) { sel.corteId = +t.dataset.corte; await cargarSlots(); pintar(); }
    else if (t.dataset.hora) { sel.hora = t.dataset.hora; pintar(); }
    else if (t.hasAttribute('data-confirmar') && listo() && !enviando) {
      enviando = true; pintar();
      try {
        const r = await api('/citas', 'POST', {
          barberoId: sel.barberoId, corteId: sel.corteId, fecha: sel.fecha, hora: sel.hora, metodoPagoId: sel.metodoPagoId
        });
        view.onclick = null; view.onchange = null;
        view.innerHTML = `
          <div class="card done">
            <h2>¡Cita confirmada!</h2>
            <p>${fdate(r.inicio)} a las ${ftime(r.inicio)}</p>
            <img src="/api/citas/${r.id}/qr" alt="Código QR de su cita">
            <div class="code">${esc(r.codigo)}</div>
            <p class="muted">Presente este código al llegar al local. El administrador lo validará.</p>
            <div class="btns" style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
              <a class="btn primary" href="/api/citas/${r.id}/ticket">Descargar ticket (PDF)</a>
              <a class="btn ghost" href="#/citas">Ver mis citas</a>
            </div>
          </div>`;
      } catch (err) {
        enviando = false;
        toast(err.message);
        await cargarSlots();               // el horario pudo haberse ocupado
        pintar();
      }
    }
  };

  view.onchange = async e => {
    if (e.target.id === 'fecha') { sel.fecha = e.target.value; await cargarSlots(); pintar(); }
    else if (e.target.id === 'metodo') { sel.metodoPagoId = +e.target.value; pintar(); }
  };

  await cargarBarberos();
  pintar();
}

/* ───────── Mis citas ───────── */
async function renderMisCitas() {
  const lista = await api('/citas/mias');
  const ahora = new Date();
  const proximas = lista.filter(x => x.detalle.estado === 'Reservada' && new Date(x.detalle.inicio) > ahora)
    .sort((a, b) => new Date(a.detalle.inicio) - new Date(b.detalle.inicio));
  const historial = lista.filter(x => !proximas.includes(x));

  const tarjeta = ({ detalle: c, puedeCancelar }) => `
    <article class="card cita ${c.estado === 'Cancelada' ? 'cancelada' : ''}">
      <div>
        <div class="when">${fdate(c.inicio)} · ${ftime(c.inicio)}</div>
        <h3>${esc(c.corte)} con ${esc(c.barbero)}</h3>
        <div>${esc(c.local)} <span class="muted">· ${esc(c.direccion)}</span></div>
        <div class="muted">Pago: ${esc(c.metodo)} · Total ${money(c.total)}${c.descuentoPct > 0 ? ` (premium −${c.descuentoPct}%)` : ''}</div>
        <div style="margin-top:6px"><span class="tag ${estadoTag(c.estado)}">${c.estado}</span> <span class="muted">Código ${esc(c.codigo)}</span></div>
        <div class="btns">
          <a class="btn dark small" href="/api/citas/${c.id}/ticket">Descargar ticket (PDF)</a>
          ${puedeCancelar ? `<button class="btn danger small" data-cancelar="${c.id}">Cancelar cita</button>` : ''}
        </div>
      </div>
      ${c.estado === 'Reservada' ? `<img class="qr" src="/api/citas/${c.id}/qr" alt="Código QR de la cita ${esc(c.codigo)}">` : ''}
    </article>`;

  view.innerHTML = `
    <h1 class="section-title">Mis citas</h1>
    ${lista.length ? '' : '<div class="card empty">Todavía no tiene citas. <a href="#/reservar">Reserve la primera</a>.</div>'}
    ${proximas.length ? `<h2 class="section-title" style="font-size:26px">Próximas</h2><div class="grid">${proximas.map(tarjeta).join('')}</div>` : ''}
    ${historial.length ? `<h2 class="section-title" style="font-size:26px">Historial</h2><div class="grid">${historial.map(tarjeta).join('')}</div>` : ''}`;

  view.onclick = async e => {
    const id = e.target.dataset.cancelar;
    if (!id || !confirm('¿Cancelar esta cita? El horario quedará libre para otras personas.')) return;
    try {
      await api(`/citas/${id}/cancelar`, 'POST');
      toast('Cita cancelada');
      navigate();
    } catch (err) { toast(err.message); }
  };
}
