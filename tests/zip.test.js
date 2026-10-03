const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("node:zlib");
const { crc32, createZip } = require("../tools/ziplib.js");

// Minimal reader: walks the central directory and inflates each entry.
function readZip(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocd >= 0, "end-of-central-directory record present");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = {};
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50, "central directory signature");
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    assert.equal(buf.readUInt32LE(local), 0x04034b50, "local header signature");
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(dataStart, dataStart + csize);
    const data = method === 8 ? zlib.inflateRawSync(raw) : raw;
    assert.equal(crc32(data), crc, "crc matches for " + name);
    entries[name] = data;
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

test("crc32 matches the standard check value", () => {
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
  assert.equal(crc32(Buffer.alloc(0)), 0);
});

test("createZip round-trips files, keeps folder paths, uses forward slashes", () => {
  const files = [
    { name: "CavalryGeo.js", data: Buffer.from("var x = 1;\n".repeat(200)) },
    { name: "CavalryGeo_assets/ne/50m/countries.json", data: Buffer.from('{"v":1,"kind":"polygon","f":[]}') },
    { name: "empty.txt", data: Buffer.alloc(0) }
  ];
  const entries = readZip(createZip(files));
  assert.deepEqual(Object.keys(entries).sort(), files.map((f) => f.name).sort());
  for (const f of files) assert.ok(entries[f.name].equals(f.data), "content of " + f.name);
});

test("createZip rejects backslashes and absolute paths", () => {
  assert.throws(() => createZip([{ name: "a\\b.js", data: Buffer.from("x") }]), /forward slashes/);
  assert.throws(() => createZip([{ name: "/abs.js", data: Buffer.from("x") }]), /relative/);
});
