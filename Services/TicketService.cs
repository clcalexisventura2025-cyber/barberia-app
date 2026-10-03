using System.Globalization;
using Barberia.Models;
using QRCoder;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace Barberia.Services;

public static class TicketService
{
    static TicketService()
    {
        // Licencia Community de QuestPDF (revisar condiciones en el README).
        QuestPDF.Settings.License = LicenseType.Community;
    }

    public static byte[] QrPng(string contenido)
    {
        using var generador = new QRCodeGenerator();
        var datos = generador.CreateQrCode(contenido, QRCodeGenerator.ECCLevel.Q);
        using var qr = new PngByteQRCode(datos);
        return qr.GetGraphic(12);
    }

    private static CultureInfo Cultura()
    {
        try { return CultureInfo.GetCultureInfo("es"); }
        catch (CultureNotFoundException) { return CultureInfo.InvariantCulture; }
    }

    private static string Money(decimal v) => "$" + v.ToString("0.00", CultureInfo.InvariantCulture);

    public static byte[] Pdf(TicketData t)
    {
        var c = t.Cita;
        var qr = QrPng(c.Codigo);
        var es = Cultura();

        return Document.Create(doc =>
        {
            doc.Page(page =>
            {
                page.Size(80, 235, Unit.Millimetre);
                page.Margin(14);
                page.DefaultTextStyle(x => x.FontSize(9));

                page.Content().Column(col =>
                {
                    col.Spacing(5);

                    col.Item().AlignCenter().Text(t.Negocio).Bold().FontSize(15);
                    col.Item().AlignCenter().Text("Ticket de cita").FontSize(10);
                    col.Item().PaddingVertical(2).LineHorizontal(1);

                    void Fila(string k, string v) => col.Item().Row(r =>
                    {
                        r.RelativeItem(2).Text(k).SemiBold();
                        r.RelativeItem(3).AlignRight().Text(v);
                    });

                    Fila("Ticket N.º", c.Id.ToString("D6"));
                    Fila("Cliente", t.Cliente + (t.Premium ? " (Premium)" : ""));
                    Fila("Fecha", c.Inicio.ToString("dddd d 'de' MMMM yyyy", es));
                    Fila("Hora", $"{c.Inicio:HH:mm} – {c.Fin:HH:mm}");
                    Fila("Local", t.Local);
                    Fila("Dirección", t.Direccion);
                    Fila("Barbero", t.Barbero);
                    Fila("Corte", t.Corte);
                    Fila("Duración", $"{t.DuracionMin} min");

                    col.Item().PaddingVertical(2).LineHorizontal(1);

                    Fila("Precio", Money(c.Precio));
                    if (c.DescuentoPct > 0)
                        Fila($"Descuento premium ({c.DescuentoPct:0.##}%)", "-" + Money(c.Precio - c.Total));
                    col.Item().Row(r =>
                    {
                        r.RelativeItem().Text("Total").Bold().FontSize(12);
                        r.RelativeItem().AlignRight().Text(Money(c.Total)).Bold().FontSize(12);
                    });
                    Fila("Forma de pago", t.Metodo);

                    col.Item().PaddingVertical(2).LineHorizontal(1);

                    col.Item().AlignCenter().Width(120).Image(qr);
                    col.Item().AlignCenter().Text(c.Codigo).Bold().FontSize(11);
                    col.Item().AlignCenter().Text("Presente este código al llegar al local.").FontSize(8);
                    col.Item().AlignCenter().Text("Será validado por el administrador.").FontSize(8);
                });
            });
        }).GeneratePdf();
    }
}
