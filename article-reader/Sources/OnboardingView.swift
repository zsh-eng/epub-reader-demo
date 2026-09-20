import SwiftUI
import UIKit

/// First-run guidance stays optional. Only a verified key enables remote tagging.
struct OnboardingView: View {
  var onFinish: () -> Void
  @Environment(\.articleReduceMotion) private var reduceMotion
  @StateObject private var credentials = JevKeySetupModel()
  @State private var page = 0

  private var transition: Animation {
    .easeOut(duration: reduceMotion ? 0.12 : 0.24)
  }

  var body: some View {
    VStack(spacing: 0) {
      header
      ScrollView {
        VStack(alignment: .leading, spacing: 28) {
          illustration
            .frame(maxWidth: .infinity)
          pageContent
        }
        .padding(.horizontal, 28)
        .padding(.top, 18)
        .padding(.bottom, 28)
        .frame(maxWidth: 560)
        .frame(maxWidth: .infinity)
        .id(page)
        .transition(.opacity)
        .accessibilityIdentifier("onboarding-page-\(page + 1)")
      }
      .scrollDismissesKeyboard(.interactively)
      footer
    }
    .background(ReaderTheme.background)
    .foregroundStyle(ReaderTheme.foreground)
    .tint(ReaderTheme.foreground)
    .onDisappear { credentials.cancel() }
  }

  private var header: some View {
    HStack {
      Label("Articles", systemImage: "text.book.closed")
        .font(.headline)
      Spacer()
      Text("\(page + 1) / 3")
        .font(.subheadline.monospacedDigit())
        .foregroundStyle(.secondary)
        .accessibilityLabel("Step \(page + 1) of 3")
    }
    .padding(.horizontal, 28)
    .padding(.vertical, 20)
  }

  @ViewBuilder private var illustration: some View {
    switch page {
    case 0: ShareOnboardingIllustration()
    case 1: PasteOnboardingIllustration()
    default: TaggingOnboardingIllustration()
    }
  }

  @ViewBuilder private var pageContent: some View {
    switch page {
    case 0:
      heading("KEEP WHAT MOVES YOU", "A good read.\nA place to keep it.")
      Text("Find something worth your time? Save it from Safari or another app, then read it here.")
        .foregroundStyle(.secondary)
      instruction(number: "1", text: "Tap the Share button.", symbol: "square.and.arrow.up")
      instruction(number: "2", text: "Choose Articles, then Save.", symbol: "text.book.closed")
      Text("Can’t see Articles? Swipe to More in the app row. Add Articles to your favourites.")
        .font(.footnote).foregroundStyle(.secondary)
    case 1:
      heading("FOLLOW YOUR CURIOSITY", "Copy a link.\nPick up here.")
      Text(
        "Copy an article link and return to Articles. Open it to take a look, or save it for later."
      )
      .foregroundStyle(.secondary)
      VStack(alignment: .leading, spacing: 12) {
        Text("For fewer paste prompts")
          .font(.headline)
        Text("Settings → Apps → Articles → Paste from Other Apps → Allow")
          .font(.subheadline)
          .fixedSize(horizontal: false, vertical: true)
        Button {
          guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
          UIApplication.shared.open(url)
        } label: {
          Label("Open Settings", systemImage: "arrow.up.forward")
            .font(.subheadline.weight(.semibold))
            .padding(.vertical, 8)
        }
        .accessibilityIdentifier("onboarding-open-settings")
      }
      .padding(20)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(ReaderTheme.secondary, in: RoundedRectangle(cornerRadius: 20))
      Text(
        "This option may appear only after the first paste permission prompt. You can also paste a link yourself."
      )
      .font(.footnote).foregroundStyle(.secondary)
    default:
      heading("A LITTLE AUTOMAGIC", "Save the story.\nWe’ll find its place.")
      Text(
        "When you save an article, Jev can add tags like Engineering or Attention & wonder. You can always change them."
      )
      .foregroundStyle(.secondary)
      VStack(alignment: .leading, spacing: 12) {
        JevKeyField(key: $credentials.key)
          .accessibilityIdentifier("onboarding-key")
        Text("Optional · Bring your own Jev API key")
          .font(.caption).foregroundStyle(.secondary)
        Link("Get a key from TypeSafe", destination: URL(string: "https://typesafe.ai")!)
          .font(.subheadline.weight(.medium))
        JevPrivacyNote()
        if let error = credentials.error {
          Text(error).font(.subheadline).accessibilityIdentifier("onboarding-key-error")
        }
      }
    }
  }

