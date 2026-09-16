// GSA Build Kit — Figma export plugin
//
// Exports EVERY component variant in the file, once per theme (variable mode),
// and uploads the PNGs to the GSA Build Kit server. This is the only way to get
// theme-specific renders: Figma's REST image API always uses one mode, while the
// Plugin API can set the mode before exporting.
//
// Flow: UI configures (server, token, collection, modes) -> main walks the file,
// sets the mode, exports each variant, base64-encodes it and hands batches to
// the UI, which POSTs them to the server. Batches are ack'd for backpressure.

const BATCH_SIZE = 25;
const EXPORT_SCALE = 2;

type Target = { node: ComponentNode; name: string; group: string };

let collections: VariableCollection[] = [];
let allCollections: VariableCollection[] = [];
let pendingAck: (() => void) | null = null;
let cancelled = false;

figma.showUI(__html__, { width: 420, height: 560, themeColors: true });

// --- helpers ---------------------------------------------------------------

function isNoiseComponent(name: string): boolean {
  const n = name.trim();
  if (!n) return true;
  if (/\[deprecated\]/i.test(n)) return true;
  if (/^[_]/.test(n)) return true;
  if (/^[→←↑↓]/.test(n)) return true;
  if (/^Frame \d+/i.test(n)) return true;
  if (/^Component \d+/i.test(n)) return true;
  if (/^placeholder\b/i.test(n)) return true;
  if (/^(page|line|dot)$/i.test(n)) return true;
  if (/^Status bar\b/i.test(n)) return true;
  if (/^Home Indicator\b/i.test(n)) return true;
  return false;
}

// Mirror of the server's extractRenderTargets: keep every non-noise component,
// expand each set into one entry per variant, dedupe by name preferring sets.
async function collectTargets(): Promise<Target[]> {
  await figma.loadAllPagesAsync();
  const found = figma.root.findAllWithCriteria({ types: ["COMPONENT_SET", "COMPONENT"] });

  const byName = new Map<string, { name: string; type: "SET" | "COMPONENT"; node: ComponentSetNode | ComponentNode }>();
  for (const node of found) {
    const name = node.name;
    if (isNoiseComponent(name)) continue;
    const key = name.trim().toLowerCase();
    if (node.type === "COMPONENT_SET") {
      byName.set(key, { name, type: "SET", node });
    } else if (!byName.has(key)) {
      byName.set(key, { name, type: "COMPONENT", node });
    }
  }

  const targets: Target[] = [];
  for (const entry of byName.values()) {
    if (entry.type === "COMPONENT") {
      targets.push({ node: entry.node as ComponentNode, name: entry.name, group: entry.name });
      continue;
    }
    const kids = (entry.node as ComponentSetNode).children.filter((c) => c.type === "COMPONENT") as ComponentNode[];
    if (!kids.length) {
      targets.push({ node: entry.node as unknown as ComponentNode, name: entry.name, group: entry.name });
      continue;
    }
    for (const k of kids) targets.push({ node: k, name: k.name, group: entry.name });
  }
  return targets;
}

async function fileInfo() {
  allCollections = await figma.variables.getLocalVariableCollectionsAsync();
  collections = allCollections.filter((c) => (c.modes ?? []).length >= 2);
  const targets = await collectTargets();
  return {
    fileName: figma.root.name,
    fileKey: (figma.fileKey as string) || "",
    variantCount: targets.length,
    usableCount: collections.length,
    collections: allCollections.map((c) => ({
      id: c.id,
      name: c.name,
      remote: !!c.remote,
      modes: (c.modes ?? []).map((m) => ({ modeId: m.modeId, name: m.name })),
    })),
  };
}

function currentModeFor(node: SceneNode, collectionId: string): string | null {
  try {
    const map = (node as any).explicitVariableModes as Record<string, string> | undefined;
    return map && map[collectionId] ? map[collectionId] : null;
  } catch {
    return null;
  }
}

