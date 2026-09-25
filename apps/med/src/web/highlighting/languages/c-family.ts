import { compile } from "@twinkleplop/core/compile";
import {
  ALNUM,
  DIGIT,
  HEX,
  LETTER,
  enter,
  fallback,
  goto,
  keyword,
  leave,
  match,
  on,
  range,
  tokenize as scan,
  type Grammar,
  type TokenizeResult,
} from "@twinkleplop/core";

const words = (s: string) => s.split(" ");
const allPrimitives = words(
  "void boolean byte char short int long float double bool wchar_t char8_t char16_t char32_t signed unsigned",
);
const allModifiers = words(
  "public protected private static final abstract native synchronized transient volatile strictfp sealed non-sealed const constexpr consteval constinit inline virtual explicit friend mutable extern register thread_local typedef typename",
);
const javaKeywords = words(
  "assert break case catch class continue default do else enum exports extends finally for if implements import instanceof interface module new open opens package permits provides record requires return super switch this throw throws to transitive try uses var while with yield",
);
const cppKeywords = words(
  "alignas alignof asm auto break case catch class concept continue co_await co_return co_yield decltype default delete do else enum export for goto if namespace new noexcept nullptr operator requires return sizeof static_assert struct switch template this throw try union using while and and_eq bitand bitor compl not not_eq or or_eq xor xor_eq dynamic_cast static_cast const_cast reinterpret_cast",
);

