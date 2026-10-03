using System.Net.Mail;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using Barberia.Models;

namespace Barberia.Services;

/// <summary>
/// Almacén en memoria con persistencia en App_Data/data.json.
/// Todas las operaciones están protegidas con un lock.
/// </summary>
public partial class DataStore
{
    private const string AlfabetoCodigo = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    [GeneratedRegex(@"^/uploads/[a-f0-9]{32}\.(jpg|jpeg|png|webp)$")]
    private static partial Regex FotoRegex();

    private readonly object _lock = new();
    private readonly string _path;
    private readonly Database _db = new();

    public DataStore(IWebHostEnvironment env)
    {
        var dir = Path.Combine(env.ContentRootPath, "App_Data");
        Directory.CreateDirectory(dir);
        _path = Path.Combine(dir, "data.json");

        if (File.Exists(_path))
        {
            _db = JsonSerializer.Deserialize<Database>(File.ReadAllText(_path)) ?? new Database();
        }
        else
        {
            Seed();
            Save();
        }
    }

    // ───────────────────────── Utilidades ─────────────────────────
    private void Save()
    {
        var tmp = _path + ".tmp";
        File.WriteAllText(tmp, JsonSerializer.Serialize(_db, new JsonSerializerOptions { WriteIndented = true }));
        File.Move(tmp, _path, true);
    }

    private static int NextId<T>(List<T> list, Func<T, int> id) => list.Count == 0 ? 1 : list.Max(id) + 1;

    private static string Req(string? valor, string campo, int max = 100)
    {
        var v = (valor ?? "").Trim();
        if (v.Length == 0) throw new AppException($"{campo} es obligatorio.");
        if (v.Length > max) throw new AppException($"{campo} no puede superar {max} caracteres.");
        return v;
    }

    private static string? Opt(string? valor, string campo, int max = 100)
    {
        var v = (valor ?? "").Trim();
        if (v.Length == 0) return null;
        if (v.Length > max) throw new AppException($"{campo} no puede superar {max} caracteres.");
        return v;
    }

    private static string NormEmail(string? email)
    {
        var e = (email ?? "").Trim().ToLowerInvariant();
        if (e.Length == 0 || e.Length > 120 || !MailAddress.TryCreate(e, out var m) || m.Address != e)
            throw new AppException("Escriba un correo electrónico válido.");
        return e;
    }

    private static void CheckPassword(string? pwd)
    {
        if (string.IsNullOrEmpty(pwd) || pwd.Length < 8)
            throw new AppException("La contraseña debe tener al menos 8 caracteres.");
        if (pwd.Length > 100) throw new AppException("La contraseña es demasiado larga.");
    }

    private static string? CheckFoto(string? url)
    {
        var u = (url ?? "").Trim();
        if (u.Length == 0) return null;
        if (!FotoRegex().IsMatch(u)) throw new AppException("La foto no es válida. Súbala desde el sistema.");
        return u;
    }

    private string NombreCliente(int id) => _db.Usuarios.FirstOrDefault(u => u.Id == id)?.Nombre ?? "—";

    // ───────────────────────── Cuentas ─────────────────────────
    private Usuario CrearUsuarioInterno(string? nombre, string? email, string? tel, string? pwd, string rol, bool activo)
    {
        var n = Req(nombre, "El nombre", 80);
        var e = NormEmail(email);
        var t = Opt(tel, "El teléfono", 30);
        if (_db.Usuarios.Any(u => u.Email == e)) throw new AppException("Ya existe una cuenta con ese correo.");
        CheckPassword(pwd);

        var (hash, salt) = PasswordHasher.Hash(pwd!);
        var user = new Usuario
        {
            Id = NextId(_db.Usuarios, x => x.Id),
            Nombre = n, Email = e, Telefono = t, Rol = rol, Activo = activo,
            PasswordHash = hash, Salt = salt
        };
        _db.Usuarios.Add(user);
        Save();
        return user;
    }

    public Usuario Registrar(RegistroDto d)
    {
        lock (_lock) return CrearUsuarioInterno(d.Nombre, d.Email, d.Telefono, d.Password, Roles.Usuario, true);
    }

