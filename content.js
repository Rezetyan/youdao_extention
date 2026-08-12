(() => {
  const INSTALLATION_FLAG = "__YOUDAO_KEYBOARD_SHORTCUTS_INSTALLED__";

  if (window[INSTALLATION_FLAG]) {
    return;
  }

  window[INSTALLATION_FLAG] = true;

  const SELECTORS = Object.freeze({
    favorite: ".word-book_operate .word-operate",
    pronunciation: ".phonetic-speech .pronounce",
    searchInput: "#search_input",
  });
  const RESULT_FOCUS_DELAY_MS = 100;
  let resultFocusTimer = null;

  function isYoudaoResultPage() {
    return (
      window.location.hostname === "www.youdao.com" &&
      /^\/result\/?$/.test(window.location.pathname)
    );
  }

  function isEditableTarget(target) {
    if (!(target instanceof Element)) {
      return false;
    }

    if (target.closest("input, textarea, select")) {
      return true;
    }

    const editingHost = target.closest("[contenteditable]");
    return (
      editingHost !== null &&
      editingHost.getAttribute("contenteditable")?.toLowerCase() !== "false"
    );
  }

  function clickControl(selector, index = 0) {
    const control = document.querySelectorAll(selector)[index];

    if (!control) {
      return false;
    }

    // Youdao's anchors use javascript:; preserve their Vue click handlers
    // while cancelling the anchor's inline-script default action.
    const cancelDefault = (event) => event.preventDefault();

    control.addEventListener("click", cancelDefault, true);
    try {
      control.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          view: window,
        }),
      );
    } finally {
      control.removeEventListener("click", cancelDefault, true);
    }

    return true;
  }

  function setSearchValue(input, value) {
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;

    if (valueSetter) {
      valueSetter.call(input, value);
    } else {
      input.value = value;
    }

    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function replaceSearchValue(value) {
    const input = document.querySelector(SELECTORS.searchInput);

    if (!(input instanceof HTMLInputElement)) {
      return false;
    }

    if (resultFocusTimer !== null) {
      window.clearTimeout(resultFocusTimer);
      resultFocusTimer = null;
    }

    input.focus();
    input.select();
    setSearchValue(input, value);
    return true;
  }

  function focusResultPage() {
    const activeElement = document.activeElement;

    if (activeElement instanceof HTMLElement && activeElement !== document.body) {
      activeElement.blur();
    }

    document.body?.focus({ preventScroll: true });
  }

  function scheduleResultFocus() {
    if (resultFocusTimer !== null) {
      window.clearTimeout(resultFocusTimer);
    }

    resultFocusTimer = window.setTimeout(() => {
      resultFocusTimer = null;

      if (!isYoudaoResultPage()) {
        return;
      }

      focusResultPage();
    }, RESULT_FOCUS_DELAY_MS);
  }

  function clearSearchInput() {
    const input = document.querySelector(SELECTORS.searchInput);

    if (input instanceof HTMLInputElement) {
      setSearchValue(input, "");
    }

    scheduleResultFocus();
  }

  function isSearchInputTarget(target) {
    return target instanceof Element && target.closest(SELECTORS.searchInput);
  }

  function consume(event) {
    event.preventDefault();
    event.stopPropagation();
  }

  function handleKeydown(event) {
    if (event.isComposing) {
      return;
    }

    if (
      !event.defaultPrevented &&
      event.key === "Enter" &&
      isSearchInputTarget(event.target) &&
      !event.shiftKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey
    ) {
      scheduleResultFocus();
      return;
    }

    if (!isYoudaoResultPage()) {
      return;
    }

    if (
      event.key === "Escape" &&
      !event.shiftKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey
    ) {
      clearSearchInput();
      event.preventDefault();
      return;
    }

    if (event.defaultPrevented) {
      return;
    }

    if (resultFocusTimer !== null) {
      window.clearTimeout(resultFocusTimer);
      resultFocusTimer = null;
    }

    if (isEditableTarget(event.target)) {
      return;
    }

    const shortcut =
      event.code === "Digit1" ||
      event.code === "Digit2" ||
      event.code === "Digit3";

    if (
      shortcut &&
      !event.shiftKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey
    ) {
      const action = {
        Digit1: () => clickControl(SELECTORS.favorite),
        Digit2: () => clickControl(SELECTORS.pronunciation, 0),
        Digit3: () => clickControl(SELECTORS.pronunciation, 1),
      }[event.code];

      if (action()) {
        consume(event);
      }

      return;
    }

    if (
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey &&
      /^[a-zA-Z]$/.test(event.key)
    ) {
      if (replaceSearchValue(event.key)) {
        consume(event);
      }
    }
  }

  window.addEventListener("keydown", handleKeydown, true);

  if (isYoudaoResultPage()) {
    scheduleResultFocus();
  }
})();
