using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Vodown.Service.Billing;
using Vodown.Service.Entitlements;
using Vodown.Shared.Domain;
namespace Vodown.API.Controllers;

[ApiController,Route("v1/billing")]
public sealed class BillingController(BillingService billing,IBillingGateway gateway,EntitlementService entitlements):ControllerBase
{
    [HttpGet("plans"),AllowAnonymous]
    public async Task<IActionResult> Plans(CancellationToken ct)=>gateway.IsConfigured
        ? Ok(new { available=true,testMode=true,prices=await gateway.GetPricesAsync(ct) })
        : Ok(new { available=false,testMode=true,prices=Array.Empty<PlanPrice>() });
    [HttpPost("checkout"),Authorize(Policy="Member")]
    public async Task<IActionResult> Checkout(CheckoutRequest request,[FromHeader(Name="Idempotency-Key")] string? requestId,CancellationToken ct)
        => Ok(await billing.CheckoutAsync(CurrentUser(),request.Plan!.Value,RequestId(requestId),ct));
    [HttpPost("portal"),Authorize(Policy="Member")]
    public async Task<IActionResult> Portal([FromHeader(Name="Idempotency-Key")] string? requestId,CancellationToken ct)
        => Ok(new {url=await billing.PortalAsync(CurrentUser(),RequestId(requestId),ct)});
    [HttpPost("reconcile"),Authorize(Policy="Member")]
    public async Task<IActionResult> Reconcile(CancellationToken ct)
    { await billing.ReconcileAsync(CurrentUser(),ct); return Ok(await entitlements.GetAsync(CurrentUser(),ct)); }
    [HttpPost("webhook"),AllowAnonymous,RequestSizeLimit(262144)]
    public async Task<IActionResult> Webhook(CancellationToken ct)
    {
        var signature=Request.Headers["Stripe-Signature"].ToString();
        if(string.IsNullOrWhiteSpace(signature))return BadRequest(new ProblemDetails{Title="Stripe-Signature obrigatório",Status=400});
        using var reader=new StreamReader(Request.Body);
        var payload=await reader.ReadToEndAsync(ct);
        var processed=await billing.HandleEventAsync(payload,signature,ct);
        return Ok(new {received=true,processed});
    }
    private UserId CurrentUser()=>new(Guid.Parse(User.FindFirst("sub")!.Value));
    private static Guid RequestId(string? value)
    { if(!Guid.TryParse(value,out var id)||id==Guid.Empty)throw new DomainException("Envie um UUID no cabeçalho Idempotency-Key.");return id; }
}
public sealed record CheckoutRequest([Required] BillingPlan? Plan);