  private var footer: some View {
    VStack(spacing: 12) {
      HStack(spacing: 5) {
        ForEach(0..<3) { index in
          Capsule()
            .fill(index == page ? ReaderTheme.foreground : ReaderTheme.border.opacity(0.35))
            .frame(width: index == page ? 24 : 6, height: 6)
        }
      }
      .accessibilityHidden(true)
      HStack(spacing: 12) {
        if page > 0 {
          Button {
            credentials.cancel()
            withAnimation(transition) { page -= 1 }
          } label: {
            Image(systemName: "arrow.left")
              .frame(width: 52, height: 52)
              .background(ReaderTheme.secondary, in: Circle())
          }
          .accessibilityLabel("Previous page")
        }
        Button {
          if page < 2 {
            withAnimation(transition) { page += 1 }
          } else {
            credentials.save(onSuccess: onFinish)
          }
        } label: {
          HStack(spacing: 10) {
            if credentials.isSaving { ProgressView().tint(ReaderTheme.background) }
            Text(
              page < 2
                ? "Continue" : credentials.isSaving ? "Checking key…" : "Enable automatic tags"
            )
            .font(.headline)
          }
          .frame(maxWidth: .infinity, minHeight: 52)
          .foregroundStyle(ReaderTheme.background)
          .background(ReaderTheme.foreground, in: Capsule())
          .opacity(page == 2 && credentials.key.isEmpty ? 0.4 : 1)
        }
        .disabled(page == 2 && (credentials.trimmedKey.isEmpty || credentials.isSaving))
        .accessibilityIdentifier(page == 2 ? "onboarding-finish" : "onboarding-next")
      }
      Button(page == 2 ? "Skip for now" : "Set up later") {
        credentials.cancel()
        onFinish()
      }
      .font(.subheadline)
      .foregroundStyle(.secondary)
      .frame(minHeight: 36)
      .accessibilityIdentifier("onboarding-skip")
    }
    .padding(.horizontal, 28)
    .padding(.top, 16)
    .padding(.bottom, 8)
    .frame(maxWidth: 560)
    .frame(maxWidth: .infinity)
    .background(ReaderTheme.background)
  }

  private func heading(_ eyebrow: String, _ title: String) -> some View {
    VStack(alignment: .leading, spacing: 12) {
      Text(eyebrow)
        .font(.caption2.weight(.semibold)).tracking(2)
        .foregroundStyle(.secondary)
      Text(title)
        .font(.system(.largeTitle, design: .serif, weight: .medium))
        .tracking(-0.8)
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityAddTraits(.isHeader)
    }
  }

  private func instruction(number: String, text: String, symbol: String) -> some View {
    HStack(alignment: .firstTextBaseline, spacing: 14) {
      Text(number).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
      Text(text).font(.subheadline.weight(.medium))
      Spacer(minLength: 4)
      Image(systemName: symbol).accessibilityHidden(true)
    }
  }
}

/// The same configuration remains available after onboarding, including key removal.
struct TaggingSettingsView: View {
  var onChange: () -> Void = {}
  @Environment(\.dismiss) private var dismiss
  @StateObject private var credentials = JevKeySetupModel()
  @State private var enabled = JevKeySetupModel.taggingEnabled

  var body: some View {
    NavigationStack {
      Form {
        Section {
          Toggle("Automatically tag saved articles", isOn: $enabled)
            .disabled(!credentials.hasStoredKey)
            .accessibilityIdentifier("settings-toggle")
        } footer: {
          Text("Only articles you save are tagged. Your manual tag changes take priority.")
        }
        Section {
          if credentials.hasStoredKey {
            Label("API key saved on this device", systemImage: "checkmark.shield")
              .font(.subheadline)
          }
          JevKeyField(key: $credentials.key)
            .accessibilityIdentifier("settings-key")
          Button {
            credentials.save {
              enabled = true
              onChange()
            }
          } label: {
            HStack {
              Text(credentials.hasStoredKey ? "Verify and replace key" : "Verify and save key")
              if credentials.isSaving {
                Spacer()
                ProgressView()
              }
            }
          }
          .disabled(credentials.trimmedKey.isEmpty || credentials.isSaving)
          .accessibilityIdentifier("settings-save")
          if credentials.hasStoredKey {
            Button("Remove API key", role: .destructive) {
              credentials.remove()
              enabled = JevKeySetupModel.taggingEnabled
              onChange()
            }.accessibilityIdentifier("settings-remove")
          }
          if let error = credentials.error {
            Text(error).font(.subheadline).accessibilityIdentifier("tagging-key-error")
          }
        } header: {
          Text("Your Jev key")
        } footer: {
          JevPrivacyNote()
        }
        Section("Categories") {
          ForEach(ArticleTagCatalog.all, id: \.id) { tag in
            VStack(alignment: .leading, spacing: 5) {
              Text(tag.name).font(.body.weight(.medium))
              Text(tag.detail).font(.caption).foregroundStyle(.secondary)
            }.padding(.vertical, 4)
          }
        }
        Section {
          Link("Get a Jev API key", destination: URL(string: "https://typesafe.ai")!)
        }
      }
      .navigationTitle("Automatic tags")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
      }
      .onAppear { credentials.refreshStoredKey() }
      .onChange(of: enabled) { _, value in
        JevKeySetupModel.taggingEnabled = value
        onChange()
      }
      .onDisappear { credentials.cancel() }
    }
    .tint(ReaderTheme.foreground)
  }
}

