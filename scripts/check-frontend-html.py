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

typography_text = (html_path.parent / "typography.css").read_text(encoding="utf-8")
admin_text = (html_path.parent / "admin.html").read_text(encoding="utf-8")
privacy_text = (html_path.parent / "privacy.html").read_text(encoding="utf-8")
font_dir = html_path.parent / "assets" / "fonts"
font_files = {
    "LXGW WenKai Lite": font_dir / "lxgw-wenkai-lite-regular.woff2",
    "Source Han Sans CN": font_dir / "source-han-sans-cn-variable.woff2",
}
for font_name, font_path in font_files.items():
    if not font_path.is_file():
        parser.errors.append(f"Missing locally hosted {font_name} font: {font_path}")
    elif font_path.read_bytes()[:4] != b"wOF2":
        parser.errors.append(f"Invalid WOFF2 signature for {font_name}: {font_path}")
for page_name, page_text in (("index.html", html_text), ("admin.html", admin_text), ("privacy.html", privacy_text)):
    if 'typography.css?v=20261128-local-fonts-v1' not in page_text:
        parser.errors.append(f"{page_name} must load the current local-font typography stylesheet.")
    if page_name == "index.html" and 'app.js?v=20261128-boot-assets-before-session-v1' not in page_text:
        parser.errors.append("index.html must load the resource-gated startup script.")

    if 'style.css?v=20261128-boot-assets-before-session-v1' not in page_text:
        parser.errors.append(f"{page_name} must load the current local-font base stylesheet.")
if 'id="bootScreen" class="boot-screen" role="status" aria-live="polite" hidden' not in html_text:
    parser.errors.append("The welcome splash must remain hidden until local fonts and logos are preloaded.")
if "fonts.googleapis.com" in style_text or "fonts.googleapis.com" in typography_text:
    parser.errors.append("Google Fonts must not be requested; all Chinese fonts must be self-hosted.")
if 'lxgw-wenkai-lite-regular.woff2' not in typography_text:
    parser.errors.append("LXGW WenKai Lite must be declared as a local web font.")
if 'source-han-sans-cn-variable.woff2' not in typography_text:
    parser.errors.append("Source Han Sans CN must be declared as a local web font.")

checkbox_count = html_text.count('type="checkbox"')
if checkbox_count != 2 or 'id="consent" required' not in html_text or 'id="accountConsent" required' not in html_text:
    parser.errors.append("The profile and registration privacy consent checkboxes must remain present and required.")
if '.check>input[type="checkbox"]{' not in style_text or 'appearance:none;' not in style_text or 'width:24px!important;' not in style_text or '.check>input[type="checkbox"]:checked{' not in style_text:
    parser.errors.append("The larger theme-aware custom consent checkbox style is missing.")


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
faq_card_rules = [part.split("}", 1)[0] for part in style_text.split(".home-faq-card{")[1:]]
if not any("background:transparent" in rule and "border:0" in rule and "box-shadow:none" in rule for rule in faq_card_rules):
    parser.errors.append("Homepage FAQ entries must sit directly on the shared module surface, without nested cards.")
if ".art-logo{" not in style_text or ".dialog .auth-brand{" not in style_text:
    parser.errors.append("Homepage logo and login brand styles are missing.")
if parser.errors:
    raise SystemExit("\\n".join(parser.errors))
print("Frontend HTML form structure smoke test passed.")
