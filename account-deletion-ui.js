(() => {
  const byId = id => document.getElementById(id);
  const form = byId("deleteAccountForm");
  const modal = byId("modal");
  const status = byId("deletePreflightMsg");
  const challenge = byId("deleteCaptcha");
  const challengeHint = byId("deleteCaptchaHint");
  const cancel = byId("cancelDeleteAccount");
  let checking = false;

  if (!form || !modal || !status || !challenge) return;

  function showDeleteDialog() {
    document.querySelectorAll("#modal .auth-form").forEach(item => {
      item.hidden = item !== form;
    });
    byId("authTabs").hidden = true;
    modal.classList.add("show");
    modal.setAttribute("aria-hidden", "false");
    form.reset();
  }

  function setLocked(locked) {
    form.querySelectorAll("input, button").forEach(control => {
      if (control !== cancel) control.disabled = locked;
    });
    cancel.disabled = false;
    challenge.classList.toggle("challenge-disabled", locked);
    form.dataset.preflight = locked ? "blocked" : "allowed";
  }

  function setStatus(message, bad = false) {
    status.textContent = message;
    status.classList.toggle("bad", bad);
  }

  async function checkEligibility() {
    if (typeof window.call !== "function") throw new Error("客户端尚未完成初始化");
    return window.call("/account/delete/preflight");
  }

  function blockWithMessage(message) {
    setLocked(true);
    if (challengeHint) {
      challengeHint.hidden = false;
      challengeHint.textContent = "Cloudflare Challenge 暂不可用；短信验证码和密码输入已锁定。";
    }
    setStatus(message, true);
  }

  async function openDeleteAccount(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (checking) return;
    checking = true;
    showDeleteDialog();
    setLocked(true);
    if (challengeHint) {
      challengeHint.hidden = false;
      challengeHint.textContent = "正在确认团队组长状态，确认通过后才会启用人机验证。";
    }
    setStatus("正在检查你是否仍担任有其他成员的小组组长……");

    try {
      const result = await checkEligibility();
      if (result.canDelete !== true) {
        blockWithMessage("暂不能删除账号：你目前仍是有其他成员的小组组长。请先将组长身份转让给其他队员，待对方接受后再回来操作。为避免消耗短信额度，本页的人机验证、获取验证码和密码输入均已禁用。");
        return;
      }
      setLocked(false);
      if (challengeHint) challengeHint.hidden = true;
      setStatus("检查通过：当前账号不是有其他成员的小组组长。请继续完成身份验证和二次确认。");
      if (typeof window.auth === "function") window.auth("deleteAccount");
    } catch (error) {
      blockWithMessage("暂时无法核实团队组长状态（" + (error.message || "网络错误") + "）。为避免误发验证码，删除流程已暂时锁定，请检查网络后重新打开。");
    } finally {
      checking = false;
    }
  }

  const openButton = byId("deleteAccountOpen");
  if (openButton) openButton.addEventListener("click", openDeleteAccount, true);

  // Recheck eligibility immediately before every SMS request. The Worker repeats
  // the check independently, so this is also protected against stale UI state.
  const sendButton = byId("deleteSend");
  if (sendButton) sendButton.addEventListener("click", async event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (checking || sendButton.disabled) return;
    checking = true;
    try {
      const result = await checkEligibility();
      if (result.canDelete !== true) {
        blockWithMessage("账号暂不能删除：你仍是有其他成员的小组组长。请先转让组长身份；当前验证码和密码输入已禁用。");
        return;
      }
      setLocked(false);
      if (typeof window.sendCode === "function") await window.sendCode("deleteAccount");
    } catch (error) {
      blockWithMessage("无法重新核实组长状态，出于安全考虑没有发送验证码。请稍后重新打开删除界面。");
    } finally {
      checking = false;
    }
  }, true);
})();
