using Vodown.Service.Entitlements;
using Vodown.Service.Subscriptions;
using Vodown.Shared.Domain;
using Xunit;
namespace Vodown.Tests;
public sealed class EntitlementTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 22, 12, 0, 0, TimeSpan.Zero);
    [Fact] public void FreePermitsOnlyOneExtensionLesson()
    {
        Assert.True(Entitlements.Free.Allows(new(DownloadClient.Extension, 1)));
        Assert.False(Entitlements.Free.Allows(new(DownloadClient.Extension, 2)));
        Assert.False(Entitlements.Free.Allows(new(DownloadClient.Desktop, 1)));
    }
    [Fact] public void ProPermitsDesktopAndBatch()
    {
        Assert.True(Entitlements.Pro.Allows(new(DownloadClient.Desktop, 50)));
        Assert.True(Entitlements.Pro.Allows(new(DownloadClient.Extension, 50)));
    }
    [Theory]
    [InlineData(SubscriptionStatus.Active, 1, true)]
    [InlineData(SubscriptionStatus.Trialing, 1, true)]
    [InlineData(SubscriptionStatus.Active, 0, false)]
    [InlineData(SubscriptionStatus.Active, -1, false)]
    [InlineData(SubscriptionStatus.PastDue, 1, false)]
    [InlineData(SubscriptionStatus.Unpaid, 1, false)]
    [InlineData(SubscriptionStatus.Canceled, 1, false)]
    public void OnlyCurrentActivePeriodsGrantPro(SubscriptionStatus status, int days, bool expected)
    {
        var subscription = Create();
        subscription.Synchronize(status, Now.AddDays(days), false, Now);
        Assert.Equal(expected, subscription.GrantsProAt(Now));
    }
    [Fact] public void CancellationAtPeriodEndPreservesAccessUntilExpiry()
    {
        var subscription = Create();
        subscription.Synchronize(SubscriptionStatus.Active, Now.AddDays(10), true, Now);
        Assert.True(subscription.GrantsProAt(Now));
        Assert.False(subscription.GrantsProAt(Now.AddDays(10)));
    }
    [Fact] public void DomainRejectsInvalidIdentityAndSelection()
    {
        Assert.Throws<DomainException>(() => new UserId(Guid.Empty));
        Assert.Throws<DomainException>(() => new DownloadRequest(DownloadClient.Extension, 0));
        Assert.Throws<DomainException>(() => new DownloadRequest((DownloadClient)999, 1));
    }
    [Fact] public void OlderEventsCannotOverwriteNewerState()
    {
        var subscription = Create();
        subscription.Synchronize(SubscriptionStatus.Active, Now.AddDays(10), false, Now);
        Assert.Throws<DomainException>(()=>subscription.Synchronize(SubscriptionStatus.Canceled, Now, false, Now.AddSeconds(-1)));
        Assert.True(subscription.GrantsProAt(Now));
    }
    [Fact] public async Task MissingSubscriptionDefaultsToFree()
    {
        var service = new EntitlementService(new EmptyRepository(), new FixedClock());
        Assert.Equal(Entitlements.Free, await service.GetAsync(new(Guid.NewGuid()), default));
    }
    private static Subscription Create() => new(new(Guid.NewGuid()), "sub_test", "cus_test");
    [Fact] public async Task ValidLifetimeLicenseGrantsProWithoutAnActiveSubscription()
    {
        var service=new EntitlementService(new LifetimeRepository(),new FixedClock());
        Assert.Equal(Entitlements.Pro,await service.GetAsync(new(Guid.NewGuid()),default));
    }
    private sealed class LifetimeRepository:ISubscriptionRepository
    {
        public Task<Subscription?> FindByUserAsync(UserId userId,CancellationToken ct)=>Task.FromResult<Subscription?>(null);
        public Task<bool> HasLifetimeLicenseAsync(UserId userId,CancellationToken ct)=>Task.FromResult(true);
    }
    private sealed class EmptyRepository : ISubscriptionRepository
    { public Task<bool> HasLifetimeLicenseAsync(UserId userId,CancellationToken ct)=>Task.FromResult(false); public Task<Subscription?> FindByUserAsync(UserId userId, CancellationToken cancellationToken) => Task.FromResult<Subscription?>(null); }
    private sealed class FixedClock : TimeProvider { public override DateTimeOffset GetUtcNow() => Now; }
}
