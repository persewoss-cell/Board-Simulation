(function () {
  "use strict";

  var IN_TO_CM = 2.54;

  var PRESETS = [
    { key: "4x6", label: "4×6inch", wCm: round1(4 * IN_TO_CM), hCm: round1(6 * IN_TO_CM), color: "#e2725b", url: "https://galleryunsu.co.kr/product/list.html?cate_no=70" },
    { key: "5x7", label: "5×7inch", wCm: round1(5 * IN_TO_CM), hCm: round1(7 * IN_TO_CM), color: "#4f9d69", url: "https://galleryunsu.co.kr/product/list.html?cate_no=71" },
    { key: "a5", label: "A5 (6×8inch)", wCm: round1(6 * IN_TO_CM), hCm: round1(8 * IN_TO_CM), color: "#4a7fbf", url: "https://galleryunsu.co.kr/product/list.html?cate_no=72" },
    { key: "a4", label: "A4", wCm: 21.0, hCm: 29.7, color: "#c98a3e", url: "https://galleryunsu.co.kr/product/list.html?cate_no=73" },
    { key: "a3", label: "A3", wCm: 29.7, hCm: 42.0, color: "#8a5cb5", url: "https://galleryunsu.co.kr/product/list.html?cate_no=74" },
    { key: "8jeol", label: "8절", wCm: 27.3, hCm: 39.4, color: "#d1487a", url: "https://galleryunsu.co.kr/product/list.html?cate_no=94" }
  ];

  var CUSTOM_COLORS = ["#3d6ee0", "#2ba7a0", "#e0a83d", "#8a5cb5", "#c9556f", "#5a9c4c", "#3d8fe0", "#e07d3d"];

  function round1(n) { return Math.round(n * 10) / 10; }
  function clamp(v, min, max) { return Math.min(Math.max(v, min), max); }
  function uid(prefix) { return prefix + "-" + Math.random().toString(36).slice(2, 9); }

  var state = {
    board: null, // { wCm, hCm, scale, pxW, pxH }
    presetTemplates: PRESETS.map(function (p, i) {
      return { id: "preset-" + i, key: p.key, label: p.label, baseWCm: p.wCm, baseHCm: p.hCm, wCm: p.wCm, hCm: p.hCm, color: p.color, url: p.url, rotated: false };
    }),
    customTemplates: [],
    placedItems: []
  };

  var el = {
    boardWidthInput: document.getElementById("boardWidthInput"),
    boardHeightInput: document.getElementById("boardHeightInput"),
    applyBoardBtn: document.getElementById("applyBoardBtn"),
    boardHint: document.getElementById("boardHint"),
    boardWrapper: document.getElementById("boardWrapper"),
    board: document.getElementById("board"),
    boardPlaceholder: document.getElementById("boardPlaceholder"),
    boardInfo: document.getElementById("boardInfo"),
    clearBoardBtn: document.getElementById("clearBoardBtn"),
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
      el.boardHint.textContent = "가로/세로 값을 0보다 큰 숫자로 입력해주세요.";
      return;
    }
    state.board = { wCm: w, hCm: h, scale: 1, pxW: 0, pxH: 0 };
    state.placedItems = [];
    el.board.classList.remove("board-empty");
    el.boardHint.hidden = true;
    setPanelEnabled(el.customPanel, true);
    setPanelEnabled(el.presetPanel, true);
    el.clearBoardBtn.disabled = false;
    renderAll();
  });

  el.clearBoardBtn.addEventListener("click", function () {
    if (!state.board) return;
    state.placedItems = [];
    renderBoard();
  });

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

    el.boardInfo.textContent = "환경판 크기: " + b.wCm + " × " + b.hCm + " cm  |  배치된 작품: " + state.placedItems.length + "개";
  }

  function renderCustomGallery() {
    el.customGallery.innerHTML = "";
    if (!state.board) return;
    state.customTemplates.forEach(function (tpl) {
      el.customGallery.appendChild(buildTemplateCardEl(tpl, true));
    });
  }

  function renderPresetGallery() {
    el.presetGallery.innerHTML = "";
    if (!state.board) return;
    state.presetTemplates.forEach(function (tpl) {
      el.presetGallery.appendChild(buildTemplateCardEl(tpl, false));
    });
  }

  function sizePx(tpl) {
    var scale = state.board.scale;
    return { w: Math.max(tpl.wCm * scale, 4), h: Math.max(tpl.hCm * scale, 4) };
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

    var label = document.createElement("div");
    label.className = "card-label";
    label.textContent = tpl.label + "\n" + tpl.wCm + "×" + tpl.hCm + "cm";
    card.appendChild(label);

    var controls = document.createElement("div");
    controls.className = "card-controls";

    var rotateBtn = document.createElement("button");
    rotateBtn.type = "button";
    rotateBtn.className = "card-btn";
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

    if (tpl.url) {
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
    label.textContent = item.label + "\n" + round1(item.wCm) + "×" + round1(item.hCm) + "cm";
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
})();
