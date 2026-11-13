using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Windows.Forms;

[assembly: AssemblyTitle("ZPG Armor Viewer")]
[assembly: AssemblyDescription("Примерочная брони с Live-текстурами")]
[assembly: AssemblyProduct("ZPG Armor Viewer")]

internal static class ArmorViewerLauncher
{
    [STAThread]
    private static void Main()
    {
        try
        {
            var browser = FindBrowser();
            if (browser == null)
            {
                ShowError("Для запуска и Live-подключения файлов нужен Microsoft Edge или Google Chrome.");
                return;
            }

            var folder = InstallPayload();
            var url = new Uri(Path.Combine(folder, "index.html")).AbsoluteUri;
            Process.Start(new ProcessStartInfo(browser, "--app=\"" + url + "\"")
            {
                UseShellExecute = false,
                WorkingDirectory = folder
            });
        }
        catch (Exception error)
        {
            ShowError("Не удалось открыть примерочную. " + error.Message);
        }
    }

    private static string InstallPayload()
    {
        const string resourcePrefix = "ArmorViewer.Payload.";
        var assembly = Assembly.GetExecutingAssembly();
        var resource = Array.Find(assembly.GetManifestResourceNames(),
            name => name.StartsWith(resourcePrefix, StringComparison.Ordinal));
        if (resource == null)
            throw new InvalidDataException("В EXE отсутствуют файлы примерочной.");

        var cache = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "ArmorViewer", "versions");
        var destination = Path.Combine(cache, resource.Substring(resourcePrefix.Length));
        if (Directory.Exists(destination)) return destination;

        Directory.CreateDirectory(cache);
        var staging = Path.Combine(cache, "unpack-" + Guid.NewGuid().ToString("N"));
        try
        {
            using (var stream = assembly.GetManifestResourceStream(resource))
            using (var archive = new ZipArchive(stream, ZipArchiveMode.Read))
            {
                archive.ExtractToDirectory(staging);
            }
            try
            {
                Directory.Move(staging, destination);
            }
            catch (IOException)
            {
                // Another instance may have finished installing this version.
                if (!Directory.Exists(destination)) throw;
            }
            return destination;
        }
        finally
        {
            if (Directory.Exists(staging)) Directory.Delete(staging, true);
        }
    }

    private static string FindBrowser()
    {
        var roots = new[]
        {
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData)
        };
        var browserPaths = new[]
        {
            @"Microsoft\Edge\Application\msedge.exe",
            @"Google\Chrome\Application\chrome.exe"
        };

        foreach (var relativePath in browserPaths)
        {
            foreach (var root in roots)
            {
                if (String.IsNullOrEmpty(root)) continue;
                var path = Path.Combine(root, relativePath);
                if (File.Exists(path)) return path;
            }
        }
        return null;
    }

    private static void ShowError(string message)
    {
        MessageBox.Show(message, "ZPG Armor Viewer", MessageBoxButtons.OK, MessageBoxIcon.Error);
    }
}
