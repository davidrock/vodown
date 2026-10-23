using Microsoft.Extensions.Diagnostics.HealthChecks;
using Vodown.Repository;
namespace Vodown.API;
public sealed class DatabaseHealthCheck(IServiceScopeFactory scopeFactory) : IHealthCheck
{
    public async Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken cancellationToken = default)
    {
        try
        {
            using var scope = scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<VodownDbContext>();
            // Query the actual table, so a reachable but unmigrated database is not ready.
            await Microsoft.EntityFrameworkCore.EntityFrameworkQueryableExtensions.AnyAsync(db.Subscriptions, cancellationToken);
            return HealthCheckResult.Healthy();
        }
        catch { return HealthCheckResult.Unhealthy(); }
    }
}
