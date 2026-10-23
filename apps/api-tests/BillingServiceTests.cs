using System.Security.Cryptography;
using System.Text;
using Vodown.Repository.Billing;
using Vodown.Service.Billing;
using Vodown.Shared.Domain;
using Xunit;
namespace Vodown.Tests;

public sealed class BillingServiceTests
{
    [Fact] public async Task ConcurrentCheckoutClicksReuseOneOpenSession()
    {
        var fixture=new Fixture();
        var tasks=Enumerable.Range(0,5).Select(_=>fixture.Service.CheckoutAsync(fixture.User,BillingPlan.Monthly,Guid.NewGuid(),default));
        var results=await Task.WhenAll(tasks);
        Assert.Single(results.Select(x=>x.Id).Distinct());
        Assert.Equal(1,fixture.Gateway.CustomersCreated);
        Assert.Equal(1,fixture.Gateway.CheckoutsCreated);
    }
    [Fact] public async Task ChangingPlanExpiresThePreviousSession()
    {
        var f=new Fixture();
        await f.Service.CheckoutAsync(f.User,BillingPlan.Monthly,Guid.NewGuid(),default);
        await f.Service.CheckoutAsync(f.User,BillingPlan.Annual,Guid.NewGuid(),default);
        Assert.Equal(1,f.Gateway.Expired);
        Assert.Equal(2,f.Gateway.CheckoutsCreated);
    }
    [Fact] public async Task LifetimeLicenseBlocksAnotherCheckout()
    {
        var f=new Fixture();
        f.Gateway.State=new(null,[new("cs_paid","pi_paid",true)]);
        await Assert.ThrowsAsync<BillingConflictException>(()=>f.Service.CheckoutAsync(f.User,BillingPlan.Monthly,Guid.NewGuid(),default));
        Assert.Equal(0,f.Gateway.CheckoutsCreated);
    }
    [Fact] public async Task DuplicateWebhookIsProcessedOnce()
    {
        var f=new Fixture();f.Store.Customer=new(f.User,"cus_test");
        Assert.True(await f.Service.HandleEventAsync("payload","signature",default));
        var fetches=f.Gateway.StateFetches;
        Assert.False(await f.Service.HandleEventAsync("payload","signature",default));
        Assert.Equal(fetches,f.Gateway.StateFetches);
    }
    [Fact] public async Task ProviderFailureDoesNotAcknowledgeAnEventAsProcessed()
    {
        var f=new Fixture();f.Store.Customer=new(f.User,"cus_test");f.Gateway.Fail=true;
        await Assert.ThrowsAsync<HttpRequestException>(()=>f.Service.HandleEventAsync("payload","signature",default));
        Assert.Empty(f.Store.Events);
    }
    [Fact] public async Task LiveWebhookCannotGrantAccess()
    {
        var f=new Fixture();f.Gateway.Live=true;
        await Assert.ThrowsAsync<InvalidBillingEventException>(()=>f.Service.HandleEventAsync("payload","signature",default));
        Assert.Equal(0,f.Gateway.StateFetches);
    }
    [Fact] public void WebhookSignatureRejectsTamperingAndStaleEvents()
    {
        var settings=new StripeSettings{WebhookSecret="whsec_test_only"};
        var gateway=new StripeGateway(settings,new Lazy<Stripe.IStripeClient>(()=>throw new InvalidOperationException()));
        var payload="""{"id":"evt_test","object":"event","type":"customer.subscription.updated","livemode":false,"data":{"object":{"id":"sub_test","object":"subscription","customer":"cus_test"}}}""";
        string Signature(long timestamp)=>$"t={timestamp},v1={Convert.ToHexStringLower(HMACSHA256.HashData(Encoding.UTF8.GetBytes(settings.WebhookSecret),Encoding.UTF8.GetBytes($"{timestamp}.{payload}")))}";
        Assert.Equal("evt_test",gateway.VerifyEvent(payload,Signature(DateTimeOffset.UtcNow.ToUnixTimeSeconds())).Id);
        Assert.Throws<InvalidBillingEventException>(()=>gateway.VerifyEvent(payload+" ",Signature(DateTimeOffset.UtcNow.ToUnixTimeSeconds())));
        Assert.Throws<InvalidBillingEventException>(()=>gateway.VerifyEvent(payload,Signature(DateTimeOffset.UtcNow.AddHours(-1).ToUnixTimeSeconds())));
    }
    private sealed class Fixture
    {
        public UserId User {get;}=new(Guid.NewGuid());
        public FakeStore Store {get;}=new();
        public FakeGateway Gateway {get;}=new();
        public BillingService Service=>new(Store,Gateway,TimeProvider.System);
    }
    private sealed class FakeStore:IBillingRepository
    {
        private readonly SemaphoreSlim gate=new(1);
        public BillingCustomer? Customer {get;set;}
        public HashSet<string> Events {get;}=[];
        public async Task<T> WithUserLockAsync<T>(UserId id,Func<CancellationToken,Task<T>> action,CancellationToken ct)
        {await gate.WaitAsync(ct);try{return await action(ct);}finally{gate.Release();}}
        public Task<BillingCustomer?> FindCustomerAsync(UserId id,CancellationToken ct)=>Task.FromResult(Customer);
        public Task<BillingCustomer?> FindByStripeCustomerAsync(string id,CancellationToken ct)=>Task.FromResult(Customer);
        public void AddCustomer(BillingCustomer customer)=>Customer=customer;
        public Task<bool> WasProcessedAsync(string id,CancellationToken ct)=>Task.FromResult(Events.Contains(id));
        public Task SaveStateAsync(UserId id,BillingState state,DateTimeOffset at,CancellationToken ct)=>Task.CompletedTask;
        public void RecordEvent(ProcessedBillingEvent e)=>Events.Add(e.Id);
    }
    private sealed class FakeGateway:IBillingGateway
    {
        public bool IsConfigured=>true;
        public int CustomersCreated,CheckoutsCreated,Expired,StateFetches;
        public bool Fail,Live;
        public BillingState State {get;set;}=new(null,[]);
        public CheckoutLink? Open {get;set;}
        public Task<IReadOnlyList<PlanPrice>> GetPricesAsync(CancellationToken ct)=>Task.FromResult<IReadOnlyList<PlanPrice>>([]);
        public Task<string> CreateCustomerAsync(UserId id,CancellationToken ct){CustomersCreated++;return Task.FromResult("cus_test");}
        public Task<BillingState> GetStateAsync(BillingCustomer c,CancellationToken ct){StateFetches++;if(Fail)throw new HttpRequestException();return Task.FromResult(State);}
        public Task<CheckoutLink?> GetOpenCheckoutAsync(string id,CancellationToken ct)=>Task.FromResult(Open);
        public Task ExpireCheckoutAsync(string id,CancellationToken ct){Expired++;Open=null;return Task.CompletedTask;}
        public Task<CheckoutLink> CreateCheckoutAsync(BillingCustomer c,BillingPlan plan,Guid requestId,CancellationToken ct)
        {CheckoutsCreated++;Open=new($"cs_{CheckoutsCreated}","https://checkout.stripe.com/c/pay/test",DateTimeOffset.UtcNow.AddHours(1));return Task.FromResult(Open);}
        public Task<string> CreatePortalAsync(BillingCustomer c,Guid id,CancellationToken ct)=>Task.FromResult("https://billing.stripe.com/test");
        public BillingEvent VerifyEvent(string p,string s)=>new("evt_test","customer.subscription.updated",Live,"cus_test",null);
        public Task<string?> ResolveCustomerAsync(BillingEvent e,CancellationToken ct)=>Task.FromResult(e.CustomerId);
    }
}
