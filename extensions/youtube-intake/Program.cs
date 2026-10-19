using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.RegularExpressions;
using YoutubeExplode;
using YoutubeExplode.Videos.Streams;

// An optional worker, not a UI dependency. Never emit provider response bodies or signed URLs.
const long MaxBytes = 256L * 1024 * 1024;
using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(180));
using var terminate = OperatingSystem.IsWindows() ? null : PosixSignalRegistration.Create(PosixSignal.SIGTERM,
    context => { context.Cancel = true; deadline.Cancel(); });
var token = deadline.Token;
try
{
    if (args.Length != 3 || !Regex.IsMatch(args[0], "^[A-Za-z0-9_-]{11}$")
        || !Path.IsPathFullyQualified(args[1]) || !int.TryParse(args[2], out var height)
        || height is < 144 or > 1080)
        throw new ArgumentException();
    var directory = args[1];
    if (!Directory.Exists(directory) || Directory.EnumerateFileSystemEntries(directory).Any())
        throw new ArgumentException();

    using var youtube = new YoutubeClient();
    var metadata = await youtube.Videos.GetAsync(args[0], token);
    if (metadata.Duration is null || metadata.Duration.Value.TotalSeconds is <= 0 or > 3600)
        throw new InvalidDataException();
    var manifest = await youtube.Videos.Streams.GetManifestAsync(args[0], token);
    var video = manifest.GetVideoOnlyStreams()
        .Where(s => s.Container == Container.Mp4 && s.VideoQuality.MaxHeight <= height)
        .OrderByDescending(s => s.VideoQuality.MaxHeight).ThenByDescending(s => s.Bitrate.BitsPerSecond)
        .FirstOrDefault() ?? throw new InvalidDataException();
    var audio = manifest.GetAudioOnlyStreams().Where(s => s.Container == Container.Mp4)
        .OrderByDescending(s => s.Bitrate.BitsPerSecond).FirstOrDefault() ?? throw new InvalidDataException();
    if (video.Size.Bytes + audio.Size.Bytes > MaxBytes) throw new InvalidDataException();
    long total = 0;
    async Task Download(IStreamInfo info, string name)
    {
        using var input = await youtube.Videos.Streams.GetAsync(info, token);
        await using var output = new FileStream(Path.Combine(directory, name), FileMode.CreateNew, FileAccess.Write, FileShare.None);
        var buffer = new byte[128 * 1024];
        int count;
        while ((count = await input.ReadAsync(buffer, token)) != 0)
        {
            total += count;
            if (total > MaxBytes) throw new InvalidDataException();
            await output.WriteAsync(buffer.AsMemory(0, count), token);
        }
        if (output.Length == 0) throw new InvalidDataException();
    }
    await Download(video, "video.mp4");
    await Download(audio, "audio.m4a");
    using var process = new Process { StartInfo = new ProcessStartInfo(Environment.GetEnvironmentVariable("VIRAL_HIT_FFMPEG") ?? "ffmpeg")
        { UseShellExecute = false, RedirectStandardError = true, RedirectStandardOutput = true } };
    foreach (var arg in new[] { "-nostdin", "-v", "error", "-n", "-protocol_whitelist", "file", "-i", Path.Combine(directory, "video.mp4"),
        "-protocol_whitelist", "file", "-i", Path.Combine(directory, "audio.m4a"), "-map", "0:v:0", "-map", "1:a:0", "-c", "copy",
        "-movflags", "+faststart", Path.Combine(directory, "source.mp4") }) process.StartInfo.ArgumentList.Add(arg);
    process.Start();
    // Drain output without retaining potentially large diagnostics in memory.
    var errors = process.StandardError.BaseStream.CopyToAsync(Stream.Null, token);
    var outputDrain = process.StandardOutput.BaseStream.CopyToAsync(Stream.Null, token);
    try
    {
        using var muxDeadline = CancellationTokenSource.CreateLinkedTokenSource(token);
        muxDeadline.CancelAfter(TimeSpan.FromSeconds(30));
        await process.WaitForExitAsync(muxDeadline.Token);
        await Task.WhenAll(errors, outputDrain);
    }
    finally { if (!process.HasExited) process.Kill(entireProcessTree: true); }
    var final = new FileInfo(Path.Combine(directory, "source.mp4"));
    if (process.ExitCode != 0 || !final.Exists || final.Length is <= 0 or > MaxBytes) throw new InvalidDataException();
    File.Delete(Path.Combine(directory, "video.mp4"));
    File.Delete(Path.Combine(directory, "audio.m4a"));
    Console.WriteLine(JsonSerializer.Serialize(new { schemaVersion = 1, videoId = args[0], engine = "YoutubeExplode/6.6.2",
        height = video.VideoQuality.MaxHeight, bytes = final.Length }));
}
catch (Exception error)
{
    Console.Error.WriteLine(error is ArgumentException ? "Invalid intake arguments or nonempty output directory"
        : error is OperationCanceledException ? "YouTube intake timed out or was canceled" : "YouTube intake failed; no source was accepted");
    Environment.ExitCode = 1;
}
