using System.Security.Claims;
using Barberia.Hubs;
using Barberia.Models;
using Barberia.Services;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSingleton<DataStore>();
builder.Services.AddSignalR();

builder.Services
    .AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(o =>
    {
        o.Cookie.Name = "barberia.auth";
        o.Cookie.HttpOnly = true;
        o.Cookie.SameSite = SameSiteMode.Lax;
        o.ExpireTimeSpan = TimeSpan.FromHours(8);
        o.SlidingExpiration = true;

        // La API responde 401/403 en vez de redirigir a una página de login.
        o.Events.OnRedirectToLogin = ctx => { ctx.Response.StatusCode = 401; return Task.CompletedTask; };
        o.Events.OnRedirectToAccessDenied = ctx => { ctx.Response.StatusCode = 403; return Task.CompletedTask; };

        // Si la cuenta se desactiva o cambia de rol, la sesión abierta deja de ser válida.
        o.Events.OnValidatePrincipal = async ctx =>
        {
            var store = ctx.HttpContext.RequestServices.GetRequiredService<DataStore>();
            var principal = ctx.Principal!;
            var u = store.GetUsuario(principal.Id());
            if (u is null || !u.Activo || u.Rol != principal.FindFirstValue(ClaimTypes.Role))
            {
                ctx.RejectPrincipal();
                await ctx.HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            }
        };
    });

builder.Services.AddAuthorizationBuilder()
    .AddPolicy("Admin", p => p.RequireRole(Roles.Admin));

var app = builder.Build();

// Convierte los errores de negocio en respuestas JSON { error }.
app.Use(async (ctx, next) =>
{
    try { await next(); }
    catch (AppException ex)
    {
        ctx.Response.StatusCode = ex.Status;
        await ctx.Response.WriteAsJsonAsync(new { error = ex.Message });
    }
});

app.UseDefaultFiles();
app.UseStaticFiles();
app.UseAuthentication();
app.UseAuthorization();

app.MapHub<ChatHub>("/hubs/chat");

var api = app.MapGroup("/api");

// ───────── Público ─────────
api.MapGet("/info", (DataStore s) => s.Info());

// ───────── Autenticación ─────────
var auth = api.MapGroup("/auth");
auth.MapPost("/registro", async (RegistroDto d, DataStore s, HttpContext ctx) =>
{
    var u = s.Registrar(d);
    await ctx.SignInUser(u);
    return Results.Ok(s.Perfil(u.Id));
});
auth.MapPost("/login", async (LoginDto d, DataStore s, HttpContext ctx) =>
{
    var u = s.Login(d.Email, d.Password);
    await ctx.SignInUser(u);
    return Results.Ok(s.Perfil(u.Id));
});
auth.MapPost("/logout", async (HttpContext ctx) =>
{
    await ctx.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
    return Results.NoContent();
});
auth.MapGet("/me", (ClaimsPrincipal u, DataStore s) => Results.Ok(s.Perfil(u.Id()))).RequireAuthorization();

// ───────── Usuario autenticado ─────────
var priv = api.MapGroup("").RequireAuthorization();

priv.MapGet("/locales", (DataStore s) => s.ListLocales(true));
priv.MapGet("/cortes", (DataStore s) => s.ListCortes(true));
priv.MapGet("/barberos", (DataStore s, int? localId) => s.ListBarberos(true, localId));
priv.MapGet("/metodos-pago", (DataStore s) => s.ListMetodos(true));
priv.MapGet("/disponibilidad", (DataStore s, int barberoId, int corteId, DateOnly fecha) =>
    s.Disponibilidad(barberoId, corteId, fecha));

priv.MapPost("/citas", (NuevaCitaDto d, ClaimsPrincipal u, DataStore s) => Results.Ok(s.CrearCita(u.Id(), d)));
priv.MapGet("/citas/mias", (ClaimsPrincipal u, DataStore s) => s.MisCitas(u.Id()));
priv.MapPost("/citas/{id:int}/cancelar", (int id, ClaimsPrincipal u, DataStore s) =>
{
    s.Cancelar(id, u.Id(), u.IsAdmin());
    return Results.NoContent();
});
priv.MapGet("/citas/{id:int}/ticket", (int id, ClaimsPrincipal u, DataStore s) =>
{
    var t = s.DatosTicket(id, u.Id(), u.IsAdmin());
    return Results.File(TicketService.Pdf(t), "application/pdf", $"ticket-{t.Cita.Codigo}.pdf");
});
priv.MapGet("/citas/{id:int}/qr", (int id, ClaimsPrincipal u, DataStore s) =>
    Results.File(TicketService.QrPng(s.CodigoDeCita(id, u.Id(), u.IsAdmin())), "image/png"));

