"""Extract the production catalogue for host-side model checks, without Keychain/network."""
import re

def production_tag_catalog(root):
    source = (root / "Shared/ArticleTagging.swift").read_text()
    catalog = source[source.index("struct ReadingTag:"):source.index("enum TaggingPreferences")]
    constants = "\n".join(re.findall(r"  static let (?:model|threshold) = [^\n]+", source))
    return "import Foundation\nimport CryptoKit\n" + catalog + "enum JevClient {\n" + constants + "\n}\n"
