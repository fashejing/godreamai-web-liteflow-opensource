using System.Diagnostics;
using System.Drawing;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Windows.Forms;

namespace GoDreamAILauncher.Win;

internal sealed class LauncherForm : Form
{
    private const string ManagedRuntimeDirectoryPrefix = "runtime-";
    private const int RuntimeStampLength = 12;
    private static readonly string LauncherVersionText = DisplayLauncherVersion(
        Assembly.GetExecutingAssembly()
            .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?
            .InformationalVersion ?? "dev"
    );
    private const string LauncherModelSummary =
        "生图：Seedream 5.0 Pro / Seedream 5.0 Lite / Seedream 4.5 / Kling Image 3.0 / Kling Image 3.0 Omni\r\n" +
        "生视频：Seedance 2.0 / Seedance 2.0 Fast / Seedance 2.0 Mini / Kling 3.0 Turbo / Kling 3.0 Omni";

    private sealed record BackendResult(
        bool ok,
        string code,
        string status_text,
        string detail_text,
        bool show_install,
        bool enable_launch,
        string target_url
    );

    private readonly Button checkButton = new() { Text = "检测环境", Width = 144, Height = 38 };
    private readonly Button launchButton = new() { Text = "启动", Width = 144, Height = 38, Enabled = false };
    private readonly Button installButton = new() { Text = "一键安装环境", Width = 168, Height = 38, Visible = false };
    private readonly Label statusLabel = new() { AutoSize = false, Width = 500, Height = 44 };
    private readonly Label detailLabel = new() { AutoSize = false, Width = 500, Height = 80 };
    private readonly ProgressBar activityBar = new() { Style = ProgressBarStyle.Marquee, MarqueeAnimationSpeed = 28, Visible = false, Width = 180, Height = 8 };

    private bool desiredLaunchEnabled;
    private bool desiredInstallVisible;