    public Usuario Login(string? email, string? password)
    {
        lock (_lock)
        {
            var e = (email ?? "").Trim().ToLowerInvariant();
            var u = _db.Usuarios.FirstOrDefault(x => x.Email == e);
            if (u is null || !PasswordHasher.Verify(password ?? "", u.PasswordHash, u.Salt))
                throw new AppException("Correo o contraseña incorrectos.", 401);
            if (!u.Activo) throw new AppException("Su cuenta está desactivada. Contacte al administrador.", 401);
            return u;
        }
    }

    public Usuario? GetUsuario(int id)
    {
        lock (_lock) return _db.Usuarios.FirstOrDefault(u => u.Id == id);
    }

    public object Perfil(int id)
    {
        lock (_lock)
        {
            var u = _db.Usuarios.First(x => x.Id == id);
            return new { u.Id, u.Nombre, u.Email, u.Telefono, u.Rol, u.Premium, DescuentoPct = _db.Config.DescuentoPremiumPct };
        }
    }

    // ───────────────────────── Usuarios (admin) ─────────────────────────
    private static object ProyUsuario(Usuario u) =>
        new { u.Id, u.Nombre, u.Email, u.Telefono, u.Rol, u.Premium, u.Activo, u.CreadoEn };

    public object ListUsuarios()
    {
        lock (_lock) return _db.Usuarios.OrderBy(u => u.Nombre).Select(ProyUsuario).ToList();
    }

    public object CrearUsuarioAdmin(UsuarioAdminDto d)
    {
        lock (_lock)
        {
            var rol = d.Rol == Roles.Admin ? Roles.Admin : Roles.Usuario;
            return ProyUsuario(CrearUsuarioInterno(d.Nombre, d.Email, d.Telefono, d.Password, rol, d.Activo));
        }
    }

    public object ActualizarUsuario(int id, UsuarioAdminDto d, int actorId)
    {
        lock (_lock)
        {
            var u = _db.Usuarios.FirstOrDefault(x => x.Id == id) ?? throw new AppException("Usuario no encontrado.", 404);
            var nombre = Req(d.Nombre, "El nombre", 80);
            var email = NormEmail(d.Email);
            var tel = Opt(d.Telefono, "El teléfono", 30);
            var rol = d.Rol == Roles.Admin ? Roles.Admin : Roles.Usuario;

            if (_db.Usuarios.Any(x => x.Id != id && x.Email == email))
                throw new AppException("Ya existe otra cuenta con ese correo.");

            var pierdeAdmin = u.Rol == Roles.Admin && u.Activo && (rol != Roles.Admin || !d.Activo);
            if (pierdeAdmin)
            {
                if (id == actorId) throw new AppException("No puede quitarse el rol de administrador ni desactivar su propia cuenta.");
                if (!_db.Usuarios.Any(x => x.Id != id && x.Rol == Roles.Admin && x.Activo))
                    throw new AppException("Debe quedar al menos un administrador activo.");
            }

            if (!string.IsNullOrEmpty(d.Password))
            {
                CheckPassword(d.Password);
                (u.PasswordHash, u.Salt) = PasswordHasher.Hash(d.Password);
            }

            u.Nombre = nombre; u.Email = email; u.Telefono = tel; u.Rol = rol; u.Activo = d.Activo;
            if (rol == Roles.Admin) u.Premium = false;
            Save();
            return ProyUsuario(u);
        }
    }

    // ───────────────────────── Clientes (admin) ─────────────────────────
    public object ListClientes()
    {
        lock (_lock)
            return _db.Usuarios.Where(u => u.Rol == Roles.Usuario).OrderBy(u => u.Nombre).Select(u =>
            {
                var citas = _db.Citas.Where(c => c.UsuarioId == u.Id).ToList();
                return new
                {
                    u.Id, u.Nombre, u.Email, u.Telefono, u.Premium, u.Activo,
                    Citas = citas.Count(c => c.Estado != EstadoCita.Cancelada),
                    UltimaCita = citas.Where(c => c.Estado == EstadoCita.Atendida)
                        .OrderByDescending(c => c.Inicio).Select(c => (DateTime?)c.Inicio).FirstOrDefault()
                };
            }).ToList();
    }

