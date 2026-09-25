#include <vector>
#define LIMIT 42

// Comments must keep 😀 café 中文 and whitespace intact.
namespace demo {
class Example {
public:
    int count = 42;
    bool ready = true;
    const char* name() {
        /* comment across
           an empty line

           and a closing marker */
        return "Hello\nworld";
    }
};
}
