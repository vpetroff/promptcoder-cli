# ASP.NET Core App Dockerfile
FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS base
WORKDIR /app
EXPOSE 5000

FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

# Copy project files
COPY *.sln ./
COPY *.csproj ./
COPY *.fsproj ./
COPY *.vbproj ./

# Restore dependencies
RUN dotnet restore

# Copy all source code
COPY . .

# Build the application
RUN dotnet build -c Release -o /app/build

FROM build AS publish
RUN dotnet publish -c Release -o /app/publish

FROM base AS final
WORKDIR /app
COPY --from=publish /app/publish .

# Configure to listen on all interfaces
ENV ASPNETCORE_URLS=http://+:5000

ENTRYPOINT ["dotnet"]
CMD ["$(ls *.dll | head -n1)"]