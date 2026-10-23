using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Vodown.Service.Entitlements;
using Vodown.Shared.Domain;
using System.ComponentModel.DataAnnotations;
namespace Vodown.API.Controllers;
[ApiController, Route("v1/me"), Authorize(Policy = "Member")]
public sealed class AccountController(EntitlementService service) : ControllerBase
{
    [HttpGet("entitlements")]
    public Task<Entitlements> Entitlements(CancellationToken cancellationToken) => service.GetAsync(CurrentUser(), cancellationToken);
    [HttpPost("download-authorizations")]
    public async Task<IActionResult> AuthorizeDownload(DownloadAuthorizationRequest request, CancellationToken cancellationToken)
    {
        var selection = new DownloadRequest(request.Client!.Value, request.LessonCount!.Value);
        var entitlements = await service.GetAsync(CurrentUser(), cancellationToken);
        return entitlements.Allows(selection) ? Ok(new { allowed = true, entitlements.Plan }) : Problem(
            statusCode: StatusCodes.Status403Forbidden, title: "Plano PRO necessário",
            detail: "O plano FREE permite uma aula por ação manual na extensão. Desktop e filas requerem PRO.");
    }
    private UserId CurrentUser() => new(Guid.Parse(User.FindFirst("sub")!.Value));
}
public sealed record DownloadAuthorizationRequest([Required] DownloadClient? Client, [Required, Range(1, int.MaxValue)] int? LessonCount);
