/**
 * src/assets/js/menu.js
 * ----------------------------------------------------------------------------
 * Behaviour of the main menu (markup in src/_includes/partials/menu.njk,
 * styles under "Menu" in src/assets/css/main.css).
 *
 * Without this script the menu still works on a desktop: CSS opens it on
 * :hover and :focus-within. This script adds:
 *   - desktop "menu aim": the pointer can travel diagonally towards an open
 *     fly-out without a neighbouring entry it crosses taking over, and the
 *     menu stays open for a moment when the pointer briefly leaves it;
 *   - click/tap or Enter on the "Menu" button to open or close the panel;
 *   - the chevron buttons, which open a sub-list: an accordion on touch
 *     screens, a fly-out on desktop (so keyboard users Tab through the four
 *     main entries instead of every link in every fly-out);
 *   - Escape, a click outside the menu, or focus leaving it to close it;
 *   - aria-expanded kept in sync with what is shown, for screen readers.
 *
 * Loaded with `defer` from layouts/base.njk; it runs once the HTML is parsed.
 */
(function () {
  "use strict";

  var menu = document.querySelector("[data-menu]");
  if (!menu) return;
  var trigger = menu.querySelector(".menu__trigger");

  /** Same query as the desktop block in main.css. */
  var hoverLayout = window.matchMedia("(hover: hover) and (pointer: fine) and (min-width: 900px)");

  /** How long (ms) the menu waits before closing after the pointer leaves it. */
  var CLOSE_DELAY = 450;
  /** How long (ms) to keep a fly-out open while the pointer heads towards it. */
  var AIM_DELAY = 350;

  /**
   * True when the menu is shown as a full-screen sheet (touch screens or
   * narrow windows) rather than as a hover dropdown. Called whenever
   * behaviour differs between the two layouts.
   * @returns {boolean}
   */
  function isSheetLayout() {
    return !hoverLayout.matches;
  }

  /**
   * Stops the page behind the full-screen sheet from scrolling while the
   * sheet is open, and releases it otherwise. Called whenever the open state
   * or the layout changes.
   */
  function updateScrollLock() {
    var lock = menu.classList.contains("is-open") && isSheetLayout();
    document.documentElement.style.overflow = lock ? "hidden" : "";
  }

  /**
   * Opens or closes the whole menu panel (Menu button, Escape, clicks or
   * focus outside the menu).
   * @param {boolean} open
   */
  function setMenuOpen(open) {
    menu.classList.toggle("is-open", open);
    trigger.setAttribute("aria-expanded", String(open));
    updateScrollLock();
  }

  /**
   * The class that marks an open sub-list: "is-active" for desktop
   * fly-outs (shared with the hover logic below), "is-expanded" for the
   * accordion in the sheet.
   * @returns {string}
   */
  function openClass() {
    return isSheetLayout() ? "is-expanded" : "is-active";
  }

  /**
   * Copies an item's open/closed state to its chevron button's
   * aria-expanded. Called after any change to an item's open class.
   * @param {Element} item  An li.menu__item
   */
  function syncExpandButton(item) {
    var button = item.querySelector(":scope > .menu__expand");
    if (button) button.setAttribute("aria-expanded", String(item.classList.contains(openClass())));
  }

  /** Re-syncs every chevron button, e.g. after the layout changes. */
  function syncAllExpandButtons() {
    menu.querySelectorAll(".menu__item--parent").forEach(syncExpandButton);
  }

  /**
   * Expands or collapses one sub-list. Called when a chevron button inside
   * the menu is pressed. On desktop it opens the fly-out (closing its
   * siblings, like hovering does); in the sheet it toggles the accordion.
   * @param {HTMLButtonElement} button
   */
  function toggleSubmenu(button) {
    var item = button.closest(".menu__item");
    if (isSheetLayout()) {
      item.classList.toggle("is-expanded");
      syncExpandButton(item);
    } else if (item.classList.contains("is-active")) {
      deactivate(item);
    } else {
      activate(item);
    }
  }

  /* --- Desktop hover with "menu aim" ------------------------------------------
     In this mode (class .menu--aim) CSS shows the panel when the menu has
     .is-hovered or .is-open, and a fly-out when its item has .is-active;
     this script sets those classes. */

  /** Recent pointer positions {x, y, t}, oldest first (about 300ms worth). */
  var trail = [];
  var closeTimer = null;
  var closing = false;
  var aimTimer = null;

  /**
   * Records the pointer position and, while the menu is about to close
   * because the pointer left it, postpones closing if the pointer is still
   * heading for the open fly-out (e.g. crossing the empty space below the
   * panel). Called on every mousemove anywhere on the page.
   * @param {MouseEvent} event
   */
  function onPointerMove(event) {
    var now = performance.now();
    trail.push({ x: event.clientX, y: event.clientY, t: now });
    while (trail.length > 2 && now - trail[0].t > 300) trail.shift();
    if (closing) {
      var flyouts = menu.querySelectorAll(".menu__item.is-active > .menu__list");
      var deepest = flyouts[flyouts.length - 1];
      if (deepest && headingTowards(deepest)) scheduleClose();
    }
  }

  /**
   * True when point p lies inside the triangle a-b-c (edges included).
   * Called by headingTowards().
   * @returns {boolean}
   */
  function insideTriangle(p, a, b, c) {
    /** Which side of the line p2→p3 the point p1 is on (sign of a cross product). */
    function side(p1, p2, p3) {
      return (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y);
    }
    var d1 = side(p, a, b);
    var d2 = side(p, b, c);
    var d3 = side(p, c, a);
    var hasNegative = d1 < 0 || d2 < 0 || d3 < 0;
    var hasPositive = d1 > 0 || d2 > 0 || d3 > 0;
    return !(hasNegative && hasPositive);
  }

  /**
   * True when the pointer's latest movement heads towards `flyout`, i.e. the
   * current position is inside the triangle formed by an earlier position
   * and the fly-out's near edge. Fly-outs open to the left of their item, so
   * the near edge is the fly-out's right side. Called by onItemEnter() and
   * onPointerMove().
   * @param {Element} flyout
   * @param {{x: number, y: number}} [current]  Pointer position to test; by
   *   default the latest recorded one. Pass it from mouseenter handlers:
   *   browsers fire mouseenter before the mousemove that caused it.
   * @returns {boolean}
   */
  function headingTowards(flyout, current) {
    var now = current ? { x: current.x, y: current.y, t: performance.now() } : trail[trail.length - 1];
    if (!now) return false;
    // Direction = from the oldest recent position (last 300ms) to now; older
    // positions are ignored because the pointer may have paused or jumped.
    var from = null;
    for (var i = 0; i < trail.length; i++) {
      var p = trail[i];
      if (now.t - p.t <= 300 && (p.x !== now.x || p.y !== now.y)) {
        from = p;
        break;
      }
    }
    if (!from) return false;
    if (from.x === now.x && from.y === now.y) return false;
    var box = flyout.getBoundingClientRect();
    // The triangle's base is the fly-out's near edge, stretched a little
    // vertically so aiming at its first or last entry still counts. It must
    // not move sideways: fly-outs touch their parent list, so any outward
    // shift would leave a strip of the parent list where aiming never counts.
    var slack = 24;
    var top = { x: box.right, y: box.top - slack };
    var bottom = { x: box.right, y: box.bottom + slack };
    return insideTriangle(now, from, top, bottom);
  }

  /**
   * Keeps a long fly-out with no fly-outs of its own (e.g. the list of
   * authors) inside the window: it gets a max-height measured from where it
   * actually starts, and scrolls (see main.css). Called when a fly-out opens.
   * @param {Element} item  The li.menu__item whose fly-out just opened.
   */
  function fitFlyout(item) {
    var list = item.querySelector(":scope > .menu__list");
    if (!list || list.querySelector(".menu__item--parent")) return;
    var room = window.innerHeight - list.getBoundingClientRect().top - 16;
    list.style.maxHeight = Math.max(160, Math.floor(room)) + "px";
  }

  /**
   * Closes `item` and every fly-out nested inside it. Called by activate()
   * for the siblings of the entry being opened, by closeHover(), and by a
   * chevron button that closes its fly-out.
   * @param {Element} item  An li.menu__item
   */
  function deactivate(item) {
    item.classList.remove("is-active");
    syncExpandButton(item);
    item.querySelectorAll(".is-active").forEach(function (el) {
      el.classList.remove("is-active");
      syncExpandButton(el);
    });
  }

  /**
   * Makes `item` the open entry of its list, closing its siblings. Called
   * when the pointer rests on an entry (onItemEnter) and when a chevron
   * button opens a fly-out on desktop.
   * @param {Element} item  An li.menu__item
   */
  function activate(item) {
    var siblings = item.parentElement.children;
    for (var i = 0; i < siblings.length; i++) {
      if (siblings[i] !== item) deactivate(siblings[i]);
    }
    if (item.classList.contains("menu__item--parent") && !item.classList.contains("is-active")) {
      item.classList.add("is-active");
      syncExpandButton(item);
      fitFlyout(item);
    }
  }

  /**
   * Handles the pointer entering a menu entry. Switches to it at once,
   * unless the pointer is on its way to the fly-out that is already open in
   * the same list; then it waits briefly and switches only if the pointer
   * has stopped on this entry.
   * @param {Element} item
   * @param {MouseEvent} event  The mouseenter event.
   */
  function onItemEnter(item, event) {
    if (!menu.classList.contains("menu--aim")) return;
    clearTimeout(aimTimer);
    var open = item.parentElement.querySelector(":scope > .menu__item.is-active");
    var flyout = open && open !== item ? open.querySelector(":scope > .menu__list") : null;
    if (flyout && headingTowards(flyout, { x: event.clientX, y: event.clientY })) {
      aimTimer = setTimeout(function () {
        if (item.matches(":hover")) activate(item);
      }, AIM_DELAY);
    } else {
      activate(item);
    }
  }

  /** Shows the panel (desktop) and cancels any pending close. Called on mouseenter of the menu. */
  function onMenuEnter() {
    if (!menu.classList.contains("menu--aim")) return;
    clearTimeout(closeTimer);
    closing = false;
    if (!menu.classList.contains("is-dismissed")) menu.classList.add("is-hovered");
  }

  /**
   * Starts (or restarts) the countdown to closing the hover menu. Called
   * when the pointer leaves the menu, and again while it keeps heading
   * for an open fly-out.
   */
  function scheduleClose() {
    clearTimeout(closeTimer);
    closing = true;
    closeTimer = setTimeout(closeHover, CLOSE_DELAY);
  }

  /**
   * Closes the panel and fly-outs a moment after the pointer leaves the
   * menu. A menu opened with the Menu button stays open until it is closed
   * with the button, Escape, or a click or focus outside it. Called on
   * mouseleave of the menu.
   */
  function onMenuLeave() {
    if (!menu.classList.contains("menu--aim")) return;
    clearTimeout(aimTimer);
    if (menu.classList.contains("is-open")) {
      menu.classList.remove("is-hovered");
      return;
    }
    scheduleClose();
  }

  /**
   * Closes the desktop hover state and every fly-out immediately. Called
   * when the close countdown ends, on dismiss(), and when the layout
   * switches to the sheet.
   */
  function closeHover() {
    clearTimeout(closeTimer);
    closing = false;
    menu.classList.remove("is-hovered");
    menu.querySelectorAll(".menu__item.is-active").forEach(deactivate);
  }

  /**
   * Turns "menu aim" on for mouse-driven desktops and off for touch/narrow
   * layouts. Called once at start and whenever the media query changes.
   */
  function updateMode() {
    menu.classList.toggle("menu--aim", hoverLayout.matches);
    if (!hoverLayout.matches) {
      closeHover();
      // Heights set by fitFlyout() are for desktop fly-outs only.
      menu.querySelectorAll(".menu__list").forEach(function (list) {
        list.style.maxHeight = "";
      });
    }
    syncAllExpandButtons();
    updateScrollLock();
  }

  document.addEventListener("mousemove", onPointerMove, { passive: true });
  menu.addEventListener("mouseenter", onMenuEnter);
  menu.addEventListener("mouseleave", onMenuLeave);
  menu.querySelectorAll(".menu__item").forEach(function (item) {
    item.addEventListener("mouseenter", function (event) {
      onItemEnter(item, event);
    });
  });
  if (hoverLayout.addEventListener) hoverLayout.addEventListener("change", updateMode);
  updateMode();

  /* --- Buttons, Escape, outside clicks and focus ----------------------------- */

  /**
   * Closes the menu and keeps it shut while the pointer or focus is still
   * on it (CSS hides the panel while .is-dismissed is set, even on hover).
   * Called by Escape and by the Menu button when it closes the menu.
   */
  function dismiss() {
    setMenuOpen(false);
    closeHover();
    menu.classList.add("is-dismissed");
  }

  // Menu button (click, tap, Enter or Space): open, or close if open.
  trigger.addEventListener("click", function () {
    if (menu.classList.contains("is-open")) {
      dismiss();
    } else {
      menu.classList.remove("is-dismissed");
      setMenuOpen(true);
    }
  });

  // Chevron buttons inside the menu open or close their sub-list.
  menu.addEventListener("click", function (event) {
    var button = event.target.closest(".menu__expand");
    if (button) toggleSubmenu(button);
  });

  // A click anywhere outside the menu closes it.
  document.addEventListener("click", function (event) {
    if (menu.classList.contains("is-open") && !menu.contains(event.target)) setMenuOpen(false);
  });

  // Escape closes the menu from anywhere on the page.
  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape") return;
    if (menu.classList.contains("is-open") || menu.classList.contains("is-hovered") || menu.contains(document.activeElement)) {
      dismiss();
      // Keep keyboard focus on the Menu button rather than losing it.
      trigger.focus();
    }
  });

  /**
   * Clears the "dismissed" state set by Escape or the Menu button, so hover
   * and focus open the menu again. Called when the pointer leaves the menu
   * or focus moves away from it.
   */
  function clearDismissed() {
    menu.classList.remove("is-dismissed");
  }
  menu.addEventListener("mouseleave", clearDismissed);

  // When keyboard focus moves out of the menu (e.g. Tab past its last
  // entry), close it so focus never ends up behind the sheet or under an
  // open dropdown.
  menu.addEventListener("focusout", function (event) {
    var next = event.relatedTarget;
    if (next && menu.contains(next)) return;
    clearDismissed();
    if (next && menu.classList.contains("is-open")) {
      setMenuOpen(false);
      closeHover();
    }
  });

  // Re-apply or release the scroll lock if the window crosses into or out
  // of the sheet layout while the menu is open.
  window.addEventListener("resize", updateScrollLock);
})();
