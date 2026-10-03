# 1. Imagen base con el SDK de .NET para compilar
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# Copiar el archivo del proyecto y restaurar paquetes NuGet
COPY ["Barberia.csproj", "./"]
RUN dotnet restore "Barberia.csproj"

# Copiar todo el código fuente y compilar
COPY . .
RUN dotnet build "Barberia.csproj" -c Release -o /app/build

# 2. Publicar la aplicación
FROM build AS publish
RUN dotnet publish "Barberia.csproj" -c Release -o /app/publish /p:UseAppHost=false

# 3. Imagen ligera de runtime para ejecutar la app
FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS final
WORKDIR /app
COPY --from=publish /app/publish .

# Exponer el puerto del servidor
EXPOSE 8080
ENV ASPNETCORE_URLS=http://+:8080

ENTRYPOINT ["dotnet", "Barberia.dll"]