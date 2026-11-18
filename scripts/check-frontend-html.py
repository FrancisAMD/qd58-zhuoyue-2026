from html.parser import HTMLParser
from pathlib import Path

class FormStructureChecker(HTMLParser):
    def __init__(self):
        super().__init__()
        self.depth = 0
        self.ids = set()
        self.errors = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() != "form":
            return
        attrs = dict(attrs)
        form_id = attrs.get("id")
        if self.depth:
            self.errors.append(f"Nested <form> found: {form_id or '(missing id)'}")
        self.depth += 1
        if form_id:
            self.ids.add(form_id)

    def handle_endtag(self, tag):
        if tag.lower() == "form":
            if self.depth == 0:
                self.errors.append("Unmatched </form> found")
            else:
                self.depth -= 1

html_path = Path(__file__).resolve().parents[1] / "index.html"
parser = FormStructureChecker()
parser.feed(html_path.read_text(encoding="utf-8"))
parser.close()

if parser.depth:
    parser.errors.append(f"{parser.depth} unclosed <form> element(s)")
required = {"profile", "loginForm", "registerForm", "resetForm", "changePasswordForm", "deleteAccountForm"}
missing = sorted(required - parser.ids)
if missing:
    parser.errors.append("Missing form id(s): " + ", ".join(missing))
if parser.errors:
    raise SystemExit("\n".join(parser.errors))
print("Frontend HTML form structure smoke test passed.")
