import AppKit
import Foundation

private let commonRuntimeDirectoryName = "common"
private let arm64RuntimeDirectoryName = "macos-arm64"
private let x86RuntimeDirectoryName = "macos-x86_64"
private func displayLauncherVersion(_ value: String) -> String {
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty {
        return "dev"
    }
    if let range = trimmed.range(of: #"^v?\d+(?:\.\d+){1,2}"#, options: .regularExpression) {
        return String(trimmed[range])
    }
    return trimmed
}
private let launcherVersionText: String = {
    if let value = Bundle.main.object(forInfoDictionaryKey: "GoDreamAIReleaseVersion") as? String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty {
            return displayLauncherVersion(trimmed)
        }
    }
    return "dev"
}()
private let launcherModelSummary = """
生图：Seedream 5.0 Pro / Seedream 5.0 Lite / Seedream 4.5 / Kling Image 3.0 / Kling Image 3.0 Omni
生视频：Seedance 2.0 / Seedance 2.0 Fast / Seedance 2.0 Mini / Kling 3.0 Turbo / Kling 3.0 Omni
"""

struct BackendResult: Decodable {
    let ok: Bool
    let code: String
    let status_text: String
    let detail_text: String
    let show_install: Bool
    let enable_launch: Bool
    let target_url: String
}

enum LauncherInvokeError: Error {
    case message(String)
}

private enum BundledPythonStatus {
    case executable(URL)
    case existsButNotExecutable(URL)
    case missing(URL)
}

