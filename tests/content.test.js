const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");
const contentScript = fs.readFileSync(
  path.join(projectRoot, "content.js"),
  "utf8",
);

function createHarness(initialUrl, { controls = {} } = {}) {
  const locationUrl = new URL(initialUrl);
  const navigationEntry = { name: locationUrl.href, type: "navigate" };
  const listeners = new Map();
  const timers = new Map();
  let nextTimerId = 1;
  let document;

  class FakeEvent {
    constructor(type, options = {}) {
      this.type = type;
      this.bubbles = Boolean(options.bubbles);
      this.cancelable = Boolean(options.cancelable);
      this.defaultPrevented = false;
      this.propagationStopped = false;
    }

    preventDefault() {
      this.defaultPrevented = true;
    }

    stopPropagation() {
      this.propagationStopped = true;
    }
  }

  class FakeMouseEvent extends FakeEvent {}

  class FakeElement {
    constructor(tagName, { id = "", parent = null } = {}) {
      this.tagName = tagName.toUpperCase();
      this.id = id;
      this.parentElement = parent;
      this.attributes = new Map();
      this.dispatchedEvents = [];
      this.listeners = new Map();
    }

    addEventListener(type, listener) {
      const typeListeners = this.listeners.get(type) ?? [];
      typeListeners.push(listener);
      this.listeners.set(type, typeListeners);
    }

    removeEventListener(type, listener) {
      const typeListeners = this.listeners.get(type) ?? [];
      this.listeners.set(
        type,
        typeListeners.filter((candidate) => candidate !== listener),
      );
    }

    dispatchEvent(event) {
      this.dispatchedEvents.push(event);
      for (const listener of this.listeners.get(event.type) ?? []) {
        listener(event);
      }
      return !event.defaultPrevented;
    }

    getAttribute(name) {
      return this.attributes.get(name) ?? null;
    }

    closest(selector) {
      let candidate = this;

      while (candidate) {
        if (
          selector === "input, textarea, select" &&
          ["INPUT", "TEXTAREA", "SELECT"].includes(candidate.tagName)
        ) {
          return candidate;
        }

        if (selector === "[contenteditable]" && candidate.attributes.has("contenteditable")) {
          return candidate;
        }

        if (selector === "#search_input" && candidate.id === "search_input") {
          return candidate;
        }

        candidate = candidate.parentElement;
      }

      return null;
    }
  }

  class FakeHTMLElement extends FakeElement {
    blur() {
      if (document.activeElement === this) {
        document.activeElement = document.body;
      }
    }

    focus() {
      document.activeElement = this;
    }
  }

  class FakeAnchorElement extends FakeHTMLElement {
    constructor() {
      super("a");
      this.defaultActionCount = 0;
    }

    dispatchEvent(event) {
      const notCanceled = super.dispatchEvent(event);

      if (notCanceled) {
        this.defaultActionCount += 1;
      }

      return notCanceled;
    }
  }

  class FakeHTMLInputElement extends FakeHTMLElement {
    constructor(value = "") {
      super("input", { id: "search_input" });
      this._value = value;
      this.selectCount = 0;
    }

    get value() {
      return this._value;
    }

    set value(value) {
      this._value = value;
    }

    select() {
      this.selectCount += 1;
    }
  }

  const body = new FakeHTMLElement("body");
  let searchInput = new FakeHTMLInputElement("");
  const favoriteControls = Array.from(
    { length: controls.favorite ?? 0 },
    () => new FakeAnchorElement(),
  );
  const pronunciationControls = Array.from(
    { length: controls.pronunciation ?? 0 },
    () => new FakeAnchorElement(),
  );

  document = {
    activeElement: body,
    body,
    querySelector(selector) {
      return selector === "#search_input" ? searchInput : null;
    },
    querySelectorAll(selector) {
      if (selector === ".word-book_operate .word-operate") {
        return favoriteControls;
      }

      if (selector === ".phonetic-speech .pronounce") {
        return pronunciationControls;
      }

      return [];
    },
  };

  const location = {
    hostname: locationUrl.hostname,
    href: locationUrl.href,
    pathname: locationUrl.pathname,
  };

  const window = {
    location,
    addEventListener(type, listener, capture) {
      const typeListeners = listeners.get(type) ?? [];
      typeListeners.push({ capture, listener });
      listeners.set(type, typeListeners);
    },
    clearTimeout(timerId) {
      timers.delete(timerId);
    },
    setTimeout(callback) {
      const timerId = nextTimerId;
      nextTimerId += 1;
      timers.set(timerId, callback);
      return timerId;
    },
  };

  window.history = {
    pushState(_state, _title, url) {
      const nextUrl = new URL(url, location.href);
      location.hostname = nextUrl.hostname;
      location.href = nextUrl.href;
      location.pathname = nextUrl.pathname;
    },
  };

  const context = vm.createContext({
    Element: FakeElement,
    Event: FakeEvent,
    HTMLElement: FakeHTMLElement,
    HTMLInputElement: FakeHTMLInputElement,
    MouseEvent: FakeMouseEvent,
    document,
    performance: {
      getEntriesByType(type) {
        return type === "navigation" ? [navigationEntry] : [];
      },
    },
    window,
  });

  function dispatchKey(key, code, target = body) {
    const event = new FakeEvent("keydown", { cancelable: true });
    Object.assign(event, {
      altKey: false,
      code,
      ctrlKey: false,
      isComposing: false,
      key,
      metaKey: false,
      shiftKey: false,
      target,
    });

    for (const { listener } of listeners.get("keydown") ?? []) {
      listener(event);
    }

    return event;
  }

  function appendNativeText(input, text) {
    input.value += text;
    input.dispatchEvent(new FakeEvent("input", { bubbles: true }));
  }

  return {
    body,
    controls: {
      favorite: favoriteControls,
      pronunciation: pronunciationControls,
    },
    dispatchKey,
    document,
    getSearchInput: () => searchInput,
    appendNativeText,
    listenerCount: (type) => listeners.get(type)?.length ?? 0,
    pendingTimerCount: () => timers.size,
    performance: context.performance,
    pushState: (url) => window.history.pushState({}, "", url),
    runContentScript: () => vm.runInContext(contentScript, context),
    runTimers() {
      const callbacks = [...timers.values()];
      timers.clear();
      callbacks.forEach((callback) => callback());
    },
    setActiveElement: (element) => {
      document.activeElement = element;
    },
    setSearchInput(value) {
      searchInput = new FakeHTMLInputElement(value);
      return searchInput;
    },
    window,
  };
}

