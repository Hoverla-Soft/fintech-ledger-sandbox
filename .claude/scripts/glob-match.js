// Minimal glob matcher shared by the hook scripts. No dependency on purpose.
// Supports "**" (any path segment(s), including "/"), "*" (anything but "/"), literal segments.
function globToRegExp(glob) {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, " ")
    .replace(/\*/g, "[^/]*")
    .replace(/ /g, ".*");
  return new RegExp(`^${escaped}$`);
}

function matches(relativePath, glob) {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\.\//, "");
  return globToRegExp(glob).test(normalized);
}

module.exports = { matches };
