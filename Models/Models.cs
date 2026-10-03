namespace Barberia.Models;

public static class Roles
{
    public const string Admin = "Admin";
    public const string Usuario = "Usuario";
}

public static class EstadoCita
{
    public const string Reservada = "Reservada";
    public const string Atendida = "Atendida";
    public const string Cancelada = "Cancelada";
}

/// <summary>Error de negocio que se devuelve al cliente como JSON { error } con el código indicado.</summary>
public class AppException(string message, int status = 400) : Exception(message)
{
    public int Status { get; } = status;
}

public class Usuario
{
    public int Id { get; set; }
    public string Nombre { get; set; } = "";
    public string Email { get; set; } = "";
    public string? Telefono { get; set; }
    public string Rol { get; set; } = Roles.Usuario;
    public bool Premium { get; set; }
    public bool Activo { get; set; } = true;
    public string PasswordHash { get; set; } = "";
    public string Salt { get; set; } = "";
    public DateTime CreadoEn { get; set; } = DateTime.Now;
}

public class Local
{
    public int Id { get; set; }
    public string Nombre { get; set; } = "";
    public string Direccion { get; set; } = "";
    public string? Telefono { get; set; }
    public string? Horario { get; set; }     // texto informativo, p. ej. "Lun–Sáb 9:00–19:00"
    public string? FotoUrl { get; set; }
    public bool Activo { get; set; } = true;
}

public class HorarioDia
{
    public DayOfWeek Dia { get; set; }       // 0 = domingo … 6 = sábado
    public string Inicio { get; set; } = "09:00";
    public string Fin { get; set; } = "18:00";
}

public class Barbero
{
    public int Id { get; set; }
    public int LocalId { get; set; }
    public string Nombre { get; set; } = "";
    public bool Activo { get; set; } = true;
    public List<HorarioDia> Horario { get; set; } = new();
}

public class Corte
{
    public int Id { get; set; }
    public string Nombre { get; set; } = "";
    public string? Descripcion { get; set; }
    public decimal Precio { get; set; }
    public int DuracionMin { get; set; } = 30;
    public string? FotoUrl { get; set; }
    public bool Activo { get; set; } = true;   // "disponible para reservar"
}

public class MetodoPago
{
    public int Id { get; set; }
    public string Nombre { get; set; } = "";
    public bool Activo { get; set; } = true;
}

public class Cita
{
    public int Id { get; set; }
    public string Codigo { get; set; } = "";   // contenido del QR
    public int UsuarioId { get; set; }
    public int LocalId { get; set; }
    public int BarberoId { get; set; }
    public int CorteId { get; set; }
    public DateTime Inicio { get; set; }
    public DateTime Fin { get; set; }
    public decimal Precio { get; set; }
    public decimal DescuentoPct { get; set; }
    public decimal Total { get; set; }
    public int MetodoPagoId { get; set; }
    public string Estado { get; set; } = EstadoCita.Reservada;
    public DateTime CreadaEn { get; set; } = DateTime.Now;
    public DateTime? ValidadaEn { get; set; }
}

public class Mensaje
{
    public int Id { get; set; }
    public int ClienteId { get; set; }          // la conversación pertenece a este cliente
    public bool DeAdmin { get; set; }
    public string Emisor { get; set; } = "";
    public string Texto { get; set; } = "";
    public DateTime Fecha { get; set; } = DateTime.Now;
}

public class Config
{
    public string NombreNegocio { get; set; } = "Barbería";
    public decimal DescuentoPremiumPct { get; set; } = 10;
    public int PasoMinutos { get; set; } = 15;  // intervalo entre horarios ofrecidos
}

public class Database
{
    public List<Usuario> Usuarios { get; set; } = new();
    public List<Local> Locales { get; set; } = new();
    public List<Barbero> Barberos { get; set; } = new();
    public List<Corte> Cortes { get; set; } = new();
    public List<MetodoPago> MetodosPago { get; set; } = new();
    public List<Cita> Citas { get; set; } = new();
    public List<Mensaje> Mensajes { get; set; } = new();
    public Config Config { get; set; } = new();
}

/// <summary>Datos necesarios para dibujar el ticket PDF.</summary>
public record TicketData(
    Cita Cita, string Negocio, string Cliente, bool Premium, string Local,
    string Direccion, string Barbero, string Corte, int DuracionMin, string Metodo);

// ───────── DTOs de entrada ─────────
public record LoginDto(string? Email, string? Password);
public record RegistroDto(string? Nombre, string? Email, string? Telefono, string? Password);
public record UsuarioAdminDto(string? Nombre, string? Email, string? Telefono, string? Rol, string? Password, bool Activo);
public record LocalDto(string? Nombre, string? Direccion, string? Telefono, string? Horario, string? FotoUrl, bool Activo);
public record BarberoDto(int LocalId, string? Nombre, bool Activo, List<HorarioDia>? Horario);
public record CorteDto(string? Nombre, string? Descripcion, decimal Precio, int DuracionMin, string? FotoUrl, bool Activo);
public record MetodoPagoDto(string? Nombre, bool Activo);
public record ConfigDto(string? NombreNegocio, decimal DescuentoPremiumPct, int PasoMinutos);
public record NuevaCitaDto(int BarberoId, int CorteId, string? Fecha, string? Hora, int MetodoPagoId);
public record ValidarDto(string? Codigo);
public record PremiumDto(bool Premium);
