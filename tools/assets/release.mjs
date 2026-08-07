#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CATALOG_PATH = resolve(ROOT, "generated/catalog/catalog-v1.json");
const DEFAULT_MANIFEST = resolve(ROOT, "generated/assets/art-assets-v2.json");
const PRIVATE_BUCKET = "art-masters";
const PUBLIC_BUCKET = "pet-runtime";
const PUBLIC_CACHE_CONTROL = "max-age=31536000, immutable";
const VARIANTS = {
  thumbnail: {
    directory: "thumb",
    width: 256,
    quality: 82,
    maxBytes: 50 * 1024,
  },
  detail: {
    directory: "detail",
    width: 768,
    quality: 74,
    maxBytes: 180 * 1024,
  },
};

const [command, ...rawArguments] = process.argv.slice(2);
const options = parseOptions(rawArguments);

if (command === "--help") options.help = true;
if (!command || options.help) usage();

const catalog = JSON.parse(await readFile(CATALOG_PATH, "utf8"));
const templateIds = catalog.templates?.map((item) => String(item.id)) ?? [];
if (templateIds.length !== 210 || new Set(templateIds).size !== 210)
  throw new Error("Catalog must contain exactly 210 unique templates");

if (command === "prepare") {
  const sourceDirectory = requiredPath("source-dir");
  const runtimeDirectory = requiredPath("runtime-dir");
  await generateRuntime(sourceDirectory, runtimeDirectory);
  await writeManifest(sourceDirectory, runtimeDirectory);
} else if (command === "manifest") {
  await writeManifest(requiredPath("source-dir"), requiredPath("runtime-dir"));
} else if (command === "sync") {
  const manifest = await readManifest();
  await ensureBuckets();
  await syncObjects(
    manifest,
    requiredPath("source-dir"),
    requiredPath("runtime-dir"),
  );
} else if (command === "verify") {
  await verifyRemote(await readManifest());
} else if (command === "publish") {
  await controlledPublish(await readManifest());
} else if (command === "bootstrap") {
  const manifest = await readManifest();
  await ensureBuckets();
  await syncObjects(
    manifest,
    requiredPath("source-dir"),
    requiredPath("runtime-dir"),
  );
  await controlledPublish(manifest);
} else if (command === "migrate-runtime-v2") {
  await migrateRuntimeV2(true);
} else if (command === "manifest-runtime-v2") {
  await migrateRuntimeV2(false);
} else if (command === "status") {
  console.log(JSON.stringify(await rpc("catalog_asset_current", {}), null, 2));
} else if (command === "lock") {
  const releaseKey = requiredOption("release-key");
  const lockDays = integerOption("lock-days", 90, 1, 3650);
  console.log(
    JSON.stringify(
      await rpc("catalog_asset_lock", {
        p_release_key: releaseKey,
        p_locked_until: new Date(
          Date.now() + lockDays * 86_400_000,
        ).toISOString(),
      }),
      null,
      2,
    ),
  );
} else if (command === "rollback") {
  const releaseKey = requiredOption("release-key");
  const target = await rpc("catalog_asset_release_get", {
    p_release_key: releaseKey,
  });
  await withMutationLease("rollback", target, async (lease) => {
    await verifyRemote(target, lease);
    await rpc("catalog_asset_lock", {
      p_release_key: releaseKey,
      p_locked_until: new Date(Date.now() + 90 * 86_400_000).toISOString(),
    });
    const result = await rpc("catalog_asset_rollback", {
      p_release_key: releaseKey,
      p_idempotency_key: requiredOption("idempotency-key"),
      p_mutation_run_id: lease.run_id,
      p_mutation_fence: lease.fence,
    });
    await assertCurrentRelease(target);
    console.log(JSON.stringify(result, null, 2));
  });
} else {
  throw new Error(`Unknown command: ${command}`);
}

function parseOptions(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--"))
      throw new Error(`Unexpected argument: ${value}`);
    const key = value.slice(2);
    if (key === "help") {
      parsed.help = true;
      continue;
    }
    const next = values[index + 1];
    if (!next || next.startsWith("--"))
      throw new Error(`Missing value for --${key}`);
    parsed[key] = next;
    index += 1;
  }
  return parsed;
}

