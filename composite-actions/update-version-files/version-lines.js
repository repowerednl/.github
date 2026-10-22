const DEFAULT_VERSION_FILES =
  "package.json,pyproject.toml,setup.cfg,Chart.yaml,Dockerfile";

const VERSION_PATTERNS = [
  /^( {0,2}["']?(?:__)?version(?:__)?["']?\s*[:=]\s*["']?)(v?\d[\w.+-]*)(["']?,?\s*)$/,
  /^((?:ARG|ENV)\s+(?:APP_)?VERSION\s*=\s*["']?)(v?\d[\w.+-]*)(["']?\s*)$/i,
  /^(LABEL\s+(?:org\.opencontainers\.image\.)?version\s*=\s*["']?)(v?\d[\w.+-]*)(["']?\s*)$/i,
];

const IMAGE_VALUES_FILE = /(?:^|\/)deployment\/[^/]+\/values[^/]*\.ya?ml$/;

const IMAGE_TAG_LINE = /^image:\s*["']?\S+:v?\d[\w.+-]*["']?\s*$/;

const matchVersion = (line) => {
  for (const pattern of VERSION_PATTERNS) {
    const found = line.match(pattern);
    if (found) {
      return { prefix: found[1], version: found[2], suffix: found[3] };
    }
  }
  return null;
};

const isVersionLine = (line) => matchVersion(line) !== null;

const changedLines = (patch) =>
  String(patch)
    .split("\n")
    .filter((line) => /^[+-]/.test(line) && !/^(\+\+\+|---)/.test(line));

const isImageTagLine = (line) => IMAGE_TAG_LINE.test(line);

const onlyChanges = (patch, isAllowed) => {
  if (typeof patch !== "string") {
    return false;
  }
  const changed = changedLines(patch);
  return changed.length > 0 && changed.every((line) => isAllowed(line.slice(1)));
};

const isVersionOnlyPatch = (patch) => onlyChanges(patch, isVersionLine);

const isImageTagOnlyPatch = (patch) => onlyChanges(patch, isImageTagLine);

const toList = (value) =>
  (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const isVersionFile = (filename, versionFiles) =>
  versionFiles.some(
    (entry) => filename === entry || filename.endsWith(`/${entry}`),
  );

const isImageValuesFile = (filename) => IMAGE_VALUES_FILE.test(filename);

const isReleaseOnlyChange = (filename, patch, versionFiles) =>
  (isVersionFile(filename, versionFiles) && isVersionOnlyPatch(patch)) ||
  (isImageValuesFile(filename) && isImageTagOnlyPatch(patch));

module.exports = {
  DEFAULT_VERSION_FILES,
  VERSION_PATTERNS,
  matchVersion,
  isVersionLine,
  changedLines,
  isVersionOnlyPatch,
  toList,
  isVersionFile,
  isImageTagLine,
  isImageTagOnlyPatch,
  isImageValuesFile,
  isReleaseOnlyChange,
};
