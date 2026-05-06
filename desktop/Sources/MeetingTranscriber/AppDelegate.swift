import AppKit
import WebKit

@MainActor
class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate {

    // MARK: - Properties

    private var window: NSWindow!
    private var webView: WKWebView!
    private var serverManager = ServerManager()
    private var hasLoadedServer = false
    private var loadingLabel: NSTextField?

    // MARK: - NSApplicationDelegate

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Configure server callbacks
        serverManager.onReady = { [weak self] in
            guard let self = self else { return }
            // Set flag immediately (before async dispatch) to prevent double-fire
            guard !self.hasLoadedServer else { return }
            self.hasLoadedServer = true
            Task { @MainActor [weak self] in
                guard let self = self else { return }
                do {
                    try await self.serverManager.waitForReady()
                    self.loadWebApp()
                } catch {
                    self.showServerError("El servidor tardó demasiado en iniciar")
                }
            }
        }

        serverManager.onCrash = { [weak self] in
            self?.showCrashAlert()
        }

        // Create window
        createWindow()

        // Create and configure WebView
        configureWebView()

        // Show loading state
        showLoadingState()

        // Start the server
        serverManager.start()

        // Show window
        window.makeKeyAndOrderFront(nil)
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if serverManager.isRunning {
            serverManager.stop()
        }
        return .terminateNow
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return false
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag {
            window.makeKeyAndOrderFront(nil)
        }
        return true
    }

    // MARK: - Window Creation

    private func createWindow() {
        let windowRect = NSRect(x: 0, y: 0, width: 1280, height: 800)

        window = NSWindow(
            contentRect: windowRect,
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )

        window.minSize = NSSize(width: 800, height: 600)
        window.setFrameAutosaveName("MainWindow")
        window.title = "Meeting Transcriber"
        window.center()
    }

    // MARK: - WebView Configuration

    private func configureWebView() {
        let config = WKWebViewConfiguration()
        config.defaultWebpagePreferences.allowsContentJavaScript = true

        #if DEBUG
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")
        #endif

        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.translatesAutoresizingMaskIntoConstraints = false

        // Transparent background while loading
        webView.setValue(false, forKey: "drawsBackground")

        guard let contentView = window.contentView else { return }
        contentView.addSubview(webView)

        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: contentView.topAnchor),
            webView.bottomAnchor.constraint(equalTo: contentView.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: contentView.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: contentView.trailingAnchor)
        ])
    }

    // MARK: - Loading State

    private func showLoadingState() {
        guard let contentView = window.contentView else { return }

        let label = NSTextField(labelWithString: "Iniciando servidor...")
        label.font = NSFont.systemFont(ofSize: 16, weight: .medium)
        label.textColor = .secondaryLabelColor
        label.alignment = .center
        label.translatesAutoresizingMaskIntoConstraints = false

        contentView.addSubview(label)

        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: contentView.centerXAnchor),
            label.centerYAnchor.constraint(equalTo: contentView.centerYAnchor)
        ])

        loadingLabel = label
    }

    // MARK: - Load Web App

    private func loadWebApp() {
        loadingLabel?.removeFromSuperview()
        loadingLabel = nil

        let url = URL(string: "http://localhost:3457/")!
        webView.load(URLRequest(url: url))
    }

    // MARK: - WKNavigationDelegate

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        fputs("AppDelegate: WebView navigation failed: \(error.localizedDescription)\n", stderr)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        fputs("AppDelegate: WebView provisional navigation failed: \(error.localizedDescription)\n", stderr)
    }

    func webView(
        _ webView: WKWebView,
        requestMediaCapturePermissionFor origin: WKSecurityOrigin,
        initiatedByFrame frame: WKFrameInfo,
        type: WKMediaCaptureType,
        decisionHandler: @escaping (WKPermissionDecision) -> Void
    ) {
        let trustedHosts = ["localhost", "127.0.0.1"]
        let host = origin.host.lowercased()

        guard trustedHosts.contains(host) else {
            fputs("AppDelegate: Denying media capture permission for untrusted origin \(host)\n", stderr)
            decisionHandler(.deny)
            return
        }

        fputs("AppDelegate: Granting \(type) capture permission for \(host)\n", stderr)
        decisionHandler(.grant)
    }

    // MARK: - Error Handling

    private func showServerError(_ message: String) {
        let alert = NSAlert()
        alert.messageText = "Error del servidor"
        alert.informativeText = message
        alert.alertStyle = .critical
        alert.addButton(withTitle: "Aceptar")
        alert.runModal()
    }

    private func showCrashAlert() {
        let alert = NSAlert()
        alert.messageText = "El servidor se detuvo inesperadamente"
        alert.informativeText = "¿Deseas reiniciarlo?"
        alert.addButton(withTitle: "Reiniciar")
        alert.addButton(withTitle: "Salir")

        if alert.runModal() == .alertFirstButtonReturn {
            hasLoadedServer = false
            serverManager.start()
        } else {
            NSApplication.shared.terminate(nil)
        }
    }
}
