using Microsoft.EntityFrameworkCore;
using Npgsql;
using Vodown.Repository;
using Vodown.Service.Subscriptions;
using Vodown.Shared.Domain;
using Xunit;
namespace Vodown.Tests;

[Collection("PostgreSQL")]
public sealed class PostgresTests
{
    [PostgresFact]
    public async Task MigrationAndRepositoryRoundTripKeepRichDomainBehavior()
    {
        await using var db = CreateDb();
        await db.Database.MigrateAsync();
        var userId = new UserId(Guid.NewGuid());
        var subscription = new Subscription(userId, $"sub_{userId.Value:N}", $"cus_{userId.Value:N}");
        var now = DateTimeOffset.UtcNow;
        subscription.Synchronize(SubscriptionStatus.Active, now.AddDays(2), true, now);
        db.Subscriptions.Add(subscription);
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();
        try
        {
            var loaded = await new SubscriptionRepository(db).FindByUserAsync(userId, default);
            Assert.NotNull(loaded);
            Assert.True(loaded.GrantsProAt(now));
            Assert.False(loaded.GrantsProAt(now.AddDays(3)));
            Assert.True(loaded.CancelAtPeriodEnd);
            Assert.Null(await new SubscriptionRepository(db).FindByUserAsync(new(Guid.NewGuid()), default));
        }
        finally { await db.Subscriptions.Where(x => x.UserId == userId).ExecuteDeleteAsync(); }
    }
    [PostgresFact]
    public async Task BillingTableHasRowLevelSecurityEnabled()
    {
        await using var db = CreateDb();
        await db.Database.MigrateAsync();
        await using var connection = new NpgsqlConnection(Environment.GetEnvironmentVariable("VODOWN_TEST_DATABASE"));
        await connection.OpenAsync();
        foreach (var table in new[] { "subscriptions", "billing_customers", "lifetime_licenses", "processed_billing_events" })
        {
            await using var command = new NpgsqlCommand("SELECT relrowsecurity FROM pg_class WHERE oid = @table::regclass", connection);
            command.Parameters.AddWithValue("table", $"vodown.{table}");
            Assert.Equal(true, await command.ExecuteScalarAsync());
        }
    }
    private static VodownDbContext CreateDb() => new(new DbContextOptionsBuilder<VodownDbContext>()
        .UseNpgsql(Environment.GetEnvironmentVariable("VODOWN_TEST_DATABASE"),npgsql=>npgsql.MigrationsHistoryTable("__EFMigrationsHistory","vodown")).Options);
}
public sealed class PostgresFactAttribute : FactAttribute
{
    public PostgresFactAttribute()
    { if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("VODOWN_TEST_DATABASE"))) Skip = "Set VODOWN_TEST_DATABASE to an isolated local PostgreSQL database."; }
}
