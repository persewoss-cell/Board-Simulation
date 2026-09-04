(function () {
  "use strict";

  var IN_TO_CM = 2.54;
  var STORAGE_KEY = "hallway-sim-saved-boards-v1";

  var PRESETS = [
    { key: "4x6", label: "4×6", wCm: round1(4 * IN_TO_CM), hCm: round1(6 * IN_TO_CM), color: "#e2725b", url: "https://galleryunsu.co.kr/product/list.html?cate_no=70" },
    { key: "5x7", label: "5×7", wCm: round1(5 * IN_TO_CM), hCm: round1(7 * IN_TO_CM), color: "#4f9d69", url: "https://galleryunsu.co.kr/product/list.html?cate_no=71" },
    { key: "a4", label: "A4", wCm: 21.0, hCm: 29.7, color: "#c98a3e", url: "https://galleryunsu.co.kr/product/list.html?cate_no=73" },
    { key: "8jeol", label: "8절", wCm: 27.3, hCm: 39.4, color: "#d1487a", url: "https://galleryunsu.co.kr/product/list.html?cate_no=94" },
    { key: "a3", label: "A3", wCm: 29.7, hCm: 42.0, color: "#8a5cb5", url: "https://galleryunsu.co.kr/product/list.html?cate_no=74" }
  ];

  var CUSTOM_COLORS = ["#3d6ee0", "#2ba7a0", "#e0a83d", "#8a5cb5", "#c9556f", "#5a9c4c", "#3d8fe0", "#e07d3d"];

  function round1(n) { return Math.round(n * 10) / 10; }
  function clamp(v, min, max) { return Math.min(Math.max(v, min), max); }
  function uid(prefix) { return prefix + "-" + Math.random().toString(36).slice(2, 9); }

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

  var el = {
    boardNameInput: document.getElementById("boardNameInput"),
    boardWidthInput: document.getElementById("boardWidthInput"),
    boardHeightInput: document.getElementById("boardHeightInput"),
    applyBoardBtn: document.getElementById("applyBoardBtn"),
    saveBoardBtn: document.getElementById("saveBoardBtn"),
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
    state.board = { name: el.boardNameInput.value.trim(), wCm: w, hCm: h, scale: 1, pxW: 0, pxH: 0 };
    state.placedItems = [];
    state.addCascade = 0;
    activateBoardUI();
  });

  el.saveBoardBtn.addEventListener("click", function () {
    if (!state.board) return;
    var name = state.board.name;
    if (!name) {
      el.boardHint.hidden = false;
      el.boardHint.textContent = "저장하려면 환경판 이름을 입력해주세요.";
      return;
    }
    var entry = {
      id: uid("saved"),
      name: name,
      wCm: state.board.wCm,
      hCm: state.board.hCm,
      placedItems: JSON.parse(JSON.stringify(state.placedItems))
    };
    var existingIndex = state.savedBoards.findIndex(function (b) { return b.name === name; });
    if (existingIndex >= 0) {
      entry.id = state.savedBoards[existingIndex].id;
      state.savedBoards[existingIndex] = entry;
    } else {
      state.savedBoards.push(entry);
    }
    persistSavedBoards();
    renderSavedBoardsList();
    el.boardHint.hidden = false;
    el.boardHint.textContent = "“" + name + "” 환경판이 저장되었습니다.";
  });

  el.deleteBoardBtn.addEventListener("click", function () {
    if (!state.board) return;
    if (!window.confirm("현재 진행 중인 환경판을 삭제하시겠습니까? 저장하지 않은 배치 내용은 사라집니다.")) return;
    resetBoardToEmpty();
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
      if (state.board && state.board.name === saved.name) nameBtn.classList.add("is-current");
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
        state.savedBoards = state.savedBoards.filter(function (b) { return b.id !== saved.id; });
        persistSavedBoards();
        renderSavedBoardsList();
      });
      wrapper.appendChild(delBtn);

      el.savedBoardsList.appendChild(wrapper);
    });
  }

  function loadSavedBoard(saved) {
    state.board = { name: saved.name, wCm: saved.wCm, hCm: saved.hCm, scale: 1, pxW: 0, pxH: 0 };
    state.placedItems = JSON.parse(JSON.stringify(saved.placedItems));
    state.addCascade = 0;
    el.boardNameInput.value = saved.name;
    el.boardWidthInput.value = saved.wCm;
    el.boardHeightInput.value = saved.hCm;
    activateBoardUI();
    renderSavedBoardsList();
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
    state.placedItems.push({
      id: uid("item"),
      label: tpl.label,
      presetKey: tpl.isPreset ? tpl.key : null,
      isPreset: !!tpl.isPreset,
      wCm: wCm,
      hCm: hCm,
      xCm: xCm,
      yCm: yCm,
      color: tpl.color,
      rotated: tpl.rotated
    });
    renderBoard();
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
  }

  // ---------- Custom artwork generation ----------

  el.addCustomBtn.addEventListener("click", function () {
    if (!state.board) return;
    var w = parseFloat(el.customWidthInput.value);
    var h = parseFloat(el.customHeightInput.value);
    if (!(w > 0) || !(h > 0)) return;
    var color = CUSTOM_COLORS[state.customTemplates.length % CUSTOM_COLORS.length];
    state.customTemplates.push({
      id: uid("custom"),
      label: "커스텀",
      wCm: round1(w),
      hCm: round1(h),
      color: color,
      rotated: false
    });
    el.customWidthInput.value = "";
    el.customHeightInput.value = "";
    renderCustomGallery();
  });

  // ---------- Save board as image ----------

  el.saveImageBtn.addEventListener("click", function () {
    if (!state.board || typeof window.html2canvas !== "function") return;
    var fileName = (state.board.name ? state.board.name : "환경판") + ".png";
    window.html2canvas(el.board, { backgroundColor: "#fbfbfc", scale: 2 }).then(function (canvas) {
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

      state.placedItems.push({
        id: uid("item"),
        label: tpl.label,
        presetKey: tpl.isPreset ? tpl.key : null,
        isPreset: !!tpl.isPreset,
        wCm: wCm,
        hCm: hCm,
        xCm: xCm,
        yCm: yCm,
        color: tpl.color,
        rotated: tpl.rotated
      });
      renderBoard();
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

    function onMove(ev) {
      var dxCm = (ev.clientX - startClientX) / b.scale;
      var dyCm = (ev.clientY - startClientY) / b.scale;
      item.xCm = clamp(startXCm + dxCm, 0, Math.max(b.wCm - item.wCm, 0));
      item.yCm = clamp(startYCm + dyCm, 0, Math.max(b.hCm - item.hCm, 0));
      itemEl.style.left = (item.xCm * b.scale) + "px";
      itemEl.style.top = (item.yCm * b.scale) + "px";
    }

    function onUp(ev) {
      itemEl.removeEventListener("pointermove", onMove);
      itemEl.removeEventListener("pointerup", onUp);
      try { itemEl.releasePointerCapture(ev.pointerId); } catch (err) {}
    }

    itemEl.addEventListener("pointermove", onMove);
    itemEl.addEventListener("pointerup", onUp);
  }

  // ---------- Resize handling ----------

  var resizeTimer = null;
  window.addEventListener("resize", function () {
    if (resizeTimer) cancelAnimationFrame(resizeTimer);
    resizeTimer = requestAnimationFrame(function () {
      if (state.board) renderAll();
    });
  });

  // ---------- Init ----------

  renderSavedBoardsList();
})();