test("manifest bootstraps the exact homepage document and result loads", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(projectRoot, "manifest.json"), "utf8"),
  );
  const [contentScriptEntry] = manifest.content_scripts;

  assert.deepEqual(contentScriptEntry.matches, [
    "https://www.youdao.com/",
    "https://www.youdao.com/result*",
  ]);
});

test("homepage injection stays dormant until a same-document result route", () => {
  const harness = createHarness("https://www.youdao.com/");
  const homepageInput = harness.setSearchInput("hello");
  harness.setActiveElement(homepageInput);
  const originalDocument = harness.document;

  harness.runContentScript();

  assert.equal(harness.listenerCount("keydown"), 1);
  assert.equal(harness.pendingTimerCount(), 0);
  assert.equal(harness.document.activeElement, homepageInput);

  harness.setActiveElement(harness.body);
  const homepageKey = harness.dispatchKey("z", "KeyZ", harness.body);
  assert.equal(homepageInput.value, "hello");
  assert.equal(homepageKey.defaultPrevented, false);

  const homepageEscape = harness.dispatchKey(
    "Escape",
    "Escape",
    homepageInput,
  );
  assert.equal(homepageEscape.defaultPrevented, false);
  assert.equal(homepageInput.value, "hello");

  const homepageDigit = harness.dispatchKey("1", "Digit1", harness.body);
  assert.equal(homepageDigit.defaultPrevented, false);

  harness.setActiveElement(homepageInput);
  const homepageEnter = harness.dispatchKey("Enter", "Enter", homepageInput);
  assert.equal(homepageEnter.defaultPrevented, false);
  assert.equal(harness.pendingTimerCount(), 1);

  harness.pushState("/result?word=hello&lang=en");
  const resultInput = harness.setSearchInput("hello");
  harness.setActiveElement(resultInput);

  assert.equal(harness.document, originalDocument);
  assert.equal(harness.window.location.pathname, "/result");
  assert.equal(
    harness.performance.getEntriesByType("navigation")[0].name,
    "https://www.youdao.com/",
  );

  harness.runTimers();
  assert.equal(harness.document.activeElement, harness.body);

  const resultKey = harness.dispatchKey("z", "KeyZ", harness.body);
  assert.equal(resultInput.value, "z");
  assert.equal(harness.document.activeElement, resultInput);
  assert.equal(resultKey.defaultPrevented, true);
  assert.equal(resultKey.propagationStopped, true);
  assert.equal(
    resultInput.dispatchedEvents.filter((event) => event.type === "input").length,
    1,
  );

  const replacementInput = harness.setSearchInput("next");
  harness.setActiveElement(harness.body);
  harness.dispatchKey("Q", "KeyQ", harness.body);

  assert.equal(resultInput.value, "z");
  assert.equal(replacementInput.value, "Q");
});

