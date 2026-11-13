// W911 (SXS-W911 / K100 Keyboard) configurator UI.
// Protocol and editor are based on the W909 configurator, which uses the same vendor HID protocol.
(() => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const K = W911Keys;

  const KEY_COUNT = 80;               // matrix indexes 0..79 (index = row*8 + col)
  const MACRO_SLOTS = 16;
  const TESTED_FIRMWARE = "2.3.0003";
  // W911 physical layout: 6 + 6 + 6 + 4 keycaps.
  // The matrix is transposed: slot = physical_column * 8 + physical_row (see KBconfig.ini in the vendor app).
  // 120 fine columns x 4 rows. Widths come from the STEP keycap models:
  // standard 18.5mm=20 cols, bottom row 23.26mm=25, TAB 28.03=30, SHIFT 32.79=35,
  // SPACE 42.31=45, ENTER top 28.58=30 / bottom 23.26=25 (7-shaped, spans rows 2-3).
  const GRID = [
    { i: 0,  c: "esc",  col: 1,   row: 1, w: 20 },
    { i: 8,  c: "dark", col: 21,  row: 1, w: 20 },
    { i: 16, c: "dark", col: 41,  row: 1, w: 20 },
    { i: 24, c: "dark", col: 61,  row: 1, w: 20 },
    { i: 32, c: "dark", col: 81,  row: 1, w: 20 },
    { i: 40, c: "gray", col: 101, row: 1, w: 20 },
    { i: 1,  c: "dark", col: 1,   row: 2, w: 30 },
    { i: 9,  c: "dark", col: 31,  row: 2, w: 20 },
    { i: 17, c: "dark", col: 51,  row: 2, w: 20 },
    { i: 25, c: "dark", col: 71,  row: 2, w: 20 },
    { i: 33, c: "blue", col: 91,  row: 2, w: 30, h: 2, enter: true },
    { i: 2,  c: "gray", col: 1,   row: 3, w: 35 },
    { i: 10, c: "dark", col: 36,  row: 3, w: 20 },
    { i: 18, c: "dark", col: 56,  row: 3, w: 20 },
    { i: 26, c: "dark", col: 76,  row: 3, w: 20 },
    { i: 3,  c: "blue", col: 1,   row: 4, w: 25 },
    { i: 11, c: "dark", col: 26,  row: 4, w: 25 },
    { i: 19, c: "red",  col: 51,  row: 4, w: 45 },
    { i: 27, c: "gray", col: 96,  row: 4, w: 25 },
  ];
  const LIGHT_MODES = ["常亮", "行云流水", "跑马", "呼吸", "循环呼吸",
    "俄罗斯方块", "霓虹", "流光溢彩", "关灯"]; // device mode = position + 1

  let dev = null;
  let state = null;
  let selected = null;
  let tab = "key";

  // ---------- helpers ----------
  function toast(msg, err = false) {
    const t = $("#toast");
    t.textContent = msg;
    t.className = err ? "err" : "";
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => (t.hidden = true), err ? 6000 : 2500);
  }
  function log(line) {
    const el = $("#log");
    el.textContent = (el.textContent + line + "\n").split("\n").slice(-400).join("\n");
    el.scrollTop = el.scrollHeight;
  }
  async function busy(fn) {
    document.body.classList.add("busy");
    try { return await fn(); }
    catch (e) { console.error(e); toast(e.message || String(e), true); }
    finally { document.body.classList.remove("busy"); }
  }
  const keyValue = (i) => state.keys.slice(i * 4, i * 4 + 4);
  const knobValue = (layer, slot) => state.knob[layer].slice(slot * 4, slot * 4 + 4);
  const rgbToHex = (r, g, b) => "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("");
  const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));

  // ---------- platform help ----------
  function platform() {
    // The user-agent string still carries the OS in Chromium browsers (Windows NT / CrOS / X11; Linux / Macintosh).
    const ua = navigator.userAgent;
    if (/Windows/.test(ua)) return "windows";
    if (/CrOS/.test(ua)) return "chromeos";
    if (/Linux|X11/.test(ua) && !/Android/.test(ua)) return "linux";
    if (/Macintosh|Mac OS X/.test(ua)) return "mac";
    return "other";
  }
  const helpPanel = () => $(`#help-${platform()}`);

  function initHelp() {
    const panel = helpPanel();
    if (!panel) return;
    panel.hidden = false;
    if (platform() === "linux") panel.open = !localStorage.getItem("w911-connected"); // setup needed before first connect
    $$(".copy").forEach((b) => b.addEventListener("click", async () => {
      await navigator.clipboard.writeText($(`#${b.dataset.copy}`).textContent);
      b.textContent = "Copied";
      setTimeout(() => (b.textContent = "Copy"), 1500);
    }));
  }

  // Called when connecting fails: open this platform's tips and point at them.
  function showHelp(reason) {
    const panel = helpPanel();
    if (panel) {
      panel.hidden = false;
      panel.open = true;
      panel.classList.add("alert");
      panel.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    toast(panel ? `${reason}. See the tips below.` : reason, true);
  }

  // ---------- connection ----------
  const DEMO = new URLSearchParams(location.search).has("demo");

  // Returns true once connected. Guarded so a plug-in event and a click can't open the keyboard twice.
  let connecting = false;
  async function connect(auto = false) {
    if (connecting || dev) return !!dev;
    connecting = true;
    try { return await openKeyboard(auto); } finally { connecting = false; }
  }

  async function openKeyboard(auto) {
    if (!W911.Device.isSupported() && !DEMO) return false;
    try {
      if (DEMO) dev = new W911.Device(W911Mock.create(new URLSearchParams(location.search).get("demo") === "receiver" ? 0x4101 : 0x4100), log);
      else dev = auto ? await W911.Device.reconnect(log) : await W911.Device.request(log);
    } catch (e) {
      console.error(e);
      // Cancelling the browser's device picker throws NotFoundError; anything else is a real failure (often permissions).
      if (!auto && e.name !== "NotFoundError") showHelp(`Couldn't open the keyboard (${e.message})`);
      dev = null;
      return false;
    }
    if (!dev) {
      if (!auto) showHelp("没有选择键盘。请在列表里选择 “K100 Keyboard”（W911 Pro USB）。");
      return false;
    }
    localStorage.setItem("w911-connected", "1");
    $$(".help").forEach((p) => { p.open = false; p.classList.remove("alert"); });
    $("#status").textContent = DEMO ? "演示模式（未连接键盘）" : `已连接：${dev.connectionName}`;
    $("#connect").textContent = "断开";
    $("#intro").hidden = true;
    document.body.classList.remove("offline");
    $("#app").hidden = false;
    setReadOnly(dev.hid.productId === 0x4101);
    dev.onKeys(onPadKeys);
    await busy(loadAll);
    return true;
  }

  // Over the 2.4G receiver the keyboard answers reads but ignores writes, so lock editing.
  let readOnly = false;
  function setReadOnly(on) {
    readOnly = on;
    $("#readonly").hidden = !on;
    document.body.classList.toggle("read-only", on);
    $$("#ed-apply, #lt-apply, #pw-apply, #profiles button, #restore, #factory, #clear-keys, #copy-profile, #shows button").forEach((b) => (b.disabled = on));
  }
  function guardWrite() {
    if (readOnly) toast("Connected through the 2.4G receiver, so settings can't be changed. Use the USB cable.", true);
    return readOnly;
  }

  async function disconnect(unplugged = false) {
    if (dev && !unplugged) await stopShow();
    show = null;
    renderShows();
    held = new Set();
    // An unplugged device can fail to close; still reset, or the page would think it's connected.
    try { if (dev) await dev.close(); } catch (e) { console.error(e); }
    dev = null;
    $("#status").textContent = "未连接";
    $("#connect").textContent = "连接键盘";
    $("#intro").hidden = false;
    setReadOnly(false);
    showOffline();
  }

  // Not connected: show the factory layout, greyed out, with a "Disconnected" overlay.
  function showOffline() {
    const keys = new Uint8Array(KEY_COUNT * 4);
    for (const [i, v] of K.FACTORY.keys) keys.set(v, i * 4);
    state = { keys, knob: K.FACTORY.knob.map((k) => Uint8Array.from(k)), macros: new Map() };
    closeEditor();
    renderSlots();
    document.body.classList.add("offline");
    $("#app").hidden = false;
  }

  navigator.hid?.addEventListener("disconnect", (e) => {
    if (dev && e.device === dev.hid) { disconnect(true); toast("键盘已断开", true); }
  });

  // Plugging a keyboard back in reconnects without the picker (the browser remembers the permission).
  // Chrome fires one event per HID interface and the device can take a moment to open, so settle, then retry.
  let replugTimer = 0;
  navigator.hid?.addEventListener("connect", (e) => {
    if (dev || DEMO || !W911.VIDS.includes(e.device.vendorId) || !W911.PIDS[e.device.productId]) return;
    clearTimeout(replugTimer);
    const attempt = async (left) => {
      if (dev) return;
      if (await connect(true)) toast("键盘已重新连接");
      else if (left > 0) replugTimer = setTimeout(() => attempt(left - 1), 800);
    };
    replugTimer = setTimeout(() => attempt(3), 400);
  });

  // ---------- loading ----------
  async function loadAll() {
    const info = await dev.readInfo();
    const profile = await dev.readProfile();
    const keys = await dev.readKeys(KEY_COUNT);
    if (readOnly && keys.every((b) => b === 0)) {
      toast("The 2.4G receiver didn't return any settings. Connect with the USB cable.", true);
    }
    const knob = [await dev.readKnob(0), await dev.readKnob(1)];
    const light = await dev.readLighting();
    const power = await dev.readPowerTimers();
    state = { info, profile, keys, knob, light, power, macros: new Map() };
    for (let i = 0; i < KEY_COUNT; i++) {
      const v = keyValue(i);
      if (v[0] === K.TYPE.MACRO) state.macros.set(v[2], await dev.readMacro(v[2]));
    }
    $("#info").textContent = `固件 ${info.firmware} · ${info.board}`;
    const fw = $("#fw-warning");
    fw.hidden = info.firmware === TESTED_FIRMWARE;
    fw.innerHTML = `<b>未验证的固件版本。</b>本页在固件 ${TESTED_FIRMWARE} 上测试过；你的键盘报告的是
      <b>${info.firmware || "未知"}</b>。只读查看是安全的；写入前请先点“备份配置”，以便恢复。`;
    renderAll();
  }

  // ---------- rendering ----------
  function buildBoard() {
    const grid = $("#grid");
    for (const k of GRID) {
      const b = document.createElement("button");
      b.className = `slot cap ${k.c}${k.enter ? " enter" : ""}`;
      b.dataset.key = String(k.i);
      b.dataset.name = `按键 ${k.i}`;
      b.style.gridArea = `${k.row} / ${k.col} / span ${k.h || 1} / span ${k.w}`;
      b.innerHTML = '<span></span>';
      grid.append(b);
    }
  }

  const ZH = {
    "Left Shift": "左 Shift", "Right Shift": "右 Shift",
    "Left Ctrl": "左 Ctrl", "Right Ctrl": "右 Ctrl",
    "Left Alt/Option": "左 Alt", "Right Alt/Option": "右 Alt",
    "Left Win/Cmd": "左 Win", "Right Win/Cmd": "右 Win",
    "Space": "空格", "Page Up": "上一页", "Page Down": "下一页",
    "Caps Lock": "大写锁定", "Num Lock": "数字锁定", "Scroll Lock": "滚动锁定",
    "Print Screen": "截屏", "Backspace": "退格", "Enter": "回车",
    "Delete": "删除", "Insert": "插入", "Home": "行首", "End": "行尾",
    "Menu": "菜单", "Pause": "暂停",
    "Keypad /": "小键盘 /", "Keypad *": "小键盘 *", "Keypad -": "小键盘 -",
    "Keypad +": "小键盘 +", "Keypad Enter": "小键盘回车", "Keypad .": "小键盘 .",
  };
  const zh = (s) => ZH[s] || s;

  function label(v) {
    const d = K.describe(v);
    if (d.kind === "macro") {
      const m = state.macros.get(d.slot);
      if (m) {
        const { events, complex } = K.decodeEvents(m.events);
        const s = complex ? "Macro" : K.summarizeEvents(events) || "Macro";
        return { ...d, label: s.length > 28 ? s.slice(0, 26) + "…" : s };
      }
    }
    return { ...d, label: d.label === "Macro" ? "宏" : zh(d.label) };
  }

  // Short labels for narrow keys and the small side buttons; the full name is still in the tooltip/editor.
  const SHORT = {
    "Profile cycle": "配置切换", "配置循环": "配置切换", "配置切换": "配置", "Next profile": "下一配置", "Previous profile": "上一配置",
    "LED mode cycle": "灯光模式", "灯光模式切换": "灯光模式", "灯光开关": "灯光开关",
    "Mouse wheel up": "滚轮 ↑", "Mouse wheel down": "滚轮 ↓",
    "Mouse wheel left": "滚轮 ←", "Mouse wheel right": "滚轮 →",
    "Volume up": "音量 +", "Volume down": "音量 −", "Play / Pause": "播放/暂停",
    "Next track": "下一曲", "Previous track": "上一曲",
    "Left Alt/Option": "左 Alt", "Right Alt/Option": "右 Alt",
    "Left Win/Cmd": "左 Win", "Right Win/Cmd": "右 Win",
  };

  function renderSlot(el, v) {
    const d = label(v);
    let text = d.label;
    if (el.classList.contains("narrow") || el.classList.contains("small") || el.classList.contains("knob-btn") || el.classList.contains("joy-center")) text = SHORT[text] || text;
    const span = el.querySelector("span");
    if (span) span.textContent = text;
    el.title = el.dataset.key ? `按键 ${el.dataset.key}: ${d.label}` : `${el.dataset.name || "旋钮"}: ${d.label}`;
    el.classList.toggle("macro", d.kind === "macro");
    el.classList.toggle("none", d.kind === "none");
  }

  function renderAll() {
    $$("#profiles button").forEach((b) => b.classList.toggle("on", Number(b.dataset.profile) === state.profile));
    renderSlots();
    renderLighting();
    if (state.power) {
      $("#pw-sleep").value = Math.max(1, Math.round(state.power.sleepSeconds / 60));
      $("#pw-off").textContent = `空闲 ${Math.round(state.power.powerOffSeconds / 60)} 分钟后关机`;
    }
    if (selected) openEditor(selected);
  }

  function renderSlots() {
    $$(".slot[data-key]").forEach((el) => renderSlot(el, keyValue(Number(el.dataset.key))));
    // Knob and roller pairs show the active config (layer) and are rebound when the profile changes.
    const layer = state?.profile ?? 0;
    $$(".slot[data-knob-dir]").forEach((el) => {
      const slot = Number(el.dataset.knobDir);
      el.dataset.knob = `${layer}:${slot}`;
      renderSlot(el, knobValue(layer, slot));
    });
    $$(".slot[data-knob]:not([data-knob-dir])").forEach((el) => {
      const [l, slot] = el.dataset.knob.split(":").map(Number);
      renderSlot(el, knobValue(l, slot));
    });
    const short = (slot) => { const d = label(knobValue(layer, slot)); return SHORT[d.label] || d.label; };
    const kc = $("#knob-caption");
    if (kc) kc.textContent = `← ${short(3)}    → ${short(2)}`;
    const rc = $("#roller-caption");
    if (rc) rc.textContent = `↑ ${short(0)}    ↓ ${short(1)}`;
  }

  // ---------- pressing a key on the pad ----------
  // The pad streams its switch matrix, so pressing a physical key selects it here.
  let held = new Set();
  let profileTimer = 0;
  function onPadKeys(indexes) {
    const fresh = indexes.filter((i) => !held.has(i));
    held = new Set(indexes);
    if (fresh.length) log(`PAD ${fresh.join(",")}`);
    $$(".slot[data-key]").forEach((el) => el.classList.toggle("pressed", held.has(Number(el.dataset.key))));
    // The joystick centre is the hardware profile switch: refresh after it changes the active profile.
    if (fresh.length === 1 && fresh[0] === 37) {
      clearTimeout(profileTimer);
      profileTimer = setTimeout(() => { if (dev && state) busy(loadAll); }, 500);
      return;
    }
    // Leave the editor alone while someone is typing into it or capturing a key (pad keys type too).
    const typing = document.activeElement?.matches("input, textarea") || $(".listening");
    if (fresh.length !== 1 || typing || !state || document.body.classList.contains("busy")) return;
    if ($(`.slot[data-key="${fresh[0]}"]`)) openEditor({ kind: "key", index: fresh[0] });
  }

  // ---------- key editor ----------
  function fillSelects() {
    const keyOpts = K.HID.map(([c, n]) => `<option value="${c}">${zh(n)}</option>`).join("");
    $("#ed-key").innerHTML = keyOpts;
    $("#ed-sc-key").innerHTML = K.HID.filter(([c]) => c < 0xe0).map(([c, n]) => `<option value="${c}">${zh(n)}</option>`).join("");
    const groups = {};
    K.SPECIAL.forEach(([n, g], i) => (groups[g] = groups[g] || []).push(`<option value="${i}">${n}</option>`));
    $("#ed-special").innerHTML = Object.entries(groups).map(([g, o]) => `<optgroup label="${g}">${o.join("")}</optgroup>`).join("");
    $("#ed-mods").innerHTML = K.MODS.map((m) => `<label class="check"><input type="checkbox" value="${m.bit}"> ${m.label}</label>`).join("");
  }

  function setTab(t) {
    tab = t;
    $$("#ed-tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === t));
    $$(".tab").forEach((p) => (p.hidden = p.dataset.pane !== t));
    $("#ed-repeat-wrap").hidden = !(t === "shortcut" || t === "text");
  }

  function currentValue(sel) {
    return sel.kind === "key" ? keyValue(sel.index) : knobValue(sel.layer, sel.slot);
  }

  function openEditor(sel) {
    selected = sel;
    $$(".slot").forEach((el) => el.classList.remove("selected"));
    const el = sel.kind === "key" ? $(`.slot[data-key="${sel.index}"]`) : $(`.slot[data-knob="${sel.layer}:${sel.slot}"]`);
    el?.classList.add("selected");
    $("#editor").hidden = false;
    $("#ed-title").textContent = el?.dataset.name || `键 ${sel.index}`;
    const v = currentValue(sel);
    const d = label(v);
    $("#ed-current").textContent = `当前：${d.label}`;
    // Macros work on keys, knob and roller alike.
    $$('#ed-tabs button[data-tab="shortcut"], #ed-tabs button[data-tab="text"]').forEach((b) => (b.hidden = false));
    $$("#ed-mods input").forEach((i) => (i.checked = false));
    $("#ed-repeat").value = 1;
    if (d.kind === "key") { $("#ed-key").value = v[1]; setTab("key"); }
    else if (d.kind === "special") { $("#ed-special").value = K.SPECIAL.findIndex(([, , b]) => b[0] === v[0] && b[1] === v[1] && b[2] === v[2]); setTab("special"); }
    else if (d.kind === "macro") {
      const m = state.macros.get(d.slot);
      $("#ed-repeat").value = m?.repeat || 1;
      const ev = m ? K.decodeEvents(m.events).events : [];
      const downs = ev.filter((e) => !e.up);
      const mods = downs.filter((e) => e.hid >= 0xe0).map((e) => e.hid);
      const keys = downs.filter((e) => e.hid < 0xe0);
      if (keys.length === 1) {
        $$("#ed-mods input").forEach((i) => (i.checked = mods.includes(Number(i.value))));
        $("#ed-sc-key").value = keys[0].hid;
        setTab("shortcut");
      } else setTab("text");
    } else setTab(d.kind === "none" ? "none" : "key");
  }

  function closeEditor() {
    selected = null;
    $("#editor").hidden = true;
    $$(".slot").forEach((el) => el.classList.remove("selected"));
  }

  async function applyEditor() {
    const sel = selected;
    if (!sel || guardWrite()) return;
    const old = currentValue(sel);
    let value;
    let macro = null;
    if (tab === "key") value = [K.TYPE.KEY, Number($("#ed-key").value), 0, 0];
    else if (tab === "special") {
      const s = K.SPECIAL[Number($("#ed-special").value)];
      if (!s) return toast("Pick an action first", true);
      value = [...s[2], 0];
    } else if (tab === "none") value = [0, 0, 0, 0];
    else {
      let events;
      try {
        events = tab === "shortcut"
          ? K.shortcutEvents($$("#ed-mods input").filter((i) => i.checked).map((i) => Number(i.value)), Number($("#ed-sc-key").value))
          : K.textEvents($("#ed-text").value, Number($("#ed-text-delay").value) || 10);
      } catch (e) { return toast(e.message, true); }
      if (!events.length) return toast("Nothing to type", true);
      const bytes = K.encodeEvents(events);
      if (bytes.length > 508) return toast("Too long for one key (about 80 characters max)", true);
      const repeat = Math.min(255, Math.max(1, Number($("#ed-repeat").value) || 1));
      const slot = sel.kind === "key" ? pickMacroSlot(sel.index) : pickMacroSlotFor(sel);
      if (slot < 0) return toast(`All ${MACRO_SLOTS} macro slots in this profile are in use`, true);
      macro = { slot, repeat, bytes };
      value = [K.TYPE.MACRO, 0, slot, 0];
    }
    await busy(async () => {
      if (sel.kind === "key") {
        await dev.writeKey(sel.index, value);
        if (macro) {
          await dev.writeMacro(macro.slot, macro.repeat, macro.bytes);
          const back = await dev.readMacro(macro.slot);
          state.macros.set(macro.slot, back);
          if (back.events.length !== macro.bytes.length) throw new Error("The keyboard didn't store the macro");
        } else if (old[0] === K.TYPE.MACRO && old[2] < MACRO_SLOTS) {
          await dev.writeMacro(old[2], 0, new Uint8Array(0));
          state.macros.delete(old[2]);
        }
        state.keys.set(await dev.readKey(sel.index), sel.index * 4);
      } else {
        // The knob/roller can be read from either layer depending on firmware/profile; keep both in sync.
        const other = sel.layer === 0 ? 1 : 0;
        await dev.writeKnob(sel.layer, sel.slot, value);
        await dev.writeKnob(other, sel.slot, value);
        if (macro) {
          await dev.writeMacro(macro.slot, macro.repeat, macro.bytes);
          const back = await dev.readMacro(macro.slot);
          state.macros.set(macro.slot, back);
          if (back.events.length !== macro.bytes.length) throw new Error("The keyboard didn't store the macro");
        } else if (old[0] === K.TYPE.MACRO && old[2] < MACRO_SLOTS) {
          await dev.writeMacro(old[2], 0, new Uint8Array(0));
          state.macros.delete(old[2]);
        }
        state.knob[0] = await dev.readKnob(0);
        state.knob[1] = await dev.readKnob(1);
      }
      renderAll();
      const ok = currentValue(sel).every((b, i) => b === (value[i] || 0));
      toast(ok ? "已写入键盘" : "已写入，但键盘读回的值不同", !ok);
    });
  }

  function pickMacroSlotFor(sel) {
    const own = currentValue(sel);
    if (own[0] === K.TYPE.MACRO && own[2] < MACRO_SLOTS) return own[2];
    const used = new Set();
    for (let i = 0; i < KEY_COUNT; i++) {
      const v = keyValue(i);
      if (v[0] === K.TYPE.MACRO) used.add(v[2]);
    }
    for (let layer = 0; layer < 2; layer++) {
      for (let slot = 0; slot < 4; slot++) {
        const v = knobValue(layer, slot);
        if (v[0] === K.TYPE.MACRO) used.add(v[2]);
      }
    }
    for (let s = 0; s < MACRO_SLOTS; s++) if (!used.has(s)) return s;
    return -1;
  }

  // The firmware has 16 macro slots per profile (0..15); a macro key stores its slot in byte 2.
  // Reuse the key's own slot if it has one, otherwise take the lowest slot no other key uses.
  function pickMacroSlot(index) {
    const own = keyValue(index);
    if (own[0] === K.TYPE.MACRO && own[2] < MACRO_SLOTS) return own[2];
    const used = new Set();
    for (let i = 0; i < KEY_COUNT; i++) {
      const v = keyValue(i);
      if (i !== index && v[0] === K.TYPE.MACRO) used.add(v[2]);
    }
    for (let s = 0; s < MACRO_SLOTS; s++) if (!used.has(s)) return s;
    return -1;
  }

  // one-shot key capture from the computer keyboard
  function capture(btn, onKey) {
    btn.classList.add("listening");
    const prev = btn.textContent;
    btn.textContent = "Press a key… (Esc to cancel)";
    const handler = (e) => {
      if (["ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight", "AltLeft", "AltRight", "MetaLeft", "MetaRight"].includes(e.code) && onKey.wantsCombo) return;
      e.preventDefault();
      window.removeEventListener("keydown", handler, true);
      btn.classList.remove("listening");
      btn.textContent = prev;
      if (e.code === "Escape" && onKey.wantsCombo) return;
      const hid = K.codeToHid.get(e.code);
      if (hid === undefined) return toast(`That key (${e.code}) isn't in the list`, true);
      onKey(hid, e);
    };
    window.addEventListener("keydown", handler, true);
  }

  // ---------- lighting ----------
  const CONSTANT = 1;
  function lightRecord(mode) { return state.light.modes[mode]; }

  function renderLighting() {
    if (!state?.light) return;
    const h = state.light.header;
    const mode = h[0] & 0x3f;
    $("#lt-mode").value = String(mode);
    renderLightSettings(mode);
  }

  function renderLightSettings(mode) {
    const rec = mode >= 1 && mode <= 8 ? lightRecord(mode) : null;
    $("#lt-settings").hidden = !rec;
    if (!rec) return;
    $("#lt-bright").value = rec[0]; $("#lt-bright-v").textContent = rec[0];
    $("#lt-speed").value = rec[1]; $("#lt-speed-v").textContent = rec[1];
    $("#lt-dir").value = String(rec[2] ? 1 : 0);
    const box = $("#lt-colors");
    box.innerHTML = "";
    const color = (i) => rgbToHex(rec[4 + i * 3], rec[5 + i * 3], rec[6 + i * 3]); // stored R,G,B (verified on the LEDs)
    if (mode === CONSTANT) {
      // Constant shows the one selected color (lowest enabled bit), so offer a single picker.
      const sel = Math.max(0, [0, 1, 2, 3, 4, 5, 6].find((i) => rec[3] & (1 << i)) ?? 0);
      box.innerHTML = `<label>Color <input type="color" data-single value="${color(sel)}"></label>`;
      return;
    }
    for (let i = 0; i < 7; i++) {
      const on = !!(rec[3] & (1 << i));
      const l = document.createElement("label");
      l.innerHTML = `<input type="color" value="${color(i)}"><span><input type="checkbox" ${on ? "checked" : ""}> ${i + 1}</span>`;
      box.appendChild(l);
    }
  }

  async function applyLighting() {
    if (guardWrite()) return;
    await stopShow();
    const mode = Number($("#lt-mode").value);
    const h = state.light.header;
    const header = [(h[0] & 0xc0) | mode, h[1], h[2]];
    await busy(async () => {
      if (mode >= 1 && mode <= 8) {
        const rec = Uint8Array.from(lightRecord(mode)); // keep colors the form doesn't show
        rec[0] = Number($("#lt-bright").value);
        rec[1] = Number($("#lt-speed").value);
        rec[2] = Number($("#lt-dir").value);
        const single = $("#lt-colors input[data-single]");
        if (single) {
          rec.set(hexToRgb(single.value), 4);
          rec[3] = 0x01; // select color 1 only
        } else {
          let mask = 0;
          $$("#lt-colors label").forEach((l, i) => {
            rec.set(hexToRgb(l.querySelector("input[type=color]").value), 4 + i * 3);
            if (l.querySelector("input[type=checkbox]").checked) mask |= 1 << i;
          });
          rec[3] = mask;
        }
        await dev.writeLightingMode(mode, rec);
      }
      // The LEDs only pick up changes when the header is written, so send it after the mode record.
      await dev.writeLightingHeader(header);
      state.light = await dev.readLighting();
      renderLighting();
      toast("灯光已写入");
    });
  }

  // Roughly what the pad's LEDs show, for the 3D board: [r, g, b] for a key at x (0 = left, 1 = right), or null.
  function padGlow(t, x) {
    if (show) return W909Effects.color(W909Effects.LIST[show.index], (performance.now() - show.started) / 1000);
    const light = state?.light;
    const mode = light ? light.header[0] & 0x3f : 0;
    const rec = light?.modes[mode];
    if (!rec) return null; // LED off, or not loaded
    const k = 0.3 + (0.7 * Math.min(6, rec[0])) / 6;
    const colors = [0, 1, 2, 3, 4, 5, 6].filter((i) => rec[3] & (1 << i)).map((i) => Array.from(rec.slice(4 + i * 3, 7 + i * 3)));
    const scale = (c, f) => c.map((v) => v * f);
    if (mode === CONSTANT) return scale(colors[0] || Array.from(rec.slice(4, 7)), k);
    const p = t * (0.15 + rec[1] * 0.08);
    const wave = mode === 2 || mode === 3 || mode === 7 || mode === 8; // flowing/mono water, neon, ambilight
    if (wave) {
      const pos = p - x * 0.8;
      return scale(colors.length ? colors[Math.abs(Math.floor(pos * 2)) % colors.length] : W909Effects.hsv(((pos % 1) + 1) % 1), k);
    }
    const c = colors.length ? colors[Math.floor(p) % colors.length] : W909Effects.hsv((p * 0.25) % 1);
    return scale(c, k * (0.15 + 0.85 * (0.5 - 0.5 * Math.cos(p * 2 * Math.PI)))); // breathing
  }

  // ---------- 3D view ----------
  // three.js and the 3D board load only while the "3D view" toggle is on (the default). Off, the page is the flat
  // 2D board with nothing 3D on it. Without WebGL the toggle is hidden and the 2D board stays.
  const VIEW_KEY = "w911-3d";
  const scripts = {};
  const loadScript = (src) => (scripts[src] ??= new Promise((ok, fail) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = ok;
    s.onerror = () => { delete scripts[src]; s.remove(); fail(new Error(`Couldn't load ${src}`)); };
    document.body.append(s);
  }));
  const load3D = async () => { await loadScript("vendor/three.min.js"); await loadScript("w909-board3d.js"); };

  async function set3D(on) {
    const box = $("#view-3d");
    if (!box) return;
    box.checked = on;
    localStorage.setItem(VIEW_KEY, on ? "1" : "0");
    try {
      if (!on) return typeof W909Board3D !== "undefined" && W909Board3D.unmount();
      await load3D();
      if (box.checked && !W909Board3D.mount($(".board-wrap"), { glow: padGlow })) $(".view-toggle").hidden = true;
    } catch (e) { console.error("3D board failed", e); }
  }

  function init3D() {
    // The W911 page uses the flat 2D board only.
    return;
  }

  // ---------- light shows ----------
  // The page animates the pad by rewriting Constant mode's color, then the header (the LEDs only refresh on a
  // header write). Every write is saved by the keyboard, so shows stop on their own and then put the lighting back.
  const SHOW_SECONDS = 30;
  let show = null; // { index, started, saved: { header, constant } }

  function renderShows() {
    $$("#shows button[data-show]").forEach((b) => b.classList.toggle("on", show?.index === Number(b.dataset.show)));
    const stop = $("#show-stop");
    if (stop) stop.hidden = !show;
  }

  function startShow(index) {
    if (guardWrite() || !state?.light) return;
    const first = !show;
    show = { index, started: performance.now(), saved: show?.saved || { header: Uint8Array.from(state.light.header), constant: Uint8Array.from(lightRecord(CONSTANT)) } };
    renderShows();
    if (first) showFrame();
  }

  async function showFrame() {
    if (!show) return;
    const t = (performance.now() - show.started) / 1000;
    if (t > SHOW_SECONDS) return stopShow();
    const { header, constant } = show.saved;
    const rec = Uint8Array.from(constant);
    if (!rec[0]) rec[0] = 4; // brightness 0 would hide the show
    rec[3] = 0x01; // Constant shows the color selected in the mask
    rec.set(W909Effects.color(W909Effects.LIST[show.index], t), 4);
    try {
      // Queue both writes at once so a Stop can't land between them.
      await Promise.all([dev.writeLightingMode(CONSTANT, rec), dev.writeLightingHeader([(header[0] & 0xc0) | CONSTANT, header[1], header[2]])]);
    } catch (e) {
      console.error(e);
      show = null;
      renderShows();
      return;
    }
    setTimeout(showFrame, 0); // each frame is two writes of ~50 ms, about 10 frames a second
  }

  async function stopShow() {
    if (!show) return;
    const { saved } = show;
    show = null;
    renderShows();
    await dev.writeLightingMode(CONSTANT, saved.constant);
    await dev.writeLightingHeader(saved.header);
  }

  function buildShows() {
    if (!$("#show-list")) return;
    $("#show-list").innerHTML = W909Effects.LIST.map((e, i) =>
      `<button data-show="${i}"><i class="swatch"></i><b>${e.name}</b><small>${e.about}</small></button>`).join("");
    const swatches = $$("#show-list .swatch");
    const preview = (now) => {
      W909Effects.LIST.forEach((e, i) => (swatches[i].style.background = `rgb(${W909Effects.color(e, now / 1000)})`));
      requestAnimationFrame(preview);
    };
    requestAnimationFrame(preview);
  }

  // ---------- backup / restore / factory reset (active profile) ----------
  const toHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  const fromHex = (h, len) => {
    if (typeof h !== "string" || !/^([0-9a-f]{2})*$/i.test(h) || (len && h.length !== len * 2)) throw new Error("Backup file is damaged");
    return Uint8Array.from(h.match(/../g) || [], (x) => parseInt(x, 16));
  };

  async function backup() {
    await busy(async () => {
      const macros = {};
      for (let slot = 0; slot < MACRO_SLOTS; slot++) {
        const m = await dev.readMacro(slot);
        if (m.events.length) macros[slot] = { repeat: m.repeat, events: toHex(m.events) };
      }
      const data = {
        format: "w911-backup", version: 1, savedAt: new Date().toISOString(),
        firmware: state.info.firmware, board: state.info.board, profile: state.profile + 1,
        keys: toHex(state.keys),
        knob: state.knob.map(toHex),
        lighting: { header: toHex(state.light.header), modes: Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map((m) => [m, toHex(state.light.modes[m])])) },
        macros,
        sleepSeconds: state.power.sleepSeconds,
      };
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      a.download = `w911-profile${state.profile + 1}-${data.savedAt.slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      toast(`配置 ${state.profile + 1} 已备份到 ${a.download}`);
    });
  }

  // Writes a complete profile: macros first (so macro keys point at real data), then keys, knob, lighting, sleep.
  async function writeProfile(p) {
    await stopShow();
    for (let slot = 0; slot < MACRO_SLOTS; slot++) {
      const m = p.macros[slot];
      await dev.writeMacro(slot, m ? m.repeat : 0, m ? m.events : new Uint8Array(0));
    }
    await dev.writeKeys(p.keys);
    for (const layer of [0, 1]) await dev.writeKnobTable(layer, p.knob[layer]);
    for (let m = 1; m <= 8; m++) await dev.writeLightingMode(m, p.lightModes[m]);
    await dev.writeLightingHeader(p.lightHeader);
    await dev.setSleepSeconds(p.sleepSeconds);
    await loadAll();
  }

  function parseBackup(text) {
    let d;
    try { d = JSON.parse(text); } catch { throw new Error("这不是有效的 W911 配置备份文件"); }
    if (d?.format !== "w911-backup" || d.version !== 1) throw new Error("这不是有效的 W911 配置备份文件");
    const macros = {};
    for (const [slot, m] of Object.entries(d.macros || {})) {
      const n = Number(slot);
      if (!(n >= 0 && n < MACRO_SLOTS)) throw new Error("Backup file is damaged");
      macros[n] = { repeat: Math.min(255, Math.max(1, Number(m.repeat) || 1)), events: fromHex(m.events) };
      if (macros[n].events.length > 508) throw new Error("Backup file is damaged");
    }
    return {
      meta: d,
      keys: fromHex(d.keys, KEY_COUNT * 4),
      knob: [fromHex(d.knob?.[0]), fromHex(d.knob?.[1])].map((b) => {
        if (b.length === 8) { const x = new Uint8Array(16); x.set(b); return x; }
        if (b.length !== 16) throw new Error("Backup file is damaged");
        return b;
      }),
      lightHeader: fromHex(d.lighting?.header, 3),
      lightModes: Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map((m) => [m, fromHex(d.lighting?.modes?.[m], 25)])),
      macros,
      sleepSeconds: Math.min(7200, Math.max(60, Number(d.sleepSeconds) || 60)),
    };
  }

  async function restoreFile(file) {
    if (guardWrite()) return;
    let p;
    try { p = parseBackup(await file.text()); } catch (e) { return toast(e.message, true); }
    const from = `profile ${p.meta.profile ?? "?"}, saved ${String(p.meta.savedAt || "").slice(0, 10)}`;
    if (!confirm(`Replace everything in Profile ${state.profile + 1} with this backup (${from})?`)) return;
    await busy(async () => { await writeProfile(p); toast(`Backup restored to Profile ${state.profile + 1}`); });
  }

  // Copy the current profile to the other one.
  async function copyToOther() {
    if (guardWrite() || !state) return;
    const target = state.profile === 0 ? 1 : 0;
    if (!confirm(`把当前配置（配置 ${state.profile + 1}）的按键、旋钮、灯光复制到配置 ${target + 1}？\n\n配置 ${target + 1} 原有内容会被覆盖。`)) return;
    await busy(async () => {
      const saved = {
        keys: Uint8Array.from(state.keys),
        knob: state.knob.map((k) => Uint8Array.from(k)),
        lightHeader: Uint8Array.from(state.light.header),
        lightModes: Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map((m) => [m, Uint8Array.from(state.light.modes[m])])),
        macros: new Map(state.macros),
      };
      const back = state.profile;
      await dev.setProfile(target);
      for (let slot = 0; slot < MACRO_SLOTS; slot++) {
        const m = saved.macros.get(slot);
        await dev.writeMacro(slot, m ? m.repeat : 0, m ? m.events : new Uint8Array(0));
      }
      await dev.writeKeys(saved.keys);
      for (const layer of [0, 1]) await dev.writeKnobTable(layer, saved.knob[layer]);
      for (let m = 1; m <= 8; m++) await dev.writeLightingMode(m, saved.lightModes[m]);
      await dev.writeLightingHeader(saved.lightHeader);
      if (state.power) await dev.setSleepSeconds(state.power.sleepSeconds);
      await dev.setProfile(back);
      await loadAll();
      toast(`已复制到配置 ${target + 1}`);
    });
  }

  async function clearKeys() {
    if (guardWrite()) return;
    if (!confirm("清空中间的 19 个键？\n\n清空后这些键都没有输出；X/Y/Z、摇杆、旋钮、滚轮和灯光不变。\n建议先备份。")) return;
    await busy(async () => {
      for (const k of GRID) await dev.writeKey(k.i, [0, 0, 0, 0]);
      await loadAll();
      toast("中间 19 个键已清空");
    });
  }

  async function factoryReset() {
    if (guardWrite()) return;
    if (!confirm(`Reset Profile ${state.profile + 1} to factory settings?\n\nThis replaces its keys, knob, joystick, macros, lighting and sleep timer. Tip: back it up first.`)) return;
    const F = K.FACTORY;
    const keys = new Uint8Array(KEY_COUNT * 4);
    for (const [i, v] of F.keys) keys.set(v, i * 4);
    await busy(async () => {
      await writeProfile({
        keys, knob: F.knob.map((k) => Uint8Array.from(k)), macros: {},
        lightHeader: F.lightHeader,
        lightModes: Object.fromEntries(Object.entries(F.lightModes).map(([m, h]) => [m, fromHex(h, 25)])),
        sleepSeconds: F.sleepSeconds,
      });
      toast(`Profile ${state.profile + 1} reset to factory settings`);
    });
  }

  // ---------- wire up ----------
  function init() {
    if (!W911.Device.isSupported() && !DEMO) {
      $("#unsupported").hidden = false;
      $("#connect").disabled = true;
      return;
    }
    initHelp();
    buildBoard();
    init3D();
    showOffline();
    fillSelects();
    buildShows();
    $("#lt-mode").innerHTML = LIGHT_MODES.map((n, i) => `<option value="${i + 1}">${n}</option>`).join("");

    $("#connect").addEventListener("click", () => (dev ? disconnect() : connect()));
    $("#reload").addEventListener("click", () => busy(async () => { await stopShow(); await loadAll(); }));
    $("#backup").addEventListener("click", backup);
    $("#restore").addEventListener("click", () => !guardWrite() && $("#restore-file").click());
    $("#restore-file").addEventListener("change", (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) restoreFile(f); });
    if ($("#factory")) $("#factory").addEventListener("click", factoryReset);
    if ($("#clear-keys")) $("#clear-keys").addEventListener("click", clearKeys);
    if ($("#copy-profile")) $("#copy-profile").addEventListener("click", copyToOther);
    $("#use-cable").addEventListener("click", async () => { await disconnect(); await connect(); });
    $("#profiles").addEventListener("click", (e) => {
      const p = e.target.dataset.profile;
      if (p === undefined || !state || Number(p) === state.profile || guardWrite()) return;
      const from = state.profile;
      busy(async () => {
        await stopShow();
        await dev.setProfile(Number(p));
        await loadAll();
        if (state.keys.every((b) => b === 0)) {
          await dev.setProfile(from);
          await loadAll();
          toast(`配置 ${Number(p) + 1} 是空的，键盘会没有输出，已切回配置 ${from + 1}`, true);
          return;
        }
        toast(`已切换到配置 ${Number(p) + 1}；如果键盘没输出，点另一个配置切回，或先用“复制到另一配置”`);
      });
    });
    document.querySelector(".pad-wrap").addEventListener("click", (e) => {
      const s = e.target.closest(".slot");
      if (!s || !dev || !state) return;
      if (s.dataset.key) openEditor({ kind: "key", index: Number(s.dataset.key) });
      else { const [layer, slot] = s.dataset.knob.split(":").map(Number); openEditor({ kind: "knob", layer, slot }); }
    });
    $("#ed-tabs").addEventListener("click", (e) => e.target.dataset.tab && setTab(e.target.dataset.tab));
    $("#ed-cancel").addEventListener("click", closeEditor);
    $("#ed-apply").addEventListener("click", applyEditor);
    $("#ed-capture").addEventListener("click", (e) => capture(e.currentTarget, (hid) => ($("#ed-key").value = hid)));
    const combo = (hid, ev) => {
      const want = { 0xe0: ev.ctrlKey, 0xe1: ev.shiftKey, 0xe2: ev.altKey, 0xe3: ev.metaKey };
      $$("#ed-mods input").forEach((i) => (i.checked = !!want[Number(i.value)]));
      $("#ed-sc-key").value = hid;
    };
    combo.wantsCombo = true;
    $("#ed-sc-capture").addEventListener("click", (e) => capture(e.currentTarget, combo));
    $("#lt-mode").addEventListener("change", (e) => renderLightSettings(Number(e.target.value)));
    $("#lt-bright").addEventListener("input", (e) => ($("#lt-bright-v").textContent = e.target.value));
    $("#lt-speed").addEventListener("input", (e) => ($("#lt-speed-v").textContent = e.target.value));
    $("#lt-apply").addEventListener("click", applyLighting);
    if ($("#show-list")) $("#show-list").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-show]");
      if (b && dev && state) startShow(Number(b.dataset.show));
    });
    if ($("#show-stop")) $("#show-stop").addEventListener("click", () => busy(stopShow));
    // Best effort: put the lighting back if the tab closes mid-show.
    window.addEventListener("pagehide", () => { if (show && dev) stopShow(); });
    $("#pw-apply").addEventListener("click", () => !guardWrite() && busy(async () => {
      const min = Math.min(120, Math.max(1, Number($("#pw-sleep").value) || 1));
      await dev.setSleepSeconds(min * 60);
      state.power = await dev.readPowerTimers();
      renderAll();
      toast("休眠时间已写入");
    }));

    connect(true); // reconnect silently if permission was granted before
  }

  init();
})();
