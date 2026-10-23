using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Stripe;
using Vodown.Repository;
using Vodown.Repository.Billing;
using Vodown.Service.Billing;
using Vodown.Service.Entitlements;
using Vodown.Shared.Domain;
using Xunit;
using File = System.IO.File;
using BillingService = Vodown.Service.Billing.BillingService;
namespace Vodown.Tests;

[Collection("PostgreSQL")]
public sealed class StripeSandboxTests
{
    [SandboxFact] public async Task RealTestCatalogCheckoutSubscriptionAndCancellationReconcile()
    {
        var connection=Environment.GetEnvironmentVariable("VODOWN_TEST_DATABASE");
        Assert.Contains(new NpgsqlConnectionStringBuilder(connection).Host,new[]{"localhost","127.0.0.1"});
        var root=new DirectoryInfo(AppContext.BaseDirectory);
        while(root is not null&&!File.Exists(Path.Combine(root.FullName,".local/vodown-server-secrets.json")))root=root.Parent;
        Assert.NotNull(root);
        using var document=JsonDocument.Parse(await File.ReadAllTextAsync(Path.Combine(root.FullName,".local/vodown-server-secrets.json")));
        var settings=document.RootElement.GetProperty("Stripe").Deserialize<StripeSettings>()!;
        Assert.StartsWith("sk_test_",settings.SecretKey);
        Assert.NotEmpty(settings.WebhookSecret);
        using var http=new HttpClient{Timeout=TimeSpan.FromSeconds(15)};
        var client=new StripeClient(settings.SecretKey,httpClient:new SystemNetHttpClient(http,maxNetworkRetries:1));
        var gateway=new StripeGateway(settings,new(()=>client));
        await using var db=new VodownDbContext(new DbContextOptionsBuilder<VodownDbContext>().UseNpgsql(connection,n=>n.MigrationsHistoryTable("__EFMigrationsHistory","vodown")).Options);
        await db.Database.MigrateAsync();
        var store=new BillingRepository(db);
        var service=new BillingService(store,gateway,TimeProvider.System);
        var userId=new UserId(Guid.NewGuid());
        var customerId=await gateway.CreateCustomerAsync(userId,default);
        var customer=new BillingCustomer(userId,customerId);
        await store.WithUserLockAsync(userId,ct=>{store.AddCustomer(customer);return Task.FromResult(true);},default);
        string? subscriptionId=null;
        var receiptIds=new List<string>();
        try
        {
            var prices=await gateway.GetPricesAsync(default);
            Assert.Equal(new long[]{500,2500,10000},prices.Select(x=>x.AmountMinor));
            CheckoutLink? previous=null;
            foreach(var plan in Enum.GetValues<BillingPlan>())
            {
                var checkout=await service.CheckoutAsync(userId,plan,Guid.NewGuid(),default);
                Assert.StartsWith("https://checkout.stripe.com/",checkout.Url);
                Assert.Equal(checkout.Id,(await service.CheckoutAsync(userId,plan,Guid.NewGuid(),default)).Id);
                if(previous is not null)Assert.Null(await gateway.GetOpenCheckoutAsync(previous.Id,default));
                previous=checkout;
            }
            await gateway.ExpireCheckoutAsync(previous!.Id,default);
            var paymentMethod=await new PaymentMethodService(client).CreateAsync(new(){Type="card",Card=new(){Token="tok_visa"}});
            await new PaymentMethodService(client).AttachAsync(paymentMethod.Id,new(){Customer=customerId});
            var subscription=await new SubscriptionService(client).CreateAsync(new(){Customer=customerId,Items=[new(){Price=settings.MonthlyPriceId}],DefaultPaymentMethod=paymentMethod.Id,
                PaymentBehavior="error_if_incomplete",Metadata=new(){{"vodown_user_id",userId.Value.ToString()},{"vodown_test_fixture","true"}}});
            subscriptionId=subscription.Id;
            Assert.False(subscription.Livemode);
            var active=await gateway.GetStateAsync(customer,default);
            Assert.Equal(Vodown.Service.Subscriptions.SubscriptionStatus.Active,active.Subscription?.Status);
            var access=new EntitlementService(new SubscriptionRepository(db),TimeProvider.System);
            var eventId=$"evt_probe_{Guid.NewGuid():N}";receiptIds.Add(eventId);
            var payload=Payload(eventId,customerId,subscriptionId);
            Assert.True(await service.HandleEventAsync(payload,Signature(payload,settings.WebhookSecret),default));
            Assert.Equal("pro",(await access.GetAsync(userId,default)).Plan);
            Assert.False(await service.HandleEventAsync(payload,Signature(payload,settings.WebhookSecret),default));
            await new SubscriptionService(client).CancelAsync(subscriptionId);
            subscriptionId=null;
            eventId=$"evt_probe_{Guid.NewGuid():N}";receiptIds.Add(eventId);payload=Payload(eventId,customerId,subscription.Id);
            await service.HandleEventAsync(payload,Signature(payload,settings.WebhookSecret),default);
            Assert.Equal("free",(await access.GetAsync(userId,default)).Plan);
        }
        finally
        {
            if(subscriptionId is not null)await new SubscriptionService(client).CancelAsync(subscriptionId);
            await new CustomerService(client).DeleteAsync(customerId);
            await db.ProcessedBillingEvents.Where(x=>receiptIds.Contains(x.Id)).ExecuteDeleteAsync();
            await db.Subscriptions.Where(x=>x.UserId==userId).ExecuteDeleteAsync();
            await db.BillingCustomers.Where(x=>x.UserId==userId).ExecuteDeleteAsync();
        }
    }
    private static string Payload(string id,string customer,string subscription)=>JsonSerializer.Serialize(new{id,@object="event",type="customer.subscription.updated",livemode=false,data=new{@object=new{id=subscription,@object="subscription",customer}}});
    private static string Signature(string payload,string secret)
    {var timestamp=DateTimeOffset.UtcNow.ToUnixTimeSeconds();return $"t={timestamp},v1={Convert.ToHexStringLower(HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret),Encoding.UTF8.GetBytes($"{timestamp}.{payload}")))}";}
}
public sealed class SandboxFactAttribute:FactAttribute
{ public SandboxFactAttribute(){if(Environment.GetEnvironmentVariable("VODOWN_RUN_STRIPE_SANDBOX")!="1")Skip="Opt-in Stripe sandbox test creates disposable test objects; requires an isolated local database.";} }
