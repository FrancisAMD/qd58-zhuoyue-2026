/* Follow the browser/OS color-scheme preference without a manual override. */
(() => {
  const root = document.documentElement;
  const preference = window.matchMedia("(prefers-color-scheme: dark)");

  const updateThemeImages = () => {
    const theme = root.dataset.theme === "dark" ? "dark" : "light";
    document.querySelectorAll("img[data-light-src][data-dark-src]").forEach(image => {
      const target = image.dataset[theme + "Src"];
      if (!target || image.dataset.activeThemeSrc === target) return;

      image.dataset.activeThemeSrc = target;
      if (image.id === "donationQrImage") {
        image.onload = () => {
          if (image.dataset.activeThemeSrc !== target) return;
          image.hidden = false;
          const pending = document.getElementById("donationQrPending");
          if (pending) pending.hidden = true;
        };
        image.onerror = () => {
          if (image.dataset.activeThemeSrc !== target) return;
          image.hidden = true;
          const pending = document.getElementById("donationQrPending");
          if (pending) {
            pending.hidden = false;
            const amount = image.dataset.selectedAmount || "当前";
            const title = document.getElementById("donationQrPendingTitle");
            const message = document.getElementById("donationQrPendingText");
            if (title) title.textContent = "￥" + amount + " 二维码尚未就绪";
            if (message) message.textContent = amount === "10"
              ? "10 元二维码图片尚未上传；上传后点击 ￥10 即可显示。"
              : "二维码图片暂时无法加载，请检查资源路径后重试。";
          }
        };
      } else {
        image.onerror = () => {
          image.onerror = null;
          if (image.dataset.activeThemeSrc !== target) return;
          const fallback = image.dataset.fallbackSrc || image.dataset.lightSrc;
          if (fallback && image.src !== new URL(fallback, document.baseURI).href) {
            image.src = fallback;
          }
        };
      }
      image.src = target;
      if (image.id === "donationQrImage" && image.complete && image.naturalWidth > 0) {
        image.hidden = false;
        const pending = document.getElementById("donationQrPending");
        if (pending) pending.hidden = true;
      }
    });
  };

  const applyPreference = () => {
    const theme = preference.matches ? "dark" : "light";
    root.dataset.theme = theme;
    root.style.colorScheme = theme;

    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) {
      themeColor.content = theme === "dark" ? "#151f19" : "#f3f6f2";
    }

    updateThemeImages();
  };

  applyPreference();

  // theme.js is loaded in <head>, before the themed images exist in the DOM.
  document.addEventListener("DOMContentLoaded", updateThemeImages, { once: true });

  // Keep the QR image in sync if another script changes the theme attribute.
  if (typeof MutationObserver === "function") {
    const themeObserver = new MutationObserver(updateThemeImages);
    themeObserver.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
  }

  if (typeof preference.addEventListener === "function") {
    preference.addEventListener("change", applyPreference);
  } else if (typeof preference.addListener === "function") {
    preference.addListener(applyPreference);
  }
})();
