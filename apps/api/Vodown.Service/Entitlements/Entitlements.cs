using Vodown.Shared.Domain;
namespace Vodown.Service.Entitlements;
public enum DownloadClient { Extension, Desktop }
public sealed record DownloadRequest
{
    public DownloadClient Client { get; }
    public int LessonCount { get; }
    public DownloadRequest(DownloadClient client, int lessonCount)
    {
        AssertionConcern.Require(Enum.IsDefined(client), "Cliente inválido.");
        AssertionConcern.Require(lessonCount > 0, "Selecione pelo menos uma aula.");
        Client = client; LessonCount = lessonCount;
    }
}
public sealed record Entitlements(string Plan, bool DesktopAllowed, bool BatchAllowed, int? MaxLessonsPerAction)
{
    public static Entitlements Free => new("free", false, false, 1);
    public static Entitlements Pro => new("pro", true, true, null);
    public bool Allows(DownloadRequest request) =>
        (request.Client != DownloadClient.Desktop || DesktopAllowed) &&
        (MaxLessonsPerAction is null || request.LessonCount <= MaxLessonsPerAction);
}
