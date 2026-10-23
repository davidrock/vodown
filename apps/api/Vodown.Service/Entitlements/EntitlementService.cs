using Vodown.Service.Subscriptions;
using Vodown.Shared.Domain;
namespace Vodown.Service.Entitlements;
public sealed class EntitlementService(ISubscriptionRepository subscriptions, TimeProvider clock)
{
    public async Task<Entitlements> GetAsync(UserId userId, CancellationToken cancellationToken)
    {
        var subscription = await subscriptions.FindByUserAsync(userId, cancellationToken);
        var pro=subscription?.GrantsProAt(clock.GetUtcNow())==true || await subscriptions.HasLifetimeLicenseAsync(userId,cancellationToken);
        return pro ? Entitlements.Pro : Entitlements.Free;
    }
}