test("a result Enter timer does not steal focus from continued typing", () => {
  const harness = createHarness(
    "https://www.youdao.com/result?word=hello&lang=en",
  );
  const resultInput = harness.setSearchInput("hello");

  harness.runContentScript();
  harness.runTimers();

  harness.setActiveElement(resultInput);
  harness.dispatchKey("Enter", "Enter", resultInput);
  assert.equal(harness.pendingTimerCount(), 1);

  harness.dispatchKey("x", "KeyX", resultInput);
  harness.appendNativeText(resultInput, "x");

  assert.equal(harness.pendingTimerCount(), 0);
  harness.runTimers();
  assert.equal(harness.document.activeElement, resultInput);
});

test("a scheduled focus restore is a no-op after leaving the result route", () => {
  const harness = createHarness(
    "https://www.youdao.com/result?word=hello&lang=en",
  );
  const resultInput = harness.setSearchInput("hello");

  harness.runContentScript();
  assert.equal(harness.pendingTimerCount(), 1);

  harness.pushState("/");
  harness.setActiveElement(resultInput);
  harness.runTimers();

  assert.equal(harness.document.activeElement, resultInput);
});

test("a direct result load still restores result-page focus", () => {
  const harness = createHarness(
    "https://www.youdao.com/result?word=hello&lang=en",
  );
  const resultInput = harness.setSearchInput("hello");
  harness.setActiveElement(resultInput);

  harness.runContentScript();

  assert.equal(harness.pendingTimerCount(), 1);
  harness.runTimers();
  assert.equal(harness.document.activeElement, harness.body);
});

test("top-row controls delegate clicks while numpad and missing controls are ignored", () => {
  const harness = createHarness(
    "https://www.youdao.com/result?word=hello&lang=en",
    { controls: { favorite: 1, pronunciation: 2 } },
  );
  const pageClickCounts = [0, 0, 0];
  const controls = [
    harness.controls.favorite[0],
    ...harness.controls.pronunciation,
  ];

  controls.forEach((control, index) => {
    control.addEventListener("click", () => {
      pageClickCounts[index] += 1;
    });
  });

  harness.runContentScript();
  harness.runTimers();

  for (const [key, code] of [
    ["1", "Digit1"],
    ["2", "Digit2"],
    ["3", "Digit3"],
  ]) {
    const event = harness.dispatchKey(key, code, harness.body);
    assert.equal(event.defaultPrevented, true);
    assert.equal(event.propagationStopped, true);
  }

  assert.deepEqual(pageClickCounts, [1, 1, 1]);
  assert.deepEqual(
    controls.map((control) => control.defaultActionCount),
    [0, 0, 0],
  );

  const numpadEvent = harness.dispatchKey("1", "Numpad1", harness.body);
  assert.equal(numpadEvent.defaultPrevented, false);
  assert.deepEqual(pageClickCounts, [1, 1, 1]);

  const missingControlHarness = createHarness(
    "https://www.youdao.com/result?word=hello&lang=en",
  );
  missingControlHarness.runContentScript();
  missingControlHarness.runTimers();
  const missingControlEvent = missingControlHarness.dispatchKey(
    "3",
    "Digit3",
    missingControlHarness.body,
  );
  assert.equal(missingControlEvent.defaultPrevented, false);
  assert.equal(missingControlEvent.propagationStopped, false);
});

test("editable targets keep native typing and Escape clears the live input", () => {
  const harness = createHarness(
    "https://www.youdao.com/result?word=hello&lang=en",
  );
  const firstInput = harness.setSearchInput("hello");

  harness.runContentScript();
  harness.runTimers();
  harness.setActiveElement(firstInput);

  const typingEvent = harness.dispatchKey("a", "KeyA", firstInput);
  assert.equal(typingEvent.defaultPrevented, false);
  assert.equal(firstInput.value, "hello");

  const replacementInput = harness.setSearchInput("world");
  harness.setActiveElement(replacementInput);
  const escapeEvent = harness.dispatchKey("Escape", "Escape", replacementInput);

  assert.equal(escapeEvent.defaultPrevented, true);
  assert.equal(escapeEvent.propagationStopped, false);
  assert.equal(firstInput.value, "hello");
  assert.equal(replacementInput.value, "");
  assert.equal(
    replacementInput.dispatchedEvents.filter((event) => event.type === "input")
      .length,
    1,
  );
  assert.equal(harness.pendingTimerCount(), 1);

  harness.runTimers();
  assert.equal(harness.document.activeElement, harness.body);
});
