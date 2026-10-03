using Barberia.Models;
using Barberia.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace Barberia.Hubs;

/// <summary>
/// Chat en tiempo real. Cada cliente tiene su propia conversación con el equipo:
/// los clientes escriben con Enviar(), los administradores responden con Responder().
/// </summary>
[Authorize]
public class ChatHub(DataStore store) : Hub
{
    public override async Task OnConnectedAsync()
    {
        var user = Context.User!;
        var grupo = user.IsAdmin() ? "admins" : $"u-{user.Id()}";
        await Groups.AddToGroupAsync(Context.ConnectionId, grupo);
        await base.OnConnectedAsync();
    }

    public async Task Enviar(string texto)
    {
        var user = Context.User!;
        if (user.IsAdmin())
            throw new HubException("Los administradores responden desde la bandeja de chat.");

        Mensaje m;
        try { m = store.AddMensaje(user.Id(), false, user.Identity!.Name!, texto); }
        catch (AppException ex) { throw new HubException(ex.Message); }

        await Clients.Groups("admins", $"u-{user.Id()}").SendAsync("mensaje", m);
    }

    public async Task Responder(int clienteId, string texto)
    {
        var user = Context.User!;
        if (!user.IsAdmin()) throw new HubException("No autorizado.");

        Mensaje m;
        try { m = store.AddMensaje(clienteId, true, user.Identity!.Name!, texto); }
        catch (AppException ex) { throw new HubException(ex.Message); }

        await Clients.Groups("admins", $"u-{clienteId}").SendAsync("mensaje", m);
    }
}
