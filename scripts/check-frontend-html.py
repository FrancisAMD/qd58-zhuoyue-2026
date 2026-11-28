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
html_text = html_path.read_text(encoding="utf-8")
style_text = (html_path.parent / "style.css").read_text(encoding="utf-8")
for marker in [
    'class="art-logo"',
    'data-light-src="assets/58-logo-light.png"',
    'data-dark-src="assets/58-logo-dark.png"',
    '2026 · 冬日返校计划',
    'class="home-faq-answer"',

    'data-journey-step="university"',
    'data-journey-step="profile"',
    'data-journey-step="directory"',
    'id="registrationUniversityPanel"',
    'id="registrationDetailsPanel"',
    'id="clearSelectedUniversity"',
    'id="continueToDetails"',
    'id="backToUniversityStep"',
    'id="accountBottom"',
    'id="deleteAccountOpen"',
]:
    if marker not in html_text:
        parser.errors.append("Missing three-step UI marker: " + marker)
if "<header" in html_text:
    parser.errors.append("The old global header must remain removed from the member UI.")
if html_text.find('id="accountBottom"') < html_text.find('id="groups"'):
    parser.errors.append("Account actions and account deletion must be placed after the directory page.")
if ".home-faq-answer{" not in style_text or "background:var(--paper)" not in style_text:
    parser.errors.append("Homepage FAQ answers must use the paper card surface.")
if ".art-logo{" not in style_text or ".dialog .mark.auth-brand{" not in style_text:
    parser.errors.append("Homepage logo and login brand styles are missing.")
if parser.errors:
    raise SystemExit("\\n".join(parser.errors))
print("Frontend HTML form structure smoke test passed.")
