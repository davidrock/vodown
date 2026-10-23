using Microsoft.EntityFrameworkCore;
using Vodown.Service.Subscriptions;
using Vodown.Shared.Domain;
namespace Vodown.Repository;
public sealed class SubscriptionRepository(VodownDbContext db) : ISubscriptionRepository
{
    public Task<Subscription?> FindByUserAsync(UserId userId, CancellationToken cancellationToken) =>
        db.Subscriptions.AsNoTracking().SingleOrDefaultAsync(x => x.UserId == userId, cancellationToken);
    public Task<bool> HasLifetimeLicenseAsync(UserId userId,CancellationToken ct) => db.LifetimeLicenses.AnyAsync(x=>x.UserId==userId && x.IsValid,ct);
}