priv.MapGet("/chat", (ClaimsPrincipal u, DataStore s) => s.Historial(u.Id()));

// ───────── Administración ─────────
var admin = api.MapGroup("/admin").RequireAuthorization("Admin");

admin.MapGet("/resumen", (DataStore s) => s.Resumen());

admin.MapGet("/usuarios", (DataStore s) => s.ListUsuarios());
admin.MapPost("/usuarios", (UsuarioAdminDto d, DataStore s) => Results.Ok(s.CrearUsuarioAdmin(d)));
admin.MapPut("/usuarios/{id:int}", (int id, UsuarioAdminDto d, ClaimsPrincipal u, DataStore s) =>
    Results.Ok(s.ActualizarUsuario(id, d, u.Id())));

admin.MapGet("/clientes", (DataStore s) => s.ListClientes());
admin.MapPut("/clientes/{id:int}/premium", (int id, PremiumDto d, DataStore s) =>
{
    s.SetPremium(id, d.Premium);
    return Results.NoContent();
});

admin.MapGet("/locales", (DataStore s) => s.ListLocales(false));
admin.MapPost("/locales", (LocalDto d, DataStore s) => Results.Ok(s.GuardarLocal(null, d)));
admin.MapPut("/locales/{id:int}", (int id, LocalDto d, DataStore s) => Results.Ok(s.GuardarLocal(id, d)));

admin.MapGet("/barberos", (DataStore s) => s.ListBarberos(false));
admin.MapPost("/barberos", (BarberoDto d, DataStore s) => Results.Ok(s.GuardarBarbero(null, d)));
admin.MapPut("/barberos/{id:int}", (int id, BarberoDto d, DataStore s) => Results.Ok(s.GuardarBarbero(id, d)));

admin.MapGet("/cortes", (DataStore s) => s.ListCortes(false));
admin.MapPost("/cortes", (CorteDto d, DataStore s) => Results.Ok(s.GuardarCorte(null, d)));
admin.MapPut("/cortes/{id:int}", (int id, CorteDto d, DataStore s) => Results.Ok(s.GuardarCorte(id, d)));

admin.MapGet("/metodos-pago", (DataStore s) => s.ListMetodos(false));
admin.MapPost("/metodos-pago", (MetodoPagoDto d, DataStore s) => Results.Ok(s.GuardarMetodo(null, d)));
admin.MapPut("/metodos-pago/{id:int}", (int id, MetodoPagoDto d, DataStore s) => Results.Ok(s.GuardarMetodo(id, d)));

admin.MapGet("/config", (DataStore s) => s.GetConfig());
admin.MapPut("/config", (ConfigDto d, DataStore s) => Results.Ok(s.GuardarConfig(d)));

admin.MapGet("/citas", (DataStore s, DateOnly? fecha, int? localId, string? estado) => s.CitasAdmin(fecha, localId, estado));
admin.MapPost("/citas/validar", (ValidarDto d, DataStore s) => Results.Ok(s.Validar(d.Codigo)));

admin.MapGet("/chat/conversaciones", (DataStore s) => s.Conversaciones());
admin.MapGet("/chat/clientes", (DataStore s) => s.ClientesParaChat());
admin.MapGet("/chat/{clienteId:int}", (int clienteId, DataStore s) => s.Historial(clienteId));

// Subida de fotos (cortes y locales). Se lee el formulario a mano para no requerir antiforgery.
admin.MapPost("/upload", async (HttpRequest req, IWebHostEnvironment env) =>
{
    if (!req.HasFormContentType) throw new AppException("Envíe la imagen como formulario.");
    var form = await req.ReadFormAsync();
    var file = form.Files.GetFile("file") ?? throw new AppException("Seleccione una imagen.");

    if (file.Length == 0 || file.Length > 5 * 1024 * 1024)
        throw new AppException("La imagen debe pesar menos de 5 MB.");

    var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
    if (ext is not (".jpg" or ".jpeg" or ".png" or ".webp"))
        throw new AppException("Solo se permiten imágenes JPG, PNG o WEBP.");

    await using var entrada = file.OpenReadStream();
    if (!ImageSniffer.IsImage(entrada, ext))
        throw new AppException("El archivo no parece ser una imagen válida.");

    var dir = Path.Combine(env.WebRootPath, "uploads");
    Directory.CreateDirectory(dir);
    var nombre = $"{Guid.NewGuid():N}{ext}";
    await using (var salida = File.Create(Path.Combine(dir, nombre)))
        await entrada.CopyToAsync(salida);

    return Results.Ok(new { url = "/uploads/" + nombre });
});

app.Run();
