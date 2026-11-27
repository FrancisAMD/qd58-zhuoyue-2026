/* Follow the browser/OS color-scheme preference without a manual override. */
(() => {
  const root = document.documentElement;
  const preference = window.matchMedia("(prefers-color-scheme: dark)");

  const applyPreference = () => {
    const theme = preference.matches ? "dark" : "light";
    root.dataset.theme = theme;
    root.style.colorScheme = theme;

    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) {
      themeColor.content = theme === "dark" ? "#151f19" : "#f3f6f2";
    }
  };

  applyPreference();

  if (typeof preference.addEventListener === "function") {
    preference.addEventListener("change", applyPreference);
  } else if (typeof preference.addListener === "function") {
    preference.addListener(applyPreference);
  }
})();