function usage() {
  console.log(`Usage:
  node tools/assets/release.mjs prepare --source-dir <masters> --runtime-dir <output> --release-key <key>
  node tools/assets/release.mjs manifest --source-dir <masters> --runtime-dir <variants> --release-key <key>
  node tools/assets/release.mjs sync --source-dir <masters> --runtime-dir <variants>
  node tools/assets/release.mjs verify
  node tools/assets/release.mjs publish
  node tools/assets/release.mjs bootstrap --source-dir <masters> --runtime-dir <variants>
  node tools/assets/release.mjs migrate-runtime-v2 --from-manifest <legacy-manifest> --release-key <key> [--manifest <v2-manifest>]
  node tools/assets/release.mjs manifest-runtime-v2 --from-manifest <legacy-manifest> --release-key <key> [--manifest <v2-manifest>]
  node tools/assets/release.mjs status
  node tools/assets/release.mjs lock --release-key <key> [--lock-days 90]
  node tools/assets/release.mjs rollback --release-key <key> --idempotency-key <uuid>

All remote commands require SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.`);
  process.exit(options.help ? 0 : 1);
}

function requiredOption(name) {
  const value = options[name];
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

function requiredPath(name) {
  return resolve(ROOT, requiredOption(name));
}

function integerOption(name, fallback, minimum, maximum) {
  const value = options[name] === undefined ? fallback : Number(options[name]);
  if (!Number.isInteger(value) || value < minimum || value > maximum)
    throw new Error(
      `--${name} must be an integer between ${minimum} and ${maximum}`,
    );
  return value;
}

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

async function validateWebp(path, width, maxBytes) {
  const data = await readFile(path);
  const metadata = await sharp(data).metadata();
  if (
    metadata.format !== "webp" ||
    metadata.width !== width ||
    metadata.height !== width ||
    (metadata.pages ?? 1) !== 1 ||
    data.byteLength > maxBytes
  )
    throw new Error(
      `${path} violates its WebP, dimensions, frame, or byte budget`,
    );
  return {
    data,
    sha256: sha256(data),
    bytes: data.byteLength,
    width,
    height: width,
  };
}

async function generateRuntime(sourceDirectory, runtimeDirectory) {
  sharp.concurrency(4);
  for (const variant of Object.values(VARIANTS))
    await mkdir(resolve(runtimeDirectory, variant.directory), {
      recursive: true,
    });
  for (let index = 0; index < templateIds.length; index += 8) {
    await Promise.all(
      templateIds.slice(index, index + 8).map(async (templateId) => {
        const filename = `${templateId.toLowerCase()}.webp`;
        const sourcePath = resolve(sourceDirectory, filename);
        await validateWebp(sourcePath, 768, 2 * 1024 * 1024);
        await Promise.all(
          Object.values(VARIANTS).map(async (variant) => {
            const outputPath = resolve(
              runtimeDirectory,
              variant.directory,
              filename,
            );
            await sharp(sourcePath)
              .resize(variant.width, variant.width, {
                fit: "fill",
                kernel: sharp.kernel.lanczos3,
              })
              .webp({ quality: variant.quality, effort: 6, alphaQuality: 100 })
              .toFile(outputPath);
            await validateWebp(outputPath, variant.width, variant.maxBytes);
          }),
        );
      }),
    );
  }
  console.log(`Generated ${templateIds.length * 2} runtime WebPs`);
}

async function writeManifest(sourceDirectory, runtimeDirectory) {
  const releaseKey = requiredOption("release-key");
  if (!/^[a-z0-9][a-z0-9._-]{2,127}$/.test(releaseKey))
    throw new Error(
      "--release-key must be a stable lowercase release identifier",
    );
  const templates = [];
  for (const templateId of templateIds) {
    const filename = `${templateId.toLowerCase()}.webp`;
    const master = await validateWebp(
      resolve(sourceDirectory, filename),
      768,
      2 * 1024 * 1024,
    );
    const thumbnail = await validateWebp(
      resolve(runtimeDirectory, "thumb", filename),
      VARIANTS.thumbnail.width,
      VARIANTS.thumbnail.maxBytes,
    );
    const detail = await validateWebp(
      resolve(runtimeDirectory, "detail", filename),
      VARIANTS.detail.width,
      VARIANTS.detail.maxBytes,
    );
    templates.push({
      template_id: templateId,
      master: objectRecord(
        `catalog/${templateId.toLowerCase()}/${master.sha256}.webp`,
        master,
      ),
      thumbnail: objectRecord(
        `catalog/v2/thumb/${templateId.toLowerCase()}.${thumbnail.sha256}.webp`,
        thumbnail,
      ),
      detail: objectRecord(
        `catalog/v2/detail/${templateId.toLowerCase()}.${detail.sha256}.webp`,
        detail,
      ),
    });
  }
  const payload = {
    schema_version: 1,
    catalog_version: "v1",
    private_bucket: PRIVATE_BUCKET,
    public_bucket: PUBLIC_BUCKET,
    generator: {
      node: "24.x",
      sharp: "0.35.3",
      thumbnail: { width: 256, height: 256, quality: 82 },
      detail: { width: 768, height: 768, quality: 74 },
      webp: {
        effort: 6,
        alpha_quality: 100,
        kernel: "lanczos3",
        metadata: false,
      },
    },
    release: {
      key: releaseKey,
      git_commit:
        options["git-commit"] ??
        execFileSync("git", ["rev-parse", "HEAD"], {
          cwd: ROOT,
          encoding: "utf8",
        }).trim(),
    },
    templates,
  };
  const manifest = {
    ...payload,
    manifest_sha256: sha256(canonical(payload)),
  };
  const manifestPath = resolve(ROOT, options.manifest ?? DEFAULT_MANIFEST);
  await writeManifestDocument(manifestPath, manifest);
  console.log(
    `Wrote ${templates.length}-template manifest ${manifest.manifest_sha256} to ${manifestPath}`,
  );
}

function objectRecord(key, item) {
  return {
    key,
    sha256: item.sha256,
    bytes: item.bytes,
    width: item.width,
    height: item.height,
    mime_type: "image/webp",
  };
}

async function readManifest() {
  const path = resolve(ROOT, options.manifest ?? DEFAULT_MANIFEST);
  return readManifestAt(path);
}

async function readManifestAt(path) {
  const manifest = JSON.parse(await readFile(path, "utf8"));
  const { manifest_sha256: expected, ...payload } = manifest;
  if (manifest.schema_version !== 1 || sha256(canonical(payload)) !== expected)
    throw new Error("Asset manifest checksum is invalid");
  if (
    manifest.private_bucket !== PRIVATE_BUCKET ||
    manifest.public_bucket !== PUBLIC_BUCKET ||
    !Array.isArray(manifest.templates) ||
    manifest.templates.length !== 210 ||
    new Set(manifest.templates.map((item) => item.template_id)).size !== 210
  )
    throw new Error("Asset manifest bucket or template coverage is invalid");
  const runtimeKeys = manifest.templates.flatMap((item) => [
    item.thumbnail?.key,
    item.detail?.key,
  ]);
  const namespaces = new Set(
    runtimeKeys.map((key) => /^catalog\/(v[12])\//.exec(String(key))?.[1]),
  );
  if (namespaces.size !== 1 || namespaces.has(undefined))
    throw new Error("Asset manifest runtime namespace is invalid or mixed");
  return manifest;
}

async function writeManifestDocument(path, manifest) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function remoteEnv() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  return { url, key };
}

async function request(path, init = {}, expected = [200]) {
  const env = remoteEnv();
  const method = init.method ?? "GET";
  const attempts = method === "GET" ? 3 : 1;
  let networkFailure;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let response;
    try {
      response = await fetch(`${env.url}${path}`, {
        ...init,
        signal: init.signal ?? AbortSignal.timeout(20_000),
        headers: {
          apikey: env.key,
          authorization: `Bearer ${env.key}`,
          ...(init.headers ?? {}),
        },
      });
    } catch (error) {
      networkFailure = error;
      if (attempt === attempts) throw error;
      await new Promise((resolveDelay) =>
        setTimeout(resolveDelay, attempt * 300),
      );
      continue;
    }
    if (
      method === "GET" &&
      (response.status === 429 || response.status >= 500) &&
      attempt < attempts
    ) {
      await response.arrayBuffer();
      await new Promise((resolveDelay) =>
        setTimeout(resolveDelay, attempt * 300),
      );
      continue;
    }
    if (!expected.includes(response.status)) {
      const body = (await response.text()).slice(0, 500);
      throw new Error(
        `${method} ${path} failed with ${response.status}: ${body}`,
      );
    }
    return response;
  }
  throw networkFailure;
}

