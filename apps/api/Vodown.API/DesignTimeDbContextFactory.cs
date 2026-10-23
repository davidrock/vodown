using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Vodown.Repository;
namespace Vodown.API;
public sealed class DesignTimeDbContextFactory : IDesignTimeDbContextFactory<VodownDbContext>
{
    public VodownDbContext CreateDbContext(string[] args)
    {
        var connection = Environment.GetEnvironmentVariable("ConnectionStrings__Vodown");
        // Creating SQL/migrations does not connect. Applying them requires an explicit real connection.
        return new(new DbContextOptionsBuilder<VodownDbContext>().UseNpgsql(connection ?? "Host=localhost;Database=vodown",npgsql=>npgsql.MigrationsHistoryTable("__EFMigrationsHistory","vodown")).Options);
    }
}