function setMode(node: SceneNode, collection: VariableCollection, modeId: string | null) {
  try {
    (node as any).setExplicitVariableModeForCollection(collection, modeId);
  } catch {
    // Older API surface: fall back to clearing.
    if (modeId === null) {
      try {
        (node as any).clearExplicitVariableModeForCollection(collection);
      } catch {}
    }
  }
}

function sendBatch(payload: Record<string, unknown>): Promise<void> {
  return new Promise((resolve) => {
    pendingAck = resolve;
    figma.ui.postMessage(payload);
  });
}

// --- export ----------------------------------------------------------------

async function runExport(opts: {
  server: string;
  token: string;
  collectionId: string;
  modeIds: string[];
}) {
  const collection = allCollections.find((c) => c.id === opts.collectionId) || collections.find((c) => c.id === opts.collectionId);
  if (!collection) throw new Error("Theme collection not found. Click Detect and pick one.");
  const modes = collection.modes ?? [];

  const targets = await collectTargets();
  const info = await fileInfo();
  const fileVersion = (figma.root as any).version ?? "";

  let total = 0;
  for (const modeId of opts.modeIds) {
    const mode = modes.find((m) => m.modeId === modeId);
    const themeName = mode ? mode.name : modeId;
    let done = 0;
    let batch: Record<string, unknown>[] = [];
    let skipped = 0;

    for (const t of targets) {
      if (cancelled) throw new Error("Cancelled");
      const prev = currentModeFor(t.node, collection.id);
      setMode(t.node, collection, modeId);
      let bytes: Uint8Array | null = null;
      try {
        bytes = await t.node.exportAsync({
          format: "PNG",
          constraint: { type: "SCALE", value: EXPORT_SCALE },
        });
      } catch {
        skipped++;
      } finally {
        setMode(t.node, collection, prev);
      }
      done++;
      if (bytes) {
        batch.push({
          nodeId: t.node.id,
          name: t.name,
          group: t.group,
          mime: "image/png",
          base64: figma.base64Encode(bytes),
        });
      }
      if (batch.length >= BATCH_SIZE) {
        total += batch.length;
        await sendBatch({
          type: "batch",
          theme: themeName,
          server: opts.server,
          token: opts.token,
          fileVersion,
          fileKey: info.fileKey,
          images: batch,
          progress: { theme: themeName, done, of: targets.length },
        });
        batch = [];
      } else if (done % 5 === 0) {
        figma.ui.postMessage({ type: "progress", theme: themeName, done, of: targets.length });
      }
    }

    if (batch.length) {
      total += batch.length;
      await sendBatch({
        type: "batch",
        theme: themeName,
        server: opts.server,
        token: opts.token,
        fileVersion,
        fileKey: info.fileKey,
        images: batch,
        progress: { theme: themeName, done, of: targets.length },
      });
    }
    figma.ui.postMessage({ type: "themeDone", theme: themeName, skipped });
  }

  figma.ui.postMessage({ type: "done", total });
}

// --- messaging -------------------------------------------------------------

figma.ui.onmessage = async (msg: any) => {
  if (msg?.type === "ack") {
    const r = pendingAck;
    pendingAck = null;
    if (r) r();
    return;
  }
  if (msg?.type === "cancel") {
    cancelled = true;
    const r = pendingAck;
    pendingAck = null;
    if (r) r();
    return;
  }
  try {
    if (msg?.type === "detect") {
      cancelled = false;
      figma.ui.postMessage({ type: "detected", info: await fileInfo() });
      return;
    }
    if (msg?.type === "export") {
      cancelled = false;
      await runExport(msg.opts);
      return;
    }
  } catch (err) {
    figma.ui.postMessage({ type: "error", message: (err as Error).message });
  }
};

// Kick off detection on load so the UI has something to show.
fileInfo()
  .then((info) => figma.ui.postMessage({ type: "detected", info }))
  .catch((err) => figma.ui.postMessage({ type: "error", message: (err as Error).message }));