private struct JevKeyField: View {
  @Binding var key: String
  var body: some View {
    SecureField("Jev API key", text: $key)
      .textInputAutocapitalization(.never)
      .autocorrectionDisabled()
      .textContentType(.password)
      .submitLabel(.done)
      .padding(16)
      .background(ReaderTheme.secondary, in: RoundedRectangle(cornerRadius: 14))
  }
}

private struct JevPrivacyNote: View {
  var body: some View {
    Label {
      Text(
        "Your key stays in the iOS Keychain. Saved article titles and descriptions are sent to TypeSafe for tagging. Full article text is not sent."
      )
      .fixedSize(horizontal: false, vertical: true)
    } icon: {
      Image(systemName: "lock")
    }
    .font(.footnote).foregroundStyle(.secondary)
  }
}

/// Cancellation prevents a skipped or dismissed screen from later saving a key.
@MainActor
private final class JevKeySetupModel: ObservableObject {
  @Published var key = ""
  @Published var error: String?
  @Published var isSaving = false
  @Published var hasStoredKey = false
  private var request: Task<Void, Never>?
  private var requestID = UUID()
  // UI fixtures never access a real credential, preference, or network endpoint.
  private static var fixtureKey: String?
  private static var fixtureEnabled = false
  static var taggingEnabled: Bool {
    get { TestMode.enabled ? fixtureEnabled : TaggingPreferences.enabled }
    set {
      if TestMode.enabled {
        fixtureEnabled = newValue
      } else {
        TaggingPreferences.enabled = newValue
      }
    }
  }
  var trimmedKey: String { key.trimmingCharacters(in: .whitespacesAndNewlines) }

  func refreshStoredKey() {
    if TestMode.enabled {
      hasStoredKey = Self.fixtureKey != nil
      return
    }
    error = TaggingPreferences.lastError
    do { hasStoredKey = try JevKeychain.read() != nil } catch {
      self.error = "Could not read the saved key. Try again after unlocking your device."
    }
  }

  func save(onSuccess: @escaping () -> Void) {
    guard !trimmedKey.isEmpty, !isSaving else { return }
    let candidate = trimmedKey
    error = nil
    isSaving = true
    let id = UUID()
    requestID = id
    request = Task {
      do {
        if TestMode.enabled {
          guard ProcessInfo.processInfo.arguments.contains("-test-key-success"),
            !ProcessInfo.processInfo.arguments.contains("-test-key-failure")
          else { throw JevError.invalidKey }
          await Task.yield()
        } else {
          try await JevClient.validate(apiKey: candidate)
        }
        try Task.checkCancellation()
        guard requestID == id else { return }
        if TestMode.enabled { Self.fixtureKey = candidate } else { try JevKeychain.save(candidate) }
        Self.taggingEnabled = true
        hasStoredKey = true
        key = ""
        isSaving = false
        onSuccess()
      } catch is CancellationError {
        if requestID == id { isSaving = false }
      } catch {
        guard !Task.isCancelled, requestID == id else { return }
        self.error =
          "Could not verify and save the key. Check your key and connection, then try again."
        isSaving = false
      }
    }
  }

  func remove() {
    cancel()
    do {
      if TestMode.enabled { Self.fixtureKey = nil } else { try JevKeychain.delete() }
      Self.taggingEnabled = false
      hasStoredKey = false
      key = ""
      error = nil
    } catch {
      self.error = "Could not remove the key. Try again after unlocking your device."
    }
  }

  func cancel() {
    requestID = UUID()
    request?.cancel()
    request = nil
    isSaving = false
  }
}