    private static string DisplayLauncherVersion(string value)
    {
        var trimmed = value.Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            return "dev";
        }
        var match = Regex.Match(trimmed, @"^v?\d+(?:\.\d+){1,2}");
        return match.Success ? match.Value : trimmed;
    }

    public LauncherForm()
    {
        Text = "井鸽启动器";
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = true;
        ClientSize = new Size(560, 524);
        Font = new Font("Segoe UI", 10F, FontStyle.Regular, GraphicsUnit.Point);

        BuildWindow();
        ApplyIdleState();
    }

    private void BuildWindow()
    {
        var titleLabel = new Label
        {
            Text = "井鸽启动器",
            Font = new Font("Segoe UI", 24F, FontStyle.Bold, GraphicsUnit.Point),
            AutoSize = false,
            Size = new Size(500, 50),
            Location = new Point(24, 24),
        };

        var versionLabel = new Label
        {
            Text = $"版本 {LauncherVersionText}",
            Font = new Font("Segoe UI", 10F, FontStyle.Regular, GraphicsUnit.Point),
            ForeColor = SystemColors.GrayText,
            AutoSize = false,
            Size = new Size(500, 24),
            Location = new Point(24, 96),
        };

        var subtitleLabel = new Label
        {
            Text = "AI视频创作套件",
            Font = new Font("Segoe UI", 10F, FontStyle.Regular, GraphicsUnit.Point),
            ForeColor = SystemColors.GrayText,
            AutoSize = false,
            Size = new Size(500, 24),
            Location = new Point(24, 72),
        };

        var modelsTitleLabel = new Label
        {
            Text = "可调用模型",
            Font = new Font("Segoe UI", 9F, FontStyle.Bold, GraphicsUnit.Point),
            ForeColor = SystemColors.GrayText,
            AutoSize = false,
            Size = new Size(500, 20),
            Location = new Point(24, 132),
        };

        var modelsLabel = new Label
        {
            Text = LauncherModelSummary,
            Font = new Font("Segoe UI", 9F, FontStyle.Regular, GraphicsUnit.Point),
            ForeColor = SystemColors.GrayText,
            AutoSize = false,
            Size = new Size(500, 56),
            Location = new Point(24, 154),
        };

        statusLabel.Font = new Font("Segoe UI", 15F, FontStyle.Bold, GraphicsUnit.Point);
        statusLabel.Location = new Point(24, 226);

        detailLabel.Font = new Font("Segoe UI", 11F, FontStyle.Regular, GraphicsUnit.Point);
        detailLabel.ForeColor = SystemColors.GrayText;
        detailLabel.Location = new Point(24, 270);
        detailLabel.Visible = false;

        checkButton.Location = new Point(24, 356);
        launchButton.Location = new Point(180, 356);
        installButton.Location = new Point(24, 402);
        activityBar.Location = new Point(24, 408);

        checkButton.Click += async (_, _) => await RunBackendAsync("check", "正在检测环境…");
        installButton.Click += async (_, _) => await RunBackendAsync("install", "正在安装环境，请稍候…");
        launchButton.Click += async (_, _) => await RunBackendAsync("launch", "正在启动前端…");

        var copyrightLabel = new Label
        {
            Text = "©井鸽 2026",
            Font = new Font("Segoe UI", 11F, FontStyle.Regular, GraphicsUnit.Point),
            ForeColor = SystemColors.GrayText,
            AutoSize = true,
            Location = new Point(24, 454),
        };

        var websiteLabel = new LinkLabel
        {
            Text = "www.wellpigeon.com",
            Font = new Font("Segoe UI", 11F, FontStyle.Regular, GraphicsUnit.Point),
            AutoSize = true,
            Location = new Point(24, 476),
        };
        websiteLabel.LinkClicked += (_, _) =>
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = "https://www.wellpigeon.com",
                UseShellExecute = true,
            });
        };

        var qqLabel = new Label
        {
            Text = "QQ交流群：1046590358",
            Font = new Font("Segoe UI", 11F, FontStyle.Regular, GraphicsUnit.Point),
            ForeColor = SystemColors.GrayText,
            AutoSize = true,
            Location = new Point(24, 498),
        };

        Controls.AddRange(
        [
            titleLabel,
            subtitleLabel,
            versionLabel,
            modelsTitleLabel,
            modelsLabel,
            statusLabel,
            detailLabel,
            checkButton,
            launchButton,
            installButton,
            activityBar,
            copyrightLabel,
            websiteLabel,
            qqLabel,
        ]);
    }

    private void ApplyIdleState()
    {
        ApplyStatus(
            "点击“检测环境”开始",
            "",
            SystemColors.ControlText,
            showInstall: false,
            enableLaunch: false
        );
    }

    private async Task RunBackendAsync(string action, string preflightStatus)
    {
        string? runtimeRoot;
        try
        {
            runtimeRoot = ResolveRuntimeRoot();
        }
        catch (Exception ex)
        {
            ApplyStatus(
                "运行时同步失败",
                ex.Message,
                Color.Firebrick,
                showInstall: false,
                enableLaunch: false,
                showDetail: true
            );
            return;
        }

        if (runtimeRoot is null)
        {
            ApplyStatus(
                "未找到可用运行时",
                "请确保 GoDreamAI Plus Launcher.exe 与 runtime、START-HERE.txt 位于同一解压目录。",
                Color.Firebrick,
                showInstall: false,
                enableLaunch: false,
                showDetail: true
            );
            return;
        }

        var pythonPath = Path.Combine(runtimeRoot, "python", "python.exe");
        if (!File.Exists(pythonPath))
        {
            ApplyStatus(
                "缺少内置 Python 运行时",
                pythonPath,
                Color.Firebrick,
                showInstall: false,
                enableLaunch: false,
                showDetail: true
            );
            return;
        }

        var backendScript = Path.Combine(runtimeRoot, "scripts", "launcher_backend.py");
        if (!File.Exists(backendScript))
        {
            ApplyStatus(
                "缺少启动器后端脚本",
                backendScript,
                Color.Firebrick,
                showInstall: false,
                enableLaunch: false,
                showDetail: true
            );
            return;
        }

        SetBusy(true);
        statusLabel.Text = preflightStatus;
        statusLabel.ForeColor = SystemColors.ControlText;
        detailLabel.Text = "";
        detailLabel.Visible = false;

        try
        {
            var payload = await Task.Run(() => InvokeBackend(pythonPath, backendScript, runtimeRoot, action));
            Apply(payload);
            if (action == "install" && payload.ok)
            {
                launchButton.Enabled = false;
            }
        }
        catch (Exception ex)
        {
            ApplyStatus(
                "启动器执行失败",
                ex.Message,
                Color.Firebrick,
                showInstall: false,
                enableLaunch: false,
                showDetail: true
            );
        }
        finally
        {
            SetBusy(false);
        }
    }

    private static bool IsRuntimeRoot(string root)
    {
        var requiredPaths = new[]
        {
            Path.Combine(root, "web_lite3"),
            Path.Combine(root, "scripts"),
            Path.Combine(root, "requirements.txt"),
            Path.Combine(root, "python", "python.exe"),
            Path.Combine(root, "wheelhouse"),
        };
        return requiredPaths.All(path => Directory.Exists(path) || File.Exists(path));
    }

    private static string ManagedRuntimeBaseDirectory()
    {
        return Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "GoDreamAI Plus Launcher"
        );
    }

    private static void CopyDirectory(string sourceDir, string destinationDir)
    {
        Directory.CreateDirectory(destinationDir);
        foreach (var directory in Directory.GetDirectories(sourceDir, "*", SearchOption.AllDirectories))
        {
            var relative = Path.GetRelativePath(sourceDir, directory);
            Directory.CreateDirectory(Path.Combine(destinationDir, relative));
        }
        foreach (var file in Directory.GetFiles(sourceDir, "*", SearchOption.AllDirectories))
        {
            var relative = Path.GetRelativePath(sourceDir, file);
            var target = Path.Combine(destinationDir, relative);
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            File.Copy(file, target, overwrite: true);
        }
    }

    private static string ManagedRuntimeRoot(string sourceRuntime)
    {
        var stamp = ComputeRuntimeStamp(sourceRuntime);
        return Path.Combine(ManagedRuntimeBaseDirectory(), $"{ManagedRuntimeDirectoryPrefix}{stamp}");
    }

    private static string ComputeRuntimeStamp(string root)
    {
        using var sha256 = SHA256.Create();
        foreach (var file in Directory.GetFiles(root, "*", SearchOption.AllDirectories).OrderBy(path => path, StringComparer.OrdinalIgnoreCase))
        {
            var info = new FileInfo(file);
            var relative = Path.GetRelativePath(root, file).Replace('\\', '/');
            var line = $"{relative}|{info.Length}|{info.LastWriteTimeUtc.Ticks}\n";
            var bytes = Encoding.UTF8.GetBytes(line);
            sha256.TransformBlock(bytes, 0, bytes.Length, null, 0);
        }

        sha256.TransformFinalBlock(Array.Empty<byte>(), 0, 0);
        return Convert.ToHexString(sha256.Hash!).ToLowerInvariant()[..RuntimeStampLength];
    }

    private static void EnsureManagedRuntime(string sourceRuntime, string destinationRuntime)
    {
        if (IsRuntimeRoot(destinationRuntime))
        {
            return;
        }

        var parentDirectory = Path.GetDirectoryName(destinationRuntime)!;
        Directory.CreateDirectory(parentDirectory);
        CleanupStaleStagingDirectories(parentDirectory);

        var stagingDirectory = Path.Combine(parentDirectory, $"{Path.GetFileName(destinationRuntime)}.tmp-{Guid.NewGuid():N}");
        try
        {
            CopyDirectory(sourceRuntime, stagingDirectory);
            if (Directory.Exists(destinationRuntime) && !IsRuntimeRoot(destinationRuntime))
            {
                TryDeleteDirectory(destinationRuntime);
            }
            try
            {
                Directory.Move(stagingDirectory, destinationRuntime);
            }
            catch (IOException) when (IsRuntimeRoot(destinationRuntime))
            {
                TryDeleteDirectory(stagingDirectory);
            }
            catch (UnauthorizedAccessException) when (IsRuntimeRoot(destinationRuntime))
            {
                TryDeleteDirectory(stagingDirectory);
            }
        }
        catch
        {
            TryDeleteDirectory(stagingDirectory);
            throw;
        }
    }

    private static void CleanupStaleStagingDirectories(string parentDirectory)
    {
        foreach (var directory in Directory.GetDirectories(parentDirectory, $"{ManagedRuntimeDirectoryPrefix}*.tmp-*", SearchOption.TopDirectoryOnly))
        {
            TryDeleteDirectory(directory);
        }
    }

    private static void TryDeleteDirectory(string path)
    {
        try
        {
            if (Directory.Exists(path))
            {
                Directory.Delete(path, recursive: true);
            }
        }
        catch
        {
        }
    }

    private string? ResolveRuntimeRoot()
    {
        var siblingRuntime = Path.Combine(AppContext.BaseDirectory, "runtime");
        if (!IsRuntimeRoot(siblingRuntime))
        {
            return null;
        }
        var managed = ManagedRuntimeRoot(siblingRuntime);
        EnsureManagedRuntime(siblingRuntime, managed);
        return managed;
    }

    private static BackendResult InvokeBackend(string pythonPath, string backendScript, string runtimeRoot, string action)
    {
        var startInfo = new ProcessStartInfo
        {
            FileName = pythonPath,
            WorkingDirectory = runtimeRoot,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
        };
        startInfo.ArgumentList.Add(backendScript);
        startInfo.ArgumentList.Add(action);

        using var process = Process.Start(startInfo) ?? throw new InvalidOperationException("无法启动 launcher_backend.py");
        var stdout = process.StandardOutput.ReadToEnd();
        var stderr = process.StandardError.ReadToEnd();
        process.WaitForExit();

        try
        {
            var payload = JsonSerializer.Deserialize<BackendResult>(stdout);
            return payload ?? throw new InvalidOperationException("启动器返回了空 JSON。");
        }
        catch (Exception ex)
        {
            var detail = string.Join(
                Environment.NewLine,
                new[] { stdout.Trim(), stderr.Trim() }.Where(item => !string.IsNullOrWhiteSpace(item))
            );
            throw new InvalidOperationException(string.IsNullOrWhiteSpace(detail) ? ex.Message : detail);
        }
    }

    private void Apply(BackendResult payload)
    {
        var color = payload.ok
            ? payload.code == "installed" ? Color.RoyalBlue : Color.ForestGreen
            : payload.show_install ? Color.DarkOrange : Color.Firebrick;
        ApplyStatus(payload.status_text, payload.detail_text, color, payload.show_install, payload.enable_launch, showDetail: !payload.ok);
    }

    private void ApplyStatus(string text, string detail, Color color, bool showInstall, bool enableLaunch, bool showDetail = false)
    {
        statusLabel.Text = text;
        statusLabel.ForeColor = color;
        var normalizedDetail = detail.Trim();
        detailLabel.Text = normalizedDetail;
        detailLabel.Visible = showDetail && normalizedDetail.Length > 0;
        desiredInstallVisible = showInstall;
        desiredLaunchEnabled = enableLaunch;
        installButton.Visible = showInstall;
        launchButton.Enabled = enableLaunch;
    }

    private void SetBusy(bool busy)
    {
        checkButton.Enabled = !busy;
        installButton.Enabled = !busy;
        installButton.Visible = busy ? false : desiredInstallVisible;
        launchButton.Enabled = !busy && desiredLaunchEnabled;
        activityBar.Visible = busy;
    }
}
