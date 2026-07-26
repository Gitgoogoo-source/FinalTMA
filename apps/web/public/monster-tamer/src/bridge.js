const SOURCE = "pokepets.monster-tamer";

export function postToParent(payload) {
  window.parent.postMessage(
    { source: SOURCE, ...payload },
    window.location.origin,
  );
}