    public void SetPremium(int id, bool premium)
    {
        lock (_lock)
        {
            var u = _db.Usuarios.FirstOrDefault(x => x.Id == id && x.Rol == Roles.Usuario)
                    ?? throw new AppException("Cliente no encontrado.", 404);
            u.Premium = premium;
            Save();
        }
    }

    // ───────────────────────── Locales ─────────────────────────
    public List<Local> ListLocales(bool soloActivos)
    {
        lock (_lock) return _db.Locales.Where(l => !soloActivos || l.Activo).OrderBy(l => l.Nombre).ToList();
    }

    public Local GuardarLocal(int? id, LocalDto d)
    {
        lock (_lock)
        {
            var nombre = Req(d.Nombre, "El nombre", 80);
            var dir = Req(d.Direccion, "La dirección", 200);
            var tel = Opt(d.Telefono, "El teléfono", 30);
            var horario = Opt(d.Horario, "El horario", 120);
            var foto = CheckFoto(d.FotoUrl);

            Local l;
            if (id is null) { l = new Local { Id = NextId(_db.Locales, x => x.Id) }; _db.Locales.Add(l); }
            else l = _db.Locales.FirstOrDefault(x => x.Id == id) ?? throw new AppException("Local no encontrado.", 404);

            l.Nombre = nombre; l.Direccion = dir; l.Telefono = tel; l.Horario = horario; l.FotoUrl = foto; l.Activo = d.Activo;
            Save();
            return l;
        }
    }

    // ───────────────────────── Barberos ─────────────────────────
    private static string HoraNorm(string? s, string campo)
    {
        if (!TimeOnly.TryParseExact((s ?? "").Trim(), "HH:mm", out var t))
            throw new AppException($"{campo} no tiene un formato de hora válido (HH:mm).");
        return t.ToString("HH:mm");
    }

    public object ListBarberos(bool soloActivos, int? localId = null)
    {
        lock (_lock)
            return _db.Barberos
                .Where(b => (!soloActivos || (b.Activo && _db.Locales.Any(l => l.Id == b.LocalId && l.Activo)))
                            && (localId is null || b.LocalId == localId))
                .OrderBy(b => b.Nombre)
                .Select(b => new
                {
                    b.Id, b.LocalId, b.Nombre, b.Activo, b.Horario,
                    Local = _db.Locales.FirstOrDefault(l => l.Id == b.LocalId)?.Nombre ?? "—"
                }).ToList();
    }

    public object GuardarBarbero(int? id, BarberoDto d)
    {
        lock (_lock)
        {
            var nombre = Req(d.Nombre, "El nombre", 80);
            if (_db.Locales.All(l => l.Id != d.LocalId)) throw new AppException("Seleccione un local válido.");

            var horario = new List<HorarioDia>();
            foreach (var h in d.Horario ?? new())
            {
                if (!Enum.IsDefined(h.Dia)) throw new AppException("Día de la semana no válido.");
                var ini = HoraNorm(h.Inicio, "La hora de inicio");
                var fin = HoraNorm(h.Fin, "La hora de fin");
                if (string.CompareOrdinal(ini, fin) >= 0)
                    throw new AppException($"En {h.Dia.ToString().ToLower()}, la hora de fin debe ser posterior a la de inicio.");
                horario.Add(new HorarioDia { Dia = h.Dia, Inicio = ini, Fin = fin });
            }
            foreach (var g in horario.GroupBy(h => h.Dia))
            {
                var orden = g.OrderBy(h => h.Inicio).ToList();
                for (var i = 1; i < orden.Count; i++)
                    if (string.CompareOrdinal(orden[i].Inicio, orden[i - 1].Fin) < 0)
                        throw new AppException("Hay horarios que se traslapan el mismo día.");
            }

            Barbero b;
            if (id is null) { b = new Barbero { Id = NextId(_db.Barberos, x => x.Id) }; _db.Barberos.Add(b); }
            else b = _db.Barberos.FirstOrDefault(x => x.Id == id) ?? throw new AppException("Barbero no encontrado.", 404);

            b.Nombre = nombre; b.LocalId = d.LocalId; b.Activo = d.Activo;
            b.Horario = horario.OrderBy(h => h.Dia).ThenBy(h => h.Inicio).ToList();
            Save();
            return new { b.Id, b.LocalId, b.Nombre, b.Activo, b.Horario };
        }
    }

