/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Vertical Tabs.
 *
 * The Initial Developer of the Original Code is
 * Philipp von Weitershausen.
 * Portions created by the Initial Developer are Copyright (C) 2011
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("resource://verticaltabs/tabdatastore.jsm");
Components.utils.import("resource://verticaltabs/multiselect.jsm");

const EXPORTED_SYMBOLS = ["VerticalTabs"];

const NS_XUL = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
const TAB_DROP_TYPE = "application/x-moz-tabbrowser-tab";

/*
 * Vertical Tabs
 *
 * Main entry point of this add-on.
 */
function VerticalTabs(window) {
    this.window = window;
    this.document = window.document;
    this.unloaders = [];
    this.init();
}
VerticalTabs.prototype = {

    init: function init() {
        this.window.VerticalTabs = this;
        this.unloaders.push(function unloadWindowGlobal() {
            delete this.window.VerticalTabs;
        });

        this.installStylesheet("resource://verticaltabs/skin/bindings.css");
        this.installStylesheet("resource://verticaltabs/skin/base.css");
        switch (Services.appinfo.OS) {
          case "WINNT":
            this.installStylesheet("resource://verticaltabs/skin/win7/win7.css");
            break;
          case "Darwin":
            this.installStylesheet("resource://verticaltabs/skin/osx/osx.css");
            break;
          case "Linux":
            this.installStylesheet("resource://verticaltabs/skin/linux/linux.css");
            break;
        }

        this.rearrangeXUL();
        this.initContextMenu();
        this.observePrefs();

        let tabs = this.document.getElementById("tabbrowser-tabs");
        this.vtTabs = new VTTabbrowserTabs(tabs);
        this.tabIDs = new VTTabIDs(tabs);
        this.multiSelect = new VTMultiSelect(tabs);
        this.unloaders.push(function unloadDelegates() {
            this.vtTabs.unload();
            this.tabIDs.unload();
            this.multiSelect.unload();
        });

        this.window.addEventListener("sizemodechange", this, false);
        this.unloaders.push(function unloadWindowResizeListener() {
            this.window.removeEventListener("sizemodechange", this, false);
        });
    },

    installStylesheet: function installStylesheet(uri) {
        const document = this.document;
        let pi = document.createProcessingInstruction(
          "xml-stylesheet", "href=\"" + uri + "\" type=\"text/css\"");
        document.insertBefore(pi, document.documentElement);
        this.unloaders.push(function unloadStylesheet() {
            document.removeChild(pi);
        });
    },

    rearrangeXUL: function rearrangeXUL() {
        const window = this.window;
        const document = this.document;

        // Move the bottom stuff (findbar, addonbar, etc.) in with the
        // tabbrowser.  That way it will share the same (horizontal)
        // space as the brower.  In other words, the bottom stuff no
        // longer extends across the whole bottom of the window.
        let contentbox = document.getElementById("appcontent");
        let bottom = document.getElementById("browser-bottombox");
        contentbox.appendChild(bottom);

        // Create a box next to the app content. It will hold the tab
        // bar and the tab toolbar.
        let browserbox = document.getElementById("browser");
        let leftbox = document.createElementNS(NS_XUL, "vbox");
        leftbox.id = "verticaltabs-box";
        browserbox.insertBefore(leftbox, contentbox);
        let spacer = document.createElementNS(NS_XUL, "spacer");
        leftbox.appendChild(spacer);

        let splitter = document.createElementNS(NS_XUL, "splitter");
        splitter.id = "verticaltabs-splitter";
        splitter.className = "chromeclass-extrachrome";
        browserbox.insertBefore(splitter, contentbox);
        // Hook up event handler for splitter so that the width of the
        // tab bar is persisted.
        splitter.addEventListener("mouseup", this, false);

        // Move the tabs next to the app content, make them vertical,
        // and restore their width from previous session
        if (Services.prefs.getBoolPref("extensions.verticaltabs.right")) {
            browserbox.dir = "reverse";
        }

        let tabs = document.getElementById("tabbrowser-tabs");
        leftbox.insertBefore(tabs, leftbox.firstChild);
        tabs.orient = "vertical";
        tabs.mTabstrip.orient = "vertical";
        tabs.tabbox.orient = "horizontal"; // probably not necessary
        tabs.setAttribute("width", Services.prefs.getIntPref("extensions.verticaltabs.width"));

        // Move the tabs toolbar into the tab strip
        let toolbar = document.getElementById("TabsToolbar");
        toolbar._toolbox = null; // reset value set by constructor
        toolbar.setAttribute("toolboxid", "navigator-toolbox");
        leftbox.appendChild(toolbar);

        // Force tabs on bottom (for styling) after backing up the user's
        // setting.
        try {
          Services.prefs.getBoolPref("extensions.verticaltabs.tabsOnTop");
        } catch (ex if (ex.result == Components.results.NS_ERROR_UNEXPECTED)) {
          Services.prefs.setBoolPref("extensions.verticaltabs.tabsOnTop",
                                     window.TabsOnTop.enabled);
        }
        window.TabsOnTop.enabled = false;
        // Hide all menu items for tabs on top.
        let menu_tabsOnTop = document.getElementById("menu_tabsOnTop");
        menu_tabsOnTop.collapsed = true;
        menu_tabsOnTop.nextSibling.collapsed = true; // separator
        let toolbar_context_menu = document.getElementById("toolbar-context-menu");
        toolbar_context_menu.firstChild.collapsed = true;
        toolbar_context_menu.firstChild.nextSibling.collapsed = true; // separator
        let appmenu_tabsOnTop = document.getElementById("appmenu_toggleTabsOnTop");
        if (appmenu_tabsOnTop) {
            appmenu_tabsOnTop.collapsed = true;
        }
        // Disable the command just to be safe.
        let cmd_tabsOnTop = document.getElementById("cmd_ToggleTabsOnTop");
        cmd_tabsOnTop.disabled = true;

        // Fix up each individual tab for vertical layout, including
        // ones that are opened later on.
        tabs.addEventListener("TabOpen", this, false);
        for (let i=0; i < tabs.childNodes.length; i++) {
            this.initTab(tabs.childNodes[i]);
        }

        this.unloaders.push(function unloadRearrangeXUL() {
            // Move the bottom back to being the next sibling of contentbox.
            browserbox.insertBefore(bottom, contentbox.nextSibling);

            // Move the tabs toolbar back to where it was
            toolbar._toolbox = null; // reset value set by constructor
            toolbar.removeAttribute("toolboxid");
            let toolbox = document.getElementById("navigator-toolbox");
            toolbox.appendChild(toolbar);

            // Restore the tab strip.
            let new_tab_button = document.getElementById("new-tab-button");
            toolbar.insertBefore(tabs, new_tab_button);
            tabs.orient = "horizontal";
            tabs.mTabstrip.orient = "horizontal";
            tabs.tabbox.orient = "vertical"; // probably not necessary
            tabs.removeAttribute("width");
            tabs.removeEventListener("TabOpen", this, false);

            // Restore tabs on top.
            window.TabsOnTop.enabled = Services.prefs.getBoolPref(
                "extensions.verticaltabs.tabsOnTop");
            menu_tabsOnTop.collapsed = false;
            menu_tabsOnTop.nextSibling.collapsed = false; // separator
            toolbar_context_menu.firstChild.collapsed = false;
            toolbar_context_menu.firstChild.nextSibling.collapsed = false; // separator
            if (appmenu_tabsOnTop) {
                appmenu_tabsOnTop.collapsed = false;
            }
            cmd_tabsOnTop.disabled = false;

            // Restore all individual tabs.
            for (let i = 0; i < tabs.childNodes.length; i++) {
              let tab = tabs.childNodes[i];
              tab.removeAttribute("align");
              tab.maxWidth = tab.minWidth = "";
            }

            // Remove all the crap we added.
            splitter.removeEventListener("mouseup", this, false);
            browserbox.removeChild(leftbox);
            browserbox.removeChild(splitter);
            browserbox.dir = "normal";
            leftbox = splitter = null;
        });
    },

    initContextMenu: function initContextMenu() {
        const document = this.document;
        const tabs = document.getElementById("tabbrowser-tabs");

        let closeMultiple = document.createElementNS(NS_XUL, "menuitem");
        closeMultiple.id = "context_verticalTabsCloseMultiple";
        closeMultiple.setAttribute("label", "Close Selected Tabs"); //TODO l10n
        closeMultiple.setAttribute("tbattr", "tabbrowser-multiple");
        closeMultiple.setAttribute(
          "oncommand", "gBrowser.tabContainer.VTMultiSelect.closeSelected();");
        tabs.contextMenu.appendChild(closeMultiple);

        tabs.contextMenu.addEventListener("popupshowing", this, false);

        this.unloaders.push(function unloadContextMenu() {
            tabs.contextMenu.removeChild(closeMultiple);
            tabs.contextMenu.removeEventListener("popupshowing", this, false);
        });
    },

    initTab: function initTab(aTab) {
        aTab.setAttribute("align", "stretch");
        aTab.maxWidth = 65000;
        aTab.minWidth = 0;
    },

    onTabbarResized: function onTabbarResized() {
        let tabs = this.document.getElementById("tabbrowser-tabs");
        this.window.setTimeout(function() {
            Services.prefs.setIntPref("extensions.verticaltabs.width",
                                      tabs.boxObject.width);
        }, 10);
    },

    observePrefs: function observePrefs() {
      Services.prefs.addObserver("extensions.verticaltabs.", this, false);
      this.unloaders.push(function unloadObservePrefs() {
        Services.prefs.removeObserver("extensions.verticaltabs.", this, false);
      });
    },

    observe: function observe(subject, topic, data) {
      if (topic != "nsPref:changed") {
        return;
      }
      if (data == "extensions.verticaltabs.right") {
        let browserbox = this.document.getElementById("browser");
        if (browserbox.dir != "reverse") {
          browserbox.dir = "reverse";
        } else {
          browserbox.dir = "normal";
        }
      }
      if (data == "extensions.verticaltabs.hideInFullscreen") {
        // call manually, so we re-show tabs when in fullscreen
        this.onWindowResize();
      }
    },

    unload: function unload() {
      this.unloaders.forEach(function(func) {
        func.call(this);
      }, this);
    },

    /*** Event handlers ***/

    handleEvent: function handleEvent(aEvent) {
        switch (aEvent.type) {
        case "DOMContentLoaded":
            this.init();
            return;
        case "TabOpen":
            this.onTabOpen(aEvent);
            return;
        case "mouseup":
            this.onMouseUp(aEvent);
            return;
        case "sizemodechange":
            this.onSizeModeChange(aEvent);
            return;
        case "popupshowing":
            this.onPopupShowing(aEvent);
            return;
        }
    },

    onSizeModeChange: function() {
        const window = this.window;
        const document = this.document;

        let hideOk = Services.prefs.getBoolPref("extensions.verticaltabs.hideInFullscreen");
        let display = hideOk && window.fullScreen ? "none" : "";

        let tabs = document.getElementById("verticaltabs-box").style;
        let splitter = document.getElementById("verticaltabs-splitter").style;

        if (tabs.display == display && splitter.display == display) {
          return;
        }

        tabs.display = splitter.display = display;
    },

    onTabOpen: function onTabOpen(aEvent) {
        this.initTab(aEvent.target);
    },

    onMouseUp: function onMouseUp(aEvent) {
        if (aEvent.target.getAttribute("id") == "verticaltabs-splitter") {
            this.onTabbarResized();
        }
    },

    onPopupShowing: function onPopupShowing(aEvent) {
        let closeTabs = this.document.getElementById("context_verticalTabsCloseMultiple");
        let tabs = this.multiSelect.getSelected();
        if (tabs.length > 1) {
            closeTabs.disabled = false;
        } else {
            closeTabs.disabled = true;
        }
    }

};

