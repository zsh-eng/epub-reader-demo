import SwiftUI
import UIKit

/// First-run guidance stays optional. Only a verified key enables remote tagging.
struct OnboardingView: View {
  var onFinish: () -> Void
  @Environment(\.articleReduceMotion) private var reduceMotion
  @StateObject private var credentials = JevKeySetupModel()
  @State private var page = 0
  @FocusState private var keyFocused: Bool
  @State private var keyboardFrame = CGRect.null
  @State private var restingDockHeight: CGFloat = 0

  private var transition: Animation {
    .easeOut(duration: reduceMotion ? 0.12 : 0.24)
  }

  var body: some View {
    GeometryReader { geometry in
      let frame = geometry.frame(in: .global)
      // Floating iPad keyboards do not obscure the bottom action area.
      let keyboardOverlap =
        keyboardFrame.maxY >= frame.maxY - 1
        ? max(0, frame.maxY - keyboardFrame.minY) : 0
      let editingKey = keyboardOverlap > 0
      ZStack(alignment: .bottom) {
        VStack(spacing: 0) {
          header
          ScrollView {
            VStack(alignment: .leading, spacing: page == 2 ? 16 : 24) {
              heading
              illustration.frame(maxWidth: .infinity)
              if page < 2 { pageContent }
            }
            .padding(.horizontal, 28)
            .padding(.top, 24)
            .padding(.bottom, page == 2 ? restingDockHeight + 16 : 16)
            .frame(maxWidth: 560)
            .frame(maxWidth: .infinity)
            .id(page)
            .transition(reduceMotion ? .identity : .opacity)
          }
          if page < 2 { footer() }
        }
        if page == 2 {
          keyDock(compact: editingKey)
            .onGeometryChange(for: CGFloat.self) {
              $0.size.height
            } action: { height in
              if !keyFocused && keyboardOverlap == 0 { restingDockHeight = height }
            }
            .padding(.bottom, keyboardOverlap)
        }
      }
      .onReceive(
        NotificationCenter.default.publisher(for: UIResponder.keyboardWillChangeFrameNotification)
      ) { note in
        guard let rect = note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect else {
          return
        }
        let duration =
          note.userInfo?[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double ?? 0.25
        withAnimation(reduceMotion ? nil : .easeOut(duration: duration)) { keyboardFrame = rect }
      }
      .onReceive(
        NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)
      ) { note in
        let duration =
          note.userInfo?[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double ?? 0.25
        withAnimation(reduceMotion ? nil : .easeOut(duration: duration)) { keyboardFrame = .null }
      }
    }
    // Only the dock follows keyboard geometry. The article replay keeps its size
    // and position, and the field/action never compete with ScrollView avoidance.
    .ignoresSafeArea(.keyboard, edges: .bottom)
    .background(ReaderTheme.background)
    .foregroundStyle(ReaderTheme.foreground)
    .tint(ArcticBrand.accent)
    .onDisappear { credentials.cancel() }
  }

  private func keyDock(compact: Bool) -> some View {
    VStack(spacing: 0) {
      VStack(alignment: .leading, spacing: 12) {
        JevKeyField(key: $credentials.key)
          .focused($keyFocused)
          .onSubmit { keyFocused = false }
          .accessibilityIdentifier("onboarding-key")
        if !compact {
          HStack {
            Text("Optional").foregroundStyle(.secondary)
            Spacer()
            Link("Get a key", destination: URL(string: "https://console.typesafe.ai/keys")!)
          }
          .font(.caption)
          .padding(.horizontal, 16)
          JevPrivacyNote(compact: true)
            .padding(.horizontal, 16)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("onboarding-privacy-note")
        }
        if let error = credentials.error {
          Text(error).font(.subheadline).accessibilityIdentifier("onboarding-key-error")
        }
      }
      .padding(.horizontal, 28)
      .padding(.top, 16)
      footer(compact: compact)
    }
    .frame(maxWidth: 560)
    .background(
      ReaderTheme.background,
      in: UnevenRoundedRectangle(topLeadingRadius: 24, topTrailingRadius: 24)
    )
    .accessibilityIdentifier("onboarding-key-dock")
  }

  private var header: some View {
    HStack {
      HStack(spacing: 8) {
        ArcticMark().frame(width: 26, height: 26)
        Text("Arctic").font(.headline)
      }
      .accessibilityElement(children: .combine)
      Spacer()
      Text("\(page + 1) / 3")
        .font(.subheadline.monospacedDigit())
        .foregroundStyle(.secondary)
        .accessibilityLabel("Step \(page + 1) of 3")
    }
    .padding(.horizontal, 28)
    .padding(.vertical, 12)
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
      Text("Share → Arctic → Save")
        .font(.subheadline)
        .foregroundStyle(.secondary)
        .frame(maxWidth: .infinity)
    case 1:
      VStack(alignment: .leading, spacing: 10) {
        Button {
          guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
          UIApplication.shared.open(url)
        } label: {
          HStack {
            Text("Open Settings").font(.subheadline.weight(.semibold))
            Spacer()
            Image(systemName: "arrow.up.forward")
          }
          .padding(16)
          .background(ReaderTheme.secondary, in: RoundedRectangle(cornerRadius: 16))
        }
        .accessibilityIdentifier("onboarding-open-settings")
        Text("Appears after your first paste permission prompt.")
          .font(.caption).foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)
          .padding(.horizontal, 16)
          .accessibilityIdentifier("onboarding-paste-note")
      }
    default:
      EmptyView()
    }
  }

  private func footer(compact: Bool = false) -> some View {
    VStack(spacing: 8) {
      if !compact {
        HStack(spacing: 5) {
          ForEach(0..<3) { index in
            Capsule()
              .fill(index == page ? ArcticBrand.accent : ReaderTheme.border.opacity(0.35))
              .frame(width: index == page ? 24 : 6, height: 6)
          }
        }
        .accessibilityHidden(true)
      }
      HStack(spacing: 12) {
        if page > 0 {
          Button {
            if compact {
              keyFocused = false
            } else {
              credentials.cancel()
              changePage(to: page - 1)
            }
          } label: {
            Image(systemName: compact ? "chevron.down" : "arrow.left")
              .frame(width: 52, height: 52)
              .background(ReaderTheme.secondary, in: Circle())
          }
          .accessibilityLabel(compact ? "Dismiss keyboard" : "Previous page")
          .accessibilityIdentifier(compact ? "onboarding-dismiss-keyboard" : "onboarding-previous")
        }
        Button {
          if page < 2 {
            changePage(to: page + 1)
          } else {
            credentials.save {
              keyFocused = false
              onFinish()
            }
          }
        } label: {
          HStack(spacing: 10) {
            if credentials.isSaving { ProgressView().tint(ArcticBrand.onAccent) }
            Text(
              page < 2
                ? "Continue" : credentials.isSaving ? "Checking key…" : "Enable tags"
            )
            .font(.headline)
          }
          .frame(maxWidth: .infinity, minHeight: 52)
          .foregroundStyle(ArcticBrand.onAccent)
          .background(ArcticBrand.accent, in: Capsule())
          .opacity(page == 2 && credentials.key.isEmpty ? 0.4 : 1)
        }
        .disabled(page == 2 && (credentials.trimmedKey.isEmpty || credentials.isSaving))
        .accessibilityIdentifier(page == 2 ? "onboarding-finish" : "onboarding-next")
      }
      if !compact {
        Button("Skip for now") {
          keyFocused = false
          credentials.cancel()
          onFinish()
        }
        .font(.subheadline)
        .foregroundStyle(.secondary)
        .frame(minHeight: 36)
        .accessibilityIdentifier("onboarding-skip")
      }
    }
    .padding(.horizontal, 28)
    .padding(.top, 16)
    .padding(.bottom, 8)
    .frame(maxWidth: 560)
    .frame(maxWidth: .infinity)
    .background(ReaderTheme.background)
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("onboarding-footer")
  }

  private func changePage(to value: Int) {
    keyFocused = false
    if reduceMotion { page = value } else { withAnimation(transition) { page = value } }
  }

  private var heading: some View {
    Text(["Keep a good read.", "Open copied links.", "A little magic."][page])
      .font(.system(.largeTitle, design: .rounded, weight: .semibold))
      .tracking(-0.8)
      .fixedSize(horizontal: false, vertical: true)
      .accessibilityAddTraits(.isHeader)
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
          Link("Get a Jev API key", destination: URL(string: "https://console.typesafe.ai/keys")!)
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
    .tint(ArcticBrand.accent)
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
  var compact = false
  @State private var showsDetails = false

  var body: some View {
    if compact {
      HStack(spacing: 6) {
        Text("Key stored in Keychain.")
          .fixedSize(horizontal: false, vertical: true)
        Button {
          showsDetails = true
        } label: {
          Image(systemName: "info.circle")
            .frame(width: 32, height: 32)
            .contentShape(Rectangle())
        }
        .accessibilityLabel("What is sent to Jev")
        .popover(isPresented: $showsDetails) {
          Text(
            "When you share or paste a link, its title, description, and sometimes a short excerpt go to Jev before you save. Tags are kept only if you save. Your API key stays in Keychain on this device."
          )
          .font(.subheadline).lineLimit(nil)
          .frame(width: 260, alignment: .leading)
          .fixedSize(horizontal: false, vertical: true)
          .padding(20)
          .presentationCompactAdaptation(.popover)
        }
      }
      .font(.caption).foregroundStyle(.secondary)
    } else {
      Text("Key stored in Keychain. Link previews and short excerpts go to Jev before saving.")
        .font(.footnote).foregroundStyle(.secondary)
        .fixedSize(horizontal: false, vertical: true)
    }
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