    // ───────────────────────── Cortes ─────────────────────────
    public List<Corte> ListCortes(bool soloActivos)
    {
        lock (_lock) return _db.Cortes.Where(c => !soloActivos || c.Activo).OrderBy(c => c.Nombre).ToList();
    }

    public Corte GuardarCorte(int? id, CorteDto d)
    {
        lock (_lock)
        {
            var nombre = Req(d.Nombre, "El nombre", 80);
            var desc = Opt(d.Descripcion, "La descripción", 300);
            var foto = CheckFoto(d.FotoUrl);
            if (d.Precio <= 0 || d.Precio > 100000) throw new AppException("El precio debe ser mayor que cero.");
            if (d.DuracionMin < 5 || d.DuracionMin > 480) throw new AppException("La duración debe estar entre 5 y 480 minutos.");

            Corte c;
            if (id is null) { c = new Corte { Id = NextId(_db.Cortes, x => x.Id) }; _db.Cortes.Add(c); }
            else c = _db.Cortes.FirstOrDefault(x => x.Id == id) ?? throw new AppException("Corte no encontrado.", 404);

            c.Nombre = nombre; c.Descripcion = desc; c.Precio = Math.Round(d.Precio, 2);
            c.DuracionMin = d.DuracionMin; c.FotoUrl = foto; c.Activo = d.Activo;
            Save();
            return c;
        }
    }

    // ───────────────────────── Formas de pago ─────────────────────────
    public List<MetodoPago> ListMetodos(bool soloActivos)
    {
        lock (_lock) return _db.MetodosPago.Where(m => !soloActivos || m.Activo).OrderBy(m => m.Nombre).ToList();
    }

    public MetodoPago GuardarMetodo(int? id, MetodoPagoDto d)
    {
        lock (_lock)
        {
            var nombre = Req(d.Nombre, "El nombre", 40);
            if (_db.MetodosPago.Any(m => m.Id != id && m.Nombre.Equals(nombre, StringComparison.OrdinalIgnoreCase)))
                throw new AppException("Ya existe una forma de pago con ese nombre.");

            MetodoPago m;
            if (id is null) { m = new MetodoPago { Id = NextId(_db.MetodosPago, x => x.Id) }; _db.MetodosPago.Add(m); }
            else m = _db.MetodosPago.FirstOrDefault(x => x.Id == id) ?? throw new AppException("Forma de pago no encontrada.", 404);

            m.Nombre = nombre; m.Activo = d.Activo;
            Save();
            return m;
        }
    }

    // ───────────────────────── Configuración ─────────────────────────
    public Config GetConfig()
    {
        lock (_lock) return _db.Config;
    }

    public Config GuardarConfig(ConfigDto d)
    {
        lock (_lock)
        {
            var nombre = Req(d.NombreNegocio, "El nombre del negocio", 60);
            if (d.DescuentoPremiumPct < 0 || d.DescuentoPremiumPct > 100)
                throw new AppException("El descuento debe estar entre 0 y 100.");
            if (d.PasoMinutos is not (5 or 10 or 15 or 20 or 30 or 60))
                throw new AppException("El intervalo de horarios debe ser 5, 10, 15, 20, 30 o 60 minutos.");

            _db.Config.NombreNegocio = nombre;
            _db.Config.DescuentoPremiumPct = Math.Round(d.DescuentoPremiumPct, 2);
            _db.Config.PasoMinutos = d.PasoMinutos;
            Save();
            return _db.Config;
        }
    }

