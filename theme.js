/* Follow the browser/OS color-scheme preference without a manual override. */
(() => {
  const root = document.documentElement;
  const preference = window.matchMedia("(prefers-color-scheme: dark)");

  const updateDonationQr = () => {
    const image = document.getElementById("donationQrImage");
    if (!image) return;

    const theme = root.dataset.theme === "dark" ? "dark" : "light";
    const target = image.dataset[theme + "Src"];
    if (!target || image.dataset.activeThemeSrc === target) return;

    image.dataset.activeThemeSrc = target;
    image.onerror = () => {
      image.onerror = null;
      if (image.dataset.activeThemeSrc !== target) return;
      // Keep the currently deployed page usable until both theme-specific QR
      // files have been added to the public assets directory.
      image.src = "assets/donation-qr-15.png";
    };
    image.src = target;
  };

  const applyPreference = () => {
    const theme = preference.matches ? "dark" : "light";
    root.dataset.theme = theme;
    root.style.colorScheme = theme;

    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) {
      themeColor.content = theme === "dark" ? "#151f19" : "#f3f6f2";
    }

    updateDonationQr();
  };

  applyPreference();

  // theme.js is loaded in <head>, before the donation image exists in the DOM.
  document.addEventListener("DOMContentLoaded", updateDonationQr, { once: true });

  // Keep the QR image in sync if another script changes the theme attribute.
  if (typeof MutationObserver === "function") {
    const themeObserver = new MutationObserver(updateDonationQr);
    themeObserver.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
  }

  if (typeof preference.addEventListener === "function") {
    preference.addEventListener("change", applyPreference);
  } else if (typeof preference.addListener === "function") {
    preference.addListener(applyPreference);
  }
})();
