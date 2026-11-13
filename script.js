(function () {
  "use strict";

  var STORAGE_KEY = "hallway-sim-saved-boards-v1";

  // Fill these in with your Firebase project's config (Project settings > General > Your apps > SDK setup)
  // to enable cross-device cloud sync. Until then, saved boards stay local to this browser only.
  var FIREBASE_CONFIG = {
    apiKey: "AIzaSyC17GblkenoyqLGyRw8oWARkyJdxOMkK5U",
    authDomain: "board-simulation.firebaseapp.com",
    databaseURL: "https://board-simulation-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "board-simulation",
    storageBucket: "board-simulation.firebasestorage.app",
    messagingSenderId: "624011562156",
    appId: "1:624011562156:web:b8999c39a4a69e83212309"
  };
  var FIREBASE_ENABLED = FIREBASE_CONFIG.apiKey.indexOf("REPLACE_ME") === -1 && typeof firebase !== "undefined";
  var savedBoardsRef = null;

  // Actual outer frame sizes (envelope-type paper frames), not the print/paper size -
  // the frame itself is bigger than the photo it holds. Stored landscape by default
  // (wCm >= hCm), matching the frame vendor's 가로×세로 measurements.
  var PRESETS = [
    { key: "4x6", label: "4×6", wCm: 18.5, hCm: 12.9, color: "#e2725b", url: "https://galleryunsu.co.kr/product/list.html?cate_no=70" },
    { key: "5x7", label: "5×7", wCm: 21.6, hCm: 16.0, color: "#4f9d69", url: "https://galleryunsu.co.kr/product/list.html?cate_no=71" },
    { key: "a4", label: "A4", wCm: 35.2, hCm: 26.3, color: "#c98a3e", url: "https://galleryunsu.co.kr/product/list.html?cate_no=73" },
    { key: "8jeol", label: "8절", wCm: 46.6, hCm: 34.4, color: "#d1487a", url: "https://galleryunsu.co.kr/product/list.html?cate_no=94" },
    { key: "a3", label: "A3", wCm: 50.1, hCm: 37.5, color: "#8a5cb5", url: "https://galleryunsu.co.kr/product/list.html?cate_no=74" }
  ];

  var CUSTOM_COLORS = ["#3d6ee0", "#2ba7a0", "#e0a83d", "#8a5cb5", "#c9556f", "#5a9c4c", "#3d8fe0", "#e07d3d"];

  function round1(n) { return Math.round(n * 10) / 10; }
  function clamp(v, min, max) { return Math.min(Math.max(v, min), max); }
  function uid(prefix) { return prefix + "-" + Math.random().toString(36).slice(2, 9); }

  // Re-applies the current PRESETS size to a placed item that came from a preset
  // (matched by presetKey, honoring its rotated flag), so preset dimension changes
  // (e.g. correcting a frame size) retroactively resize items already placed with
  // the old numbers. Returns true if the item's size actually changed.
  function migratePlacedItemPresetSize(item) {
    if (!item.presetKey) return false;
    var preset = PRESETS.find(function (p) { return p.key === item.presetKey; });
    if (!preset) return false;
    var newW = item.rotated ? preset.hCm : preset.wCm;
    var newH = item.rotated ? preset.wCm : preset.hCm;
    if (item.wCm === newW && item.hCm === newH) return false;
    item.wCm = newW;
    item.hCm = newH;
    return true;
  }

  function migratePlacedItems(items, boardWCm, boardHCm) {
    var changed = false;
    items.forEach(function (item) {
      if (migratePlacedItemPresetSize(item)) changed = true;
    });
    if (changed) {
      items.forEach(function (item) {
        item.xCm = clamp(item.xCm, 0, Math.max(boardWCm - item.wCm, 0));
        item.yCm = clamp(item.yCm, 0, Math.max(boardHCm - item.hCm, 0));
      });
    }
    return changed;
  }

  function loadSavedBoards() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      return [];
    }
  }

  function persistSavedBoards() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state.savedBoards));
    } catch (err) {
      // storage unavailable (private mode / quota) - saved list stays in-memory only
    }
  }

  var state = {
    board: null, // { name, wCm, hCm, scale, pxW, pxH }
    presetTemplates: PRESETS.map(function (p, i) {
      return { id: "preset-" + i, key: p.key, isPreset: true, label: p.label, baseWCm: p.wCm, baseHCm: p.hCm, wCm: p.wCm, hCm: p.hCm, color: p.color, url: p.url, rotated: false };
    }),
    customTemplates: [],
    placedItems: [],
    addCascade: 0,
    savedBoards: loadSavedBoards() // [{ id, name, wCm, hCm, placedItems }]
  };

  // Live collaboration room state (see "Collaboration room" below).
  var collab = {
    active: false,
    code: null,
    clientId: uid("user"),
    name: "",
    color: "",
    roomRef: null,
    draggingId: null, // id of the placed item this browser is dragging right now
    members: {},
    cursors: {},
    cursorLayer: (function () {
      var layer = document.createElement("div");
      layer.className = "collab-cursor-layer";
      return layer;
    })()
  };

  var el = {
    boardNameInput: document.getElementById("boardNameInput"),
    boardWidthInput: document.getElementById("boardWidthInput"),
    boardHeightInput: document.getElementById("boardHeightInput"),
    applyBoardBtn: document.getElementById("applyBoardBtn"),
    saveBoardBtn: document.getElementById("saveBoardBtn"),
    editBoardBtn: document.getElementById("editBoardBtn"),
    deleteBoardBtn: document.getElementById("deleteBoardBtn"),
    boardHint: document.getElementById("boardHint"),
    savedBoardsList: document.getElementById("savedBoardsList"),
    boardTitle: document.getElementById("boardTitle"),
    boardWrapper: document.getElementById("boardWrapper"),
    board: document.getElementById("board"),
    boardPlaceholder: document.getElementById("boardPlaceholder"),
    boardInfo: document.getElementById("boardInfo"),
    clearBoardBtn: document.getElementById("clearBoardBtn"),
    saveImageBtn: document.getElementById("saveImageBtn"),
    customPanel: document.getElementById("customPanel"),
    customNameInput: document.getElementById("customNameInput"),
    customWidthInput: document.getElementById("customWidthInput"),
    customHeightInput: document.getElementById("customHeightInput"),
    addCustomBtn: document.getElementById("addCustomBtn"),
    customGallery: document.getElementById("customGallery"),
    presetPanel: document.getElementById("presetPanel"),
    presetGallery: document.getElementById("presetGallery"),
    dragGhost: document.getElementById("dragGhost")
  };

  // ---------- Board setup ----------

  el.applyBoardBtn.addEventListener("click", function () {
    var w = parseFloat(el.boardWidthInput.value);
    var h = parseFloat(el.boardHeightInput.value);
    if (!(w > 0) || !(h > 0)) {
      el.boardHint.hidden = false;
      el.boardHint.textContent = "가로/세로 값을 0보다 큰 숫자로 입력해주세요.";
      return;
    }
    state.board = { name: el.boardNameInput.value.trim(), wCm: w, hCm: h, scale: 1, pxW: 0, pxH: 0, savedId: null };
    state.placedItems = [];
    state.addCascade = 0;
    activateBoardUI();
    collabSyncAll();
  });

  el.clearBoardBtn.addEventListener("click", function () {
    if (!state.board) return;
    state.placedItems = [];
    renderBoard();
    collabSyncAll();
  });

  el.saveBoardBtn.addEventListener("click", function () {
    if (!state.board) return;
    var name = state.board.name;
    if (!name) {
      el.boardHint.hidden = false;
      el.boardHint.textContent = "저장하려면 환경판 이름을 입력해주세요.";
      return;
    }
    var existing = state.board.savedId
      ? state.savedBoards.find(function (b) { return b.id === state.board.savedId; })
      : state.savedBoards.find(function (b) { return b.name === name; });
    var entry = {
      id: existing ? existing.id : uid("saved"),
      name: name,
      wCm: state.board.wCm,
      hCm: state.board.hCm,
      placedItems: JSON.parse(JSON.stringify(state.placedItems))
    };
    state.board.savedId = entry.id;
    collabSyncBoardMeta();

    if (FIREBASE_ENABLED && savedBoardsRef) {
      savedBoardsRef.child(entry.id).set(entry);
      // the realtime listener updates state.savedBoards and re-renders the list
    } else {
      if (existing) {
        state.savedBoards[state.savedBoards.indexOf(existing)] = entry;
      } else {
        state.savedBoards.push(entry);
      }
      persistSavedBoards();
      renderSavedBoardsList();
    }
    el.boardHint.hidden = false;
    el.boardHint.textContent = "“" + name + "” 환경판이 저장되었습니다.";
  });

  el.editBoardBtn.addEventListener("click", function () {
    if (!state.board) {
      el.boardHint.hidden = false;
      el.boardHint.textContent = "수정하려면 먼저 환경판을 생성해주세요.";
      return;
    }
    var w = parseFloat(el.boardWidthInput.value);
    var h = parseFloat(el.boardHeightInput.value);
    if (!(w > 0) || !(h > 0)) {
      el.boardHint.hidden = false;
      el.boardHint.textContent = "가로/세로 값을 0보다 큰 숫자로 입력해주세요.";
      return;
    }
    state.board.name = el.boardNameInput.value.trim();
    state.board.wCm = w;
    state.board.hCm = h;
    state.placedItems.forEach(function (item) {
      item.xCm = clamp(item.xCm, 0, Math.max(w - item.wCm, 0));
      item.yCm = clamp(item.yCm, 0, Math.max(h - item.hCm, 0));
    });
    updateBoardTitle();
    renderAll();
    syncActiveBoardToSavedEntry();
    collabSyncAll();
    el.boardHint.hidden = false;
    el.boardHint.textContent = "환경판 정보가 수정되었습니다.";
  });

  el.deleteBoardBtn.addEventListener("click", function () {
    if (!state.board) return;
    if (!window.confirm("현재 진행 중인 환경판을 삭제하시겠습니까? 저장하지 않은 배치 내용은 사라집니다.")) return;
    resetBoardToEmpty();
    collabSyncAll();
  });

  function activateBoardUI() {
    el.board.classList.remove("board-empty");
    el.boardHint.hidden = true;
    setPanelEnabled(el.customPanel, true);
    setPanelEnabled(el.presetPanel, true);
    el.clearBoardBtn.disabled = false;
    el.saveImageBtn.disabled = false;
    updateBoardTitle();
    renderAll();
  }

  function resetBoardToEmpty() {
    state.board = null;
    state.placedItems = [];
    state.addCascade = 0;
    el.board.classList.add("board-empty");
    el.board.innerHTML = "";
    el.board.appendChild(el.boardPlaceholder);
    el.board.style.width = "";
    el.board.style.height = "";
    el.board.style.backgroundImage = "";
    el.boardInfo.textContent = "";
    el.boardNameInput.value = "";
    setPanelEnabled(el.customPanel, false);
    setPanelEnabled(el.presetPanel, false);
    el.clearBoardBtn.disabled = true;
    el.saveImageBtn.disabled = true;
    el.customGallery.innerHTML = "";
    el.presetGallery.innerHTML = "";
    updateBoardTitle();
    el.boardHint.hidden = false;
    el.boardHint.textContent = "환경판 이름과 가로/세로 크기(cm)를 입력하고 ‘환경판 생성’을 눌러주세요.";
  }

  function updateBoardTitle() {
    var name = state.board && state.board.name ? state.board.name : "";
    el.boardTitle.innerHTML = "";
    var icon = document.createElement("span");
    icon.className = "heading-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "🖼️";
    el.boardTitle.appendChild(icon);
    el.boardTitle.appendChild(document.createTextNode(" 환경판" + (name ? "[" + name + "]" : "")));
  }

  function renderSavedBoardsList() {
    el.savedBoardsList.innerHTML = "";
    state.savedBoards.forEach(function (saved) {
      var wrapper = document.createElement("div");
      wrapper.className = "saved-board-item";

      var nameBtn = document.createElement("button");
      nameBtn.type = "button";
      nameBtn.className = "saved-board-name-btn";
      if (state.board && (state.board.savedId === saved.id || (!state.board.savedId && state.board.name === saved.name))) nameBtn.classList.add("is-current");
      nameBtn.textContent = saved.name + " (" + saved.wCm + "×" + saved.hCm + "cm)";
      nameBtn.addEventListener("click", function () { loadSavedBoard(saved); });
      wrapper.appendChild(nameBtn);

      var delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "saved-board-delete-btn";
      delBtn.title = "완전히 삭제";
      delBtn.textContent = "🗑️";
      delBtn.addEventListener("click", function () {
        if (!window.confirm("“" + saved.name + "” 환경판을 완전히 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.")) return;
        if (FIREBASE_ENABLED && savedBoardsRef) {
          savedBoardsRef.child(saved.id).remove();
        } else {
          state.savedBoards = state.savedBoards.filter(function (b) { return b.id !== saved.id; });
          persistSavedBoards();
          renderSavedBoardsList();
        }
      });
      wrapper.appendChild(delBtn);

      el.savedBoardsList.appendChild(wrapper);
    });
  }

  function loadSavedBoard(saved) {
    state.board = { name: saved.name, wCm: saved.wCm, hCm: saved.hCm, scale: 1, pxW: 0, pxH: 0, savedId: saved.id };
    state.placedItems = JSON.parse(JSON.stringify(saved.placedItems));
    state.addCascade = 0;
    if (migratePlacedItems(state.placedItems, state.board.wCm, state.board.hCm)) {
      syncActiveBoardToSavedEntry();
    }
    el.boardNameInput.value = saved.name;
    el.boardWidthInput.value = saved.wCm;
    el.boardHeightInput.value = saved.hCm;
    activateBoardUI();
    renderSavedBoardsList();
    collabSyncAll();
  }

  function syncActiveBoardToSavedEntry() {
    if (!state.board || !state.board.savedId) return;
    var entry = {
      id: state.board.savedId,
      name: state.board.name,
      wCm: state.board.wCm,
      hCm: state.board.hCm,
      placedItems: JSON.parse(JSON.stringify(state.placedItems))
    };
    if (FIREBASE_ENABLED && savedBoardsRef) {
      savedBoardsRef.child(entry.id).set(entry);
    } else {
      var idx = state.savedBoards.findIndex(function (b) { return b.id === entry.id; });
      if (idx >= 0) {
        state.savedBoards[idx] = entry;
        persistSavedBoards();
        renderSavedBoardsList();
      }
    }
  }

  function setPanelEnabled(panelEl, enabled) {
    panelEl.classList.toggle("is-disabled", !enabled);
    var inputs = panelEl.querySelectorAll("input, button");
    inputs.forEach(function (input) { input.disabled = !enabled; });
  }

  function computeScale() {
    if (!state.board) return;
    var wrapperW = el.boardWrapper.clientWidth || 600;
    var maxW = Math.max(wrapperW - 4, 100);
    var maxH = Math.max(Math.min(window.innerHeight * 0.55, 620), 200);
    var scale = Math.min(maxW / state.board.wCm, maxH / state.board.hCm);
    state.board.scale = scale;
    state.board.pxW = state.board.wCm * scale;
    state.board.pxH = state.board.hCm * scale;
  }

  // ---------- Rendering ----------

  function renderAll() {
    computeScale();
    renderBoard();
    renderCustomGallery();
    renderPresetGallery();
  }

  function renderBoard() {
    if (!state.board) return;
    computeScale();
    var b = state.board;
    el.board.style.width = b.pxW + "px";
    el.board.style.height = b.pxH + "px";
    var gridPx = 10 * b.scale;
    el.board.style.backgroundImage =
      "linear-gradient(to right, rgba(140,150,170,0.15) 1px, transparent 1px), " +
      "linear-gradient(to bottom, rgba(140,150,170,0.15) 1px, transparent 1px)";
    el.board.style.backgroundSize = gridPx + "px " + gridPx + "px";

    el.board.innerHTML = "";
    state.placedItems.forEach(function (item) {
      el.board.appendChild(buildPlacedItemEl(item));
    });
    attachCursorLayer();

    el.boardInfo.textContent = buildBoardInfoText(b);
  }

  function buildBoardInfoText(b) {
    var counts = {};
    PRESETS.forEach(function (p) { counts[p.key] = 0; });
    counts.custom = 0;
    state.placedItems.forEach(function (item) {
      if (item.presetKey && counts.hasOwnProperty(item.presetKey)) counts[item.presetKey]++;
      else counts.custom++;
    });
    var parts = PRESETS.map(function (p) { return p.label + ": " + counts[p.key] + "개"; });
    parts.push("커스텀: " + counts.custom + "개");
    return "환경판 크기: " + b.wCm + " × " + b.hCm + " cm  |  배치된 작품: " + state.placedItems.length + "개 [" + parts.join(" / ") + "]";
  }

  function renderCustomGallery() {
    el.customGallery.innerHTML = "";
    if (!state.board) return;
    state.customTemplates.forEach(function (tpl) {
      el.customGallery.appendChild(buildTemplateItemEl(tpl, { removable: true, addButton: true }));
    });
  }

  function renderPresetGallery() {
    el.presetGallery.innerHTML = "";
    if (!state.board) return;
    state.presetTemplates.forEach(function (tpl) {
      el.presetGallery.appendChild(buildTemplateItemEl(tpl, { removable: false, addButton: true }));
    });
  }

  function sizePx(tpl) {
    var scale = state.board.scale;
    return { w: Math.max(tpl.wCm * scale, 4), h: Math.max(tpl.hCm * scale, 4) };
  }

  function pickFontSizePx(pxW, pxH, lines) {
    var base = Math.min(pxW, pxH);
    var size = lines > 1 ? base * 0.17 : base * 0.32;
    return clamp(size, 7, 13);
  }

  function buildTemplateItemEl(tpl, opts) {
    var wrapper = document.createElement("div");
    wrapper.className = "template-item";
    wrapper.appendChild(buildTemplateCardEl(tpl, opts.removable));

    if (opts.addButton) {
      var addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "add-btn";
      addBtn.textContent = "추가";
      addBtn.title = "환경판 좌측 하단에 추가";
      addBtn.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
      addBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        addTemplateToBoard(tpl);
      });
      wrapper.appendChild(addBtn);
    }

    return wrapper;
  }

  function addTemplateToBoard(tpl) {
    if (!state.board) return;
    var b = state.board;
    var wCm = tpl.wCm, hCm = tpl.hCm;
    var offset = (state.addCascade % 6) * 2.5;
    state.addCascade++;
    var xCm = clamp(offset, 0, Math.max(b.wCm - wCm, 0));
    var yCm = clamp(b.hCm - hCm - offset, 0, Math.max(b.hCm - hCm, 0));
    var newItem = {
      id: uid("item"),
      label: tpl.label,
      presetKey: tpl.isPreset ? tpl.key : null,
      isPreset: !!tpl.isPreset,
      wCm: wCm,
      hCm: hCm,
      xCm: xCm,
      yCm: yCm,
      color: tpl.color,
      rotated: !!tpl.rotated,
      order: nextOrder()
    };
    state.placedItems.push(newItem);
    renderBoard();
    collabPushItem(newItem);
  }

  function buildTemplateCardEl(tpl, removable) {
    var px = sizePx(tpl);
    var card = document.createElement("div");
    card.className = "template-card";
    card.style.width = px.w + "px";
    card.style.height = px.h + "px";
    card.style.background = tpl.color;
    card.dataset.templateId = tpl.id;
    card.title = tpl.label + " (" + tpl.wCm + "×" + tpl.hCm + "cm) - 드래그하여 환경판에 배치, 회전/삭제 버튼은 카드 우측 상단";

    var compact = Math.min(px.w, px.h) < 40;

    var label = document.createElement("div");
    label.className = "card-label";
    label.textContent = tpl.isPreset ? tpl.label : (tpl.label + "\n" + tpl.wCm + "×" + tpl.hCm + "cm");
    label.style.fontSize = pickFontSizePx(px.w, px.h, tpl.isPreset ? 1 : 2) + "px";
    card.appendChild(label);

    var controls = document.createElement("div");
    controls.className = "card-controls";

    var rotateBtn = document.createElement("button");
    rotateBtn.type = "button";
    rotateBtn.className = "card-btn";
    if (compact) {
      var btnSize = Math.max(11, Math.min(px.w, px.h) * 0.42);
      rotateBtn.style.width = btnSize + "px";
      rotateBtn.style.height = btnSize + "px";
      rotateBtn.style.fontSize = Math.max(7, btnSize * 0.55) + "px";
    }
    rotateBtn.title = "90도 회전";
    rotateBtn.textContent = "⟳";
    rotateBtn.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
    rotateBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      var tmp = tpl.wCm; tpl.wCm = tpl.hCm; tpl.hCm = tmp;
      tpl.rotated = !tpl.rotated;
      renderCustomGallery();
      renderPresetGallery();
      if (!tpl.isPreset) collabPushTemplates();
    });
    controls.appendChild(rotateBtn);

    if (removable) {
      var removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "card-btn";
      removeBtn.title = "삭제";
      removeBtn.textContent = "×";
      removeBtn.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
      removeBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        state.customTemplates = state.customTemplates.filter(function (t) { return t.id !== tpl.id; });
        renderCustomGallery();
        collabPushTemplates();
      });
      controls.appendChild(removeBtn);
    }

    card.appendChild(controls);

    if (tpl.url && !compact) {
      var link = document.createElement("a");
      link.className = "card-link";
      link.href = tpl.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "정보";
      link.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
      link.addEventListener("click", function (e) { e.stopPropagation(); });
      card.appendChild(link);
    }

    card.addEventListener("pointerdown", function (e) {
      if (e.target.closest(".card-btn") || e.target.closest(".card-link")) return;
      startTemplateDrag(e, tpl);
    });

    return card;
  }

  function buildPlacedItemEl(item) {
    var scale = state.board.scale;
    var div = document.createElement("div");
    div.className = "placed-item";
    div.style.left = (item.xCm * scale) + "px";
    div.style.top = (item.yCm * scale) + "px";
    div.style.width = (item.wCm * scale) + "px";
    div.style.height = (item.hCm * scale) + "px";
    div.style.background = item.color;
    div.dataset.itemId = item.id;
    div.title = item.label + " (" + round1(item.wCm) + "×" + round1(item.hCm) + "cm) - 드래그하여 이동, 우측 상단 버튼으로 회전/삭제";

    var label = document.createElement("div");
    label.className = "placed-label";
    label.textContent = item.isPreset ? item.label : (item.label + "\n" + round1(item.wCm) + "×" + round1(item.hCm) + "cm");
    label.style.fontSize = pickFontSizePx(item.wCm * scale, item.hCm * scale, item.isPreset ? 1 : 2) + "px";
    div.appendChild(label);

    var toolbar = document.createElement("div");
    toolbar.className = "placed-toolbar";

    var rotateBtn = document.createElement("button");
    rotateBtn.type = "button";
    rotateBtn.className = "card-btn";
    rotateBtn.title = "90도 회전";
    rotateBtn.textContent = "⟳";
    rotateBtn.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
    rotateBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      rotatePlacedItem(item);
    });
    toolbar.appendChild(rotateBtn);

    var removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "card-btn";
    removeBtn.title = "삭제";
    removeBtn.textContent = "×";
    removeBtn.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
    removeBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      state.placedItems = state.placedItems.filter(function (t) { return t.id !== item.id; });
      renderBoard();
      collabRemoveItem(item.id);
    });
    toolbar.appendChild(removeBtn);

    div.appendChild(toolbar);

    div.addEventListener("pointerdown", function (e) { startPlacedItemDrag(e, item, div); });

    return div;
  }

  function rotatePlacedItem(item) {
    var b = state.board;
    var centerXCm = item.xCm + item.wCm / 2;
    var centerYCm = item.yCm + item.hCm / 2;
    var tmp = item.wCm; item.wCm = item.hCm; item.hCm = tmp;
    item.rotated = !item.rotated;
    item.xCm = clamp(centerXCm - item.wCm / 2, 0, Math.max(b.wCm - item.wCm, 0));
    item.yCm = clamp(centerYCm - item.hCm / 2, 0, Math.max(b.hCm - item.hCm, 0));
    renderBoard();
    collabPushItem(item);
  }

  // ---------- Custom artwork generation ----------

  el.addCustomBtn.addEventListener("click", function () {
    if (!state.board) return;
    var w = parseFloat(el.customWidthInput.value);
    var h = parseFloat(el.customHeightInput.value);
    if (!(w > 0) || !(h > 0)) return;
    var name = el.customNameInput.value.trim();
    var color = CUSTOM_COLORS[state.customTemplates.length % CUSTOM_COLORS.length];
    state.customTemplates.push({
      id: uid("custom"),
      label: name || "커스텀",
      wCm: round1(w),
      hCm: round1(h),
      color: color,
      rotated: false,
      order: nextOrder()
    });
    el.customNameInput.value = "";
    el.customWidthInput.value = "";
    el.customHeightInput.value = "";
    renderCustomGallery();
    collabPushTemplates();
  });

  // ---------- Save board as image ----------

  el.saveImageBtn.addEventListener("click", function () {
    if (!state.board || typeof window.html2canvas !== "function") return;
    var fileName = (state.board.name ? state.board.name : "환경판") + ".png";
    window.html2canvas(el.board, {
      backgroundColor: "#fbfbfc",
      scale: 2,
      ignoreElements: function (node) { return node.classList && node.classList.contains("collab-cursor-layer"); }
    }).then(function (canvas) {
      var link = document.createElement("a");
      link.download = fileName;
      link.href = canvas.toDataURL("image/png");
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    });
  });

  // ---------- Drag: template -> board (duplicate on drag) ----------

  function startTemplateDrag(e, tpl) {
    e.preventDefault();
    var ghostW, ghostH;
    if (state.board) {
      var px = sizePx(tpl);
      ghostW = px.w;
      ghostH = px.h;
    } else {
      ghostW = 60; ghostH = 60;
    }

    var ghost = el.dragGhost;
    ghost.style.width = ghostW + "px";
    ghost.style.height = ghostH + "px";
    ghost.style.background = tpl.color;
    ghost.textContent = tpl.label;
    ghost.style.display = "flex";
    positionGhost(e.clientX, e.clientY, ghostW, ghostH);

    function onMove(ev) {
      positionGhost(ev.clientX, ev.clientY, ghostW, ghostH);
    }

    function onUp(ev) {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      ghost.style.display = "none";

      if (!state.board) return;
      var boardRect = el.board.getBoundingClientRect();
      var dropX = ev.clientX - boardRect.left - ghostW / 2;
      var dropY = ev.clientY - boardRect.top - ghostH / 2;
      var overBoard = ev.clientX >= boardRect.left && ev.clientX <= boardRect.right &&
        ev.clientY >= boardRect.top && ev.clientY <= boardRect.bottom;
      if (!overBoard) return;

      var scale = state.board.scale;
      var wCm = tpl.wCm, hCm = tpl.hCm;
      var xCm = clamp(dropX / scale, 0, Math.max(state.board.wCm - wCm, 0));
      var yCm = clamp(dropY / scale, 0, Math.max(state.board.hCm - hCm, 0));

      var droppedItem = {
        id: uid("item"),
        label: tpl.label,
        presetKey: tpl.isPreset ? tpl.key : null,
        isPreset: !!tpl.isPreset,
        wCm: wCm,
        hCm: hCm,
        xCm: xCm,
        yCm: yCm,
        color: tpl.color,
        rotated: !!tpl.rotated,
        order: nextOrder()
      };
      state.placedItems.push(droppedItem);
      renderBoard();
      collabPushItem(droppedItem);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function positionGhost(clientX, clientY, w, h) {
    el.dragGhost.style.left = (clientX - w / 2) + "px";
    el.dragGhost.style.top = (clientY - h / 2) + "px";
  }

  // ---------- Drag: reposition placed item within board ----------

  function startPlacedItemDrag(e, item, itemEl) {
    if (e.target.closest(".card-btn")) return;
    e.preventDefault();
    var b = state.board;
    var startClientX = e.clientX, startClientY = e.clientY;
    var startXCm = item.xCm, startYCm = item.yCm;

    itemEl.setPointerCapture(e.pointerId);
    collab.draggingId = item.id;

    function onMove(ev) {
      var dxCm = (ev.clientX - startClientX) / b.scale;
      var dyCm = (ev.clientY - startClientY) / b.scale;
      item.xCm = clamp(startXCm + dxCm, 0, Math.max(b.wCm - item.wCm, 0));
      item.yCm = clamp(startYCm + dyCm, 0, Math.max(b.hCm - item.hCm, 0));
      itemEl.style.left = (item.xCm * b.scale) + "px";
      itemEl.style.top = (item.yCm * b.scale) + "px";
      collabPushItemThrottled(item);
    }

    function onUp(ev) {
      itemEl.removeEventListener("pointermove", onMove);
      itemEl.removeEventListener("pointerup", onUp);
      itemEl.removeEventListener("pointercancel", onUp);
      try { itemEl.releasePointerCapture(ev.pointerId); } catch (err) {}
      collab.draggingId = null;
      if (collab.active && state.placedItems.indexOf(item) !== -1) {
        collabPushItem(item);
        renderBoard(); // pick up any remote changes that were only patched during the drag
      }
    }

    itemEl.addEventListener("pointermove", onMove);
    itemEl.addEventListener("pointerup", onUp);
    itemEl.addEventListener("pointercancel", onUp);
  }

  // ---------- Resize handling ----------

  var resizeTimer = null;
  window.addEventListener("resize", function () {
    if (resizeTimer) cancelAnimationFrame(resizeTimer);
    resizeTimer = requestAnimationFrame(function () {
      if (state.board) renderAll();
    });
  });

  // ---------- Cloud sync (Firebase Realtime Database) ----------

  function initCloudSync() {
    if (!FIREBASE_ENABLED) return;
    try {
      firebase.initializeApp(FIREBASE_CONFIG);
      savedBoardsRef = firebase.database().ref("savedBoards");
      savedBoardsRef.on("value", function (snapshot) {
        var val = snapshot.val() || {};
        state.savedBoards = Object.keys(val).map(function (id) {
          var b = val[id] || {};
          return {
            id: id,
            name: b.name || "",
            wCm: b.wCm,
            hCm: b.hCm,
            placedItems: Array.isArray(b.placedItems) ? b.placedItems : []
          };
        });
        state.savedBoards.forEach(function (saved) {
          if (migratePlacedItems(saved.placedItems, saved.wCm, saved.hCm)) {
            savedBoardsRef.child(saved.id).set(saved);
          }
        });
        persistSavedBoards();
        renderSavedBoardsList();
      });
    } catch (err) {
      FIREBASE_ENABLED = false;
    }
  }

  // ---------- Collaboration room (Firebase Realtime Database, rooms/{code}) ----------
  // Room layout: meta, board {name,wCm,hCm,savedId}, items {id: placedItem},
  // templates {id: customTemplate}, members {clientId: {name,color}}, cursors {clientId: {x,y}}.

  var ROOM_CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  var NICKNAME_KEY = "hallway-sim-nickname";
  var MEMBER_COLORS = ["#e2553d", "#2f9e6e", "#3d6ee0", "#d1487a", "#c98a3e", "#8a5cb5", "#2ba7a0", "#5a6b8c"];
  var SEND_INTERVAL_MS = 70;

  var collabEl = {
    toggle: document.getElementById("collabToggle"),
    infoBtn: document.getElementById("collabInfoBtn"),
    infoText: document.getElementById("collabInfoText"),
    panel: document.getElementById("collabPanel"),
    panelCloseBtn: document.getElementById("collabPanelCloseBtn"),
    codeText: document.getElementById("collabCodeText"),
    copyLinkBtn: document.getElementById("collabCopyLinkBtn"),
    copyCodeBtn: document.getElementById("collabCopyCodeBtn"),
    memberCount: document.getElementById("collabMemberCount"),
    members: document.getElementById("collabMembers"),
    status: document.getElementById("collabStatus"),
    modal: document.getElementById("collabModal"),
    nameInput: document.getElementById("collabNameInput"),
    codeInput: document.getElementById("collabCodeInput"),
    tabs: Array.prototype.slice.call(document.querySelectorAll(".collab-tab")),
    modes: Array.prototype.slice.call(document.querySelectorAll(".collab-mode")),
    error: document.getElementById("collabError"),
    cancelBtn: document.getElementById("collabCancelBtn"),
    submitBtn: document.getElementById("collabSubmitBtn")
  };

  function cleanForDb(value) {
    // Firebase rejects undefined values; a JSON round trip drops them.
    return JSON.parse(JSON.stringify(value));
  }

  function nextOrder() { return Date.now() + Math.random(); }

  function randomRoomCode() {
    var code = "";
    for (var i = 0; i < 6; i++) code += ROOM_CODE_CHARS.charAt(Math.floor(Math.random() * ROOM_CODE_CHARS.length));
    return code;
  }

  function normalizeRoomCode(raw) {
    return String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  }

  function memberColorFor(id) {
    var h = 0;
    for (var i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return MEMBER_COLORS[h % MEMBER_COLORS.length];
  }

  function serializeBoard() {
    if (!state.board) return null;
    return { name: state.board.name || "", wCm: state.board.wCm, hCm: state.board.hCm, savedId: state.board.savedId || null };
  }

  function itemsToMap(items) {
    var map = {};
    items.forEach(function (item, i) {
      if (item.order == null) item.order = i;
      map[item.id] = cleanForDb(item);
    });
    return map;
  }

  function templatesToMap() {
    return itemsToMap(state.customTemplates);
  }

  function roomChild(path) { return collab.roomRef.child(path); }

  // Called after local edits that replace the whole board (new/edit/load/clear/delete).
  function collabSyncAll() {
    if (!collab.active) return;
    // One multi-path update so others never see the new board with the old items.
    collab.roomRef.update({
      board: cleanForDb(serializeBoard()),
      items: state.board ? itemsToMap(state.placedItems) : null
    });
  }

  function collabSyncBoardMeta() {
    if (!collab.active) return;
    roomChild("board").set(cleanForDb(serializeBoard()));
  }

  function collabPushItem(item) {
    if (!collab.active) return;
    if (item.order == null) item.order = nextOrder();
    roomChild("items/" + item.id).set(cleanForDb(item));
  }

  function collabRemoveItem(id) {
    if (!collab.active) return;
    roomChild("items/" + id).remove();
  }

  function collabPushTemplates() {
    if (!collab.active) return;
    roomChild("templates").set(templatesToMap());
  }

  // Throttled position updates while an item is being dragged.
  var dragSendTimer = null;
  function collabPushItemThrottled(item) {
    if (!collab.active || dragSendTimer) return;
    collabPushItem(item);
    dragSendTimer = setTimeout(function () {
      dragSendTimer = null;
      if (collab.draggingId === item.id) collabPushItem(item);
    }, SEND_INTERVAL_MS);
  }

  // ---------- Applying remote changes ----------

  function normalizeItem(id, r) {
    return {
      id: id,
      label: r.label || "",
      presetKey: r.presetKey || null,
      isPreset: !!r.isPreset,
      wCm: Number(r.wCm) || 1,
      hCm: Number(r.hCm) || 1,
      xCm: Number(r.xCm) || 0,
      yCm: Number(r.yCm) || 0,
      color: r.color || "#8b93a3",
      rotated: !!r.rotated,
      order: Number(r.order) || 0
    };
  }

  function applyRemoteBoard(val) {
    if (!val || !(val.wCm > 0) || !(val.hCm > 0)) {
      if (state.board) resetBoardToEmpty();
      return;
    }
    var wasEmpty = !state.board;
    if (wasEmpty) state.board = { scale: 1, pxW: 0, pxH: 0 };
    state.board.name = val.name || "";
    state.board.wCm = Number(val.wCm);
    state.board.hCm = Number(val.hCm);
    state.board.savedId = val.savedId || null;
    el.boardNameInput.value = state.board.name;
    el.boardWidthInput.value = state.board.wCm;
    el.boardHeightInput.value = state.board.hCm;
    if (wasEmpty) {
      activateBoardUI();
    } else {
      updateBoardTitle();
      renderAll();
    }
    renderSavedBoardsList();
  }

  function applyRemoteItems(val) {
    var map = val || {};
    var localById = {};
    state.placedItems.forEach(function (item) { localById[item.id] = item; });
    var next = Object.keys(map).map(function (id) {
      var remote = normalizeItem(id, map[id] || {});
      var local = localById[id];
      if (!local) return remote;
      if (collab.draggingId === id) {
        remote.xCm = local.xCm;
        remote.yCm = local.yCm;
      }
      // Mutate in place: placed-item DOM handlers close over these objects.
      Object.keys(remote).forEach(function (k) { local[k] = remote[k]; });
      return local;
    });
    next.sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
    state.placedItems = next;
    if (!state.board) return;
    if (collab.draggingId) patchBoardItems();
    else renderBoard();
  }

  // Updates item positions without rebuilding the item being dragged (rebuilding
  // it would break the local pointer capture).
  function patchBoardItems() {
    var scale = state.board.scale;
    var existing = {};
    el.board.querySelectorAll(".placed-item").forEach(function (d) { existing[d.dataset.itemId] = d; });
    state.placedItems.forEach(function (item) {
      var d = existing[item.id];
      if (d) {
        delete existing[item.id];
        if (item.id === collab.draggingId) return;
        d.style.left = (item.xCm * scale) + "px";
        d.style.top = (item.yCm * scale) + "px";
        d.style.width = (item.wCm * scale) + "px";
        d.style.height = (item.hCm * scale) + "px";
      } else {
        el.board.insertBefore(buildPlacedItemEl(item), collab.cursorLayer.parentNode === el.board ? collab.cursorLayer : null);
      }
    });
    Object.keys(existing).forEach(function (id) { existing[id].remove(); });
    el.boardInfo.textContent = buildBoardInfoText(state.board);
  }

  function applyRemoteTemplates(val) {
    var map = val || {};
    state.customTemplates = Object.keys(map).map(function (id) {
      var r = map[id] || {};
      return {
        id: id,
        label: r.label || "커스텀",
        wCm: Number(r.wCm) || 1,
        hCm: Number(r.hCm) || 1,
        color: r.color || CUSTOM_COLORS[0],
        rotated: !!r.rotated,
        order: Number(r.order) || 0
      };
    }).sort(function (a, b) { return a.order - b.order; });
    renderCustomGallery();
  }

  // ---------- Cursors ----------

  var CURSOR_SVG = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1 1 L1 13 L4.5 9.8 L7 15 L9.2 14 L6.8 8.9 L11.5 8.9 Z" fill="currentColor" stroke="#fff" stroke-width="1.2" stroke-linejoin="round"/></svg>';

  function renderCursors() {
    var layer = collab.cursorLayer;
    layer.innerHTML = "";
    if (!collab.active || !state.board) return;
    var scale = state.board.scale;
    Object.keys(collab.cursors).forEach(function (cid) {
      if (cid === collab.clientId) return;
      var c = collab.cursors[cid];
      var m = collab.members[cid];
      if (!c || !m) return;
      var color = m.color || memberColorFor(cid);
      var div = document.createElement("div");
      div.className = "collab-cursor";
      div.style.left = (Number(c.x) * scale) + "px";
      div.style.top = (Number(c.y) * scale) + "px";
      div.style.color = color;
      div.innerHTML = CURSOR_SVG;
      var tag = document.createElement("span");
      tag.className = "collab-cursor-name";
      tag.style.background = color;
      tag.textContent = m.name || "참여자";
      div.appendChild(tag);
      layer.appendChild(div);
    });
  }

  function attachCursorLayer() {
    if (collab.active && state.board) {
      el.board.appendChild(collab.cursorLayer);
      renderCursors();
    }
  }

  var cursorTimer = null;
  var pendingCursor;
  var lastSentCursor = null;

  function sendCursor(pos) {
    pendingCursor = pos;
    if (cursorTimer) return;
    flushCursor();
    cursorTimer = setTimeout(function () {
      cursorTimer = null;
      if (pendingCursor !== lastSentCursor) flushCursor();
    }, SEND_INTERVAL_MS);
  }

  function flushCursor() {
    if (!collab.active) return;
    lastSentCursor = pendingCursor;
    roomChild("cursors/" + collab.clientId).set(pendingCursor);
  }

  window.addEventListener("pointermove", function (e) {
    if (!collab.active || !state.board) return;
    var rect = el.board.getBoundingClientRect();
    var inside = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
    if (inside) {
      var s = state.board.scale;
      sendCursor({ x: round1((e.clientX - rect.left) / s), y: round1((e.clientY - rect.top) / s) });
    } else if (lastSentCursor !== null || pendingCursor !== null) {
      sendCursor(null);
    }
  });

  // ---------- Room panel UI ----------

  function renderMembers() {
    var ids = Object.keys(collab.members).sort(function (a, b) {
      return (collab.members[a].joinedAt || 0) - (collab.members[b].joinedAt || 0);
    });
    collabEl.members.innerHTML = "";
    ids.forEach(function (id) {
      var m = collab.members[id] || {};
      var li = document.createElement("li");
      var dot = document.createElement("span");
      dot.className = "collab-member-dot";
      dot.style.background = m.color || memberColorFor(id);
      li.appendChild(dot);
      li.appendChild(document.createTextNode(m.name || "참여자"));
      if (id === collab.clientId) {
        var me = document.createElement("span");
        me.className = "collab-member-me";
        me.textContent = "(나)";
        li.appendChild(me);
      }
      collabEl.members.appendChild(li);
    });
    collabEl.memberCount.textContent = ids.length + "명";
    collabEl.infoText.textContent = collab.code + " · " + ids.length + "명";
  }

  function setPanelOpen(open) {
    collabEl.panel.hidden = !open;
    collabEl.infoBtn.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function renderCollabUI() {
    collabEl.toggle.setAttribute("aria-checked", collab.active ? "true" : "false");
    collabEl.infoBtn.hidden = !collab.active;
    if (!collab.active) {
      setPanelOpen(false);
      return;
    }
    collabEl.codeText.textContent = collab.code;
    renderMembers();
  }

  var statusTimer = null;
  function showCollabStatus(msg) {
    collabEl.status.textContent = msg;
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(function () { collabEl.status.textContent = ""; }, 2500);
  }

  function inviteLink() {
    var url = new URL(window.location.href);
    url.search = "";
    url.hash = "";
    url.searchParams.set("room", collab.code);
    return url.toString();
  }

  function copyText(text, okMsg) {
    function fallback() {
      window.prompt("아래 내용을 복사해주세요.", text);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { showCollabStatus(okMsg); }, fallback);
    } else {
      fallback();
    }
  }

  function setUrlRoom(code) {
    try {
      var url = new URL(window.location.href);
      if (code) url.searchParams.set("room", code);
      else url.searchParams.delete("room");
      window.history.replaceState(null, "", url.toString());
    } catch (err) {}
  }

  // ---------- Join / create / leave ----------

  function describeDbError(err) {
    var msg = err && (err.code || err.message) ? String(err.code || err.message) : "";
    if (/permission/i.test(msg)) {
      return "Firebase 데이터베이스 규칙이 협업 방(rooms) 저장을 허용하지 않습니다. Firebase 콘솔의 Realtime Database 규칙에 rooms 경로 읽기/쓰기 권한을 추가해주세요.";
    }
    return "연결하지 못했습니다. 인터넷 연결을 확인하고 다시 시도해주세요.";
  }

  function withTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(new Error("timeout")); }, ms);
      promise.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
    });
  }

  function createRoom(attempt) {
    var db = firebase.database();
    var code = randomRoomCode();
    var ref = db.ref("rooms/" + code);
    return withTimeout(ref.child("meta").once("value"), 10000).then(function (snap) {
      if (snap.exists()) {
        if ((attempt || 0) > 4) throw new Error("no free room code");
        return createRoom((attempt || 0) + 1);
      }
      var data = {
        meta: { createdAt: Date.now() },
        board: serializeBoard(),
        items: state.board ? itemsToMap(state.placedItems) : null,
        templates: templatesToMap()
      };
      return withTimeout(ref.set(cleanForDb(data)), 10000).then(function () { return code; });
    });
  }

  function checkRoomExists(code) {
    var ref = firebase.database().ref("rooms/" + code + "/meta");
    return withTimeout(ref.once("value"), 10000).then(function (snap) { return snap.exists(); });
  }

  function enterRoom(code, name) {
    var db = firebase.database();
    collab.active = true;
    collab.code = code;
    collab.name = name;
    collab.color = memberColorFor(collab.clientId);
    collab.members = {};
    collab.cursors = {};
    collab.roomRef = db.ref("rooms/" + code);

    var memberRef = roomChild("members/" + collab.clientId);
    memberRef.onDisconnect().remove();
    roomChild("cursors/" + collab.clientId).onDisconnect().remove();
    memberRef.set({ name: name, color: collab.color, joinedAt: Date.now() });

    roomChild("board").on("value", function (snap) { applyRemoteBoard(snap.val()); });
    roomChild("items").on("value", function (snap) { applyRemoteItems(snap.val()); });
    roomChild("templates").on("value", function (snap) { applyRemoteTemplates(snap.val()); });
    roomChild("members").on("value", function (snap) {
      collab.members = snap.val() || {};
      // Re-announce ourselves if our entry was dropped (e.g. after a reconnect).
      if (collab.active && !collab.members[collab.clientId]) {
        memberRef.set({ name: name, color: collab.color, joinedAt: Date.now() });
        memberRef.onDisconnect().remove();
      }
      renderMembers();
      renderCursors();
    });
    roomChild("cursors").on("value", function (snap) {
      collab.cursors = snap.val() || {};
      renderCursors();
    });

    setUrlRoom(code);
    renderCollabUI();
    setPanelOpen(true);
    attachCursorLayer();
  }

  function leaveRoom() {
    if (!collab.active) return;
    ["board", "items", "templates", "members", "cursors"].forEach(function (k) { roomChild(k).off(); });
    roomChild("members/" + collab.clientId).remove();
    roomChild("cursors/" + collab.clientId).remove();
    roomChild("members/" + collab.clientId).onDisconnect().cancel();
    roomChild("cursors/" + collab.clientId).onDisconnect().cancel();
    collab.active = false;
    collab.code = null;
    collab.roomRef = null;
    collab.members = {};
    collab.cursors = {};
    collab.draggingId = null;
    lastSentCursor = null;
    pendingCursor = undefined;
    collab.cursorLayer.innerHTML = "";
    if (collab.cursorLayer.parentNode) collab.cursorLayer.parentNode.removeChild(collab.cursorLayer);
    setUrlRoom(null);
    renderCollabUI();
  }

  // ---------- Modal ----------

  var modalMode = "create";

  function setModalMode(mode) {
    modalMode = mode;
    collabEl.tabs.forEach(function (t) {
      var on = t.dataset.mode === mode;
      t.classList.toggle("is-active", on);
      t.setAttribute("aria-selected", on ? "true" : "false");
    });
    collabEl.modes.forEach(function (m) { m.hidden = m.dataset.mode !== mode; });
    collabEl.submitBtn.textContent = mode === "create" ? "방 만들기" : "참여하기";
    showModalError("");
  }

  function showModalError(msg) {
    collabEl.error.textContent = msg;
    collabEl.error.hidden = !msg;
  }

  function openCollabModal(mode, code) {
    var saved = "";
    try { saved = window.localStorage.getItem(NICKNAME_KEY) || ""; } catch (err) {}
    collabEl.nameInput.value = saved;
    collabEl.codeInput.value = code || "";
    setModalMode(mode);
    setModalBusy(false);
    collabEl.modal.hidden = false;
    collabEl.toggle.setAttribute("aria-checked", "true");
    (collabEl.nameInput.value ? (mode === "join" && !code ? collabEl.codeInput : collabEl.submitBtn) : collabEl.nameInput).focus();
  }

  function closeCollabModal() {
    collabEl.modal.hidden = true;
    renderCollabUI();
  }

  function setModalBusy(busy) {
    collabEl.submitBtn.disabled = busy;
    collabEl.cancelBtn.disabled = busy;
    collabEl.submitBtn.textContent = busy ? "연결 중…" : (modalMode === "create" ? "방 만들기" : "참여하기");
  }

  function submitCollabModal() {
    var name = collabEl.nameInput.value.trim();
    if (!name) {
      showModalError("이름을 입력해주세요.");
      collabEl.nameInput.focus();
      return;
    }
    try { window.localStorage.setItem(NICKNAME_KEY, name); } catch (err) {}

    if (modalMode === "join") {
      var code = normalizeRoomCode(collabEl.codeInput.value);
      collabEl.codeInput.value = code;
      if (code.length !== 6) {
        showModalError("6자리 방 코드를 입력해주세요.");
        collabEl.codeInput.focus();
        return;
      }
      setModalBusy(true);
      checkRoomExists(code).then(function (exists) {
        if (!exists) {
          setModalBusy(false);
          showModalError("‘" + code + "’ 방을 찾을 수 없습니다. 방 코드를 다시 확인해주세요.");
          return;
        }
        collabEl.modal.hidden = true;
        enterRoom(code, name);
        showCollabStatus("협업 방에 참여했습니다.");
      }, function (err) {
        setModalBusy(false);
        showModalError(describeDbError(err));
      });
      return;
    }

    setModalBusy(true);
    createRoom(0).then(function (code) {
      collabEl.modal.hidden = true;
      enterRoom(code, name);
      showCollabStatus("협업 방을 만들었습니다. 초대 링크를 공유해주세요.");
    }, function (err) {
      setModalBusy(false);
      showModalError(describeDbError(err));
    });
  }

  collabEl.toggle.addEventListener("click", function () {
    if (collab.active) {
      if (!window.confirm("협업 방에서 나갈까요? 지금 환경판은 이 화면에 그대로 남습니다.")) return;
      leaveRoom();
      return;
    }
    if (!FIREBASE_ENABLED) {
      window.alert("협업 기능을 쓰려면 인터넷 연결(Firebase)이 필요합니다.");
      return;
    }
    openCollabModal("create");
  });

  collabEl.infoBtn.addEventListener("click", function () { setPanelOpen(collabEl.panel.hidden); });
  collabEl.panelCloseBtn.addEventListener("click", function () { setPanelOpen(false); });
  collabEl.copyLinkBtn.addEventListener("click", function () { copyText(inviteLink(), "초대 링크를 복사했습니다."); });
  collabEl.copyCodeBtn.addEventListener("click", function () { copyText(collab.code, "방 코드를 복사했습니다."); });
  collabEl.tabs.forEach(function (t) {
    t.addEventListener("click", function () { setModalMode(t.dataset.mode); });
  });
  collabEl.cancelBtn.addEventListener("click", closeCollabModal);
  collabEl.submitBtn.addEventListener("click", submitCollabModal);
  collabEl.modal.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !collabEl.cancelBtn.disabled) closeCollabModal();
    if (e.key === "Enter" && e.target.tagName === "INPUT") submitCollabModal();
  });
  collabEl.modal.addEventListener("click", function (e) {
    if (e.target === collabEl.modal && !collabEl.cancelBtn.disabled) closeCollabModal();
  });
  collabEl.codeInput.addEventListener("input", function () {
    var v = normalizeRoomCode(collabEl.codeInput.value);
    if (v !== collabEl.codeInput.value) collabEl.codeInput.value = v;
  });

  function openRoomFromUrl() {
    var code = "";
    try { code = normalizeRoomCode(new URL(window.location.href).searchParams.get("room")); } catch (err) {}
    if (code.length === 6 && FIREBASE_ENABLED) openCollabModal("join", code);
  }

  // ---------- Init ----------

  (function migrateLocalSavedBoardsOnLoad() {
    var anyChanged = false;
    state.savedBoards.forEach(function (saved) {
      if (migratePlacedItems(saved.placedItems, saved.wCm, saved.hCm)) anyChanged = true;
    });
    if (anyChanged) persistSavedBoards();
  })();

  renderSavedBoardsList();
  initCloudSync();
  openRoomFromUrl();
})();