    // ───────────────────────── Información pública ─────────────────────────
    public object Info()
    {
        lock (_lock)
            return new
            {
                Negocio = _db.Config.NombreNegocio,
                DescuentoPremiumPct = _db.Config.DescuentoPremiumPct,
                Locales = _db.Locales.Where(l => l.Activo).OrderBy(l => l.Nombre).Select(l => new
                {
                    l.Id, l.Nombre, l.Direccion, l.Telefono, l.Horario, l.FotoUrl,
                    Barberos = _db.Barberos.Where(b => b.LocalId == l.Id && b.Activo).Select(b => b.Nombre).ToList()
                }).ToList(),
                Cortes = _db.Cortes.Where(c => c.Activo).OrderBy(c => c.Nombre).ToList()
            };
    }

    // ───────────────────────── Disponibilidad y citas ─────────────────────────
    private List<DateTime> SlotsInterno(int barberoId, int corteId, DateOnly fecha)
    {
        var b = _db.Barberos.FirstOrDefault(x => x.Id == barberoId && x.Activo)
                ?? throw new AppException("El barbero seleccionado no está disponible.");
        if (!_db.Locales.Any(l => l.Id == b.LocalId && l.Activo))
            throw new AppException("El local de este barbero no está disponible.");
        var corte = _db.Cortes.FirstOrDefault(x => x.Id == corteId && x.Activo)
                    ?? throw new AppException("El corte seleccionado no está disponible.");

        var dia = fecha.ToDateTime(TimeOnly.MinValue);
        var ahora = DateTime.Now;
        if (dia.Date < ahora.Date || dia.Date > ahora.Date.AddDays(90)) return new List<DateTime>();

        var dur = TimeSpan.FromMinutes(corte.DuracionMin);
        var paso = TimeSpan.FromMinutes(_db.Config.PasoMinutos);
        var ocupadas = _db.Citas
            .Where(c => c.BarberoId == barberoId && c.Estado != EstadoCita.Cancelada && c.Inicio.Date == dia.Date)
            .ToList();

        var res = new List<DateTime>();
        foreach (var h in b.Horario.Where(h => h.Dia == dia.DayOfWeek))
        {
            var ini = dia + TimeOnly.Parse(h.Inicio).ToTimeSpan();
            var fin = dia + TimeOnly.Parse(h.Fin).ToTimeSpan();
            for (var t = ini; t + dur <= fin; t += paso)
            {
                if (t <= ahora) continue;
                if (ocupadas.Any(o => t < o.Fin && t + dur > o.Inicio)) continue;
                res.Add(t);
            }
        }
        return res.Distinct().OrderBy(x => x).ToList();
    }

    public List<string> Disponibilidad(int barberoId, int corteId, DateOnly fecha)
    {
        lock (_lock) return SlotsInterno(barberoId, corteId, fecha).Select(t => t.ToString("HH:mm")).ToList();
    }

    private string NuevoCodigo()
    {
        while (true)
        {
            var chars = new char[8];
            for (var i = 0; i < chars.Length; i++)
                chars[i] = AlfabetoCodigo[RandomNumberGenerator.GetInt32(AlfabetoCodigo.Length)];
            var codigo = "BRB-" + new string(chars);
            if (_db.Citas.All(c => c.Codigo != codigo)) return codigo;
        }
    }

    public object CrearCita(int usuarioId, NuevaCitaDto d)
    {
        lock (_lock)
        {
            var user = _db.Usuarios.FirstOrDefault(u => u.Id == usuarioId && u.Activo)
                       ?? throw new AppException("Sesión no válida.", 401);
            if (user.Rol != Roles.Usuario)
                throw new AppException("Solo las cuentas de usuario pueden reservar citas.", 403);

            if (!DateOnly.TryParseExact(d.Fecha, "yyyy-MM-dd", out var fecha) ||
                !TimeOnly.TryParseExact(d.Hora, "HH:mm", out var hora))
                throw new AppException("La fecha o la hora no son válidas.");

            var inicio = fecha.ToDateTime(hora);
            if (!SlotsInterno(d.BarberoId, d.CorteId, fecha).Contains(inicio))
                throw new AppException("Ese horario ya no está disponible. Elija otro.", 409);

            var metodo = _db.MetodosPago.FirstOrDefault(m => m.Id == d.MetodoPagoId && m.Activo)
                         ?? throw new AppException("Seleccione una forma de pago válida.");
            var barbero = _db.Barberos.First(b => b.Id == d.BarberoId);
            var corte = _db.Cortes.First(c => c.Id == d.CorteId);

            var pct = user.Premium ? _db.Config.DescuentoPremiumPct : 0m;
            var total = Math.Round(corte.Precio * (1 - pct / 100m), 2, MidpointRounding.AwayFromZero);

            var cita = new Cita
            {
                Id = NextId(_db.Citas, x => x.Id),
                Codigo = NuevoCodigo(),
                UsuarioId = usuarioId,
                LocalId = barbero.LocalId,
                BarberoId = barbero.Id,
                CorteId = corte.Id,
                Inicio = inicio,
                Fin = inicio.AddMinutes(corte.DuracionMin),
                Precio = corte.Precio,
                DescuentoPct = pct,
                Total = total,
                MetodoPagoId = metodo.Id,
                Estado = EstadoCita.Reservada
            };
            _db.Citas.Add(cita);
            Save();
            return new { cita.Id, cita.Codigo, cita.Inicio, cita.Fin, cita.Total };
        }
    }