/** Native Twinkleplop states. No TextMate grammar or Shiki engine is loaded. */
export function createCFamily(language: "java" | "cpp") {
  const cpp = language === "cpp";
  const primitives = cpp
    ? allPrimitives
        .filter((w) => !["boolean", "byte"].includes(w))
        .concat(
          words(
            "size_t ssize_t ptrdiff_t int8_t int16_t int32_t int64_t uint8_t uint16_t uint32_t uint64_t intptr_t uintptr_t",
          ),
        )
    : words("void boolean byte char short int long float double");
  const modifiers = cpp
    ? allModifiers.filter(
        (w) =>
          !words("abstract native synchronized transient strictfp sealed non-sealed").includes(w),
      )
    : words(
        "public protected private static final abstract native synchronized transient volatile strictfp sealed non-sealed",
      );
  const grammar: Grammar = {
    name: language,
    states: {
      main: {
        rules: [
          on([" ", "\t", "\n", "\r"]),
          match("//", "comment", enter("lineComment")),
          ...(!cpp ? [match("/**", "comment", enter("docComment"))] : []),
          match("/*", "comment", enter("blockComment")),
          ...(cpp ? [] : [match('"""', "string", enter("textBlock"))]),
          ...(cpp
            ? [
                match(['u8"', 'u"', 'U"', 'L"'], "string", enter("string")),
                match(["u8'", "u'", "U'", "L'"], "string", enter("character")),
              ]
            : []),
          match('"', "string", enter("string")),
          match("'", "string", enter("character")),
          keyword(
            ["true", "false", ...(cpp ? ["nullptr", "NULL"] : ["null"])],
            {},
            "constant.language",
          ),
          keyword(primitives, {}, "storage.type.primitive"),
          keyword(modifiers, {}, "storage.modifier"),
          keyword(cpp ? cppKeywords : javaKeywords),
          match(["0x", "0X"], cpp ? "keyword.other.unit" : "number", enter("hex")),
          match(["0b", "0B"], cpp ? "keyword.other.unit" : "number", enter("binary")),
          match(DIGIT, "number", enter("decimal")),
          match(
            Array.from({ length: 10 }, (_, n) => `.${n}`),
            "number",
            enter("fraction"),
          ),
          match(
            ["_", "$", LETTER, range([["\u0080", "\uffff"]])],
            "identifier",
            enter("identifier"),
          ),
          ...(cpp ? [match(["::", "->"], "punctuation")] : []),
          match(
            words(
              "<<= >>= >>>= ->* ... :: -> ++ -- && || <= >= == != += -= *= /= %= &= |= ^= << >> >>> + - * / % & | ^ ! ~ < > = ?",
            ),
            "operator",
          ),
          ...(cpp ? [match("\\", "constant.character.escape")] : []),
          match(
            [
              "(",
              ")",
              "[",
              "]",
              "{",
              "}",
              ",",
              ";",
              ":",
              ".",
              "@",
              "#",
              ...(cpp ? ["::", "->"] : []),
            ],
            "punctuation",
          ),
        ],
      },
      identifier: {
        rules: [
          match(["_", "$", ALNUM, range([["\u0080", "\uffff"]])], "identifier"),
          fallback(leave()),
        ],
      },
      lineComment: {
        rules: [
          ...(cpp ? [match(["\\\n", "\\\r\n"], "comment")] : []),
          on(["\n", "\r"], leave()),
          fallback({ token: "comment" }),
        ],
      },
      docComment: {
        rules: [
          match("*/", "comment", leave()),
          match("@param", "comment|keyword.other.documentation", enter("docParameter")),
          match(
            ["@throws", "@exception", "@see", "@link", "@linkplain"],
            "comment|keyword.other.documentation",
            enter("docLink"),
          ),
          match(
            [
              "@return",
              "@author",
              "@since",
              "@version",
              "@deprecated",
              "@serial",
              "@serialData",
              "@serialField",
              "@implSpec",
              "@implNote",
              "@apiNote",
            ],
            "comment|keyword.other.documentation",
          ),
          fallback({ token: "comment" }),
        ],
      },
      docParameter: {
        rules: [
          on([" ", "\t"]),
          match([LETTER, "_", "<"], "comment|variable.parameter", goto("docParameterBody")),
          fallback(leave()),
        ],
      },
      docParameterBody: {
        rules: [match([ALNUM, "_", ">"], "comment|variable.parameter"), fallback(leave())],
      },
      docLink: {
        rules: [
          on([" ", "\t"]),
          match("#", "comment", goto("docMember")),
          match([LETTER, "_"], "comment|entity.name.type", goto("docReference")),
          fallback(leave()),
        ],
      },
      docReference: {
        rules: [
          match([ALNUM, "_", ".", "$"], "comment|entity.name.type"),
          match("#", "comment", goto("docMember")),
          fallback(leave()),
        ],
      },
      docMember: {
        rules: [
          match("}", "comment", leave()),
          on([" ", "\t", "\n"], leave()),
          match([ALNUM, "_", "(", ")", ",", "[", "]"], "comment|variable.parameter"),
          fallback(leave()),
        ],
      },
      blockComment: { rules: [match("*/", "comment", leave()), fallback({ token: "comment" })] },
      string: {
        rules: [
          match("\\", "string_escape", enter("escape")),
          match('"', "string", leave()),
          on(["\n", "\r"], leave()),
          fallback({ token: "string" }),
        ],
      },
      character: {
        rules: [
          match("\\", "string_escape", enter("escape")),
          match("'", "string", leave()),
          on(["\n", "\r"], leave()),
          fallback({ token: "string" }),
        ],
      },
      textBlock: {
        rules: [
          match("\\", "string_escape", enter("escape")),
          match('"""', "string", leave()),
          fallback({ token: "string" }),
        ],
      },
      escape: {
        rules: [
          match("u", "string_escape", goto("unicode1")),
          ...(cpp ? [match("x", "string_escape", goto("hexEscape"))] : []),
          fallback({ token: "string_escape", exit: true }),
        ],
      },
      hexEscape: { rules: [match(HEX, "string_escape"), fallback(leave())] },
      decimal: {
        rules: [
          match([DIGIT, "_", ...(cpp ? ["'"] : [])], "number"),
          match(".", "number", goto("fraction")),
          match(["e", "E"], cpp ? "keyword.other.unit" : "number", goto("exponent")),
          match(
            words("u U l L f F d D z Z"),
            cpp ? "keyword.other.unit" : "number",
            goto("suffix"),
          ),
          fallback(leave()),
        ],
      },
      fraction: {
        rules: [
          match([DIGIT, "_", ...(cpp ? ["'"] : [])], "number"),
          match(["e", "E"], cpp ? "keyword.other.unit" : "number", goto("exponent")),
          match(words("f F d D l L"), "number", leave()),
          fallback(leave()),
        ],
      },
      exponent: {
        rules: [
          match(["+", "-"], cpp ? "keyword.other.unit" : "number", goto("exponentDigits")),
          match(DIGIT, "number", goto("exponentDigits")),
          fallback(leave()),
        ],
      },
      exponentDigits: {
        rules: [
          match([DIGIT, "_", ...(cpp ? ["'"] : [])], "number"),
          match(words("f F d D l L"), "number", leave()),
          fallback(leave()),
        ],
      },
      hex: {
        rules: [
          match([HEX, "_", ".", ...(cpp ? ["'"] : [])], "number"),
          match(["p", "P"], cpp ? "keyword.other.unit" : "number", goto("exponent")),
          match(words("u U l L"), cpp ? "keyword.other.unit" : "number", goto("suffix")),
          fallback(leave()),
        ],
      },
      binary: {
        rules: [
          match(["0", "1", "_", ...(cpp ? ["'"] : [])], "number"),
          match(words("u U l L"), cpp ? "keyword.other.unit" : "number", goto("suffix")),
          fallback(leave()),
        ],
      },
      suffix: {
        rules: [
          match(words("u U l L z Z"), cpp ? "keyword.other.unit" : "number"),
          fallback(leave()),
        ],
      },
      ...Object.fromEntries(
        [1, 2, 3, 4].map((n) => [
          `unicode${n}`,
          {
            rules: [
              match(HEX, "string_escape", n === 4 ? leave() : goto(`unicode${n + 1}`)),
              fallback(leave()),
            ],
          },
        ]),
      ),
    },
  };
  const compiled = compile(grammar);
  return (source: string): TokenizeResult => {
    // Raw C++ strings use a caller-defined delimiter. Split only at lexically
    // visible raw strings; comments and ordinary quoted strings are skipped.
    const chunks: { start: number; end: number; raw: boolean }[] = [];
    if (cpp && source.includes('R"')) {
      const visible =
        /\b(?:0[xX][\da-fA-F']+|\d[\d']*)(?:[uUlL]*)|\/\/(?:\\(?:\r\n|\r|\n)|[^\r\n])*(?:\r\n|\r|\n|$)|\/\*[\s\S]*?(?:\*\/|$)|(?:u8|u|U|L)?R"([^\s()\\]{0,16})\(|(?:u8|u|U|L)?"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'/g;
      let cursor = 0;
      for (let found; (found = visible.exec(source));) {
        if (found[1] === undefined) continue;
        const close = source.indexOf(`)${found[1]}"`, visible.lastIndex);
        const end = close < 0 ? source.length : close + found[1].length + 2;
        chunks.push(
          { start: cursor, end: found.index, raw: false },
          { start: found.index, end, raw: true },
        );
        cursor = end;
        visible.lastIndex = end;
      }
      chunks.push({ start: cursor, end: source.length, raw: false });
    }
    let result: TokenizeResult;
    if (chunks.some((c) => c.raw)) {
      const types: string[] = [];
      const spans: number[] = [];
      for (const chunk of chunks) {
        const part = chunk.raw
          ? { tokens: new Uint32Array([0, 0, chunk.end - chunk.start]), token_types: ["string"] }
          : scan(source.slice(chunk.start, chunk.end), compiled);
        const mapping = part.token_types.map((t) => {
          let id = types.indexOf(t);
          if (id < 0) {
            id = types.length;
            types.push(t);
          }
          return id;
        });
        for (let i = 0; i < part.tokens.length; i += 3)
          spans.push(
            mapping[part.tokens[i]],
            part.tokens[i + 1] + chunk.start,
            part.tokens[i + 2] + chunk.start,
          );
      }
      result = { tokens: Uint32Array.from(spans), token_types: types };
    } else result = scan(source, compiled);
    const types = [...result.token_types];
    const tokens = result.tokens;
    const kind = (i: number) => types[tokens[i]];
    const text = (i: number) => source.slice(tokens[i + 1], tokens[i + 2]);
    const set = (i: number, type: string) => {
      let id = types.indexOf(type);
      if (id < 0) {
        id = types.length;
        types.push(type);
      }
      tokens[i] = id;
    };
    const templateCall = (start: number) => {
      let depth = 0;
      for (let j = start; j < Math.min(tokens.length, start + 768); j += 3) {
        const value = text(j);
        if ([";", "{", "}", "&&", "||"].includes(value)) return false;
        if (value === "<") depth++;
        else if (/^>+$/.test(value)) {
          depth -= value.length;
          if (depth <= 0) return j + 3 < tokens.length && text(j + 3).startsWith("(");
        }
      }
      return false;
    };
    let declaration = "";
    let genericDepth = 0;
    let genericDeclaration = false;
    const declaredTypes = new Set<string>();
    let importLine = "";
    for (let i = 0; i < tokens.length; i += 3) {
      const type = kind(i),
        value = text(i),
        previous = i >= 3 ? text(i - 3) : "";
      const next = i + 3 < tokens.length ? text(i + 3) : "";
      if (
        value === "<" &&
        (previous === "template" ||
          (i >= 3 &&
            ["class_name", "storage.type.java", "type", "namespace"].includes(kind(i - 3))) ||
          (cpp &&
            i >= 3 &&
            kind(i - 3) === "identifier" &&
            !source.slice(tokens[i - 1], tokens[i + 1]).length &&
            /^[A-Za-z_:]/.test(next) &&
            templateCall(i)))
      ) {
        if (cpp && i >= 3 && kind(i - 3) === "identifier") set(i - 3, "function");
        genericDepth++;
        genericDeclaration = previous === "template" || (i >= 3 && kind(i - 3) === "class_name");
        set(i, "punctuation");
      } else if (genericDepth && /^>+$/.test(value)) {
        genericDepth = Math.max(0, genericDepth - value.length);
        set(i, "punctuation");
      }
      if (value === ";" || value === "{") importLine = "";
      if (!cpp && (value === "import" || value === "package")) importLine = value;
      if (type === "identifier") {
        if (importLine) set(i, `storage.modifier.${importLine}.java`);
        else if (declaration) {
          set(i, declaration);
          declaration = "";
        } else if (!importLine && previous === "@") set(i, "storage.type.annotation");
        else if (genericDepth && (genericDeclaration || !cpp)) {
          set(i, cpp ? "type" : "storage.type.generic");
          declaredTypes.add(value);
        } else if (
          cpp &&
          previous === "::" &&
          next !== "::" &&
          !next.startsWith("(") &&
          (next === "," || next.startsWith(")") || next === "|")
        )
          set(i, "plain");
        else if (
          cpp &&
          (declaredTypes.has(value) || (/^[A-Z][a-zA-Z0-9]*$/.test(value) && !next.startsWith("(")))
        )
          set(i, "type");
        else if (cpp && next === "::") set(i, "namespace");
        else if (
          cpp &&
          /^_/.test(value) &&
          i >= 3 &&
          kind(i - 3) === "string" &&
          tokens[i - 1] === tokens[i + 1]
        )
          set(i, "keyword.other.unit");
        else if (
          !cpp &&
          /^[A-Z]/.test(value) &&
          previous !== "." &&
          (/^[\w$]/.test(next) || next === "<" || next === "." || next.startsWith("["))
        )
          set(i, next.startsWith("[") ? "storage.type.object.array.java" : "storage.type.java");
        else if (!importLine && i + 3 < tokens.length && text(i + 3).startsWith("("))
          set(i, "function");
      }
      if (
        kind(i) === "function" &&
        next === "(" &&
        i >= 3 &&
        (kind(i - 3).startsWith("storage.") ||
          ["type", "identifier"].includes(kind(i - 3)) ||
          ["*", "&"].includes(previous))
      ) {
        // Bounded declaration scan: avoid treating arbitrary calls as parameter lists.
        let depth = 0;
        for (let j = i + 3; j < Math.min(tokens.length, i + 768); j += 3) {
          const v = text(j);
          if (kind(j) === "punctuation")
            for (const ch of v) {
              if (ch === "(") depth++;
              if (ch === ")") depth--;
            }
          if (depth === 0) break;
          if (depth !== 1 || kind(j) !== "identifier") continue;
          const n = j + 3 < tokens.length ? text(j + 3) : "";
          if (
            [",", ")", "=", "["].includes(n[0]) &&
            j >= 3 &&
            (kind(j - 3).startsWith("storage.") ||
              ["identifier", "type"].includes(kind(j - 3)) ||
              ["*", "&", ">", ">>"].includes(text(j - 3)))
          )
            set(j, "parameter");
        }
      }
      if (cpp && ["[[", "]]"].includes(value)) set(i, "constant.other.attribute");
      if (
        cpp &&
        [
          "likely",
          "unlikely",
          "nodiscard",
          "noreturn",
          "maybe_unused",
          "deprecated",
          "fallthrough",
          "no_unique_address",
        ].includes(value) &&
        previous === "[["
      )
        set(i, "function");
      if (
        ["class", "interface", "enum", "record", "struct", "union"].includes(value) &&
        type === "keyword"
      )
        declaration = "class_name";
      if (cpp && value === "namespace" && type === "keyword") declaration = "namespace";
      if (!cpp && value === "this") set(i, next.startsWith("(") ? "plain" : "variable.language");
      if (cpp && value === "#") {
        set(i, "directive");
        if (i + 3 < tokens.length && /^[a-z]+$/.test(text(i + 3))) {
          const directive = text(i + 3);
          set(i + 3, "directive");
          if (["ifdef", "ifndef"].includes(directive) && i + 6 < tokens.length)
            set(i + 6, "function");
          if (directive === "define" && i + 6 < tokens.length) {
            set(i + 6, "function");
            if (i + 9 < tokens.length && text(i + 9) === "(" && tokens[i + 8] === tokens[i + 10]) {
              for (let j = i + 12; j < tokens.length; j += 3) {
                if (
                  text(j).includes(")") ||
                  source.slice(tokens[j - 2], tokens[j + 1]).includes("\n")
                )
                  break;
                if (kind(j) === "identifier") set(j, "parameter");
              }
            }
          }
          if (directive === "include") {
            for (let j = i + 6; j < tokens.length; j += 3) {
              if (source.slice(tokens[j - 2], tokens[j + 1]).includes("\n")) break;
              set(j, "string");
              if (text(j).includes(">") || (kind(j) === "string" && text(j).endsWith('"'))) break;
            }
          }
        }
      }
      if (!cpp && importLine && value === ".") set(i, `storage.modifier.${importLine}.java`);
      if (cpp && value === ":" && ["public", "private", "protected"].includes(previous))
        set(i, "storage.modifier");
    }
    return { tokens, token_types: types };
  };
}