/**
 * Patches for the tabbrowser-tabs object.
 *
 * These are necessary where the original implementation assumes a
 * horizontal layout. Pretty much only needed for drag'n'drop to work
 * correctly.
 *
 * WARNING: Do not continue reading unless you want to feel sick. You
 * have been warned.
 *
 */
function VTTabbrowserTabs(tabs) {
    this.tabs = tabs;
    this.init();
}
VTTabbrowserTabs.prototype = {

    init: function init() {
        this.swapMethods();
        this.onDragOver = this.onDragOver.bind(this);
        this.tabs.addEventListener('dragover', this.onDragOver, false);
    },

    unload: function unload() {
        this.swapMethods();
        this.tabs.removeEventListener('dragover', this.onDragOver, false);
    },

    _patchedMethods: ["_positionPinnedTabs",
                      "_getDropIndex",
                      "_isAllowedForDataTransfer",
                      "_setEffectAllowedForDataTransfer",
                      "_animateTabMove",
                      "_finishAnimateTabMove",
                      ],
    swapMethods: function swapMethods() {
        const tabs = this.tabs;
        this._patchedMethods.forEach(function(methodname) {
            this.swapMethod(tabs, this, methodname);
        }, this);
    },

    swapMethod: function swapMethod(obj1, obj2, methodname) {
      let method1 = obj1[methodname];
      let method2 = obj2[methodname];
      obj1[methodname] = method2;
      obj2[methodname] = method1;
    },

    // Modified methods below.

    _positionPinnedTabs: function _positionPinnedTabs() {
        // TODO we might want to do something here. For now we just
        // don't do anything which is better than doing something stupid.
    },

    _getDropIndex: function _getDropIndex(event) {
        var tabs = this.childNodes;
        var tab = this._getDragTargetTab(event);
        // CHANGE for Vertical Tabs: no ltr handling, X -> Y, width -> height
        // and group support.
        for (let i = tab ? tab._tPos : 0; i < tabs.length; i++) {
            // Dropping on a group will append to that group's children.
            if (event.screenY < tabs[i].boxObject.screenY + tabs[i].boxObject.height / 2)
                return i;
        }
        return tabs.length;
    },

    _isAllowedForDataTransfer: function _isAllowedForDataTransfer(node) {
        const window = node.ownerDocument.defaultView;
        return (node instanceof window.XULElement
                && node.localName == "tab"
                && (node.parentNode == this
                    || (node.ownerDocument.defaultView instanceof window.ChromeWindow
                        && node.ownerDocument.documentElement.getAttribute("windowtype") == "navigator:browser")));

    },

    _setEffectAllowedForDataTransfer: function _setEffectAllowedForDataTransfer(event) {
        var dt = event.dataTransfer;
        // Disallow dropping multiple items
        if (dt.mozItemCount > 1)
            return dt.effectAllowed = "none";

        var types = dt.mozTypesAt(0);
        // tabs are always added as the first type
        if (types[0] == TAB_DROP_TYPE) {
            let sourceNode = dt.mozGetDataAt(TAB_DROP_TYPE, 0);
            if (this._isAllowedForDataTransfer(sourceNode)) {
                if (sourceNode.parentNode == this &&
                    // CHANGE for Vertical Tabs: X -> Y, width -> height
                    (event.screenY >= sourceNode.boxObject.screenY &&
                     event.screenY <= (sourceNode.boxObject.screenY +
                                       sourceNode.boxObject.height))) {
                    return dt.effectAllowed = "none";
                }

                return dt.effectAllowed = event.ctrlKey ? "copy" : "move";
            }
        }

        if (browserDragAndDrop.canDropLink(event)) {
            // Here we need to do this manually
            return dt.effectAllowed = dt.dropEffect = "link";
        }
        return dt.effectAllowed = "none";
    },

    // This function is supposed to show an animation while the tab is being
    // moved (not copied), and to update the tab drop index.
    _animateTabMove: function _animateTabMove(event) {
        // Save the drop index here, because the drop handler won't move
        // the tab without that.
        let draggedTab = event.dataTransfer.mozGetDataAt(TAB_DROP_TYPE, 0);
        draggedTab._dragData.animDropIndex = this._getDropIndex(event);

        // Show the drop indicator, which will be positioned in our "dragover" handler.
        this._tabDropIndicator.collapsed = false;

        /* TODO: it would be better if the drop indicator were different for copy and move (a
         *       different color for instance).
         *       In Mozilla implementation, the tab indicator is only used for copy, and an
         *       animation is used for move (the tabs are shifted in the tab bar as the mouse drags
         *       the tab to be moved).
         *       I have no idea how to implement such an animation tough. -- Tey'
         */
    },

    _finishAnimateTabMove: function _finishAnimateTabMove() {
        // TODO we might want to do something here. For now we just
        // don't do anything which is better than doing something stupid.
    },

    // Calculate the drop indicator's position for vertical tabs.
    // Overwrites what the original 'dragover' event handler does
    // towards the end.
    onDragOver: function onDragOver(aEvent) {
        const tabs = this.tabs;
        let ind = tabs._tabDropIndicator;
        let newIndex = tabs._getDropIndex(aEvent);
        let rect = tabs.getBoundingClientRect();
        let newMargin;

        if (newIndex == tabs.childNodes.length) {
            let tabRect = tabs.childNodes[newIndex-1].getBoundingClientRect();
            newMargin = tabRect.bottom - rect.top;
        } else {
            let tabRect = tabs.childNodes[newIndex].getBoundingClientRect();
            newMargin = tabRect.top - rect.top;
        }

        newMargin += ind.clientHeight / 2;
        ind.style.transform = "translate(0, " + Math.round(newMargin) + "px)";
        ind.style.MozMarginStart = null;
        ind.style.marginTop = null;
        ind.style.maxWidth = rect.width + "px";
    }
};
