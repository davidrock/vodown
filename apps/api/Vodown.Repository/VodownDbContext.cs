using Microsoft.EntityFrameworkCore;
using Vodown.Service.Subscriptions;
using Vodown.Shared.Domain;
using Vodown.Service.Billing;
namespace Vodown.Repository;
public sealed class VodownDbContext(DbContextOptions<VodownDbContext> options) : DbContext(options)
{
    public DbSet<Subscription> Subscriptions => Set<Subscription>();
    public DbSet<BillingCustomer> BillingCustomers => Set<BillingCustomer>();
    public DbSet<ProcessedBillingEvent> ProcessedBillingEvents => Set<ProcessedBillingEvent>();
    public DbSet<LifetimeLicense> LifetimeLicenses => Set<LifetimeLicense>();
    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        var subscription = modelBuilder.Entity<Subscription>();
        subscription.ToTable("subscriptions", "vodown");
        subscription.HasKey(x => x.UserId);
        subscription.Property(x => x.UserId).HasConversion(id => id.Value, value => new UserId(value)).HasColumnName("user_id");
        subscription.Property(x => x.StripeSubscriptionId).HasColumnName("stripe_subscription_id").HasMaxLength(200);
        subscription.HasIndex(x => x.StripeSubscriptionId).IsUnique();
        subscription.Property(x => x.StripeCustomerId).HasColumnName("stripe_customer_id").HasMaxLength(200);
        subscription.Property(x => x.Status).HasConversion<string>().HasColumnName("status").HasMaxLength(30);
        subscription.Property(x => x.PaidThrough).HasColumnName("paid_through");
        subscription.Property(x => x.CancelAtPeriodEnd).HasColumnName("cancel_at_period_end");
        subscription.Property(x => x.UpdatedAt).HasColumnName("updated_at");
        var customer=modelBuilder.Entity<BillingCustomer>();
        customer.ToTable("billing_customers","vodown");
        customer.HasKey(x=>x.UserId);
        customer.Property(x=>x.UserId).HasConversion(id=>id.Value,value=>new UserId(value)).HasColumnName("user_id");
        customer.Property(x=>x.StripeCustomerId).HasMaxLength(200).HasColumnName("stripe_customer_id");
        customer.HasIndex(x=>x.StripeCustomerId).IsUnique();
        customer.Property(x=>x.CheckoutId).HasMaxLength(200).HasColumnName("checkout_id");
        customer.Property(x=>x.CheckoutUrl).HasMaxLength(2048).HasColumnName("checkout_url");
        customer.Property(x=>x.CheckoutExpiresAt).HasColumnName("checkout_expires_at");
        customer.Property(x=>x.CheckoutInterval).HasConversion<string>().HasMaxLength(20).HasColumnName("checkout_interval");
        var receipt=modelBuilder.Entity<ProcessedBillingEvent>();
        receipt.ToTable("processed_billing_events","vodown");
        receipt.HasKey(x=>x.Id);
        receipt.Property(x=>x.Id).HasMaxLength(200).HasColumnName("event_id");
        receipt.Property(x=>x.ProcessedAt).HasColumnName("processed_at");
        var license=modelBuilder.Entity<LifetimeLicense>();
        license.ToTable("lifetime_licenses","vodown");
        license.HasKey(x=>x.CheckoutId);
        license.Property(x=>x.CheckoutId).HasMaxLength(200).HasColumnName("checkout_id");
        license.Property(x=>x.UserId).HasConversion(id=>id.Value,value=>new UserId(value)).HasColumnName("user_id");
        license.HasIndex(x=>x.UserId);
        license.Property(x=>x.PaymentIntentId).HasMaxLength(200).HasColumnName("payment_intent_id");
        license.HasIndex(x=>x.PaymentIntentId).IsUnique();
        license.Property(x=>x.IsValid).HasColumnName("is_valid");
        license.Property(x=>x.UpdatedAt).HasColumnName("updated_at");
    }
}