    private object DetalleCita(Cita c)
    {
        var u = _db.Usuarios.FirstOrDefault(x => x.Id == c.UsuarioId);
        var l = _db.Locales.FirstOrDefault(x => x.Id == c.LocalId);
        return new
        {
            c.Id, c.Codigo, c.Inicio, c.Fin, c.Precio, c.DescuentoPct, c.Total, c.Estado, c.ValidadaEn,
            Cliente = u?.Nombre ?? "—", Telefono = u?.Telefono, Premium = u?.Premium ?? false,
            c.LocalId, Local = l?.Nombre ?? "—", Direccion = l?.Direccion ?? "",
            Barbero = _db.Barberos.FirstOrDefault(x => x.Id == c.BarberoId)?.Nombre ?? "—",
            Corte = _db.Cortes.FirstOrDefault(x => x.Id == c.CorteId)?.Nombre ?? "—",
            Metodo = _db.MetodosPago.FirstOrDefault(x => x.Id == c.MetodoPagoId)?.Nombre ?? "—"
        };
    }

    public object MisCitas(int usuarioId)
    {
        lock (_lock)
        {
            var ahora = DateTime.Now;
            return _db.Citas.Where(c => c.UsuarioId == usuarioId)
                .OrderByDescending(c => c.Inicio)
                .Select(c => new
                {
                    Detalle = DetalleCita(c),
                    PuedeCancelar = c.Estado == EstadoCita.Reservada && c.Inicio > ahora
                }).ToList();
        }
    }

    public void Cancelar(int citaId, int actorId, bool esAdmin)
    {
        lock (_lock)
        {
            var c = _db.Citas.FirstOrDefault(x => x.Id == citaId && (esAdmin || x.UsuarioId == actorId))
                    ?? throw new AppException("Cita no encontrada.", 404);
            if (c.Estado != EstadoCita.Reservada)
                throw new AppException("Solo se pueden cancelar citas reservadas.");
            if (!esAdmin && c.Inicio <= DateTime.Now)
                throw new AppException("No se puede cancelar una cita que ya comenzó.");
            c.Estado = EstadoCita.Cancelada;
            Save();
        }
    }

    public TicketData DatosTicket(int citaId, int actorId, bool esAdmin)
    {
        lock (_lock)
        {
            var c = _db.Citas.FirstOrDefault(x => x.Id == citaId && (esAdmin || x.UsuarioId == actorId))
                    ?? throw new AppException("Cita no encontrada.", 404);
            var u = _db.Usuarios.First(x => x.Id == c.UsuarioId);
            var l = _db.Locales.First(x => x.Id == c.LocalId);
            var corte = _db.Cortes.First(x => x.Id == c.CorteId);
            return new TicketData(
                c, _db.Config.NombreNegocio, u.Nombre, c.DescuentoPct > 0, l.Nombre, l.Direccion,
                _db.Barberos.First(x => x.Id == c.BarberoId).Nombre, corte.Nombre, corte.DuracionMin,
                _db.MetodosPago.FirstOrDefault(x => x.Id == c.MetodoPagoId)?.Nombre ?? "—");
        }
    }

