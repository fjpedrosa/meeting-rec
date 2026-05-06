import Foundation

@MainActor
class ServerManager {

    // MARK: - Properties

    private var process: Process?
    private var isIntentionallyStopping = false
    private var stdoutPipe: Pipe?
    private var stderrPipe: Pipe?

    var onReady: (() -> Void)?
    var onCrash: (() -> Void)?

    var isRunning: Bool {
        process?.isRunning ?? false
    }

    // MARK: - Path Resolution

    private func resolveProjectRoot() -> URL {
        // Mode 1: Bundled app
        if Bundle.main.bundlePath.hasSuffix(".app"),
           let resourceURL = Bundle.main.resourceURL {
            let bundledServerPath = resourceURL
                .appendingPathComponent("app")
                .appendingPathComponent("server")
                .appendingPathComponent("index.ts")

            if FileManager.default.fileExists(atPath: bundledServerPath.path) {
                return resourceURL.appendingPathComponent("app")
            }
        }

        // Mode 2: Dev mode - walk up from executable
        if let executableURL = Bundle.main.executableURL {
            var currentDir = executableURL.deletingLastPathComponent()

            for _ in 0..<8 {
                let serverIndexPath = currentDir
                    .appendingPathComponent("server")
                    .appendingPathComponent("index.ts")

                if FileManager.default.fileExists(atPath: serverIndexPath.path) {
                    return currentDir
                }

                currentDir = currentDir.deletingLastPathComponent()
            }
        }

        fatalError("Could not resolve project root. Neither bundled app nor dev mode paths contain server/index.ts")
    }

    private func findBunExecutable() -> String? {
        let homeDir = FileManager.default.homeDirectoryForCurrentUser.path
        let candidates = [
            "\(homeDir)/.bun/bin/bun",
            "/opt/homebrew/bin/bun",
            "/usr/local/bin/bun"
        ]

        for candidate in candidates {
            if FileManager.default.isExecutableFile(atPath: candidate) {
                return candidate
            }
        }

        // Fallback: search in PATH
        let pathEnv = ProcessInfo.processInfo.environment["PATH"] ?? ""
        let pathDirs = pathEnv.split(separator: ":").map(String.init)

        for dir in pathDirs {
            let bunPath = "\(dir)/bun"
            if FileManager.default.isExecutableFile(atPath: bunPath) {
                return bunPath
            }
        }

        return nil
    }

    // MARK: - Server Lifecycle

    func start() {
        guard !isRunning else {
            fputs("ServerManager: Server already running\n", stderr)
            return
        }

        guard let bunPath = findBunExecutable() else {
            fputs("ServerManager: Could not find bun executable\n", stderr)
            return
        }

        let projectRoot = resolveProjectRoot()

        isIntentionallyStopping = false

        let process = Process()
        process.executableURL = URL(fileURLWithPath: bunPath)
        process.arguments = ["server/index.ts"]
        process.currentDirectoryURL = projectRoot

        // Environment: inherit + PORT=3457
        var environment = ProcessInfo.processInfo.environment
        environment["PORT"] = "3457"
        process.environment = environment

        // Setup pipes
        let stdoutPipe = Pipe()
        let stderrPipe = Pipe()
        process.standardOutput = stdoutPipe
        process.standardError = stderrPipe

        self.stdoutPipe = stdoutPipe
        self.stderrPipe = stderrPipe

        // Read stdout for readiness detection
        stdoutPipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty else { return }

            if let output = String(data: data, encoding: .utf8) {
                // Log to console for debugging
                fputs("ServerManager [stdout]: \(output)", stderr)

                // Check for server ready indicators
                let lowercased = output.lowercased()
                if lowercased.contains("localhost") ||
                   lowercased.contains("server running") ||
                   lowercased.contains("port") {
                    DispatchQueue.main.async {
                        self?.onReady?()
                    }
                }
            }
        }

        // Read stderr and log it
        stderrPipe.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            guard !data.isEmpty else { return }

            if let output = String(data: data, encoding: .utf8) {
                fputs("ServerManager [stderr]: \(output)", stderr)
            }
        }

        // Termination handler
        process.terminationHandler = { [weak self] terminatedProcess in
            DispatchQueue.main.async {
                guard let self = self else { return }

                // Cleanup pipe handlers
                self.stdoutPipe?.fileHandleForReading.readabilityHandler = nil
                self.stderrPipe?.fileHandleForReading.readabilityHandler = nil

                if !self.isIntentionallyStopping {
                    fputs("ServerManager: Server crashed with exit code \(terminatedProcess.terminationStatus)\n", stderr)
                    self.onCrash?()
                }
            }
        }

        do {
            try process.run()
            self.process = process
            fputs("ServerManager: Started bun server (PID: \(process.processIdentifier))\n", stderr)
        } catch {
            fputs("ServerManager: Failed to start server: \(error.localizedDescription)\n", stderr)
        }
    }

    func waitForReady() async throws {
        let url = URL(string: "http://localhost:3457/")!
        let startTime = Date()
        let timeout: TimeInterval = 15
        let pollInterval: UInt64 = 100_000_000 // 100ms in nanoseconds

        while Date().timeIntervalSince(startTime) < timeout {
            do {
                let (_, response) = try await URLSession.shared.data(from: url)

                if let httpResponse = response as? HTTPURLResponse,
                   httpResponse.statusCode >= 200 && httpResponse.statusCode < 500 {
                    return // Server is ready
                }
            } catch {
                // Server not ready yet, continue polling
            }

            try await Task.sleep(nanoseconds: pollInterval)
        }

        throw ServerError.timeout
    }

    func stop() {
        guard let process = process, process.isRunning else {
            return
        }

        isIntentionallyStopping = true

        // Step 1: Send SIGINT
        process.interrupt()

        // Wait up to 3 seconds
        let waitStart = Date()
        while process.isRunning && Date().timeIntervalSince(waitStart) < 3 {
            Thread.sleep(forTimeInterval: 0.1)
        }

        guard process.isRunning else {
            fputs("ServerManager: Server stopped gracefully\n", stderr)
            cleanup()
            return
        }

        // Step 2: Send SIGTERM
        fputs("ServerManager: Server did not respond to SIGINT, sending SIGTERM\n", stderr)
        process.terminate()

        // Wait 1 more second
        let terminateStart = Date()
        while process.isRunning && Date().timeIntervalSince(terminateStart) < 1 {
            Thread.sleep(forTimeInterval: 0.1)
        }

        guard process.isRunning else {
            fputs("ServerManager: Server stopped after SIGTERM\n", stderr)
            cleanup()
            return
        }

        // Step 3: Force kill with SIGKILL
        fputs("ServerManager: Server did not respond to SIGTERM, sending SIGKILL\n", stderr)
        kill(process.processIdentifier, SIGKILL)

        cleanup()
    }

    private func cleanup() {
        stdoutPipe?.fileHandleForReading.readabilityHandler = nil
        stderrPipe?.fileHandleForReading.readabilityHandler = nil
        stdoutPipe = nil
        stderrPipe = nil
        process = nil
    }

    // MARK: - Error Types

    enum ServerError: Error, LocalizedError {
        case timeout

        var errorDescription: String? {
            switch self {
            case .timeout:
                return "Server did not become ready within 15 seconds"
            }
        }
    }
}
