using Vodown.Shared.Domain;
namespace Vodown.Service.Subscriptions;
public interface ISubscriptionRepository
{
    Task<Subscription?> FindByUserAsync(UserId userId, CancellationToken cancellationToken);
    Task<bool> HasLifetimeLicenseAsync(UserId userId,CancellationToken cancellationToken);
}
