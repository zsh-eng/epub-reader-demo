"""Bounded, plain-text RSS context for classification; never infer missing metadata."""

from html.parser import HTMLParser


class DescriptionText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag in {"p", "br", "li", "div"}:
            self.parts.append(" ")

    def handle_endtag(self, tag):
        if tag in {"p", "li", "div"}:
            self.parts.append(" ")

    def handle_data(self, data):
        self.parts.append(data)


def plain_text(value, limit):
    parser = DescriptionText()
    parser.feed(value or "")
    return " ".join("".join(parser.parts).split())[:limit]


def classification_metadata(source):
    return {
        "show": {
            "title": source["show"],
            "description": plain_text(source.get("showDescription", ""), 6000),
        },
        "episode": {
            "title": source["title"],
            "description": plain_text(source.get("description", ""), 12000),
        },
    }
