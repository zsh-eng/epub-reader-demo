#include "local.hpp"
#define PLUS(x) \
    ((x) + 1)
template<typename T>
struct Box {
    T value;
    auto get() const { return value; }
};
const auto raw = R"tag(hello "quoted" // not a comment
and /* still a string */ )tag";
constexpr unsigned long mask = 0xff'00ULL;
double scale = .5e+2;