    public string CodigoDeCita(int citaId, int actorId, bool esAdmin)
    {
        lock (_lock)
            return (_db.Citas.FirstOrDefault(x => x.Id == citaId && (esAdmin || x.UsuarioId == actorId))
                    ?? throw new AppException("Cita no encontrada.", 404)).Codigo;
    }

    public object CitasAdmin(DateOnly? fecha, int? localId, string? estado)
    {
        lock (_lock)
            return _db.Citas
                .Where(c => (fecha is null || c.Inicio.Date == fecha.Value.ToDateTime(TimeOnly.MinValue).Date)
                            && (localId is null || c.LocalId == localId)
                            && (string.IsNullOrEmpty(estado) || c.Estado == estado))
                .OrderBy(c => c.Inicio)
                .Select(DetalleCita).ToList();
    }

    public object Validar(string? codigo)
    {
        lock (_lock)
        {
            var cod = (codigo ?? "").Trim().ToUpperInvariant();
            if (cod.Length == 0) throw new AppException("Escriba o escanee el código de la cita.");
            var c = _db.Citas.FirstOrDefault(x => x.Codigo == cod)
                    ?? throw new AppException("Código no válido: no existe una cita con ese código.", 404);

            if (c.Estado == EstadoCita.Cancelada) throw new AppException("Esta cita fue cancelada.");
            if (c.Estado == EstadoCita.Atendida)
                throw new AppException($"Este código ya fue validado el {c.ValidadaEn:dd/MM/yyyy HH:mm}.");
            if (c.Inicio.Date != DateTime.Today)
                throw new AppException($"La cita es para el {c.Inicio:dd/MM/yyyy} a las {c.Inicio:HH:mm}, no para hoy.");

            c.Estado = EstadoCita.Atendida;
            c.ValidadaEn = DateTime.Now;
            Save();
            return DetalleCita(c);
        }
    }

    public object Resumen()
    {
        lock (_lock)
        {
            var hoy = DateTime.Today;
            var ahora = DateTime.Now;
            var deHoy = _db.Citas.Where(c => c.Inicio.Date == hoy && c.Estado != EstadoCita.Cancelada).ToList();
            return new
            {
                CitasHoy = deHoy.Count,
                AtendidasHoy = deHoy.Count(c => c.Estado == EstadoCita.Atendida),
                MontoAtendidoHoy = deHoy.Where(c => c.Estado == EstadoCita.Atendida).Sum(c => c.Total),
                Proximas = _db.Citas.Count(c => c.Estado == EstadoCita.Reservada && c.Inicio > ahora),
                Clientes = _db.Usuarios.Count(u => u.Rol == Roles.Usuario),
                Premium = _db.Usuarios.Count(u => u.Rol == Roles.Usuario && u.Premium),
                AgendaHoy = deHoy.OrderBy(c => c.Inicio).Select(DetalleCita).ToList()
            };
        }
    }

    // ───────────────────────── Chat ─────────────────────────
    public Mensaje AddMensaje(int clienteId, bool deAdmin, string emisor, string? texto)
    {
        lock (_lock)
        {
            if (!_db.Usuarios.Any(u => u.Id == clienteId && u.Rol == Roles.Usuario))
                throw new AppException("Cliente no encontrado.", 404);
            var t = (texto ?? "").Trim();
            if (t.Length == 0) throw new AppException("Escriba un mensaje.");
            if (t.Length > 1000) throw new AppException("El mensaje no puede superar 1000 caracteres.");

            var m = new Mensaje
            {
                Id = NextId(_db.Mensajes, x => x.Id),
                ClienteId = clienteId, DeAdmin = deAdmin, Emisor = emisor, Texto = t
            };
            _db.Mensajes.Add(m);
            Save();
            return m;
        }
    }

    public List<Mensaje> Historial(int clienteId)
    {
        lock (_lock)
            return _db.Mensajes.Where(m => m.ClienteId == clienteId)
                .OrderByDescending(m => m.Id).Take(200).OrderBy(m => m.Id).ToList();
    }

