/**
 * src/assets/js/menu.js
 * ----------------------------------------------------------------------------
 * Makes the hover menu work for touch screens and keyboards.
 *
 * On a desktop with a mouse the menu needs no JavaScript at all: CSS opens
 * it on :hover (see "Menu" in main.css). This script adds:
 *   - tap/click on the "Menu" button to open or close the panel;
 *   - tap/click on a chevron button to expand a sub-list (accordion);
 *   - Escape to close, and a click outside the menu to close;
 *   - aria-expanded kept in sync for screen readers.
 *
 * Loaded with `defer` from layouts/base.njk; it runs once the HTML is parsed.
 */
(function () {
  "use strict";

  var menu = document.querySelector("[data-menu]");
  if (!menu) return;
  var trigger = menu.querySelector(".menu__trigger");

  /**
   * Opens or closes the whole menu panel.
   * Called by the Menu button, Escape key and outside clicks.
   * @param {boolean} open
   */
  function setMenuOpen(open) {
    menu.classList.toggle("is-open", open);
    trigger.setAttribute("aria-expanded", String(open));
    // Stop the page behind the full-screen mobile sheet from scrolling.
    document.documentElement.style.overflow = open && isSheetLayout() ? "hidden" : "";
  }

  /**
   * True when the menu is shown as a full-screen sheet (touch screens or
   * narrow windows) rather than as a hover dropdown.
   * Mirrors the media query used in main.css.
   * @returns {boolean}
   */
  function isSheetLayout() {
    return !window.matchMedia("(hover: hover) and (pointer: fine) and (min-width: 900px)").matches;
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

  trigger.addEventListener("click", function () {
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
    if (menu.classList.contains("is-open") || menu.contains(document.activeElement)) {
      setMenuOpen(false);
      // Move focus out of the menu so :focus-within no longer keeps it open.
      trigger.focus();
      trigger.blur();
    }
  });

  // Close the sheet if the window grows into the desktop layout.
  window.addEventListener("resize", function () {
    if (!isSheetLayout()) document.documentElement.style.overflow = "";
  });
})();
