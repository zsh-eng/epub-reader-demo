public record Pair<T>(T first, T second) {
    static final long SIZE = 0xCAFE_BABEL;
    double scale = .5e+2;
    char newline = '\n';
    String text = """
        Hello "quoted" 😀
        // not a comment
        """;
    public boolean same() { return first == second; }
}
