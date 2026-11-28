/* Shared, gentle scroll-reveal motion for the site's visual cards. */
(() => {
  const CARD_SELECTOR = [
    ".panel",
    ".profile-stage-panel",
    ".university-type-card",
    ".university-result",
    ".selected-university-panel",
    ".register-phone-status",
    ".classmate-card",
    ".donation-list-row",
    ".account-delete-row",
    ".directory-school",
    ".directory-panel",
    ".directory-team-summary",
    ".group-chat-panel",
    ".group-chat-status",
    ".admin-overview-panel",
    ".admin-view-panel",
    ".admin-panel-status",
    ".admin-sidebar-role-card",
    ".stat",
    ".admin-team-card",
    ".admin-person-card",
    ".admin-review-card",
    ".backup-card",
    ".group-qr-upload-card",
    ".group-qr-asset-card",
    ".donation-admin-row",
    ".privacy"
  ].join(",");

  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  const shouldReduce = () => !!reducedMotion?.matches;
  let observer = null;

  function markVisible(element) {
    element.classList.add("card-reveal-visible");
    element.classList.remove("card-reveal-pending");
  }

  function revealWhenReady(element) {
    if (!(element instanceof Element) || element.dataset.cardMotionReady === "true") return;
    element.dataset.cardMotionReady = "true";

    if (shouldReduce() || !observer) {
      markVisible(element);
      return;
    }

    const siblings = [...(element.parentElement?.children || [])]
      .filter(sibling => sibling.matches(CARD_SELECTOR));
    const index = Math.max(0, siblings.indexOf(element));
    element.style.setProperty("--card-reveal-delay", `${Math.min(index, 3) * 85}ms`);
    element.classList.add("card-reveal-item", "card-reveal-pending");
    observer.observe(element);
  }

  function scan(root) {
    if (!root) return;
    if (root instanceof Element && root.matches(CARD_SELECTOR)) revealWhenReady(root);
    root.querySelectorAll?.(CARD_SELECTOR).forEach(revealWhenReady);
  }

  if (!shouldReduce() && "IntersectionObserver" in window) {
    observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        markVisible(entry.target);
        observer.unobserve(entry.target);
      });
    }, {
      threshold: 0.12,
      rootMargin: "0px 0px -5% 0px"
    });
  }

  // The script is deferred, so the parsed page can be scanned immediately.
  scan(document);

  // Cards are also created after API responses, filters, and admin navigation.
  const mutations = new MutationObserver(records => {
    records.forEach(record => {
      record.addedNodes.forEach(node => {
        if (node.nodeType === Node.ELEMENT_NODE) scan(node);
      });
    });
  });
  if (document.documentElement) {
    mutations.observe(document.documentElement, { childList: true, subtree: true });
  }

  // If the OS preference changes to reduced motion mid-session, reveal
  // any pending cards immediately rather than leaving them transparent.
  reducedMotion?.addEventListener?.("change", event => {
    if (!event.matches) return;
    document.querySelectorAll(".card-reveal-pending").forEach(markVisible);
    observer?.disconnect();
    observer = null;
  });
})();
