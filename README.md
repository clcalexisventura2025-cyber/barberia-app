# Sistema de citas para barberías

ASP.NET Core 8 + interfaz web (HTML/CSS/JS). Datos en archivo JSON. Chat en tiempo real con SignalR.

## Requisitos
- .NET SDK 8.0 o superior
- Conexión a internet la primera vez (`dotnet run` descarga QuestPDF y QRCoder desde NuGet)

## Ejecutar
```bash
cd Barberia
dotnet run
```
Abra la URL que muestre la consola (por ejemplo http://localhost:5000).

## Cuentas iniciales (¡cámbielas!)
| Rol | Correo | Contraseña |
|---|---|---|
| Administrador | admin@barberia.com | Admin12345 |
| Usuario premium de prueba | cliente@demo.com | Cliente12345 |

Para empezar sin datos de ejemplo, detenga la app y borre la carpeta `App_Data`
(se vuelve a crear con las cuentas iniciales). Cree otro admin, cambie o desactive el inicial.

## Qué incluye
**Rol Usuario**
- Se registra solo (correo y contraseña).
- Ve información, locales (dirección, teléfono, horario, fotos) y cortes con precios.
- Reserva: local → barbero → corte → fecha y hora libre → forma de pago.
- Si es premium, ve y recibe el descuento porcentual configurado.
- Descarga el ticket en PDF (con QR) y puede cancelar citas futuras.
- Chat de ayuda en tiempo real con el equipo (botón flotante).

**Rol Admin**
- Resumen del día, citas (filtro por fecha, local y estado) y validación del QR al llegar el cliente.
- Gestión de cortes y precios (con foto subida desde el sistema), locales, barberos con horario semanal,
  clientes (marcar/quitar premium), usuarios (crear admins, activar/desactivar), formas de pago y configuración.
- Bandeja de chat con todos los clientes.

## Reglas de negocio
- Cada cita dura lo que dura el corte elegido; se ofrecen horarios cada N minutos (configurable) dentro del
  horario semanal del barbero, sin traslapar otras citas.
- El descuento premium se guarda en la cita al reservarla; cambios posteriores no la afectan.
- Validar un QR solo funciona el día de la cita y una única vez; marca la cita como "Atendida".
- Las formas de pago solo se registran (no hay cobro en línea).
- Los cortes, locales, barberos y formas de pago no se borran: se desactivan.
- No se puede quitar el último administrador activo ni desactivarse a uno mismo.

## Estructura
- `Program.cs` – endpoints, autenticación por cookie y roles
- `Models/` – entidades y DTOs
- `Services/DataStore.cs` – lógica de negocio y persistencia JSON (`App_Data/data.json`)
- `Services/TicketService.cs` – ticket PDF (QuestPDF) y QR (QRCoder)
- `Hubs/ChatHub.cs` – chat en tiempo real
- `wwwroot/` – interfaz; fotos subidas en `wwwroot/uploads`

## Notas para producción
- Use HTTPS (la cámara para escanear QR solo funciona en HTTPS o localhost; el escaneo con cámara requiere
  un navegador con `BarcodeDetector`, como Chrome/Edge. Un lector USB de QR funciona en cualquier navegador).
- Respalde `App_Data/` y `wwwroot/uploads/`.
- QuestPDF usa licencia Community (gratuita según condiciones de ingresos): https://www.questpdf.com/license
- El archivo JSON sirve para un negocio pequeño con una sola instancia. Para más carga, migre `DataStore`
  a Entity Framework Core con SQL Server o PostgreSQL.
- Pendiente (no incluido): recuperación de contraseña, límite de intentos de inicio de sesión, notificaciones por correo.
