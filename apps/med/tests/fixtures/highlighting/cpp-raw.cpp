const auto count = 1'000;
const auto text = R"tag(a "quote" and )other" and // text
/* still text */ )tag";
// R"ignored(no raw string here
const char* next = "normal";
