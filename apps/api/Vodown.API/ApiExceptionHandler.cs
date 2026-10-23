using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;
using Vodown.Shared.Domain;
using Vodown.Service.Billing;
namespace Vodown.API;
public sealed class ApiExceptionHandler(IProblemDetailsService problems, ILogger<ApiExceptionHandler> logger) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext context, Exception exception, CancellationToken cancellationToken)
    {
        var isDomain = exception is DomainException;
        var unavailable = exception is Npgsql.NpgsqlException or Vodown.Repository.DatabaseNotConfiguredException or BillingUnavailableException or Stripe.StripeException or HttpRequestException or TaskCanceledException;
        var status = exception is InvalidBillingEventException ? 400 : exception is BillingConflictException ? 409 : isDomain ? 400 : unavailable ? 503 : 500;
        if (!isDomain) logger.LogWarning("Request failed ({ExceptionType}): {TraceId}",exception.GetType().Name, context.TraceIdentifier);
        context.Response.StatusCode = status;
        return await problems.TryWriteAsync(new ProblemDetailsContext { HttpContext = context,
            ProblemDetails = new ProblemDetails { Status = status, Title = isDomain ? "Dados inválidos" : unavailable ? "Serviço indisponível" : "Erro inesperado",
                Detail = isDomain || exception is BillingConflictException ? exception.Message : "Não foi possível concluir a operação. Tente novamente.", Extensions = { ["traceId"] = context.TraceIdentifier } } });
    }
}