    public object Conversaciones()
    {
        lock (_lock)
            return _db.Mensajes.GroupBy(m => m.ClienteId).Select(g =>
            {
                var ultimo = g.OrderByDescending(m => m.Id).First();
                var u = _db.Usuarios.FirstOrDefault(x => x.Id == g.Key);
                return new
                {
                    ClienteId = g.Key, Cliente = u?.Nombre ?? "—", Premium = u?.Premium ?? false,
                    UltimoTexto = ultimo.Texto, UltimaFecha = ultimo.Fecha, UltimoDeAdmin = ultimo.DeAdmin
                };
            }).OrderByDescending(x => x.UltimaFecha).ToList();
    }

    public List<object> ClientesParaChat()
    {
        lock (_lock)
            return _db.Usuarios.Where(u => u.Rol == Roles.Usuario && u.Activo).OrderBy(u => u.Nombre)
                .Select(u => (object)new { u.Id, u.Nombre }).ToList();
    }

    // ───────────────────────── Datos iniciales ─────────────────────────
    private void Seed()
    {
        _db.Config.NombreNegocio = "Barbería";

        void Cuenta(string nombre, string email, string pwd, string rol, bool premium = false)
        {
            var (h, s) = PasswordHasher.Hash(pwd);
            _db.Usuarios.Add(new Usuario
            {
                Id = NextId(_db.Usuarios, x => x.Id), Nombre = nombre, Email = email, Rol = rol,
                Premium = premium, PasswordHash = h, Salt = s
            });
        }
        // ¡Cambie estas contraseñas al iniciar por primera vez!
        Cuenta("Administrador", "admin@barberia.com", "Admin12345", Roles.Admin);
        Cuenta("Cliente de prueba", "cliente@demo.com", "Cliente12345", Roles.Usuario, true);

        _db.Locales.Add(new Local { Id = 1, Nombre = "Sucursal Centro", Direccion = "Calle Principal 123, Centro", Telefono = "2222-0001", Horario = "Lun–Sáb 9:00–19:00" });
        _db.Locales.Add(new Local { Id = 2, Nombre = "Sucursal Norte", Direccion = "Avenida Norte 456, Plaza Norte", Telefono = "2222-0002", Horario = "Lun–Sáb 10:00–20:00" });

        List<HorarioDia> LunSab(string ini, string fin) => Enumerable.Range(1, 6)
            .Select(d => new HorarioDia { Dia = (DayOfWeek)d, Inicio = ini, Fin = fin }).ToList();

        _db.Barberos.Add(new Barbero { Id = 1, LocalId = 1, Nombre = "Carlos", Horario = LunSab("09:00", "18:00") });
        _db.Barberos.Add(new Barbero { Id = 2, LocalId = 1, Nombre = "Miguel", Horario = LunSab("10:00", "19:00") });
        _db.Barberos.Add(new Barbero { Id = 3, LocalId = 2, Nombre = "Andrés", Horario = LunSab("10:00", "19:00") });

        _db.Cortes.Add(new Corte { Id = 1, Nombre = "Corte clásico", Descripcion = "Corte a tijera o máquina con acabado limpio.", Precio = 8, DuracionMin = 30 });
        _db.Cortes.Add(new Corte { Id = 2, Nombre = "Degradado (fade)", Descripcion = "Degradado bajo, medio o alto con perfilado.", Precio = 10, DuracionMin = 45 });
        _db.Cortes.Add(new Corte { Id = 3, Nombre = "Corte y barba", Descripcion = "Corte completo más arreglo y perfilado de barba.", Precio = 14, DuracionMin = 60 });
        _db.Cortes.Add(new Corte { Id = 4, Nombre = "Arreglo de barba", Descripcion = "Perfilado y rebajado de barba con toalla caliente.", Precio = 6, DuracionMin = 20 });

        _db.MetodosPago.Add(new MetodoPago { Id = 1, Nombre = "Efectivo" });
        _db.MetodosPago.Add(new MetodoPago { Id = 2, Nombre = "Tarjeta" });
        _db.MetodosPago.Add(new MetodoPago { Id = 3, Nombre = "Transferencia" });
    }
}
