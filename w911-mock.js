// In-memory W911 emulator for previewing the page without a keyboard (open index.html?demo).
// Seeded with the values read from a real W911 Pro (firmware 2.3.0003, board K2009-B00.260421).
const W911Mock = (() => {
  function create(productId = 0x4100) {
    const keys = [new Uint8Array(1280), new Uint8Array(1280)];
    const setKeys = (p, list) => list.forEach(([i, v]) => keys[p].set(v, i * 4));
    // Snapshot of the unit this page was built against (profile 1 and 2 are identical for now).
    const REAL = [
      [0, [2, 0x1e]], [1, [2, 0x2b]], [2, [2, 0xe1]], [3, [2, 0xe0]], [4, [2, 0x1b]], [5, [2, 0x52]],
      [8, [2, 0x1f]], [9, [2, 0x42]], [10, [2, 0x44]], [11, [2, 0xe2]], [12, [2, 0x1c]], [13, [2, 0x51]],
      [16, [2, 0x20]], [17, [2, 0x43]], [18, [2, 0x45]], [19, [2, 0x2c]], [20, [2, 0x1d]], [21, [2, 0x50]],
      [24, [2, 0x21]], [25, [2, 0x4b]], [26, [2, 0x4e]], [27, [2, 0x4c]],
      [29, [2, 0x4f]], [32, [2, 0x22]], [33, [2, 0x28]], [37, [9, 3]], [38, [9, 3]],
      [40, [2, 0x23]], [41, [7, 1]],
    ];
    setKeys(0, REAL);
    setKeys(1, REAL);
    const v = () => new Uint8Array([5, 0x01, 0, 0, 5, 0x81, 0, 0, 0x04, 0xe9, 0, 0, 0x04, 0xea, 0, 0]);
    const knob = [[v(), v()], [v(), v()]];
    const light = [new Uint8Array(250), new Uint8Array(250)];
    for (const p of [0, 1]) {
      light[p].set([0x87, 0xff, 0x01]);
      for (let m = 1; m <= 8; m++) light[p].set([7, 0, 0, 0x10, ...Array(21).fill(0xff)], m * 25);
    }
    const macros = new Map();
    const settings = { 2: [0], 3: [300, 0], 4: [600, 0] };
    let reply = new Uint8Array(40);

    function handle(p) {
      const [, , cmd, , arg, lo, hi, len] = p;
      const addr = lo | (hi << 8);
      const prof = settings[2][0];
      const data = p.slice(8, 8 + len);
      const out = new Uint8Array(40);
      out.set(p.slice(0, 8));
      const read = (src) => out.set(src.slice(addr, addr + len), 8);
      switch (cmd) {
        case 0xf0: out.set(new TextEncoder().encode(arg === 1 ? "2.3.0003" : "K2009-B00.260421").slice(0, len), 8); break;
        case 0x82: out.set(settings[arg] || [], 8); break;
        case 0x02: settings[arg] = Array.from(data); break;
        case 0x84: read(keys[prof].subarray(arg * 640)); break;
        case 0x04: keys[prof].set(data, arg * 640 + addr); break;
        case 0x85: read(knob[prof][arg]); break;
        case 0x05: knob[prof][arg].set(data, addr); break;
        case 0x89: read(light[prof]); break;
        case 0x09: light[prof].set(data, addr); break;
        case 0x88: { const m = macros.get(arg) || new Uint8Array(4); const b = new Uint8Array(512); b.set(m); read(b); break; }
        case 0x08: { if (arg >= 16) break;
           const b = new Uint8Array(512); b.set(macros.get(arg) || []); b.set(data, addr); macros.set(arg, b); break; }
      }
      if (cmd & 0x80) reply = out;
    }

    return {
      vendorId: 0xb6a4, productId, opened: true,
      collections: [{ featureReports: [{ reportId: 6 }] }],
      async open() {}, async close() {},
      async sendFeatureReport(id, p) { handle(new Uint8Array(p)); },
      async receiveFeatureReport() { const b = new Uint8Array(41); b[0] = 6; b.set(reply, 1); return new DataView(b.buffer); },
    };
  }
  return { create };
})();
