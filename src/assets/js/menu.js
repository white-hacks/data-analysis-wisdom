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
 *   - tap/click on the "Menu" button to open or close the panel;
 *   - tap/click on a chevron button to expand a sub-list (touch accordion);
 *   - Escape to close (focus stays on the Menu button), and a click outside
 *     the menu to close;
 *   - aria-expanded kept in sync for screen readers.
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
   * narrow windows) rather than as a hover dropdown.
   * @returns {boolean}
   */
  function isSheetLayout() {
    return !hoverLayout.matches;
  }

  /**
   * Opens or closes the whole menu panel (button, Escape, outside clicks).
   * @param {boolean} open
   */
  function setMenuOpen(open) {
    menu.classList.toggle("is-open", open);
    trigger.setAttribute("aria-expanded", String(open));
    // Stop the page behind the full-screen mobile sheet from scrolling.
    document.documentElement.style.overflow = open && isSheetLayout() ? "hidden" : "";
  }

  /**
   * Expands or collapses one sub-list (accordion behaviour on touch screens).
   * Called when a chevron button inside the menu is pressed.
   * @param {HTMLButtonElement} button
   */
  function toggleSubmenu(button) {
    var item = button.closest(".menu__item");
    var expanded = item.classList.toggle("is-expanded");
    button.setAttribute("aria-expanded", String(expanded));
  }

  /* --- Desktop hover with "menu aim" ------------------------------------------
     In this mode (class .menu--aim) CSS shows the panel when the menu has
     .is-hovered and a fly-out when its item has .is-active; this script sets
     those classes. */

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
   * @returns {boolean}
   */
  function insideTriangle(p, a, b, c) {
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
   * the near edge is the fly-out's right side.
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
    var slack = 24;
    var top = { x: box.right + slack, y: box.top - slack };
    var bottom = { x: box.right + slack, y: box.bottom + slack };
    return insideTriangle(now, from, top, bottom);
  }

  /**
   * Closes `item` and every fly-out nested inside it.
   * @param {Element} item  An li.menu__item
   */
  function deactivate(item) {
    item.classList.remove("is-active");
    item.querySelectorAll(".is-active").forEach(function (el) {
      el.classList.remove("is-active");
    });
  }

  /**
   * Makes `item` the open entry of its list, closing its siblings.
   * @param {Element} item  An li.menu__item
   */
  function activate(item) {
    var siblings = item.parentElement.children;
    for (var i = 0; i < siblings.length; i++) {
      if (siblings[i] !== item) deactivate(siblings[i]);
    }
    if (item.classList.contains("menu__item--parent")) item.classList.add("is-active");
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

  /** Shows the panel (desktop) and cancels any pending close. */
  function onMenuEnter() {
    if (!menu.classList.contains("menu--aim")) return;
    clearTimeout(closeTimer);
    closing = false;
    if (!menu.classList.contains("is-dismissed")) menu.classList.add("is-hovered");
  }

  /** Starts (or restarts) the countdown to closing the hover menu. */
  function scheduleClose() {
    clearTimeout(closeTimer);
    closing = true;
    closeTimer = setTimeout(closeHover, CLOSE_DELAY);
  }

  /** Closes the panel and fly-outs a moment after the pointer leaves the menu. */
  function onMenuLeave() {
    if (!menu.classList.contains("menu--aim")) return;
    clearTimeout(aimTimer);
    scheduleClose();
  }

  /** Closes the desktop hover state immediately. */
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
    if (!hoverLayout.matches) closeHover();
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

  /* --- Buttons, Escape, outside clicks ---------------------------------------- */

  trigger.addEventListener("click", function () {
    menu.classList.remove("is-dismissed");
    setMenuOpen(!menu.classList.contains("is-open"));
  });

  menu.addEventListener("click", function (event) {
    var button = event.target.closest(".menu__expand");
    if (button) toggleSubmenu(button);
  });

  document.addEventListener("click", function (event) {
    if (menu.classList.contains("is-open") && !menu.contains(event.target)) setMenuOpen(false);
  });

  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape") return;
    if (menu.classList.contains("is-open") || menu.classList.contains("is-hovered") || menu.contains(document.activeElement)) {
      setMenuOpen(false);
      closeHover();
      // Keep keyboard focus on the Menu button, but mark the menu as
      // dismissed so CSS stops :hover / :focus-within from reopening it.
      menu.classList.add("is-dismissed");
      trigger.focus();
    }
  });

  /**
   * Clears the "dismissed" state set by Escape, so hover and focus open the
   * menu again. Called when the pointer leaves the menu or focus moves away.
   */
  function clearDismissed() {
    menu.classList.remove("is-dismissed");
  }
  menu.addEventListener("mouseleave", clearDismissed);
  menu.addEventListener("focusout", function (event) {
    if (!menu.contains(event.relatedTarget)) clearDismissed();
  });

  // Release the scroll lock if the window grows into the desktop layout.
  window.addEventListener("resize", function () {
    if (!isSheetLayout()) document.documentElement.style.overflow = "";
  });
})();
