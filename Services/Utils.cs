using System.Security.Claims;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Barberia.Models;

namespace Barberia.Services;

/// <summary>Hash de contraseñas con PBKDF2-SHA256 y sal aleatoria.</summary>
public static class PasswordHasher
{
    private const int Iteraciones = 100_000;

    public static (string hash, string salt) Hash(string password)
    {
        var salt = RandomNumberGenerator.GetBytes(16);
        var hash = Rfc2898DeriveBytes.Pbkdf2(password, salt, Iteraciones, HashAlgorithmName.SHA256, 32);
        return (Convert.ToBase64String(hash), Convert.ToBase64String(salt));
    }

    public static bool Verify(string password, string hash, string salt)
    {
        var calculado = Rfc2898DeriveBytes.Pbkdf2(
            password, Convert.FromBase64String(salt), Iteraciones, HashAlgorithmName.SHA256, 32);
        return CryptographicOperations.FixedTimeEquals(calculado, Convert.FromBase64String(hash));
    }
}

/// <summary>Comprueba la firma real del archivo (no solo la extensión).</summary>
public static class ImageSniffer
{
    public static bool IsImage(Stream s, string ext)
    {
        Span<byte> h = stackalloc byte[12];
        var n = s.Read(h);
        s.Position = 0;
        if (n < 12) return false;
        return ext switch
        {
            ".jpg" or ".jpeg" => h[0] == 0xFF && h[1] == 0xD8 && h[2] == 0xFF,
            ".png" => h[0] == 0x89 && h[1] == 0x50 && h[2] == 0x4E && h[3] == 0x47,
            ".webp" => h[0] == 'R' && h[1] == 'I' && h[2] == 'F' && h[3] == 'F'
                       && h[8] == 'W' && h[9] == 'E' && h[10] == 'B' && h[11] == 'P',
            _ => false
        };
    }
}

public static class AuthExtensions
{
    public static int Id(this ClaimsPrincipal u) => int.Parse(u.FindFirstValue(ClaimTypes.NameIdentifier)!);
    public static bool IsAdmin(this ClaimsPrincipal u) => u.IsInRole(Roles.Admin);

    public static Task SignInUser(this HttpContext ctx, Usuario u)
    {
        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, u.Id.ToString()),
            new(ClaimTypes.Name, u.Nombre),
            new(ClaimTypes.Role, u.Rol)
        };
        var identity = new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme);
        return ctx.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, new ClaimsPrincipal(identity));
    }
}