final class LauncherAppDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow!
    private let checkButton = NSButton(title: "检测环境", target: nil, action: nil)
    private let launchButton = NSButton(title: "启动", target: nil, action: nil)
    private let installButton = NSButton(title: "一键安装环境", target: nil, action: nil)
    private let statusLabel = NSTextField(labelWithString: "点击“检测环境”开始")
    private let detailLabel = NSTextField(wrappingLabelWithString: "")
    private let activity = NSProgressIndicator()
    private var desiredLaunchEnabled = false
    private var desiredInstallVisible = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildWindow()
        applyIdleState()
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    @objc private func handleCheck() {
        runBackend(action: "check", preflightStatus: "正在检测环境…")
    }

    @objc private func handleInstall() {
        runBackend(action: "install", preflightStatus: "正在安装环境，请稍候…")
    }

    @objc private func handleLaunch() {
        runBackend(action: "launch", preflightStatus: "正在启动前端…")
    }

    private func buildWindow() {
        let frame = NSRect(x: 0, y: 0, width: 548, height: 432)
        window = NSWindow(
            contentRect: frame,
            styleMask: [.titled, .closable, .miniaturizable],
            backing: .buffered,
            defer: false
        )
        window.center()
        window.title = "井鸽启动器"
        window.isReleasedWhenClosed = false

        let content = NSView(frame: frame)
        content.wantsLayer = true
        content.layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor
        window.contentView = content

        let titleLabel = NSTextField(labelWithString: "井鸽启动器")
        titleLabel.font = .systemFont(ofSize: 24, weight: .bold)
        titleLabel.textColor = .labelColor

        let subtitleLabel = NSTextField(labelWithString: "AI视频创作套件")
        subtitleLabel.font = .systemFont(ofSize: 12, weight: .medium)
        subtitleLabel.textColor = .secondaryLabelColor

        let versionLabel = NSTextField(labelWithString: "版本 \(launcherVersionText)")
        versionLabel.font = .systemFont(ofSize: 12, weight: .medium)
        versionLabel.textColor = .secondaryLabelColor

        let titleGroup = NSStackView(views: [titleLabel, subtitleLabel, versionLabel])
        titleGroup.orientation = .vertical
        titleGroup.alignment = .leading
        titleGroup.spacing = 4

        let modelsTitleLabel = NSTextField(labelWithString: "可调用模型")
        modelsTitleLabel.font = .systemFont(ofSize: 12, weight: .semibold)
        modelsTitleLabel.textColor = .secondaryLabelColor

        let modelsLabel = NSTextField(wrappingLabelWithString: launcherModelSummary)
        modelsLabel.font = .systemFont(ofSize: 12, weight: .regular)
        modelsLabel.textColor = .secondaryLabelColor
        modelsLabel.maximumNumberOfLines = 3
        modelsLabel.lineBreakMode = .byWordWrapping

        let modelsGroup = NSStackView(views: [modelsTitleLabel, modelsLabel])
        modelsGroup.orientation = .vertical
        modelsGroup.alignment = .leading
        modelsGroup.spacing = 3

        statusLabel.font = .systemFont(ofSize: 15, weight: .semibold)
        statusLabel.maximumNumberOfLines = 2
        statusLabel.lineBreakMode = .byWordWrapping

        detailLabel.font = .systemFont(ofSize: 12, weight: .regular)
        detailLabel.textColor = .secondaryLabelColor
        detailLabel.maximumNumberOfLines = 3
        detailLabel.lineBreakMode = .byWordWrapping
        detailLabel.isHidden = true

        activity.style = .spinning
        activity.controlSize = .regular
        activity.isDisplayedWhenStopped = false

        configure(button: checkButton, action: #selector(handleCheck))
        configure(button: launchButton, action: #selector(handleLaunch))
        configure(button: installButton, action: #selector(handleInstall))
        installButton.isHidden = true

        let primaryButtons = NSStackView(views: [checkButton, launchButton])
        primaryButtons.orientation = .horizontal
        primaryButtons.spacing = 12
        primaryButtons.distribution = .fillEqually

        let footerRow = NSStackView(views: [activity, NSView()])
        footerRow.orientation = .horizontal
        footerRow.spacing = 8
        footerRow.alignment = .centerY

        let copyrightLabel = NSTextField(labelWithString: "©井鸽 2026")
        copyrightLabel.font = .systemFont(ofSize: 13, weight: .medium)
        copyrightLabel.textColor = .secondaryLabelColor

        let websiteLabel = linkLabel(text: "www.wellpigeon.com", url: "https://www.wellpigeon.com")
        let qqLabel = NSTextField(labelWithString: "QQ交流群：1046590358")
        qqLabel.font = .systemFont(ofSize: 13, weight: .medium)
        qqLabel.textColor = .secondaryLabelColor

        let brandFooter = NSStackView(views: [copyrightLabel, websiteLabel, qqLabel])
        brandFooter.orientation = .vertical
        brandFooter.alignment = .leading
        brandFooter.spacing = 2

        let stack = NSStackView(views: [titleGroup, modelsGroup, statusLabel, detailLabel, primaryButtons, installButton, footerRow, NSView(), brandFooter])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 14
        stack.translatesAutoresizingMaskIntoConstraints = false

        content.addSubview(stack)

        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -24),
            stack.topAnchor.constraint(equalTo: content.topAnchor, constant: 24),
            stack.bottomAnchor.constraint(equalTo: content.bottomAnchor, constant: -20),
            checkButton.heightAnchor.constraint(equalToConstant: 36),
            launchButton.heightAnchor.constraint(equalToConstant: 36),
            installButton.heightAnchor.constraint(equalToConstant: 36),
            installButton.widthAnchor.constraint(equalToConstant: 156)
        ])

        window.makeKeyAndOrderFront(nil)
    }

    private func configure(button: NSButton, action: Selector) {
        button.target = self
        button.action = action
        button.bezelStyle = .rounded
        button.font = .systemFont(ofSize: 14, weight: .semibold)
        button.setButtonType(.momentaryPushIn)
    }

    private func linkLabel(text: String, url: String) -> NSTextField {
        let label = NSTextField(labelWithString: "")
        label.allowsEditingTextAttributes = true
        label.isSelectable = true
        label.isBezeled = false
        label.drawsBackground = false
        label.lineBreakMode = .byTruncatingTail
        label.font = .systemFont(ofSize: 13, weight: .medium)
        let attributes: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: 13, weight: .medium),
            .foregroundColor: NSColor.linkColor,
            .underlineStyle: NSUnderlineStyle.single.rawValue,
            .link: url,
        ]
        label.attributedStringValue = NSAttributedString(string: text, attributes: attributes)
        return label
    }

    private func applyIdleState() {
        statusLabel.stringValue = "点击“检测环境”开始"
        statusLabel.textColor = .labelColor
        detailLabel.stringValue = ""
        detailLabel.isHidden = true
        desiredInstallVisible = false
        desiredLaunchEnabled = false
        installButton.isHidden = true
        launchButton.isEnabled = false
        checkButton.isEnabled = true
    }

    private func runBackend(action: String, preflightStatus: String) {
        let repoRoot: URL
        do {
            repoRoot = try resolveRuntimeRoot()
        } catch {
            applyStatus(
                text: "未找到可用运行时",
                detail: error.localizedDescription,
                color: .systemRed,
                showInstall: false,
                enableLaunch: false,
                showDetail: true
            )
            return
        }
        let pythonPath: URL
        switch bundledPythonStatus(in: repoRoot) {
        case .executable(let resolvedPath):
            pythonPath = resolvedPath
        case .existsButNotExecutable(let candidate):
            applyStatus(
                text: "内置 Python 运行时不可执行",
                detail: "\(candidate.path)\n发布包权限异常或已损坏，请重新下载最新版。",
                color: .systemRed,
                showInstall: false,
                enableLaunch: false,
                showDetail: true
            )
            return
        case .missing(let candidate):
            applyStatus(
                text: "缺少内置 Python 运行时",
                detail: candidate.path,
                color: .systemRed,
                showInstall: false,
                enableLaunch: false,
                showDetail: true
            )
            return
        }
        let backendScript = repoRoot.appendingPathComponent("scripts/launcher_backend.py")
        guard FileManager.default.fileExists(atPath: backendScript.path) else {
            applyStatus(
                text: "缺少启动器后端脚本",
                detail: backendScript.path,
                color: .systemRed,
                showInstall: false,
                enableLaunch: false,
                showDetail: true
            )
            return
        }

        setBusy(true)
        statusLabel.stringValue = preflightStatus
        statusLabel.textColor = .labelColor
        detailLabel.stringValue = ""
        detailLabel.isHidden = true

        DispatchQueue.global(qos: .userInitiated).async {
            let result = self.invokeBackend(pythonPath: pythonPath.path, scriptPath: backendScript.path, action: action)
            DispatchQueue.main.async {
                self.setBusy(false)
                switch result {
                case .success(let payload):
                    self.apply(payload: payload, action: action)
                case .failure(let error):
                    self.applyStatus(
                        text: "启动器执行失败",
                        detail: {
                            switch error {
                            case .message(let message):
                                return message
                            }
                        }(),
                        color: .systemRed,
                        showInstall: false,
                        enableLaunch: false,
                        showDetail: true
                    )
                }
            }
        }
    }

    private func isRuntimeRoot(_ root: URL) -> Bool {
        let requiredPaths = [
            root.appendingPathComponent("web_lite3").path,
            root.appendingPathComponent("scripts").path,
            root.appendingPathComponent("README.md").path,
            root.appendingPathComponent("requirements.txt").path,
            root.appendingPathComponent("python").path,
            root.appendingPathComponent("wheelhouse").path,
            root.appendingPathComponent("ffmpeg").path,
        ]
        return requiredPaths.allSatisfy { FileManager.default.fileExists(atPath: $0) }
    }

    private func detectRuntimeTarget() -> String? {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/uname")
        process.arguments = ["-m"]
        let output = Pipe()
        process.standardOutput = output
        process.standardError = Pipe()
        do {
            try process.run()
        } catch {
            return nil
        }
        process.waitUntilExit()
        guard process.terminationStatus == 0 else {
            return nil
        }
        let data = output.fileHandleForReading.readDataToEndOfFile()
        let machine = String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        switch machine {
        case "arm64", "aarch64":
            return arm64RuntimeDirectoryName
        case "x86_64", "amd64":
            return x86RuntimeDirectoryName
        default:
            return nil
        }
    }

    private func managedRuntimeRoot() -> URL? {
        guard let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {
            return nil
        }
        return appSupport
            .appendingPathComponent("GoDreamAI Plus Launcher", isDirectory: true)
            .appendingPathComponent("runtime", isDirectory: true)
    }

    private func repairExecutableBits(in directory: URL) throws {
        let fileManager = FileManager.default
        guard fileManager.fileExists(atPath: directory.path) else {
            return
        }
        let keys: [URLResourceKey] = [.isRegularFileKey]
        guard let enumerator = fileManager.enumerator(at: directory, includingPropertiesForKeys: keys) else {
            return
        }
        for case let item as URL in enumerator {
            let values = try item.resourceValues(forKeys: Set(keys))
            guard values.isRegularFile == true else {
                continue
            }
            try fileManager.setAttributes([.posixPermissions: 0o755], ofItemAtPath: item.path)
        }
    }

    private func repairManagedRuntimeExecutables(in runtimeRoot: URL) throws {
        try repairExecutableBits(in: runtimeRoot.appendingPathComponent("python/bin", isDirectory: true))
        try repairExecutableBits(in: runtimeRoot.appendingPathComponent("ffmpeg/bin", isDirectory: true))
    }

    private func syncEmbeddedRuntime(to destination: URL, runtimeTarget: String) throws {
        guard let embeddedRoot = Bundle.main.resourceURL?.appendingPathComponent("runtime", isDirectory: true) else {
            throw NSError(domain: "GoDreamAILauncher", code: 2, userInfo: [
                NSLocalizedDescriptionKey: "应用内未发现可用运行时资源。"
            ])
        }
        let commonRoot = embeddedRoot.appendingPathComponent(commonRuntimeDirectoryName, isDirectory: true)
        let payloadRoot = embeddedRoot.appendingPathComponent(runtimeTarget, isDirectory: true)
        guard FileManager.default.fileExists(atPath: commonRoot.path),
              FileManager.default.fileExists(atPath: payloadRoot.path) else {
            throw NSError(domain: "GoDreamAILauncher", code: 3, userInfo: [
                NSLocalizedDescriptionKey: "应用内未发现匹配当前架构的 runtime payload。"
            ])
        }
        let fileManager = FileManager.default
        try fileManager.createDirectory(at: destination, withIntermediateDirectories: true)
        let commonNames = ["README.md", "requirements.txt", "scripts", "web_lite3"]
        let payloadNames = ["python", "wheelhouse", "ffmpeg"]
        for name in commonNames {
            let target = destination.appendingPathComponent(name)
            if fileManager.fileExists(atPath: target.path) {
                try fileManager.removeItem(at: target)
            }
            try fileManager.copyItem(at: commonRoot.appendingPathComponent(name), to: target)
        }
        for name in payloadNames {
            let target = destination.appendingPathComponent(name)
            if fileManager.fileExists(atPath: target.path) {
                try fileManager.removeItem(at: target)
            }
            try fileManager.copyItem(at: payloadRoot.appendingPathComponent(name), to: target)
        }
        try repairManagedRuntimeExecutables(in: destination)
    }

    private func resolveRuntimeRoot() throws -> URL {
        guard let managedRoot = managedRuntimeRoot() else {
            throw NSError(domain: "GoDreamAILauncher", code: 10, userInfo: [
                NSLocalizedDescriptionKey: "无法定位 Application Support 目录。"
            ])
        }
        guard let runtimeTarget = detectRuntimeTarget() else {
            throw NSError(domain: "GoDreamAILauncher", code: 11, userInfo: [
                NSLocalizedDescriptionKey: "无法识别当前 macOS 架构。"
            ])
        }
        try syncEmbeddedRuntime(to: managedRoot, runtimeTarget: runtimeTarget)
        guard isRuntimeRoot(managedRoot) else {
            throw NSError(domain: "GoDreamAILauncher", code: 12, userInfo: [
                NSLocalizedDescriptionKey: "同步后的 runtime 目录不完整。"
            ])
        }
        return managedRoot
    }

    private func bundledPythonStatus(in runtimeRoot: URL) -> BundledPythonStatus {
        let fileManager = FileManager.default
        let candidates = [
            runtimeRoot.appendingPathComponent("python/bin/python3.11"),
            runtimeRoot.appendingPathComponent("python/bin/python3"),
            runtimeRoot.appendingPathComponent("python/bin/python"),
        ]
        var firstPresentCandidate: URL?
        for candidate in candidates {
            guard fileManager.fileExists(atPath: candidate.path) else {
                continue
            }
            if fileManager.isExecutableFile(atPath: candidate.path) {
                return .executable(candidate)
            }
            if firstPresentCandidate == nil {
                firstPresentCandidate = candidate
            }
        }
        if let firstPresentCandidate {
            return .existsButNotExecutable(firstPresentCandidate)
        }
        return .missing(candidates[0])
    }

    private func invokeBackend(pythonPath: String, scriptPath: String, action: String) -> Result<BackendResult, LauncherInvokeError> {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: pythonPath)
        process.arguments = [scriptPath, action]
        let stdout = Pipe()
        let stderr = Pipe()
        process.standardOutput = stdout
        process.standardError = stderr
        do {
            try process.run()
        } catch {
            return .failure(.message(error.localizedDescription))
        }
        process.waitUntilExit()
        let stdoutData = stdout.fileHandleForReading.readDataToEndOfFile()
        let stderrData = stderr.fileHandleForReading.readDataToEndOfFile()
        let decoder = JSONDecoder()
        do {
            let payload = try decoder.decode(BackendResult.self, from: stdoutData)
            return .success(payload)
        } catch {
            let stderrText = String(decoding: stderrData, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
            let stdoutText = String(decoding: stdoutData, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
            let detail = [stdoutText, stderrText].filter { !$0.isEmpty }.joined(separator: "\n")
            return .failure(.message(detail.isEmpty ? error.localizedDescription : detail))
        }
    }

    private func apply(payload: BackendResult, action: String) {
        let color: NSColor
        if payload.ok {
            color = payload.code == "installed" ? .systemBlue : .systemGreen
        } else if payload.show_install {
            color = .systemOrange
        } else {
            color = .systemRed
        }
        applyStatus(
            text: payload.status_text,
            detail: payload.detail_text,
            color: color,
            showInstall: payload.show_install,
            enableLaunch: payload.enable_launch,
            showDetail: !payload.ok
        )
        if action == "install" && payload.ok {
            launchButton.isEnabled = false
        }
    }

    private func applyStatus(text: String, detail: String, color: NSColor, showInstall: Bool, enableLaunch: Bool, showDetail: Bool = false) {
        statusLabel.stringValue = text
        statusLabel.textColor = color
        let normalizedDetail = detail.trimmingCharacters(in: .whitespacesAndNewlines)
        detailLabel.stringValue = normalizedDetail
        detailLabel.isHidden = !showDetail || normalizedDetail.isEmpty
        desiredInstallVisible = showInstall
        desiredLaunchEnabled = enableLaunch
        installButton.isHidden = !showInstall
        launchButton.isEnabled = enableLaunch
    }

    private func setBusy(_ busy: Bool) {
        checkButton.isEnabled = !busy
        installButton.isEnabled = !busy
        installButton.isHidden = busy ? true : !desiredInstallVisible
        launchButton.isEnabled = !busy && desiredLaunchEnabled
        if busy {
            activity.startAnimation(nil)
        } else {
            activity.stopAnimation(nil)
        }
    }
}

let app = NSApplication.shared
let delegate = LauncherAppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