async function ensureBuckets() {
  await ensureBucket(PRIVATE_BUCKET, false);
  await ensureBucket(PUBLIC_BUCKET, true);
}

async function ensureBucket(name, isPublic) {
  const existing = await request(
    `/storage/v1/bucket/${name}`,
    {},
    [200, 400, 404],
  );
  if (existing.status === 400) {
    const problem = await existing
      .clone()
      .json()
      .catch(() => null);
    if (problem?.code !== "NoSuchBucket")
      throw new Error(`Storage rejected bucket lookup for ${name}`);
  }
  const body = {
    id: name,
    name,
    public: isPublic,
    file_size_limit: 2 * 1024 * 1024,
    allowed_mime_types: ["image/webp"],
  };
  if (existing.status !== 200)
    await request(
      "/storage/v1/bucket",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
      [200],
    );
  else
    await request(
      `/storage/v1/bucket/${name}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
      [200],
    );
  console.log(
    `Bucket ${name} is ${isPublic ? "public" : "private"} and WebP-only`,
  );
}

function encodedObjectPath(bucket, key, authenticated = true) {
  const encoded = key.split("/").map(encodeURIComponent).join("/");
  return `/storage/v1/object/${authenticated ? "authenticated/" : ""}${bucket}/${encoded}`;
}

async function syncObjects(manifest, sourceDirectory, runtimeDirectory) {
  const tasks = manifest.templates.flatMap((item) => {
    const filename = `${String(item.template_id).toLowerCase()}.webp`;
    return [
      {
        bucket: PRIVATE_BUCKET,
        object: item.master,
        local: resolve(sourceDirectory, filename),
      },
      {
        bucket: PUBLIC_BUCKET,
        object: item.thumbnail,
        local: resolve(runtimeDirectory, "thumb", filename),
      },
      {
        bucket: PUBLIC_BUCKET,
        object: item.detail,
        local: resolve(runtimeDirectory, "detail", filename),
      },
    ];
  });
  await inBatches(tasks, 8, async (task) => {
    const data = await readFile(task.local);
    if (
      sha256(data) !== task.object.sha256 ||
      data.byteLength !== task.object.bytes
    )
      throw new Error(`Local object differs from manifest: ${task.local}`);
    const existing = await downloadObject(
      task.bucket,
      task.object.key,
      [200, 404],
    );
    if (existing) {
      assertRemote(task, existing);
      return;
    }
    await uploadImmutableObject(task, data);
  });
  console.log(`Synced and locally checked ${tasks.length} immutable objects`);
}

async function uploadImmutableObject(task, data) {
  let failure;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await request(
        encodedObjectPath(task.bucket, task.object.key, false),
        {
          method: "POST",
          headers: {
            "cache-control":
              task.bucket === PUBLIC_BUCKET ? PUBLIC_CACHE_CONTROL : "no-store",
            "content-type": "image/webp",
            "x-upsert": "false",
          },
          body: data,
        },
        [200],
      );
      return;
    } catch (error) {
      failure = error;
      const stored = await downloadObject(
        task.bucket,
        task.object.key,
        [200, 404],
      );
      if (stored) {
        assertRemote(task, stored);
        return;
      }
      if (attempt < 3)
        await new Promise((resolveDelay) =>
          setTimeout(resolveDelay, attempt * 500),
        );
    }
  }
  throw failure;
}

async function downloadObject(bucket, key, statuses = [200]) {
  const stored = await fetchStoredObject(bucket, key, statuses, false);
  return stored?.data ?? null;
}

function encodedPublicObjectPath(bucket, key) {
  const encoded = key.split("/").map(encodeURIComponent).join("/");
  return `/storage/v1/object/public/${bucket}/${encoded}`;
}

async function fetchStoredObject(bucket, key, statuses = [200], isPublic) {
  const response = await request(
    isPublic
      ? encodedPublicObjectPath(bucket, key)
      : encodedObjectPath(bucket, key),
    {},
    [...new Set([...statuses, 400])],
  );
  if (response.status === 400) {
    const problem = await response
      .clone()
      .json()
      .catch(() => null);
    if (problem?.code !== "NoSuchKey")
      throw new Error(`Storage rejected object lookup for ${bucket}/${key}`);
    if (!statuses.includes(404))
      throw new Error(`Remote object is missing: ${bucket}/${key}`);
    return null;
  }
  if (response.status === 404) return null;
  return {
    data: Buffer.from(await response.arrayBuffer()),
    cacheControl: response.headers.get("cache-control") ?? "",
    contentType: response.headers.get("content-type") ?? "",
  };
}

function assertRemote(task, data) {
  if (
    data.byteLength !== task.object.bytes ||
    sha256(data) !== task.object.sha256
  )
    throw new Error(
      `Remote immutable object differs from manifest: ${task.bucket}/${task.object.key}`,
    );
}

async function verifyRemote(manifest, lease = null) {
  const tasks = manifest.templates.flatMap((item) => [
    { bucket: PRIVATE_BUCKET, object: item.master },
    { bucket: PUBLIC_BUCKET, object: item.thumbnail },
    { bucket: PUBLIC_BUCKET, object: item.detail },
  ]);
  for (let index = 0; index < tasks.length; index += 8) {
    await Promise.all(
      tasks.slice(index, index + 8).map(async (task) => {
        const stored = await fetchStoredObject(
          task.bucket,
          task.object.key,
          [200],
          task.bucket === PUBLIC_BUCKET,
        );
        assertRemote(task, stored.data);
        const metadata = await sharp(stored.data).metadata();
        if (
          metadata.format !== "webp" ||
          metadata.width !== task.object.width ||
          metadata.height !== task.object.height ||
          !stored.contentType.toLowerCase().startsWith("image/webp")
        )
          throw new Error(
            `Remote object format, MIME, or dimensions are invalid: ${task.object.key}`,
          );
        if (task.bucket === PUBLIC_BUCKET)
          assertPublicCacheControl(task.object.key, stored.cacheControl);
      }),
    );
    if (lease && (index + 8) % 64 === 0) await renewMutationLease(lease);
  }
  console.log(
    `Verified ${tasks.length} remote objects by SHA-256, MIME, dimensions, and cache policy`,
  );
}

function assertPublicCacheControl(key, value) {
  const directives = new Set(
    value
      .toLowerCase()
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
  const legacy = key.startsWith("catalog/v1/");
  const hasOneYear =
    directives.has("max-age=31536000") || directives.has("31536000");
  if (
    !directives.has("public") ||
    !hasOneYear ||
    (!legacy && !directives.has("immutable"))
  )
    throw new Error(`Public cache policy is invalid for ${key}: ${value}`);
}

async function publishManifest(manifest, lease) {
  const { url } = remoteEnv();
  return rpc("catalog_asset_publish", {
    p_release_key: manifest.release.key,
    p_manifest_sha256: manifest.manifest_sha256,
    p_git_commit: manifest.release.git_commit,
    p_public_origin: `${url}/storage/v1/object/public`,
    p_assets: manifest.templates,
    p_mutation_run_id: lease.run_id,
    p_mutation_fence: lease.fence,
  });
}

async function controlledPublish(manifest) {
  await withMutationLease("publish", manifest, async (lease) => {
    await verifyRemote(manifest, lease);
    const result = await publishManifest(manifest, lease);
    await assertCurrentRelease(manifest);
    console.log(JSON.stringify(result, null, 2));
  });
}

async function assertCurrentRelease(manifest) {
  const current = await rpc("catalog_asset_current", {});
  if (
    current?.release_key !== manifest.release.key ||
    current?.manifest_sha256 !== manifest.manifest_sha256 ||
    current?.template_count !== 210
  )
    throw new Error(
      "Current asset release does not match the requested manifest",
    );
  return current;
}

async function acquireMutationLease(kind, manifest) {
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    const result = await rpc("catalog_asset_mutation_acquire", {
      p_kind: kind,
      p_release_key: manifest.release.key,
      p_manifest_sha256: manifest.manifest_sha256,
    });
    if (result?.status === "running") return result;
    if (attempt < 10)
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 3_000));
  }
  throw new Error("Asset mutation lease remained busy for 30 seconds");
}

async function renewMutationLease(lease) {
  const result = await rpc("catalog_asset_mutation_renew", {
    p_run_id: lease.run_id,
    p_fence: lease.fence,
  });
  if (result?.status !== "running")
    throw new Error("Asset mutation lease renewal was rejected");
  lease.expires_at = result.expires_at;
}

async function withMutationLease(kind, manifest, handler) {
  const lease = await acquireMutationLease(kind, manifest);
  try {
    return await handler(lease);
  } catch (error) {
    await rpc("catalog_asset_mutation_abort", {
      p_run_id: lease.run_id,
      p_fence: lease.fence,
      p_reason: error instanceof Error ? error.message : "unknown_error",
    }).catch(() => null);
    throw error;
  }
}

async function migrateRuntimeV2(upload) {
  const sourcePath = requiredPath("from-manifest");
  const source = await readManifestAt(sourcePath);
  if (
    source.templates.some(
      (item) =>
        !item.thumbnail.key.startsWith("catalog/v1/thumb/") ||
        !item.detail.key.startsWith("catalog/v1/detail/"),
    )
  )
    throw new Error("Runtime v2 migration requires a v1 source manifest");
  const releaseKey = requiredOption("release-key");
  if (!/^[a-z0-9][a-z0-9._-]{2,127}$/.test(releaseKey))
    throw new Error(
      "--release-key must be a stable lowercase release identifier",
    );
  if (upload) await ensureBuckets();
  const templates = [];
  for (const item of source.templates) {
    const migrated = { template_id: item.template_id, master: item.master };
    for (const name of ["thumbnail", "detail"]) {
      const previous = item[name];
      const next = {
        ...previous,
        key: previous.key.replace("catalog/v1/", "catalog/v2/"),
      };
      if (upload) {
        const stored = await fetchStoredObject(
          PUBLIC_BUCKET,
          previous.key,
          [200],
          true,
        );
        assertRemote({ bucket: PUBLIC_BUCKET, object: previous }, stored.data);
        await uploadImmutableObject(
          { bucket: PUBLIC_BUCKET, object: next },
          stored.data,
        );
      }
      migrated[name] = next;
    }
    templates.push(migrated);
  }
  const sourcePayload = structuredClone(source);
  delete sourcePayload.manifest_sha256;
  const payload = {
    ...sourcePayload,
    release: {
      key: releaseKey,
      git_commit:
        options["git-commit"] ??
        execFileSync("git", ["rev-parse", "HEAD"], {
          cwd: ROOT,
          encoding: "utf8",
        }).trim(),
    },
    templates,
  };
  const manifest = {
    ...payload,
    manifest_sha256: sha256(canonical(payload)),
  };
  const manifestPath = resolve(ROOT, options.manifest ?? DEFAULT_MANIFEST);
  await writeManifestDocument(manifestPath, manifest);
  if (upload) await verifyRemote(manifest);
  console.log(
    `${upload ? "Migrated" : "Prepared"} ${templates.length * 2} public runtime objects for v2 and wrote ${manifestPath}`,
  );
}

async function rpc(name, parameters) {
  const response = await request(`/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      "content-profile": "api",
      "content-type": "application/json",
      "accept-profile": "api",
    },
    body: JSON.stringify(parameters),
  });
  return response.status === 204 ? null : response.json();
}

async function inBatches(items, concurrency, handler) {
  for (let index = 0; index < items.length; index += concurrency)
    await Promise.all(items.slice(index, index + concurrency).map(handler));
}

await stat(CATALOG_PATH);
